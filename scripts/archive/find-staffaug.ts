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
      resourceLinks: contracts.resourceLinks,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "DISCARD"),
        isNotNull(contracts.descriptionText),
        sql`description_text ILIKE '%staff augment%' OR description_text ILIKE '%provide personnel%' OR title ILIKE '%staff augment%'`
      )
    )
    .limit(20);

  for (const m of rows) {
    const descSnip = (m.descriptionText || "").slice(0, 300).replace(/\n/g, " ");
    const reason = (m.aiReasoning || "").slice(0, 200).replace(/\n/g, " ");
    console.log(`${m.id}`);
    console.log(`  TITLE: ${m.title}`);
    console.log(`  NAICS: ${m.naicsCode}`);
    console.log(`  LINKS: ${(m.resourceLinks || []).length}`);
    console.log(`  DESC:  ${descSnip}...`);
    console.log(`  OLD REASON: ${reason}...`);
    console.log();
  }
  console.log(`Total: ${rows.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
