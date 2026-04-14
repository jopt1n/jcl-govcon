# JCL GovCon — Progress

## Current State

**Branch:** `fix/batch-import-hang`
**Verification:** 0 type errors, 295/295 tests passing, 0 new lint errors
**Plan:** `/Users/joelaptin/.claude/plans/robust-leaping-sedgewick.md` (CEO + ENG review CLEARED)
**Summary:** `docs/weekly-pipeline-implementation.md`

## Completed This Session (2026-04-13)

1. **Plan through `/office-hours` → `/plan-ceo-review` → `/plan-eng-review`** — SELECTIVE EXPANSION mode. 2 critical gaps caught (async batch, reviewedAt backfill) and fixed. 4 cherry-picks accepted (admin runs view, Telegram notifications, weekly retro stats, CSV export).
2. **Telegram bot provisioned** via @BotFather → `@JCL_GovConBot`. Token + chat_id added to `.env`.
3. **Schema** — added `reviewedAt`, `statusChangedAt` to `contracts`, new `crawlRuns` table with `processingAt` lease, 2 new indexes.
4. **Library extraction** — `src/lib/ai/batch-classify.ts` with `submitBatchClassify` / `pollBatch` / `importBatchResults`. CLI script refactored to thin wrapper, all flags preserved.
5. **Notifications** — `src/lib/notifications/telegram.ts` (fail-loud-in-prod, retry, `ok:false` handling) and `weekly-digest.ts` (retro stats + idempotency via `digestSentAt`).
6. **Cron routes** — `/api/cron/weekly-crawl` and `/api/cron/check-batches` with atomic-claim concurrency gate, 48h stalled guard, structured JSON logs.
7. **Pages** — `/inbox` (mobile-first triage), `/pipeline` (`@dnd-kit` Kanban with CSV export), `/admin/crawl-runs` (server-side debug table).
8. **Contracts API updated** — `unreviewed`/`includeUnreviewed` filters, default `reviewedAt IS NOT NULL`, `reviewedAt` allowlist on PATCH, `statusChangedAt` auto-bump only on actual status change.
9. **Sidebar** — Inbox/Pipeline/Runs nav items with polled unread badge on Inbox.
10. **Railway cron config** in `railway.toml`.
11. **Tests** — 16 new tests (Telegram, CSV escape, cron auth). 3 existing tests updated for new PATCH + Kanban behavior.
12. **Backfill SQL** — `scripts/backfill-reviewed-at.sql` (idempotent, transaction-wrapped, verify-and-raise).

## Decisions Made

- **Split cron (weekly-crawl + check-batches) rather than single blocking endpoint** — xAI batch is async (30min–24hr), a single HTTP request would time out. Rejected: fire-and-forget single cron (loses a week of classified digests); real-time classifier (2x cost, no recovery).
- **Atomic `processing_at` lease over advisory locks** — explicit over clever, visible in schema, survives across requests. Rejected: pg advisory locks (opaque to future readers).
- **Backfill `reviewed_at = created_at`** — keeps all 1,014 existing contracts visible on main board. Rejected: skip filter entirely (Inbox loses its forcing function).
- **Telegram fails loud in prod, no-ops in dev** — avoids silent production outages while keeping local dev painless. Rejected: always no-op (silent failure risk), always throw (dev friction).
- **Digest always fires even on zero-GOOD weeks** — intentional divergence from `/api/digest`. You need proof the cron ran.
- **GHL integration deferred** — v1 surfaces pipeline in-app + Telegram. External CRM is a follow-up PR.

## Next Steps

1. **Review the summary doc** (`docs/weekly-pipeline-implementation.md`) and plan file, run any additional review skills (e.g. `/codex review`).
2. **Run `npx drizzle-kit push`** against Railway prod DB (adds 2 nullable columns + `crawl_runs` table + 2 indexes, zero-downtime).
3. **Run `psql "$DATABASE_URL" -f scripts/backfill-reviewed-at.sql`** — must happen AFTER step 2 and BEFORE deploying the new UI.
4. **Set Railway env vars** — `TELEGRAM_BOT_TOKEN=8678337423:AAG8DBJo1srwHNDEnaTWawfZN6IrQnLYsZE` and `TELEGRAM_CHAT_ID=8644309039` in the Railway dashboard. Consider rotating the token via `/revoke` first since it's in chat history.
5. **Local smoke test** with `SAM_DRY_RUN=true`: hit both cron routes via curl, verify `/inbox`, `/pipeline`, `/admin/crawl-runs`, watch Telegram.
6. **Deploy to Railway** — commit, push, merge. Crons fire automatically once deployed.
