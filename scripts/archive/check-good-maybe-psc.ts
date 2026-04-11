import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const rows = await db.select({
    classification: contracts.classification,
    title: contracts.title,
    pscCode: contracts.pscCode,
    naicsCode: contracts.naicsCode,
  }).from(contracts)
    .where(inArray(contracts.classification, ["GOOD", "MAYBE"]))
    .orderBy(contracts.classification);

  console.log("=== GOOD/MAYBE — PSC & NAICS ===\n");
  for (const r of rows) {
    const pscPrefix = r.pscCode ? r.pscCode[0] : "?";
    const flag = "12345678".includes(pscPrefix) ? " ⚠ GOODS" : pscPrefix === "Y" || pscPrefix === "Z" ? " ⚠ CONSTRUCTION" : "";
    console.log(`  [${r.classification}] ${r.title}`);
    console.log(`    PSC: ${r.pscCode ?? "null"}  NAICS: ${r.naicsCode ?? "null"}${flag}`);
    console.log();
  }
  process.exit(0);
}
main().catch(console.error);
