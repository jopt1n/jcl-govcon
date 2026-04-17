# JCL GovCon — Progress

## Current State

**Branch:** `main` (pushed through `a5325a7`; local has 1 uncommitted change: removed `DashboardStats`)
**Verification:** 0 type errors, 351/351 tests passing, 0 lint errors
**DB:** 35,667 classified (34,920 DISCARD, 375 MAYBE, 372 GOOD, 0 PENDING). 1,014 with descriptions fetched. Last ingest: 2026-04-16.
**Dev server:** `http://localhost:3001` (already running on your machine)
**Railway:** `https://jcl-govcon-web-production.up.railway.app`. Cron active: weekly-crawl Mon 15:00 UTC, check-batches every 30 min.

## Completed This Session (2026-04-17)

### Kanban filter chips (the main feature)

Filter the board without typing — click chips to narrow. State lives in the URL so refresh keeps the filter and links are shareable.

Three chip groups, placed directly under the search bar:

- **Notice:** Solicitation, Combined Synopsis/Solicitation, Presolicitation, Sources Sought. Multi-select — click to add, click again to remove.
- **Posted:** All time / This week / This month. Single-select.
- **Set-aside:** "Qualifying only" toggle (hides 8A, SDVOSB, HZ, WOSB, EDWOSB, ISBEE, VSA, VSB).

Free-text "Agency" filter kept in the collapsible panel to the right of the search.

**Files changed:**

- `src/components/kanban/filter-chips.tsx` (new)
- `src/components/kanban/board.tsx` — swapped local `useState` filter state for `useSearchParams`/`router.replace`, so filters live in the URL. Added URL-param validation for `postedWindow`.
- `src/app/api/contracts/route.ts` — extended to accept comma-separated `noticeType`, `postedAfter`, `setAsideQualifying`.
- `src/app/page.tsx` — wrapped board in `<Suspense>` (required by `useSearchParams`); **removed `DashboardStats`** (the all-zero card row).
- `src/lib/sam-gov/set-aside-filter.ts` — exported `RESTRICTED_SET_ASIDE_PREFIXES` so the API route mirrors `isRestrictedSetAside()`.
- Tests: new `filter-chips.test.tsx`, extended `route.test.ts` and `board.test.tsx`. +19 tests, 351 total.

### `/review` found a critical bug (auto-fixed)

The first draft of `setAsideQualifying` used an allowlist (`SBA, SBP, NONE, ''`). The rest of the app uses `isRestrictedSetAside()` — a **prefix blocklist**. These diverge on any code not in either list. Would have silently hidden contracts from the Kanban that the classifier kept. Fixed by mirroring the shared blocklist via Postgres `!~*` regex.

### Product decision: classification stays lenient

"I'd rather review 10 and get one good one, than review one and miss a good one." Don't tighten `src/lib/ai/prompts.ts` to cut the GOOD count — the "too lenient" note in prior progress is closed by product decision. Saved to memory as `feedback_classification_recall.md`.

### Pushed to origin

18 commits landed. `2adad8c..a5325a7` → `origin/main`.

## Decisions Made

- **URL-persisted filter state** (not local state). Rationale: shareable links, survives refresh, back-button works. Implemented via `useSearchParams` + `router.replace`.
- **Single source of truth for set-asides** — both the AI pre-filter and the Kanban "Qualifying only" toggle derive from `RESTRICTED_SET_ASIDE_PREFIXES`. Don't add a second list.
- **Removed `DashboardStats`** — the second stat row was showing all zeros because its query had a filter that didn't match the DB state. The Pipeline Status widget already shows the live counts.

## Known Issues

- **Weekly-crawl function timeout** — large backlogs exceed Railway's response timeout. Batch still gets created server-side. First run needed manual DB fixup. Steady-state (~500-1000 contracts/week) is fine.
- **259 new contracts from 2026-04-16 weekend batch sit on /inbox unreviewed** — they won't appear on the main Kanban until you triage them. That's by design (the Kanban filters `reviewedAt IS NOT NULL`).

## Next Steps

### 1. Kanban UI polish (if desired)

- **Responsive chip row** — on narrow screens the chips wrap but don't scroll horizontally. Could add `overflow-x-auto` if wrapping feels messy.
- **"This week" + main Kanban interaction** — "This week" will often return 0 because new contracts sit on `/inbox` (unreviewed). Consider: (a) an affordance that links to `/inbox` when the filter empties the board, or (b) making "This week" include unreviewed.

### 2. Presol → Solicitation transition handling

Open design question. SAM.gov sometimes posts a Presolicitation first, then the same opportunity as a Solicitation with a different `noticeId` but the same `solicitationNumber`. Should the pipeline merge them or keep both?

### 3. Supporting / housekeeping

- `api_usage` purge cron (P2, trivial)
- Internal DATABASE_URL for Railway (latency optimization)
- Next.js 14 → 15 upgrade

## Blockers

None.
