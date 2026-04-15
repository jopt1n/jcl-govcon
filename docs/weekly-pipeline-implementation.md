# Weekly Pipeline Implementation Summary

**Branch:** `fix/batch-import-hang`
**Plan:** `/Users/joelaptin/.claude/plans/robust-leaping-sedgewick.md`
**Date:** 2026-04-13
**Status:** Code complete, tests passing. Awaiting DB migration + Telegram env vars on Railway.

---

## What shipped

Automated weekly SAM.gov pipeline plus the review/tracking UI the app was missing.

**Loop:** Sunday 03:00 UTC cron crawls the last 7 days from SAM.gov, submits an xAI batch for classification, then every 30 minutes a second cron polls the batch, imports results when ready, and fires a Telegram digest exactly once. New contracts land on `/inbox` for triage; once reviewed they flow to the main Kanban. Pursued contracts flow to `/pipeline` for stage tracking.

Notifications go to Telegram (@JCL_GovConBot → jlaptin's chat). No email for this PR.

---

## Critical design decisions

1. **Async batch handled via two split cron endpoints.** xAI Batch API takes 30 min to 24 hours. A single HTTP cron call cannot block on it. Split into:
   - `/api/cron/weekly-crawl` — Sunday 03:00 UTC. Creates crawl_runs row → crawls 7 days → submits batch → returns in <5 min.
   - `/api/cron/check-batches` — every 30 min. Polls in-flight batches, imports completed, fires digest once.

2. **Atomic claim prevents concurrent double-digest.** Before processing a row, `UPDATE crawl_runs SET processing_at=NOW() WHERE id=$1 AND (processing_at IS NULL OR processing_at < NOW() - INTERVAL '5 minutes') RETURNING id`. Only the winning claimant processes. 5-min lease auto-expires for crash recovery.

3. **`digestSentAt` gate ensures exactly-once digest.** `sendWeeklyDigest()` sets the timestamp on success. Next `check-batches` call skips any row with non-null `digestSentAt`.

4. **Idempotent import via `WHERE classification='PENDING'`.** `importBatchResults()` only updates rows that haven't been classified yet. Safe to re-run on the same batch ID.

5. **Telegram fails loud in production.** Missing `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` in prod throws `TelegramConfigError`, the cron handler catches it, sets `status='failed'` with `errorStep='telegram_config'`. You see the failure on `/admin/crawl-runs` within 30 min instead of discovering a silent outage next Sunday. In dev/test, missing env is a `console.warn` no-op so local runs don't need bot setup.

6. **Digest always fires, even on zero-GOOD weeks.** Intentional divergence from the existing `/api/digest` which silently skips. Proof the cron ran.

7. **Backfill migration required before deploy.** Flipping the main Kanban default to `reviewed_at IS NOT NULL` would hide all 1,014 existing contracts. Backfill SQL sets `reviewed_at = created_at` for all existing rows in one transaction with a verify-and-raise block.

---

## Files created (19)

### Library modules

| Path                                     | Purpose                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai/batch-classify.ts`           | Reusable xAI Batch library. Exports `submitBatchClassify`, `pollBatch`, `importBatchResults`. Extracted from the CLI script so both the cron route and the CLI share one code path.                  |
| `src/lib/notifications/telegram.ts`      | Telegram Bot API client. `sendTelegram(text, opts)`. Fail-loud-in-prod config check, 2x retry with exponential backoff on 5xx, treats `{ok: false}` as non-retryable.                                |
| `src/lib/notifications/weekly-digest.ts` | `sendWeeklyDigest(runId)`. Queries GOOD/MAYBE since window start + triaged count + status transitions. Builds Telegram message. Sets `digestSentAt`. Throws `DigestAlreadySentError` on double-fire. |

### API routes

| Path                                      | Purpose                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/cron/weekly-crawl/route.ts`  | POST, `INGEST_SECRET` auth. Creates `crawl_runs` row → `runBulkCrawl(7daysAgo, today)` → `submitBatchClassify()` → returns. Structured JSON logs per step. Telegram alert on failure. |
| `src/app/api/cron/check-batches/route.ts` | POST, `INGEST_SECRET` auth. Scans active rows, atomic-claims each, polls/imports/digests. Handles stalled-batch (>48h) detection. Fully idempotent.                                   |
| `src/app/api/contracts/export/route.ts`   | GET, public. `?status=PURSUING,BID_SUBMITTED,WON` (default). Returns RFC 4180 CSV with proper escaping. Exports `escapeCsvField` helper for tests.                                    |
| `src/app/api/crawl-runs/latest/route.ts`  | GET, public. `?kind=weekly`. Returns the most recent crawl run row for the Inbox header.                                                                                              |

### Pages

| Path                                | Purpose                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/inbox/page.tsx`            | Client component. Unreviewed contracts grouped by GOOD/MAYBE/DISCARD. Mark-reviewed button with optimistic update + PATCH. Latest-run header. Mobile-first layout. Empty state shows next run schedule.                                                                            |
| `src/app/pipeline/page.tsx`         | Client component with `@dnd-kit` drag-drop. Four columns: PURSUING → BID_SUBMITTED → WON → LOST. Drop fires PATCH with new status (which auto-bumps `statusChangedAt`). Export CSV button in header.                                                                               |
| `src/app/admin/crawl-runs/page.tsx` | Server component, read-only. Last 30 runs in a table with: timestamp, kind, window, found/classified counts, crawl duration, batch ID+status, digest sent, overall status with color-coded badge, error step. "Recent errors" section below the table surfaces full error strings. |

### Scripts / SQL / tests

| Path                                                | Purpose                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/backfill-reviewed-at.sql`                  | Idempotent backfill. `UPDATE contracts SET reviewed_at = created_at WHERE reviewed_at IS NULL`. Wrapped in transaction with verify-and-raise block. Safe to re-run. |
| `src/__tests__/lib/notifications/telegram.test.ts`  | 7 tests. Happy path, parseMode options, 5xx retry, `{ok:false}` non-retryable, prod env missing throws, dev env missing no-ops, persistent 5xx exhaustion.          |
| `src/__tests__/api/contracts-export-escape.test.ts` | 8 tests for `escapeCsvField`. Commas, quotes (including internal doubling), newlines, null/undefined, numbers, booleans, combined edge cases.                       |
| `src/__tests__/api/cron-auth.test.ts`               | 4 tests. 401 path for both cron routes with missing and wrong Bearer tokens.                                                                                        |

---

## Files modified (11)

| Path                                                | What changed                                                                                                                                                                                                                                                                                                                                                              | Why                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/db/schema.ts`                              | Added `reviewedAt` (nullable timestamp) and `statusChangedAt` (timestamp with default now) to `contracts`. Added `crawlRuns` table with 16 columns including `processingAt` for atomic claim lease. Added two indexes: `contracts_inbox_idx` on `(reviewed_at, created_at)` for fast unreviewed-filter queries; `contracts_status_changed_at_idx` for weekly retro stats. | Storage layer for the new triage flow, pipeline retro, and async batch lifecycle.                                                                       |
| `scripts/batch-classify.ts`                         | Refactored to a thin CLI wrapper. All logic moved to `src/lib/ai/batch-classify.ts`. Dispatches to the library for submit/poll/import. Preserves all original flags: `--dry-run`, `--limit`, `--poll-only`, `--import-batch-id`. `--batch-id`/`--skip` resume mode deprecated with a helpful error (use `--import-batch-id` instead).                                     | Share one code path between CLI and cron route. Avoid duplicated 700-line script logic.                                                                 |
| `src/app/api/contracts/route.ts`                    | Added `?unreviewed=true` filter (shows `reviewedAt IS NULL`). Added `?includeUnreviewed=true` escape hatch. New default behavior: `reviewedAt IS NOT NULL` unless one of those flags is set. Added `reviewedAt` and `createdAt` to the returned row shape.                                                                                                                | Main Kanban only shows triaged contracts. Inbox gets its own filter. Unreviewed nav badge needs the count.                                              |
| `src/app/api/contracts/[id]/route.ts`               | PATCH accepts `reviewedAt` (supports `true` shorthand, ISO string, or `null`). Auto-bumps `statusChangedAt` only when `status` actually changes (pre-selects the existing row and diffs first).                                                                                                                                                                           | Inbox's mark-reviewed button needs to PATCH `reviewedAt`. Pipeline retro stats need accurate `statusChangedAt` that doesn't fire on non-status PATCHes. |
| `src/components/contract-detail.tsx`                | Removed the `classification === "GOOD"` gate on the status dropdown. Renamed label to "Pipeline Status".                                                                                                                                                                                                                                                                  | Now available for any contract. Pipeline flow works even if the contract was classified MAYBE or DISCARD.                                               |
| `src/components/sidebar.tsx`                        | Added Inbox, Pipeline, Runs nav items. New `useUnreadCount` hook polls `/api/contracts?unreviewed=true&limit=1` every 30 seconds. Badge rendered as a numeric pill on hover (mobile + desktop expanded) and as a red dot on collapsed sidebar.                                                                                                                            | Navigation for the new pages + glanceable unread counter.                                                                                               |
| `railway.toml`                                      | Added two `[[cron]]` blocks: `0 3 * * 0` for `/api/cron/weekly-crawl`, `*/30 * * * *` for `/api/cron/check-batches`. Both curl with `$INGEST_SECRET` bearer token.                                                                                                                                                                                                        | Railway-native scheduling for the weekly pipeline.                                                                                                      |
| `.env`                                              | Added `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.                                                                                                                                                                                                                                                                                                                        | Bot provisioned via @BotFather during this session.                                                                                                     |
| `src/__tests__/api/contracts/route.test.ts`         | Added `isNull`, `isNotNull`, `asc`, `gt`, `ne` to the drizzle-orm vi.mock.                                                                                                                                                                                                                                                                                                | New default filter uses `isNotNull` which wasn't mocked; unmocked call returned undefined and broke downstream.                                         |
| `src/__tests__/api/contracts/id.test.ts`            | "accepts valid status values" test now sets `mockSelectResult` since PATCH pre-selects the row for the status diff.                                                                                                                                                                                                                                                       | Reflects the new behavior where we diff against the existing status before bumping `statusChangedAt`.                                                   |
| `src/__tests__/components/contract-detail.test.tsx` | Renamed "status dropdown visible only for GOOD classification" to "pipeline status dropdown is always visible regardless of classification". Assertion now queries "Pipeline Status" label.                                                                                                                                                                               | The old gate is gone; test had to track the new behavior.                                                                                               |

---

## Test + type coverage

- `npx tsc --noEmit` → **0 errors**
- `npm run test:run` → **34 files, 295/295 passing** (16 new tests added to the existing 279-test suite plus 8 updates to pre-existing tests)
- `npm run lint` → **0 new errors**. Baseline has 47 pre-existing errors in old test files and `DocumentViewer.tsx`; confirmed via `git stash && npm run lint` that my branch adds none.

---

## What's NOT done (awaiting approval)

1. **`npx drizzle-kit push`** against the Railway production database. Adds two nullable columns to `contracts`, the new `crawl_runs` table, and two new indexes. Zero-downtime, safe to roll forward.
2. **Run `scripts/backfill-reviewed-at.sql`** via `psql "$DATABASE_URL" -f scripts/backfill-reviewed-at.sql`. Must happen AFTER step 1 and BEFORE deploying the new UI, otherwise the main Kanban goes empty on deploy.
3. **Set Railway env vars** — `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the Railway project dashboard. Values match the local `.env`. Without this the first Sunday run will fail with `errorStep=telegram_config` (visible on `/admin/crawl-runs`).
4. **Local smoke test** with `SAM_DRY_RUN=true`. Walk through the flow on localhost:3001:
   - `curl -X POST http://localhost:3001/api/cron/weekly-crawl -H "Authorization: Bearer $INGEST_SECRET"` → verify `crawl_runs` row created
   - `curl -X POST http://localhost:3001/api/cron/check-batches ...` → verify digest sent
   - Visit `/inbox`, mark a contract reviewed, verify it disappears and appears on `/`
   - Visit `/pipeline`, drag a contract between columns
   - Visit `/admin/crawl-runs`, verify the run shows up
5. **Deploy to Railway.** After steps 1-4 pass, commit and push. The crons start firing automatically once deployed.

---

## Out of scope (explicitly deferred)

- GoHighLevel or external CRM integration — follow-up PR.
- Multi-user auth on `/admin/crawl-runs` — local admin only for v1.
- Settings-configurable cron schedule — hardcoded in `railway.toml`.
- Resend email digest — replaced entirely by Telegram for this PR. Existing `/api/digest` route for the daily email pattern is untouched.
- In-app notification center — Inbox page + Telegram are sufficient.
- Weekly retro with historical comparison ("this week vs last week") — only shows current week's stats.
- Status transition history table — single `statusChangedAt` column is enough for the retro query.
- Auto-retry of failed batches — stalled guard fires a Telegram alert and waits for manual intervention.

---

## Reviewer checklist

Priorities for the next pass:

- **Concurrency correctness** of `check-batches`: the atomic claim SQL and the 5-min lease interaction with the stalled-batch guard.
- **Idempotency** of `importBatchResults` under the `WHERE classification='PENDING'` predicate.
- **Error propagation** — every step of both cron routes should land either a success log or a `crawl_runs.status='failed'` row plus a Telegram alert. No silent swallows.
- **Backfill safety** — the SQL script runs inside a transaction with a verify-and-raise. Make sure the assertion fires if any row is missed.
- **CSV export escaping** — confirm the `escapeCsvField` unit tests cover the RFC 4180 edge cases you actually care about.
- **Mobile UI** for `/inbox` — the page needs to be usable on your phone Sunday morning. Eyeball it in responsive mode.
