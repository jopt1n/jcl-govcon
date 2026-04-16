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
import {
  sendTelegram,
  requireTelegramConfig,
  TelegramConfigError,
} from "@/lib/notifications/telegram";

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
  // postgres-js returns a bare array; other drivers return { rows: [...] }
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  return rows.length > 0;
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

  // ── Preflight: Telegram config ───────────────────────────────────────
  // This route has no per-run artifact to leave behind (it processes
  // existing rows), so just log and return 500. The weekly-crawl failure
  // that fired earlier is the primary signal.
  try {
    requireTelegramConfig();
  } catch (err) {
    if (err instanceof TelegramConfigError) {
      const msg = err.message;
      log({
        kind: "check-batches",
        runId: null,
        step: "telegram_config",
        status: "error",
        durationMs: 0,
        error: msg,
      });
      return NextResponse.json(
        { error: "Telegram config missing", message: msg },
        { status: 500 },
      );
    }
    throw err;
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
 * Immutable snapshot of a candidate row as observed at scan time.
 * Pass this by value through the sub-handlers — never mutate to re-enter
 * a later branch. The `transitionedToSucceeded` bit on PollResult is the
 * channel for "path A just flipped this row to succeeded in-request."
 */
type RowSnapshot = {
  id: string;
  batchId: string | null;
  batchStartedAt: Date | null;
  batchFinishedAt: Date | null;
  digestSentAt: Date | null;
  status: string;
};

type PollOutcome =
  | "still_running"
  | "batch_failed"
  | "stalled"
  | "poll_error"
  | "import_failed"
  | "imported"
  | "no_op";

type PollResult = {
  outcome: PollOutcome;
  /** Only true when outcome === "imported". Signals processRow to invoke
   * maybeSendDigest even though the snapshot still has status !== "succeeded". */
  transitionedToSucceeded: boolean;
};

/**
 * Path A (poll) + Path C (stalled). Never mutates its argument.
 */
async function pollAndImport(snapshot: RowSnapshot): Promise<PollResult> {
  // ── Path C: Stalled guard ───────────────────────────────────────────
  if (
    snapshot.batchId &&
    !snapshot.batchFinishedAt &&
    snapshot.batchStartedAt &&
    Date.now() - snapshot.batchStartedAt.getTime() >
      STALLED_AFTER_HOURS * 60 * 60 * 1000
  ) {
    await db
      .update(crawlRuns)
      .set({
        status: "stalled",
        errorStep: "batch_poll",
        error: `Batch stalled: running longer than ${STALLED_AFTER_HOURS}h`,
      })
      .where(eq(crawlRuns.id, snapshot.id));
    log({
      kind: "check-batches",
      runId: snapshot.id,
      step: "stalled",
      status: "ok",
      durationMs: 0,
      data: { batchId: snapshot.batchId },
    });
    await alert(
      snapshot.id,
      `xAI batch stalled (>${STALLED_AFTER_HOURS}h). BatchId: ${snapshot.batchId}`,
    );
    return { outcome: "stalled", transitionedToSucceeded: false };
  }

  // Not an active batch — nothing to poll. Let maybeSendDigest decide.
  if (!snapshot.batchId || snapshot.batchFinishedAt) {
    return { outcome: "no_op", transitionedToSucceeded: false };
  }

  const stepStart = Date.now();
  let pollResult;
  try {
    pollResult = await pollBatch(snapshot.batchId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({
      kind: "check-batches",
      runId: snapshot.id,
      step: "poll",
      status: "error",
      durationMs: Date.now() - stepStart,
      error: msg,
    });
    return { outcome: "poll_error", transitionedToSucceeded: false };
  }

  await db
    .update(crawlRuns)
    .set({ batchStatus: pollResult.status })
    .where(eq(crawlRuns.id, snapshot.id));

  if (pollResult.status === "running") {
    log({
      kind: "check-batches",
      runId: snapshot.id,
      step: "poll",
      status: "ok",
      durationMs: Date.now() - stepStart,
      data: {
        batchStatus: "running",
        success: pollResult.numSuccess,
        pending: pollResult.numPending,
      },
    });
    return { outcome: "still_running", transitionedToSucceeded: false };
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
      .where(eq(crawlRuns.id, snapshot.id));
    log({
      kind: "check-batches",
      runId: snapshot.id,
      step: "poll",
      status: "error",
      durationMs: Date.now() - stepStart,
      error: "batch failed",
    });
    await alert(
      snapshot.id,
      `xAI batch failed. ${pollResult.numError} errors of ${pollResult.total}. BatchId: ${snapshot.batchId}`,
    );
    return { outcome: "batch_failed", transitionedToSucceeded: false };
  }

  // completed → import
  const importStart = Date.now();
  let importResult;
  try {
    importResult = await importBatchResults(snapshot.batchId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(crawlRuns)
      .set({
        status: "failed",
        errorStep: "import",
        error: msg,
      })
      .where(eq(crawlRuns.id, snapshot.id));
    log({
      kind: "check-batches",
      runId: snapshot.id,
      step: "import",
      status: "error",
      durationMs: Date.now() - importStart,
      error: msg,
    });
    await alert(snapshot.id, `import failed: ${msg}`);
    return { outcome: "import_failed", transitionedToSucceeded: false };
  }

  await db
    .update(crawlRuns)
    .set({
      batchFinishedAt: new Date(),
      batchStatus: "completed",
      contractsClassified: importResult.classified,
      status: "succeeded",
    })
    .where(eq(crawlRuns.id, snapshot.id));

  log({
    kind: "check-batches",
    runId: snapshot.id,
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

  return { outcome: "imported", transitionedToSucceeded: true };
}

/**
 * Path B (digest). Uses transitionedThisCall to decide whether to treat
 * the snapshot as succeeded even though the original snapshot says
 * otherwise. Returns null when there is no digest work to do.
 */
async function maybeSendDigest(
  snapshot: RowSnapshot,
  transitionedThisCall: boolean,
): Promise<{ runId: string; outcome: string } | null> {
  const isSucceeded = transitionedThisCall || snapshot.status === "succeeded";
  const digestAlreadySent = !transitionedThisCall && snapshot.digestSentAt;

  if (!isSucceeded || digestAlreadySent) {
    return null;
  }

  const digestStart = Date.now();
  try {
    const digestResult = await sendWeeklyDigest(snapshot.id);
    log({
      kind: "check-batches",
      runId: snapshot.id,
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
    return { runId: snapshot.id, outcome: "digest_sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retry-friendly: leave status='succeeded' and digestSentAt=NULL so
    // the next check-batches fire re-selects this row and retries. Record
    // the last error without flipping status. Don't re-alert via Telegram
    // since the failure IS Telegram in most cases.
    await db
      .update(crawlRuns)
      .set({
        errorStep: "digest",
        error: msg,
      })
      .where(eq(crawlRuns.id, snapshot.id));
    log({
      kind: "check-batches",
      runId: snapshot.id,
      step: "digest",
      status: "error",
      durationMs: Date.now() - digestStart,
      error: msg,
    });
    return { runId: snapshot.id, outcome: "digest_failed" };
  }
}

/**
 * Advance a single claimed row through:
 *   A. Stalled guard (early return)
 *   B. Poll active batch → maybe import (may transition to succeeded)
 *   C. Digest send on succeeded rows
 *
 * Terminal poll outcomes (still_running, batch_failed, stalled, poll_error,
 * import_failed) short-circuit before the digest phase — batch_failed
 * explicitly does NOT fall through to digest, even though the prior
 * implementation happened to skip it as a coincidence of row state.
 */
async function processRow(candidate: {
  id: string;
  batchId: string | null;
  batchStartedAt: Date | null;
  batchFinishedAt: Date | null;
  digestSentAt: Date | null;
  status: string;
}): Promise<{ runId: string; outcome: string }> {
  const snapshot: RowSnapshot = {
    id: candidate.id,
    batchId: candidate.batchId,
    batchStartedAt: candidate.batchStartedAt,
    batchFinishedAt: candidate.batchFinishedAt,
    digestSentAt: candidate.digestSentAt,
    status: candidate.status,
  };

  const pollResult = await pollAndImport(snapshot);
  if (
    pollResult.outcome === "still_running" ||
    pollResult.outcome === "batch_failed" ||
    pollResult.outcome === "stalled" ||
    pollResult.outcome === "poll_error" ||
    pollResult.outcome === "import_failed"
  ) {
    return { runId: snapshot.id, outcome: pollResult.outcome };
  }

  const digestResult = await maybeSendDigest(
    snapshot,
    pollResult.transitionedToSucceeded,
  );
  if (digestResult) return digestResult;

  return { runId: snapshot.id, outcome: "nothing_to_do" };
}
