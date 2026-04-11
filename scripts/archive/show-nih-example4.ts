import { extractDocumentText } from "../src/lib/document-text";
import type { DownloadedDocument } from "../src/lib/sam-gov/types";

async function main() {
  const url = "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/b6f13bb86a204e6eaf440e6745e76f5b/download";
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "follow" });
  const buf = Buffer.from(await res.arrayBuffer());
  
  const doc: DownloadedDocument = {
    url,
    filename: "PSTSS_RFP.pdf",
    contentType: "application/pdf",
    buffer: buf,
  };
  
  const text = await extractDocumentText(doc);
  if (!text) { console.log("No text extracted"); process.exit(1); }
  
  const words = text.split(/\s+/).filter((w: string) => w.length > 0);
  
  console.log("=== EXAMPLE CONTRACT ===\n");
  console.log("METADATA (sent to Grok):");
  console.log("  Title: NIH Professional, Scientific and Technical Support Services");
  console.log("  Agency: HEALTH AND HUMAN SERVICES.NATIONAL INSTITUTES OF HEALTH");
  console.log("  NAICS: 541715");
  console.log("  PSC: AJ13");
  console.log("  Notice Type: Solicitation");
  console.log("  Set-Aside: SBA (Total Small Business)");
  console.log("  Response Deadline: Apr 21, 2026");
  console.log(`\nDOCUMENT [1]: RFP PDF (${words.length} words, ${(buf.length/1024).toFixed(0)}KB)`);
  console.log(`  First 10 words: ${words.slice(0, 10).join(" ")}`);
  console.log(`  Last 10 words:  ${words.slice(-10).join(" ")}`);

  process.exit(0);
}
main().catch(console.error);
