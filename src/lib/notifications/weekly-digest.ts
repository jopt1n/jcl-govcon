/**
 * Weekly digest builder. Sends a Telegram message summarizing:
 *   - New GOOD contracts classified this week
 *   - Top 5 new MAYBE contracts
 *   - Weekly retro stats: how many contracts were triaged and how many
 *     moved through pipeline stages (IDENTIFIED → PURSUING → BID_SUBMITTED
 *     → WON/LOST) based on status_changed_at
 *
 * Always fires, even on zero-GOOD weeks — you need proof the cron ran. This
 * is an intentional divergence from the existing /api/digest which silently
 * skips on zero-GOOD days.
 *
 * Gating: the caller is expected to check `crawl_runs.digest_sent_at` before
 * calling and to set it after this function returns successfully. The
 * function itself re-checks the gate to be belt-and-suspenders safe.
 *
 * Failure mode: if sendTelegram throws, this function re-throws. The caller
 * (check-batches route) catches and marks the crawl_runs row status=failed,
 * errorStep=digest, leaving digestSentAt NULL so the next run retries.
 */

import { db } from "@/lib/db";
import { contracts, crawlRuns } from "@/lib/db/schema";
import { eq, and, gte, isNull, sql } from "drizzle-orm";
import { sendTelegram } from "./telegram";

const MAX_GOOD_SHOWN = 5;
const MAX_MAYBE_SHOWN = 5;
const TELEGRAM_MAX_LENGTH = 4000; // Telegram's limit is 4096, leave headroom

export class DigestAlreadySentError extends Error {
  constructor(runId: string) {
    super(`Digest already sent for crawl run ${runId}`);
    this.name = "DigestAlreadySentError";
  }
}

export type DigestResult = {
  /** Number of new GOOD contracts in the window. */
  good: number;
  /** Number of new MAYBE contracts in the window. */
  maybe: number;
  /** Number of contracts the user triaged this week. */
  triaged: number;
  /** Status transitions this week, keyed by target status. */
  transitions: Record<string, number>;
  /** Final message length in characters (for tests / debugging). */
  messageLength: number;
};

