import { runBulkCrawl } from "../src/lib/sam-gov/bulk-crawl";
import { formatSamDate } from "../src/lib/sam-gov/client";

async function main() {
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  console.log(`Window 2: ${formatSamDate(sixMonthsAgo)} → ${formatSamDate(now)}`);
  const result = await runBulkCrawl(sixMonthsAgo, now);

  console.log("\n=== WINDOW 2 COMPLETE ===");
  console.log(`Status: ${result.status}`);
  console.log(`Total found: ${result.totalFound}`);
  console.log(`Processed: ${result.processed}`);
  console.log(`New/updated: ${result.newInserted}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Pages: ${result.pagesProcessed}`);
  process.exit(0);
}

main().catch((err) => { console.error("Failed:", err); process.exit(1); });
