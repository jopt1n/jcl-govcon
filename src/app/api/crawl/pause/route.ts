import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crawlProgress } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/**
 * POST /api/crawl/pause
 *
 * Pause an in-progress crawl/classification.
 * Sets the crawl_progress status to PAUSED.
 *
 * Auth: Authorization: Bearer {INGEST_SECRET}
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find RUNNING crawl
    const running = await db
      .select()
      .from(crawlProgress)
      .where(eq(crawlProgress.status, "RUNNING"))
      .limit(1);

    if (running.length === 0) {
      return NextResponse.json(
        { error: "No running crawl to pause" },
        { status: 404 }
      );
    }

    // Update to PAUSED
    await db
      .update(crawlProgress)
      .set({
        status: "PAUSED",
        updatedAt: new Date(),
      })
      .where(eq(crawlProgress.id, running[0].id));

    return NextResponse.json({
      message: "Crawl paused",
      crawlId: running[0].id,
      processed: running[0].processed,
      classified: running[0].classified,
      totalFound: running[0].totalFound,
    });
  } catch (err) {
    console.error("[crawl/pause] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to pause crawl",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
