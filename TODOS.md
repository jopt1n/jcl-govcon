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

### Advisory lock in weekly-crawl doesn't pin a postgres-js connection

**File:** `src/app/api/cron/weekly-crawl/route.ts:125-162`
**Why:** `db.execute(sql\`SELECT pg_try_advisory_lock(...)\`)`and`db.execute(sql\`SELECT pg_advisory_unlock(...)\`)`run on the unpinned postgres-js pool — acquire and release can land on different pool connections. Release may return`false`on a connection that doesn't hold the lock, leaving the real lock held on the acquiring connection until that connection's`idle_timeout: 20s`inactivity expires it. The code comment at line 128 is also wrong — Postgres releases session locks on session/connection END, not on pool return.
**Impact:** Under cron-only load (one fire per week), the lock releases naturally within 20s of pool idle, so the bug is probably benign for this workload. Under manual concurrent curls or future load, it surfaces as spurious "another weekly-crawl in progress" skips.
**Fix:** Wrap the try/finally body in`sql.reserve()`(postgres-js 3.4+ API) or`sql.begin()`; either pins one connection for the lifetime of the lock. Add a real pool test that grabs two connections and verifies acquire/release hit the same connection.
**Priority:** P2. Not a firing blocker; wait until real cron run data shows whether it bites before spending on the fix. Surfaced during the Sedgewick discovery audit (2026-04-21).

### E2E test infrastructure (Playwright)

Playwright is installed as a dep but not wired up. No config, no `e2e/` dir, no CI integration. Three CHOSEN-tier flows currently rely on manual verification (§8 of `docs/plans/chosen-tier.md`):

- `/inbox` → ★ Promote → navigate to `/chosen` → card appears with gold border
- Promote a DISCARD-classified contract → `/chosen` shows DISCARD badge + gold border (cross-classification)
- Detail page → ★ Demote → main Kanban GOOD column → green border restored

**Setup scope for a separate PR:**

- `playwright.config.ts` with a dev-server lifecycle
- `e2e/` directory + first three tests above
- Test database strategy (separate schema vs. transactional rollback)
- npm script: `test:e2e`
- CI integration decision (every PR vs. nightly vs. pre-merge gate)

Value extends beyond JCL GovCon — sibling projects (CantMissCalls, EtsySeller) would benefit from the same infrastructure.

**Priority:** P2 — platform concern that deserves its own plan + eng review. Captured during the eng review of CHOSEN tier (2026-04-18).

### GOOD count discrepancy — Pipeline Status tile vs Kanban column

Pipeline Status tile shows "369 GOOD" (all-time classified); Kanban GOOD column shows "111 GOOD" (filtered subset, likely expired-excluded). Both numbers are valid counts of different things, but neither is labeled as such — the reader has no way to tell the relationship, so both feel unreliable at a glance and the real active-pipeline size is ambiguous.

**Fix direction:** first step is to investigate what filter the Kanban GOOD column applies vs the Pipeline Status tile. Grep the board component (`src/components/kanban/board.tsx`) and the Pipeline Status component for any deadline / expiration / reviewedAt filtering; that will either confirm the "expired-excluded" theory or surface a different filter. Once the divergence is understood, either (a) label each tile explicitly (Pipeline Status = "all-time classified", Kanban = "active pipeline") so the relationship is obvious, or (b) consolidate to a single active-contracts metric surfaced in the Pipeline Status tile. (b) is cleaner if the all-time count isn't serving a specific analytics purpose.

**Priority:** P2. Pre-existing issue surfaced during CHOSEN visual verification (2026-04-19). Not a blocker.

### Deadline date not shown on contract detail page

Response deadline is only visible via the Kanban card badges (URGENT / SOON color-coding). Open an individual contract and the deadline is buried in the action-plan section or entirely absent from the header — the user has to infer it from the card's badge before clicking in, rather than seeing it on the detail page itself.

**Fix:** add the deadline as a first-class element in the contract detail header or near the classification row, visible on every contract regardless of classification. Mirror the URGENT / SOON color logic already in `getDeadlineInfo()` so the detail view uses the same urgency semantics as the card badges. Format: `Due {date} ({N days} remaining)` with the same color token the card uses.

**Priority:** P2. Pre-existing UX gap surfaced during CHOSEN visual verification (2026-04-19).

### Expired contracts pollute the active Kanban and /inbox views

The AI classifier labels contracts GOOD based on fit, not deadline. Once a contract's `responseDeadline` passes, it sits in the GOOD column indefinitely and has to be visually skipped over every triage session. Daily time tax.

