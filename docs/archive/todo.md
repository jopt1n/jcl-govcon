# JCL GovCon - Task Tracker

## Completed
- [x] Phase 1-6: Full test suite (originally 25 files, 196 tests; now 30 files, 258 tests after refactors)
- [x] Fix board.tsx crash when DB unavailable
- [x] Research turbopuffer vs Railway Postgres
- [x] Set up Railway Postgres (project "dynamic-spontaneity", schema pushed)
- [x] Initial SAM.gov ingest — 1,008 contracts from today's postings
- [x] Add PENDING column to Kanban board (blue, browseable)
- [x] Add cowboy hat favicon (🤠)
- [x] Add error resilience to ingest (skip bad rows instead of crashing)
- [x] Fix bulk-crawl to include required `postedFrom`/`postedTo` params
- [x] Set `NEXT_PUBLIC_INGEST_SECRET` in .env

## Refactor Phases 1-5: COMPLETE

### Phase 1: Safety Guardrails + Schema + Mapper
- [x] DRY_RUN mode + canMakeCall() in SAM.gov client
- [x] 10 new columns added to contracts schema
- [x] Mapper + types updated, backfill script run

### Phase 2: Metadata-Only Bulk Crawl
- [x] Decoupled crawl from classification, DRY_RUN, UPSERT, ptype=o,k,p,r

### Phase 3: Metadata-Only Classification
- [x] Conservative metadata triage prompt, classifyFromMetadata(), /api/classify/metadata route

### Phase 4: Selective Description Fetch + Re-Classification
- [x] fetch-descriptions.ts, reclassify-with-description.ts, API routes, crawl-status.tsx pipeline controls

### Phase 5: Daily Sync + Final Wiring
- [x] Daily ingest trigger now runs full 4-step pipeline: ingest → classify → fetch descriptions → re-classify
- [x] Updated ptype from "o,k" to "o,k,p,r" to match bulk crawl
- [x] Fixed `/api/ingest/manual` proxy — replaced `req.nextUrl.origin` with `process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'`
- [x] Fixed pre-existing type error in bulk mode response (removed non-existent `docsQueued` field)
- [x] n8n compatibility verified — same URL/auth/body contract, richer response shape
- [x] 30 files, 258 tests, all passing. Zero type errors. Zero external API calls.

## Next: Execution Plan (Live Pipeline Run)

### Step 1: Bulk Metadata Crawl
- [ ] Set `SAM_DRY_RUN=false` in .env
- [ ] Trigger bulk crawl via dashboard or `POST /api/crawl/start`
- [ ] Monitor at `GET /api/crawl/status` — expect ~18K contracts across ~19 API pages
- [ ] Rate limit: 1,000 search calls/day — may need 2 days to complete

### Step 2: Metadata Classification
- [ ] Trigger via dashboard "Classify Meta" button or `POST /api/classify/metadata`
- [ ] Expect ~80-90% DISCARD from metadata alone
- [ ] Monitor progress — chunks of 50 with 300ms delays
- [ ] Cost: ~$2-5 for 18K contracts via Gemini Flash

### Step 3: Selective Description Fetch
- [ ] Trigger via dashboard "Fetch Descriptions" button or `POST /api/fetch-descriptions`
- [ ] Only fetches for GOOD/MAYBE contracts (~500-2,000 expected)
- [ ] Uses SAM.gov doc_fetches budget (separate from search_calls)

### Step 4: Re-Classify with Descriptions
- [ ] Trigger via dashboard "Re-classify" button or `POST /api/reclassify`
- [ ] Re-classifies GOOD/MAYBE using full metadata + description
- [ ] Tracks upgrades/downgrades for quality assessment

### Step 5: Verify + Go Live
- [ ] Review classification quality on dashboard Kanban board
- [ ] Spot-check 10 GOOD, 10 MAYBE, 10 DISCARD contracts
- [ ] Configure n8n daily workflow: `POST /api/ingest/trigger { "mode": "daily" }` at 6 AM
- [ ] Set up email digest: `POST /api/digest` after daily ingest
- [ ] Set `NEXT_PUBLIC_APP_URL` in Railway env vars
- [ ] Deploy to Railway

## Backlog
- [ ] Consider turbopuffer for semantic search (future enhancement)
- [ ] Address React `act()` warnings in KanbanBoard tests (cosmetic, non-blocking)
- [ ] Make document links clickable/viewable in contract detail page
- [ ] Explore self-hosted LLM (Kimi K2.5 on Hetzner) for document analysis at scale
- [ ] `updatedAt` not auto-updating — needs app-level fix or Postgres trigger
- [ ] `NEXT_PUBLIC_INGEST_SECRET` exposed to client — consider server actions
- [ ] Add NAICS code filtering to SAM.gov queries to reduce irrelevant contracts pre-classification
