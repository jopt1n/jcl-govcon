import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { extractDocumentText } from "../src/lib/document-text";

async function main() {
  const rows = await db.select({
    title: contracts.title,
    agency: contracts.agency,
    naicsCode: contracts.naicsCode,
    pscCode: contracts.pscCode,
    noticeType: contracts.noticeType,
    setAsideCode: contracts.setAsideCode,
    awardCeiling: contracts.awardCeiling,
    responseDeadline: contracts.responseDeadline,
    popState: contracts.popState,
    resourceLinks: contracts.resourceLinks,
    rawJson: contracts.rawJson,
  }).from(contracts)
    .where(and(
      eq(contracts.classification, "PENDING"),
      sql`jsonb_array_length(coalesce(resource_links, '[]'::jsonb)) between 1 and 3`,
      sql`psc_code like 'D%'`
    ))
    .limit(1);

  const c = rows[0];
  if (!c) { console.log("No matching contract"); process.exit(0); }

  console.log("=== EXAMPLE: IT CONTRACT WITH DOCS ===\n");
  console.log("METADATA:");
  console.log(`  Title: ${c.title}`);
  console.log(`  Agency: ${c.agency}`);
  console.log(`  NAICS: ${c.naicsCode}`);
  console.log(`  PSC: ${c.pscCode}`);
  console.log(`  Notice Type: ${c.noticeType}`);
  console.log(`  Set-Aside: ${c.setAsideCode ?? "none (full & open)"}`);
  console.log(`  Award Ceiling: ${c.awardCeiling ?? "not specified"}`);
  console.log(`  Response Deadline: ${c.responseDeadline}`);
  console.log(`  Place of Performance: ${c.popState ?? "not specified"}`);

  const links = (c.resourceLinks ?? []) as any[];
  console.log(`\n  Documents (${links.length}):`);

  for (let i = 0; i < links.length; i++) {
    const url = typeof links[i] === "string" ? links[i] : links[i].url;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!res.ok) { console.log(`    [${i+1}] Fetch failed: ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "";
      
      const text = await extractDocumentText(buf, ct, url);
      if (text) {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        console.log(`    [${i+1}] (${words.length} words)`);
        console.log(`      First 10: ${words.slice(0, 10).join(" ")}`);
        console.log(`      Last 10:  ${words.slice(-10).join(" ")}`);
      } else {
        console.log(`    [${i+1}] Could not extract text (${ct})`);
      }
    } catch (err) {
      console.log(`    [${i+1}] Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  process.exit(0);
}
main().catch(console.error);
