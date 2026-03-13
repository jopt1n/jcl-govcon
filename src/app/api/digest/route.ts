import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { sendDigest } from "@/lib/email/digest";

/**
 * POST /api/digest
 *
 * Triggers the daily email digest of new contract opportunities.
 * Auth: Bearer INGEST_SECRET (called by n8n after ingest).
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDigest();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[digest] Error sending digest:", err);
    return NextResponse.json(
      { error: "Failed to send digest" },
      { status: 500 }
    );
  }
}
