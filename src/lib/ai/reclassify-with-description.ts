/**
 * Re-classification with full description text.
 *
 * After Phase 4 fetches descriptions for GOOD/MAYBE contracts,
 * this re-classifies them using the full prompt (metadata + description)
 * for more accurate classification.
 */

import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { buildClassificationPrompt } from "./prompts";
import { parseClassificationResponse } from "./classifier";
import { getGrokClient, GROK_MODEL } from "./grok-client";
import { delay } from "@/lib/utils";

const CHUNK_SIZE = 50;
const CHUNK_DELAY_MS = 2000;
const CALL_DELAY_MS = 300;

interface ReclassifyOptions {
  batchSize?: number;
}

interface ReclassifyResult {
  reclassified: number;
  upgraded: number;
  downgraded: number;
  unchanged: number;
  errors: number;
}

// Classification ranking for upgrade/downgrade tracking
const RANK: Record<string, number> = { DISCARD: 0, MAYBE: 1, GOOD: 2 };

/**
 * Re-classify GOOD/MAYBE contracts that have descriptions fetched
 * but were originally classified from metadata only.
 */
export async function reclassifyWithDescription(
  options: ReclassifyOptions = {}
): Promise<ReclassifyResult> {
  const { batchSize = 500 } = options;
  const ai = getGrokClient();

  let reclassified = 0;
  let upgraded = 0;
  let downgraded = 0;
  let unchanged = 0;
  let errors = 0;

  // Query contracts eligible for re-classification
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
      responseDeadline: contracts.responseDeadline,
      descriptionText: contracts.descriptionText,
      classification: contracts.classification,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classifiedFromMetadata, true),
        eq(contracts.descriptionFetched, true),
        isNotNull(contracts.descriptionText),
        eq(contracts.userOverride, false)
      )
    )
    .limit(batchSize);

  if (eligible.length === 0) {
    console.log("[reclassify] No eligible contracts for re-classification");
    return { reclassified: 0, upgraded: 0, downgraded: 0, unchanged: 0, errors: 0 };
  }

  console.log(`[reclassify] Processing ${eligible.length} contracts`);

  // Process in chunks
  for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
    const chunk = eligible.slice(i, i + CHUNK_SIZE);

    for (const contract of chunk) {
      const oldClassification = contract.classification;

      try {
        const prompt = buildClassificationPrompt({
          title: contract.title,
          agency: contract.agency,
          naicsCode: contract.naicsCode,
          pscCode: contract.pscCode,
          noticeType: contract.noticeType,
          setAsideType: contract.setAsideType,
          awardCeiling: contract.awardCeiling,
          responseDeadline: contract.responseDeadline
            ? contract.responseDeadline instanceof Date
              ? contract.responseDeadline.toISOString()
              : String(contract.responseDeadline)
            : null,
          descriptionText: contract.descriptionText,
          documentTexts: [],
        });

        const response = await ai.chat.completions.create({
          model: GROK_MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        });

        const result = parseClassificationResponse(
          response.choices[0]?.message?.content ?? undefined
        );

        await db
          .update(contracts)
          .set({
            classification: result.classification,
            aiReasoning: result.reasoning,
            summary: result.summary,
            classifiedFromMetadata: false,
            updatedAt: new Date(),
          })
          .where(eq(contracts.id, contract.id));

        reclassified++;

        // Track upgrade/downgrade
        const oldRank = RANK[oldClassification] ?? 1;
        const newRank = RANK[result.classification] ?? 1;
        if (newRank > oldRank) upgraded++;
        else if (newRank < oldRank) downgraded++;
        else unchanged++;
      } catch (err) {
        errors++;
        reclassified++;
        console.error(
          `[reclassify] Error on ${contract.noticeId}:`,
          err instanceof Error ? err.message : err
        );
      }

      await delay(CALL_DELAY_MS);
    }

    // Delay between chunks
    if (i + CHUNK_SIZE < eligible.length) {
      await delay(CHUNK_DELAY_MS);
    }
  }

  console.log(
    `[reclassify] Done: ${reclassified} re-classified ` +
    `(${upgraded} upgraded, ${downgraded} downgraded, ${unchanged} unchanged, ${errors} errors)`
  );

  return { reclassified, upgraded, downgraded, unchanged, errors };
}
