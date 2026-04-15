import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { sniffContentType } from "@/lib/content-type";

const SAM_API_KEY = process.env.SAM_GOV_API_KEY;
const ALLOWED_HOST = "sam.gov";
const TIMEOUT_MS = 30_000;

const DOCX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

// SAM.gov sends application/octet-stream for everything — detect real type from filename
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
};

function detectMimeType(
  filename: string | null,
  serverContentType: string,
  buffer?: Buffer,
): string {
  // If server sent a specific type (not octet-stream/xml error), trust it
  if (
    serverContentType &&
    !serverContentType.includes("octet-stream") &&
    !serverContentType.includes("force-download") &&
    !serverContentType.includes("application/xml")
  ) {
    return serverContentType;
  }
  // Magic-byte sniffing (handles UUID filenames, S3 errors returning XML)
  if (buffer) {
    const sniffed = sniffContentType(buffer);
    if (sniffed) return sniffed;
  }
  // Detect from filename extension
  if (filename) {
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  }
  return serverContentType || "application/octet-stream";
}

/**
 * SAM.gov returns a 303 redirect to a signed S3 URL with a ~9s expiry.
 * fetch() auto-follows the redirect but loses the original SAM.gov headers
 * (Content-Type, Content-Disposition with filename). We disable auto-redirect
 * to capture those headers, then follow the Location manually.
 */
async function fetchFromSam(authedUrl: string): Promise<{
  buffer: Buffer;
  samContentType: string;
  samContentDisposition: string | null;
}> {
  // Step 1: Hit SAM.gov with redirect: "manual" to capture headers
  const initial = await fetch(authedUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const samContentType =
    initial.headers.get("content-type") || "application/octet-stream";
  const samContentDisposition = initial.headers.get("content-disposition");
  const location = initial.headers.get("location");

  // Step 2: If redirect, follow to S3
  if (
    location &&
    (initial.status === 301 || initial.status === 302 || initial.status === 303)
  ) {
    const s3Res = await fetch(location, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!s3Res.ok) {
      throw new Error(`S3 returned ${s3Res.status}`);
    }
    return {
      buffer: Buffer.from(await s3Res.arrayBuffer()),
      samContentType,
      samContentDisposition,
    };
  }

  // No redirect — read directly
  if (!initial.ok) {
    throw new Error(`SAM.gov returned ${initial.status}`);
  }
  return {
    buffer: Buffer.from(await initial.arrayBuffer()),
    samContentType,
    samContentDisposition,
  };
}

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
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  // Only proxy SAM.gov URLs — prevent SSRF
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(ALLOWED_HOST)) {
      return NextResponse.json(
        { error: "Only SAM.gov URLs are allowed" },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!SAM_API_KEY) {
    return NextResponse.json(
      { error: "SAM_GOV_API_KEY not configured" },
      { status: 500 },
    );
  }

  try {
    const separator = url.includes("?") ? "&" : "?";
    const authedUrl = `${url}${separator}api_key=${SAM_API_KEY}`;

    const { buffer, samContentType, samContentDisposition } =
      await fetchFromSam(authedUrl);

    // Extract filename from SAM.gov's Content-Disposition (preserved from pre-redirect)
    const filenameMatch = samContentDisposition?.match(
      /filename[*]?=["']?([^"';\n]+)/,
    );
    const filename = filenameMatch?.[1] || null;

    // Detect real type: SAM.gov header → magic bytes → filename extension
    const contentType = detectMimeType(filename, samContentType, buffer);

    // For inline viewing of DOCX files, convert to HTML and return as JSON
    // Client uses iframe srcdoc attribute with this HTML — no blob URL needed
    if (viewInline && isDocx(contentType, filename)) {
      const result = await mammoth.convertToHtml({ buffer });
      const html = wrapHtml(result.value, filename || "Document");
      return NextResponse.json({ html, filename });
    }

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "private, max-age=3600",
    };

    if (viewInline) {
      headers["Content-Disposition"] = filename
        ? `inline; filename="${filename}"`
        : "inline";
    } else if (samContentDisposition) {
      headers["Content-Disposition"] = samContentDisposition;
    }

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    const error = err as Error;
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return NextResponse.json(
        { error: "SAM.gov request timed out" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch document", message: error.message },
      { status: 500 },
    );
  }
}

/**
 * HEAD /api/documents/proxy?url=<sam-gov-download-url>
 * Returns headers only (filename, content-type) without downloading the file body.
 * Used by contract detail to resolve document names.
 */
export async function HEAD(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse(null, { status: 400 });

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(ALLOWED_HOST)) {
      return new NextResponse(null, { status: 403 });
    }
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (!SAM_API_KEY) return new NextResponse(null, { status: 500 });

  try {
    const separator = url.includes("?") ? "&" : "?";
    const authedUrl = `${url}${separator}api_key=${SAM_API_KEY}`;
    // Use redirect: "manual" to capture SAM.gov's headers (not S3's)
    const res = await fetch(authedUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

    const contentDisposition = res.headers.get("content-disposition") || "";
    const rawContentType =
      res.headers.get("content-type") || "application/octet-stream";
    const filenameMatch = contentDisposition.match(
      /filename[*]?=["']?([^"';\n]+)/,
    );
    const filename = filenameMatch?.[1] || null;
    const contentType = detectMimeType(filename, rawContentType);

    const headers: Record<string, string> = {
      "Content-Type": contentType,
    };
    if (filename) {
      headers["Content-Disposition"] = `inline; filename="${filename}"`;
    }
    return new NextResponse(null, { status: 200, headers });
  } catch {
    return new NextResponse(null, { status: 502 });
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
