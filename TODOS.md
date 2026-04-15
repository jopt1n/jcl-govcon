# TODOs

Deferred work surfaced during the `/review` pass on `fix/batch-import-hang` (2026-04-14). Ordered by priority.

---

## P1

### CSV export endpoint has no auth

**File:** `src/app/api/contracts/export/route.ts`
**Why:** Dumps full pursued-pipeline (titles, deadlines, ceilings, SAM URLs) to anyone who can hit the URL. App is internal-only today, but once deployed behind any proxy or shared link, the export leaks.
**Blocker for trivial fix:** `/pipeline` triggers the CSV via `window.location.href`, so Bearer `INGEST_SECRET` would break the browser button and leak the secret client-side. Real fix needs cookie/session auth, which the app doesn't have.
**Approach:** Add a minimal signed-cookie or shared-secret-cookie middleware for the app, then gate this route on it. Or: add a one-shot signed URL pattern — `/pipeline` calls `POST /api/contracts/export/sign` (Bearer-authed server→server) to mint a short-TTL token, then redirects to `GET /api/contracts/export?token=...`.
**Priority:** P1 before any non-localhost deploy.

### Cron route test coverage is thin vs. the plan

**File:** `src/__tests__/api/cron-auth.test.ts` (only 4 auth tests exist)
**Why:** The whole point of the `processing_at` atomic claim is concurrency-safety, and it has zero tests. Stalled-guard, lease-expiry, digest-retry (see the #1 fix just landed), multi-week in-flight, full-loop with `SAM_DRY_RUN=true` + mocked xAI are all missing.
**Plan-specified tests not written:**

- weekly-crawl: full happy loop with `SAM_DRY_RUN=true`, crawl-failure, batch-submit-failure, Telegram-config-missing-in-prod throws
- check-batches: no-op when no active rows, polls running, imports on completed, skips already-digested, stalled guard fires, concurrent-call atomic-claim test (second call returns 0), claim-lease expiry (expired claim is reclaimable), multi-week in-flight
- Backfill regression: after running the backfill SQL, every contract has `reviewedAt` populated AND main Kanban query returns all of them
- Digest retry: after a digest failure, next check-batches fire retries the digest (regression test for the bug fixed in this review)
  **Priority:** P1. The concurrency gate is load-bearing and unverified.

---

## P2

### `weekly-crawl` PENDING-check is not scoped to the new window

**File:** `src/app/api/cron/weekly-crawl/route.ts:161-170`
**Why:** The "skip batch submission if no pending" fast-path checks for ANY `classification='PENDING'` in the whole contracts table. The ~332 stuck PENDING rows from the prior batch mean (a) the fast-path is effectively dead code until they're drained, and (b) every weekly run pulls those 332 into its batch, billing for rework.
**Fix:** Either drain the 332 stuck PENDING first (one-shot manual run), or scope the fast-path check and the `submitBatchClassify({ pendingOnly: true })` call to `createdAt >= windowStart` (requires extending `submitBatchClassify` to accept a `since` filter), or tag each contract with the submitting `crawlRunId` and filter on that.

### `weekly-digest.ts` pulls every GOOD/MAYBE with no LIMIT

**File:** `src/lib/notifications/weekly-digest.ts:98-116`
**Why:** `select()` with no column list and no LIMIT fetches all columns for all matching rows, even though only the top 10 GOOD / top 5 MAYBE are rendered. Today (~30/week) it's nothing. At 500/week it starts to bite.
**Fix:** Add `.limit(MAX_GOOD_SHOWN + 1)` (the `+1` lets you still honestly show "...and N more") and narrow the `select({...})` column list to the fields the digest actually renders (title, agency, awardCeiling, responseDeadline).

### No "Telegram config present" preflight in cron routes

**File:** `src/app/api/cron/weekly-crawl/route.ts`, `src/app/api/cron/check-batches/route.ts`
**Why:** Plan decision #5 was "fail loud in prod when Telegram env is missing." Today, that only fires when `sendTelegram()` is actually called — i.e. on the alert path or in the digest. A happy-path weekly-crawl succeeds even with no Telegram config, and you only discover the problem hours later when the digest tries to fire.
**Fix:** Add a 3-line env-presence check at the top of both cron routes (after `authorize()`, before any work) that throws `TelegramConfigError` in prod when `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing. Catch in the route's own error path, mark the row `status='failed', errorStep='telegram_config'`, return 500.

---

### Drain the ~332 stuck PENDING rows from the prior batch run

**Files:** `scripts/batch-classify.ts` (unchanged CLI wrapper)
**Why:** After Commit 4 of the Sedgewick cleanup lands, `submitBatchClassify({ since })` scopes the weekly-crawl path to the current 7-day window, so the ~332 pre-existing PENDING rows (createdAt well before this week) will be orphaned — they'll never be picked up by the weekly cron. The CLI script remains the manual backfill tool.
**Fix:** One-shot manual run: `npx tsx scripts/batch-classify.ts --pending-only` (no `--since` flag). Safe to run anytime after Commit 4 lands on `fix/batch-import-hang`. Will cost ~$1.30 at xAI batch pricing (332 × ~$0.004).
**Priority:** P2 follow-up. Not a blocker for merge.

---

## P3

### `importBatchResults` builds SQL with manual string escaping

**File:** `src/lib/ai/batch-classify.ts:120-123, 474-495`
**Why:** `escapeLiteral()` doubles single quotes. Safe under modern Postgres (`standard_conforming_strings=on`, default since 9.1), but a sharp edge future readers will trip over. Values being escaped are LLM output — NULL bytes would crash the chunk rather than persist bad data (fail-safe, but surprising).
**Fix options:** (a) Add a block comment documenting the `standard_conforming_strings` assumption and reject NULL bytes explicitly before serializing; (b) migrate to Drizzle's parameterized multi-row `onConflictDoUpdate` pattern — uglier for large tuples but fully safe.

### `check-batches` mutates its `row` parameter to fall through paths A→B

**File:** `src/app/api/cron/check-batches/route.ts:356-357`
**Why:** Works, but mutating a function parameter to re-enter a later branch is the kind of thing that breaks when a future reader splits this into two functions.
**Fix:** Split `processRow` into `pollAndImport()` + `maybeSendDigest()` called sequentially, each taking the current row as input. Or keep the single function and add a comment explicitly flagging the fall-through intent.
