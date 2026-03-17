/**
 * Import results from a completed xAI batch into the DB.
 * Retries on transient errors and skips already-classified contracts.
 *
 * Usage: npx tsx scripts/import-batch-results.ts <batchId>
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load env
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

const BATCH_ID = process.argv[2];
if (!BATCH_ID) {
  console.error("Usage: npx tsx scripts/import-batch-results.ts <batchId>");
  process.exit(1);
}

const BASE_URL = "https://api.x.ai/v1";
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 5_000;
const FETCH_TIMEOUT_MS = 60_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function xai(path: string): Promise<any> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${XAI_API_KEY}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.ok) return res.json();

      const text = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const delay = BACKOFF_BASE_MS * attempt;
        console.warn(
          `[import] xAI ${res.status} on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay / 1000}s...`
        );
        await sleep(delay);
        continue;
      }
      throw new Error(`xAI GET ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        if (attempt < MAX_RETRIES) {
          const delay = BACKOFF_BASE_MS * attempt;
          console.warn(
            `[import] Timeout on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay / 1000}s...`
          );
          await sleep(delay);
          continue;
        }
        throw new Error(`xAI GET ${path} timed out after ${MAX_RETRIES} attempts`);
      }
      throw err;
    }
  }
}

type Classification = "GOOD" | "MAYBE" | "DISCARD";

interface ParsedResult {
  noticeId: string;
  classification: Classification;
  reasoning: string;
  summary: string | null;
}

function parseResult(item: Record<string, unknown>): ParsedResult | null {
  const noticeId = item.batch_request_id as string;
  try {
    const content = (item as any).batch_result?.response?.chat_get_completion
      ?.choices?.[0]?.message?.content as string | undefined;

    if (!content) {
      console.error(`[import] No content for ${noticeId}`);
      return null;
    }

    const cleaned = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    const classification = parsed.classification?.toUpperCase() as string;
    if (!["GOOD", "MAYBE", "DISCARD"].includes(classification)) {
      console.error(
        `[import] Invalid classification "${parsed.classification}" for ${noticeId}`
      );
      return null;
    }

    return {
      noticeId,
      classification: classification as Classification,
      reasoning: parsed.reasoning ?? "",
      summary: parsed.summary ?? null,
    };
  } catch (err) {
    console.error(
      `[import] Parse error for ${noticeId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { contracts } = await import("../src/lib/db/schema");
  const { eq, and, sql } = await import("drizzle-orm");

  // 1. Check batch status
  const status = await xai(`/batches/${BATCH_ID}`);
  const state = status.state ?? {};
  console.log(
    `[import] Batch status: ${state.num_success ?? 0} success, ${state.num_error ?? 0} error, ${state.num_pending ?? 0} pending (${state.num_requests ?? 0} total)`
  );

  // Build set of already-classified noticeIds so we skip them
  const alreadyClassified = await db
    .select({ noticeId: contracts.noticeId })
    .from(contracts)
    .where(eq(contracts.classifiedFromMetadata, true));
  const classifiedSet = new Set(alreadyClassified.map((c) => c.noticeId));
  console.log(`[import] ${classifiedSet.size} contracts already classified in DB, will skip`);

  // 2. Paginate through results
  const allResults: ParsedResult[] = [];
  let errors = 0;
  let skipped = 0;
  let pages = 0;
  let paginationToken: string | null = null;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (paginationToken) params.set("pagination_token", paginationToken);

    const page = await xai(`/batches/${BATCH_ID}/results?${params}`);
    pages++;

    // Parse succeeded results
    const items: Record<string, unknown>[] = page.results ?? page.succeeded ?? [];
    for (const item of items) {
      const noticeId = item.batch_request_id as string;
      if (classifiedSet.has(noticeId)) {
        skipped++;
        continue;
      }
      const parsed = parseResult(item);
      if (parsed) {
        allResults.push(parsed);
      } else {
        errors++;
      }
    }

    // Count failed
    const failed: Record<string, unknown>[] = page.failed ?? [];
    for (const f of failed) {
      errors++;
      console.error(
        `[import] Failed: ${f.batch_request_id} — ${f.error_message ?? "unknown"}`
      );
    }

    paginationToken = page.pagination_token ?? null;
    console.log(
      `[import] Page ${pages}: ${items.length} results (${allResults.length} new, ${skipped} skipped)`
    );
  } while (paginationToken);

  // 3. Bulk update DB using raw SQL VALUES list (500 per query)
  console.log(`[import] Updating ${allResults.length} contracts in DB...`);
  let updated = 0;
  let good = 0;
  let maybe = 0;
  let discard = 0;

  for (const r of allResults) {
    if (r.classification === "GOOD") good++;
    else if (r.classification === "MAYBE") maybe++;
    else discard++;
  }

  const BATCH = 500;
  for (let i = 0; i < allResults.length; i += BATCH) {
    const chunk = allResults.slice(i, i + BATCH);

    const valuesList = chunk
      .map((r) => {
        const nid = r.noticeId.replace(/'/g, "''");
        const cls = r.classification;
        const reason = r.reasoning.replace(/'/g, "''");
        const summ = r.summary ? r.summary.replace(/'/g, "''") : "";
        return `('${nid}', '${cls}', '${reason}', '${summ}')`;
      })
      .join(",\n  ");

    await db.execute(sql`
      UPDATE contracts SET
        classification = v.classification::classification,
        ai_reasoning = v.reasoning,
        summary = v.summary,
        classified_from_metadata = true,
        updated_at = NOW()
      FROM (VALUES
        ${sql.raw(valuesList)}
      ) AS v(notice_id, classification, reasoning, summary)
      WHERE contracts.notice_id = v.notice_id
    `);

    updated += chunk.length;
    console.log(`[import] Updated ${Math.min(i + BATCH, allResults.length)} of ${allResults.length}`);
  }

  // 4. Check remaining PENDING
  const [remaining] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "PENDING"),
        eq(contracts.classifiedFromMetadata, false)
      )
    );

  // Cost info
  const costTicks = status.cost_breakdown?.total_cost_usd_ticks ?? 0;
  const costUsd = costTicks / 1e10;

  console.log("\n[import] ═══ Import Complete ═══");
  console.log(`  Pages fetched:  ${pages}`);
  console.log(`  Results parsed: ${allResults.length}`);
  console.log(`  Skipped (already classified): ${skipped}`);
  console.log(`  DB updated:     ${updated}`);
  console.log(`  GOOD:           ${good}`);
  console.log(`  MAYBE:          ${maybe}`);
  console.log(`  DISCARD:        ${discard}`);
  console.log(`  Errors:         ${errors}`);
  console.log(`  Cost:           $${costUsd.toFixed(4)}`);
  console.log(`  Still PENDING:  ${remaining.count}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[import] Fatal error:", err);
  process.exit(1);
});
