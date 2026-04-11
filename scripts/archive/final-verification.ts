/**
 * Final verification: 5 contracts through the exact batch-classify code path.
 * Prints every detail. Writes to DB with classificationRound=4.
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
  // Pick 5 contracts with different doc counts, all with resourceLinks
  const candidates = await db
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
    .orderBy(sql`random()`)
    .limit(100);

  // Sort by link count, pick diverse set
  const sorted = candidates.sort((a, b) => (a.resourceLinks || []).length - (b.resourceLinks || []).length);
  const picks: typeof candidates = [];

  // ~2 docs
  const small = sorted.find((c) => {
    const n = (c.resourceLinks || []).length;
    return n >= 2 && n <= 3;
  });
  if (small) picks.push(small);

  // ~5 docs
  const medium = sorted.find((c) => {
    const n = (c.resourceLinks || []).length;
    return n >= 4 && n <= 6 && !picks.includes(c);
  });
  if (medium) picks.push(medium);

  // ~10 docs
  const large = sorted.find((c) => {
    const n = (c.resourceLinks || []).length;
    return n >= 8 && n <= 12 && !picks.includes(c);
  });
  if (large) picks.push(large);

  // 15+ docs
  const xl = sorted.find((c) => {
    const n = (c.resourceLinks || []).length;
    return n >= 15 && !picks.includes(c);
  });
  if (xl) picks.push(xl);

  // Fill remaining
  for (const c of sorted) {
    if (picks.length >= 5) break;
    if (!picks.includes(c)) picks.push(c);
  }

  const ai = getGrokClient();
  let totalDocsExtracted = 0;
  const failures: { contractId: string; docNum: number; reason: string }[] = [];
  const emptyWhenShouldnt: string[] = [];
  const classifications: { title: string; classification: string }[] = [];

  for (let pi = 0; pi < picks.length; pi++) {
    const row = picks[pi];
    const linkCount = (row.resourceLinks || []).length;

    console.log(`============================================`);
    console.log(`CONTRACT [${pi + 1}/5]: "${row.title}" (ID: ${row.id})`);
    console.log(`============================================`);
    console.log();

    // Description
    const desc = row.descriptionText;
    console.log(`DESCRIPTION TEXT FROM SAM.GOV:`);
    if (!desc || desc.trim().length === 0) {
      console.log(`Present: no`);
      console.log(`Length: 0 characters`);
    } else {
      console.log(`Present: yes`);
      console.log(`Length: ${desc.length} characters`);
      console.log(`First 30 chars: "${desc.slice(0, 30)}"`);
      console.log(`Last 30 chars: "${desc.slice(-30)}"`);
    }
    console.log();

    // Download and extract documents
    const downloaded = await downloadDocuments(row.resourceLinks);
    const docTexts = await extractAllDocumentTexts(downloaded);

    console.log(`DOCUMENTS EXTRACTED: ${docTexts.length} total (from ${linkCount} URLs, ${downloaded.length} downloaded)`);
    console.log();

    if (linkCount > 0 && docTexts.length === 0) {
      emptyWhenShouldnt.push(row.id);
    }

    for (let di = 0; di < downloaded.length; di++) {
      const doc = downloaded[di];
      const ct = doc.contentType;
      let fileType = "other";
      if (ct.includes("pdf")) fileType = "PDF";
      else if (ct.includes("wordprocessing") || ct.includes("msword")) fileType = "DOCX";
      else if (ct.includes("spreadsheet") || ct.includes("ms-excel") || ct.includes("excel")) fileType = "XLSX";
      else if (ct.includes("text/plain")) fileType = "TXT";
      else if (ct.includes("text/csv")) fileType = "CSV";
      else if (ct.includes("text/html")) fileType = "HTML";

      const text = di < docTexts.length ? docTexts[di] : null;

      console.log(`DOCUMENT ${di + 1}:`);
      console.log(`Detected file type: ${fileType} (${ct})`);

      if (!text || text.length === 0) {
        console.log(`Extraction status: FAILED (empty text after extraction)`);
        console.log(`Length: 0 characters`);
        failures.push({ contractId: row.id, docNum: di + 1, reason: `empty text (type: ${fileType}, ct: ${ct})` });
      } else {
        console.log(`Extraction status: SUCCESS`);
        console.log(`Length: ${text.length} characters`);
        console.log(`First 30 chars: "${text.slice(0, 30).replace(/\n/g, "\\n")}"`);
        console.log(`Last 30 chars: "${text.slice(-30).replace(/\n/g, "\\n")}"`);
        totalDocsExtracted++;
      }
      console.log();
    }

    // Note docs that failed to download entirely
    if (downloaded.length < linkCount) {
      const missing = linkCount - downloaded.length;
      console.log(`(${missing} documents failed to download)`);
      for (let m = downloaded.length; m < linkCount; m++) {
        failures.push({ contractId: row.id, docNum: m + 1, reason: "download failed" });
      }
      console.log();
    }

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

    const promptWith = buildUnifiedClassificationPrompt(input);
    const promptWithout = buildUnifiedClassificationPrompt({ ...input, documentTexts: [] });

    console.log(`PROMPT BUILT:`);
    console.log(`Total prompt length: ${promptWith.length} characters`);
    console.log(`Prompt length WITHOUT documents: ${promptWithout.length} characters`);
    console.log(`Prompt length WITH documents: ${promptWith.length} characters`);
    console.log(`Number of documents included in prompt: ${docTexts.length}`);
    console.log();

    // Call xAI
    console.log(`--- (send to xAI) ---`);
    console.log();
    const startMs = Date.now();
    const response = await ai.chat.completions.create({
      model: GROK_MODEL,
      temperature: 0,
      messages: [{ role: "user", content: promptWith }],
      response_format: { type: "json_object" },
    });
    const elapsed = Date.now() - startMs;
    const rawContent = response.choices[0]?.message?.content || "";
    const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const classification = parsed.classification?.toUpperCase();
    classifications.push({ title: row.title, classification });

    console.log(`XAI RESPONSE: (${elapsed}ms, ${response.usage?.total_tokens} tokens)`);
    console.log(`Classification: ${classification}`);
    console.log(`Reasoning: "${parsed.reasoning}"`);
    console.log(`Summary: "${parsed.summary}"`);
    console.log(`ActionPlan present: ${parsed.actionPlan ? "yes" : "no"}`);

    if (parsed.actionPlan) {
      const ap = parsed.actionPlan;
      const fields = [
        ["implementationSummary", Array.isArray(ap.implementationSummary) && ap.implementationSummary.length > 0],
        ["bidRange", typeof ap.bidRange === "string" && ap.bidRange.length > 0],
        ["travelRequirements", ap.travelRequirements && typeof ap.travelRequirements.required === "boolean"],
        ["positiveSignals", Array.isArray(ap.positiveSignals)],
        ["lowBarrierEntry", typeof ap.lowBarrierEntry === "boolean"],
      ];
      for (const [name, present] of fields) {
        console.log(`  ${name}: ${present ? "present" : "MISSING"}`);
      }
    }
    console.log();

    // Write to DB
    const validClassifications = ["GOOD", "MAYBE", "DISCARD"];
    await db
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
      .where(eq(contracts.id, row.id));

    console.log(`DB WRITTEN: classificationRound=4, documentsAnalyzed=true`);
    console.log();
  }

  // Summary
  console.log(`============================================`);
  console.log(`SUMMARY`);
  console.log(`============================================`);
  console.log(`Total documents extracted across all 5 contracts: ${totalDocsExtracted}`);
  console.log();

  if (failures.length > 0) {
    console.log(`Extraction failures (${failures.length}):`);
    for (const f of failures) {
      console.log(`  Contract ${f.contractId}, Document ${f.docNum}: ${f.reason}`);
    }
  } else {
    console.log(`Extraction failures: NONE`);
  }
  console.log();

  if (emptyWhenShouldnt.length > 0) {
    console.log(`Contracts where documentTexts was empty but shouldn't have been:`);
    for (const id of emptyWhenShouldnt) {
      console.log(`  ${id}`);
    }
  } else {
    console.log(`Contracts with unexpectedly empty documentTexts: NONE`);
  }
  console.log();

  console.log(`All 5 classifications:`);
  for (let i = 0; i < classifications.length; i++) {
    console.log(`  ${i + 1}. ${classifications[i].classification} — ${classifications[i].title.slice(0, 70)}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
