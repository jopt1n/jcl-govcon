/**
 * End-to-end dry run: unified classification prompt on one real contract.
 * Downloads documents, builds prompt, sends to xAI, prints everything.
 * Does NOT write to the database.
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/test-unified-prompt.ts
 *   npx tsx --import ./scripts/load-env.ts scripts/test-unified-prompt.ts <contract-id>
 */

import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { downloadDocuments } from "../src/lib/sam-gov/documents";
import { extractAllDocumentTexts } from "../src/lib/document-text";
import { buildUnifiedClassificationPrompt } from "../src/lib/ai/prompts";
import type { UnifiedClassificationInput } from "../src/lib/ai/prompts";
import { getGrokClient, GROK_MODEL } from "../src/lib/ai/grok-client";

function summarize(label: string, text: string | null): void {
  if (!text || text.trim().length === 0) {
    console.log(`  ${label}: (empty/null)`);
    return;
  }
  const first20 = text.slice(0, 20);
  const last20 = text.slice(-20);
  console.log(`  ${label}: "${first20}"..."${last20}" (total: ${text.length} chars)`);
}

async function main() {
  const targetId = process.argv[2] || null;

  // Pick a contract: prefer one with 2+ resource links
  // Select only columns that exist in DB (contact_email may not be pushed yet)
  const cols = {
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
    classification: contracts.classification,
    descriptionText: contracts.descriptionText,
    resourceLinks: contracts.resourceLinks,
  };

  let row;
  if (targetId) {
    [row] = await db.select(cols).from(contracts).where(eq(contracts.id, targetId)).limit(1);
  } else {
    // Find GOOD/MAYBE with most resource links
    const candidates = await db
      .select(cols)
      .from(contracts)
      .where(
        and(
          inArray(contracts.classification, ["GOOD", "MAYBE"]),
          isNotNull(contracts.resourceLinks)
        )
      )
      .orderBy(sql`jsonb_array_length(resource_links) DESC`)
      .limit(1);
    row = candidates[0];
  }

  if (!row) {
    console.log("No matching contract found.");
    process.exit(0);
  }

  const linkCount = (row.resourceLinks || []).length;

  // ── 1. Contract info ────────────────────────────────────────────────
  console.log("=".repeat(80));
  console.log("CONTRACT");
  console.log("=".repeat(80));
  console.log(`  ID:             ${row.id}`);
  console.log(`  Notice ID:      ${row.noticeId}`);
  console.log(`  Title:          ${row.title}`);
  console.log(`  Agency:         ${row.agency}`);
  console.log(`  NAICS:          ${row.naicsCode}`);
  console.log(`  PSC:            ${row.pscCode}`);
  console.log(`  Set-Aside:      ${row.setAsideType} (${row.setAsideCode})`);
  console.log(`  Award Ceiling:  ${row.awardCeiling}`);
  console.log(`  Deadline:       ${row.responseDeadline}`);
  console.log(`  Classification: ${row.classification}`);
  console.log(`  Resource Links: ${linkCount} documents`);

  // ── 2. Download + extract document texts ────────────────────────────
  console.log();
  console.log("=".repeat(80));
  console.log("DATA SENT TO PROMPT");
  console.log("=".repeat(80));

  summarize("DESCRIPTION", row.descriptionText);

  const downloadedDocs = await downloadDocuments(row.resourceLinks);
  console.log(`  Downloaded:     ${downloadedDocs.length} of ${linkCount} documents`);

  const docTexts = await extractAllDocumentTexts(downloadedDocs);

  if (docTexts.length === 0) {
    console.log("  DOCUMENTS:      (none extracted)");
  } else {
    for (let i = 0; i < docTexts.length; i++) {
      summarize(`DOCUMENT ${i + 1}`, docTexts[i]);
    }
  }

  // ── 3. Build prompt ─────────────────────────────────────────────────
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
  console.log(`  Prompt length:  ${prompt.length} chars`);

  // ── 4. Call xAI ─────────────────────────────────────────────────────
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

  console.log(`  Response time:  ${elapsed}ms`);
  console.log(`  Finish reason:  ${response.choices[0]?.finish_reason}`);
  console.log(`  Usage:          ${JSON.stringify(response.usage)}`);

  // ── 5. Print full response ──────────────────────────────────────────
  console.log();
  console.log("=".repeat(80));
  console.log("FULL xAI RESPONSE (pretty-printed)");
  console.log("=".repeat(80));

  try {
    const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log("(Failed to parse as JSON — raw output below)");
    console.log(rawContent);
  }

  console.log();
  console.log("=== DRY RUN — no DB changes made ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
