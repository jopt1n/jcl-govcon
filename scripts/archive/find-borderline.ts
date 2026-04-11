import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, isNotNull, and, sql } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      descriptionText: contracts.descriptionText,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "DISCARD"),
        isNotNull(contracts.descriptionText),
        sql`length(description_text) > 100`
      )
    )
    .limit(500);

  const keywords = /equip|install|setup|set.up|maint|IT support|suppli|deliver|kiosk|POS|monitor|laptop|computer|configur|deploy|helpdesk|help.desk|procurement|furni|training|consult|analys|research|report|data entry|transcri|translat|graphic|video|writing|documen|admin|program.manag|project.manag|website|web dev|software|app dev|digitiz|scanning/i;
  const exclude = /construct|manufactur|building|bridge|road|paving|roofing|plumb|HVAC|janitorial|custodial|guard|clearance|secret|top secret|TS.SCI|SDVOSB|8\(a\)|HUBZone|WOSB|EDWOSB|sole.source|hazmat|asbestos|missile|vehicle fleet|ammunition/i;

  const matches = rows.filter((r) => {
    const text = r.title + " " + (r.descriptionText || "").slice(0, 500);
    return keywords.test(text) && !exclude.test(text);
  });

  for (const m of matches.slice(0, 20)) {
    const descSnip = (m.descriptionText || "").slice(0, 150).replace(/\n/g, " ");
    console.log(`${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log();
  }

  console.log(`Total matches: ${matches.length} of ${rows.length} DISCARD contracts checked`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
