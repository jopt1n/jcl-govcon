/**
 * POST /api/cron/check-batches
 *
 * Fires every 30 minutes via Railway cron. Processes crawl_runs rows that
 * are either waiting on an xAI batch to complete or have succeeded but
 * not yet sent their Telegram digest.
 *
 * Atomic claim pattern: before processing a row, try to set processing_at
 * to now() in a single UPDATE with a 5-minute lease. Only the winning
 * claimant processes the row. If two requests fire concurrently (cron +
 * manual curl, or overlapping cron), the loser gets zero rows back from
 * the UPDATE and skips.
 *
 * Idempotency comes from three layers:
 *   1. Atomic claim (this file) prevents concurrent processing.
 *   2. digest_sent_at gate prevents double digests.
 *   3. importBatchResults filters WHERE classification='PENDING' so a
 *      mid-import retry never double-writes a contract.
 *
 * Stalled guard: rows with batchStartedAt older than 48 hours get marked
 * status=stalled and fire a Telegram alert. This prevents a stuck xAI
 * batch from blocking future weeks forever.
 *
 * Auth: Authorization: Bearer ${INGEST_SECRET}
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crawlRuns } from "@/lib/db/schema";
import { eq, and, isNull, isNotNull, or, sql } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { pollBatch, importBatchResults } from "@/lib/ai/batch-classify";
import { sendWeeklyDigest } from "@/lib/notifications/weekly-digest";
import { sendTelegram } from "@/lib/notifications/telegram";

type CronLog = {
  kind: "check-batches";
  runId: string | null;
  step: string;
  status: "ok" | "error" | "skip";
  durationMs: number;
  data?: Record<string, unknown>;
  error?: string;
};

function log(entry: CronLog): void {
  console.log(JSON.stringify(entry));
}

const STALLED_AFTER_HOURS = 48;

async function alert(runId: string, message: string): Promise<void> {
  try {
    await sendTelegram(`⚠️ JCL GovCon cron alert\n${message}\nRun: ${runId}`);
  } catch (err) {
    console.error("[check-batches] Failed to send Telegram alert:", err);
  }
}

/**
 * Try to claim a crawl_runs row for processing by this request.
 * Returns true if claimed, false if another request holds a fresh lease.
 */
async function tryClaim(runId: string): Promise<boolean> {
  // Using raw SQL for the atomic UPDATE with the time-based lease
  // predicate. Drizzle's query builder doesn't express "column < now() -
  // interval" cleanly, and raw SQL makes the concurrency semantics more
  // obvious to future readers.
  const result = await db.execute(sql`
    UPDATE crawl_runs
    SET processing_at = NOW()
    WHERE id = ${runId}
      AND (
        processing_at IS NULL
        OR processing_at < NOW() - INTERVAL '5 minutes'
      )
    RETURNING id
  `);
  // Drizzle's execute() returns a result with `rows` (pg) or
  // `{ rowCount }` depending on driver. Be defensive.
  const rows = (result as { rows?: unknown[] }).rows;
  if (rows) return rows.length > 0;
  const rowCount = (result as { rowCount?: number }).rowCount;
  return (rowCount ?? 0) > 0;
}

async function releaseClaim(runId: string): Promise<void> {
  await db
    .update(crawlRuns)
    .set({ processingAt: null })
    .where(eq(crawlRuns.id, runId));
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  // Candidates = rows waiting on a batch OR rows that need a digest fired.
  const candidates = await db
    .select({
      id: crawlRuns.id,
      batchId: crawlRuns.batchId,
      batchStartedAt: crawlRuns.batchStartedAt,
      batchFinishedAt: crawlRuns.batchFinishedAt,
      digestSentAt: crawlRuns.digestSentAt,
      status: crawlRuns.status,
    })
    .from(crawlRuns)
    .where(
      or(
        and(isNotNull(crawlRuns.batchId), isNull(crawlRuns.batchFinishedAt)),
        and(eq(crawlRuns.status, "succeeded"), isNull(crawlRuns.digestSentAt)),
      ),
    );

  if (candidates.length === 0) {
    log({
      kind: "check-batches",
      runId: null,
      step: "scan",
      status: "ok",
      durationMs: Date.now() - startedAt,
      data: { candidates: 0 },
    });
    return NextResponse.json({ ok: true, processed: 0, skipped: 0 });
  }

  let processed = 0;
  let skipped = 0;
  const results: unknown[] = [];

  for (const candidate of candidates) {
    const claimed = await tryClaim(candidate.id);
    if (!claimed) {
      skipped++;
      log({
        kind: "check-batches",
        runId: candidate.id,
        step: "claim",
        status: "skip",
        durationMs: 0,
        data: { reason: "held by another request" },
      });
      continue;
    }

    try {
      const rowResult = await processRow(candidate);
      results.push(rowResult);
      processed++;
    } catch (err) {
      // Any unexpected error — log, alert, leave row in whatever state the
      // sub-handler left it in, release the claim.
      const msg = err instanceof Error ? err.message : String(err);
      log({
        kind: "check-batches",
        runId: candidate.id,
        step: "process",
        status: "error",
        durationMs: 0,
        error: msg,
      });
      await alert(candidate.id, `check-batches processing error: ${msg}`);
    } finally {
      await releaseClaim(candidate.id);
    }
  }

  log({
    kind: "check-batches",
    runId: null,
    step: "done",
    status: "ok",
    durationMs: Date.now() - startedAt,
    data: { candidates: candidates.length, processed, skipped },
  });

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    processed,
    skipped,
    results,
  });
}

/**
 * Advance a single claimed row through one of three paths:
 *   A. Row has an active batch → poll, maybe import
 *   B. Row succeeded but needs a digest → send digest
 *   C. Row is stalled → mark stalled + alert
 */
