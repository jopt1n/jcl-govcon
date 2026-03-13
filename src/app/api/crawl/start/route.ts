import { NextRequest, NextResponse } from "next/server";
import { runBulkCrawl } from "@/lib/sam-gov/bulk-crawl";
import { authorize } from "@/lib/auth";

/**
 * POST /api/crawl/start
 *
 * Begin metadata-only bulk crawl of SAM.gov.
 * Returns immediately — use GET /api/crawl/status to monitor progress.
 *
 * Auth: Authorization: Bearer {INGEST_SECRET}
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fire-and-forget: kick off the metadata crawl in the background
  Promise.resolve()
    .then(async () => {
      console.log("[crawl/start] Starting metadata-only bulk crawl...");
      const crawlResult = await runBulkCrawl();
      console.log(
        `[crawl/start] Crawl complete: ${crawlResult.newInserted} new, ${crawlResult.skipped} skipped, ${crawlResult.pagesProcessed} pages`
      );
    })
    .catch((err) => {
      console.error("[crawl/start] Background crawl error:", err);
    });

  // Return immediately
  return NextResponse.json({
    status: "started",
    phase: "metadata",
    message: "Use GET /api/crawl/status to monitor progress",
  });
}
