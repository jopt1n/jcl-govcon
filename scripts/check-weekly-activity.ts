import "./load-env";
import postgres from "postgres";

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });

  console.log("\n── Recent crawl_runs (last 30 days) ────────────────");
  const runs = await client`
    SELECT
      id,
      kind,
      status,
      window_start::date AS win_start,
      window_end::date   AS win_end,
      contracts_found,
      contracts_classified,
      error_step,
      created_at::date   AS created
    FROM crawl_runs
    WHERE created_at > NOW() - INTERVAL '30 days'
    ORDER BY created_at DESC
    LIMIT 20
  `;
  if (runs.length === 0) {
    console.log("  (no crawl_runs rows in the last 30 days)");
  } else {
    console.table(runs);
  }

  console.log("\n── Contracts created by week (last 8 weeks) ────────");
  const byWeek = await client`
    SELECT
      date_trunc('week', created_at)::date AS week,
      COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE classification = 'GOOD')::int    AS good,
      COUNT(*) FILTER (WHERE classification = 'MAYBE')::int   AS maybe,
      COUNT(*) FILTER (WHERE classification = 'DISCARD')::int AS discard,
      COUNT(*) FILTER (WHERE classification = 'PENDING')::int AS pending
    FROM contracts
    WHERE created_at > NOW() - INTERVAL '8 weeks'
    GROUP BY 1
    ORDER BY 1 DESC
  `;
  if (byWeek.length === 0) {
    console.log("  (no contracts created in the last 8 weeks)");
  } else {
    console.table(byWeek);
  }

  console.log("\n── Most recent contract createdAt ──────────────────");
  const [newest] = await client`
    SELECT MAX(created_at) AS newest_created_at FROM contracts
  `;
  console.log(`  ${newest.newest_created_at}`);

  console.log("\n── GOOD/MAYBE from the last 7 days ─────────────────");
  const hot = await client`
    SELECT id, notice_id, title, classification, agency, response_deadline
    FROM contracts
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND classification IN ('GOOD', 'MAYBE')
    ORDER BY classification, response_deadline NULLS LAST
    LIMIT 20
  `;
  if (hot.length === 0) {
    console.log("  (no new GOOD/MAYBE contracts in the last 7 days)");
  } else {
    console.table(hot);
  }

  await client.end();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
