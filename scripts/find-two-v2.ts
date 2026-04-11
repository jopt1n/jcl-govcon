import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, isNotNull, and, sql } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      naicsCode: contracts.naicsCode,
      setAsideType: contracts.setAsideType,
      descriptionText: contracts.descriptionText,
      aiReasoning: contracts.aiReasoning,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "DISCARD"),
        isNotNull(contracts.descriptionText),
        sql`length(description_text) > 300`
      )
    )
    .limit(3000);

  // ── A: Simple equipment/install that one person COULD do ────────────
  console.log("=== A: Simple equipment procurement/install/setup ===\n");

  const aMatches = rows.filter((r) => {
    const title = r.title;
    const desc = (r.descriptionText || "").slice(0, 3000);
    const reason = (r.aiReasoning || "");
    // Old prompt discarded because "physical" or "hardware" or "not software"
    const wrongDiscard = /physical|hardware|not software|non-software|cannot be delivered remotely|on-site/i.test(reason);
    // But the work sounds simple/doable
    const simpleWork = /printer|copier|laptop|desktop|monitor|display|kiosk|point.of.sale|POS system|AV equip|audio.visual|projector|phone system|camera|access control|badge|ID card|signage|digital sign|network switch|router|access point|Wi-?Fi|UPS|uninterrupt|scanner|barcode|label printer|shredder|furniture|workstation|cubicle/i.test(title + " " + desc);
    const exclude = /sole.source|8\(a\)|SDVOSB|HUBZone|WOSB|EDWOSB|clearance|secret|manufactur/i.test(title + " " + desc + " " + reason);
    return wrongDiscard && simpleWork && !exclude;
  });

  for (const m of aMatches.slice(0, 6)) {
    const descSnip = (m.descriptionText || "").slice(0, 250).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 200).replace(/\n/g, " ");
    console.log(`  ${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  NAICS: ${m.naicsCode}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log(`  OLD REASON: ${reason}...`);
    console.log();
  }
  console.log(`  Total: ${aMatches.length}\n`);

  // ── B: Clear staff augmentation ─────────────────────────────────────
  console.log("=== B: Staff augmentation (ongoing bodies in seats) ===\n");

  const bMatches = rows.filter((r) => {
    const desc = (r.descriptionText || "").slice(0, 5000);
    // Look for real staff aug language in context
    const staffAug = /staff augment/i.test(desc) ||
      (/provide personnel/i.test(desc) && /ongoing|continuous|full.time|12.month|annual/i.test(desc)) ||
      (/labor hour/i.test(desc) && /on.site|report to|government facility/i.test(desc)) ||
      (/FTE|full.time equivalent/i.test(desc) && /on.site|report to|government/i.test(desc));
    // Must be IT/consulting NAICS, not manufacturing
    const itNaics = /^54|^51|^61/i.test(r.naicsCode || "");
    const exclude = /sole.source|8\(a\)|SDVOSB|HUBZone|WOSB|EDWOSB/i.test(desc);
    return staffAug && itNaics && !exclude;
  });

  for (const m of bMatches.slice(0, 6)) {
    const descSnip = (m.descriptionText || "").slice(0, 250).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 200).replace(/\n/g, " ");
    console.log(`  ${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  NAICS: ${m.naicsCode}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log(`  OLD REASON: ${reason}...`);
    console.log();
  }
  console.log(`  Total: ${bMatches.length}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
