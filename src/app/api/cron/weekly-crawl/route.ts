/**
 * POST /api/cron/weekly-crawl
 *
 * Authenticated manual/compatibility trigger for the weekly crawl job. The
 * Railway weekly cron runs scripts/weekly-crawl-worker.ts directly so Railway
 * can track the actual job exit code instead of an HTTP edge response.
 *
 * This route still blocks until the crawl and batch-submit step completes:
 * xAI batches take 30 minutes to 24 hours to finish, so import + digest remain
 * owned by /api/cron/check-batches, which runs every 30 minutes.
 *
 * Auth: Authorization: Bearer ${INGEST_SECRET}
 */

import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { runWeeklyCrawlJob } from "@/lib/cron/weekly-crawl";

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runWeeklyCrawlJob();
  return NextResponse.json(result.body, { status: result.httpStatus });
}
