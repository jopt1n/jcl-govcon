import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Testing DB connection...");
  const result = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'contracts' AND column_name = 'action_plan'`);
  console.log("action_plan column exists:", result.length > 0, result);
  process.exit(0);
}
main().catch((e) => { console.error("DB FAIL:", e.message); process.exit(1); });
