/**
 * Debug script: shows exactly what gets sent to xAI and what comes back.
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/debug-action-plan.ts
 */

import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { downloadDocuments } from "../src/lib/sam-gov/documents";
import { buildUnifiedClassificationPrompt } from "../src/lib/ai/prompts";
import type { UnifiedClassificationInput } from "../src/lib/ai/prompts";
import { getGrokClient, GROK_MODEL } from "../src/lib/ai/grok-client";

async function main() {
  // Target a specific contract with documents, or fall back to first GOOD/MAYBE
  const targetId = process.argv[2] || null;
  const [row] = targetId
    ? await db.select().from(contracts).where(eq(contracts.id, targetId)).limit(1)
    : await db
        .select()
        .from(contracts)
        .where(and(inArray(contracts.classification, ["GOOD", "MAYBE"]), isNull(contracts.actionPlan)))
        .limit(1);

  if (!row) {
    console.log("No GOOD/MAYBE contracts without action plans found.");
    process.exit(0);
  }

  console.log("=".repeat(80));
  console.log("CONTRACT");
  console.log("=".repeat(80));
  console.log(`ID:             ${row.id}`);
  console.log(`Notice ID:      ${row.noticeId}`);
  console.log(`Title:          ${row.title}`);
  console.log(`Agency:         ${row.agency}`);
  console.log(`NAICS:          ${row.naicsCode}`);
  console.log(`Award Ceiling:  ${row.awardCeiling}`);
  console.log(`Deadline:       ${row.responseDeadline}`);
  console.log(`Classification: ${row.classification}`);
  console.log(`Resource Links: ${(row.resourceLinks || []).length} documents`);
  console.log();

  // Download and extract document texts
  console.log("=".repeat(80));
  console.log("DOCUMENT EXTRACTION");
  console.log("=".repeat(80));

  const downloadedDocs = await downloadDocuments(row.resourceLinks);
  console.log(`Downloaded: ${downloadedDocs.length} documents`);

  const docTexts: string[] = [];
  for (const doc of downloadedDocs) {
    console.log(`\n  File: ${doc.filename} (${doc.contentType}, ${doc.buffer.length} bytes)`);
    try {
      let text = "";
      const ct = doc.contentType;
      if (ct.includes("pdf")) {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(doc.buffer) });
        const result = await parser.getText();
        await parser.destroy();
        text = result.text?.trim() || "";
      } else if (ct.includes("spreadsheet") || ct.includes("ms-excel")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(doc.buffer), { type: "array" });
        text = wb.SheetNames.map((name) => XLSX.utils.sheet_to_txt(wb.Sheets[name])).join("\n").trim();
      } else if (ct.includes("wordprocessing") || ct.includes("msword")) {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ buffer: doc.buffer });
        text = result.value ? result.value.replace(/<[^>]+>/g, " ").trim() : "";
      } else {
        console.log(`  Skipped: unsupported type "${ct}"`);
      }

      if (text) {
        docTexts.push(text);
        const words = text.split(/\s+/);
        const first10 = words.slice(0, 10).join(" ");
        const last10 = words.slice(-10).join(" ");
        console.log(`  Extracted: ${words.length} words (${text.length} chars)`);
        console.log(`  FIRST 10 WORDS: "${first10}"`);
        console.log(`  LAST 10 WORDS:  "${last10}"`);
      } else {
        console.log(`  Extracted: (empty — likely scanned image)`);
      }
    } catch (err) {
      console.log(`  Extraction failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Build the prompt
  console.log();
  console.log("=".repeat(80));
  console.log("FULL PROMPT SENT TO xAI");
  console.log("=".repeat(80));

  const deadline = row.responseDeadline;
  const input: UnifiedClassificationInput = {
    title: row.title,
    agency: row.agency,
    naicsCode: row.naicsCode,
    pscCode: row.pscCode,
    noticeType: row.noticeType,
    setAsideType: row.setAsideType,
    setAsideCode: row.setAsideCode,
    awardCeiling: row.awardCeiling,
    responseDeadline: deadline instanceof Date ? deadline.toISOString() : deadline ? String(deadline) : null,
    popState: row.popState,
    descriptionText: row.descriptionText,
    documentTexts: docTexts,
  };

  const prompt = buildUnifiedClassificationPrompt(input);
  console.log(prompt);
  console.log();
  console.log(`--- Prompt length: ${prompt.length} chars ---`);

  // Call xAI
  console.log();
  console.log("=".repeat(80));
  console.log(`CALLING xAI (model: ${GROK_MODEL})`);
  console.log("=".repeat(80));

  const ai = getGrokClient();
  const startMs = Date.now();

  const response = await ai.chat.completions.create({
    model: GROK_MODEL,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - startMs;
  const rawContent = response.choices[0]?.message?.content || "(empty)";

  console.log(`\nResponse time: ${elapsed}ms`);
  console.log(`Finish reason: ${response.choices[0]?.finish_reason}`);
  console.log(`Usage: ${JSON.stringify(response.usage)}`);
  console.log();
  console.log("=".repeat(80));
  console.log("RAW xAI RESPONSE");
  console.log("=".repeat(80));
  console.log(rawContent);

  // Pretty print
  console.log();
  console.log("=".repeat(80));
  console.log("PARSED ACTION PLAN");
  console.log("=".repeat(80));
  try {
    const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log("(Failed to parse as JSON)");
  }

  console.log("\n=== DRY RUN — no DB changes made ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
