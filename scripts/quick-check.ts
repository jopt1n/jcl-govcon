process.env.SAM_DRY_RUN = "true";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const counts = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(response_deadline) as has_deadline,
      COUNT(*) - COUNT(response_deadline) as no_deadline
    FROM contracts
  `);
  const c = Array.isArray(counts) ? counts[0] : (counts as any).rows[0];
  console.log("=== DEADLINE COUNTS ===");
  console.log(`  Total: ${c.total} | Has deadline: ${c.has_deadline} | No deadline: ${c.no_deadline}\n`);

  const samples = await db.execute(sql`
    SELECT title, notice_type, posted_date, response_deadline
    FROM contracts
    WHERE response_deadline IS NOT NULL
    ORDER BY response_deadline DESC
    LIMIT 5
  `);
  const rows = Array.isArray(samples) ? samples : (samples as any).rows;
  console.log("=== 5 SAMPLE CONTRACTS (by soonest deadline) ===\n");
  for (const r of rows) {
    console.log(`  ${(r.title as string).slice(0, 70)}`);
    console.log(`    type: ${r.notice_type} | posted: ${r.posted_date} | deadline: ${r.response_deadline}`);
    console.log();
  }
  process.exit(0);
}
main();
