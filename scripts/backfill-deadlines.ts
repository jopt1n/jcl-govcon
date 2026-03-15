/**
 * Backfill response_deadline from raw_json.responseDeadLine in one query.
 *
 * Usage: npx tsx --import ./scripts/load-env.ts scripts/backfill-deadlines.ts
 */

process.env.SAM_DRY_RUN = "true";

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute(sql`
    UPDATE contracts
    SET response_deadline = (raw_json->>'responseDeadLine')::timestamptz
    WHERE response_deadline IS NULL
      AND raw_json IS NOT NULL
      AND raw_json->>'responseDeadLine' IS NOT NULL
  `);

  const count = (result as any).rowCount ?? (result as any).length ?? "unknown";
  console.log(`Backfill complete: ${count} contracts updated with response_deadline`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
