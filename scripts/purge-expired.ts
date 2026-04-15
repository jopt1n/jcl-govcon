/**
 * Delete contracts with expired response deadlines.
 * Preserves contracts with NULL deadlines (open-ended).
 */

import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  // Count before
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(contracts);
  const [expired] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`response_deadline IS NOT NULL AND response_deadline < NOW()`);
  const [active] = await db.select({ count: sql<number>`count(*)` }).from(contracts)
    .where(sql`response_deadline IS NULL OR response_deadline >= NOW()`);

  console.log(`Total contracts:   ${total.count}`);
  console.log(`Expired deadline:  ${expired.count}`);
  console.log(`Active/no deadline: ${active.count}`);
  console.log();

  // Delete expired
  const result = await db.delete(contracts)
    .where(sql`response_deadline IS NOT NULL AND response_deadline < NOW()`);

  console.log(`Deleted ${expired.count} expired contracts.`);

  // Count after
  const [remaining] = await db.select({ count: sql<number>`count(*)` }).from(contracts);
  console.log(`Remaining: ${remaining.count}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
