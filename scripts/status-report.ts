import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  // 1. Total contracts
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(contracts);
  console.log(`1. TOTAL CONTRACTS: ${total.count}`);
  console.log();

  // 2. Classification round breakdown
  console.log(`2. CLASSIFICATION ROUND BREAKDOWN:`);
  const rounds = await db.execute(sql`
    SELECT classification_round, count(*) as count
    FROM contracts
    GROUP BY classification_round
    ORDER BY classification_round
  `);
  for (const r of rounds) {
    console.log(`   classificationRound = ${r.classification_round}: ${r.count}`);
  }
  console.log();

  // 3. Round 4 breakdown
  console.log(`3. OF THE ROUND 4 CONTRACTS:`);
  const round4 = await db.execute(sql`
    SELECT classification, count(*) as count
    FROM contracts
    WHERE classification_round = 4
    GROUP BY classification
    ORDER BY classification
  `);
  for (const r of round4) {
    console.log(`   ${r.classification}: ${r.count}`);
  }
  console.log();

  // 4. Not yet processed by unified prompt
  console.log(`4. CONTRACTS NOT YET PROCESSED BY UNIFIED PROMPT (classificationRound != 4):`);

  const [notRound4] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`classification_round != 4 OR classification_round IS NULL`);
  console.log(`   Total count: ${notRound4.count}`);

  const [expiredNotR4] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`(classification_round != 4 OR classification_round IS NULL) AND response_deadline IS NOT NULL AND response_deadline < NOW()`);
  console.log(`   Expired response deadlines: ${expiredNotR4.count}`);

  const [restrictedNotR4] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`(classification_round != 4 OR classification_round IS NULL) AND set_aside_code IN ('8A', '8AN', 'SDVOSB', 'HZC', 'WOSB', 'EDWOSB')`);
  console.log(`   Restricted set-aside codes: ${restrictedNotR4.count}`);

  const [activeNotR4] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`(classification_round != 4 OR classification_round IS NULL)
      AND (response_deadline IS NULL OR response_deadline >= NOW())
      AND (set_aside_code IS NULL OR set_aside_code NOT IN ('8A', '8AN', 'SDVOSB', 'HZC', 'WOSB', 'EDWOSB'))`);
  console.log(`   Still active + no restricted set-aside: ${activeNotR4.count}`);

  const [activeWithLinks] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`(classification_round != 4 OR classification_round IS NULL)
      AND (response_deadline IS NULL OR response_deadline >= NOW())
      AND (set_aside_code IS NULL OR set_aside_code NOT IN ('8A', '8AN', 'SDVOSB', 'HZC', 'WOSB', 'EDWOSB'))
      AND resource_links IS NOT NULL AND jsonb_array_length(resource_links) > 0`);
  console.log(`   Of those with resourceLinks: ${activeWithLinks.count}`);

  const [activeWithDesc] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`(classification_round != 4 OR classification_round IS NULL)
      AND (response_deadline IS NULL OR response_deadline >= NOW())
      AND (set_aside_code IS NULL OR set_aside_code NOT IN ('8A', '8AN', 'SDVOSB', 'HZC', 'WOSB', 'EDWOSB'))
      AND description_text IS NOT NULL AND length(description_text) > 0`);
  console.log(`   Of those with descriptionText: ${activeWithDesc.count}`);
  console.log();

  // 5. Batch query analysis
  console.log(`5. WHY DID THE BATCH STOP AT ~1,200?`);
  console.log(`   (See batch-classify.ts query analysis below)`);
  console.log();

  // Check what the batch query selects
  const [batchQueryCount] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`user_override = false`);
  console.log(`   batch-classify.ts WHERE clause: user_override = false`);
  console.log(`   Contracts matching that filter: ${batchQueryCount.count}`);

  // Check user_override = true contracts
  const [overridden] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`user_override = true`);
  console.log(`   Contracts with user_override = true (excluded): ${overridden.count}`);

  // Show classification breakdown of the full eligible set
  const fullBreakdown = await db.execute(sql`
    SELECT classification, count(*) as count
    FROM contracts
    WHERE user_override = false
    GROUP BY classification
    ORDER BY classification
  `);
  console.log(`   Classification breakdown of user_override=false contracts:`);
  for (const r of fullBreakdown) {
    console.log(`     ${r.classification}: ${r.count}`);
  }
  console.log();

  // 6. Errors from batch-results.log
  console.log(`6. ERRORS FROM BATCH LOG:`);
  // Will handle this separately via grep

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