**Fix:** expired contracts retain their original classification (GOOD / MAYBE / DISCARD — important for recall analytics; never mutate the AI's call) but move to a separate archive view by default. Main Kanban GOOD/MAYBE columns filter to active (non-expired) contracts only. Expired view accessible via a new sidebar nav item or a "View expired" link on the Kanban. The pattern mirrors CHOSEN tier's `promoted` flag — orthogonal boolean, preserve source data, change only the default view — so this can ride the same architectural pattern: either a computed `is_expired` column or a view/query-side filter on `responseDeadline < now()`, with a new `/archive` page (or `?expired=true` filter on the existing routes) to surface them deliberately. Preserve classification intact; only the default surface changes.

**Priority:** P2. Daily friction but not a blocker. Pre-existing issue surfaced during CHOSEN visual verification (2026-04-19).

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

### Hydration warning on Kanban search input

**File:** `src/components/kanban/board.tsx:189` — the search `<input>` inside `<form>` at line 187.
**Symptom:** Dev-mode console warning `Warning: Extra attributes from the server: style` at every page that renders `DashboardPage`.
**Not introduced by CHOSEN tier** — pre-existing, surfaced during /qa of feat/chosen-tier (2026-04-19). The only board.tsx change in that branch was the filter button's alpha-token refresh on line 199; the search input was untouched. History confirms the input predates 33a3848.
**Severity:** Low. Dev warning only, functionally identical render.
**Likely cause:** client-side `style` attribute injection on the input — possibly autofill, a CSS-in-JS fragment, or a Next.js 14 SSR edge case with controlled inputs. Needs React DevTools Profiler investigation.
**Fix path:** first, add `suppressHydrationWarning` on the specific input only if root cause confirms third-party injection (browser autofill). If it's a legit state mismatch, fix the render-time value divergence between server and client.
**Priority:** P3. Defer to an investigation-first PR.

### Measure actual cron Dockerfile build time, update deployment doc

**File:** `docs/deployment-railway.md:59` (Provisioning §3 step 6)
**Why:** The line currently reads "First build takes ~seconds (alpine + curl, not a Node build)" — softened from an earlier "~5 seconds" claim because Docker wasn't available locally to verify (see `/review` finding #2 on the cron-architecture PR, 2026-04-21). After both cron services are provisioned in Railway and the first builds complete, Railway's build logs will show the actual duration.
**Fix:** Read the Build duration field from either new cron service's first deployment in the Railway dashboard. Update the doc line to the measured number (e.g., "First build takes ~7 seconds" or whatever it is). Low-stakes but keeps the doc concrete instead of vague.
**Priority:** P3. Post-merge follow-up.

### Inbox badge contrast (WCAG AA)

**File:** `src/components/sidebar.tsx` — Inbox nav item
**Why:** Badge renders white text on #3b82f6 blue, ~3.7:1 contrast. WCAG AA requires 4.5:1 for small text (10px badge). Below threshold.
**Not introduced by CHOSEN tier** — pre-existing accessibility issue surfaced during Commit 5 /review (2026-04-19). The Chosen badge fix in that commit added a `badgeTextColor` prop and a `--chosen-fg` token precomputed for readability on gold.
**Fix:** Same pattern. Add a `--inbox-fg` token (dark text color passing AA on blue) to `globals.css`, set `badgeTextColor: "var(--inbox-fg)"` on the Inbox nav item, verify with a contrast checker. One-line change on top of the existing scaffolding.
**Priority:** P3. Defer to an accessibility-focused PR that can audit all nav badges, toast colors, urgent flags, and classification badges for AA compliance.

---

## Closed

### Drain the ~332 stuck PENDING rows from the prior batch run

**Resolution (2026-04-21):** Resolved organically, mechanism unconfirmed — likely 2026-04-16 manual curl. `SELECT count(*) FROM contracts WHERE classification = 'PENDING'` returned 0 during the cron-architecture discovery audit. Preserved here as history.

**Original entry:**

**Files:** `scripts/batch-classify.ts` (unchanged CLI wrapper)
**Why:** After Commit 4 of the Sedgewick cleanup lands, `submitBatchClassify({ since })` scopes the weekly-crawl path to the current 7-day window, so the ~332 pre-existing PENDING rows (createdAt well before this week) will be orphaned — they'll never be picked up by the weekly cron. The CLI script remains the manual backfill tool.
**Fix:** One-shot manual run: `npx tsx scripts/batch-classify.ts --pending-only` (no `--since` flag). Safe to run anytime after Commit 4 lands on `fix/batch-import-hang`. Will cost ~$1.30 at xAI batch pricing (332 × ~$0.004).
**Priority:** P2 follow-up. Not a blocker for merge.
