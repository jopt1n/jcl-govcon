# JCL GovCon — Progress

## Current Phase

**Phase 8 (Go Live) complete.** Pipeline operational. Working on UI polish + triage experience.

## Recently Completed

- **2026-04-17** — Kanban filter chips shipped (Notice / Posted / Set-aside), URL-persisted; DashboardStats row removed via PR #1.
- **2026-04-17** — `/review` caught and fixed a critical set-aside filter divergence; `RESTRICTED_SET_ASIDE_PREFIXES` now the single source of truth.
- **2026-04-16** — Weekly-crawl pipeline activated on Railway; first run imported 259 GOOD / 169 MAYBE / 4,339 DISCARD.

## In Progress

- 259 new GOOD contracts from the 2026-04-16 batch sitting unreviewed on `/inbox`, waiting for user triage.

## Blocked On

None.

## Next 3 Actions (see `docs/handoff-2026-04-17.md` for detail)

1. **Triage the 259 unreviewed GOOD contracts on `/inbox`** — validates the lenient classifier's signal-to-noise in the wild.
2. **Decide: should "This week" chip include unreviewed contracts?** — currently returns 0 because new contracts sit on /inbox.
3. **Presol → Solicitation merge strategy** — needs empirical check on `solicitationNumber` stability before design.

## Reference

- **Live:** `https://jcl-govcon-web-production.up.railway.app`
- **Dev:** `http://localhost:3001`
- **DB:** 35,667 contracts (372 GOOD, 375 MAYBE, 34,920 DISCARD)
- **Tests:** 351/351 passing
- **Last clean commit:** `a087f8e` (origin/main)
- **Product stance:** classifier stays lenient — see `~/.claude/projects/-Users-joelaptin-jcl-govcon/memory/feedback_classification_recall.md`
