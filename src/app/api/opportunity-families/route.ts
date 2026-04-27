import { NextRequest, NextResponse } from "next/server";
import { listPromotedOpportunityFamilies } from "@/lib/opportunity-family/service";

/**
 * GET /api/opportunity-families
 *
 * Family listing surface. Today only PROMOTE is public because Chosen is the
 * user-facing promoted-family workflow.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const decision = searchParams.get("decision");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)),
    );

    if (decision !== "PROMOTE") {
      return NextResponse.json(
        { error: "Invalid decision" },
        { status: 400 },
      );
    }

    const result = await listPromotedOpportunityFamilies({ page, limit });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/opportunity-families] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch opportunity families",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
