import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, isNotNull, and, sql, like } from "drizzle-orm";

async function main() {
  // Directly query for IT NAICS codes that got discarded
  const itNaics = ["541511", "541512", "541519", "518210", "541611", "541614", "541690", "511210", "519130", "541613"];

  const rows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      naicsCode: contracts.naicsCode,
      setAsideType: contracts.setAsideType,
      awardCeiling: contracts.awardCeiling,
      descriptionText: contracts.descriptionText,
      aiReasoning: contracts.aiReasoning,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "DISCARD"),
        isNotNull(contracts.descriptionText),
        sql`length(description_text) > 200`,
        sql`naics_code IN (${sql.join(itNaics.map(n => sql`${n}`), sql`, `)})`
      )
    )
    .limit(30);

  for (const m of rows) {
    const descSnip = (m.descriptionText || "").slice(0, 200).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 200).replace(/\n/g, " ");
    console.log(`${m.id}`);
    console.log(`  TITLE:    ${m.title}`);
    console.log(`  NAICS:    ${m.naicsCode}`);
    console.log(`  SET-ASIDE:${m.setAsideType || "none"}`);
    console.log(`  CEILING:  ${m.awardCeiling || "none"}`);
    console.log(`  DESC:     ${descSnip}...`);
    console.log(`  DISCARD:  ${reason}...`);
    console.log();
  }

  console.log(`Found ${rows.length} IT-NAICS contracts classified as DISCARD`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
