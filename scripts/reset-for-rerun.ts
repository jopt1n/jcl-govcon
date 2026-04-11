import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql, inArray } from "drizzle-orm";

async function main() {
  // Reset GOOD/MAYBE back to PENDING
  const result = await db.update(contracts)
    .set({ classification: "PENDING", classificationRound: 0, updatedAt: new Date() })
    .where(inArray(contracts.classification, ["GOOD", "MAYBE"]))
    .returning({ id: contracts.id });

  console.log(`Reset ${result.length} GOOD/MAYBE contracts back to PENDING`);

  // Count current state
  const counts = await db.select({
    classification: contracts.classification,
    count: sql<number>`count(*)`,
  }).from(contracts).groupBy(contracts.classification).orderBy(sql`count(*) desc`);

  console.log("\nCurrent state:");
  for (const r of counts) console.log(`  ${String(r.count).padStart(6)}  ${r.classification}`);

  process.exit(0);
}
main().catch(console.error);
