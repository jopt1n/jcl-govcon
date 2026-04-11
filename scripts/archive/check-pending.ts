import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  // The 332 PENDING are contracts that were reset to PENDING (step 3 of batch-classify)
  // but never got results imported (they were in the stuck 400)
  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`classification = 'PENDING' AND classification_round = 4`);
  console.log(`PENDING with round=4: ${pending.count}`);
  console.log(`These are the ~400 that xAI never processed (stuck batch requests).`);
  console.log();

  // Check: are these the ones that were reset but never got a response?
  const [pendingWithDesc] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`classification = 'PENDING' AND classification_round = 4 AND description_text IS NOT NULL`);
  const [pendingWithLinks] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`classification = 'PENDING' AND classification_round = 4 AND resource_links IS NOT NULL AND jsonb_array_length(resource_links) > 0`);
  console.log(`  With descriptionText: ${pendingWithDesc.count}`);
  console.log(`  With resourceLinks: ${pendingWithLinks.count}`);

  // Summary of what needs to happen
  console.log();
  console.log(`SUMMARY:`);
  console.log(`  1,014 total contracts in DB (expired purged)`);
  console.log(`  770 imported from xAI batch (14 GOOD, 19 MAYBE, 649 DISCARD + some reclassified by test scripts)`);
  console.log(`  332 PENDING — need to be resubmitted to xAI`);
  console.log(`  Before resubmitting: crawl SAM.gov for new contracts, then batch everything`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
