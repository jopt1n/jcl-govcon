# JCL GovCon — Progress

## Current Phase

**Phase 8.7 — cron service architecture fix shipping on `fix/cron-service-architecture`.** Three-service Railway topology replacing the dead `[[cron]]` blocks that shipped with Sedgewick. All five commits landed locally; ready for `/review` → `/ship`. See `docs/plans/cron-services.md` and `docs/deployment-railway.md`.

## Recently Completed

- **2026-04-21** — Discovered `[[cron]]` blocks in `railway.toml` were invalid Railway schema; the weekly pipeline had not run since the Sedgewick merge (2026-04-16). `crawl_runs` confirms: one row from 2026-04-16 (manual curl, not scheduled), zero rows after. Three-service architecture designed, implemented across 5 commits on `fix/cron-service-architecture`: plan doc, Dockerfile + two JSON configs, railway.toml cleanup, deployment + infra-review-checklist docs, tracker updates. 393/393 tests green at each commit; no changes under `src/`.
- **2026-04-20** — PR #2 merged: `feat: Chosen tier — user-driven promotion above AI's GOOD`. Commit 5 + 4 pre-landing-review fixes amended into it + 2 housekeeping commits (pre-existing P2 items, QA artifact). 393/393 tests, lint clean, tsc exit 0. 5 follow-up TODOs captured (3 P2 + 2 P3).
- **2026-04-19** — Commit 4: /inbox inline ★ Promote + `removeFromInbox` closure helper. Commit 3 earlier: gold CSS tokens + codebase-wide Tailwind alpha-on-CSS-var fix across 10 sites.
- **2026-04-19** — Commits 1 & 2: `contracts.promoted/promotedAt` + partial index + `audit_log` table; PATCH `promoted` with atomic transaction + COALESCE reviewedAt; `?promoted=true|false` filter with 400 validation + `promotedAt DESC` sort.

## In Progress

- Cron architecture fix — awaiting `/review` + `/ship` + post-merge Railway dashboard provisioning (see `docs/deployment-railway.md` §3 and `docs/plans/cron-services.md` §8).

## Blocked On

None.

## Next 3 Actions

1. **`/review` + `/ship` the cron architecture branch.** PR title suggestion: `fix: three-service cron architecture (Sedgewick [[cron]] blocks were invalid schema)`.
2. **Provision the two cron services in Railway dashboard** per `docs/deployment-railway.md` §3. Both need `INGEST_SECRET` as a reference variable from `jcl-govcon-web` and `WEB_BASE_URL` set to `https://${{jcl-govcon-web.RAILWAY_PUBLIC_DOMAIN}}`.
3. **Verify firing.** Manual trigger of `jcl-govcon-check-batches` first (smoke test). Then wait for Monday 2026-04-27 15:00 UTC — expect a new `crawl_runs` row with `kind='weekly'`. If it doesn't fire, rollback per `docs/plans/cron-services.md` §10.

## Reference

- **Plan:** `docs/plans/cron-services.md` — authoritative commit-by-commit spec + post-merge checklist + rollback
- **Deploy doc:** `docs/deployment-railway.md` — topology, Mermaid fire-sequence, provisioning walkthrough, postmortem
- **Reusable checklist:** `docs/infra-review-checklist.md` — extracted from the Sedgewick postmortem; run this on any future infra PR
- **TODOS:** `TODOS.md` — advisory-lock-pinning P2 added 2026-04-21; drained-PENDING entry removed (count is now 0)
- **Tests:** 393/393 passing across 42 files; no code under `src/` changed in this branch
- **CLAUDE.md:** still being rewritten in parallel chat — DO NOT touch
