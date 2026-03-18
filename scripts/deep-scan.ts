/**
 * Deep Scan — Round 2 Classification
 *
 * Re-classifies GOOD/MAYBE contracts from Round 1 using full descriptions
 * and PDF document text extracted via pdf-parse.
 *
 * --dry-run only skips the final bulk DB update. All fetching, downloading,
 * PDF parsing, and Grok classification run normally.
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/deep-scan.ts --dry-run --limit 5
 *   npx tsx --import ./scripts/load-env.ts scripts/deep-scan.ts --skip 10 --limit 50
 *   npx tsx --import ./scripts/load-env.ts scripts/deep-scan.ts
 */

// Override SAM_DRY_RUN — this script has its own --dry-run that only skips DB writes.
// SAM.gov fetches and doc downloads must always run so we can test the full pipeline.
delete process.env.SAM_DRY_RUN;

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { PDFParse } from "pdf-parse";
import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { fetchDescription } from "../src/lib/sam-gov/client";
import { downloadDocuments } from "../src/lib/sam-gov/documents";
import { buildClassificationPrompt } from "../src/lib/ai/prompts";
import type { ClassificationPromptInput } from "../src/lib/ai/prompts";
import { parseClassificationResponse } from "../src/lib/ai/classifier";
import { getGrokClient, GROK_MODEL } from "../src/lib/ai/grok-client";
import { delay } from "../src/lib/utils";

const __dir = dirname(fileURLToPath(import.meta.url));

type Classification = "GOOD" | "MAYBE" | "DISCARD";

// ── CLI args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let limit = 0;
  let skip = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--skip" && args[i + 1]) {
      skip = parseInt(args[++i], 10);
    }
  }

  return { dryRun, limit, skip };
}

// ── Types ─────────────────────────────────────────────────────────────────

interface DeepScanResult {
  noticeId: string;
  title: string;
  oldClassification: Classification;
  newClassification: Classification;
  aiReasoning: string;
  summary: string | null;
  documentsAnalyzed: boolean;
  descriptionLength: number;
  documentCount: number;
  totalDocTextLength: number;
  descriptionNewlyFetched: boolean;
  promptTokens: number;
  completionTokens: number;
}

interface BulkUpdateRow {
  noticeId: string;
  classification: Classification;
  reasoning: string;
  summary: string;
  docsAnalyzed: boolean;
  descText: string; // '__SKIP__' if not newly fetched
  descFetched: string; // 'true' or 'false'
}

// ── Grok call with retry ──────────────────────────────────────────────────

async function callGrokWithRetry(
  prompt: string
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const ai = getGrokClient();
  const backoffs = [2000, 6000, 18000];

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.chat.completions.create({
        model: GROK_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      return {
        content: response.choices[0]?.message?.content ?? "",
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      if (attempt < 2) {
        console.warn(
          `[deep-scan] Grok attempt ${attempt + 1}/3 failed: ${err instanceof Error ? err.message : err}. Retrying in ${backoffs[attempt] / 1000}s...`
        );
        await delay(backoffs[attempt]);
      } else {
        throw err;
      }
    }
  }

  throw new Error("Grok call failed after 3 attempts");
}

// ── PDF text extraction ───────────────────────────────────────────────────

async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    const text = result.text?.trim();
    if (!text || text.length === 0) {
      return null; // likely scanned image
    }
    return text;
  } catch {
    return null;
  }
}

// ── Bulk update ───────────────────────────────────────────────────────────

