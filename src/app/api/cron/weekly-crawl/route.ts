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
import { eq, and, gte, sql } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { runBulkCrawl } from "@/lib/sam-gov/bulk-crawl";
import { submitBatchClassify } from "@/lib/ai/batch-classify";
import {
  sendTelegram,
  requireTelegramConfig,
  TelegramConfigError,
} from "@/lib/notifications/telegram";

// Stable arbitrary int key for pg_try_advisory_lock. Scoped to the
// weekly-crawl route only. Session-scoped (NOT xact-scoped) so we don't
// pin a Railway pool connection inside a multi-minute transaction.
const WEEKLY_CRAWL_LOCK_KEY = 7_242_023;

type CronLog = {
  kind: "weekly-crawl";
  runId: string | null;
  step: string;
  status: "ok" | "error" | "skip";
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

  // ── Preflight: Telegram config ───────────────────────────────────────
  // Fail loud in prod when Telegram env is missing, rather than halfway
  // through on the first alert/digest call. Leaves a failed crawl_runs row
  // behind so /admin/crawl-runs surfaces the problem.
  try {
    requireTelegramConfig();
  } catch (err) {
    if (err instanceof TelegramConfigError) {
      const msg = err.message;
      let runId: string | null = null;
      try {
        const inserted = await db
          .insert(crawlRuns)
          .values({
            kind: "weekly",
            windowStart: sevenDaysAgo,
            windowEnd: now,
            status: "failed",
            errorStep: "telegram_config",
            error: msg,
          })
          .returning({ id: crawlRuns.id });
        runId = inserted[0].id;
      } catch (insertErr) {
        console.error(
          "[weekly-crawl] Failed to record telegram_config failure row:",
          insertErr,
        );
      }
      log({
        kind: "weekly-crawl",
        runId,
        step: "telegram_config",
        status: "error",
        durationMs: 0,
        error: msg,
      });
      return NextResponse.json(
        { error: "Telegram config missing", runId, message: msg },
        { status: 500 },
      );
    }
    throw err;
  }

  // ── Preflight: Advisory lock for single-writer semantics ────────────
  // Session-scoped (not xact-scoped) so the multi-minute crawl+submit body
  // below does NOT hold a pinned transaction. Released explicitly in the
  // finally block. On crash, Postgres releases session locks automatically
  // when the connection is returned to the pool.
  const acquireResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${WEEKLY_CRAWL_LOCK_KEY}) AS locked`,
  );
  // postgres-js returns a bare array, not { rows: [...] }
  const resultRows = Array.isArray(acquireResult)
    ? acquireResult
    : ((acquireResult as { rows?: unknown[] }).rows ?? []);
  const locked = (resultRows[0] as { locked?: boolean })?.locked ?? false;

  if (!locked) {
    log({
      kind: "weekly-crawl",
      runId: null,
      step: "preflight",
      status: "skip",
      durationMs: 0,
      error: "another weekly-crawl is in progress",
    });
    return NextResponse.json({
      ok: true,
      skipped: "another weekly-crawl in progress",
    });
  }

  try {
    return await runWeeklyCrawl(sevenDaysAgo, now);
  } finally {
    await db
      .execute(sql`SELECT pg_advisory_unlock(${WEEKLY_CRAWL_LOCK_KEY})`)
      .catch((err) => {
        console.error("[weekly-crawl] Failed to release advisory lock:", err);
      });
  }
}

async function runWeeklyCrawl(
  sevenDaysAgo: Date,
  now: Date,
): Promise<NextResponse> {
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

  // ── Step 3: Check if any PENDING contracts exist in this window ─────
  // Scoped to createdAt >= sevenDaysAgo so the ~332 pre-existing stuck
  // PENDING rows don't defeat the fast-path skip. The WHERE clause here
  // MUST be an exact structural match for submitBatchClassify's WHERE
  // below (userOverride=false, classification='PENDING', createdAt >=
  // sevenDaysAgo) — if they drift, the skip/throw paths become
  // nondeterministic. Same captured Date is passed to both queries to
  // eliminate any timestamp drift between calls.
  const pendingRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "PENDING"),
        eq(contracts.userOverride, false),
        gte(contracts.createdAt, sevenDaysAgo),
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
    submitResult = await submitBatchClassify({
      pendingOnly: true,
      since: sevenDaysAgo,
    });
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
