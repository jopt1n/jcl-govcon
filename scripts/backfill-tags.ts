import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env before importing db
const envFile = readFileSync(resolve(__dirname, "../.env"), "utf-8");
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = val;
}

async function backfillTags() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");

  const sbaResult = await db.execute(sql`
    UPDATE contracts
    SET tags = COALESCE(tags, '[]'::jsonb) || '["SBA"]'::jsonb
    WHERE set_aside_type IS NOT NULL AND set_aside_type != ''
  `);
  console.log(`SBA tag backfilled: ${sbaResult.length} rows`);

  const docsResult = await db.execute(sql`
    UPDATE contracts
    SET tags = COALESCE(tags, '[]'::jsonb) || '["HAS_DOCS"]'::jsonb
    WHERE resource_links IS NOT NULL AND resource_links::text != '[]'
  `);
  console.log(`HAS_DOCS tag backfilled: ${docsResult.length} rows`);

  process.exit(0);
}

backfillTags().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
