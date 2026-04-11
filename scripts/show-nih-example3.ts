import pdf from "pdf-parse";

async function main() {
  const url = "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/b6f13bb86a204e6eaf440e6745e76f5b/download";
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "follow" });
  const buf = Buffer.from(await res.arrayBuffer());
  
  const parsed = await pdf(buf);
  const words = parsed.text.split(/\s+/).filter((w: string) => w.length > 0);
  
  console.log("=== EXAMPLE CONTRACT ===\n");
  console.log("METADATA (what gets sent to Grok):");
  console.log("  Title: NIH Professional, Scientific and Technical Support Services");
  console.log("  Agency: HEALTH AND HUMAN SERVICES.NATIONAL INSTITUTES OF HEALTH");
  console.log("  NAICS: 541715 (R&D in Physical/Engineering/Life Sciences)");
  console.log("  PSC: AJ13 (Technical Evaluation/Testing)");
  console.log("  Notice Type: Solicitation");
  console.log("  Set-Aside: SBA (Total Small Business)");
  console.log("  Response Deadline: Apr 21, 2026");
  console.log("  Place of Performance: not specified");
  console.log(`\nDOCUMENT [1]: RFP PDF (${words.length} words, ${(buf.length/1024).toFixed(0)}KB)`);
  console.log(`  First 10 words: ${words.slice(0, 10).join(" ")}`);
  console.log(`  Last 10 words:  ${words.slice(-10).join(" ")}`);

  process.exit(0);
}
main().catch(console.error);
