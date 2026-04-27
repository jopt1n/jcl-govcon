# Session Handoff — 2026-04-23 (planning supplement)

**Complement to:** `docs/handoff-2026-04-23.md` (Codex, authoritative on repo state, live Railway status, dirty-tree inventory). Read that first. This file covers only what that doc does not: a 3-way-reviewed advisory-lock plan produced by a parallel Claude Code planning session, and three cross-session collaboration preferences saved to memory.

## Thesis

Advisory-lock connection-pinning bug in `src/app/api/cron/weekly-crawl/route.ts` has a review-complete fix plan waiting for user go-ahead, but the plan was reviewed against baseline commit `c00fa11` and must be re-validated against the current dirty tree before execution — the working tree already touches the target file.

## What shipped (from the planning session)

- **Plan scratchpad** at `/Users/joelaptin/.claude/plans/enter-plan-mode-problem-curious-wadler.md` (~515 lines + appended handoff section) — the full advisory-lock fix spec: helper with DI for tests, key registry, 4-test integration suite with separate postgres clients for deterministic race detection, 1-test unit suite via `vi.mock("@/lib/db")`, GHA integration workflow scoped to `pull_request: branches: [main]` + `workflow_dispatch:`. Why it matters: recoverable if the plan is picked up again, with review history intact.
- **Three memory entries** at `~/.claude/projects/-Users-joelaptin-jcl-govcon/memory/`:
  - `feedback_di_over_inline_copy_in_tests.md` — refactor the SUT to accept injected dependency instead of pasting a copy into the test file
  - `feedback_ci_signal_quality_over_cost.md` — frame CI trigger scope as signal quality, not runtime minutes; default to `pull_request: branches: [main]` + `workflow_dispatch:`
  - `MEMORY.md` index updated
    Why it matters: these are cross-session collaboration preferences that will auto-apply to future reviews without re-litigation.
- **Three gstack review log entries** at `~/.gstack/projects/jopt1n-jcl-govcon/` (plan-ceo-review + plan-eng-review + codex-plan-review) dated 2026-04-22, all against commit `c00fa11`. Why it matters: the review dashboard will surface these on next session. **They are stale against current HEAD `03cf24d`.**

## Decisions made in the planning session

### Decision: HOLD_SCOPE review mode for the advisory-lock fix

- **Chose:** make existing narrow scope bulletproof; no expansion or reduction
- **Rationale:** bug fix, well-scoped, single commit; CEO review default for bug-fix plans
- **Rejected:** SELECTIVE EXPANSION (would have surfaced generic single-flight helper + check-batches concurrency review as cherry-picks — deemed premature until a second caller exists)
- **Reversible?** yes — future branches can extract a generic primitive when a second caller shows up
- **Could go wrong:** if `withAdvisoryLock` gets copy-pasted into a future caller instead of imported, the registry discipline breaks. Low risk.

### Decision: DI via optional `sqlClient: Sql = defaultSql` third parameter

- **Chose:** helper signature `withAdvisoryLock(key, fn, sqlClient = defaultSql)`; production callers use two-arg form
- **Rationale:** integration tests need to point at a throwaway Postgres, not the app's `DATABASE_URL`; inline-copying the helper body into the test file would allow silent drift
- **Rejected:** inline copy in the integration test with "code review catches drift" as the mitigation — weak guarantee
- **Reversible?** yes — default param keeps production call sites untouched
- **Could go wrong:** tests injecting a mock `sqlClient` without real `reserve()` semantics could false-positive; mitigated by the unit test being the only mock-injection site

### Decision: CI triggers `pull_request: branches: [main]` + `workflow_dispatch:`

- **Chose:** PR-targeting-main plus manual dispatch
- **Rationale (user-stated, saved to memory):** signal quality over cost. PR-gate red X is always blocking → stays meaningful. Branch-push CI produces noisy WIP failures that train ignore-red-X habits.
- **Rejected:** `on: push: [fix/**, feat/**] + pull_request` (rejected on signal-quality grounds, not cost)
- **Reversible?** yes, one-line YAML change
- **Could go wrong:** feature branch with broken integration test could sit without CI feedback. Mitigated by `workflow_dispatch:` escape hatch and pre-push local run as a habit.

### Decision: Four integration tests, not three (outside-voice fix)

- **Chose:** race test (2 separate postgres clients for separate sessions) + release-verification test (3rd independent client acquires after helper returns) + re-acquisition + release-on-throw
- **Rationale:** Claude subagent (outside voice) caught that the original 3-test design was probabilistic — `pg_try_advisory_lock` re-entrancy within a session means an acquire landing on the same pool connection returns TRUE even under the broken pattern. `idle_timeout: 2s` could also mask stranded locks. Separate clients + `idle_timeout: 60s` + independent third client make detection deterministic.
- **Rejected:** original 3-test design — probabilistic coverage of the very bug the PR exists to fix
- **Reversible?** yes
- **Could go wrong:** if `sqlA/sqlB/sqlVerify` pools don't tear down cleanly, test suite exit can hang. Plan documents `Promise.all([sqlA.end, sqlB.end, sqlVerify.end])` with 5s timeout.

## Current state

