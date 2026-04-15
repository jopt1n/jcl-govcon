import { NextRequest, NextResponse } from "next/server";
import { sniffContentType } from "@/lib/content-type";

// Allowed origin patterns — lock to SAM.gov domains
const ALLOWED_ORIGINS = [
  "sam.gov",
  "api.sam.gov",
  "beta.sam.gov",
  "www.sam.gov",
];

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_ORIGINS.some(
      (origin) =>
        parsed.hostname === origin || parsed.hostname.endsWith(`.${origin}`)
    );
  } catch {
    return false;
  }
}

// Extension → MIME fallback
const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".xml": "application/xml",
  ".json": "application/json",
  ".zip": "application/zip",
};

function guessMimeFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const ext = pathname.slice(pathname.lastIndexOf("."));
    if (ext.length > 1 && ext.length < 8) return EXT_TO_MIME[ext] || null;
  } catch {}
  return null;
}



export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Missing 'url' query parameter" },
      { status: 400 }
    );
  }

  if (!isAllowedUrl(url)) {
    return NextResponse.json(
      { error: "URL not allowed. Only SAM.gov domains are permitted." },
      { status: 403 }
    );
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch document: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // ── Content-Type resolution chain ──
    // 1. Try upstream header (skip if generic octet-stream / force-download)
    const upstreamCt = response.headers.get("content-type") || "";
    let contentType: string;

    if (
      upstreamCt &&
      !upstreamCt.includes("octet-stream") &&
      !upstreamCt.includes("force-download")
    ) {
      contentType = upstreamCt;
    }
    // 2. Magic-byte sniffing (critical for UUID filenames with no extension)
    else {
      const sniffed = sniffContentType(buffer);
      if (sniffed) {
        contentType = sniffed;
      }
      // 3. URL extension fallback
      else {
        contentType = guessMimeFromUrl(url) || "application/octet-stream";
      }
    }

    // Extract filename
    let filename = "document";
    const disposition = response.headers.get("content-disposition");
    if (disposition) {
      const match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
      if (match) filename = decodeURIComponent(match[1].replace(/"/g, ""));
    } else {
      try {
        const pathParts = new URL(url).pathname.split("/");
        const last = pathParts[pathParts.length - 1];
        if (last) filename = decodeURIComponent(last);
      } catch {}
    }

    // If filename has no recognizable extension (UUID-only), append one
    if (!filename.includes(".") || filename.match(/^[0-9a-f-]{20,}$/i)) {
      const extMap: Record<string, string> = {
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "application/vnd.ms-excel": ".xls",
        "application/msword": ".doc",
        "application/vnd.ms-powerpoint": ".ppt",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
      };
      const ext = extMap[contentType.split(";")[0].trim()] || "";
      if (ext) filename = `${filename}${ext}`;
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
        "X-Original-URL": url,
        "X-Detected-Type": contentType,
      },
    });
  } catch (err: unknown) {
    console.error("Proxy fetch error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Proxy error: ${message}` },
      { status: 502 }
    );
  }
}
