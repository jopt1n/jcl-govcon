/**
 * Classify ONE contract with the unified prompt and write result to DB.
 * Picks a contract that passes the pre-filter (future deadline, no restricted set-aside).
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/test-one-write.ts
 *   npx tsx --import ./scripts/load-env.ts scripts/test-one-write.ts <contract-id>
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
  const targetId = process.argv[2] || null;

  // Pick a contract
  let [row] = targetId
    ? await db.select().from(contracts).where(eq(contracts.id, targetId)).limit(1)
    : await db.select().from(contracts).where(
        sql`user_override = false
            AND (response_deadline IS NULL OR response_deadline > NOW())
            AND (set_aside_code IS NULL OR set_aside_code NOT IN ('8A','SDVOSB','HZ','WOSB','EDWOSB'))`
      ).orderBy(sql`response_deadline ASC NULLS LAST`).limit(1);

  if (!row) {
    console.log("No eligible contract found.");
    process.exit(1);
  }

  console.log(`CONTRACT ID:    ${row.id}`);
  console.log(`CONTRACT TITLE: ${row.title}`);
  console.log(`NAICS:          ${row.naicsCode}`);
  console.log(`DEADLINE:       ${row.responseDeadline}`);
  console.log(`SET-ASIDE:      ${row.setAsideCode}`);
  console.log(`CURRENT CLASS:  ${row.classification}`);
  console.log(`CURRENT ROUND:  ${row.classificationRound}`);
  console.log();

  // Download docs + extract text
  const downloadedDocs = await downloadDocuments(row.resourceLinks);
  const docTexts = await extractAllDocumentTexts(downloadedDocs);
  console.log(`Documents: ${downloadedDocs.length} downloaded, ${docTexts.length} extracted`);

  // Build prompt
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
  console.log(`Prompt: ${prompt.length} chars`);

  // Call xAI
  console.log(`\nCalling xAI (${GROK_MODEL})...`);
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
  console.log(`Response: ${elapsed}ms, ${response.usage?.total_tokens} tokens`);

  if (!rawContent) {
    console.error("Empty response from xAI");
    process.exit(1);
  }

  // Parse unified response
  const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);

  const classification = parsed.classification?.toUpperCase();
  console.log(`\nCLASSIFICATION: ${classification}`);
  console.log(`REASONING: ${parsed.reasoning}`);

  // Write to DB
  const validClassifications = ["GOOD", "MAYBE", "DISCARD"];
  const [updated] = await db
    .update(contracts)
    .set({
      classification: validClassifications.includes(classification) ? classification : row.classification,
      aiReasoning: parsed.reasoning || row.aiReasoning,
      summary: parsed.summary || row.summary,
      actionPlan: parsed.actionPlan ? JSON.stringify(parsed.actionPlan) : null,
      classificationRound: 4,
      classifiedFromMetadata: false,
      documentsAnalyzed: true,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, row.id))
    .returning();

  console.log(`\nDB UPDATED: ${updated.id}`);
  console.log(`  classification:      ${updated.classification}`);
  console.log(`  classificationRound: ${updated.classificationRound}`);
  console.log(`  documentsAnalyzed:   ${updated.documentsAnalyzed}`);
  console.log(`  classifiedFromMeta:  ${updated.classifiedFromMetadata}`);
  console.log(`  actionPlan stored:   ${updated.actionPlan ? "yes (" + updated.actionPlan.length + " chars)" : "null"}`);

  if (updated.actionPlan) {
    console.log("\nSTORED ACTION PLAN:");
    console.log(JSON.stringify(JSON.parse(updated.actionPlan), null, 2));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
