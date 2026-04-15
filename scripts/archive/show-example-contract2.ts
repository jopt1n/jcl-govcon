import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";

async function main() {
  // Find a PENDING contract with 1-5 documents
  const rows = await db.select({
    title: contracts.title,
    agency: contracts.agency,
    naicsCode: contracts.naicsCode,
    pscCode: contracts.pscCode,
    noticeType: contracts.noticeType,
    setAsideType: contracts.setAsideType,
    setAsideCode: contracts.setAsideCode,
    awardCeiling: contracts.awardCeiling,
    responseDeadline: contracts.responseDeadline,
    popState: contracts.popState,
    resourceLinks: contracts.resourceLinks,
    rawJson: contracts.rawJson,
  }).from(contracts)
    .where(and(
      eq(contracts.classification, "PENDING"),
      sql`jsonb_array_length(coalesce(resource_links, '[]'::jsonb)) between 1 and 5`
    ))
    .limit(1);

  const c = rows[0];
  if (!c) { console.log("No contracts found"); process.exit(0); }

  console.log("=== EXAMPLE CONTRACT ===\n");
  console.log("METADATA:");
  console.log(`  Title: ${c.title}`);
  console.log(`  Agency: ${c.agency}`);
  console.log(`  NAICS: ${c.naicsCode}`);
  console.log(`  PSC: ${c.pscCode}`);
  console.log(`  Notice Type: ${c.noticeType}`);
  console.log(`  Set-Aside: ${c.setAsideCode ?? "none"}`);
  console.log(`  Award Ceiling: ${c.awardCeiling ?? "null"}`);
  console.log(`  Response Deadline: ${c.responseDeadline}`);
  console.log(`  Place of Performance: ${c.popState ?? "null"}`);

  const rawJson = c.rawJson as any;
  console.log(`\n  Description URL: ${rawJson?.description ?? "none"}`);

  const links = (c.resourceLinks ?? []) as any[];
  console.log(`\n  Documents (${links.length}):`);
  
  for (let i = 0; i < links.length; i++) {
    const url = typeof links[i] === "string" ? links[i] : links[i].url;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) { console.log(`    [${i+1}] Fetch failed: ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "";
      
      // Simple text extraction
      let text = "";
      if (ct.includes("pdf")) {
        const pdfParse = (await import("pdf-parse")).default;
        const parsed = await pdfParse(buf);
        text = parsed.text;
      } else if (ct.includes("text") || ct.includes("html")) {
        text = buf.toString("utf-8").replace(/<[^>]+>/g, " ");
      } else if (ct.includes("spreadsheet") || ct.includes("excel") || url.endsWith(".xlsx")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf);
        text = wb.SheetNames.map(s => XLSX.utils.sheet_to_csv(wb.Sheets[s])).join("\n");
      }
      
      if (text) {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        console.log(`    [${i+1}] ${ct} (${words.length} words)`);
        console.log(`      First 10: ${words.slice(0, 10).join(" ")}`);
        console.log(`      Last 10:  ${words.slice(-10).join(" ")}`);
      } else {
        console.log(`    [${i+1}] ${ct} — could not extract text`);
      }
    } catch (err) {
      console.log(`    [${i+1}] Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  process.exit(0);
}
main().catch(console.error);