function formatCurrency(value: string | null): string {
  if (!value) return "N/A";
  const num = parseFloat(value);
  if (isNaN(num)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

function formatDate(date: Date | null): string {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Build the digest message for a given crawl run and send via Telegram.
 * Returns the stats used to build the message.
 */
export async function sendWeeklyDigest(runId: string): Promise<DigestResult> {
  const runRows = await db
    .select()
    .from(crawlRuns)
    .where(eq(crawlRuns.id, runId))
    .limit(1);

  if (runRows.length === 0) {
    throw new Error(`Crawl run ${runId} not found`);
  }

  const run = runRows[0];

  if (run.digestSentAt !== null) {
    throw new DigestAlreadySentError(runId);
  }

  const since = run.windowStart;

  // ── New GOOD and MAYBE this window ─────────────────────────────────
  // Single-query: column allowlist (narrows payload vs. SELECT *) + LIMIT
  // (caps rows at render budget) + count(*) OVER () window function
  // (returns the full total on every row, so we get the subset AND the
  // total in one round trip). Per CLAUDE.md Railway latency rule:
  // minimize round trips above all else.
  const goodRows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      agency: contracts.agency,
      awardCeiling: contracts.awardCeiling,
      responseDeadline: contracts.responseDeadline,
      totalCount: sql<number>`count(*) OVER ()`,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "GOOD"),
        gte(contracts.createdAt, since),
      ),
    )
    .limit(MAX_GOOD_SHOWN);
  const goodTotal = Number(goodRows[0]?.totalCount ?? 0);

  const maybeRows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      agency: contracts.agency,
      awardCeiling: contracts.awardCeiling,
      responseDeadline: contracts.responseDeadline,
      totalCount: sql<number>`count(*) OVER ()`,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "MAYBE"),
        gte(contracts.createdAt, since),
      ),
    )
    .limit(MAX_MAYBE_SHOWN);
  const maybeTotal = Number(maybeRows[0]?.totalCount ?? 0);

  // ── Retro: contracts triaged this week ─────────────────────────────
  // reviewedAt was null before, gte(reviewedAt, since) means "set during
  // this window"
  const triagedRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(gte(contracts.reviewedAt, since));
  const triagedCount = triagedRows.length;

  // ── Retro: status transitions this week ────────────────────────────
  // Count contracts by current status where status_changed_at is in the
  // window. This captures "what you moved this week". A contract that went
  // PURSUING → BID_SUBMITTED shows as status=BID_SUBMITTED.
  const transitionRows = await db
    .select({ status: contracts.status })
    .from(contracts)
    .where(gte(contracts.statusChangedAt, since));

  const transitions: Record<string, number> = {};
  for (const row of transitionRows) {
    if (row.status && row.status !== "IDENTIFIED") {
      transitions[row.status] = (transitions[row.status] ?? 0) + 1;
    }
  }

  // ── Build message ──────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`🏛 JCL GovCon weekly digest — ${formatDate(new Date())}`);
  lines.push(
    `Window: ${formatDate(run.windowStart)} → ${formatDate(run.windowEnd)}`,
  );
  lines.push("");

  if (goodTotal === 0 && maybeTotal === 0) {
    lines.push("No new GOOD or MAYBE contracts this week.");
    lines.push(`(${run.contractsFound} contracts crawled from SAM.gov)`);
  } else {
    lines.push(`✅ ${goodTotal} new GOOD · ⚠️ ${maybeTotal} new MAYBE`);
    lines.push("");

    if (goodRows.length > 0) {
      lines.push(`GOOD (top ${goodRows.length}):`);
      for (const c of goodRows) {
        lines.push(
          `• ${truncate(c.title, 80)} — ${c.agency ?? "?"} · ${formatCurrency(c.awardCeiling)} · due ${formatDate(c.responseDeadline)}`,
        );
      }
      const goodOverflow = goodTotal - goodRows.length;
      if (goodOverflow > 0) {
        lines.push(`  …and ${goodOverflow} more.`);
      }
      lines.push("");
    }

    if (maybeRows.length > 0) {
      lines.push(`MAYBE (top ${maybeRows.length}):`);
      for (const c of maybeRows) {
        lines.push(
          `• ${truncate(c.title, 80)} — ${c.agency ?? "?"} · due ${formatDate(c.responseDeadline)}`,
        );
      }
      const maybeOverflow = maybeTotal - maybeRows.length;
      if (maybeOverflow > 0) {
        lines.push(`  …and ${maybeOverflow} more.`);
      }
      lines.push("");
    }
  }

  // Retro section
  lines.push("📊 This week:");
  if (triagedCount === 0 && Object.keys(transitions).length === 0) {
    lines.push("  No triage or pipeline activity.");
  } else {
    if (triagedCount > 0) {
      lines.push(`  • ${triagedCount} triaged`);
    }
    for (const [status, count] of Object.entries(transitions)) {
      const label = status.toLowerCase().replace(/_/g, " ");
      lines.push(`  • ${count} → ${label}`);
    }
  }
  lines.push("");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (baseUrl) {
    lines.push(`📥 Inbox: ${baseUrl}/inbox`);
    lines.push(`🔀 Pipeline: ${baseUrl}/pipeline`);
  } else {
    lines.push("📥 /inbox · 🔀 /pipeline");
  }

  let message = lines.join("\n");
  if (message.length > TELEGRAM_MAX_LENGTH) {
    message = message.slice(0, TELEGRAM_MAX_LENGTH - 20) + "\n…(truncated)";
  }

  await sendTelegram(message, { disableWebPagePreview: true });

  // Mark digest as sent
  await db
    .update(crawlRuns)
    .set({ digestSentAt: new Date() })
    .where(and(eq(crawlRuns.id, runId), isNull(crawlRuns.digestSentAt)));

  return {
    good: goodTotal,
    maybe: maybeTotal,
    triaged: triagedCount,
    transitions,
    messageLength: message.length,
  };
}
