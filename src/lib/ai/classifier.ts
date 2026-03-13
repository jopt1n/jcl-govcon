/**
 * Standard (real-time) classifier using Gemini 2.5 Flash.
 * For daily new contracts — processes sequentially with rate limiting.
 */

import { GoogleGenAI } from "@google/genai";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { downloadDocuments } from "@/lib/sam-gov/documents";
import { buildClassificationPrompt } from "./prompts";
import type { ClassificationPromptInput } from "./prompts";
import type { SamResourceLink } from "@/lib/sam-gov/types";
import { delay } from "@/lib/utils";

type Classification = "GOOD" | "MAYBE" | "DISCARD";

interface ClassificationResult {
  classification: Classification;
  reasoning: string;
}

interface ClassifyContractResult {
  contractId: string;
  noticeId: string;
  classification: Classification;
  reasoning: string;
  documentsAnalyzed: boolean;
  error?: string;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY environment variable is not set");
  return new GoogleGenAI({ apiKey });
}

/**
 * Parse Gemini response into a ClassificationResult.
 * Handles edge cases like markdown-wrapped JSON.
 */
export function parseClassificationResponse(text: string | undefined): ClassificationResult {
  if (!text) {
    return { classification: "MAYBE", reasoning: "Failed to get AI response — marked for manual review." };
  }

  try {
    // Strip potential markdown code fences
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const classification = parsed.classification?.toUpperCase();
    if (!["GOOD", "MAYBE", "DISCARD"].includes(classification)) {
      return {
        classification: "MAYBE",
        reasoning: `AI returned invalid classification "${parsed.classification}". Original reasoning: ${parsed.reasoning || "none"}`,
      };
    }

    return {
      classification: classification as Classification,
      reasoning: parsed.reasoning || "No reasoning provided by AI.",
    };
  } catch {
    return {
      classification: "MAYBE",
      reasoning: `Failed to parse AI response — marked for manual review. Raw: ${text.slice(0, 200)}`,
    };
  }
}

/**
 * Build content parts for Gemini, including PDF documents as inline data.
 */
function buildContentParts(
  promptText: string,
  documents: { buffer: Buffer; contentType: string }[]
): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  // Add PDF documents as inline data parts
  for (const doc of documents) {
    if (doc.contentType === "application/pdf") {
      parts.push({
        inlineData: {
          mimeType: "application/pdf",
          data: doc.buffer.toString("base64"),
        },
      });
    }
  }

  // Add text prompt last
  parts.push({ text: promptText });

  return parts;
}

/**
 * Classify a single contract using Gemini 2.5 Flash.
 */
export async function classifyContract(
  contract: {
    id: string;
    noticeId: string;
    title: string;
    agency: string | null;
    naicsCode: string | null;
    pscCode: string | null;
    noticeType: string | null;
    setAsideType: string | null;
    awardCeiling: string | null;
    descriptionText: string | null;
    resourceLinks: string[] | null;
  }
): Promise<ClassifyContractResult> {
  const ai = getGeminiClient();
  let documentsAnalyzed = false;

  try {
    // Download documents if available
    const resourceLinks: SamResourceLink[] = (contract.resourceLinks ?? []).map((url) => ({
      url,
      description: null,
    }));

    const downloadedDocs = await downloadDocuments(resourceLinks);
    documentsAnalyzed = downloadedDocs.length > 0;

    // Build prompt
    const promptInput: ClassificationPromptInput = {
      title: contract.title,
      agency: contract.agency,
      naicsCode: contract.naicsCode,
      pscCode: contract.pscCode,
      noticeType: contract.noticeType,
      setAsideType: contract.setAsideType,
      awardCeiling: contract.awardCeiling,
      descriptionText: contract.descriptionText,
      documentTexts: [], // PDFs sent as inline data, not text
    };

    const promptText = buildClassificationPrompt(promptInput);

    // Build content parts with inline PDF data
    const pdfDocs = downloadedDocs.filter((d) => d.contentType === "application/pdf");
    const contentParts = buildContentParts(promptText, pdfDocs);

    // Call Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: contentParts }],
      config: {
        responseMimeType: "application/json",
      },
    });

    const result = parseClassificationResponse(response.text);

    // Update database
    await db
      .update(contracts)
      .set({
        classification: result.classification,
        aiReasoning: result.reasoning,
        documentsAnalyzed,
        updatedAt: new Date(),
      })
      .where(eq(contracts.id, contract.id));

    return {
      contractId: contract.id,
      noticeId: contract.noticeId,
      classification: result.classification,
      reasoning: result.reasoning,
      documentsAnalyzed,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[classifier] Error classifying ${contract.noticeId}:`, errorMsg);

    return {
      contractId: contract.id,
      noticeId: contract.noticeId,
      classification: "MAYBE",
      reasoning: `Classification failed: ${errorMsg}`,
      documentsAnalyzed,
      error: errorMsg,
    };
  }
}

/**
 * Classify multiple contracts sequentially with rate limiting.
 * Used for daily new contracts or manual re-classification.
 */
export async function classifyContracts(
  contractRows: Array<{
    id: string;
    noticeId: string;
    title: string;
    agency: string | null;
    naicsCode: string | null;
    pscCode: string | null;
    noticeType: string | null;
    setAsideType: string | null;
    awardCeiling: string | null;
    descriptionText: string | null;
    resourceLinks: string[] | null;
  }>
): Promise<ClassifyContractResult[]> {
  const results: ClassifyContractResult[] = [];

  for (let i = 0; i < contractRows.length; i++) {
    const result = await classifyContract(contractRows[i]);
    results.push(result);

    // Rate limit: 500ms between calls to stay well under Gemini limits
    if (i < contractRows.length - 1) {
      await delay(500);
    }
  }

  return results;
}
