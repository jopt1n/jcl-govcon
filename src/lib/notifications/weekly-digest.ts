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

const TELEGRAM_MAX_LENGTH = 4000;

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

function formatDate(date: Date | null): string {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
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

  const [goodCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "GOOD"),
        gte(contracts.createdAt, since),
      ),
    );
  const goodTotal = Number(goodCount?.count ?? 0);

  const [maybeCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "MAYBE"),
        gte(contracts.createdAt, since),
      ),
    );
  const maybeTotal = Number(maybeCount?.count ?? 0);

  const [discardCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "DISCARD"),
        gte(contracts.createdAt, since),
      ),
    );
  const discardTotal = Number(discardCount?.count ?? 0);

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

  lines.push(
    `✅ ${goodTotal} GOOD · ⚠️ ${maybeTotal} MAYBE · ❌ ${discardTotal} DISCARD`,
  );
  lines.push(
    `📦 ${run.contractsFound ?? goodTotal + maybeTotal + discardTotal} crawled from SAM.gov`,
  );

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
