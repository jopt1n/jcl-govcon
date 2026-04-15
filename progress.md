# JCL GovCon — Progress

## Current State

**Branch:** `main` (merged from `fix/batch-import-hang`)
**Verification:** 0 type errors, 332/332 tests passing, 0 new lint errors
**Plan:** `/Users/joelaptin/.claude/plans/nifty-prancing-stonebraker.md` (CEO + ENG + outside-voice CLEARED + `/review` pass)
**DB:** 30,037 classified contracts (29,712 DISCARD, 206 MAYBE, 118 GOOD, 0 PENDING). Last ingest: 2026-04-07. 5 GB Railway Postgres volume.

## Completed This Session (2026-04-14 → 2026-04-15)

### Sedgewick cleanup branch — 6 planned commits + 1 review fix, merged + pushed

1. **Telegram preflight + advisory lock** (`db9a126`) — `requireTelegramConfig()` helper; cron routes fail loud at the top when env missing; weekly-crawl wrapped in session-scoped `pg_try_advisory_lock` + explicit finally release. Session-scoped (not xact-scoped) to avoid pinning a Railway pool connection during multi-minute crawl work.
2. **Single-query window function digest** (`750ce5d`) — replaced two unbounded `SELECT *` queries with one query per classification using `count(*) OVER ()` + column allowlist + `LIMIT`. Honors CLAUDE.md Railway latency rule (minimize round trips). Payload down ~95%.
3. **processRow split with immutable RowSnapshot** (`c593270`) — split into `pollAndImport` + `maybeSendDigest`, both receiving an explicit `RowSnapshot` by value. Pinned a subtle behavior: `batch_failed` now explicitly short-circuits before digest (was previously skipped only as a coincidence of row state). Added test asserting `sendWeeklyDigest` is NOT called on `batch_failed`.
4. **`since` filter + createdAt index** (`ba5f913`) — added `since?: Date` to `SubmitOptions`; weekly-crawl passes one captured `sevenDaysAgo` to both pre-check and submit; new standalone `contracts_created_at_idx`; two-line block comment above `escapeLiteral` documenting the `standard_conforming_strings` assumption.
5. **Same-origin guard on CSV export** (`795bcd6` + review fix `5e454a6`) — `requireSameOrigin()` helper reading `NODE_ENV` per-call; gate on `/api/contracts/export` GET. `/review` caught a suffix-attack bypass (`referer.startsWith("https://x.com")` also matched `https://x.com.evil.com`) — replaced with `new URL(referer).origin === entry`. 3 regression tests added.
6. **End-to-end smoke script** (`6bfc838`) — `scripts/smoke-weekly-pipeline.sh` starts dev server with `SAM_DRY_RUN=true`, curls all three endpoints, asserts terminal states. Not run in CI; manual pre-merge gate.

### Post-merge operations (post-review)

