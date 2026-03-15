process.env.SAM_DRY_RUN = "true";

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // Get 5 solicitations/combined synopsis that likely have deadlines
  const result = await db.execute(sql`
    SELECT notice_id, title, notice_type, response_deadline, raw_json
    FROM contracts
    WHERE notice_type IN ('Solicitation', 'Combined Synopsis/Solicitation')
    ORDER BY posted_date DESC
    LIMIT 5
  `);

  const rows = Array.isArray(result) ? result : (result as any).rows ?? [];

  for (const row of rows) {
    const raw = row.raw_json as Record<string, unknown>;
    console.log("────────────────────────────────────────────────");
    console.log(`  noticeId: ${row.notice_id}`);
    console.log(`  title: ${(row.title as string)?.slice(0, 80)}`);
    console.log(`  notice_type: ${row.notice_type}`);
    console.log(`  response_deadline (DB column): ${row.response_deadline}`);
    console.log();

    // Show all keys containing deadline/response/date/close/due
    const interestingKeys = Object.entries(raw).filter(([key]) =>
      /deadline|response|date|close|due|archive/i.test(key)
    );

    console.log("  Raw JSON date-related fields:");
    for (const [key, val] of interestingKeys) {
      console.log(`    ${key}: ${JSON.stringify(val)}`);
    }

    // Also explicitly check responseDeadDate and responseDeadLine
    console.log();
    console.log(`  raw.responseDeadDate: ${JSON.stringify(raw.responseDeadDate)}`);
    console.log(`  raw.responseDeadLine: ${JSON.stringify(raw.responseDeadLine)}`);
    console.log(`  raw.responseDateLine: ${JSON.stringify(raw.responseDateLine)}`);
    console.log();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
