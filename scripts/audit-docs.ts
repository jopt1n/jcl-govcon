/**
 * Document extraction audit for the 1,171 eligible contracts.
 */

import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { downloadDocuments } from "../src/lib/sam-gov/documents";
import { extractAllDocumentTexts } from "../src/lib/document-text";

async function main() {
  // ── 1 & 2: Count and breakdown ──────────────────────────────────────
  const rows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      resourceLinks: contracts.resourceLinks,
    })
    .from(contracts)
    .where(
      sql`user_override = false
          AND (response_deadline IS NULL OR response_deadline > NOW())
          AND (set_aside_code IS NULL OR set_aside_code NOT IN ('8A','SDVOSB','HZ','WOSB','EDWOSB'))`
    );

  console.log(`Total eligible contracts: ${rows.length}`);

  let withLinks = 0;
  let totalLinks = 0;
  const extCounts: Record<string, number> = {};
  const contractsWithXlsx: typeof rows = [];

  for (const r of rows) {
    const links = (r.resourceLinks || []).filter(Boolean);
    if (links.length > 0) {
      withLinks++;
      totalLinks += links.length;
      for (const link of links) {
        try {
          const url = new URL(link);
          const path = url.pathname;
          const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "(no-ext)";
          extCounts[ext] = (extCounts[ext] || 0) + 1;
          if (ext === ".xlsx" || ext === ".xls") {
            if (!contractsWithXlsx.some((c) => c.id === r.id)) {
              contractsWithXlsx.push(r);
            }
          }
        } catch {
          // SAM.gov download URLs often have no extension — they're API endpoints
          extCounts["(api-url)"] = (extCounts["(api-url)"] || 0) + 1;
        }
      }
    }
  }

  console.log(`\n── 1. Contracts with resourceLinks ──`);
  console.log(`With documents: ${withLinks} of ${rows.length}`);
  console.log(`Without documents: ${rows.length - withLinks}`);
  console.log(`Total document URLs: ${totalLinks}`);

  console.log(`\n── 2. Document types by extension ──`);
  const sorted = Object.entries(extCounts).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sorted) {
    console.log(`  ${ext.padEnd(12)} ${count}`);
  }

  // ── 3. Pick 5 contracts for extraction test ─────────────────────────
  console.log(`\n── 3. Extraction test on 5 contracts ──`);
  console.log(`(Contracts with .xlsx/.xls: ${contractsWithXlsx.length})`);

  // Pick 2 xlsx contracts + 3 random others
  const withLinksRows = rows.filter((r) => (r.resourceLinks || []).length > 0);
  const picks: typeof rows = [];
  // Add up to 2 xlsx ones
  for (const c of contractsWithXlsx.slice(0, 2)) {
    picks.push(c);
  }
  // Fill remaining from random with-links contracts (skip ones already picked)
  const pickedIds = new Set(picks.map((p) => p.id));
  const shuffled = withLinksRows.filter((r) => !pickedIds.has(r.id)).sort(() => Math.random() - 0.5);
  for (const c of shuffled) {
    if (picks.length >= 5) break;
    picks.push(c);
  }

  let xlsxSamplePrinted = false;

  for (let pi = 0; pi < picks.length; pi++) {
    const r = picks[pi];
    const links = (r.resourceLinks || []).filter(Boolean);
    const exts = links.map((l) => {
      try {
        const path = new URL(l).pathname;
        return path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "(api)";
      } catch { return "(api)"; }
    });

    console.log(`\n  CONTRACT ${pi + 1}: ${r.title.slice(0, 70)}`);
    console.log(`  ID: ${r.id}`);
    console.log(`  Links: ${links.length} — extensions: [${exts.join(", ")}]`);

    try {
      const downloaded = await downloadDocuments(r.resourceLinks);
      const docTexts = await extractAllDocumentTexts(downloaded);

      for (let di = 0; di < downloaded.length; di++) {
        const doc = downloaded[di];
        const ext = doc.filename.includes(".") ? doc.filename.slice(doc.filename.lastIndexOf(".")).toLowerCase() : "(none)";
        const text = di < docTexts.length ? docTexts[di] : null;

        if (!text || text.length === 0) {
          console.log(`  DOCUMENT ${di + 1} (${ext}): EMPTY`);
        } else {
          const first20 = text.slice(0, 20).replace(/\n/g, "\\n");
          const last20 = text.slice(-20).replace(/\n/g, "\\n");
          console.log(`  DOCUMENT ${di + 1} (${ext}): "${first20}"..."${last20}" (${text.length} chars)`);

          // ── 4. Show xlsx content sample ────────────────────────
          if (!xlsxSamplePrinted && (ext === ".xlsx" || ext === ".xls")) {
            console.log(`\n  ── 4. XLSX SAMPLE (first 500 chars) ──`);
            console.log(text.slice(0, 500));
            console.log(`  ── end sample ──\n`);
            xlsxSamplePrinted = true;
          }
        }
      }

      // Note docs that failed to download
      if (downloaded.length < links.length) {
        console.log(`  (${links.length - downloaded.length} documents failed to download)`);
      }
    } catch (err) {
      console.log(`  EXTRACTION ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!xlsxSamplePrinted) {
    console.log("\n  ── 4. No .xlsx/.xls files found in sampled contracts ──");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
