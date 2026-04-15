/**
 * xAI Batch classification library.
 *
 * Extracted from scripts/batch-classify.ts so both the CLI and the weekly
 * cron route can submit batches, poll for completion, and import results
 * using the same code path.
 *
 * Three exported functions that compose into a full pipeline:
 *
 *   submitBatchClassify(opts) → Promise<{ batchId, submitted, ... }>
 *     Queries PENDING contracts, pre-filters (expired deadlines, restricted
 *     set-asides), marks pre-filtered as DISCARD, creates an xAI batch,
 *     uploads prompts in chunks. Returns the batch ID and counts.
 *
 *   pollBatch(batchId) → Promise<{ status, numSuccess, ... }>
 *     Single non-blocking poll. Returns "running" | "completed" | "failed".
 *     The caller decides whether to sleep and poll again (CLI) or return
 *     and be re-invoked later by cron (API route).
 *
 *   importBatchResults(batchId) → Promise<{ classified, good, maybe, ... }>
 *     Fetches all result pages and imports them via bulk UPDATE.
 *     Idempotent: only updates rows where classification='PENDING', so
 *     re-running on the same batch ID is safe.
 */

import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq, and, gte, inArray, sql } from "drizzle-orm";
import { buildUnifiedClassificationPrompt } from "./prompts";
import { downloadDocuments } from "@/lib/sam-gov/documents";
import { extractAllDocumentTexts } from "@/lib/document-text";
import { isRestrictedSetAside } from "@/lib/sam-gov/set-aside-filter";

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = "https://api.x.ai/v1";
const MODEL = "grok-4-1-fast-non-reasoning";
const CHUNK_SIZE = 100;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 5_000;
const CHUNK_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 60_000;
const RESULTS_FETCH_TIMEOUT_MS = 120_000;
const DB_CHUNK_SIZE = 500;
const DB_CHUNK_MAX_RETRIES = 3;
const DB_CHUNK_RETRY_DELAY_MS = 10_000;

// ── Internals ──────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY not set");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// xAI's REST responses are heterogeneous (batch create, batch poll, page
// of results all have different shapes) and typing them upfront would add
// noise without catching real bugs. Call sites index defensively into
// optional fields, so `any` is the pragmatic return type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function xai(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<any> {
  const apiKey = getApiKey();
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) return res.json();

      const text = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const delay = BACKOFF_BASE_MS * Math.pow(3, attempt - 1);
        console.warn(
          `[batch-lib] xAI ${res.status} on ${method} ${path}, attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay / 1000}s...`,
        );
        await sleep(delay);
        continue;
      }
      throw new Error(
        `xAI ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`,
      );
    } catch (err) {
      const errName = err instanceof Error ? err.name : "";
      if (errName === "TimeoutError" || errName === "AbortError") {
        if (attempt < MAX_RETRIES) {
          const delay = BACKOFF_BASE_MS * Math.pow(3, attempt - 1);
          console.warn(
            `[batch-lib] Timeout on ${method} ${path}, attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay / 1000}s...`,
          );
          await sleep(delay);
          continue;
        }
        throw new Error(
          `xAI ${method} ${path} timed out after ${MAX_RETRIES} attempts`,
        );
      }
      throw err;
    }
  }
  throw new Error(`xAI ${method} ${path}: exhausted retries`);
}