async function bulkUpdate(rows: BulkUpdateRow[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    const valuesList = chunk
      .map((r) => {
        const nid = r.noticeId.replace(/'/g, "''");
        const cls = r.classification;
        const reason = r.reasoning.replace(/'/g, "''");
        const summ = (r.summary || "").replace(/'/g, "''");
        const docsAnalyzed = r.docsAnalyzed ? "true" : "false";
        const descText = r.descText.replace(/'/g, "''");
        const descFetched = r.descFetched;
        return `('${nid}', '${cls}', '${reason}', '${summ}', '${docsAnalyzed}', '${descText}', '${descFetched}')`;
      })
      .join(",\n  ");

    await db.execute(sql`
      UPDATE contracts SET
        classification = v.classification::classification,
        ai_reasoning = v.reasoning,
        summary = v.summary,
        classification_round = 2,
        documents_analyzed = v.docs_analyzed::boolean,
        description_text = CASE WHEN v.desc_text = '__SKIP__' THEN contracts.description_text ELSE v.desc_text END,
        description_fetched = CASE WHEN v.desc_fetched = 'true' THEN true ELSE contracts.description_fetched END,
        updated_at = NOW()
      FROM (VALUES
        ${sql.raw(valuesList)}
      ) AS v(notice_id, classification, reasoning, summary, docs_analyzed, desc_text, desc_fetched)
      WHERE contracts.notice_id = v.notice_id
    `);

    console.log(`[deep-scan] Bulk updated ${Math.min(i + CHUNK, rows.length)} of ${rows.length}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { dryRun, limit, skip } = parseArgs();

  console.log(`[deep-scan] Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  if (limit) console.log(`[deep-scan] Limit: ${limit}`);
  if (skip) console.log(`[deep-scan] Skip: ${skip}`);

  // 1. Query Round 1 GOOD/MAYBE contracts
  const eligible = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      title: contracts.title,
      agency: contracts.agency,
      naicsCode: contracts.naicsCode,
      pscCode: contracts.pscCode,
      noticeType: contracts.noticeType,
      setAsideType: contracts.setAsideType,
      awardCeiling: contracts.awardCeiling,
      descriptionText: contracts.descriptionText,
      descriptionFetched: contracts.descriptionFetched,
      resourceLinks: contracts.resourceLinks,
      classification: contracts.classification,
      rawJson: contracts.rawJson,
    })
    .from(contracts)
    .where(
      and(
        inArray(contracts.classification, ["GOOD", "MAYBE"]),
        eq(contracts.classificationRound, 1)
      )
    )
    .orderBy(contracts.classification); // GOOD first

  console.log(`[deep-scan] Found ${eligible.length} Round 1 GOOD/MAYBE contracts`);

  // Apply skip and limit
  let toProcess = eligible;
  if (skip > 0) toProcess = toProcess.slice(skip);
  if (limit > 0) toProcess = toProcess.slice(0, limit);

  console.log(`[deep-scan] Processing ${toProcess.length} contracts`);

  const results: DeepScanResult[] = [];
  const updateRows: BulkUpdateRow[] = [];
  const failed: { noticeId: string; error: string }[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let classifiedWithoutDescription = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const contract = toProcess[i];
    const oldClassification = contract.classification as Classification;

    // ── A. Description fetch ──────────────────────────────────────────
    let descriptionText = contract.descriptionText;
    let descriptionNewlyFetched = false;

    if (contract.descriptionFetched && descriptionText) {
      // Use cached description
    } else {
      // Try to fetch from SAM.gov
      const raw = contract.rawJson as Record<string, unknown> | null;
      const descriptionUrl = raw?.description as string | null | undefined;

      if (descriptionUrl && descriptionUrl !== "null") {
        try {
          const text = await fetchDescription(descriptionUrl);
          if (text && text !== "null" && text !== "Description not found") {
            descriptionText = text;
            descriptionNewlyFetched = true;
          }
          await delay(1000); // SAM.gov rate limiting
        } catch (err) {
          console.warn(
            `[deep-scan] Description fetch failed for ${contract.noticeId}: ${err instanceof Error ? err.message : err}`
          );
          // Continue with metadata only, don't mark descriptionFetched
        }
      }
    }

    if (!descriptionText) {
      classifiedWithoutDescription++;
    }

    // ── B. Document download + PDF extraction ─────────────────────────
    const documentTexts: string[] = [];
    let documentsAnalyzed = false;

    if (contract.resourceLinks && contract.resourceLinks.length > 0) {
      console.log(`[deep-scan] ${contract.noticeId}: ${contract.resourceLinks.length} resource links, downloading...`);
      try {
        const docs = await downloadDocuments(contract.resourceLinks);
        console.log(`[deep-scan] ${contract.noticeId}: downloaded ${docs.length} docs (${docs.map(d => `${d.filename} [${d.contentType}]`).join(', ') || 'none'})`);

        for (const doc of docs) {
          const isPdf = doc.contentType === "application/pdf" || doc.filename.endsWith(".pdf");
          // SAM.gov serves files as application/octet-stream — try PDF parsing on those too
          const isOctetStream = doc.contentType === "application/octet-stream";

          if (isPdf || isOctetStream) {
            const text = await extractPdfText(doc.buffer);
            if (text) {
              documentTexts.push(text);
            } else if (isPdf) {
              console.log(`[deep-scan] ${contract.noticeId}: PDF "${doc.filename}" likely scanned image, skipping`);
            } else {
              console.log(`[deep-scan] ${contract.noticeId}: "${doc.filename}" not a parseable PDF, skipping`);
            }
          } else {
            console.log(`[deep-scan] ${contract.noticeId}: Skipping non-PDF "${doc.filename}" (${doc.contentType})`);
          }
        }

        if (documentTexts.length > 0) {
          documentsAnalyzed = true;
        }
      } catch (err) {
        console.warn(
          `[deep-scan] Document download failed for ${contract.noticeId}: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    // Cap total document text at 50,000 chars
    let totalDocTextLength = 0;
    const cappedDocTexts: string[] = [];
    for (const text of documentTexts) {
      if (totalDocTextLength + text.length > 50000) {
        cappedDocTexts.push(text.slice(0, 50000 - totalDocTextLength));
        totalDocTextLength = 50000;
        break;
      }
      cappedDocTexts.push(text);
      totalDocTextLength += text.length;
    }

    // ── C. Grok classification ────────────────────────────────────────
    const promptInput: ClassificationPromptInput = {
      title: contract.title,
      agency: contract.agency,
      naicsCode: contract.naicsCode,
      pscCode: contract.pscCode,
      noticeType: contract.noticeType,
      setAsideType: contract.setAsideType,
      awardCeiling: contract.awardCeiling,
      descriptionText: descriptionText,
      documentTexts: cappedDocTexts,
    };

    const prompt = buildClassificationPrompt(promptInput);

    let newClassification: Classification;
    let aiReasoning: string;
    let summary: string | null;
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const grokResult = await callGrokWithRetry(prompt);
      const parsed = parseClassificationResponse(grokResult.content);
      newClassification = parsed.classification;
      aiReasoning = parsed.reasoning;
      summary = parsed.summary;
      promptTokens = grokResult.promptTokens;
      completionTokens = grokResult.completionTokens;
      totalPromptTokens += promptTokens;
      totalCompletionTokens += completionTokens;

      await delay(500); // Grok rate limiting
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[deep-scan] Grok failed for ${contract.noticeId}: ${errorMsg}`);
      failed.push({ noticeId: contract.noticeId, error: errorMsg });
      continue;
    }

    // ── D. Log ────────────────────────────────────────────────────────
    const changeIndicator = oldClassification === newClassification ? "=" : "→";
    console.log(
      `[deep-scan] ${i + 1}/${toProcess.length}: ${oldClassification} ${changeIndicator} ${newClassification} (${contract.noticeId}) ${documentsAnalyzed ? `[${documentTexts.length} docs]` : ""}`
    );

    // ── E. Collect result ─────────────────────────────────────────────
    results.push({
      noticeId: contract.noticeId,
      title: contract.title,
      oldClassification,
      newClassification,
      aiReasoning,
      summary,
      documentsAnalyzed,
      descriptionLength: descriptionText?.length ?? 0,
      documentCount: documentTexts.length,
      totalDocTextLength,
      descriptionNewlyFetched,
      promptTokens,
      completionTokens,
    });

    updateRows.push({
      noticeId: contract.noticeId,
      classification: newClassification,
      reasoning: aiReasoning,
      summary: summary || "",
      docsAnalyzed: documentsAnalyzed,
      descText: descriptionNewlyFetched ? (descriptionText || "") : "__SKIP__",
      descFetched: descriptionNewlyFetched ? "true" : "false",
    });
  }

  // ── 5. Bulk update (skip if dry run) ────────────────────────────────────
  if (!dryRun && updateRows.length > 0) {
    console.log(`\n[deep-scan] Updating ${updateRows.length} contracts in DB...`);
    await bulkUpdate(updateRows);
  }

  // ── 6. Dry run output ──────────────────────────────────────────────────
  if (dryRun) {
    const outPath = resolve(__dir, "deep-scan-dry-run.json");
    const output = results.map((r) => ({
      noticeId: r.noticeId,
      title: r.title,
      oldClassification: r.oldClassification,
      newClassification: r.newClassification,
      aiReasoning: r.aiReasoning,
      summary: r.summary,
      documentsAnalyzed: r.documentsAnalyzed,
      descriptionLength: r.descriptionLength,
      documentCount: r.documentCount,
      totalDocTextLength: r.totalDocTextLength,
    }));
    writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\n[deep-scan] Dry run results written to ${outPath}`);
  }

  // ── 7. Summary ─────────────────────────────────────────────────────────
  const counts = { GOOD: 0, MAYBE: 0, DISCARD: 0 };
  const changes: Record<string, number> = {};

  for (const r of results) {
    counts[r.newClassification]++;
    const key = `${r.oldClassification}→${r.newClassification}`;
    changes[key] = (changes[key] || 0) + 1;
  }

  console.log("\n[deep-scan] ═══ Deep Scan Complete ═══");
  console.log(`  Total processed: ${results.length}`);
  console.log(`  GOOD:    ${counts.GOOD}`);
  console.log(`  MAYBE:   ${counts.MAYBE}`);
  console.log(`  DISCARD: ${counts.DISCARD}`);
  console.log(`  Classification changes:`);
  for (const [key, count] of Object.entries(changes).sort()) {
    console.log(`    ${key}: ${count}`);
  }
  if (failed.length > 0) {
    console.log(`  Failed (${failed.length}):`);
    for (const f of failed) {
      console.log(`    ${f.noticeId}: ${f.error.slice(0, 100)}`);
    }
  }
  console.log(`  Classified without description: ${classifiedWithoutDescription}`);
  console.log(`  Tokens: ${totalPromptTokens} prompt + ${totalCompletionTokens} completion = ${totalPromptTokens + totalCompletionTokens} total`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[deep-scan] Fatal error:", err);
  process.exit(1);
});
