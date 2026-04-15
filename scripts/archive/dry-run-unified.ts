/**
 * Dry-run: unified classification prompt on one real contract.
 * Prints all data being sent, calls xAI, prints full raw response.
 * Does NOT write to the database.
 */

import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { and, inArray, isNotNull, sql, eq } from "drizzle-orm";
import { downloadDocuments } from "../src/lib/sam-gov/documents";
import { extractAllDocumentTexts } from "../src/lib/document-text";
import { buildUnifiedClassificationPrompt } from "../src/lib/ai/prompts";
import type { UnifiedClassificationInput } from "../src/lib/ai/prompts";
import { getGrokClient, GROK_MODEL } from "../src/lib/ai/grok-client";

async function main() {
  // ── 1. Pick a contract ──────────────────────────────────────────────
  const targetId = process.argv[2] || null;

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
    // Find GOOD/MAYBE with description and 2+ resource links
    const candidates = await db
      .select(cols)
      .from(contracts)
      .where(
        and(
          inArray(contracts.classification, ["GOOD", "MAYBE"]),
          isNotNull(contracts.resourceLinks),
          isNotNull(contracts.descriptionText)
        )
      )
      .orderBy(sql`jsonb_array_length(resource_links) DESC`)
      .limit(20);

    row = candidates.find((c) => {
      const n = (c.resourceLinks || []).length;
      return n >= 2 && n <= 5;
    }) || candidates.find((c) => (c.resourceLinks || []).length >= 2);
  }

  if (!row) {
    console.log("No matching contract found.");
    process.exit(1);
  }

  console.log(`CONTRACT ID: ${row.id}`);
  console.log(`CONTRACT TITLE: ${row.title}`);
  console.log();

  // ── 2. Extract description and document texts ───────────────────────
  const downloadedDocs = await downloadDocuments(row.resourceLinks);
  const docTexts = await extractAllDocumentTexts(downloadedDocs);

  // ── 3. Print exact data ─────────────────────────────────────────────
  const desc = row.descriptionText;
  if (!desc || desc.trim().length === 0) {
    console.log("DESCRIPTION TEXT: EMPTY/NULL — no description");
  } else {
    console.log("DESCRIPTION TEXT:");
    console.log(`First 20 chars: "${desc.slice(0, 20)}"`);
    console.log(`Last 20 chars: "${desc.slice(-20)}"`);
    console.log(`Total length: ${desc.length} characters`);
  }
  console.log();

  const linkCount = (row.resourceLinks || []).length;
  console.log(`RESOURCE LINKS: ${linkCount} URLs`);
  console.log(`DOWNLOADED: ${downloadedDocs.length} documents`);
  console.log(`EXTRACTED: ${docTexts.length} document texts`);
  console.log();

  for (let i = 0; i < linkCount; i++) {
    if (i < docTexts.length && docTexts[i] && docTexts[i].length > 0) {
      const t = docTexts[i];
      console.log(`DOCUMENT ${i + 1}:`);
      console.log(`First 20 chars: "${t.slice(0, 20)}"`);
      console.log(`Last 20 chars: "${t.slice(-20)}"`);
      console.log(`Total length: ${t.length} characters`);
    } else {
      console.log(`DOCUMENT ${i + 1}: EMPTY/NULL — no text extracted`);
    }
    console.log();
  }

  // Handle case where more texts than links (shouldn't happen but be safe)
  for (let i = linkCount; i < docTexts.length; i++) {
    const t = docTexts[i];
    console.log(`DOCUMENT ${i + 1} (extra):`);
    console.log(`First 20 chars: "${t.slice(0, 20)}"`);
    console.log(`Last 20 chars: "${t.slice(-20)}"`);
    console.log(`Total length: ${t.length} characters`);
    console.log();
  }

  // ── 4. Build prompt ─────────────────────────────────────────────────
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
  console.log(`PROMPT LENGTH: ${prompt.length} characters`);
  console.log();

  // ── 5. Call xAI ─────────────────────────────────────────────────────
  console.log(`CALLING xAI (model: ${GROK_MODEL})...`);
  const ai = getGrokClient();
  const startMs = Date.now();

  const response = await ai.chat.completions.create({
    model: GROK_MODEL,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - startMs;
  console.log(`Response time: ${elapsed}ms`);
  console.log(`Finish reason: ${response.choices[0]?.finish_reason}`);
  console.log(`Usage: ${JSON.stringify(response.usage)}`);
  console.log();

  // ── 6. Print COMPLETE raw JSON response ─────────────────────────────
  const rawContent = response.choices[0]?.message?.content || "(empty)";
  console.log("COMPLETE RAW JSON RESPONSE:");
  console.log(rawContent);

  // ── 7. No DB writes ─────────────────────────────────────────────────
  console.log();
  console.log("DRY RUN — no DB changes made.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
