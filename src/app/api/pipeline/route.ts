import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/pipeline
 * GET  /api/pipeline
 *
 * Server-side proxy for pipeline actions. Adds Bearer auth so the client
 * never needs INGEST_SECRET. Accepts { action, ...body } where action maps
 * to a protected endpoint.
 */

const ACTION_MAP: Record<string, { method: string; path: string }> = {
  "crawl-status":       { method: "GET",  path: "/api/crawl/status" },
  "crawl-start":        { method: "POST", path: "/api/crawl/start" },
  "crawl-pause":        { method: "POST", path: "/api/crawl/pause" },
  "classify-metadata":  { method: "POST", path: "/api/classify/metadata" },
  "classify":           { method: "POST", path: "/api/classify" },
  "fetch-descriptions": { method: "POST", path: "/api/fetch-descriptions" },
  "reclassify":         { method: "POST", path: "/api/reclassify" },
};

async function handlePipeline(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "INGEST_SECRET not configured on server" },
      { status: 500 }
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";

  // For GET requests, action comes from searchParams
  // For POST requests, action comes from body
  let action: string | null = null;
  let body: Record<string, unknown> = {};

  if (req.method === "GET") {
    action = req.nextUrl.searchParams.get("action");
  } else {
    const json = await req.json().catch(() => ({}));
    body = json as Record<string, unknown>;
    action = (body.action as string) ?? null;
    delete body.action;
  }

  const mapping = action ? ACTION_MAP[action] : null;
  if (!mapping) {
    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  }

  try {
    const fetchOptions: RequestInit = {
      method: mapping.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
    };

    if (mapping.method === "POST" && Object.keys(body).length > 0) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(`${origin}${mapping.path}`, fetchOptions);
    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    console.error(`[pipeline] Error proxying ${action}:`, err);
    return NextResponse.json(
      { error: "Pipeline action failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export const GET = handlePipeline;
export const POST = handlePipeline;
