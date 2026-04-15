import "./load-env";
import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL not set");
  const client = postgres(connectionString, { max: 1 });
  console.log("Running backfill (statement by statement)...");
  const start = Date.now();

  // 1. Mark every existing contract as already-reviewed.
  const r1 =
    await client`UPDATE contracts SET reviewed_at = created_at WHERE reviewed_at IS NULL`;
  console.log(`  reviewed_at backfill: ${r1.count} rows updated`);

  // 2. Seed status_changed_at from updated_at where the column got
  //    auto-populated with the migration timestamp (newer than updated_at).
  const r2 =
    await client`UPDATE contracts SET status_changed_at = updated_at WHERE updated_at IS NOT NULL AND status_changed_at > updated_at`;
  console.log(`  status_changed_at backfill: ${r2.count} rows updated`);

  // 3. Verify.
  const [{ unreviewed }] =
    await client`SELECT COUNT(*)::int AS unreviewed FROM contracts WHERE reviewed_at IS NULL`;
  if (unreviewed > 0) {
    throw new Error(
      `Backfill incomplete: ${unreviewed} rows still have reviewed_at IS NULL`,
    );
  }

  console.log(`Backfill complete in ${Date.now() - start}ms`);
  await client.end();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
