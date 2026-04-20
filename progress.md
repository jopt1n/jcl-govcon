# JCL GovCon — Progress

## Current Phase

**CHOSEN tier feature in flight on `feat/chosen-tier`.** Commits 1-4 of 5 landed. Commit 5 (/chosen page + sidebar) is the final feature commit before `/qa` + `/ship`.

## Recently Completed

- **2026-04-19** — Commit 4 landed: /inbox gains inline ★ Promote button; `removeFromInbox` helper extracted as closure-based inner function; optimistic-remove flow shared with Mark reviewed. 379/379 tests green.
- **2026-04-19** — Commit 3 landed: gold CSS tokens, Kanban card state-exclusive gold border + star, contract-detail Promote/Demote button + CHOSEN pill + top accent. Plus codebase-wide fix for Tailwind alpha-modifier-on-CSS-vars bug — precomputed `--accent-N` + `--chosen-border` tokens replace 10 broken sites.
- **2026-04-19** — Commit 2 landed: PATCH `promoted` with atomic audit_log transaction + COALESCE reviewedAt; `?promoted=` filter with 400 validation.

## In Progress

- Commit 5 of CHOSEN tier — /chosen page + sidebar `useNavCounts` with Promise.allSettled. See `docs/plans/chosen-tier.md` §7.

## Blocked On

None.

## Next 3 Actions (see `docs/handoff-2026-04-19.md` for detail)

1. **Implement Commit 5** — new `src/app/chosen/page.tsx` (flat list sorted by promotedAt DESC, Load more at 50/page, empty + error + loaded states, Demote per card) + `src/components/sidebar.tsx` rename `useUnreadCount` → `useNavCounts` via `Promise.allSettled` of two existing `/api/contracts?...&limit=1` calls + Chosen nav item with Star icon + gold badge. Gate: tsc + test:run green, then `/review`.
2. **`/qa` focused on:** cross-classification promote (MAYBE → promoted works), demote reversibility, /chosen empty vs error states, sidebar badge accuracy after promote/demote cycle, dark-mode gold tokens.
3. **`/ship`** with PR title `feat: Chosen tier — user-driven promotion above AI's GOOD`.

## Reference

- **Plan:** `docs/plans/chosen-tier.md` — authoritative for Commit 5 scope
- **Branch tip:** `962ef8c` (Commit 4) plus auto-checkpoint commits (noise, `/ship` squashes)
- **Tests:** 379/379 passing across 40 files
- **Tailwind gotcha:** `var(--X)/N` alpha modifiers are silently broken — use precomputed tokens from `globals.css`
- **CLAUDE.md:** being rewritten in a parallel chat — DO NOT touch
