/**
 * Backfill action plans for existing GOOD/MAYBE contracts.
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/generate-action-plans.ts --dry-run --limit 5
 *   npx tsx --import ./scripts/load-env.ts scripts/generate-action-plans.ts --limit 10
 *   npx tsx --import ./scripts/load-env.ts scripts/generate-action-plans.ts
 */

import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { downloadDocuments } from "../src/lib/sam-gov/documents";
import { generateActionPlan } from "../src/lib/ai/classifier";

// ── CLI args ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const skipIdx = args.indexOf("--skip");
const SKIP = skipIdx !== -1 ? parseInt(args[skipIdx + 1], 10) : 0;

async function extractDocTexts(resourceLinks: string[] | null): Promise<string[]> {
  const docs = await downloadDocuments(resourceLinks);
  const texts: string[] = [];

  for (const doc of docs) {
    try {
      const ct = doc.contentType;
      if (ct.includes("pdf")) {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(doc.buffer) });
        const result = await parser.getText();
        await parser.destroy();
        if (result.text?.trim()) texts.push(result.text.trim());
      } else if (ct.includes("spreadsheet") || ct.includes("ms-excel")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(doc.buffer), { type: "array" });
        const sheetTexts = wb.SheetNames.map((name) => XLSX.utils.sheet_to_txt(wb.Sheets[name])).join("\n");
        if (sheetTexts.trim()) texts.push(sheetTexts.trim());
      } else if (ct.includes("wordprocessing") || ct.includes("msword")) {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ buffer: doc.buffer });
        if (result.value) texts.push(result.value.replace(/<[^>]+>/g, " ").trim());
      } else {
        // Unknown — try pdf-parse first, then mammoth
        try {
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse({ data: new Uint8Array(doc.buffer) });
          const result = await parser.getText();
          await parser.destroy();
          if (result.text?.trim()) { texts.push(result.text.trim()); continue; }
        } catch { /* not a PDF */ }
        try {
          const mammoth = await import("mammoth");
          const result = await mammoth.convertToHtml({ buffer: doc.buffer });
          if (result.value) texts.push(result.value.replace(/<[^>]+>/g, " ").trim());
        } catch { /* not a DOCX */ }
      }
    } catch {
      // Skip unparseable documents
    }
  }

  return texts;
}

async function main() {
  console.log(`\n=== Generate Action Plans ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Limit: ${LIMIT === Infinity ? "all" : LIMIT}`);
  console.log(`Skip: ${SKIP}`);

  // Find GOOD/MAYBE contracts without action plans
  const rows = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      title: contracts.title,
      agency: contracts.agency,
      naicsCode: contracts.naicsCode,
      awardCeiling: contracts.awardCeiling,
      responseDeadline: contracts.responseDeadline,
      descriptionText: contracts.descriptionText,
      resourceLinks: contracts.resourceLinks,
      classification: contracts.classification,
    })
    .from(contracts)
    .where(
      and(
        inArray(contracts.classification, ["GOOD", "MAYBE"]),
        isNull(contracts.actionPlan)
      )
    )
    .orderBy(contracts.updatedAt);

  const total = rows.length;
  const toProcess = rows.slice(SKIP, SKIP + LIMIT);

  console.log(`\nFound ${total} contracts needing action plans`);
  console.log(`Processing ${toProcess.length} (skip=${SKIP}, limit=${LIMIT})\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    console.log(`${progress} ${row.noticeId} — "${row.title.slice(0, 60)}..."`);

    try {
      // Extract document texts
      const docTexts = await extractDocTexts(row.resourceLinks);
      console.log(`  Documents: ${docTexts.length} texts extracted`);

      // Generate action plan
      const plan = await generateActionPlan(
        {
          title: row.title,
          agency: row.agency,
          naicsCode: row.naicsCode,
          awardCeiling: row.awardCeiling,
          responseDeadline: row.responseDeadline,
          descriptionText: row.descriptionText,
        },
        docTexts
      );

      if (!plan) {
        console.log(`  ✗ Failed to generate plan`);
        failed++;
        continue;
      }

      // Parse to show summary
      const parsed = JSON.parse(plan);
      console.log(`  ✓ ${parsed.implementationSteps?.length || 0} steps, effort: ${parsed.estimatedEffort}`);

      if (!DRY_RUN) {
        await db
          .update(contracts)
          .set({ actionPlan: plan, updatedAt: new Date() })
          .where(eq(contracts.id, row.id));
      }

      success++;
    } catch (err) {
      console.log(`  ✗ Error: ${err instanceof Error ? err.message : err}`);
      failed++;
    }

    // Rate limit: 500ms between calls
    if (i < toProcess.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Success: ${success}, Failed: ${failed}`);
  if (DRY_RUN) console.log(`(Dry run — no DB updates made)`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
