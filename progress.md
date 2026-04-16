# JCL GovCon — Progress

## Current State

**Branch:** `main`
**Verification:** 0 type errors, 332/332 tests passing, 0 lint errors
**Plan:** `/Users/joelaptin/.claude/plans/wise-nibbling-raven.md`
**DB:** ~34,804 classified contracts (34,051 DISCARD, 375 MAYBE, 377 GOOD, 0 PENDING). Last ingest: 2026-04-16.
**Railway:** Next.js web service deployed at `https://jcl-govcon-web-production.up.railway.app`. Cron jobs active: weekly-crawl (Mon 15:00 UTC), check-batches (every 30 min). 5 GB Postgres volume.

## Completed This Session (2026-04-15 → 2026-04-16)

### Railway deployment + cron pipeline activation

1. **Discovered pipeline code already existed** — `weekly-crawl` route, `check-batches` route, `weekly-digest.ts`, `railway.toml` were all built in prior sessions. Previous progress.md incorrectly listed "build cron-weekly-pipeline.ts script" as next step.
2. **Updated cron schedule** — changed `railway.toml` from Sunday 03:00 UTC to Monday 15:00 UTC (08:00 Pacific) per user preference.
3. **Fixed Next.js build errors** — added `eslint.dirs` in `next.config.mjs` to skip test files during build; added eslint-disable for `batch-classify.ts` xai() return type and `DocumentViewer.tsx` img element; made Resend client lazy in `digest.ts` to avoid build-time crash when `RESEND_API_KEY` is missing.
4. **Created Railway web service** (`jcl-govcon-web`, ID: `12b32017-6279-45f0-a1f1-f94c2e3fca49`) via `railway add --service`.
5. **Set all env vars** on Railway web service via MCP. Generated domain: `jcl-govcon-web-production.up.railway.app`.
6. **Rotated INGEST_SECRET** from `changeme` to a 256-bit hex secret (`466272a...`). Updated both Railway and local `.env`.
7. **Fixed critical bug: postgres-js result parsing** — `db.execute()` with `drizzle-orm/postgres-js` returns a bare array `[{ locked: true }]`, but both cron routes cast the result as `{ rows: [...] }`. This made `.rows` always `undefined`, so the advisory lock always reported "another crawl in progress" and the atomic claim in check-batches never matched. Fixed in both `weekly-crawl/route.ts` and `check-batches/route.ts`.
8. **Test-fired weekly-crawl** — crawled 5,630 contracts from SAM.gov (9-day backlog), pre-filtered 863, submitted 4,767 to xAI batch. Batch completed, imported: 259 GOOD, 169 MAYBE, 4,339 DISCARD.
9. **Manually linked crawl_runs row to batch** — weekly-crawl function timed out (Railway response timeout) before writing batchId to the DB, even though the xAI batch was created. Manually UPDATE'd the row to link them. check-batches then processed it successfully.
10. **Telegram digest delivered** — digest sent at 18:55 UTC with contract summary.
11. **Simplified digest format** — removed individual contract listings. Now shows only totals: GOOD/MAYBE/DISCARD counts, crawl total, triage activity. Updated tests to match.

## Decisions Made

- **HTTP cron (not standalone script)** — the pipeline was already built as Next.js API routes + Railway cron curls. This is more robust than a standalone script (advisory locks, atomic claims, idempotent retries, structured logging). Rejected: building a separate `scripts/cron-weekly-pipeline.ts` as previous progress.md suggested.
- **Monday 15:00 UTC cron schedule** — user confirmed Monday 08:00 Pacific. Digest arrives by ~09:00 PT after batch completes. Rejected: Sunday 03:00 UTC (original setting), different schedule.
- **eslint.dirs over ignoreDuringBuilds** — `eslint.dirs: ["src/app", "src/components", "src/lib"]` skips test files without disabling all lint during build. Rejected: `ignoreDuringBuilds: true` (too broad).
- **Lazy Resend client** — `new Resend(key)` at module level crashes during Next.js static analysis when the key is missing. Wrapped in a function. Rejected: adding RESEND_API_KEY to Railway (not needed for cron pipeline).
- **eslint-disable on xai() return type** — changing `Promise<any>` to `Promise<unknown>` would require type assertions at ~15 call sites. The function is a generic HTTP helper; `any` is pragmatic here. Rejected: `Promise<unknown>` (too invasive).
- **Count-only digest** — user explicitly requested shorter format. No individual contracts listed, just GOOD/MAYBE/DISCARD totals + crawl count + triage activity. Rejected: keeping top-5 contract listings.
- **Public proxy DATABASE_URL** — using the Railway TCP proxy URL for now. Internal URL would reduce latency (~1ms vs ~20-50ms) but we don't know the internal hostname. Optimization for later.

## Known Issues

- **Classification is too lenient** — 259 GOOD out of 4,767 (5.4%) vs historical 0.39%. The feasibility test ("could one resourceful person do this?") catches every small commodity purchase (hinges, hot water booster, dental equipment) as GOOD. Prompt tuning needed.
- **Weekly-crawl function timeout** — with large backlogs (4,767 contracts), uploading prompts to xAI exceeds Railway's response timeout. The batch still gets created server-side, but the crawl_runs row doesn't get updated with batchId. Not a problem in steady-state (typical week = ~500-1000 contracts), but the first run required manual DB fixup.
- **13 auto-checkpoint commits ahead of origin** — need to squash or push.
- **Accidental deploy to Postgres service** — first `railway deploy` went to the Postgres service (the only service at the time). Build failed (trying npm build on Postgres). No harm done, but the failed deployment is visible in Railway dashboard.

## Next Steps (Next Session)

### 1. Tighten classification prompt (PRIORITY)

The 259 GOOD contracts include commodity procurement (hinges, hot water booster, dental microscopes, bowling alley sound systems). The prompt needs to distinguish between:

- **Real opportunities**: consulting, IT services, training, professional services
- **Commodity procurement**: buy physical product, ship it — not what JCL does

Update `src/lib/ai/prompts.ts` to add a commodity/product-reselling DISCARD rule. Then reclassify the 259 GOOD contracts to test the new prompt before the next weekly run.

### 2. Kanban filter chips (frontend feature)

Filter buttons above the Kanban columns: notice type, set-aside, date range, award ceiling. URL-persisted state. Key need: filter by "created this week" to separate new contracts from old.

### 3. Presol → Solicitation transition handling

Design decision needed. Investigate SAM.gov API `solicitationNumber` stability, pick merge strategy.

### 4. Supporting / housekeeping

- `api_usage` purge cron (P2, trivial addition to check-batches or separate cron)
- Push commits to origin (13 ahead)
- Consider internal DATABASE_URL for Railway (latency optimization)

## Blockers

None. Pipeline is operational, DB healthy, tests green.