7. **Ran `drizzle-kit push`** — applied `contracts_created_at_idx` to Railway Postgres. This was the trigger that exposed the disk crisis (see Incident below).
8. **Railway Postgres disk incident** — volume was originally 500 MB; 220 MB data + 192 MB WAL = ~80% full; the index build during drizzle push pushed WAL over the edge and Postgres entered a crash loop with `No space left on device`. Resolved by bumping the volume to **5 GB** via the Railway assistant in the dashboard. Current usage: ~404 MB (8%).
9. **Ran backfill SQL** via `scripts/run-backfill.ts` (postgres-js statement-by-statement wrapper — Railway's proxy closed on multi-statement `unsafe()`). Result: 30,037 rows × 2 columns (`reviewed_at`, `status_changed_at`) updated in 7.6s.
10. **Ran smoke script** — all three endpoints passed (`weekly-crawl`, `check-batches`, `export`). Dev server up in 2s, `smoke: PASS`.
11. **Merged `fix/batch-import-hang` → `main`** (`3d37a9a`, `--no-ff`) and **pushed to origin** (`e7662d3..e972bf6`).
12. **Memory file refreshed** — updated `~/.claude/projects/-Users-joelaptin-jcl-govcon/memory/MEMORY.md` with current counts (30,037 classified, 0 PENDING, 38 test files / 332 tests), noted the Sedgewick `since` filter landed so the "332 stuck PENDING" entry is stale history.

## Decisions Made

- **Session-scoped advisory lock (not xact-scoped)** — xact-scoped would have pinned a Railway pool connection for the multi-minute crawl body. Session-scoped with explicit finally release avoids pinning a transaction; Postgres auto-releases on connection close if the process crashes. Rejected: `pg_try_advisory_xact_lock` (connection-pinning risk), DB-persisted lock row (reserved as fallback if drift detected in prod — not built speculatively).
- **Immutable `RowSnapshot` by value** — earlier draft passed the mutable row object; a future contributor could copy the existing mutation pattern and reintroduce the bug. Explicit type passed by value kills that path. Rejected: keep single function with a comment flag (fragile).
- **`since` filter on `submitBatchClassify`, not a CLI mode** — weekly cron path gets scope, manual CLI path stays unscoped so you can still drain arbitrary PENDING rows. Rejected: default `since` to "last 7 days" (breaks the CLI backfill workflow).
- **URL-parsed Referer check** — plain `startsWith` admits `https://jclgovcon.com.evil.com`. `new URL(referer).origin` is the correct primitive. Rejected: regex anchor (URL parsing is clearer and handles edge cases like port, query, fragment).
- **Dropped #6 (`escapeLiteral` NULL-byte strip)** — outside-voice pass argued that loud failure on unusual input is strictly better than silent data corruption for a classifier pipeline. Kept the code; added a block comment documenting actual behavior.
- **Dropped backfill grep test** — grep-the-file tests pin the wrong invariant. Replaced with a load-bearing inline comment on `scripts/backfill-reviewed-at.sql` explaining the `>` vs `<` regression story.
- **Skip session auth (Auth.js/Clerk)** — user clarified app is localhost-only. Same-origin guard stays as a cheap belt, but real session auth is out of scope indefinitely. Rejected earlier TODO recommending signed-cookie middleware.
- **Don't drain the "332 stuck PENDING"** — verified via DB query that zero PENDING rows exist. User manually drained them at some earlier point. Skipped the CLI drain step (saved ~$1.30).
- **Railway volume: 5 GB, not 1 GB** — user's first assistant-driven resize staged 500 MB → 1 GB. That's still tiny given 212 MB contracts + 192 MB WAL. Bumped to 5 GB for real headroom (~6 months of growth at current rate).

## Incident: Railway Postgres disk crash

`drizzle-kit push` building the new `contracts_created_at_idx` tipped a 500 MB volume over the edge. Postgres entered a crash loop with `FATAL: could not write to file "pg_wal/xlogtemp.30": No space left on device`. Root cause: Railway hobby default volume (500 MB) was never resized as the contracts table grew; WAL segment overhead (~192 MB steady-state) left too little slack for any schema DDL.

**Resolution:** Railway dashboard → Postgres → Settings → Volume → bump to 5 GB. Deploy applied the change cleanly; Postgres recovered WAL replay on the bigger volume and came back up. No data loss.

**Prevention for next time:** the `api_usage` table is currently 72 KB but grows with every SAM.gov + xAI call. Add a purge cron that deletes rows older than 30 days before it becomes the next disk bomb. P2, not urgent.

## Next Steps (Next Session)

### 1. Build automatic weekly cron (Railway Cron Jobs, not a web service)

The app is localhost-only per user's confirmed use case — no Next.js web service to deploy. Railway has a **Cron Jobs** service type that sleeps until schedule, spins up, runs a single command, exits. That fits this workflow perfectly.

**What to build:**

- **`scripts/cron-weekly-pipeline.ts`** — one script that does the full loop:
  1. Read env (DATABASE_URL, SAM_GOV_API_KEY, XAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NEXT_PUBLIC_APP_URL)
  2. Call `runBulkCrawl(sevenDaysAgo, now)` directly from the library (no HTTP layer)
  3. Pre-filter, call `submitBatchClassify({ pendingOnly: true, since: sevenDaysAgo })`
  4. Poll the xAI batch every few minutes until done (cap 2h)
  5. Call `importBatchResults(batchId)`
  6. Call `sendWeeklyDigest(runId)`
  7. Write a `crawl_runs` row tracking the whole thing
  8. Exit with a clean summary line
- **`scraped_at` or `added_at` column on contracts** — user explicitly asked to label each contract with the date/time it was added by the cron. Current `created_at` serves this, but we should either rename for clarity OR add a dedicated `scraped_at` so `created_at` stays "row insertion" and `scraped_at` is "when the pipeline picked it up." Confirm with user before schema change. Lean toward: reuse `created_at` (schema change is friction, the data is the same).
- **Railway Cron Job service** — create a new service in the JCL-GovCon project via MCP, start command `npx tsx scripts/cron-weekly-pipeline.ts`, schedule `0 15 * * 1` UTC = **Monday 08:00 Pacific** (user confirmed).
- **Copy env vars** from local `.env` to the new cron service via MCP (`mcp__railway__set-variables`).
- **Test fire manually once** — the user explicitly said "we're going to test fire it once manually." First run will pull ~9 days of backlog (nothing has been ingested since 2026-04-07). Expected cost: $1-6 xAI spend on the backlog; steady-state ~$1-3/week after. Watch the Telegram digest land.
- **Steady-state monitoring:** one Telegram message per Monday morning. If no message arrives Monday 09:00 Pacific, something's broken.

### 2. Kanban filter chips (frontend feature)

User wants filter buttons above the GOOD/MAYBE/DISCARD columns on `/pipeline`. Fields to filter on:

- **Notice type** — Solicitation / Presolicitation / Sources Sought / Combined Synopsis / Special Notice (from `contracts.notice_type`)
- **Set-aside qualification** — e.g. "only Small Business or unrestricted" (based on `contracts.set_aside_code`)
- **Date range** — posted between X and Y, or response deadline before Z (based on `contracts.posted_date` / `contracts.response_deadline`)
- **Award ceiling** — `$` range slider (based on `contracts.award_ceiling`)
- (Stretch) NAICS / PSC category codes

**UX requirements:**

- Active filters shown as removable pills above the Kanban columns
- "Clear all filters" button
- Filter state persisted in URL query string — so bookmarking "only small-business solicitations posted this month" is a shareable link
- Filters compose across all three columns (filters apply before GOOD/MAYBE/DISCARD bucketing)

**Files to touch:**

- `src/app/pipeline/page.tsx` — URL query parsing, state management, filter chip UI above columns
- `src/app/api/contracts/route.ts` — add query param handlers for `noticeType`, `setAside`, `postedAfter`, `postedBefore`, `deadlineBefore`, `awardMin`, `awardMax`
- `src/components/kanban/board.tsx` — receive filtered contract list as props (may already)
- New: `src/components/kanban/filter-chips.tsx` — the chip UI

### 3. Pre-solicitation → Solicitation transition handling (design decision needed)

**Problem:** SAM.gov publishes a contract as `Presolicitation` first (intent to solicit, early notice) and later publishes the same contract as `Solicitation` (actual RFP with response deadline). The new `Solicitation` post is a separate SAM.gov row with a different `noticeId`, even though it's the same underlying procurement. Currently we'd ingest both and the user would see two cards for the same thing, classified twice, counted twice in the digest.

**What we need:**

1. **Detection.** How do we know the new Solicitation is a follow-up to an existing Presolicitation?
   - **Candidate signal #1:** `solicitationNumber` — SAM.gov usually keeps this stable across the presol → sol transition. This is probably the best primary key for "same procurement."
   - **Candidate signal #2:** `agency` + `title` fuzzy match — fallback if solicitation number is missing or changes.
   - **Candidate signal #3:** `noticeId` from the Presolicitation referenced as a "related notice" in the Solicitation. SAM.gov sometimes provides this as a relational field. Needs API investigation — `mappers.ts` may need a new field.
2. **Merge mechanics.** What do we do when we detect a match?
   - **Option A:** Update the existing row in place — overwrite `noticeType` to `Solicitation`, refresh `responseDeadline`, `descriptionText`, `resourceLinks`, re-classify. Preserves user triage state (if the user already marked it PURSUING, it stays PURSUING). **Risk:** loses history.
   - **Option B:** Keep both rows, add a `parentNoticeId` / `supersededBy` foreign key, hide the Presolicitation from the Kanban when a Solicitation exists. **Risk:** dual-row state is confusing.
   - **Option C:** Delete the Presolicitation, insert the Solicitation fresh. **Risk:** loses user triage state.
3. **Classification.** Re-classify automatically, or flag the row "re-classify recommended"?
   - Lean toward: re-classify automatically in the same weekly batch, since the Solicitation often has the full RFP text that wasn't available at Presolicitation stage. This is the whole reason the user cares — the Solicitation data is materially better.
4. **User visibility.** Should the digest flag "3 Presolicitations from last month transitioned to Solicitations this week"? Yes — that's exactly the moment the user wants to know about.

**Next session starts with:** investigate SAM.gov API to confirm whether `solicitationNumber` is actually stable across presol → sol transitions (query a few known examples from the DB), and whether SAM.gov exposes a relational "related notice" field. That's the first 10 minutes. Then pick a merge strategy, write a migration if schema changes, update `mappers.ts` and `bulk-crawl.ts`, add a dedicated merge detection step in the weekly cron pipeline.

### Supporting / housekeeping

- **`api_usage` purge cron** — P2. Add when we build the weekly cron; trivial addition (DELETE older than 30 days, same script).
- **Check whether `scripts/run-backfill.ts` should be committed or deleted.** It was a one-shot wrapper around the SQL file for Railway's connection behavior. Probably leave it as a documented one-shot tool.
- **Push any remaining commits** as they land.

## Blockers

None. DB is healthy, branch is merged + pushed, test suite green, user is aligned on what's next.
