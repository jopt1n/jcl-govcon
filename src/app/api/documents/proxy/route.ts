import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

const SAM_API_KEY = process.env.SAM_GOV_API_KEY;
const ALLOWED_HOST = "sam.gov";
const TIMEOUT_MS = 30_000;

const DOCX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

/**
 * GET /api/documents/proxy?url=<sam-gov-download-url>&view=1
 *
 * Proxies SAM.gov document downloads through our server.
 * When view=1:
 *   - PDFs: served inline (browser's built-in viewer)
 *   - DOCX/DOC: converted to HTML via mammoth and served as a styled page
 * Without view=1: downloads the raw file.
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

    // Extract filename from Content-Disposition if available
    const filenameMatch = contentDisposition?.match(/filename[*]?=["']?([^"';\n]+)/);
    const filename = filenameMatch?.[1] || null;

    // For inline viewing of DOCX files, convert to HTML and return as JSON
    // Client uses iframe srcdoc attribute with this HTML — no blob URL needed
    if (viewInline && isDocx(contentType, filename)) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const result = await mammoth.convertToHtml({ buffer });
      const html = wrapHtml(result.value, filename || "Document");
      return NextResponse.json({ html, filename });
    }

    const body = res.body;
    if (!body) {
      return NextResponse.json({ error: "Empty response from SAM.gov" }, { status: 502 });
    }

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    };

    if (viewInline) {
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

function isDocx(contentType: string, filename: string | null): boolean {
  if (DOCX_TYPES.has(contentType)) return true;
  if (filename) {
    const lower = filename.toLowerCase();
    return lower.endsWith(".docx") || lower.endsWith(".doc");
  }
  return false;
}

function wrapHtml(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    td, th {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th { background: #f5f5f5; }
    img { max-width: 100%; }
    h1, h2, h3 { margin-top: 1.5rem; }
    p { margin: 0.5rem 0; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
