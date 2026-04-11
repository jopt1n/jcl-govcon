/**
 * Pre-filter contracts that JCL can't bid on — marks them DISCARD before AI classification.
 *
 * Filters:
 * 1. Deadline already passed
 * 2. Restricted set-asides (SDVOSB, 8A, HZ, WOSB, etc.)
 * 3. Physical goods (PSC codes starting with 1-8)
 * 4. Construction (PSC codes starting with Y, Z)
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/pre-filter-contracts.ts
 *   npx tsx --import ./scripts/load-env.ts scripts/pre-filter-contracts.ts --dry-run
 */

import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql, eq, and } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

async function markDiscard(label: string, condition: ReturnType<typeof sql>) {
  const countResult = await db.select({ count: sql<number>`count(*)` })
    .from(contracts)
    .where(and(eq(contracts.classification, "PENDING"), condition));
  const count = Number(countResult[0].count);

  if (!dryRun && count > 0) {
    await db.update(contracts)
      .set({ classification: "DISCARD", classificationRound: 4, updatedAt: new Date() })
      .where(and(eq(contracts.classification, "PENDING"), condition));
  }

  console.log(`  ${dryRun ? "[DRY RUN] " : ""}${String(count).padStart(6)}  ${label}`);
  return count;
}

async function main() {
  console.log(`=== PRE-FILTER ${dryRun ? "(DRY RUN)" : ""} ===\n`);

  const [before] = await db.select({ count: sql<number>`count(*)` })
    .from(contracts).where(eq(contracts.classification, "PENDING"));
  console.log(`PENDING before: ${before.count}\n`);

  let total = 0;

  // 1. Expired deadlines
  total += await markDiscard(
    "Deadline already passed",
    sql`response_deadline < now()`
  );

  // 2. Restricted set-asides
  total += await markDiscard(
    "Restricted set-asides (8A, SDVOSB, HZ, WOSB, etc.)",
    sql`set_aside_code ~ '^(8A|SDVOSB|HZ|WOSB|EDWOSB|ISBEE|VSA|VSB)'`
  );

  // 3. Physical goods (PSC prefix 1-8)
  total += await markDiscard(
    "Physical goods/supplies (PSC 1-8)",
    sql`left(psc_code, 1) ~ '^[1-8]$'`
  );

  // 4. Construction (PSC prefix Y, Z)
  total += await markDiscard(
    "Construction (PSC Y, Z)",
    sql`left(psc_code, 1) in ('Y', 'Z')`
  );

  const [after] = await db.select({ count: sql<number>`count(*)` })
    .from(contracts).where(eq(contracts.classification, "PENDING"));

  console.log(`\n  ${String(total).padStart(6)}  TOTAL FILTERED`);
  console.log(`\nPENDING after: ${after.count}`);
  console.log(`Reduction: ${before.count} → ${after.count} (${((1 - Number(after.count) / Number(before.count)) * 100).toFixed(1)}% removed)`);

  process.exit(0);
}

main().catch(console.error);
