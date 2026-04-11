import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  // 1. All GOOD and MAYBE contracts with set-aside details
  console.log("1. ALL GOOD AND MAYBE CONTRACTS:");
  console.log();

  const rows = await db.execute(sql`
    SELECT id, title, classification, set_aside_type, set_aside_code
    FROM contracts
    WHERE classification IN ('GOOD', 'MAYBE')
    ORDER BY classification, title
  `);

  const restricted = new Set([
    "8A", "8AN", "SDVOSB", "SDVOSBC", "HZ", "HZC", "HZS",
    "WOSB", "WOSBSS", "EDWOSB", "EDWOSBSS",
    "VSA", "VSB", "IEE", "ISBEE",
  ]);

  for (const r of rows) {
    const code = r.set_aside_code as string | null;
    const flagged = code && restricted.has(code) ? " *** RESTRICTED ***" : "";
    console.log(`  ${r.classification} | ${r.title}`);
    console.log(`    ID: ${r.id}`);
    console.log(`    setAsideType: ${r.set_aside_type || "(null)"}`);
    console.log(`    setAsideCode: ${r.set_aside_code || "(null)"}${flagged}`);
    console.log();
  }

  console.log(`  Total: ${rows.length} (GOOD + MAYBE)`);
  console.log();

  // 2. Pre-filter codes in batch-classify.ts
  console.log("2. PRE-FILTER CODES IN batch-classify.ts:");
  console.log('   const RESTRICTED_SET_ASIDES = new Set(["8A", "SDVOSB", "HZ", "WOSB", "EDWOSB"])');
  console.log();

  // 3. All distinct set-aside codes in GOOD/MAYBE
  console.log("3. DISTINCT SET-ASIDE CODES IN GOOD/MAYBE CONTRACTS:");
  const codes = await db.execute(sql`
    SELECT DISTINCT set_aside_code, set_aside_type, count(*) as count
    FROM contracts
    WHERE classification IN ('GOOD', 'MAYBE') AND set_aside_code IS NOT NULL
    GROUP BY set_aside_code, set_aside_type
    ORDER BY set_aside_code
  `);

  if (codes.length === 0) {
    console.log("   (none — all GOOD/MAYBE have null set-aside codes)");
  } else {
    for (const r of codes) {
      const flagged = restricted.has(r.set_aside_code as string) ? " *** RESTRICTED ***" : "";
      console.log(`   code="${r.set_aside_code}" type="${r.set_aside_type}" count=${r.count}${flagged}`);
    }
  }
  console.log();

  // 4. Also check: ALL distinct set-aside codes in the entire DB
  console.log("4. ALL DISTINCT SET-ASIDE CODES IN ENTIRE DB:");
  const allCodes = await db.execute(sql`
    SELECT DISTINCT set_aside_code, set_aside_type, count(*) as count
    FROM contracts
    WHERE set_aside_code IS NOT NULL
    GROUP BY set_aside_code, set_aside_type
    ORDER BY count DESC
  `);
  for (const r of allCodes) {
    const inFilter = ["8A", "SDVOSB", "HZ", "WOSB", "EDWOSB"].includes(r.set_aside_code as string);
    const shouldFilter = restricted.has(r.set_aside_code as string);
    const status = inFilter ? "(in pre-filter)" : shouldFilter ? "*** MISSING FROM PRE-FILTER ***" : "(OK — JCL qualifies)";
    console.log(`   code="${r.set_aside_code}" type="${r.set_aside_type}" count=${r.count} ${status}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
