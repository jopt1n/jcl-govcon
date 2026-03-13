import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { count } from "drizzle-orm";
import { fetchDescriptionsForRelevant } from "@/lib/sam-gov/fetch-descriptions";

/**
 * POST /api/fetch-descriptions
 *
 * Fetch full descriptions from SAM.gov for GOOD/MAYBE contracts.
 * Returns immediately — fetching runs in the background.
 *
 * Auth: Authorization: Bearer {INGEST_SECRET}
 * Body (optional): { limit?: number, classifications?: ("GOOD" | "MAYBE")[] }
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let limit = 500;
  let classifications: ("GOOD" | "MAYBE")[] = ["GOOD", "MAYBE"];

  try {
    const body = await req.json();
    if (body?.limit && typeof body.limit === "number") {
      limit = body.limit;
    }
    if (Array.isArray(body?.classifications)) {
      classifications = body.classifications;
    }
  } catch {
    // No body or invalid JSON — use defaults
  }

  // Count eligible contracts
  const [{ eligibleCount }] = await db
    .select({ eligibleCount: count() })
    .from(contracts)
    .where(
      and(
        inArray(contracts.classification, classifications),
        eq(contracts.descriptionFetched, false),
        isNull(contracts.descriptionText)
      )
    );

  if (eligibleCount === 0) {
    return NextResponse.json({
      message: "No eligible contracts need descriptions fetched",
      eligibleCount: 0,
    });
  }

  // Fire-and-forget
  Promise.resolve()
    .then(async () => {
      console.log(`[fetch-descriptions] Starting (limit: ${limit})...`);
      const result = await fetchDescriptionsForRelevant({ limit, classifications });
      console.log(
        `[fetch-descriptions] Done: ${result.fetched} fetched, ${result.errors} errors` +
        (result.stoppedAtLimit ? " (stopped at rate limit)" : "")
      );
    })
    .catch((err) => {
      console.error("[fetch-descriptions] Background error:", err);
    });

  return NextResponse.json({
    message: `Description fetch started for up to ${Math.min(limit, eligibleCount)} contracts`,
    eligibleCount,
  });
}
