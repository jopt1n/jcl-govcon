/**
 * CLI wrapper around src/lib/ai/batch-classify.ts.
 *
 * The heavy lifting (submit, poll, import) lives in the library so the
 * weekly cron route can share the same code path. This script adds CLI
 * arg parsing, manual .env loading, and a blocking poll loop.
 *
 * Usage:
 *   npx tsx scripts/batch-classify.ts
 *     Submit a new batch, poll until complete, import results.
 *
 *   npx tsx scripts/batch-classify.ts --limit 5
 *     Same but only pick the 5 oldest PENDING contracts.
 *
 *   npx tsx scripts/batch-classify.ts --dry-run
 *     Query + pre-filter only. Print the first 3 prompts. No API calls,
 *     no DB changes.
 *
 *   npx tsx scripts/batch-classify.ts --poll-only <batchId>
 *     Poll an existing batch until it completes, then import.
 *
 *   npx tsx scripts/batch-classify.ts --import-batch-id <batchId>
 *     Skip the poll, just import results from a batch that is known to
 *     be complete. Idempotent — safe to re-run.
 *
 *   npx tsx scripts/batch-classify.ts --batch-id <id> --skip N
 *     DEPRECATED. Resuming a partially-uploaded batch is no longer
 *     supported; re-submit instead (already-classified contracts are
 *     skipped by the default pendingOnly filter, so the cost is tiny).
 *     Use --import-batch-id to recover results from a completed batch.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// Load env before any imports that need it
const envPath = resolve(__dirname, "../.env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const POLL_INTERVAL_MS = 30_000;

// ── CLI args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let batchId: string | null = null;
  let skip = 0;
  let pollOnly: string | null = null;
  let importBatchId: string | null = null;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch-id" && args[i + 1]) {
      batchId = args[++i];
    } else if (args[i] === "--skip" && args[i + 1]) {
      skip = parseInt(args[++i], 10);
    } else if (args[i] === "--poll-only" && args[i + 1]) {
      pollOnly = args[++i];
    } else if (args[i] === "--import-batch-id" && args[i + 1]) {
      importBatchId = args[++i];
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { batchId, skip, pollOnly, importBatchId, limit, dryRun };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const {
    batchId: resumeBatchId,
    skip,
    pollOnly,
    importBatchId,
    limit,
    dryRun,
  } = parseArgs();

  // Dynamic import so env loading above takes effect before the library
  // touches the DB pool or xAI client
  const { submitBatchClassify, pollBatch, importBatchResults } =
    await import("../src/lib/ai/batch-classify");

  // ── Import-only mode (retry import from completed batch) ────────────
  if (importBatchId) {
    console.log(
      `[batch] Import-only mode for completed batch: ${importBatchId}`,
    );
    const result = await importBatchResults(importBatchId);
    console.log("\n[batch] ═══ Import Complete ═══");
    console.log(`  Classified: ${result.classified}`);
    console.log(
      `  GOOD: ${result.good}   MAYBE: ${result.maybe}   DISCARD: ${result.discard}`,
    );
    console.log(`  Errors: ${result.errors}   Skipped: ${result.skippedRows}`);
    console.log(`  Cost:   $${result.costUsd.toFixed(4)}`);
    process.exit(0);
  }

  // ── Poll-only mode ────────────────────────────────────────────────────
  if (pollOnly) {
    console.log(`[batch] Poll-only mode for batch: ${pollOnly}`);
    await pollLoopAndImport(pollOnly, pollBatch, importBatchResults);
    process.exit(0);
  }

  // ── Resume-via-batch-id is deprecated ─────────────────────────────────
  if (resumeBatchId || skip > 0) {
    console.error(
      "[batch] --batch-id / --skip resume is deprecated. Re-submit instead.",
    );
    console.error(
      "[batch] Already-classified contracts are skipped by the default pendingOnly",
    );
    console.error(
      "[batch] filter, so re-running costs only what's strictly needed.",
    );
    console.error(
      "[batch] To recover results from a completed batch: --import-batch-id <id>",
    );
    process.exit(1);
  }

  // ── Dry-run mode ──────────────────────────────────────────────────────
  if (dryRun) {
    // Dry-run bypasses the library and uses the same underlying helpers
    // directly so we can print prompts without creating a batch or writing
    // to the DB.
    const { db } = await import("../src/lib/db");
    const { contracts } = await import("../src/lib/db/schema");
    const { eq, and } = await import("drizzle-orm");
    const { buildUnifiedClassificationPrompt } =
      await import("../src/lib/ai/prompts");
    const { downloadDocuments } = await import("../src/lib/sam-gov/documents");
    const { extractAllDocumentTexts } =
      await import("../src/lib/document-text");
    const { isRestrictedSetAside } =
      await import("../src/lib/sam-gov/set-aside-filter");

    const queryBuilder = db
      .select({
        id: contracts.id,
        noticeId: contracts.noticeId,
        title: contracts.title,
        naicsCode: contracts.naicsCode,
        pscCode: contracts.pscCode,
        agency: contracts.agency,
        noticeType: contracts.noticeType,
        setAsideType: contracts.setAsideType,
        setAsideCode: contracts.setAsideCode,
        awardCeiling: contracts.awardCeiling,
        responseDeadline: contracts.responseDeadline,
        popState: contracts.popState,
        descriptionText: contracts.descriptionText,
        resourceLinks: contracts.resourceLinks,
      })
      .from(contracts)
      .where(
        and(
          eq(contracts.userOverride, false),
          eq(contracts.classification, "PENDING"),
        ),
      )
      .orderBy(contracts.postedDate);

    const allContracts = limit
      ? await queryBuilder.limit(limit)
      : await queryBuilder;

    const today = new Date();
    const pending = allContracts.filter((c) => {
      if (c.responseDeadline && new Date(c.responseDeadline) < today)
        return false;
      if (isRestrictedSetAside(c.setAsideCode)) return false;
      return true;
    });

    console.log("\n[batch] ═══ DRY RUN — Showing generated prompts ═══\n");
    for (let i = 0; i < Math.min(pending.length, 3); i++) {
      const contract = pending[i];
      let docTexts: string[] = [];
      try {
        const docs = await downloadDocuments(contract.resourceLinks);
        docTexts = await extractAllDocumentTexts(docs);
      } catch (err) {
        console.warn(
          `[batch] Doc extraction failed for ${contract.noticeId}: ${err instanceof Error ? err.message : err}`,
        );
      }
      const prompt = buildUnifiedClassificationPrompt({
        title: contract.title,
        agency: contract.agency,
        naicsCode: contract.naicsCode,
        pscCode: contract.pscCode,
        noticeType: contract.noticeType,
        setAsideType: contract.setAsideType,
        setAsideCode: contract.setAsideCode,
        awardCeiling: contract.awardCeiling,
        responseDeadline: contract.responseDeadline
          ? new Date(contract.responseDeadline).toISOString()
          : null,
        popState: contract.popState,
        descriptionText: contract.descriptionText,
        documentTexts: docTexts,
      });
      console.log(`──── Contract ${i + 1}: ${contract.noticeId} ────`);
      console.log(`Title: ${contract.title}`);
      console.log(
        `Has description: ${!!contract.descriptionText} (${contract.descriptionText?.length ?? 0} chars)`,
      );
      console.log(`Documents extracted: ${docTexts.length}`);
      console.log(`Prompt length: ${prompt.length} chars`);
      console.log();
    }
    console.log(
      `[batch] Dry run complete. ${pending.length} contracts would be sent to xAI. No API calls made, no DB changes.`,
    );
    process.exit(0);
  }

  // ── Default: submit new batch, poll, import ──────────────────────────
  const submitResult = await submitBatchClassify({
    pendingOnly: true,
    limit: limit ?? undefined,
  });
  console.log(
    `[batch] Submitted ${submitResult.submitted} contracts to batch ${submitResult.batchId}`,
  );
  console.log(`[batch] Pre-filtered: ${submitResult.preFilteredDiscard}`);

  // Persist batch ID for manual recovery
  const batchIdFile = resolve(__dirname, "last-batch-id.txt");
  writeFileSync(batchIdFile, submitResult.batchId, "utf-8");
  console.log(`[batch] Batch ID saved to ${batchIdFile}`);

  await pollLoopAndImport(submitResult.batchId, pollBatch, importBatchResults);
  process.exit(0);
}

async function pollLoopAndImport(
  batchId: string,
  pollBatch: (id: string) => Promise<{
    status: "running" | "completed" | "failed";
    numSuccess: number;
    numError: number;
    numPending: number;
    total: number;
  }>,
  importBatchResults: (id: string) => Promise<{
    classified: number;
    good: number;
    maybe: number;
    discard: number;
    errors: number;
    skippedRows: number;
    costUsd: number;
  }>,
) {
  console.log("[batch] Polling for completion...");
  while (true) {
    await sleep(POLL_INTERVAL_MS);
    const state = await pollBatch(batchId);
    console.log(
      `[batch] Progress: ${state.numSuccess} success, ${state.numError} error, ${state.numPending} pending (${state.total} total)`,
    );
    if (state.status === "completed" || state.status === "failed") {
      if (state.status === "failed") {
        console.error(`[batch] Batch ${batchId} failed. Aborting import.`);
        process.exit(1);
      }
      break;
    }
  }

  const result = await importBatchResults(batchId);
  console.log("\n[batch] ═══ Import Complete ═══");
  console.log(`  Classified: ${result.classified}`);
  console.log(
    `  GOOD: ${result.good}   MAYBE: ${result.maybe}   DISCARD: ${result.discard}`,
  );
  console.log(`  Errors: ${result.errors}   Skipped: ${result.skippedRows}`);
  console.log(`  Cost:   $${result.costUsd.toFixed(4)}`);
}

main().catch((err) => {
  console.error("[batch] Fatal error:", err);
  process.exit(1);
});
