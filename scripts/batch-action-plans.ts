/**
 * Batch action plan generation via xAI Batch API (50% cheaper).
 *
 * Pre-processes: downloads documents + extracts text for each contract.
 * Then submits all prompts to xAI batch, polls, and imports results.
 *
 * Usage:
 *   npx tsx scripts/batch-action-plans.ts --dry-run --limit 3
 *   npx tsx scripts/batch-action-plans.ts
 *   npx tsx scripts/batch-action-plans.ts --poll-only <batchId>
 *   npx tsx scripts/batch-action-plans.ts --import-batch-id <batchId>
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
  let skip = 0;
  let pollOnly: string | null = null;
  let importBatchId: string | null = null;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skip" && args[i + 1]) {
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

  return { skip, pollOnly, importBatchId, limit, dryRun };
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
        console.warn(`[batch-ap] xAI ${res.status}, attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }
      throw new Error(`xAI ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        if (attempt < MAX_RETRIES) {
          const delay = BACKOFF_BASE_MS * Math.pow(3, attempt - 1);
          console.warn(`[batch-ap] Timeout, attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay / 1000}s...`);
          await sleep(delay);
          continue;
        }
        throw new Error(`xAI ${method} ${path} timed out after ${MAX_RETRIES} attempts`);
      }
      throw err;
    }
  }
}

function escapeLiteral(val: string | null | undefined): string {
  if (val == null) return "NULL";
  return `'${String(val).replace(/'/g, "''")}'`;
}

function extractContent(item: Record<string, unknown>): string | undefined {
  const batchResult = (item as any).batch_result?.response?.chat_get_completion;
  if (batchResult?.choices?.[0]?.message?.content) {
    return batchResult.choices[0].message.content;
  }
  const response = item.response as Record<string, unknown> | undefined;
  if (response) {
    if (typeof response.content === "string") return response.content;
    const choices = response.choices as { message?: { content?: string } }[] | undefined;
    if (choices?.[0]?.message?.content) return choices[0].message.content;
  }
  return undefined;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { skip, pollOnly, importBatchId, limit, dryRun } = parseArgs();

  const { db } = await import("../src/lib/db");
  const { contracts } = await import("../src/lib/db/schema");
  const { sql, and, inArray, isNull } = await import("drizzle-orm");
  const { buildUnifiedClassificationPrompt } = await import("../src/lib/ai/prompts");
  const { downloadDocuments } = await import("../src/lib/sam-gov/documents");
  const { extractAllDocumentTexts } = await import("../src/lib/document-text");

  // ── Import-only mode ────────────────────────────────────────────────
  if (importBatchId) {
    console.log(`[batch-ap] Import-only mode for batch: ${importBatchId}`);
    await importResultsWithRetry(importBatchId, db, sql);
    process.exit(0);
  }

  // ── Poll-only mode ──────────────────────────────────────────────────
  if (pollOnly) {
    console.log(`[batch-ap] Poll-only mode for batch: ${pollOnly}`);
    await pollAndImport(pollOnly, db, sql);
    process.exit(0);
  }

  // ── Full run ────────────────────────────────────────────────────────

  // 1. Find GOOD/MAYBE contracts without action plans
  const rows = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      title: contracts.title,
      agency: contracts.agency,
      naicsCode: contracts.naicsCode,
      pscCode: contracts.pscCode,
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
    .where(
      and(
        inArray(contracts.classification, ["GOOD", "MAYBE"]),
        isNull(contracts.actionPlan)
      )
    )
    .orderBy(contracts.updatedAt);

  const toProcess = limit ? rows.slice(skip, skip + limit) : rows.slice(skip);
  console.log(`\n[batch-ap] ═══ Batch Action Plan Generation ═══`);
  console.log(`  Total needing plans: ${rows.length}`);
  console.log(`  Processing: ${toProcess.length} (skip=${skip}${limit ? `, limit=${limit}` : ""})`);
  console.log(`  Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

  // 2. Pre-process: download documents and extract text for each contract
  console.log(`\n[batch-ap] Phase 1: Extracting document text...`);
  type PreparedContract = {
    noticeId: string;
    prompt: string;
  };
  const prepared: PreparedContract[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    // Download and extract document texts
    let docTexts: string[] = [];
    try {
      const docs = await downloadDocuments(row.resourceLinks);
      docTexts = await extractAllDocumentTexts(docs);
    } catch (err) {
      console.warn(`${progress} ${row.noticeId}: doc extraction failed (${err instanceof Error ? err.message : err})`);
    }

    const deadline = row.responseDeadline;
    const prompt = buildUnifiedClassificationPrompt({
      title: row.title,
      agency: row.agency,
      naicsCode: row.naicsCode,
      pscCode: row.pscCode,
      noticeType: row.noticeType,
      setAsideType: row.setAsideType,
      setAsideCode: row.setAsideCode,
      awardCeiling: row.awardCeiling,
      responseDeadline: deadline instanceof Date ? deadline.toISOString() : deadline ? String(deadline) : null,
      popState: row.popState,
      descriptionText: row.descriptionText,
      documentTexts: docTexts,
    });

    prepared.push({ noticeId: row.noticeId, prompt });
    console.log(`${progress} ${row.noticeId}: ${docTexts.length} docs, ${prompt.length} chars`);

    if (dryRun && i === 0) {
      console.log(`\n--- Sample prompt (first 500 chars) ---\n${prompt.slice(0, 500)}...\n`);
    }
  }

  console.log(`\n[batch-ap] Phase 1 complete: ${prepared.length} prompts prepared`);

  if (dryRun) {
    console.log(`\n[batch-ap] DRY RUN — no batch submitted.`);
    process.exit(0);
  }

  // 3. Create batch
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const batch = await xai("POST", "/batches", {
    name: `action-plans-${timestamp}`,
  });
  const batchId = batch.id ?? batch.batch_id;
  console.log(`\n[batch-ap] Created batch: ${batchId}`);
  const batchIdFile = resolve(__dirname, "last-action-plan-batch-id.txt");
  writeFileSync(batchIdFile, batchId, "utf-8");
  console.log(`[batch-ap] Batch ID saved to ${batchIdFile}`);

  // 4. Add requests in chunks of 100
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
    console.log(`[batch-ap] Added requests ${i + 1}–${Math.min(i + CHUNK_SIZE, prepared.length)} of ${prepared.length}`);

    if (i + CHUNK_SIZE < prepared.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  // 5. Poll and import
  await pollAndImport(batchId, db, sql);
  process.exit(0);
}

// ── Poll + Import ──────────────────────────────────────────────────────────

async function pollAndImport(batchId: string, db: any, sql: any) {
  console.log("[batch-ap] Polling for completion...");
  let done = false;
  while (!done) {
    await sleep(POLL_INTERVAL_MS);
    const status = await xai("GET", `/batches/${batchId}`);
    const state = status.state ?? {};
    const numPending = state.num_pending ?? 0;
    const numSuccess = state.num_success ?? 0;
    const numError = state.num_error ?? 0;
    const total = state.num_requests ?? 0;

    console.log(`[batch-ap] Progress: ${numSuccess} success, ${numError} error, ${numPending} pending (${total} total)`);

    if (numPending === 0 && total > 0) {
      done = true;
    }
  }

  await importResultsWithRetry(batchId, db, sql);
}

async function importResultsWithRetry(batchId: string, db: any, sql: any) {
  for (let attempt = 1; attempt <= IMPORT_MAX_RETRIES; attempt++) {
    try {
      await importResults(batchId, db, sql);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < IMPORT_MAX_RETRIES) {
        console.error(`[batch-ap] Import failed (attempt ${attempt}/${IMPORT_MAX_RETRIES}): ${msg}. Retrying in ${IMPORT_RETRY_DELAY_MS / 1000}s...`);
        await sleep(IMPORT_RETRY_DELAY_MS);
      } else {
        console.error(`[batch-ap] Import failed after ${IMPORT_MAX_RETRIES} attempts: ${msg}`);
        console.error(`[batch-ap] To retry:\n  npx tsx scripts/batch-action-plans.ts --import-batch-id ${batchId}`);
        throw err;
      }
    }
  }
}

// ── Import Results ─────────────────────────────────────────────────────────

type ActionPlanResult = {
  noticeId: string;
  actionPlan: string;
};

const failedChunks: { chunkIndex: number; rowCount: number; error: string }[] = [];
let lastSuccessfulToken: string | null = null;
let resumeProcessed = 0;
let resumeErrors = 0;
let resumePageNum = 0;
let resumeDbChunksSent = 0;
let resumeValid = 0;
let resumeInvalid = 0;

function validateUnifiedResponseShape(parsed: any): boolean {
  if (typeof parsed.classification !== "string" || typeof parsed.reasoning !== "string") {
    return false;
  }
  // DISCARD responses have actionPlan: null — that's valid
  if (parsed.actionPlan === null) return true;
  // GOOD/MAYBE must have valid action plan fields
  const ap = parsed.actionPlan;
  return (
    ap &&
    typeof ap.description === "string" &&
    Array.isArray(ap.implementationSummary) &&
    typeof ap.bidRange === "string" &&
    typeof ap.estimatedEffort === "string" &&
    Array.isArray(ap.compliance) &&
    Array.isArray(ap.risks)
  );
}

async function bulkUpdateActionPlans(db: any, sql: any, rows: ActionPlanResult[], chunkOffset: number) {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += DB_CHUNK_SIZE) {
    const chunkIndex = chunkOffset + Math.floor(i / DB_CHUNK_SIZE);
    const chunk = rows.slice(i, i + DB_CHUNK_SIZE);
    const values = chunk
      .map((r) => `(${escapeLiteral(r.noticeId)}, ${escapeLiteral(r.actionPlan)})`)
      .join(",\n");

    for (let attempt = 1; attempt <= DB_CHUNK_MAX_RETRIES; attempt++) {
      try {
        await db.execute(sql`
          UPDATE contracts SET
            action_plan = v.action_plan,
            updated_at = NOW()
          FROM (VALUES ${sql.raw(values)}) AS v(notice_id, action_plan)
          WHERE contracts.notice_id = v.notice_id
        `);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < DB_CHUNK_MAX_RETRIES) {
          const delay = DB_CHUNK_RETRY_DELAY_MS * attempt;
          console.error(`[batch-ap] DB chunk ${chunkIndex + 1} failed: ${msg}. Retrying in ${delay / 1000}s...`);
          await sleep(delay);
        } else {
          console.error(`[batch-ap] DB chunk ${chunkIndex + 1} permanently failed: ${msg}. Skipping.`);
          failedChunks.push({ chunkIndex: chunkIndex + 1, rowCount: chunk.length, error: msg });
        }
      }
    }
  }
}

async function importResults(batchId: string, db: any, sql: any) {
  const resuming = lastSuccessfulToken !== null;
  failedChunks.length = 0;
  if (resuming) {
    console.log(`[batch-ap] Resuming import from page ${resumePageNum + 1} (${resumeProcessed} already imported)...`);
  } else {
    console.log("[batch-ap] Fetching and importing results...");
  }

  let valid = resuming ? resumeValid : 0;
  let invalid = resuming ? resumeInvalid : 0;
  let errors = resuming ? resumeErrors : 0;
  let processed = resuming ? resumeProcessed : 0;
  let pageNum = resuming ? resumePageNum : 0;
  let dbChunksSent = resuming ? resumeDbChunksSent : 0;
  let paginationToken: string | null = resuming ? lastSuccessfulToken : null;
  let buffer: ActionPlanResult[] = [];

  do {
    pageNum++;
    const params = new URLSearchParams({ page_size: "100" });
    if (paginationToken) params.set("pagination_token", paginationToken);

    const page = await xai("GET", `/batches/${batchId}/results?${params.toString()}`, undefined, RESULTS_FETCH_TIMEOUT_MS);

    const succeeded: unknown[] = page.succeeded ?? page.results ?? [];
    for (const item of succeeded as Record<string, unknown>[]) {
      const noticeId = item.batch_request_id as string;
      try {
        const content = extractContent(item);
        if (!content) { errors++; continue; }

        const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const parsed = JSON.parse(cleaned);

        if (!validateUnifiedResponseShape(parsed)) {
          console.warn(`[batch-ap] Invalid shape for ${noticeId}: ${Object.keys(parsed).join(", ")}`);
          invalid++;
          processed++;
          continue;
        }

        buffer.push({ noticeId, actionPlan: cleaned });
        valid++;
        processed++;
      } catch (err) {
        errors++;
        console.error(`[batch-ap] Parse error for ${noticeId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const failed: unknown[] = page.failed ?? [];
    for (const item of failed as Record<string, unknown>[]) {
      errors++;
      const noticeId = item.batch_request_id as string;
      const errMsg = item.error_message ?? "unknown error";
      console.error(`[batch-ap] Failed: ${noticeId}: ${errMsg}`);
    }

    if (buffer.length >= DB_CHUNK_SIZE) {
      await bulkUpdateActionPlans(db, sql, buffer, dbChunksSent);
      dbChunksSent += Math.ceil(buffer.length / DB_CHUNK_SIZE);
      buffer = [];
    }

    console.log(`[batch-ap] Page ${pageNum}: ${processed} processed, ${valid} valid, ${invalid} invalid shape, ${errors} errors`);

    paginationToken = page.pagination_token ?? null;
    lastSuccessfulToken = paginationToken;
    resumeProcessed = processed;
    resumeValid = valid;
    resumeInvalid = invalid;
    resumeErrors = errors;
    resumePageNum = pageNum;
    resumeDbChunksSent = dbChunksSent;
  } while (paginationToken);

  if (buffer.length > 0) {
    await bulkUpdateActionPlans(db, sql, buffer, dbChunksSent);
  }

  if (failedChunks.length > 0) {
    console.error(`\n[batch-ap] ⚠ ${failedChunks.length} DB chunk(s) failed permanently:`);
    for (const fc of failedChunks) {
      console.error(`  Chunk ${fc.chunkIndex}: ${fc.rowCount} rows — ${fc.error}`);
    }
  }

  lastSuccessfulToken = null;
  resumeProcessed = 0;
  resumeValid = 0;
  resumeInvalid = 0;
  resumeErrors = 0;
  resumePageNum = 0;
  resumeDbChunksSent = 0;

  const finalStatus = await xai("GET", `/batches/${batchId}`);
  const costTicks = finalStatus.cost_breakdown?.total_cost_usd_ticks ?? 0;
  const costUsd = costTicks / 1e10;

  console.log(`\n[batch-ap] ═══ Action Plan Batch Complete ═══`);
  console.log(`  Valid plans:   ${valid}`);
  console.log(`  Invalid shape: ${invalid}`);
  console.log(`  Errors:        ${errors}`);
  console.log(`  Cost:          $${costUsd.toFixed(4)} (50% batch discount)`);
  console.log(`  Batch:         ${batchId}`);
}

main().catch((err) => {
  console.error("[batch-ap] Fatal error:", err);
  process.exit(1);
});
