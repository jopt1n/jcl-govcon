import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  // Count non-overridden contracts
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(contracts).where(eq(contracts.userOverride, false));
  console.log(`Total non-overridden: ${total.count}`);

  // Count with future deadline or no deadline
  const [future] = await db.select({ count: sql<number>`count(*)` }).from(contracts).where(sql`user_override = false AND (response_deadline IS NULL OR response_deadline > NOW())`);
  console.log(`Future/null deadline: ${future.count}`);

  // Count with restricted set-asides
  const [restricted] = await db.select({ count: sql<number>`count(*)` }).from(contracts).where(sql`user_override = false AND set_aside_code IN ('8A', 'SDVOSB', 'HZ', 'WOSB', 'EDWOSB')`);
  console.log(`Restricted set-aside: ${restricted.count}`);

  // Count that pass BOTH filters
  const [eligible] = await db.select({ count: sql<number>`count(*)` }).from(contracts).where(sql`user_override = false AND (response_deadline IS NULL OR response_deadline > NOW()) AND (set_aside_code IS NULL OR set_aside_code NOT IN ('8A', 'SDVOSB', 'HZ', 'WOSB', 'EDWOSB'))`);
  console.log(`Pass both filters (eligible for xAI): ${eligible.count}`);

  // Show a few eligible ones
  const sample = await db
    .select({ id: contracts.id, title: contracts.title, responseDeadline: contracts.responseDeadline, setAsideCode: contracts.setAsideCode })
    .from(contracts)
    .where(sql`user_override = false AND (response_deadline IS NULL OR response_deadline > NOW()) AND (set_aside_code IS NULL OR set_aside_code NOT IN ('8A', 'SDVOSB', 'HZ', 'WOSB', 'EDWOSB'))`)
    .limit(5);

  console.log("\nSample eligible:");
  for (const r of sample) {
    console.log(`  ${r.id} | deadline=${r.responseDeadline} | setAside=${r.setAsideCode} | ${r.title.slice(0, 60)}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
