import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql, isNotNull } from "drizzle-orm";
import { fetchDescription } from "../src/lib/sam-gov/client";
import { extractDocumentText } from "../src/lib/sam-gov/documents";

async function main() {
  // Find a PENDING contract that has resource links (documents)
  const rows = await db.select({
    id: contracts.id,
    noticeId: contracts.noticeId,
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
    descriptionText: contracts.descriptionText,
    rawJson: contracts.rawJson,
  }).from(contracts)
    .where(eq(contracts.classification, "PENDING"))
    .orderBy(sql`jsonb_array_length(coalesce(resource_links, '[]'::jsonb)) desc`)
    .limit(5);

  // Pick one with docs
  const contract = rows.find(r => r.resourceLinks && r.resourceLinks.length > 0) ?? rows[0];

  console.log("=== EXAMPLE CONTRACT ===\n");
  console.log("METADATA (sent to Grok):");
  console.log(`  Title: ${contract.title}`);
  console.log(`  Agency: ${contract.agency}`);
  console.log(`  NAICS: ${contract.naicsCode}`);
  console.log(`  PSC: ${contract.pscCode}`);
  console.log(`  Notice Type: ${contract.noticeType}`);
  console.log(`  Set-Aside: ${contract.setAsideType} (${contract.setAsideCode})`);
  console.log(`  Award Ceiling: ${contract.awardCeiling ?? "null"}`);
  console.log(`  Response Deadline: ${contract.responseDeadline}`);
  console.log(`  Place of Performance: ${contract.popState}`);

  // Description text
  const rawJson = contract.rawJson as any;
  const descUrl = rawJson?.description;
  console.log(`\n  Description URL: ${descUrl ?? "none"}`);
  
  if (contract.descriptionText) {
    const words = contract.descriptionText.split(/\s+/);
    console.log(`  Description text (${words.length} words):`);
    console.log(`    First 10 words: ${words.slice(0, 10).join(" ")}`);
    console.log(`    Last 10 words: ${words.slice(-10).join(" ")}`);
  } else {
    console.log("  Description text: not yet fetched");
  }

  // Document links
  const links = contract.resourceLinks ?? [];
  console.log(`\n  Resource links (${links.length} documents):`);
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const url = typeof link === "string" ? link : (link as any).url;
    console.log(`    [${i + 1}] ${url}`);
  }

  // Try to download and extract one doc to show preview
  if (links.length > 0) {
    console.log("\n  Document previews (first 10 words / last 10 words):");
    for (let i = 0; i < Math.min(links.length, 3); i++) {
      const link = links[i];
      const url = typeof link === "string" ? link : (link as any).url;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          console.log(`    [${i + 1}] Failed to fetch: ${res.status}`);
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get("content-type") ?? "";
        const text = await extractDocumentText(buffer, contentType, url);
        if (text) {
          const words = text.split(/\s+/).filter(w => w.length > 0);
          console.log(`    [${i + 1}] (${words.length} words, ${contentType})`);
          console.log(`      First 10: ${words.slice(0, 10).join(" ")}`);
          console.log(`      Last 10:  ${words.slice(-10).join(" ")}`);
        } else {
          console.log(`    [${i + 1}] Could not extract text (${contentType})`);
        }
      } catch (err) {
        console.log(`    [${i + 1}] Error: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  process.exit(0);
}
main().catch(console.error);
