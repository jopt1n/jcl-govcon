/**
 * Standard (real-time) classifier using Grok (xAI).
 * For daily new contracts — processes sequentially with rate limiting.
 */

import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { downloadDocuments } from "@/lib/sam-gov/documents";
import { buildClassificationPrompt } from "./prompts";
import type { ClassificationPromptInput } from "./prompts";
import { getGrokClient, GROK_MODEL } from "./grok-client";
import { delay } from "@/lib/utils";

type Classification = "GOOD" | "MAYBE" | "DISCARD";

interface ClassificationResult {
  classification: Classification;
  reasoning: string;
  summary: string | null;
}

interface ClassifyContractResult {
  contractId: string;
  noticeId: string;
  classification: Classification;
  reasoning: string;
  documentsAnalyzed: boolean;
  error?: string;
}

/**
 * Parse AI response into a ClassificationResult.
 * Handles edge cases like markdown-wrapped JSON.
 */
export function parseClassificationResponse(text: string | undefined): ClassificationResult {
  if (!text) {
    return { classification: "MAYBE", reasoning: "Failed to get AI response — marked for manual review.", summary: null };
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
        summary: parsed.summary || null,
      };
    }

    return {
      classification: classification as Classification,
      reasoning: parsed.reasoning || "No reasoning provided by AI.",
      summary: parsed.summary || null,
    };
  } catch {
    return {
      classification: "MAYBE",
      reasoning: `Failed to parse AI response — marked for manual review. Raw: ${text.slice(0, 200)}`,
      summary: null,
    };
  }
}

/**
 * Classify a single contract using Grok.
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
  const ai = getGrokClient();
  let documentsAnalyzed = false;

  try {
    // Download documents if available
    const downloadedDocs = await downloadDocuments(contract.resourceLinks);
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
      documentTexts: [], // PDF content not supported via OpenAI-compatible API
    };

    const promptText = buildClassificationPrompt(promptInput);

    // Call Grok
    const response = await ai.chat.completions.create({
      model: GROK_MODEL,
      messages: [{ role: "user", content: promptText }],
      response_format: { type: "json_object" },
    });

    const result = parseClassificationResponse(
      response.choices[0]?.message?.content ?? undefined
    );

    // Update database
    await db
      .update(contracts)
      .set({
        classification: result.classification,
        aiReasoning: result.reasoning,
        summary: result.summary,
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

    // Rate limit: 500ms between calls
    if (i < contractRows.length - 1) {
      await delay(500);
    }
  }

  return results;
}
