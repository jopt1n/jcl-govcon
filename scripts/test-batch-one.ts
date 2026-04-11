/**
 * Test: run the exact same code path as batch-classify.ts on ONE contract
 * that has resourceLinks and passes the pre-filter.
 * Downloads docs, builds prompt, sends to xAI, writes to DB.
 */

import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { downloadDocuments } from "../src/lib/sam-gov/documents";
import { extractAllDocumentTexts } from "../src/lib/document-text";
import { buildUnifiedClassificationPrompt } from "../src/lib/ai/prompts";
import type { UnifiedClassificationInput } from "../src/lib/ai/prompts";
import { getGrokClient, GROK_MODEL } from "../src/lib/ai/grok-client";

async function main() {
  // Pick an eligible contract with resourceLinks
  const [row] = await db
    .select({
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
      descriptionText: contracts.descriptionText,
      resourceLinks: contracts.resourceLinks,
      classification: contracts.classification,
      classificationRound: contracts.classificationRound,
    })
    .from(contracts)
    .where(
      sql`user_override = false
          AND (response_deadline IS NULL OR response_deadline > NOW())
          AND (set_aside_code IS NULL OR set_aside_code NOT IN ('8A','SDVOSB','HZ','WOSB','EDWOSB'))
          AND resource_links IS NOT NULL
          AND jsonb_array_length(resource_links) >= 2`
    )
    .orderBy(sql`jsonb_array_length(resource_links) DESC`)
    .limit(1);

  if (!row) {
    console.log("No eligible contract with 2+ docs found.");
    process.exit(1);
  }

  const linkCount = (row.resourceLinks || []).length;
  console.log(`CONTRACT ID:    ${row.id}`);
  console.log(`CONTRACT TITLE: ${row.title}`);
  console.log(`CURRENT:        ${row.classification} (round ${row.classificationRound})`);
  console.log(`RESOURCE LINKS: ${linkCount}`);
  console.log();

  // ── 1. Extract document texts ───────────────────────────────────────
  console.log("── Document extraction ──");
  const downloaded = await downloadDocuments(row.resourceLinks);
  const docTexts = await extractAllDocumentTexts(downloaded);
  console.log(`Downloaded: ${downloaded.length}, Extracted: ${docTexts.length}`);

  for (let i = 0; i < docTexts.length; i++) {
    const t = docTexts[i];
    if (!t || t.length === 0) {
      console.log(`  DOCUMENT ${i + 1}: EMPTY`);
    } else {
      const first20 = t.slice(0, 20).replace(/\n/g, "\\n");
      const last20 = t.slice(-20).replace(/\n/g, "\\n");
      console.log(`  DOCUMENT ${i + 1}: "${first20}"..."${last20}" (${t.length} chars)`);
    }
  }
  console.log();

  // ── 2. Build prompt ─────────────────────────────────────────────────
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

  // Compare: prompt with docs vs without
  const promptWithoutDocs = buildUnifiedClassificationPrompt({ ...input, documentTexts: [] });
  console.log(`── Prompt size ──`);
  console.log(`  Without documents: ${promptWithoutDocs.length} chars`);
  console.log(`  With documents:    ${prompt.length} chars`);
  console.log(`  Document content:  ${prompt.length - promptWithoutDocs.length} chars added`);
  console.log();

  // ── 3. Call xAI ─────────────────────────────────────────────────────
  console.log(`── Calling xAI (${GROK_MODEL}) ──`);
  const ai = getGrokClient();
  const startMs = Date.now();

  const response = await ai.chat.completions.create({
    model: GROK_MODEL,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - startMs;
  const rawContent = response.choices[0]?.message?.content;
  console.log(`  Response time: ${elapsed}ms`);
  console.log(`  Tokens: ${response.usage?.total_tokens}`);

  if (!rawContent) {
    console.error("Empty response from xAI");
    process.exit(1);
  }

  const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);

  console.log(`\n── Classification result ──`);
  console.log(`  CLASSIFICATION: ${parsed.classification}`);
  console.log(`  REASONING: ${parsed.reasoning}`);
  console.log();

  // ── 4. Write to DB ──────────────────────────────────────────────────
  const validClassifications = ["GOOD", "MAYBE", "DISCARD"];
  const classification = parsed.classification?.toUpperCase();

  const [updated] = await db
    .update(contracts)
    .set({
      classification: validClassifications.includes(classification) ? classification : row.classification,
      aiReasoning: parsed.reasoning || null,
      summary: parsed.summary || null,
      actionPlan: parsed.actionPlan ? JSON.stringify(parsed.actionPlan) : null,
      classificationRound: 4,
      classifiedFromMetadata: false,
      documentsAnalyzed: true,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, row.id))
    .returning();

  console.log(`── DB updated ──`);
  console.log(`  classificationRound: ${updated.classificationRound}`);
  console.log(`  documentsAnalyzed:   ${updated.documentsAnalyzed}`);
  console.log(`  classifiedFromMeta:  ${updated.classifiedFromMetadata}`);
  console.log(`  actionPlan stored:   ${updated.actionPlan ? updated.actionPlan.length + " chars" : "null"}`);

  if (updated.actionPlan) {
    console.log(`\n── Stored actionPlan ──`);
    console.log(JSON.stringify(JSON.parse(updated.actionPlan), null, 2));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
