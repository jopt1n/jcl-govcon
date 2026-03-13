# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — Pipeline fully built. 1,008 contracts ingested. All tests passing. Ready for bulk crawl + classification + deployment.

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
- 30 test files, 258 tests, all passing in ~1.5s
- Railway PostgreSQL connected, schema pushed

## Completed This Session
- Workflow setup: CLAUDE.md, plan.md, progress.md, ADRs, .claude/settings.json

## Decisions Made
- **SAM.gov approach**: Direct API (not scraping). 4-phase pipeline to minimize Gemini costs — metadata triage discards ~80-90% before fetching descriptions. (ADR-001)
- **Gemini 2.5 Flash**: Best cost/quality ratio for classification. Sequential calls (no batch API in SDK). ~$5-15 for initial 7K, ~$5-10/month ongoing. (ADR-002)
- **Railway PostgreSQL**: Managed Postgres, simple deployment. Drizzle ORM with `drizzle-kit push` (no migration files). (ADR-003)
- **Classification criteria**: Solo operator focus. GOOD = remote software/IT. MAYBE = larger scope, possible teaming. DISCARD = construction, hardware, on-site, clearance. (ADR-004)
- **Dark-mode-first UI**: Bloomberg Terminal aesthetic. CSS variable tokens, never hardcoded colors. (ADR-005)

## Next Steps
1. **Bulk crawl** — Set `SAM_DRY_RUN=false`, trigger bulk crawl (~18K contracts, ~2 days at 1K calls/day)
2. **Classify** — Run metadata classification, then description fetch + re-classify
3. **Quality check** — Spot-check 10 contracts per classification
4. **Deploy** — Push to Railway, configure n8n daily workflow
5. **Application facilitation** — Build GOOD contract workflow (Phase 9)

## Known Issues
- `updatedAt` columns don't auto-update (need app-level fix or Postgres trigger)
- `NEXT_PUBLIC_INGEST_SECRET` exposed to client (should use server actions)
- DB connection pool `max: 1` (increase for production)
- All 1,008 contracts are PENDING (no Gemini calls made yet)
- `RESEND_API_KEY` and `NEXT_PUBLIC_APP_URL` not set yet