- **Plan:** review-complete against baseline `c00fa11`, execution deferred pending user go-ahead. Baseline no longer matches HEAD (`03cf24d`) or working tree.
- **Repo:** dirty. 2 Codex commits ahead of `c00fa11`, 31 uncommitted files (one is the plan's target `src/app/api/cron/weekly-crawl/route.ts`, 14-line diff), 16+ untracked paths including `docs/handoff-2026-04-23.md` (Codex) and the whole new watch/archive feature tree.
- **No branches created.** `fix/advisory-lock-connection-pinning` still hypothetical.
- **No source-file changes made by this planning session.** All artifacts are outside the repo (plan scratchpad, memory files, gstack logs).

## Known gaps entering next session

- **Plan baseline is stale vs HEAD.** Must diff `src/app/api/cron/weekly-crawl/route.ts` between `c00fa11` and working tree before trusting any line reference in the plan.
- **Whole `watch/` and `archive/` feature scope** is not understood by the planning session — read Codex's handoff and `docs/handoff-2026-04-22.md` to catch up.
- **Review-dashboard "CLEARED" signal is commit-scoped to `c00fa11`.** A next-session `/ship` or `/review` will see the CLEARED status but shouldn't assume it applies to whatever Codex built on top.
- **The 14-line uncommitted change to the plan's target file** could be: (a) unrelated polish, (b) a Codex-authored start on the same fix, (c) something that shifts the bug's line refs. Not triaged.

## Open questions

- Is the `src/app/api/cron/weekly-crawl/route.ts` working-tree mutation related to the advisory-lock bug or unrelated?
- Does Codex's "bridge and migration plan" (`af40432`) overlap with or affect the advisory-lock plan's trajectory?
- Does the new `watch-check` cron route (`src/app/api/cron/watch-check/`) introduce its own advisory-lock-style concurrency concerns that should be batched into the same review?

## Next session — start here

Single deliverable for the advisory-lock thread: **go/no-go decision on the plan, grounded in current-state evidence, not the stale c00fa11 baseline.**

Literal first commands:

```bash
cd /Users/joelaptin/jcl-govcon
cat docs/handoff-2026-04-23.md                                    # Codex's authoritative view
cat docs/handoff-2026-04-23-planning.md                           # this file (planning supplement)
git log --oneline c00fa11..HEAD                                   # what landed via Codex
git diff c00fa11..HEAD -- src/app/api/cron/weekly-crawl/route.ts  # check committed changes to target
git diff HEAD -- src/app/api/cron/weekly-crawl/route.ts           # check uncommitted changes to target
```

Then either: (a) execute the advisory-lock plan if current state still matches its assumptions, (b) revise the plan if the baseline moved, or (c) deprecate the plan if Codex already fixed the underlying bug.

## Files to watch next session

- `docs/handoff-2026-04-23.md` — Codex, authoritative on dirty-tree state + live Railway
- `docs/handoff-2026-04-22.md` — prior Codex session, dashboard triage narrative
- `src/app/api/cron/weekly-crawl/route.ts` — plan's target, 14-line uncommitted diff
- `/Users/joelaptin/.claude/plans/enter-plan-mode-problem-curious-wadler.md` — the plan itself + a longer embedded handoff section
- `~/.claude/projects/-Users-joelaptin-jcl-govcon/memory/MEMORY.md` — three new entries to apply auto

## Context for next Claude

### What we're building

JCL GovCon is a SAM.gov → Grok/Gemini AI → Kanban dashboard pipeline for a solo-operator government contracting business. Core pipeline is done; current work is hardening (cron provisioning, concurrency correctness) plus new features under active Codex development (`watch/` monitoring subsystem, `archive/` view). Joe runs multiple Claude sessions + Codex in parallel and orchestrates a 3-server cluster via a commander interface — that parallelism is why this session's plan baseline went stale.

### Mindset to inherit

You are catching up to a moving target. The planning session that produced the advisory-lock plan did careful work within a narrow scope and got clean reviews, but the repo has moved underneath it. Don't trust the plan's line references without verifying. Don't trust `c00fa11`-timestamped review logs as "this is current state." Read Codex's `docs/handoff-2026-04-23.md` FIRST — it has live Railway diagnosis and a full dirty-tree inventory this planning session didn't have access to. Be honest with Joe about what you don't yet know. He's already aware the situation is messy.

### What NOT to do

- Don't execute the advisory-lock plan without re-validating its line refs and confirming the bug still exists in current `route.ts`
- Don't overwrite `docs/handoff-2026-04-23.md` (Codex's work) or `docs/handoff-2026-04-22.md`
- Don't touch `src/app/watch/`, `src/app/archive/`, or the Codex-bridge commits without reading their intent first

### What success looks like next session

A go/no-go decision on the advisory-lock plan, grounded in a current-state diff, with either a clean commit message executing it or an explicit deprecation note pointing to whatever Codex landed.

## Escalation tier: redirect

Not a user pivot — the repo moved underneath a scoped plan that held its scope honestly. The planning work is real and preserved; the baseline it was reviewed against is no longer authoritative. Correct response next session: treat the plan as one input to a reconciliation task, not as the ship-ready spec it was at 2026-04-22 23:30.
