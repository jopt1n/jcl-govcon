# JCL GovCon — Progress

## Current Phase

**Phase 8.8 — dashboard triage + watch workflow expansion on dirty `main`.** Local work on top of `03cf24d` now spans archive/watch separation, richer card actions/copy, first-class watch backend/schema/routes, and local Railway cron fixes. Cron architecture code is already merged, but live Railway still needs operational follow-through: `jcl-govcon-check-batches` is currently crashed until the local cron-command fix is deployed and re-verified.

## Recently Completed

- **2026-04-23** — Parallel Claude Code planning session produced a 3-way-reviewed fix plan for the advisory-lock pool-pinning bug in `src/app/api/cron/weekly-crawl/route.ts`. CEO review (HOLD_SCOPE), eng review (FULL_REVIEW), and Claude-subagent outside voice all cleared against baseline `c00fa11`. Execution deferred pending explicit go-ahead + reconciliation against current HEAD (`03cf24d`) since the working tree already touches the target file. Plan + decisions recorded at `docs/handoff-2026-04-23-planning.md` (supplementary to Codex's authoritative `docs/handoff-2026-04-23.md`). Three cross-session preferences saved to `~/.claude/projects/.../memory/`: DI-over-inline-copy for integration tests, CI signal-quality over cost framing, and the existing handoff/execution discipline.
- **2026-04-23** — Read-only diagnosis confirmed live Railway state diverges from the current local repo state: `jcl-govcon-check-batches` is crashing in production with `curl: (3) URL rejected: Bad hostname`, the likely cause being Railway not shell-expanding `$WEB_BASE_URL` in the cron `startCommand`. Local fixes now wrap both cron curl commands in `sh -c '...'`; local `railway.weekly-crawl.json` and `docs/deployment-railway.md` also move the intended weekly schedule from Monday to Friday, but none of that has been deployed yet. See `docs/handoff-2026-04-23.md`.
- **2026-04-22** — Dashboard triage workflow polish landed in the local `main` worktree: `/archive` view, archive filters in `/api/contracts`, promoted contracts separated from the homepage into `/chosen`, watched contracts separated from the homepage into `/watch`, dashboard Kanban cards gained inline Archive, chosen cards show analyst summary previews, and dashboard cards now show the full "What This Contract Is" description instead of truncated AI reasoning. Verification passed: `npx tsc --noEmit`, `npm run lint`, `npm run test:run` (51 files, 454 tests).
- **2026-04-21** — Cron architecture fix is no longer a branch-only effort; it merged to `main` as `f42f046`. Remaining work is dashboard-side: connect `jcl-govcon-web` to GitHub, provision `jcl-govcon-weekly-crawl`, provision `jcl-govcon-check-batches`, smoke-test `check-batches`, and verify the first scheduled weekly fire.
- **2026-04-21** — Discovered `[[cron]]` blocks in `railway.toml` were invalid Railway schema; the weekly pipeline had not run since the Sedgewick merge (2026-04-16). `crawl_runs` confirms: one row from 2026-04-16 (manual curl, not scheduled), zero rows after. Three-service architecture designed, implemented across 5 commits on `fix/cron-service-architecture`: plan doc, Dockerfile + two JSON configs, railway.toml cleanup, deployment + infra-review-checklist docs, tracker updates. 393/393 tests green at each commit; no changes under `src/`.
- **2026-04-20** — PR #2 merged: `feat: Chosen tier — user-driven promotion above AI's GOOD`. Commit 5 + 4 pre-landing-review fixes amended into it + 2 housekeeping commits (pre-existing P2 items, QA artifact). 393/393 tests, lint clean, tsc exit 0. 5 follow-up TODOs captured (3 P2 + 2 P3).
- **2026-04-19** — Commit 4: /inbox inline ★ Promote + `removeFromInbox` closure helper. Commit 3 earlier: gold CSS tokens + codebase-wide Tailwind alpha-on-CSS-var fix across 10 sites.
- **2026-04-19** — Commits 1 & 2: `contracts.promoted/promotedAt` + partial index + `audit_log` table; PATCH `promoted` with atomic transaction + COALESCE reviewedAt; `?promoted=true|false` filter with 400 validation + `promotedAt DESC` sort.

## In Progress

- Dashboard triage workflow bundle on dirty `main`; docs now reflect the current local state before commit/push.
- Watch workflow has moved beyond UI into real local backend work: new watch tables in `src/lib/db/schema.ts`, new watch service files under `src/lib/watch/`, new `/api/watch-targets` routes, and a local `/api/cron/watch-check` route plus `railway.watch-check.json`.
- Railway dashboard follow-through for the merged cron architecture still needs fresh confirmation against live Railway state. Local cron fixes exist, but the live `check-batches` service is still crashed.

## Blocked On

No code blocker inside the repo, but operationally the cron automation is blocked on Railway follow-through: live `jcl-govcon-check-batches` is currently crashed until the local `sh -c` wrapper fix is deployed and smoke-tested.

## Next 3 Actions

1. **Stabilize the dirty tree into explicit workstreams before the next ship.** The current local bundle mixes dashboard triage UX, watch backend/schema, Railway cron fixes, tracker updates, and working notes. Decide whether to split these or intentionally ship them together.
2. **Deploy and re-verify the Railway cron fix deliberately.** Push the local `sh -c` wrapper for `railway.check-batches.json`, smoke-test `jcl-govcon-check-batches`, then decide whether the weekly schedule should stay Monday or move to Friday before deploying the `railway.weekly-crawl.json` schedule change.
3. **Decide whether the new watch system is a real product thread now.** If yes, verify the schema push path and the local `/api/watch-targets` + `/api/cron/watch-check` stack before adding GoHighLevel work on top of it. If no, reduce the local tree back to the dashboard triage slice.

## Reference

- **Plan:** `plan.md` — now reflects the local dashboard triage bundle plus the upcoming GoHighLevel pipeline direction
- **Cron spec:** `docs/plans/cron-services.md` — authoritative commit-by-commit spec + post-merge checklist + rollback
- **Deploy doc:** `docs/deployment-railway.md` — topology, Mermaid fire-sequence, provisioning walkthrough, postmortem
- **Handoff:** `docs/handoff-2026-04-23.md` — best current snapshot of the dirty-tree state plus the live Railway `check-batches` crash diagnosis
- **Reusable checklist:** `docs/infra-review-checklist.md` — extracted from the Sedgewick postmortem; run this on any future infra PR
- **TODOS:** `TODOS.md` — now includes the GoHighLevel pipeline experiment as the top `P1` item
- **Tests:** 454/454 passing across 51 files after the current local UI/API updates
- **CLAUDE.md:** still being rewritten in parallel chat — DO NOT touch
