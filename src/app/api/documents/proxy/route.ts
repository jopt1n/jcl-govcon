import { NextRequest, NextResponse } from "next/server";

const SAM_API_KEY = process.env.SAM_GOV_API_KEY;
const ALLOWED_HOST = "sam.gov";
const TIMEOUT_MS = 30_000;

/**
 * GET /api/documents/proxy?url=<sam-gov-download-url>
 *
 * Proxies SAM.gov document downloads through our server so the browser
 * doesn't need the API key. Streams the response back with the correct
 * Content-Type so PDFs render inline.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const viewInline = req.nextUrl.searchParams.get("view") === "1";
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Only proxy SAM.gov URLs — prevent SSRF
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(ALLOWED_HOST)) {
      return NextResponse.json({ error: "Only SAM.gov URLs are allowed" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!SAM_API_KEY) {
    return NextResponse.json({ error: "SAM_GOV_API_KEY not configured" }, { status: 500 });
  }

  try {
    const separator = url.includes("?") ? "&" : "?";
    const authedUrl = `${url}${separator}api_key=${SAM_API_KEY}`;

    const res = await fetch(authedUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `SAM.gov returned ${res.status}` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const contentDisposition = res.headers.get("content-disposition");
    const body = res.body;

    if (!body) {
      return NextResponse.json({ error: "Empty response from SAM.gov" }, { status: 502 });
    }

    // Extract filename from Content-Disposition if available
    const filenameMatch = contentDisposition?.match(/filename[*]?=["']?([^"';\n]+)/);
    const filename = filenameMatch?.[1] || null;

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    };

    if (viewInline) {
      // Force inline display — strip any "attachment" disposition from SAM.gov
      headers["Content-Disposition"] = filename
        ? `inline; filename="${filename}"`
        : "inline";
    } else if (contentDisposition) {
      headers["Content-Disposition"] = contentDisposition;
    }

    return new NextResponse(body as ReadableStream, { status: 200, headers });
  } catch (err: any) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return NextResponse.json({ error: "SAM.gov request timed out" }, { status: 504 });
    }
    return NextResponse.json(
      { error: "Failed to fetch document", message: err.message },
      { status: 500 }
    );
  }
}
