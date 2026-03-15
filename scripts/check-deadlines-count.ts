process.env.SAM_DRY_RUN = "true";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(response_deadline) as has_deadline,
      COUNT(*) - COUNT(response_deadline) as no_deadline
    FROM contracts
  `);
  const rows = Array.isArray(r) ? r : (r as any).rows;
  console.log(JSON.stringify(rows[0], null, 2));
  process.exit(0);
}
main();
