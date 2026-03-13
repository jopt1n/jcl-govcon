import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/ingest/manual
 *
 * Triggers daily ingest without requiring the client to know INGEST_SECRET.
 * Internally calls POST /api/ingest/trigger with the server-side secret.
 * No auth required — dashboard-only route.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "INGEST_SECRET not configured on server" },
      { status: 500 }
    );
  }

  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
    const body = await req.json().catch(() => ({}));
    const mode = (body as { mode?: string }).mode ?? "daily";

    const response = await fetch(`${origin}/api/ingest/trigger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ mode }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[ingest/manual] Error:", err);
    return NextResponse.json(
      {
        error: "Manual ingest failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
