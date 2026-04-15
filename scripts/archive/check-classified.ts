import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql, ne } from "drizzle-orm";

async function main() {
  const rows = await db.select({
    classification: contracts.classification,
    round: contracts.classificationRound,
    count: sql<number>`count(*)`,
  }).from(contracts)
    .groupBy(contracts.classification, contracts.classificationRound)
    .orderBy(contracts.classification, contracts.classificationRound);

  console.log("=== CLASSIFICATION × ROUND ===");
  for (const r of rows) {
    console.log(`  ${String(r.count).padStart(6)}  ${(r.classification ?? "null").padEnd(10)} round=${r.round ?? "null"}`);
  }

  const oldClassified = await db.select({
    classification: contracts.classification,
    expired: sql<number>`count(*) filter (where response_deadline < now())`,
    active: sql<number>`count(*) filter (where response_deadline >= now() or response_deadline is null)`,
  }).from(contracts)
    .where(ne(contracts.classification, "PENDING"))
    .groupBy(contracts.classification);

  console.log("\n=== NON-PENDING: EXPIRED vs ACTIVE ===");
  for (const r of oldClassified) {
    console.log(`  ${r.classification}: ${r.expired} expired, ${r.active} still active`);
  }

  process.exit(0);
}
main().catch(console.error);
