import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { count } from "drizzle-orm";
import { classifyFromMetadata } from "@/lib/ai/metadata-classifier";

/**
 * POST /api/classify/metadata
 *
 * Start metadata-only classification of PENDING contracts.
 * Returns immediately — classification runs in the background.
 *
 * Auth: Authorization: Bearer {INGEST_SECRET}
 * Body (optional): { limit?: number }
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let limit = 500;
  try {
    const body = await req.json();
    if (body?.limit && typeof body.limit === "number") {
      limit = body.limit;
    }
  } catch {
    // No body or invalid JSON — use default limit
  }

  // Count pending contracts
  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "PENDING"),
        eq(contracts.classifiedFromMetadata, false)
      )
    );

  if (pendingCount === 0) {
    return NextResponse.json({
      message: "No pending contracts to classify",
      pendingCount: 0,
    });
  }

  // Fire-and-forget: classify in background
  Promise.resolve()
    .then(async () => {
      console.log(`[classify/metadata] Starting metadata classification (limit: ${limit})...`);
      const result = await classifyFromMetadata({ limit });
      console.log(
        `[classify/metadata] Done: ${result.classified} classified ` +
        `(${result.good} good, ${result.maybe} maybe, ${result.discard} discard, ${result.errors} errors)`
      );
    })
    .catch((err) => {
      console.error("[classify/metadata] Background classification error:", err);
    });

  return NextResponse.json({
    message: `Metadata classification started for up to ${Math.min(limit, pendingCount)} contracts`,
    pendingCount,
  });
}
