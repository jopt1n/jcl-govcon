/**
 * Batch unified classification + action plan via xAI Batch API (50% cheaper).
 * Round 4: Single prompt returns classification + action plan together.
 *
 * Pre-filter (code, before sending to xAI):
 *   - Expired response deadlines → auto-DISCARD
 *   - Restricted set-asides (8A, SDVOSB, HZ, WOSB, EDWOSB) → auto-DISCARD
 *   - No NAICS filtering — let the LLM decide feasibility
 *
 * Usage:
 *   npx tsx scripts/batch-classify.ts
 *   npx tsx scripts/batch-classify.ts --limit 5 --dry-run
 *   npx tsx scripts/batch-classify.ts --batch-id <id> --skip 8600
 *   npx tsx scripts/batch-classify.ts --poll-only <batchId>
 *   npx tsx scripts/batch-classify.ts --import-batch-id <batchId>
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// Load env before any imports that need it
const envPath = resolve(__dirname, "../.env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const XAI_API_KEY = process.env.XAI_API_KEY;
if (!XAI_API_KEY) throw new Error("XAI_API_KEY not set");

const BASE_URL = "https://api.x.ai/v1";
const MODEL = "grok-4-1-fast-non-reasoning";
const CHUNK_SIZE = 100;
const POLL_INTERVAL_MS = 30_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 5_000;
const CHUNK_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 60_000;
const RESULTS_FETCH_TIMEOUT_MS = 120_000;
const DB_CHUNK_SIZE = 500;
const IMPORT_MAX_RETRIES = 5;
const IMPORT_RETRY_DELAY_MS = 30_000;
const DB_CHUNK_MAX_RETRIES = 3;
const DB_CHUNK_RETRY_DELAY_MS = 10_000;

// ── CLI args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let batchId: string | null = null;
  let skip = 0;
  let pollOnly: string | null = null;
  let importBatchId: string | null = null;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch-id" && args[i + 1]) {
      batchId = args[++i];
    } else if (args[i] === "--skip" && args[i + 1]) {
      skip = parseInt(args[++i], 10);
    } else if (args[i] === "--poll-only" && args[i + 1]) {
      pollOnly = args[++i];
    } else if (args[i] === "--import-batch-id" && args[i + 1]) {
      importBatchId = args[++i];
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { batchId, skip, pollOnly, importBatchId, limit, dryRun };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function xai(method: string, path: string, body?: unknown, timeoutMs = FETCH_TIMEOUT_MS): Promise<any> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${XAI_API_KEY}`,
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
          `[batch] xAI ${res.status} on ${method} ${path}, attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay / 1000}s...`
        );
        await sleep(delay);
        continue;
      }
      throw new Error(`xAI ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        if (attempt < MAX_RETRIES) {
          const delay = BACKOFF_BASE_MS * Math.pow(3, attempt - 1);
          console.warn(
            `[batch] Timeout on ${method} ${path}, attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay / 1000}s...`
          );
          await sleep(delay);
          continue;
        }
        throw new Error(`xAI ${method} ${path} timed out after ${MAX_RETRIES} attempts`);
      }
      throw err;
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { batchId: resumeBatchId, skip, pollOnly, importBatchId, limit, dryRun } = parseArgs();

  const { db } = await import("../src/lib/db");
  const { contracts } = await import("../src/lib/db/schema");
  const { eq, and, sql } = await import("drizzle-orm");
  const { buildUnifiedClassificationPrompt } = await import(
    "../src/lib/ai/prompts"
  );
  const { downloadDocuments } = await import("../src/lib/sam-gov/documents");
  const { extractAllDocumentTexts } = await import("../src/lib/document-text");
  const { isRestrictedSetAside } = await import("../src/lib/sam-gov/set-aside-filter");

  // ── Import-only mode (retry import from completed batch) ────────────
  if (importBatchId) {
    console.log(`[batch] Import-only mode for completed batch: ${importBatchId}`);
    const status = await xai("GET", `/batches/${importBatchId}`);
    const state = status.state ?? {};
    console.log(`[batch] Batch status: ${state.num_success ?? 0} success, ${state.num_error ?? 0} error, ${state.num_pending ?? 0} pending`);
    if ((state.num_pending ?? 0) > 0) {
      console.warn(`[batch] WARNING: ${state.num_pending} requests still pending — importing completed results only`);
    }
    await importResultsWithRetry(importBatchId, db, sql);
    process.exit(0);
  }

  // ── Poll-only mode ────────────────────────────────────────────────────
  if (pollOnly) {
    console.log(`[batch] Poll-only mode for batch: ${pollOnly}`);
    await pollAndImport(pollOnly, db, sql);
    process.exit(0);
  }

  // 1. Query all contracts for Round 4 unified classification
  //    Skip user-overridden contracts to preserve manual reviews
  console.log("[batch] Querying contracts for Round 4 unified classification...");
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
    .where(and(eq(contracts.userOverride, false), eq(contracts.classification, "PENDING")))
    .orderBy(contracts.postedDate);

  const allContracts = limit
    ? await queryBuilder.limit(limit)
    : await queryBuilder;

  if (allContracts.length === 0) {
    console.log("[batch] No contracts to classify.");
    process.exit(0);
  }

  // ── Code pre-filter (free checks before sending to xAI) ─────────────
  const today = new Date();
  let preFilteredDiscard = 0;

  const pending = allContracts.filter((c) => {
    // Expired response deadline
    if (c.responseDeadline && new Date(c.responseDeadline) < today) {
      preFilteredDiscard++;
      return false;
    }
    // Restricted set-aside codes JCL doesn't qualify for (prefix match)
    if (isRestrictedSetAside(c.setAsideCode)) {
      preFilteredDiscard++;
      return false;
    }
    return true;
  });

  console.log(`[batch] Found ${allContracts.length} contracts total`);
  console.log(`[batch] Pre-filtered: ${preFilteredDiscard} auto-DISCARD (expired deadlines + restricted set-asides)`);
  console.log(`[batch] Sending to xAI: ${pending.length} contracts`);

  // Show description coverage stats
  const withDesc = pending.filter((c) => c.descriptionText).length;
  console.log(`[batch] Description coverage: ${withDesc}/${pending.length} contracts have description_text`);

  // ── Dry-run mode ──────────────────────────────────────────────────────
  if (dryRun) {
    console.log("\n[batch] ═══ DRY RUN — Showing generated prompts ═══\n");
    for (let i = 0; i < Math.min(pending.length, 3); i++) {
      const contract = pending[i];

      let docTexts: string[] = [];
      try {
        const docs = await downloadDocuments(contract.resourceLinks);
        docTexts = await extractAllDocumentTexts(docs);
      } catch (err) {
        console.warn(`[batch] Doc extraction failed for ${contract.noticeId}: ${err instanceof Error ? err.message : err}`);
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

      console.log(`──── Contract ${i + 1}: ${contract.noticeId} ────`);
      console.log(`Title: ${contract.title}`);
      console.log(`Has description: ${!!contract.descriptionText} (${contract.descriptionText?.length ?? 0} chars)`);
      console.log(`Documents extracted: ${docTexts.length}`);
      console.log(`Prompt length: ${prompt.length} chars`);
      console.log();
    }
    console.log("[batch] Dry run complete. No API calls made, no DB changes.");
    process.exit(0);
  }

  // 2. Mark pre-filtered contracts as DISCARD in DB
  const { inArray } = await import("drizzle-orm");
  const preFilteredIds = allContracts
    .filter((c) => !pending.includes(c))
    .map((c) => c.id);

  if (preFilteredIds.length > 0) {
    console.log(`[batch] Marking ${preFilteredIds.length} pre-filtered contracts as DISCARD...`);
    for (let i = 0; i < preFilteredIds.length; i += 500) {
      const chunk = preFilteredIds.slice(i, i + 500);
      await db
        .update(contracts)
        .set({
          classification: "DISCARD",
          aiReasoning: "Auto-discarded by code pre-filter (expired deadline or restricted set-aside)",
          classificationRound: 4,
          classifiedFromMetadata: false,
          documentsAnalyzed: true,
          updatedAt: new Date(),
        })
        .where(inArray(contracts.id, chunk));
    }
  }

  if (pending.length === 0) {
    console.log("[batch] All contracts were pre-filtered. Nothing to send to xAI.");
    process.exit(0);
  }

  // 3. Reset remaining contracts to PENDING with classificationRound = 4
  console.log("[batch] Resetting contracts to PENDING for Round 4...");
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
  console.log(`[batch] Reset ${resetIds.length} contracts to PENDING (round 4)`);

  // 4. Create or resume batch
  let batchId: string;
  if (resumeBatchId) {
    batchId = resumeBatchId;
    console.log(`[batch] Resuming batch: ${batchId} (skipping first ${skip} contracts)`);
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const batch = await xai("POST", "/batches", {
      name: `round4-unified-${timestamp}`,
    });
    batchId = batch.id ?? batch.batch_id;
    console.log(`[batch] Created batch: ${batchId}`);
    const batchIdFile = resolve(__dirname, "last-batch-id.txt");
    writeFileSync(batchIdFile, batchId, "utf-8");
    console.log(`[batch] Batch ID saved to ${batchIdFile}`);
  }

  // 5. Extract documents and build prompts
  console.log(`\n[batch] Phase 1: Extracting document texts...`);
  type PreparedContract = { noticeId: string; prompt: string };
  const prepared: PreparedContract[] = [];
  const startIdx = skip > 0 ? skip : 0;

  for (let i = startIdx; i < pending.length; i++) {
    const contract = pending[i];
    const progress = `[${i + 1 - startIdx}/${pending.length - startIdx}]`;

    let docTexts: string[] = [];
    const linkCount = (contract.resourceLinks || []).length;
    if (linkCount > 0) {
      try {
        const docs = await downloadDocuments(contract.resourceLinks);
        docTexts = await extractAllDocumentTexts(docs);
      } catch (err) {
        console.warn(`${progress} ${contract.noticeId}: doc extraction failed (${err instanceof Error ? err.message : err})`);
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
    console.log(`${progress} ${contract.noticeId}: ${docTexts.length} docs, ${prompt.length} chars`);
  }

  console.log(`[batch] Phase 1 complete: ${prepared.length} prompts prepared\n`);

  // 6. Add requests to batch in chunks of 100
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
    console.log(
      `[batch] Added requests ${i + 1}–${Math.min(i + CHUNK_SIZE, prepared.length)} of ${prepared.length}`
    );

    // Throttle between chunk uploads
    if (i + CHUNK_SIZE < prepared.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  // 7. Poll and import results
  await pollAndImport(batchId, db, sql);
  process.exit(0);
}

// ── Poll + Import ──────────────────────────────────────────────────────────

async function pollAndImport(
  batchId: string,
  db: any,
  sql: any,
) {
  // Poll until done
  console.log("[batch] Polling for completion...");
  let done = false;
  while (!done) {
    await sleep(POLL_INTERVAL_MS);
    const status = await xai("GET", `/batches/${batchId}`);
    const state = status.state ?? {};
    const numPending = state.num_pending ?? 0;
    const numSuccess = state.num_success ?? 0;
    const numError = state.num_error ?? 0;
    const total = state.num_requests ?? 0;

    console.log(
      `[batch] Progress: ${numSuccess} success, ${numError} error, ${numPending} pending (${total} total)`
    );

    if (numPending === 0 && total > 0) {
      done = true;
    }
  }

  await importResultsWithRetry(batchId, db, sql);
}

async function importResultsWithRetry(
  batchId: string,
  db: any,
  sql: any,
) {
  for (let attempt = 1; attempt <= IMPORT_MAX_RETRIES; attempt++) {
    try {
      await importResults(batchId, db, sql);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < IMPORT_MAX_RETRIES) {
        console.error(
          `[batch] Results fetch/import failed (attempt ${attempt}/${IMPORT_MAX_RETRIES}): ${msg}. Retrying in ${IMPORT_RETRY_DELAY_MS / 1000}s...`
        );
        await sleep(IMPORT_RETRY_DELAY_MS);
      } else {
        console.error(`[batch] Results fetch/import failed after ${IMPORT_MAX_RETRIES} attempts: ${msg}`);
        console.error(`[batch] To retry manually:\n  npx tsx scripts/batch-classify.ts --import-batch-id ${batchId}`);
        throw err;
      }
    }
  }
}

// ── Import Results (bulk) ─────────────────────────────────────────────────

type ParsedResult = {
  noticeId: string;
  classification: string;
  reasoning: string;
  summary: string;
  actionPlan: string | null;
};

function extractContent(item: Record<string, unknown>): string | undefined {
  // Shape 1: batch_result.response.chat_get_completion.choices[0].message.content
  const batchResult = (item as any).batch_result?.response?.chat_get_completion;
  if (batchResult?.choices?.[0]?.message?.content) {
    return batchResult.choices[0].message.content;
  }
  // Shape 2: response.choices[0].message.content or response.content
  const response = item.response as Record<string, unknown> | undefined;
  if (response) {
    if (typeof response.content === "string") return response.content;
    const choices = response.choices as { message?: { content?: string } }[] | undefined;
    if (choices?.[0]?.message?.content) return choices[0].message.content;
  }
  return undefined;
}

// Track state across retry attempts
const failedChunks: { chunkIndex: number; rowCount: number; error: string }[] = [];
let lastSuccessfulToken: string | null = null;
let resumeProcessed = 0;
let resumeGood = 0;
let resumeMaybe = 0;
let resumeDiscard = 0;
let resumeErrors = 0;
let resumePageNum = 0;
let resumeDbChunksSent = 0;

async function bulkUpdateContracts(
  db: any,
  sql: any,
  rows: ParsedResult[],
  chunkOffset: number,
) {
  if (rows.length === 0) return;

  // Build VALUES list for UPDATE ... FROM (VALUES ...) pattern
  // This does 1 round trip per chunk instead of N individual UPDATEs
  for (let i = 0; i < rows.length; i += DB_CHUNK_SIZE) {
    const chunkIndex = chunkOffset + Math.floor(i / DB_CHUNK_SIZE);
    const chunk = rows.slice(i, i + DB_CHUNK_SIZE);
    const values = chunk
      .map(
        (r) =>
          `(${escapeLiteral(r.noticeId)}, ${escapeLiteral(r.classification)}, ${escapeLiteral(r.reasoning)}, ${escapeLiteral(r.summary)}, ${escapeLiteral(r.actionPlan)})`
      )
      .join(",\n");

    for (let attempt = 1; attempt <= DB_CHUNK_MAX_RETRIES; attempt++) {
      try {
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
        `);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < DB_CHUNK_MAX_RETRIES) {
          const delay = DB_CHUNK_RETRY_DELAY_MS * attempt;
          console.error(
            `[batch] DB import failed at chunk ${chunkIndex + 1} (${chunk.length} rows): ${msg}. Retrying in ${delay / 1000}s...`
          );
          await sleep(delay);
        } else {
          console.error(
            `[batch] DB import permanently failed at chunk ${chunkIndex + 1} (${chunk.length} rows) after ${DB_CHUNK_MAX_RETRIES} attempts: ${msg}. Skipping.`
          );
          failedChunks.push({ chunkIndex: chunkIndex + 1, rowCount: chunk.length, error: msg });
        }
      }
    }
  }
}

function escapeLiteral(val: string | null | undefined): string {
  if (val == null) return "NULL";
  // Escape single quotes by doubling them, then wrap in quotes
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function importResults(
  batchId: string,
  db: any,
  sql: any,
) {
  // Resume from last successful page if retrying
  const resuming = lastSuccessfulToken !== null;
  failedChunks.length = 0; // Always clear — retries re-process failed chunks
  if (resuming) {
    console.log(`[batch] Resuming import from page ${resumePageNum + 1} (${resumeProcessed} already imported)...`);
  } else {
    console.log("[batch] Fetching and importing results...");
  }

  let good = resuming ? resumeGood : 0;
  let maybe = resuming ? resumeMaybe : 0;
  let discard = resuming ? resumeDiscard : 0;
  let errors = resuming ? resumeErrors : 0;
  let processed = resuming ? resumeProcessed : 0;
  let pageNum = resuming ? resumePageNum : 0;
  let dbChunksSent = resuming ? resumeDbChunksSent : 0;
  let paginationToken: string | null = resuming ? lastSuccessfulToken : null;

  // Buffer parsed results for bulk DB writes
  let buffer: ParsedResult[] = [];

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

    // Parse succeeded results — unified response: { classification, reasoning, summary, actionPlan }
    const succeeded: unknown[] = page.succeeded ?? page.results ?? [];
    for (const item of succeeded as Record<string, unknown>[]) {
      const noticeId = item.batch_request_id as string;
      try {
        const content = extractContent(item);
        if (!content) {
          errors++;
          console.error(`[batch] Empty response for ${noticeId}`);
          continue;
        }

        const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const parsed = JSON.parse(cleaned);

        const classification = parsed.classification?.toUpperCase();
        if (!["GOOD", "MAYBE", "DISCARD"].includes(classification)) {
          errors++;
          console.error(`[batch] Invalid classification "${parsed.classification}" for ${noticeId}`);
          continue;
        }

        buffer.push({
          noticeId,
          classification,
          reasoning: parsed.reasoning ?? "",
          summary: parsed.summary ?? "",
          actionPlan: parsed.actionPlan ? JSON.stringify(parsed.actionPlan) : null,
        });
        processed++;
        if (classification === "GOOD") good++;
        else if (classification === "MAYBE") maybe++;
        else discard++;
      } catch (err) {
        errors++;
        console.error(
          `[batch] Error parsing result for ${noticeId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    // Count failed results
    const failed: unknown[] = page.failed ?? [];
    for (const item of failed as Record<string, unknown>[]) {
      errors++;
      const noticeId = (item as Record<string, unknown>).batch_request_id as string;
      const errMsg = (item as Record<string, unknown>).error_message ?? "unknown error";
      console.error(`[batch] Failed request ${noticeId}: ${errMsg}`);
    }

    // Flush buffer to DB when it hits DB_CHUNK_SIZE
    if (buffer.length >= DB_CHUNK_SIZE) {
      await bulkUpdateContracts(db, sql, buffer, dbChunksSent);
      dbChunksSent += Math.ceil(buffer.length / DB_CHUNK_SIZE);
      buffer = [];
    }

    console.log(
      `[batch] Fetched page ${pageNum}: ${processed} parsed, ${errors} errors (${good} GOOD, ${maybe} MAYBE, ${discard} DISCARD)`
    );

    // Save checkpoint so retries resume from here
    paginationToken = page.pagination_token ?? null;
    lastSuccessfulToken = paginationToken;
    resumeProcessed = processed;
    resumeGood = good;
    resumeMaybe = maybe;
    resumeDiscard = discard;
    resumeErrors = errors;
    resumePageNum = pageNum;
    resumeDbChunksSent = dbChunksSent;
  } while (paginationToken);

  // Flush remaining buffer
  if (buffer.length > 0) {
    await bulkUpdateContracts(db, sql, buffer, dbChunksSent);
    dbChunksSent += Math.ceil(buffer.length / DB_CHUNK_SIZE);
  }

  // Report failed chunks
  if (failedChunks.length > 0) {
    console.error(`\n[batch] ⚠ ${failedChunks.length} DB chunk(s) failed permanently:`);
    for (const fc of failedChunks) {
      console.error(`  Chunk ${fc.chunkIndex}: ${fc.rowCount} rows — ${fc.error}`);
    }
    console.error(`[batch] These contracts were NOT updated. Re-run with --import-batch-id to retry.`);
  }

  // Clear checkpoint on success
  lastSuccessfulToken = null;
  resumeProcessed = 0;
  resumeGood = 0;
  resumeMaybe = 0;
  resumeDiscard = 0;
  resumeErrors = 0;
  resumePageNum = 0;
  resumeDbChunksSent = 0;

  const skippedRows = failedChunks.reduce((sum, fc) => sum + fc.rowCount, 0);
  console.log(`[batch] DB import complete: ${processed - skippedRows} rows written, ${skippedRows} skipped`);

  // Final stats
  const finalStatus = await xai("GET", `/batches/${batchId}`);
  const costTicks =
    finalStatus.cost_breakdown?.total_cost_usd_ticks ?? 0;
  const costUsd = costTicks / 1e10;

  console.log("\n[batch] ═══ Round 4 Unified Classification Complete ═══");
  console.log(`  Total classified: ${processed}`);
  console.log(`  GOOD:    ${good}`);
  console.log(`  MAYBE:   ${maybe}`);
  console.log(`  DISCARD: ${discard}`);
  console.log(`  Errors:  ${errors}`);
  console.log(`  Cost:    $${costUsd.toFixed(4)}`);
  console.log(`  Batch:   ${batchId}`);
}

main().catch((err) => {
  console.error("[batch] Fatal error:", err);
  process.exit(1);
});
