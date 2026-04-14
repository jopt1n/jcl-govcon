/**
 * POST /api/cron/weekly-crawl
 *
 * Fires every Sunday 03:00 UTC via Railway cron. Non-blocking: crawls the
 * last 7 days from SAM.gov, submits an xAI batch, returns immediately.
 * xAI batches take 30 minutes to 24 hours to complete, so the actual
 * import + digest happens in /api/cron/check-batches which runs every 30
 * minutes.
 *
 * Lifecycle:
 *   INSERT crawl_runs row (status=running)
 *   runBulkCrawl(7daysAgo, today) → update crawlFinishedAt, contractsFound
 *     status → crawled
 *   submitBatchClassify({ pendingOnly: true }) → update batchId
 *     status → classifying
 *   If the crawl found no new PENDING contracts, skip batch submission and
 *   set status=succeeded directly so check-batches fires the (empty)
 *   digest.
 *
 * On failure at any step: update status=failed, errorStep, fire Telegram
 * alert, return 500.
 *
 * Auth: Authorization: Bearer ${INGEST_SECRET}
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crawlRuns, contracts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { runBulkCrawl } from "@/lib/sam-gov/bulk-crawl";
import { submitBatchClassify } from "@/lib/ai/batch-classify";
import { sendTelegram } from "@/lib/notifications/telegram";

type CronLog = {
  kind: "weekly-crawl";
  runId: string | null;
  step: string;
  status: "ok" | "error";
  durationMs: number;
  counts?: Record<string, number>;
  error?: string;
};

function log(entry: CronLog): void {
  console.log(JSON.stringify(entry));
}

async function alert(runId: string | null, message: string): Promise<void> {
  try {
    await sendTelegram(
      `⚠️ JCL GovCon cron alert\n${message}${runId ? `\nRun: ${runId}` : ""}`,
    );
  } catch (err) {
    // Telegram itself failed — log and swallow. The crawl_runs row already
    // records the original error; we don't want the alert failure to
    // cascade and obscure it.
    console.error("[weekly-crawl] Failed to send Telegram alert:", err);
  }
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // ── Step 1: Create crawl_runs row ────────────────────────────────────
  let runId: string;
  try {
    const inserted = await db
      .insert(crawlRuns)
      .values({
        kind: "weekly",
        windowStart: sevenDaysAgo,
        windowEnd: now,
        status: "running",
      })
      .returning({ id: crawlRuns.id });
    runId = inserted[0].id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({
      kind: "weekly-crawl",
      runId: null,
      step: "insert",
      status: "error",
      durationMs: 0,
      error: msg,
    });
    await alert(null, `weekly-crawl failed to create crawl_runs row: ${msg}`);
    return NextResponse.json(
      { error: "Failed to create crawl run", message: msg },
      { status: 500 },
    );
  }

  // ── Step 2: Crawl last 7 days ────────────────────────────────────────
  const crawlStartedAt = new Date();
  await db
    .update(crawlRuns)
    .set({ crawlStartedAt })
    .where(eq(crawlRuns.id, runId));

  let crawlResult;
  try {
    crawlResult = await runBulkCrawl(sevenDaysAgo, now);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(crawlRuns)
      .set({
        status: "failed",
        errorStep: "crawl",
        error: msg,
      })
      .where(eq(crawlRuns.id, runId));
    log({
      kind: "weekly-crawl",
      runId,
      step: "crawl",
      status: "error",
      durationMs: Date.now() - crawlStartedAt.getTime(),
      error: msg,
    });
    await alert(runId, `weekly-crawl crawl step failed: ${msg}`);
    return NextResponse.json(
      { error: "Crawl failed", runId, message: msg },
      { status: 500 },
    );
  }

  const crawlFinishedAt = new Date();
  await db
    .update(crawlRuns)
    .set({
      crawlFinishedAt,
      contractsFound: crawlResult.totalFound,
      status: "crawled",
    })
    .where(eq(crawlRuns.id, runId));

  log({
    kind: "weekly-crawl",
    runId,
    step: "crawl",
    status: "ok",
    durationMs: crawlFinishedAt.getTime() - crawlStartedAt.getTime(),
    counts: {
      totalFound: crawlResult.totalFound,
      newInserted: crawlResult.newInserted,
    },
  });

  // ── Step 3: Check if any PENDING contracts exist ────────────────────
  // If the crawl found nothing new (or all were pre-filtered), skip batch
  // submission and mark succeeded so check-batches fires an empty digest.
  const pendingRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "PENDING"),
        eq(contracts.userOverride, false),
      ),
    )
    .limit(1);

  if (pendingRows.length === 0) {
    await db
      .update(crawlRuns)
      .set({
        status: "succeeded",
        contractsClassified: 0,
      })
      .where(eq(crawlRuns.id, runId));

    log({
      kind: "weekly-crawl",
      runId,
      step: "done",
      status: "ok",
      durationMs: Date.now() - crawlStartedAt.getTime(),
      counts: { totalFound: crawlResult.totalFound, pending: 0 },
    });

    return NextResponse.json({
      ok: true,
      runId,
      status: "succeeded",
      totalFound: crawlResult.totalFound,
      newInserted: crawlResult.newInserted,
      message:
        "No PENDING contracts to classify. Digest will fire on next check-batches run.",
    });
  }

  // ── Step 4: Submit xAI batch ─────────────────────────────────────────
  const batchStartedAt = new Date();
  await db
    .update(crawlRuns)
    .set({ batchStartedAt })
    .where(eq(crawlRuns.id, runId));

  let submitResult;
  try {
    submitResult = await submitBatchClassify({ pendingOnly: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(crawlRuns)
      .set({
        status: "failed",
        errorStep: "batch_submit",
        error: msg,
      })
      .where(eq(crawlRuns.id, runId));
    log({
      kind: "weekly-crawl",
      runId,
      step: "batch_submit",
      status: "error",
      durationMs: Date.now() - batchStartedAt.getTime(),
      error: msg,
    });
    await alert(runId, `weekly-crawl batch submit failed: ${msg}`);
    return NextResponse.json(
      { error: "Batch submit failed", runId, message: msg },
      { status: 500 },
    );
  }

  await db
    .update(crawlRuns)
    .set({
      batchId: submitResult.batchId,
      batchStatus: "submitted",
      status: "classifying",
    })
    .where(eq(crawlRuns.id, runId));

  log({
    kind: "weekly-crawl",
    runId,
    step: "batch_submit",
    status: "ok",
    durationMs: Date.now() - batchStartedAt.getTime(),
    counts: {
      submitted: submitResult.submitted,
      preFilteredDiscard: submitResult.preFilteredDiscard,
    },
  });

  return NextResponse.json({
    ok: true,
    runId,
    status: "classifying",
    batchId: submitResult.batchId,
    totalFound: crawlResult.totalFound,
    newInserted: crawlResult.newInserted,
    submitted: submitResult.submitted,
    preFilteredDiscard: submitResult.preFilteredDiscard,
  });
}
