import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { isRestrictedSetAside } from "../src/lib/sam-gov/set-aside-filter";

async function main() {
  // Fix the known SDVOSBC contract
  const [updated] = await db
    .update(contracts)
    .set({
      classification: "DISCARD",
      aiReasoning: "Restricted set-aside: Service-Disabled Veteran-Owned Small Business — JCL does not qualify",
      classificationRound: 4,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, "1acedc40-b9cf-4389-b4b0-47eef4c15b99"))
    .returning({ id: contracts.id, title: contracts.title, classification: contracts.classification });

  if (updated) {
    console.log(`Fixed: ${updated.title} → ${updated.classification}`);
  } else {
    console.log("Contract 1acedc40 not found (may have been purged as expired)");
  }

  // Check all remaining GOOD/MAYBE for restricted set-asides
  const goodMaybe = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      classification: contracts.classification,
      setAsideType: contracts.setAsideType,
      setAsideCode: contracts.setAsideCode,
    })
    .from(contracts)
    .where(sql`classification IN ('GOOD', 'MAYBE')`)
    .orderBy(contracts.classification, contracts.title);

  console.log(`\nAll GOOD/MAYBE contracts (${goodMaybe.length}):\n`);

  let flagged = 0;
  for (const r of goodMaybe) {
    const restricted = isRestrictedSetAside(r.setAsideCode);
    const flag = restricted ? " *** RESTRICTED ***" : "";
    if (restricted) flagged++;
    console.log(`  ${r.classification} | setAside=${r.setAsideCode || "(null)"} | ${r.title}${flag}`);
  }

  console.log(`\nFlagged as restricted: ${flagged}`);
  if (flagged === 0) {
    console.log("No restricted set-asides in GOOD/MAYBE contracts.");
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
