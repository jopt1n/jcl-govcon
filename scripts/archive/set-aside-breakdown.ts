import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";
import { isRestrictedSetAside } from "../src/lib/sam-gov/set-aside-filter";

async function main() {
  const rows = await db
    .select({
      setAsideCode: contracts.setAsideCode,
      setAsideType: contracts.setAsideType,
      count: sql<number>`count(*)`,
    })
    .from(contracts)
    .groupBy(contracts.setAsideCode, contracts.setAsideType)
    .orderBy(sql`count(*) desc`);

  let qualifyCount = 0;
  let restrictedCount = 0;
  const qualifyRows: typeof rows = [];
  const restrictedRows: typeof rows = [];

  for (const row of rows) {
    const restricted = isRestrictedSetAside(row.setAsideCode);
    if (restricted) {
      restrictedCount += Number(row.count);
      restrictedRows.push(row);
    } else {
      qualifyCount += Number(row.count);
      qualifyRows.push(row);
    }
  }

  const total = qualifyCount + restrictedCount;

  console.log("=== SET-ASIDE BREAKDOWN ===\n");

  console.log("RESTRICTED (cannot bid):");
  console.log("-".repeat(70));
  for (const r of restrictedRows) {
    console.log(`  ${String(r.count).padStart(5)}  ${(r.setAsideCode ?? "null").padEnd(12)} ${r.setAsideType ?? ""}`);
  }
  console.log(`  ${String(restrictedCount).padStart(5)}  TOTAL RESTRICTED\n`);

  console.log("ELIGIBLE (can bid):");
  console.log("-".repeat(70));
  for (const r of qualifyRows) {
    console.log(`  ${String(r.count).padStart(5)}  ${(r.setAsideCode ?? "null").padEnd(12)} ${r.setAsideType ?? ""}`);
  }
  console.log(`  ${String(qualifyCount).padStart(5)}  TOTAL ELIGIBLE\n`);

  console.log("=== SUMMARY ===");
  console.log(`  Eligible:    ${qualifyCount.toLocaleString().padStart(6)}  (${((qualifyCount / total) * 100).toFixed(1)}%)`);
  console.log(`  Restricted:  ${restrictedCount.toLocaleString().padStart(6)}  (${((restrictedCount / total) * 100).toFixed(1)}%)`);
  console.log(`  Total:       ${total.toLocaleString().padStart(6)}`);

  process.exit(0);
}

main().catch(console.error);
