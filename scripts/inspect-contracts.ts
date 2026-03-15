process.env.SAM_DRY_RUN = "true";

import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { sql, count, isNotNull, ne } from "drizzle-orm";

async function main() {
  // 3 sample contracts: oldest, newest, and one from the middle
  const samples = await db.execute(sql`
    (SELECT * FROM contracts ORDER BY posted_date ASC LIMIT 1)
    UNION ALL
    (SELECT * FROM contracts ORDER BY posted_date DESC LIMIT 1)
    UNION ALL
    (SELECT * FROM contracts ORDER BY posted_date ASC OFFSET 9000 LIMIT 1)
  `);

  const rows = Array.isArray(samples) ? samples : (samples as any).rows ?? [];
  console.log("=== SAMPLE CONTRACTS ===\n");
  for (const row of rows) {
    console.log("────────────────────────────────────────────────");
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (key === "raw_json") {
        const json = value as Record<string, unknown>;
        console.log(`  ${key}: { keys: [${Object.keys(json).join(", ")}] }`);
      } else if (key === "resource_links") {
        const links = value as string[];
        console.log(`  ${key}: [${links?.length ?? 0} links]${links?.length ? " " + JSON.stringify(links.slice(0, 3)) : ""}`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }
    console.log();
  }

  // Total count
  const totalResult = await db.select({ total: count() }).from(contracts);
  console.log(`\n=== COLUMN POPULATION (out of ${totalResult[0].total} total contracts) ===\n`);

  // Check each column for non-null, non-empty values
  const cols = [
    "notice_id", "solicitation_number", "title", "agency", "naics_code",
    "psc_code", "notice_type", "set_aside_type", "award_ceiling",
    "response_deadline", "posted_date", "active", "classification",
    "ai_reasoning", "description_text", "user_override", "status",
    "notes", "sam_url", "resource_links", "documents_analyzed",
    "org_path_name", "org_path_code", "pop_state", "pop_city", "pop_zip",
    "office_city", "office_state", "set_aside_code",
    "description_fetched", "classified_from_metadata"
  ];

  const populationQuery = cols
    .map(c => `COUNT(CASE WHEN "${c}" IS NOT NULL AND "${c}"::text != '' AND "${c}"::text != '[]' THEN 1 END) AS "${c}"`)
    .join(",\n    ");

  const popResult = await db.execute(sql.raw(`SELECT ${populationQuery} FROM contracts`));
  const total = totalResult[0].total;

  const popRaw = Array.isArray(popResult) ? popResult : (popResult as any).rows ?? [];
  const popRow = popRaw[0] as Record<string, unknown>;
  const sorted = Object.entries(popRow)
    .map(([col, cnt]) => ({ col, cnt: Number(cnt), pct: Math.round((Number(cnt) / total) * 100) }))
    .sort((a, b) => b.pct - a.pct);

  for (const { col, cnt, pct } of sorted) {
    const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
    console.log(`  ${col.padEnd(25)} ${bar} ${cnt.toLocaleString().padStart(6)} (${pct}%)`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
