# Codex Bridge for JCL GovCon

This repo was built primarily with Claude Code. Codex should preserve that
workflow instead of replacing it. Start by reading:

1. `CLAUDE.md` for project rules, architecture, commands, and safety posture.
2. `docs/handoff-2026-04-21.md` for current operational state.
3. `plan.md` for the long-running product plan.
4. `progress.md` for historical tracker context, but treat it as stale when it
   conflicts with `docs/handoff-2026-04-21.md`.

Git/local repo state is authoritative for branch, HEAD, dirty status, and file
contents.

Current source-of-truth order for operational state:

1. Live user instructions in the current Codex session.
2. `docs/handoff-2026-04-21.md`.
3. Git history and local repo state.
4. `plan.md`.
5. `progress.md`.
6. Older handoffs and archived docs.

`docs/handoff-2026-04-21.md` beats stale `progress.md` only for operational
state until `progress.md` is updated.

## Hard Safety Rules

- Do not edit `.claude/`, `.gitignore`, `CLAUDE.md`, `plan.md`, or
  `progress.md` unless the user explicitly approves that specific change.
- Do not edit ignored files, local-only settings, logs, caches, generated
  artifacts, `node_modules`, `.env`, `settings.local.json`, or secrets.
- Unlike `CLAUDE.md`, Codex must not write API keys to `.env` during this
  migration unless the user explicitly approves that exact file edit.
- Before proposing or creating a new path, run `git check-ignore -v -- <path>`.
- Do not make external API calls unless explicitly authorized. This includes
  SAM.gov, xAI/Grok, Gemini, Resend, Telegram, Railway, and production database
  operations.
- Do not run destructive git commands. Do not reset, checkout over, clean, or
  remove user work unless explicitly requested.
- Do not port Claude's Stop hook or any auto-checkpoint behavior. Use explicit
  commits only when the user asks.
- Treat stale handoffs, memory files, and tracker docs as hypotheses. Re-verify
  important state from git, local files, and approved live systems before acting.

## Project Commands

- Target dev server: `localhost:3001`. If starting manually, ensure Next binds
  to port `3001`.
- Type check: `npx tsc --noEmit`.
- Tests: `npm run test:run`.
- Lint: `npm run lint`.
- Avoid `npm run build` during cleanup unless the user explicitly asks for a
  full build.

## Verification Expectations

- For normal code changes, prefer `npx tsc --noEmit`, `npm run test:run`, and
  `npm run lint` when relevant to the change.
- For classification logic or prompt changes, follow the stricter verification
  protocol in `CLAUDE.md`. The frozen eval set is still a known gap, so prompt
  changes carry elevated risk.
- For UI changes, use the app locally and visually verify affected screens and
  responsive behavior when feasible.
- For deployment or platform config, follow `docs/infra-review-checklist.md`.

## Current Operational Context

As of `docs/handoff-2026-04-21.md`, the cron architecture code is merged, but
Railway dashboard work remains:

- Connect `jcl-govcon-web` to GitHub.
- Provision `jcl-govcon-weekly-crawl`.
- Provision `jcl-govcon-check-batches`.
- Smoke-test `check-batches`.
- Verify the first scheduled weekly crawl on Monday 2026-04-27 at 15:00 UTC.

Do not assume these dashboard tasks are complete without fresh confirmation.

## Codex Migration Notes

The first Codex migration artifacts are:

- `AGENTS.md` as this thin bridge.
- `docs/codex-migration-plan.md` as the migration tracker.

Do not create `.agents/skills` or Codex-native skill wrappers until the user
approves Phase 4. Treat `.agents/skills` as a candidate location pending Codex
compatibility research; do not assume repo-local skill auto-discovery until it
is verified.
