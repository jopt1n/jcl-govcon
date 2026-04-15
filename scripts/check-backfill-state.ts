import "./load-env";
import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const reviewed = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE reviewed_at IS NULL)   AS null_reviewed,
      COUNT(*) FILTER (WHERE reviewed_at IS NOT NULL) AS set_reviewed
    FROM contracts
  `);
  console.log("\nreviewed_at state:");
  console.table(reviewed);

  const statusDrift = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status_changed_at IS NULL)       AS null_sca,
      COUNT(*) FILTER (WHERE status_changed_at > updated_at)  AS newer_than_updated,
      COUNT(*) FILTER (WHERE status_changed_at <= updated_at) AS ok
    FROM contracts
  `);
  console.log("\nstatus_changed_at vs updated_at:");
  console.table(statusDrift);

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
