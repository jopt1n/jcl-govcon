import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(__dirname, "../.env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { sql } = await import("drizzle-orm");
  const result = await db.execute(sql`
    SELECT classification, COUNT(*) as count
    FROM contracts
    GROUP BY classification
    ORDER BY count DESC
  `);
  const rows = Array.isArray(result) ? result : (result as any).rows;
  console.table(rows);
  process.exit(0);
}
main();
