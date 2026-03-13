# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — Pipeline fully built. 1,008 contracts ingested. All tests passing. Security fix applied. Ready for bulk crawl + classification + deployment.

**Branch:** `main` (3 commits ahead of origin, not pushed)

## What's Working
- SAM.gov API client with DRY_RUN safety, rate limiting, pause/resume
- 4-step pipeline: metadata crawl → metadata classify → fetch descriptions → re-classify
- Gemini 2.5 Flash classification (metadata-only triage + full description re-classify)
- Kanban dashboard with drag-drop, search, filters, pagination
- Dark-mode-first design system with CSS variable tokens
- Analytics dashboard (donut, line, bar charts)
- Settings page (company profile, email config, ingest triggers)
- CSV import with column mapping
- Email digest via Resend (not yet configured)
- Server-side pipeline proxy (`/api/pipeline`) — no secrets exposed to client
- 30 test files, 258 tests, all passing in ~1.5s
- Railway PostgreSQL connected, schema pushed

## Completed This Session (2026-03-13)
1. **Full codebase audit** — mapped all 80+ source files, schema, API routes, components
2. **Committed existing codebase** — 104 files were untracked; committed as `33a3848`
3. **Created workflow files:**
   - `CLAUDE.md` — concise project rules, verification protocol, rejected approaches
   - `plan.md` — 10 phases with checkboxes (phases 1-7 complete, 8-10 remaining)
   - `progress.md` — current state, decisions, next steps
   - `.claude/settings.json` — stop hook reminder
4. **Created 5 ADRs** in `docs/adr/`:
   - 001: SAM.gov 4-phase pipeline architecture
   - 002: Gemini 2.5 Flash classification choice
   - 003: Railway PostgreSQL + Drizzle ORM
   - 004: Contract classification criteria (GOOD/MAYBE/DISCARD)
   - 005: Dark-mode-first UI design system
5. **Archived** old `tasks/todo.md` to `docs/archive/todo-original.md`
6. **Security fix: removed NEXT_PUBLIC_INGEST_SECRET** — created `/api/pipeline` server-side proxy route. Refactored `crawl-status.tsx`, `contract-detail.tsx`, `classify-control.tsx` to call proxy instead of authed endpoints directly. Removed unused `Play` import and `endpoint` field from PHASES config.
7. **Updated .gitignore** — added `CLAUDE.local.md`, `review-*.png`, `screenshot-*.png`, `.playwright-mcp/`

## Decisions Made This Session
- **Server-side proxy over server actions**: Created `/api/pipeline` route (traditional API proxy) rather than Next.js server actions. Rationale: simpler, works with existing `fetch()` patterns in client components, no refactor to form actions needed. Server actions would be cleaner long-term but higher effort for equivalent security improvement.
- **Single proxy route**: One `/api/pipeline` route handles all 7 pipeline actions via an `action` parameter, rather than creating 7 individual unauthenticated proxy routes. Rationale: DRY, single place to manage auth forwarding.
- **Two commits for initial code**: Separated existing codebase commit from workflow setup commit. Rationale: clean git history — codebase stands alone, workflow changes are clearly additive.

## Next Steps
1. **Bulk crawl** — Set `SAM_DRY_RUN=false`, trigger bulk crawl (~18K contracts, ~2 days at 1K calls/day)
2. **Classify** — Run metadata classification (~$2-5 Gemini cost), then description fetch + re-classify
3. **Quality check** — Spot-check 10 contracts per classification category
4. **Deploy** — Push to Railway, configure n8n daily workflow (6 AM), set `NEXT_PUBLIC_APP_URL`
5. **Email digest** — Set `RESEND_API_KEY`, test digest delivery
6. **Application facilitation** — Build GOOD contract workflow (Phase 9 in plan.md)

## Known Issues
- `updatedAt` columns don't auto-update (need app-level fix or Postgres trigger)
- DB connection pool `max: 1` (increase for production)
- All 1,008 contracts are PENDING (no Gemini calls made yet)
- `RESEND_API_KEY` and `NEXT_PUBLIC_APP_URL` not set yet
- Pre-existing lint warnings: ~50 `no-explicit-any` in test files (cosmetic, non-blocking)
- 3 commits ahead of origin — **not pushed** (user has not authorized push)
