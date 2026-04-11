import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";

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
      sql`jsonb_array_length(coalesce(resource_links, '[]'::jsonb)) between 1 and 5`,
      sql`psc_code like 'D%' or psc_code like 'R%'`
    ))
    .limit(1);

  const c = rows[0];
  if (!c) { console.log("No matching contract"); process.exit(0); }

  console.log("=== EXAMPLE CONTRACT (services/IT) ===\n");
  console.log("METADATA (what Grok sees):");
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
      const res = await fetch(url, { 
        signal: AbortSignal.timeout(15000),
        redirect: "follow" 
      });
      if (!res.ok) { console.log(`    [${i+1}] Fetch failed: ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      
      // Magic byte sniffing
      const isPdf = buf[0] === 0x25 && buf[1] === 0x50; // %P
      const isZip = buf[0] === 0x50 && buf[1] === 0x4B; // PK (xlsx/docx)
      const ct = res.headers.get("content-type") ?? "";
      const finalUrl = res.url;
      
      let text = "";
      let fileType = ct;
      
      if (isPdf || ct.includes("pdf")) {
        fileType = "PDF";
        const pdfParse = (await import("pdf-parse")).default;
        const parsed = await pdfParse(buf);
        text = parsed.text;
      } else if (isZip) {
        // Try xlsx first
        try {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buf);
          text = wb.SheetNames.map(s => XLSX.utils.sheet_to_csv(wb.Sheets[s])).join("\n");
          fileType = "XLSX";
        } catch {
          fileType = "ZIP/DOCX (could not parse)";
        }
      } else if (ct.includes("text") || ct.includes("html")) {
        text = buf.toString("utf-8").replace(/<[^>]+>/g, " ");
        fileType = "HTML/Text";
      }

      if (text) {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        console.log(`    [${i+1}] ${fileType} (${words.length} words)`);
        console.log(`      First 10: ${words.slice(0, 10).join(" ")}`);
        console.log(`      Last 10:  ${words.slice(-10).join(" ")}`);
      } else {
        console.log(`    [${i+1}] ${fileType} — could not extract text`);
      }
    } catch (err) {
      console.log(`    [${i+1}] Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  process.exit(0);
}
main().catch(console.error);
