import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { classifyContracts } from "@/lib/ai/classifier";
import { authorize } from "@/lib/auth";

/**
 * POST /api/classify
 *
 * Manually re-classify specific contracts.
 * Body: { contractIds: string[] }
 *
 * Auth: Authorization: Bearer {INGEST_SECRET}
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { contractIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contractIds } = body;

  if (!contractIds || !Array.isArray(contractIds) || contractIds.length === 0) {
    return NextResponse.json(
      { error: "contractIds must be a non-empty array of UUIDs" },
      { status: 400 }
    );
  }

  if (contractIds.length > 100) {
    return NextResponse.json(
      { error: "Maximum 100 contracts per request" },
      { status: 400 }
    );
  }

  try {
    // Fetch contract data
    const contractRows = await db
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
        resourceLinks: contracts.resourceLinks,
      })
      .from(contracts)
      .where(inArray(contracts.id, contractIds));

    if (contractRows.length === 0) {
      return NextResponse.json(
        { error: "No contracts found for the provided IDs" },
        { status: 404 }
      );
    }

    // Classify sequentially with rate limiting
    const results = await classifyContracts(contractRows);

    const summary = {
      total: results.length,
      good: results.filter((r) => r.classification === "GOOD").length,
      maybe: results.filter((r) => r.classification === "MAYBE").length,
      discard: results.filter((r) => r.classification === "DISCARD").length,
      errors: results.filter((r) => r.error).length,
    };

    return NextResponse.json({
      summary,
      results: results.map((r) => ({
        contractId: r.contractId,
        noticeId: r.noticeId,
        classification: r.classification,
        reasoning: r.reasoning,
        documentsAnalyzed: r.documentsAnalyzed,
        error: r.error ?? null,
      })),
    });
  } catch (err) {
    console.error("[classify] Error:", err);
    return NextResponse.json(
      {
        error: "Classification failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
