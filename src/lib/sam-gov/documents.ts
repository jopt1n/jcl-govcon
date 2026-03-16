import type { SamResourceLink, DownloadedDocument } from "./types";

/** File extensions we want to download for analysis */
const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".doc"]);

/** Content types that map to analyzable documents */
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

/** Max file size to download: 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Extract file extension from a URL, stripping query params.
 */
function getExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot === -1) return "";
    return pathname.slice(lastDot).toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Extract a filename from a URL.
 */
function getFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/");
    return parts[parts.length - 1] || "document";
  } catch {
    return "document";
  }
}

/**
 * Filter resource links to only those we want to download (PDF, DOCX).
 * Resource link downloads are direct URLs and do NOT count against the API limit.
 */
export function filterDownloadableLinks(
  links: (string | SamResourceLink)[] | null
): string[] {
  if (!links || links.length === 0) return [];

  return links
    .map((link) => (typeof link === "string" ? link : link.url))
    .filter((url) => {
      if (!url) return false;
      const ext = getExtension(url);
      return ALLOWED_EXTENSIONS.has(ext);
    });
}

/**
 * Download a single document from a resource link URL.
 * Returns null if the download fails or file is too large.
 */
async function downloadOne(
  url: string
): Promise<DownloadedDocument | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000), // 30s timeout per doc
    });

    if (!res.ok) {
      console.warn(
        `[documents] Failed to download ${url}: ${res.status} ${res.statusText}`
      );
      return null;
    }

    // Check content length if available
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
      console.warn(
        `[documents] Skipping ${url}: too large (${contentLength} bytes)`
      );
      return null;
    }

    const contentType = res.headers.get("content-type") || "";
    const ext = getExtension(url);

    // Verify content type matches what we expect, or trust the extension
    const isAllowedType = ALLOWED_CONTENT_TYPES.has(
      contentType.split(";")[0].trim()
    );
    const isAllowedExt = ALLOWED_EXTENSIONS.has(ext);

    if (!isAllowedType && !isAllowedExt) {
      console.warn(
        `[documents] Skipping ${url}: unexpected content type "${contentType}"`
      );
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_FILE_SIZE) {
      console.warn(
        `[documents] Skipping ${url}: too large (${buffer.length} bytes)`
      );
      return null;
    }

    return {
      url: url,
      filename: getFilename(url),
      contentType: contentType.split(";")[0].trim(),
      buffer,
    };
  } catch (err) {
    console.warn(
      `[documents] Error downloading ${url}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Download all analyzable documents from a set of resource links.
 * Downloads in parallel (max 3 concurrent) and returns successful downloads.
 */
export async function downloadDocuments(
  links: (string | SamResourceLink)[] | null
): Promise<DownloadedDocument[]> {
  const downloadable = filterDownloadableLinks(links);
  if (downloadable.length === 0) return [];

  // Download up to 3 at a time to avoid overwhelming servers
  const results: DownloadedDocument[] = [];
  const batchSize = 3;

  for (let i = 0; i < downloadable.length; i += batchSize) {
    const batch = downloadable.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(downloadOne));

    for (const doc of batchResults) {
      if (doc) results.push(doc);
    }
  }

  return results;
}
