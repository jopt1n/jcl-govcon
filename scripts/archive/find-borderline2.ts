import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, isNotNull, and, sql } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      naicsCode: contracts.naicsCode,
      descriptionText: contracts.descriptionText,
      aiReasoning: contracts.aiReasoning,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "DISCARD"),
        isNotNull(contracts.descriptionText),
        sql`length(description_text) > 200`
      )
    )
    .limit(2000);

  // Look for IT/tech/consulting/knowledge work that might have been wrongly discarded
  const itKeywords = /software|website|web.dev|application|dashboard|portal|database|cloud|data.analy|cybersec|IT.support|IT.modern|automat|AI|machine.learn|chatbot|helpdesk|training.develop|e.?learn|graphic.design|video.edit|multimedia|social.media|digital.market|translat|transcript|caption|technical.writ|document|admin.support|program.manage|project.manage|data.entry|record.manage|digitiz|scanning|consult|assess|evaluat|research.analy|report.writ|content|commun|508|accessib/i;
  // Still exclude obvious physical/clearance
  const exclude = /construct|manufactur|building|bridge|road|paving|roofing|plumb|HVAC|janitorial|custodial|guard service|clearance|secret|top secret|TS.SCI|SDVOSB|8\(a\)|HUBZone|WOSB|EDWOSB|sole.source|hazmat|asbestos|missile|vehicle fleet|ammunition|medical.service|clinical|nurse|physician|dental|pharmacist|laborat/i;

  const matches = rows.filter((r) => {
    const text = r.title + " " + (r.descriptionText || "").slice(0, 1000);
    return itKeywords.test(text) && !exclude.test(text);
  });

  for (const m of matches.slice(0, 15)) {
    const descSnip = (m.descriptionText || "").slice(0, 200).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 120).replace(/\n/g, " ");
    console.log(`${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  NAICS: ${m.naicsCode}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log(`  WHY DISCARDED: ${reason}...`);
    console.log();
  }

  console.log(`Total IT/tech borderline matches: ${matches.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
