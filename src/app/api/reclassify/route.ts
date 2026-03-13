import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { count } from "drizzle-orm";
import { reclassifyWithDescription } from "@/lib/ai/reclassify-with-description";

/**
 * POST /api/reclassify
 *
 * Re-classify GOOD/MAYBE contracts using full description text.
 * Returns immediately — re-classification runs in the background.
 *
 * Auth: Authorization: Bearer {INGEST_SECRET}
 * Body (optional): { batchSize?: number }
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let batchSize = 500;
  try {
    const body = await req.json();
    if (body?.batchSize && typeof body.batchSize === "number") {
      batchSize = body.batchSize;
    }
  } catch {
    // No body or invalid JSON — use default
  }

  // Count eligible contracts
  const [{ eligibleCount }] = await db
    .select({ eligibleCount: count() })
    .from(contracts)
    .where(
      and(
        eq(contracts.classifiedFromMetadata, true),
        eq(contracts.descriptionFetched, true),
        isNotNull(contracts.descriptionText),
        eq(contracts.userOverride, false)
      )
    );

  if (eligibleCount === 0) {
    return NextResponse.json({
      message: "No eligible contracts for re-classification",
      eligibleCount: 0,
    });
  }

  // Fire-and-forget
  Promise.resolve()
    .then(async () => {
      console.log(`[reclassify] Starting (batchSize: ${batchSize})...`);
      const result = await reclassifyWithDescription({ batchSize });
      console.log(
        `[reclassify] Done: ${result.reclassified} re-classified ` +
        `(${result.upgraded} upgraded, ${result.downgraded} downgraded, ${result.unchanged} unchanged, ${result.errors} errors)`
      );
    })
    .catch((err) => {
      console.error("[reclassify] Background error:", err);
    });

  return NextResponse.json({
    message: `Re-classification started for up to ${Math.min(batchSize, eligibleCount)} contracts`,
    eligibleCount,
  });
}
