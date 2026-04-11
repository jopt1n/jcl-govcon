import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { sql, eq } from "drizzle-orm";

async function main() {
  // Notice types
  console.log("=== NOTICE TYPE ===");
  const types = await db.select({ type: contracts.noticeType, count: sql<number>`count(*)` })
    .from(contracts).groupBy(contracts.noticeType).orderBy(sql`count(*) desc`);
  for (const r of types) console.log(`  ${String(r.count).padStart(6)}  ${r.type ?? "null"}`);

  // Award ceiling ranges
  console.log("\n=== AWARD CEILING RANGES ===");
  const ceilings = await db.select({
    range: sql<string>`case 
      when award_ceiling is null then 'NULL'
      when award_ceiling = 0 then '$0'
      when award_ceiling < 10000 then 'Under $10K'
      when award_ceiling < 50000 then '$10K-$50K'
      when award_ceiling < 150000 then '$50K-$150K'
      when award_ceiling < 500000 then '$150K-$500K'
      when award_ceiling < 1000000 then '$500K-$1M'
      when award_ceiling < 5000000 then '$1M-$5M'
      when award_ceiling < 25000000 then '$5M-$25M'
      when award_ceiling < 100000000 then '$25M-$100M'
      else '$100M+'
    end`,
    count: sql<number>`count(*)`
  }).from(contracts).groupBy(sql`1`).orderBy(sql`min(coalesce(award_ceiling, -1))`);
  for (const r of ceilings) console.log(`  ${String(r.count).padStart(6)}  ${r.range}`);

  // NAICS code top 20
  console.log("\n=== TOP 20 NAICS CODES ===");
  const naics = await db.select({ code: contracts.naicsCode, count: sql<number>`count(*)` })
    .from(contracts).groupBy(contracts.naicsCode).orderBy(sql`count(*) desc`).limit(20);
  for (const r of naics) console.log(`  ${String(r.count).padStart(6)}  ${r.code ?? "null"}`);

  // Response deadline distribution
  console.log("\n=== RESPONSE DEADLINE ===");
  const deadlines = await db.select({
    range: sql<string>`case
      when response_deadline is null then 'No deadline'
      when response_deadline < now() then 'Already passed'
      when response_deadline < now() + interval '7 days' then 'Within 7 days'
      when response_deadline < now() + interval '30 days' then '7-30 days'
      when response_deadline < now() + interval '90 days' then '30-90 days'
      else '90+ days out'
    end`,
    count: sql<number>`count(*)`
  }).from(contracts).groupBy(sql`1`).orderBy(sql`count(*) desc`);
  for (const r of deadlines) console.log(`  ${String(r.count).padStart(6)}  ${r.range}`);

  // Top agencies
  console.log("\n=== TOP 15 AGENCIES ===");
  const agencies = await db.select({ 
    agency: sql<string>`split_part(agency, '.', 1)`, 
    count: sql<number>`count(*)` 
  }).from(contracts).groupBy(sql`1`).orderBy(sql`count(*) desc`).limit(15);
  for (const r of agencies) console.log(`  ${String(r.count).padStart(6)}  ${r.agency ?? "null"}`);

  // PSC code prefixes (first letter = category)
  console.log("\n=== PSC CODE CATEGORIES (first letter) ===");
  const psc = await db.select({
    prefix: sql<string>`left(psc_code, 1)`,
    count: sql<number>`count(*)`
  }).from(contracts).where(sql`psc_code is not null`).groupBy(sql`1`).orderBy(sql`count(*) desc`);
  for (const r of psc) console.log(`  ${String(r.count).padStart(6)}  ${r.prefix}`);

  // Active status
  console.log("\n=== ACTIVE STATUS ===");
  const active = await db.select({ active: contracts.active, count: sql<number>`count(*)` })
    .from(contracts).groupBy(contracts.active).orderBy(sql`count(*) desc`);
  for (const r of active) console.log(`  ${String(r.count).padStart(6)}  ${String(r.active)}`);

  // Classification status
  console.log("\n=== CLASSIFICATION STATUS ===");
  const classif = await db.select({ c: contracts.classification, count: sql<number>`count(*)` })
    .from(contracts).groupBy(contracts.classification).orderBy(sql`count(*) desc`);
  for (const r of classif) console.log(`  ${String(r.count).padStart(6)}  ${r.c}`);

  process.exit(0);
}

main().catch(console.error);
