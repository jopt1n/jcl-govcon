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
      resourceLinks: contracts.resourceLinks,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "DISCARD"),
        isNotNull(contracts.descriptionText),
        sql`length(description_text) > 300`
      )
    )
    .limit(5000);

  // ── A: Equipment procurement/delivery one person COULD do ───────────
  // Look in the OLD discard reason for "physical" or "hardware" or "on-site"
  // but title/desc looks like simple procurement/delivery/setup
  console.log("=== A: Equipment/IT procurement/setup that one person could do ===\n");

  const aMatches = rows.filter((r) => {
    const desc = (r.descriptionText || "").slice(0, 2000).toLowerCase();
    const title = r.title.toLowerCase();
    const reason = (r.aiReasoning || "").toLowerCase();

    // Was discarded for being "physical" or "not software"
    if (!/(physical|hardware|not software|non-software|cannot be delivered remotely|on.site|requires physical)/i.test(reason)) return false;

    // Title or desc has simple doable work
    const simplePhysical =
      /(procure|purchas|acqui|buy).*?(laptop|desktop|computer|tablet|ipad|monitor|display|printer|copier|scanner|phone|camera|server|switch|router|access point|UPS)/i.test(desc) ||
      /(install|setup|set.up|deploy|configur).*?(laptop|desktop|computer|monitor|printer|kiosk|POS|point.of.sale|phone|camera|access point|Wi.?Fi|network|display|digital sign)/i.test(desc) ||
      /(laptop|desktop|computer|tablet|printer|copier|scanner|monitor|phone|camera|kiosk|POS).*?(procure|purchas|deliver|install|setup|deploy|configur)/i.test(desc) ||
      /training.*?(develop|creat|design|deliver)/i.test(title + " " + desc) ||
      /e.?learn/i.test(title);

    if (!simplePhysical) return false;

    // Exclude things that are actually complex/restricted
    if (/sole.source|SDVOSB|8\(a\)|HUBZone|WOSB|EDWOSB|clearance|secret|FedRAMP|CMMC/i.test(desc + " " + reason)) return false;

    return true;
  });

  for (const m of aMatches.slice(0, 8)) {
    const descSnip = (m.descriptionText || "").slice(0, 300).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 200).replace(/\n/g, " ");
    console.log(`  ${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  NAICS: ${m.naicsCode}`);
    console.log(`  LINKS: ${(m.resourceLinks || []).length}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log(`  OLD REASON: ${reason}...`);
    console.log();
  }
  console.log(`  Total: ${aMatches.length}\n`);

  // ── B: Clear ongoing staff augmentation ─────────────────────────────
  console.log("=== B: Ongoing staff augmentation ===\n");

  const bMatches = rows.filter((r) => {
    const desc = (r.descriptionText || "").slice(0, 5000);
    const title = r.title;
    // Strong staff aug signals
    const isStaffAug =
      /staff augment/i.test(title + " " + desc) ||
      (/contractor.{0,30}(shall|will).{0,30}(report to|work at|be located at|government facility)/i.test(desc) &&
       /(12.month|annual|ongoing|continuous|period of performance|base year)/i.test(desc));
    // IT/consulting NAICS
    const itNaics = /^541|^518|^511|^519/i.test(r.naicsCode || "");
    // Not already excluded for set-aside reasons
    const notSetAside = !/SDVOSB|8\(a\)|HUBZone|WOSB|EDWOSB|sole.source/i.test(desc + " " + (r.aiReasoning || ""));
    return isStaffAug && itNaics && notSetAside;
  });

  for (const m of bMatches.slice(0, 8)) {
    const descSnip = (m.descriptionText || "").slice(0, 300).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 200).replace(/\n/g, " ");
    console.log(`  ${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  NAICS: ${m.naicsCode}`);
    console.log(`  LINKS: ${(m.resourceLinks || []).length}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log(`  OLD REASON: ${reason}...`);
    console.log();
  }
  console.log(`  Total: ${bMatches.length}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
