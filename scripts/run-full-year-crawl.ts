/**
 * Full Year Crawl — fetches all active SAM.gov opportunities from the past 12 months.
 * Splits into two 6-month windows (SAM.gov max date range).
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/run-full-year-crawl.ts
 */

import { runFullYearCrawl } from "../src/lib/sam-gov/bulk-crawl";

async function main() {
  console.log("Starting full-year SAM.gov crawl...\n");

  const result = await runFullYearCrawl();

  console.log("\n=== CRAWL COMPLETE ===");
  console.log(`Status: ${result.status}`);
  console.log(`Total found: ${result.totalFound}`);
  console.log(`Processed: ${result.processed}`);
  console.log(`New/updated: ${result.newInserted}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Pages: ${result.pagesProcessed}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Crawl failed:", err);
  process.exit(1);
});
