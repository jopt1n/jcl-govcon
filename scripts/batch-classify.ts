/**
 * Batch classification via xAI Batch API (50% cheaper, no rate limits).
 *
 * Usage:
 *   npx tsx scripts/batch-classify.ts
 *   npx tsx scripts/batch-classify.ts --batch-id <id> --skip 8600
 *   npx tsx scripts/batch-classify.ts --poll-only <batchId>
 */

import { readFileSync } from "fs";
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

// ── CLI args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let batchId: string | null = null;
  let skip = 0;
  let pollOnly: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch-id" && args[i + 1]) {
      batchId = args[++i];
    } else if (args[i] === "--skip" && args[i + 1]) {
      skip = parseInt(args[++i], 10);
    } else if (args[i] === "--poll-only" && args[i + 1]) {
      pollOnly = args[++i];
    }
  }

  return { batchId, skip, pollOnly };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function xai(method: string, path: string, body?: unknown): Promise<any> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${XAI_API_KEY}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
  const { batchId: resumeBatchId, skip, pollOnly } = parseArgs();

  const { db } = await import("../src/lib/db");
  const { contracts } = await import("../src/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const { buildMetadataClassificationPrompt } = await import(
    "../src/lib/ai/prompts"
  );
  const { parseClassificationResponse } = await import(
    "../src/lib/ai/classifier"
  );

  // ── Poll-only mode ────────────────────────────────────────────────────
  if (pollOnly) {
    console.log(`[batch] Poll-only mode for batch: ${pollOnly}`);
    await pollAndImport(pollOnly, db, contracts, eq, parseClassificationResponse);
    process.exit(0);
  }

  // 1. Query all PENDING contracts not yet metadata-classified
  console.log("[batch] Querying PENDING contracts...");
  const pending = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      title: contracts.title,
      naicsCode: contracts.naicsCode,
      pscCode: contracts.pscCode,
      agency: contracts.agency,
      orgPathName: contracts.orgPathName,
      noticeType: contracts.noticeType,
      setAsideType: contracts.setAsideType,
      setAsideCode: contracts.setAsideCode,
      popState: contracts.popState,
      awardCeiling: contracts.awardCeiling,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "PENDING"),
        eq(contracts.classifiedFromMetadata, false)
      )
    )
    .orderBy(contracts.postedDate);

  if (pending.length === 0) {
    console.log("[batch] No pending contracts to classify.");
    process.exit(0);
  }
  console.log(`[batch] Found ${pending.length} contracts to classify`);

  // Build a lookup map: noticeId → contract
  const contractMap = new Map(pending.map((c) => [c.noticeId, c]));

  // 2. Create or resume batch
  let batchId: string;
  if (resumeBatchId) {
    batchId = resumeBatchId;
    console.log(`[batch] Resuming batch: ${batchId} (skipping first ${skip} contracts)`);
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const batch = await xai("POST", "/batches", {
      name: `metadata-classification-${timestamp}`,
    });
    batchId = batch.id ?? batch.batch_id;
    console.log(`[batch] Created batch: ${batchId}`);
  }

  // 3-4. Add requests in chunks of 100
  const startIdx = skip > 0 ? skip : 0;
  for (let i = startIdx; i < pending.length; i += CHUNK_SIZE) {
    const chunk = pending.slice(i, i + CHUNK_SIZE);
    const batchRequests = chunk.map((contract) => {
      const prompt = buildMetadataClassificationPrompt({
        title: contract.title,
        naicsCode: contract.naicsCode,
        pscCode: contract.pscCode,
        agency: contract.agency,
        orgPathName: contract.orgPathName,
        noticeType: contract.noticeType,
        setAsideType: contract.setAsideType,
        setAsideCode: contract.setAsideCode,
        popState: contract.popState,
        awardCeiling: contract.awardCeiling,
      });

      return {
        batch_request_id: contract.noticeId,
        batch_request: {
          chat_get_completion: {
            messages: [{ role: "user", content: prompt }],
            model: MODEL,
          },
        },
      };
    });

    await xai("POST", `/batches/${batchId}/requests`, {
      batch_requests: batchRequests,
    });
    console.log(
      `[batch] Added requests ${i + 1}–${Math.min(i + CHUNK_SIZE, pending.length)} of ${pending.length}`
    );

    // Throttle between chunk uploads
    if (i + CHUNK_SIZE < pending.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  // 5-7. Poll and import results
  await pollAndImport(batchId, db, contracts, eq, parseClassificationResponse, contractMap);
  process.exit(0);
}

// ── Poll + Import ──────────────────────────────────────────────────────────

async function pollAndImport(
  batchId: string,
  db: any,
  contracts: any,
  eq: any,
  parseClassificationResponse: any,
  contractMap?: Map<string, any>
) {
  // 5. Poll until done
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

  // 6. Paginate through results and update DB
  console.log("[batch] Fetching results...");
  let good = 0;
  let maybe = 0;
  let discard = 0;
  let errors = 0;
  let processed = 0;
  let paginationToken: string | null = null;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (paginationToken) params.set("pagination_token", paginationToken);

    const page = await xai(
      "GET",
      `/batches/${batchId}/results?${params.toString()}`
    );

    // Process succeeded results
    const succeeded: unknown[] = page.succeeded ?? page.results ?? [];
    for (const item of succeeded as Record<string, unknown>[]) {
      const noticeId = item.batch_request_id as string;

      // If we have a contractMap, use it for id-based lookup; otherwise query by noticeId
      const contract = contractMap?.get(noticeId);

      try {
        // Handle both possible response shapes
        const response = item.response as Record<string, unknown> | undefined;
        const batchResult = (item as any).batch_result?.response?.chat_get_completion;
        let content: string | undefined;

        if (batchResult?.choices?.[0]?.message?.content) {
          content = batchResult.choices[0].message.content;
        } else if (response) {
          if (typeof response.content === "string") {
            content = response.content;
          }
          const choices = response.choices as
            | { message?: { content?: string } }[]
            | undefined;
          if (!content && choices?.[0]?.message?.content) {
            content = choices[0].message.content;
          }
        }

        const result = parseClassificationResponse(content);

        if (contract) {
          await db
            .update(contracts)
            .set({
              classification: result.classification,
              aiReasoning: result.reasoning,
              summary: result.summary,
              classifiedFromMetadata: true,
              updatedAt: new Date(),
            })
            .where(eq(contracts.id, contract.id));
        } else {
          // Poll-only mode: update by noticeId
          await db
            .update(contracts)
            .set({
              classification: result.classification,
              aiReasoning: result.reasoning,
              summary: result.summary,
              classifiedFromMetadata: true,
              updatedAt: new Date(),
            })
            .where(eq(contracts.noticeId, noticeId));
        }

        processed++;
        if (result.classification === "GOOD") good++;
        else if (result.classification === "MAYBE") maybe++;
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
      const noticeId = item.batch_request_id as string;
      const errMsg = item.error_message ?? "unknown error";
      console.error(`[batch] Failed request ${noticeId}: ${errMsg}`);
    }

    paginationToken = page.pagination_token ?? null;
  } while (paginationToken);

  // 7. Final stats
  const finalStatus = await xai("GET", `/batches/${batchId}`);
  const costTicks =
    finalStatus.cost_breakdown?.total_cost_usd_ticks ?? 0;
  const costUsd = costTicks / 1e10;

  console.log("\n[batch] ═══ Classification Complete ═══");
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
