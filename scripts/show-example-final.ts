import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { extractDocumentText } from "../src/lib/document-text";

async function main() {
  // Get a few IT/services contracts with docs to find one with readable content
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
  }).from(contracts)
    .where(and(
      eq(contracts.classification, "PENDING"),
      sql`jsonb_array_length(coalesce(resource_links, '[]'::jsonb)) between 1 and 5`,
      sql`psc_code like 'D%' or psc_code like 'R%' or psc_code like 'A%'`
    ))
    .offset(0)
    .limit(20);

  for (const c of rows) {
    const links = (c.resourceLinks ?? []) as any[];
    const url = typeof links[0] === "string" ? links[0] : links[0]?.url;
    if (!url) continue;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      
      // Magic byte sniff
      const isPdf = buf[0] === 0x25 && buf[1] === 0x50;
      const isZip = buf[0] === 0x50 && buf[1] === 0x4B;
      let ct = res.headers.get("content-type") ?? "";
      if (isPdf) ct = "application/pdf";
      else if (isZip) ct = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      
      const text = await extractDocumentText(buf, ct, url);
      if (!text || text.length < 100) continue;

      const words = text.split(/\s+/).filter(w => w.length > 0);
      
      console.log("=== EXAMPLE CONTRACT ===\n");
      console.log("METADATA (sent to Grok):");
      console.log(`  Title: ${c.title}`);
      console.log(`  Agency: ${c.agency}`);
      console.log(`  NAICS: ${c.naicsCode}`);
      console.log(`  PSC: ${c.pscCode}`);
      console.log(`  Notice Type: ${c.noticeType}`);
      console.log(`  Set-Aside: ${c.setAsideCode ?? "none (full & open)"}`);
      console.log(`  Award Ceiling: ${c.awardCeiling ?? "not specified"}`);
      console.log(`  Response Deadline: ${c.responseDeadline}`);
      console.log(`  Place of Performance: ${c.popState ?? "not specified"}`);
      console.log(`\n  Documents (${links.length} total):`);
      console.log(`    [1] ${words.length} words extracted`);
      console.log(`      First 10: ${words.slice(0, 10).join(" ")}`);
      console.log(`      Last 10:  ${words.slice(-10).join(" ")}`);
      
      // Show remaining docs info
      for (let i = 1; i < links.length; i++) {
        const u2 = typeof links[i] === "string" ? links[i] : links[i]?.url;
        console.log(`    [${i+1}] ${u2?.substring(u2.lastIndexOf("/") - 8, u2.lastIndexOf("/"))}`);
      }
      
      process.exit(0);
    } catch { continue; }
  }

  console.log("Could not find a contract with extractable docs in this batch");
  process.exit(0);
}
main().catch(console.error);
