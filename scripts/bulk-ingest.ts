/**
 * Bulk ingest: paginate through ALL SAM.gov search results (ptype=o,k only)
 * - Solicitations + Combined Synopsis/Solicitation (biddable types)
 * - Batch upserts 1000 contracts per page
 * - 10-second delay between API calls
 * - Retry with 60s backoff on 429 rate limit responses
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/bulk-ingest.ts
 *   npx tsx --import ./scripts/load-env.ts scripts/bulk-ingest.ts --offset 10000
 */

process.env.SAM_DRY_RUN = "false";

import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { searchOpportunities, formatSamDate } from "@/lib/sam-gov/client";
import { mapOpportunityToContract } from "@/lib/sam-gov/mappers";
import type { SamSearchResponse } from "@/lib/sam-gov/types";

const LIMIT = 1000;
const DELAY_MS = 10_000;
const DAILY_BUDGET = 950;
const RETRY_DELAY_MS = 60_000;
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOffset(): number {
  const idx = process.argv.indexOf("--offset");
  if (idx !== -1 && process.argv[idx + 1]) {
    const val = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(val) && val >= 0) return val;
  }
  return 0;
}

async function searchWithRetry(params: Parameters<typeof searchOpportunities>[0]): Promise<SamSearchResponse> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await searchOpportunities(params);
    } catch (err) {
      const is429 = err instanceof Error && err.message.includes("429");
      if (is429 && attempt < MAX_RETRIES) {
        console.log(`  ⏳ Rate limited (429). Waiting ${RETRY_DELAY_MS / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
        await sleep(RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
  throw new Error("Unreachable");
}

async function main() {
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const postedFrom = formatSamDate(sixMonthsAgo);
  const postedTo = formatSamDate(now);
  const startOffset = parseOffset();

  console.log(`SAM.gov bulk ingest: ${postedFrom} → ${postedTo}`);
  console.log("ptype=o,k (Solicitations + Combined Synopsis only)");
  if (startOffset > 0) console.log(`Resuming from offset ${startOffset}`);
  console.log();

  let offset = startOffset;
  let totalRecords = 0;
  let cumulativeNew = 0;
  let cumulativeSkipped = 0;
  let cumulativeErrors = 0;
  let apiCalls = 0;

  do {
    const page = Math.floor(offset / LIMIT) + 1;
    apiCalls++;

    console.log(`--- Page ${page} (offset=${offset}) | API call ${apiCalls}/${DAILY_BUDGET} ---`);

    const response = await searchWithRetry({
      ptype: "o,k",
      postedFrom,
      postedTo,
      active: "Yes",
      limit: LIMIT,
      offset,
    });

    totalRecords = response.totalRecords;
    const opportunities = response.opportunitiesData ?? [];

    if (apiCalls === 1) {
      console.log(`Total records available: ${totalRecords}`);
      const pagesRemaining = Math.ceil((totalRecords - offset) / LIMIT);
      console.log(`Pages remaining: ${pagesRemaining}\n`);
    }

    if (opportunities.length === 0) {
      console.log("No more opportunities returned. Done.");
      break;
    }

    // Batch insert all contracts from this page
    const rows = opportunities.map(mapOpportunityToContract);
    let pageNew = 0;
    let pageSkipped = 0;
    let pageErrors = 0;

    try {
      const result = await db
        .insert(contracts)
        .values(rows)
        .onConflictDoNothing({ target: contracts.noticeId })
        .returning({ id: contracts.id });

      pageNew = result.length;
      pageSkipped = rows.length - pageNew;
    } catch {
      // If batch fails, fall back to one-by-one to skip bad rows
      console.log("  Batch insert failed, falling back to individual inserts...");
      for (const row of rows) {
        try {
          const result = await db
            .insert(contracts)
            .values(row)
            .onConflictDoNothing({ target: contracts.noticeId })
            .returning({ id: contracts.id });

          if (result.length > 0) pageNew++;
          else pageSkipped++;
        } catch {
          pageErrors++;
        }
      }
    }

    cumulativeNew += pageNew;
    cumulativeSkipped += pageSkipped;
    cumulativeErrors += pageErrors;

    console.log(
      `  Page ${page}: +${pageNew} new, ${pageSkipped} skipped, ${pageErrors} errors | ` +
      `Cumulative: ${cumulativeNew} new, ${cumulativeSkipped} skipped | ` +
      `API calls left: ${DAILY_BUDGET - apiCalls}`
    );

    offset += LIMIT;

    // Delay between calls if there are more pages
    if (offset < totalRecords) {
      console.log(`  Waiting ${DELAY_MS / 1000}s...`);
      await sleep(DELAY_MS);
    }
  } while (offset < totalRecords);

  console.log("\n=== BULK INGEST COMPLETE ===");
  console.log(`Total API calls used: ${apiCalls}`);
  console.log(`New contracts inserted: ${cumulativeNew}`);
  console.log(`Duplicates skipped: ${cumulativeSkipped}`);
  console.log(`Errors: ${cumulativeErrors}`);
  console.log(`Total records on SAM.gov: ${totalRecords}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
