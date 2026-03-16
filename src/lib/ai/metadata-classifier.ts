/**
 * Metadata-only classifier using Gemini 2.5 Flash.
 *
 * Classifies contracts using ONLY metadata fields (title, NAICS, PSC, etc.)
 * without fetching descriptions or documents from SAM.gov.
 * Quickly triages ~80-90% of clearly irrelevant contracts as DISCARD.
 */

import { GoogleGenAI } from "@google/genai";
import { db } from "@/lib/db";
import { contracts, crawlProgress } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { buildMetadataClassificationPrompt } from "./prompts";
import { parseClassificationResponse } from "./classifier";
import { delay } from "@/lib/utils";

const CHUNK_SIZE = 50;
const CHUNK_DELAY_MS = 2000;
const CALL_DELAY_MS = 300;

interface MetadataClassifyOptions {
  limit?: number;
  crawlProgressId?: string;
}

interface MetadataClassifyResult {
  classified: number;
  good: number;
  maybe: number;
  discard: number;
  errors: number;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY environment variable is not set");
  return new GoogleGenAI({ apiKey });
}

/**
 * Classify PENDING contracts using only metadata fields.
 * Processes in chunks with pause support.
 */
export async function classifyFromMetadata(
  options: MetadataClassifyOptions = {}
): Promise<MetadataClassifyResult> {
  const { limit = 500, crawlProgressId } = options;
  const ai = getGeminiClient();

  let classified = 0;
  let good = 0;
  let maybe = 0;
  let discard = 0;
  let errors = 0;

  // Fetch PENDING contracts that haven't been metadata-classified yet
  const pendingContracts = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      title: contracts.title,
      naicsCode: contracts.naicsCode,
      pscCode: contracts.pscCode,
      agency: contracts.agency,
      orgPathName: contracts.orgPathName,
      noticeType: contracts.noticeType,
      setAsideType: contracts.setAsideType,
      setAsideCode: contracts.setAsideCode,
      popState: contracts.popState,
      awardCeiling: contracts.awardCeiling,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "PENDING"),
        eq(contracts.classifiedFromMetadata, false)
      )
    )
    .orderBy(contracts.postedDate)
    .limit(limit);

  if (pendingContracts.length === 0) {
    console.log("[metadata-classifier] No pending contracts to classify");
    return { classified: 0, good: 0, maybe: 0, discard: 0, errors: 0 };
  }

  console.log(`[metadata-classifier] Processing ${pendingContracts.length} contracts`);

  // Process in chunks
  for (let i = 0; i < pendingContracts.length; i += CHUNK_SIZE) {
    // Check pause status
    if (crawlProgressId) {
      const [progress] = await db
        .select({ status: crawlProgress.status })
        .from(crawlProgress)
        .where(eq(crawlProgress.id, crawlProgressId))
        .limit(1);

      if (progress?.status === "PAUSED") {
        console.log("[metadata-classifier] Paused by user, stopping early");
        break;
      }
    }

    const chunk = pendingContracts.slice(i, i + CHUNK_SIZE);

    for (const contract of chunk) {
      try {
        const prompt = buildMetadataClassificationPrompt({
          title: contract.title,
          naicsCode: contract.naicsCode,
          pscCode: contract.pscCode,
          agency: contract.agency,
          orgPathName: contract.orgPathName,
          noticeType: contract.noticeType,
          setAsideType: contract.setAsideType,
          setAsideCode: contract.setAsideCode,
          popState: contract.popState,
          awardCeiling: contract.awardCeiling,
        });

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseMimeType: "application/json" },
        });

        const result = parseClassificationResponse(response.text);

        await db
          .update(contracts)
          .set({
            classification: result.classification,
            aiReasoning: result.reasoning,
            summary: result.summary,
            classifiedFromMetadata: true,
            updatedAt: new Date(),
          })
          .where(eq(contracts.id, contract.id));

        classified++;
        if (result.classification === "GOOD") good++;
        else if (result.classification === "MAYBE") maybe++;
        else discard++;
      } catch (err) {
        errors++;
        classified++;
        console.error(
          `[metadata-classifier] Error on ${contract.noticeId}:`,
          err instanceof Error ? err.message : err
        );

        // Mark as classified with MAYBE fallback so we don't retry forever
        try {
          await db
            .update(contracts)
            .set({
              classification: "MAYBE",
              aiReasoning: `Metadata classification failed: ${err instanceof Error ? err.message : String(err)}`,
              classifiedFromMetadata: true,
              updatedAt: new Date(),
            })
            .where(eq(contracts.id, contract.id));
        } catch {
          // Ignore DB error on fallback update
        }
      }

      await delay(CALL_DELAY_MS);
    }

    // Update crawl progress after each chunk
    if (crawlProgressId) {
      await db
        .update(crawlProgress)
        .set({ classified, updatedAt: new Date() })
        .where(eq(crawlProgress.id, crawlProgressId));
    }

    // Delay between chunks
    if (i + CHUNK_SIZE < pendingContracts.length) {
      await delay(CHUNK_DELAY_MS);
    }
  }

  console.log(
    `[metadata-classifier] Done: ${classified} classified (${good} good, ${maybe} maybe, ${discard} discard, ${errors} errors)`
  );

  return { classified, good, maybe, discard, errors };
}
