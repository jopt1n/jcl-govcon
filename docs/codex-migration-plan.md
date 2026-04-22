# Codex Migration Plan

## Purpose

This repo has a mature Claude Code workflow. The migration goal is not to
replace it wholesale; it is to make the repo safe and first-class for Codex
while preserving the project rules, handoff discipline, review gates, and
safety posture that already work.

This document records the first Codex compatibility plan. It intentionally does
not modify Claude-owned files.

## Current Findings

- Root `CLAUDE.md` is the project-level Claude guide and remains authoritative
  for architecture, safety rules, commands, and quality expectations.
- `docs/handoff-2026-04-21.md` is newer than `progress.md` and should be
  treated as the current operational handoff until `progress.md` is updated.
- `progress.md` is stale for Phase 8.7: it still says the cron architecture
  branch awaits review/ship, but `main` contains the merged cron architecture
  fix and the newer handoff says Railway dashboard provisioning remains.
- No repo-local `.claude/commands/` directory exists.
- No repo-local `.claude/skills/` directory exists.
- `.claude/settings.json` contains a Claude Stop hook that auto-stages and
  auto-commits WIP. Codex should not inherit or recreate this behavior.
- `.claude/settings.local.json` and `.claude/command-log.txt` are local/ignored
  and should stay untouched.
- `AGENTS.md`, `docs/codex-migration-plan.md`, and `.agents/` paths are not
  ignored as of the Phase 1 checks.

## Source-of-Truth Order

For current operational state, use this order:

1. User instructions in the current session.
2. `docs/handoff-2026-04-21.md`.
3. Git history and local repo state.
4. `plan.md`.
5. `progress.md`.
6. Older handoffs and archived docs.

Git/local repo state is authoritative for branch, HEAD, dirty status, and file
contents. `docs/handoff-2026-04-21.md` beats stale `progress.md` only for
operational state until `progress.md` is updated.

For project conventions, use:

1. User instructions in the current session.
2. `AGENTS.md` for Codex-specific guardrails.
3. `CLAUDE.md` for existing project methodology and rules.
4. Focused docs under `docs/`, especially `docs/infra-review-checklist.md`.

## Phase 1: Read-Only Inventory

Status: complete.

Actions performed:

- Checked working tree and branch state.
- Read `CLAUDE.md`, `plan.md`, `progress.md`, and current handoff docs.
- Listed `.claude/` structure without exposing local settings.
- Confirmed there are no repo-local Claude commands or skills directories.
- Identified the Claude Stop hook as non-portable.
- Checked approved Codex migration target paths with `git check-ignore -v`.

No files were written in Phase 1.

## Phase 2: Thin `AGENTS.md` Bridge

Status: complete.

Scope:

- Add root `AGENTS.md`.
- Point Codex to `CLAUDE.md` instead of duplicating the whole Claude guide.
- Include highest-risk rules directly so Codex cannot miss them:
  - no external API calls without explicit approval
  - no edits to `.claude/`, `.gitignore`, local/ignored files, secrets, logs, or
    caches
  - no blind port of the Claude Stop hook
  - explicit commit-only behavior
  - verification commands and build caution
  - current source-of-truth ordering

Out of scope:

- No edits to `CLAUDE.md`, `plan.md`, or `progress.md`.
- No `.agents/skills` creation.

## Phase 3: Migration Plan Doc

Status: complete.

Scope:

- Add this file at `docs/codex-migration-plan.md`.
- Record the safe migration phases and unresolved questions.
- Keep the plan read-oriented and reversible.

Out of scope:

- No code changes.
- No Claude file edits.
- No global Claude setup inspection yet.

## Phase 4: Codex-Native Skill Wrappers

Status: not approved yet.

Potential target, pending Codex compatibility research:

- `.agents/skills/.../SKILL.md`

Precondition:

- Re-check `git check-ignore -v -- .agents .agents/skills <specific-path>`.
- Complete the later read-only inspection of global Claude setup.
- Decide which workflows are worth wrapping.
- Verify whether Codex auto-discovers repo-local skills before relying on this
  path.

Likely wrapper candidates:

- Planning review workflow corresponding to `/plan-ceo-review`.
- Engineering review workflow corresponding to `/plan-eng-review`.
- Code review workflow corresponding to `/review`.
- QA workflow corresponding to `/qa`.
- Shipping / PR workflow corresponding to `/ship`.
- Handoff workflow corresponding to `/handoff`.

Do not copy Claude command bodies blindly. Translate the intent into
Codex-native instructions after reviewing the source workflow.

## Phase 5: Deep Compatibility Research

Status: planned later, read-only.

Approved later inspection targets:

- `~/.claude/CLAUDE.md`
- global Claude commands
- global Claude skills
- relevant global Claude settings

Rules for that pass:

- Read-only only.
- Do not expose secrets or local-only values.
- Do not edit global files.
- Do not copy global Claude content into this repo yet.
- Summarize structure, workflow intent, and portability.
- Propose what should become Codex-native before writing anything.

Research questions:

- Which Claude commands are pure process and can become Codex workflows?
- Which Claude skills contain reusable project methodology?
- Which hooks are safety-critical versus convenience automation?
- Which settings are Claude-specific and should remain unported?
- What should live in `AGENTS.md` versus dedicated Codex skills?

## Non-Portable or High-Risk Items

- Claude Stop hook: auto-stages and auto-commits. Do not port for Codex.
- Local settings: may contain machine-specific or sensitive behavior. Summarize
  keys only if inspected later.
- Unlike `CLAUDE.md`, Codex must not write API keys to `.env` during this
  migration unless the user explicitly approves that exact file edit.
- External service operations: Railway, SAM.gov, xAI/Grok, Gemini, Resend,
  Telegram, and production DB actions require explicit user authorization.
- Prompt/classification changes: require special verification. The eval set
  called out in `CLAUDE.md` does not yet exist, so risk must be flagged.

## File Ownership Rules During Migration

Do not touch without explicit approval:

- `.claude/`
- `.gitignore`
- `CLAUDE.md`
- `plan.md`
- `progress.md`
- ignored files
- secrets and local env files
- logs, caches, generated artifacts, and `node_modules`

Approved Phase 2/3 files:

- `AGENTS.md`
- `docs/codex-migration-plan.md`

Deferred candidate files, pending compatibility research:

- `.agents/skills/...`

## Open Questions

- Should `progress.md` eventually be corrected to match the newer handoff, or
  should it remain historical until the next product session?
- Should Codex workflows mirror Claude slash-command names, or should they use
  more explicit skill names?
- Should any Codex skill wrappers be repo-local, or should some live in a user
  global Codex setup after the global Claude inspection?
- Should a formal "no auto-commit" rule remain permanent for Codex, or only
  apply during migration?
