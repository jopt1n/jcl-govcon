/**
 * Selective description fetcher for Phase 4.
 *
 * Fetches full descriptions from SAM.gov ONLY for GOOD/MAYBE contracts
 * that haven't had their descriptions fetched yet.
 */

import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { canMakeCall, fetchDescription } from "./client";
import { delay } from "@/lib/utils";

const CALL_DELAY_MS = 500;

interface FetchDescriptionsOptions {
  limit?: number;
  classifications?: ("GOOD" | "MAYBE")[];
}

interface FetchDescriptionsResult {
  fetched: number;
  errors: number;
  stoppedAtLimit: boolean;
}

/**
 * Fetch descriptions for GOOD/MAYBE contracts that don't have them yet.
 * Checks API rate limits before each call and respects DRY_RUN.
 */
export async function fetchDescriptionsForRelevant(
  options: FetchDescriptionsOptions = {}
): Promise<FetchDescriptionsResult> {
  const {
    limit = 500,
    classifications = ["GOOD", "MAYBE"],
  } = options;

  let fetched = 0;
  let errors = 0;
  let stoppedAtLimit = false;

  // Query contracts that need descriptions
  const eligible = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      rawJson: contracts.rawJson,
    })
    .from(contracts)
    .where(
      and(
        inArray(contracts.classification, classifications),
        eq(contracts.descriptionFetched, false),
        isNull(contracts.descriptionText)
      )
    )
    .orderBy(contracts.classification) // GOOD first (alphabetical)
    .limit(limit);

  if (eligible.length === 0) {
    console.log("[fetch-descriptions] No eligible contracts found");
    return { fetched: 0, errors: 0, stoppedAtLimit: false };
  }

  console.log(`[fetch-descriptions] Processing ${eligible.length} contracts`);

  for (const contract of eligible) {
    // Check rate limit before each call
    const allowed = await canMakeCall();
    if (!allowed) {
      console.log("[fetch-descriptions] API rate limit reached, stopping");
      stoppedAtLimit = true;
      break;
    }

    try {
      // Extract description URL from rawJson
      const raw = contract.rawJson as Record<string, unknown> | null;
      const descriptionUrl = raw?.description as string | null | undefined;

      if (!descriptionUrl || descriptionUrl === "null") {
        // No description URL available — mark as fetched so we don't retry
        await db
          .update(contracts)
          .set({
            descriptionFetched: true,
            updatedAt: new Date(),
          })
          .where(eq(contracts.id, contract.id));
        fetched++;
        continue;
      }

      const text = await fetchDescription(descriptionUrl);

      // Handle empty/null-like responses
      const cleanText =
        text && text !== "null" && text !== "Description not found"
          ? text
          : null;

      await db
        .update(contracts)
        .set({
          descriptionText: cleanText,
          descriptionFetched: true,
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, contract.id));

      fetched++;
    } catch (err) {
      errors++;
      console.error(
        `[fetch-descriptions] Error on ${contract.noticeId}:`,
        err instanceof Error ? err.message : err
      );

      // Mark as fetched to avoid infinite retries
      try {
        await db
          .update(contracts)
          .set({
            descriptionFetched: true,
            updatedAt: new Date(),
          })
          .where(eq(contracts.id, contract.id));
      } catch {
        // Ignore DB error on fallback update
      }
    }

    await delay(CALL_DELAY_MS);
  }

  console.log(
    `[fetch-descriptions] Done: ${fetched} fetched, ${errors} errors${stoppedAtLimit ? " (stopped at rate limit)" : ""}`
  );

  return { fetched, errors, stoppedAtLimit };
}
