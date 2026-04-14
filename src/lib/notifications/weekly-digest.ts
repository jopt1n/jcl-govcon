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
import { eq, and, gte, isNull } from "drizzle-orm";
import { sendTelegram } from "./telegram";

const MAX_GOOD_SHOWN = 10;
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
  const goodContracts = await db
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "GOOD"),
        gte(contracts.createdAt, since),
      ),
    );

  const maybeContracts = await db
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "MAYBE"),
        gte(contracts.createdAt, since),
      ),
    );

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

  if (goodContracts.length === 0 && maybeContracts.length === 0) {
    lines.push("No new GOOD or MAYBE contracts this week.");
    lines.push(`(${run.contractsFound} contracts crawled from SAM.gov)`);
  } else {
    lines.push(
      `✅ ${goodContracts.length} new GOOD · ⚠️ ${maybeContracts.length} new MAYBE`,
    );
    lines.push("");

    if (goodContracts.length > 0) {
      lines.push(
        `GOOD (top ${Math.min(goodContracts.length, MAX_GOOD_SHOWN)}):`,
      );
      for (const c of goodContracts.slice(0, MAX_GOOD_SHOWN)) {
        lines.push(
          `• ${truncate(c.title, 80)} — ${c.agency ?? "?"} · ${formatCurrency(c.awardCeiling)} · due ${formatDate(c.responseDeadline)}`,
        );
      }
      if (goodContracts.length > MAX_GOOD_SHOWN) {
        lines.push(`  …and ${goodContracts.length - MAX_GOOD_SHOWN} more.`);
      }
      lines.push("");
    }

    if (maybeContracts.length > 0) {
      lines.push(
        `MAYBE (top ${Math.min(maybeContracts.length, MAX_MAYBE_SHOWN)}):`,
      );
      for (const c of maybeContracts.slice(0, MAX_MAYBE_SHOWN)) {
        lines.push(
          `• ${truncate(c.title, 80)} — ${c.agency ?? "?"} · due ${formatDate(c.responseDeadline)}`,
        );
      }
      if (maybeContracts.length > MAX_MAYBE_SHOWN) {
        lines.push(`  …and ${maybeContracts.length - MAX_MAYBE_SHOWN} more.`);
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
    good: goodContracts.length,
    maybe: maybeContracts.length,
    triaged: triagedCount,
    transitions,
    messageLength: message.length,
  };
}
