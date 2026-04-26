import { NextRequest, NextResponse } from "next/server";
import { getOpportunityFamilyForContract } from "@/lib/opportunity-family/service";

/**
 * GET /api/contracts/[id]/family
 *
 * Local-only family lookup. No SAM.gov calls. Returns the current notice,
 * related notice history, user action state, and whether the viewed notice is
 * superseded by a newer/current row.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const family = await getOpportunityFamilyForContract(params.id);

    if (!family) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(family);
  } catch (err) {
    console.error("[api/contracts/id/family] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch contract family",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
