/**
 * Test crawl: one SAM.gov API call (limit=1000, offset=0)
 * - Logs totalRecords and count of noticeIds returned
 * - Upserts contracts to DB (skips duplicates)
 *
 * Usage: npx tsx --import ./scripts/load-env.ts scripts/test-crawl.ts
 */

// Force DRY_RUN off for this script
process.env.SAM_DRY_RUN = "false";

import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { searchOpportunities, formatSamDate } from "@/lib/sam-gov/client";
import { mapOpportunityToContract } from "@/lib/sam-gov/mappers";

async function main() {
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  console.log(`Searching SAM.gov: ${formatSamDate(sixMonthsAgo)} → ${formatSamDate(now)}`);
  console.log("ptype=o,k,p,r | active=Yes | limit=1000 | offset=0\n");

  const response = await searchOpportunities({
    ptype: "o,k,p,r",
    postedFrom: formatSamDate(sixMonthsAgo),
    postedTo: formatSamDate(now),
    active: "Yes",
    limit: 1000,
    offset: 0,
  });

  const opportunities = response.opportunitiesData ?? [];

  console.log(`totalRecords reported by API: ${response.totalRecords}`);
  console.log(`Opportunities returned in this page: ${opportunities.length}`);

  if (opportunities.length === 0) {
    console.log("No opportunities returned. Exiting.");
    process.exit(0);
  }

  // Log first 5 noticeIds as a sample
  console.log("\nSample noticeIds:");
  for (const opp of opportunities.slice(0, 5)) {
    console.log(`  ${opp.noticeId} — ${opp.title?.slice(0, 80)}`);
  }

  // Upsert to DB
  console.log(`\nInserting ${opportunities.length} contracts (skipping duplicates)...`);
  let newCount = 0;
  let skipped = 0;
  let errors = 0;

  for (const opp of opportunities) {
    try {
      const row = mapOpportunityToContract(opp);
      const result = await db
        .insert(contracts)
        .values(row)
        .onConflictDoNothing({ target: contracts.noticeId })
        .returning({ id: contracts.id });

      if (result.length > 0) newCount++;
      else skipped++;
    } catch (err) {
      errors++;
      console.error(`  Error inserting ${opp.noticeId}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone! New: ${newCount} | Skipped (duplicates): ${skipped} | Errors: ${errors}`);
  console.log(`Total pages needed: ${Math.ceil(response.totalRecords / 1000)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