async function processRow(row: {
  id: string;
  batchId: string | null;
  batchStartedAt: Date | null;
  batchFinishedAt: Date | null;
  digestSentAt: Date | null;
  status: string;
}): Promise<{ runId: string; outcome: string }> {
  // ── Path C: Stalled guard ───────────────────────────────────────────
  if (
    row.batchId &&
    !row.batchFinishedAt &&
    row.batchStartedAt &&
    Date.now() - row.batchStartedAt.getTime() >
      STALLED_AFTER_HOURS * 60 * 60 * 1000
  ) {
    await db
      .update(crawlRuns)
      .set({
        status: "stalled",
        errorStep: "batch_poll",
        error: `Batch stalled: running longer than ${STALLED_AFTER_HOURS}h`,
      })
      .where(eq(crawlRuns.id, row.id));
    log({
      kind: "check-batches",
      runId: row.id,
      step: "stalled",
      status: "ok",
      durationMs: 0,
      data: { batchId: row.batchId },
    });
    await alert(
      row.id,
      `xAI batch stalled (>${STALLED_AFTER_HOURS}h). BatchId: ${row.batchId}`,
    );
    return { runId: row.id, outcome: "stalled" };
  }

  // ── Path A: Poll active batch ───────────────────────────────────────
  if (row.batchId && !row.batchFinishedAt) {
    const stepStart = Date.now();
    let pollResult;
    try {
      pollResult = await pollBatch(row.batchId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log({
        kind: "check-batches",
        runId: row.id,
        step: "poll",
        status: "error",
        durationMs: Date.now() - stepStart,
        error: msg,
      });
      // Transient poll failure: don't mark the row failed, just leave it.
      // Next cron fire will retry.
      return { runId: row.id, outcome: "poll_error" };
    }

    await db
      .update(crawlRuns)
      .set({ batchStatus: pollResult.status })
      .where(eq(crawlRuns.id, row.id));

    if (pollResult.status === "running") {
      log({
        kind: "check-batches",
        runId: row.id,
        step: "poll",
        status: "ok",
        durationMs: Date.now() - stepStart,
        data: {
          batchStatus: "running",
          success: pollResult.numSuccess,
          pending: pollResult.numPending,
        },
      });
      return { runId: row.id, outcome: "still_running" };
    }

    if (pollResult.status === "failed") {
      await db
        .update(crawlRuns)
        .set({
          status: "failed",
          errorStep: "batch_poll",
          error: `Batch reported failed state: ${pollResult.numError} errors of ${pollResult.total}`,
          batchFinishedAt: new Date(),
        })
        .where(eq(crawlRuns.id, row.id));
      log({
        kind: "check-batches",
        runId: row.id,
        step: "poll",
        status: "error",
        durationMs: Date.now() - stepStart,
        error: "batch failed",
      });
      await alert(
        row.id,
        `xAI batch failed. ${pollResult.numError} errors of ${pollResult.total}. BatchId: ${row.batchId}`,
      );
      return { runId: row.id, outcome: "batch_failed" };
    }

    // completed → import
    const importStart = Date.now();
    let importResult;
    try {
      importResult = await importBatchResults(row.batchId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(crawlRuns)
        .set({
          status: "failed",
          errorStep: "import",
          error: msg,
        })
        .where(eq(crawlRuns.id, row.id));
      log({
        kind: "check-batches",
        runId: row.id,
        step: "import",
        status: "error",
        durationMs: Date.now() - importStart,
        error: msg,
      });
      await alert(row.id, `import failed: ${msg}`);
      return { runId: row.id, outcome: "import_failed" };
    }

    await db
      .update(crawlRuns)
      .set({
        batchFinishedAt: new Date(),
        batchStatus: "completed",
        contractsClassified: importResult.classified,
        status: "succeeded",
      })
      .where(eq(crawlRuns.id, row.id));

    log({
      kind: "check-batches",
      runId: row.id,
      step: "import",
      status: "ok",
      durationMs: Date.now() - importStart,
      data: {
        classified: importResult.classified,
        good: importResult.good,
        maybe: importResult.maybe,
        discard: importResult.discard,
      },
    });

    // Fall through to the digest send below by pretending this row is now
    // in the "succeeded, digest not sent" state. Refresh the row state for
    // the digest check.
    row.status = "succeeded";
    row.digestSentAt = null;
  }

  // ── Path B: Fire digest on succeeded row ────────────────────────────
  if (row.status === "succeeded" && !row.digestSentAt) {
    const digestStart = Date.now();
    try {
      const digestResult = await sendWeeklyDigest(row.id);
      log({
        kind: "check-batches",
        runId: row.id,
        step: "digest",
        status: "ok",
        durationMs: Date.now() - digestStart,
        data: {
          good: digestResult.good,
          maybe: digestResult.maybe,
          triaged: digestResult.triaged,
          messageLength: digestResult.messageLength,
        },
      });
      return { runId: row.id, outcome: "digest_sent" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Retry-friendly: leave status='succeeded' and digestSentAt=NULL so
      // the next check-batches fire re-selects this row and retries the
      // send. Record the last error on the row for the admin page without
      // flipping status. Don't re-alert via Telegram since the failure IS
      // Telegram in most cases.
      await db
        .update(crawlRuns)
        .set({
          errorStep: "digest",
          error: msg,
        })
        .where(eq(crawlRuns.id, row.id));
      log({
        kind: "check-batches",
        runId: row.id,
        step: "digest",
        status: "error",
        durationMs: Date.now() - digestStart,
        error: msg,
      });
      return { runId: row.id, outcome: "digest_failed" };
    }
  }

  return { runId: row.id, outcome: "nothing_to_do" };
}
