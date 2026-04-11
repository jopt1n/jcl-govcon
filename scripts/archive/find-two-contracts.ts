import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, isNotNull, and, sql } from "drizzle-orm";

async function main() {
  // ── 1. Simple physical work: equipment/install/POS/delivery ─────────
  console.log("=== CANDIDATE A: Simple physical/equipment ===\n");

  const physRows = await db
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

  const equipKw = /POS|point.of.sale|kiosk|install.*equip|equip.*install|deliver.*equip|equip.*deliver|hardware.setup|setup.*hardware|monitor.*install|install.*monitor|computer.*deploy|deploy.*computer|laptop.*deliver|printer|scanner|network.*install|cable.*install|configur.*deploy|procurement.*equip|furni.*deliver|audio.?visual|AV.equip|display|signage|copier|phone system|telecom.*install/i;
  const physExclude = /construct|manufactur|building|bridge|road|paving|roofing|plumb|HVAC|janitorial|custodial|guard|clearance|secret|SDVOSB|8\(a\)|HUBZone|WOSB|EDWOSB|sole.source|missile|ammunition|asbestos|hazmat|vehicle fleet|medical.*service|clinical|laborat|nurse|physician/i;

  const equipMatches = physRows.filter((r) => {
    const text = r.title + " " + (r.descriptionText || "").slice(0, 1500);
    return equipKw.test(text) && !physExclude.test(text);
  });

  for (const m of equipMatches.slice(0, 8)) {
    const descSnip = (m.descriptionText || "").slice(0, 200).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 150).replace(/\n/g, " ");
    console.log(`  ${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  NAICS: ${m.naicsCode}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log(`  OLD DISCARD REASON: ${reason}...`);
    console.log();
  }
  console.log(`  Total equipment matches: ${equipMatches.length}\n`);

  // ── 2. Staff augmentation ───────────────────────────────────────────
  console.log("=== CANDIDATE B: Staff augmentation ===\n");

  const staffMatches = physRows.filter((r) => {
    const text = (r.descriptionText || "").slice(0, 3000);
    return /provide personnel|labor hours|full.time equivalent|FTE|contractor personnel shall report to|staff augment/i.test(text);
  });

  for (const m of staffMatches.slice(0, 8)) {
    const descSnip = (m.descriptionText || "").slice(0, 200).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 150).replace(/\n/g, " ");
    console.log(`  ${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  NAICS: ${m.naicsCode}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log(`  OLD DISCARD REASON: ${reason}...`);
    console.log();
  }
  console.log(`  Total staff aug matches: ${staffMatches.length}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
