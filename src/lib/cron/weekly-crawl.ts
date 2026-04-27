import { eq, and, gte, sql } from "drizzle-orm";
import { db, postgresClient } from "@/lib/db";
import { crawlRuns, contracts } from "@/lib/db/schema";
import { runBulkCrawl } from "@/lib/sam-gov/bulk-crawl";
import { submitBatchClassify } from "@/lib/ai/batch-classify";
import {
  sendTelegram,
  requireTelegramConfig,
  TelegramConfigError,
} from "@/lib/notifications/telegram";

// Stable arbitrary int key for pg_try_advisory_lock. Scoped to the
// weekly-crawl job only.
export const WEEKLY_CRAWL_LOCK_KEY = 7_242_023;

export type WeeklyCrawlJobResult = {
  httpStatus: number;
  exitCode: 0 | 1;
  body: Record<string, unknown>;
};

type CronLog = {
  kind: "weekly-crawl";
  runId: string | null;
  step: string;
  status: "ok" | "error" | "skip";
  durationMs: number;
  counts?: Record<string, number>;
  error?: string;
};

type LockRow = {
  locked?: boolean;
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
    // Telegram itself failed; preserve the original crawl_runs error.
    console.error("[weekly-crawl] Failed to send Telegram alert:", err);
  }
}

function failure(httpStatus: number, body: Record<string, unknown>) {
  return { httpStatus, exitCode: 1 as const, body };
}

function success(body: Record<string, unknown>) {
  return { httpStatus: 200, exitCode: 0 as const, body };
}

export async function runWeeklyCrawlJob(): Promise<WeeklyCrawlJobResult> {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

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
      return failure(500, {
        error: "Telegram config missing",
        runId,
        message: msg,
      });
    }
    throw err;
  }

  return withWeeklyCrawlLock(() => runWeeklyCrawl(sevenDaysAgo, now));
}

async function withWeeklyCrawlLock(
  fn: () => Promise<WeeklyCrawlJobResult>,
): Promise<WeeklyCrawlJobResult> {
  const reserved = await postgresClient.reserve();
  let locked = false;

  try {
    const acquireRows = await reserved<LockRow[]>`
      SELECT pg_try_advisory_lock(${WEEKLY_CRAWL_LOCK_KEY}) AS locked
    `;
    locked = acquireRows[0]?.locked === true;

    if (!locked) {
      log({
        kind: "weekly-crawl",
        runId: null,
        step: "preflight",
        status: "skip",
        durationMs: 0,
        error: "another weekly-crawl is in progress",
      });
      return success({
        ok: true,
        skipped: "another weekly-crawl in progress",
      });
    }

    return await fn();
  } finally {
    if (locked) {
      try {
        await reserved`
          SELECT pg_advisory_unlock(${WEEKLY_CRAWL_LOCK_KEY})
        `;
      } catch (err) {
        console.error("[weekly-crawl] Failed to release advisory lock:", err);
      }
    }
    reserved.release();
  }
}

async function runWeeklyCrawl(
  sevenDaysAgo: Date,
  now: Date,
): Promise<WeeklyCrawlJobResult> {
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
    return failure(500, {
      error: "Failed to create crawl run",
      message: msg,
    });
  }

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
    return failure(500, {
      error: "Crawl failed",
      runId,
      message: msg,
    });
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

  const pendingRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "PENDING"),
        eq(contracts.userOverride, false),
        sql`NOT (COALESCE(${contracts.tags}, '[]'::jsonb) @> '["WATCH_IMPORT"]'::jsonb)`,
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

    return success({
      ok: true,
      runId,
      status: "succeeded",
      totalFound: crawlResult.totalFound,
      newInserted: crawlResult.newInserted,
      message:
        "No PENDING contracts to classify. Digest will fire on next check-batches run.",
    });
  }

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
    return failure(500, {
      error: "Batch submit failed",
      runId,
      message: msg,
    });
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

  return success({
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
