import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql, ne } from "drizzle-orm";

async function main() {
  // Current state
  const before = await db.select({ c: contracts.classification, count: sql<number>`count(*)` })
    .from(contracts).groupBy(contracts.classification).orderBy(sql`count(*) desc`);
  console.log("BEFORE:");
  for (const r of before) console.log(`  ${String(r.count).padStart(6)}  ${r.c}`);

  // Reset everything that's DISCARD back to PENDING
  const result = await db.update(contracts)
    .set({ 
      classification: "PENDING", 
      classificationRound: 0, 
      aiReasoning: null,
      summary: null,
      actionPlan: null,
      updatedAt: new Date() 
    })
    .where(ne(contracts.classification, "PENDING"))
    .returning({ id: contracts.id });

  console.log(`\nReset ${result.length} contracts back to PENDING`);

  // Re-run pre-filters
  console.log("\nRe-running pre-filters...");
  
  // Expired deadlines
  const r1 = await db.update(contracts)
    .set({ classification: "DISCARD", classificationRound: 4, updatedAt: new Date() })
    .where(sql`classification = 'PENDING' AND response_deadline < now()`)
    .returning({ id: contracts.id });
  console.log(`  ${r1.length} expired deadlines`);

  // Restricted set-asides
  const r2 = await db.update(contracts)
    .set({ classification: "DISCARD", classificationRound: 4, updatedAt: new Date() })
    .where(sql`classification = 'PENDING' AND set_aside_code ~ '^(8A|SDVOSB|HZ|WOSB|EDWOSB|ISBEE|VSA|VSB)'`)
    .returning({ id: contracts.id });
  console.log(`  ${r2.length} restricted set-asides`);

  // Physical goods (PSC 1-8)
  const r3 = await db.update(contracts)
    .set({ classification: "DISCARD", classificationRound: 4, updatedAt: new Date() })
    .where(sql`classification = 'PENDING' AND left(psc_code, 1) ~ '^[1-8]$'`)
    .returning({ id: contracts.id });
  console.log(`  ${r3.length} physical goods (PSC 1-8)`);

  // Construction (PSC Y, Z)
  const r4 = await db.update(contracts)
    .set({ classification: "DISCARD", classificationRound: 4, updatedAt: new Date() })
    .where(sql`classification = 'PENDING' AND left(psc_code, 1) in ('Y', 'Z')`)
    .returning({ id: contracts.id });
  console.log(`  ${r4.length} construction (PSC Y, Z)`);

  // Final state
  const after = await db.select({ c: contracts.classification, count: sql<number>`count(*)` })
    .from(contracts).groupBy(contracts.classification).orderBy(sql`count(*) desc`);
  console.log("\nAFTER:");
  for (const r of after) console.log(`  ${String(r.count).padStart(6)}  ${r.c}`);

  process.exit(0);
}
main().catch(console.error);
