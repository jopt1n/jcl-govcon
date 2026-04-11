import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql, inArray } from "drizzle-orm";

async function main() {
  const rows = await db.select({
    classification: contracts.classification,
    title: contracts.title,
    setAsideCode: contracts.setAsideCode,
    setAsideType: contracts.setAsideType,
    noticeId: contracts.noticeId,
  }).from(contracts)
    .where(inArray(contracts.classification, ["GOOD", "MAYBE"]))
    .orderBy(contracts.classification);

  console.log("=== GOOD/MAYBE CONTRACTS — SET-ASIDE INFO ===\n");
  for (const r of rows) {
    console.log(`  [${r.classification}] ${r.title}`);
    console.log(`    set_aside_code: ${r.setAsideCode ?? "null"}  |  set_aside_type: ${r.setAsideType ?? "null"}`);
    console.log();
  }

  process.exit(0);
}
main().catch(console.error);