// Assumes `standard_conforming_strings=on` (Postgres default ≥9.1). Unusual
// input (NULL bytes, invalid UTF-8) causes Postgres to reject the chunk,
// which is handled by the retry loop below and eventually logged to
// failedChunks — loud failure is better than silent mutation for a
// classifier pipeline. A future refactor can migrate this to Drizzle's
// parameterized bulk-insert API when the 500-row chunking is revisited.
function escapeLiteral(val: string | null | undefined): string {
  if (val == null) return "NULL";
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ── submitBatchClassify ────────────────────────────────────────────────────

export type SubmitOptions = {
  /** Only classify contracts with classification='PENDING'. Default true. */
  pendingOnly?: boolean;
  /**
   * Only classify contracts created on or after this timestamp. When
   * omitted, no time scoping is applied — used by the manual CLI backfill
   * path. The weekly cron passes windowStart here to scope to the current
   * 7-day window, preventing pre-existing stuck PENDING rows from being
   * re-submitted on every cron fire.
   */
  since?: Date;
  /** Max number of contracts to query. Default: unlimited. */
  limit?: number;
  /** Callback for progress messages. Defaults to console.log. */
  onProgress?: (msg: string) => void;
};

export type SubmitResult = {
  batchId: string;
  /** Number of contracts sent to xAI. */
  submitted: number;
  /** Number auto-discarded by code pre-filter. */
  preFilteredDiscard: number;
  /** Total candidate contracts queried before filtering. */
  queried: number;
};

/**
 * Query PENDING contracts, pre-filter, create an xAI batch, upload prompts.
 * Returns immediately after the batch is submitted; does NOT poll.
 *
 * Idempotent only in the weak sense that re-running produces a new batch
 * containing the same (now still PENDING) contracts. The caller is expected
 * to store the returned `batchId` somewhere (e.g. crawl_runs.batchId) so a
 * later poll can find it.
 */
export async function submitBatchClassify(
  opts: SubmitOptions = {},
): Promise<SubmitResult> {
  const pendingOnly = opts.pendingOnly ?? true;
  const log = opts.onProgress ?? ((m: string) => console.log(m));

  log("[batch-lib] Querying contracts for unified classification...");

  const baseClauses = [eq(contracts.userOverride, false)];
  if (pendingOnly) {
    baseClauses.push(eq(contracts.classification, "PENDING"));
  }
  if (opts.since) {
    baseClauses.push(gte(contracts.createdAt, opts.since));
  }
  const whereExpr =
    baseClauses.length === 1 ? baseClauses[0] : and(...baseClauses);

  const queryBuilder = db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      title: contracts.title,
      naicsCode: contracts.naicsCode,
      pscCode: contracts.pscCode,
      agency: contracts.agency,
      noticeType: contracts.noticeType,
      setAsideType: contracts.setAsideType,
      setAsideCode: contracts.setAsideCode,
      awardCeiling: contracts.awardCeiling,
      responseDeadline: contracts.responseDeadline,
      popState: contracts.popState,
      descriptionText: contracts.descriptionText,
      resourceLinks: contracts.resourceLinks,
    })
    .from(contracts)
    .where(whereExpr)
    .orderBy(contracts.postedDate);

  const allContracts = opts.limit
    ? await queryBuilder.limit(opts.limit)
    : await queryBuilder;

  if (allContracts.length === 0) {
    throw new Error("No contracts to classify");
  }

  // Code pre-filter
  const today = new Date();
  let preFilteredDiscard = 0;
  const pending = allContracts.filter((c) => {
    if (c.responseDeadline && new Date(c.responseDeadline) < today) {
      preFilteredDiscard++;
      return false;
    }
    if (isRestrictedSetAside(c.setAsideCode)) {
      preFilteredDiscard++;
      return false;
    }
    return true;
  });

  log(`[batch-lib] Queried: ${allContracts.length} contracts`);
  log(
    `[batch-lib] Pre-filtered: ${preFilteredDiscard} auto-DISCARD (expired deadlines + restricted set-asides)`,
  );
  log(`[batch-lib] Sending to xAI: ${pending.length} contracts`);

  // Mark pre-filtered as DISCARD in DB
  const preFilteredIds = allContracts
    .filter((c) => !pending.includes(c))
    .map((c) => c.id);

  if (preFilteredIds.length > 0) {
    for (let i = 0; i < preFilteredIds.length; i += 500) {
      const chunk = preFilteredIds.slice(i, i + 500);
      await db
        .update(contracts)
        .set({
          classification: "DISCARD",
          aiReasoning:
            "Auto-discarded by code pre-filter (expired deadline or restricted set-aside)",
          classificationRound: 4,
          classifiedFromMetadata: false,
          documentsAnalyzed: true,
          updatedAt: new Date(),
        })
        .where(inArray(contracts.id, chunk));
    }
  }

  if (pending.length === 0) {
    throw new Error("All contracts were pre-filtered");
  }

  // Reset remaining to PENDING round 4 (so the import filter WHERE
  // classification=PENDING can find them later)
  const resetIds = pending.map((c) => c.id);
  for (let i = 0; i < resetIds.length; i += 500) {
    const chunk = resetIds.slice(i, i + 500);
    await db
      .update(contracts)
      .set({
        classification: "PENDING",
        classificationRound: 4,
        updatedAt: new Date(),
      })
      .where(inArray(contracts.id, chunk));
  }

  // Create batch
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const batchResp = await xai("POST", "/batches", {
    name: `unified-${timestamp}`,
  });
  const batchId = batchResp.id ?? batchResp.batch_id;
  if (!batchId) {
    throw new Error(
      `xAI batch create: no batch ID in response: ${JSON.stringify(batchResp)}`,
    );
  }
  log(`[batch-lib] Created batch: ${batchId}`);

  // Build prompts (with document extraction)
  type Prepared = { noticeId: string; prompt: string };
  const prepared: Prepared[] = [];
  for (let i = 0; i < pending.length; i++) {
    const contract = pending[i];
    let docTexts: string[] = [];
    const linkCount = (contract.resourceLinks || []).length;
    if (linkCount > 0) {
      try {
        const docs = await downloadDocuments(contract.resourceLinks);
        docTexts = await extractAllDocumentTexts(docs);
      } catch (err) {
        log(
          `[batch-lib] Doc extraction failed for ${contract.noticeId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const prompt = buildUnifiedClassificationPrompt({
      title: contract.title,
      agency: contract.agency,
      naicsCode: contract.naicsCode,
      pscCode: contract.pscCode,
      noticeType: contract.noticeType,
      setAsideType: contract.setAsideType,
      setAsideCode: contract.setAsideCode,
      awardCeiling: contract.awardCeiling,
      responseDeadline: contract.responseDeadline
        ? new Date(contract.responseDeadline).toISOString()
        : null,
      popState: contract.popState,
      descriptionText: contract.descriptionText,
      documentTexts: docTexts,
    });

    prepared.push({ noticeId: contract.noticeId, prompt });
  }
  log(`[batch-lib] Prepared ${prepared.length} prompts`);

  // Upload requests in chunks
  for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
    const chunk = prepared.slice(i, i + CHUNK_SIZE);
    const batchRequests = chunk.map((c) => ({
      batch_request_id: c.noticeId,
      batch_request: {
        chat_get_completion: {
          messages: [{ role: "user", content: c.prompt }],
          model: MODEL,
          temperature: 0,
        },
      },
    }));

    await xai("POST", `/batches/${batchId}/requests`, {
      batch_requests: batchRequests,
    });
    log(
      `[batch-lib] Uploaded requests ${i + 1}–${Math.min(i + CHUNK_SIZE, prepared.length)} of ${prepared.length}`,
    );

    if (i + CHUNK_SIZE < prepared.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  return {
    batchId,
    submitted: prepared.length,
    preFilteredDiscard,
    queried: allContracts.length,
  };
}

// ── pollBatch ──────────────────────────────────────────────────────────────

export type PollResult = {
  /** "running" if any pending requests remain, else "completed" or "failed". */
  status: "running" | "completed" | "failed";
  numSuccess: number;
  numError: number;
  numPending: number;
  total: number;
};

/**
 * Single non-blocking poll. The CLI can call this in a loop with sleep;
 * the cron route calls it once per /api/cron/check-batches invocation.
 */
export async function pollBatch(batchId: string): Promise<PollResult> {
  const resp = await xai("GET", `/batches/${batchId}`);
  const state = resp.state ?? {};
  const numSuccess: number = state.num_success ?? 0;
  const numError: number = state.num_error ?? 0;
  const numPending: number = state.num_pending ?? 0;
  const total: number = state.num_requests ?? 0;

  let status: "running" | "completed" | "failed";
  if (total === 0) {
    // Batch just created, no requests indexed yet
    status = "running";
  } else if (numPending > 0) {
    status = "running";
  } else if (numSuccess > 0) {
    status = "completed";
  } else {
    status = "failed";
  }

  return { status, numSuccess, numError, numPending, total };
}

// ── importBatchResults ─────────────────────────────────────────────────────

type ParsedResult = {
  noticeId: string;
  classification: string;
  reasoning: string;
  summary: string;
  actionPlan: string | null;
};

function extractContent(item: Record<string, unknown>): string | undefined {
  // xAI's batch response shape is nested and varies by endpoint version,
  // so we walk it defensively with unknown-typed intermediate casts.
  const batchResultRaw = (item as Record<string, unknown>).batch_result as
    | Record<string, unknown>
    | undefined;
  const responseRaw = batchResultRaw?.response as
    | Record<string, unknown>
    | undefined;
  const chatGetCompletion = responseRaw?.chat_get_completion as
    | { choices?: { message?: { content?: string } }[] }
    | undefined;
  if (chatGetCompletion?.choices?.[0]?.message?.content) {
    return chatGetCompletion.choices[0].message.content;
  }
  const response = item.response as Record<string, unknown> | undefined;
  if (response) {
    if (typeof response.content === "string") return response.content;
    const choices = response.choices as
      | { message?: { content?: string } }[]
      | undefined;
    if (choices?.[0]?.message?.content) return choices[0].message.content;
  }
  return undefined;
}

export type ImportResult = {
  /** Number of contracts successfully imported (parsed + written). */
  classified: number;
  good: number;
  maybe: number;
  discard: number;
  /** Parse/validation errors. Contracts stay PENDING. */
  errors: number;
  /** Rows dropped due to DB chunk failures. */
  skippedRows: number;
  /** Cost in USD from xAI's cost_breakdown. */
  costUsd: number;
};

/**
 * Fetch all result pages for a completed batch and import via bulk UPDATE.
 *
 * Idempotent: the UPDATE only touches rows where classification='PENDING',
 * so re-running on a batch that was already partially imported will only
 * write the rows that were never persisted. Safe to call multiple times.
 */
export async function importBatchResults(
  batchId: string,
  opts: { onProgress?: (msg: string) => void } = {},
): Promise<ImportResult> {
  const log = opts.onProgress ?? ((m: string) => console.log(m));

  let good = 0;
  let maybe = 0;
  let discard = 0;
  let errors = 0;
  let processed = 0;
  let skippedRows = 0;
  let pageNum = 0;
  let paginationToken: string | null = null;
  let buffer: ParsedResult[] = [];

  const failedChunks: {
    chunkIndex: number;
    rowCount: number;
    error: string;
  }[] = [];
  let dbChunksSent = 0;

  async function flushBuffer() {
    if (buffer.length === 0) return;
    for (let i = 0; i < buffer.length; i += DB_CHUNK_SIZE) {
      const chunkIndex = dbChunksSent + Math.floor(i / DB_CHUNK_SIZE);
      const chunk = buffer.slice(i, i + DB_CHUNK_SIZE);
      const values = chunk
        .map(
          (r) =>
            `(${escapeLiteral(r.noticeId)}, ${escapeLiteral(r.classification)}, ${escapeLiteral(r.reasoning)}, ${escapeLiteral(r.summary)}, ${escapeLiteral(r.actionPlan)})`,
        )
        .join(",\n");

      let written = false;
      for (let attempt = 1; attempt <= DB_CHUNK_MAX_RETRIES; attempt++) {
        try {
          // Idempotency: only update rows that are still PENDING. Re-running
          // importBatchResults on the same batch ID is safe — already-imported
          // rows have classification in ('GOOD','MAYBE','DISCARD') and will
          // be skipped by this predicate.
          await db.execute(sql`
            UPDATE contracts SET
              classification = v.classification::classification,
              ai_reasoning = v.reasoning,
              summary = v.summary,
              action_plan = v.action_plan,
              classification_round = 4,
              classified_from_metadata = false,
              documents_analyzed = true,
              updated_at = NOW()
            FROM (VALUES ${sql.raw(values)}) AS v(notice_id, classification, reasoning, summary, action_plan)
            WHERE contracts.notice_id = v.notice_id
              AND contracts.classification = 'PENDING'
          `);
          written = true;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < DB_CHUNK_MAX_RETRIES) {
            const delay = DB_CHUNK_RETRY_DELAY_MS * attempt;
            log(
              `[batch-lib] DB import chunk ${chunkIndex + 1} (${chunk.length} rows) failed: ${msg}. Retry in ${delay / 1000}s`,
            );
            await sleep(delay);
          } else {
            log(
              `[batch-lib] DB import chunk ${chunkIndex + 1} permanently failed: ${msg}`,
            );
            failedChunks.push({
              chunkIndex: chunkIndex + 1,
              rowCount: chunk.length,
              error: msg,
            });
          }
        }
      }
      if (!written) {
        skippedRows += chunk.length;
      }
    }
    dbChunksSent += Math.ceil(buffer.length / DB_CHUNK_SIZE);
    buffer = [];
  }

  do {
    pageNum++;
    const params = new URLSearchParams({ page_size: "100" });
    if (paginationToken) params.set("pagination_token", paginationToken);

    const page = await xai(
      "GET",
      `/batches/${batchId}/results?${params.toString()}`,
      undefined,
      RESULTS_FETCH_TIMEOUT_MS,
    );

    const succeeded: unknown[] = page.succeeded ?? page.results ?? [];
    for (const item of succeeded as Record<string, unknown>[]) {
      const noticeId = item.batch_request_id as string;
      try {
        const content = extractContent(item);
        if (!content) {
          errors++;
          log(`[batch-lib] Empty response for ${noticeId}`);
          continue;
        }
        const cleaned = content
          .replace(/```json\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();
        const parsed = JSON.parse(cleaned);
        const classification = parsed.classification?.toUpperCase();
        if (!["GOOD", "MAYBE", "DISCARD"].includes(classification)) {
          errors++;
          log(
            `[batch-lib] Invalid classification "${parsed.classification}" for ${noticeId}`,
          );
          continue;
        }
        buffer.push({
          noticeId,
          classification,
          reasoning: parsed.reasoning ?? "",
          summary: parsed.summary ?? "",
          actionPlan: parsed.actionPlan
            ? JSON.stringify(parsed.actionPlan)
            : null,
        });
        processed++;
        if (classification === "GOOD") good++;
        else if (classification === "MAYBE") maybe++;
        else discard++;
      } catch (err) {
        errors++;
        log(
          `[batch-lib] Parse error for ${noticeId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const failed: unknown[] = page.failed ?? [];
    for (const item of failed as Record<string, unknown>[]) {
      errors++;
      const nid = item.batch_request_id as string;
      const errMsg = item.error_message ?? "unknown error";
      log(`[batch-lib] Failed request ${nid}: ${errMsg}`);
    }

    if (buffer.length >= DB_CHUNK_SIZE) {
      await flushBuffer();
    }

    log(
      `[batch-lib] Page ${pageNum}: ${processed} parsed, ${errors} errors (${good}/${maybe}/${discard})`,
    );

    paginationToken = page.pagination_token ?? null;
  } while (paginationToken);

  // Flush remainder
  await flushBuffer();

  // Cost
  let costUsd = 0;
  try {
    const finalStatus = await xai("GET", `/batches/${batchId}`);
    const costTicks = finalStatus.cost_breakdown?.total_cost_usd_ticks ?? 0;
    costUsd = costTicks / 1e10;
  } catch (err) {
    log(
      `[batch-lib] Could not fetch cost: ${err instanceof Error ? err.message : err}`,
    );
  }

  return {
    classified: processed - skippedRows,
    good,
    maybe,
    discard,
    errors,
    skippedRows,
    costUsd,
  };
}
