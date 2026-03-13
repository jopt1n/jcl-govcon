# JCL GovCon — Implementation Plan

## System Overview
Automated government contract pipeline: SAM.gov → PostgreSQL → Gemini AI classification → Kanban dashboard → manual review → application facilitation. Built for JCL Solutions LLC (solo operator + AI tools, software/IT/AI/cloud capabilities).

---

## Phase 1: Foundation & Data Pipeline
- [x] Next.js 14 project with TypeScript, Tailwind, App Router
- [x] Drizzle ORM schema (5 tables, 4 enums) + Railway PostgreSQL
- [x] SAM.gov API client (`searchOpportunities`, `fetchDescription`)
- [x] Bulk crawl with pagination, pause/resume, rate limiting (900/day headroom)
- [x] Daily ingest endpoint (yesterday-today window)
- [x] Contract mapper (SAM.gov response → DB schema)
- [x] DRY_RUN safety mode + `canMakeCall()` rate limit guard
- [x] Error resilience (skip bad rows, try/catch per contract)
- [x] 1,008 contracts ingested from initial crawl

## Phase 2: AI Classification
- [x] Gemini 2.5 Flash integration via `@google/genai` SDK
- [x] Classification prompt with JCL capability profile
- [x] Metadata-only triage classifier (~80-90% DISCARD without descriptions)
- [x] Full classifier (metadata + description text)
- [x] Batch classification (50/chunk, rate-limited)
- [x] Re-classification with full descriptions (tracks upgrades/downgrades)
- [x] Conservative strategy: "when in doubt, classify as MAYBE"

## Phase 3: Dashboard & UI
- [x] Collapsible sidebar with nav (Dashboard, Analytics, Import, Settings)
- [x] Kanban board with GOOD/MAYBE/DISCARD/PENDING columns
- [x] Drag-and-drop reclassification (@dnd-kit, optimistic updates)
- [x] Contract detail page (metadata, AI reasoning, notes, status)
- [x] Search + agency/noticeType filters
- [x] Server-side pagination (50/page, load more per column)
- [x] Crawl status widget with pipeline controls
- [x] Dark-mode-first design system (CSS variable tokens, Bloomberg aesthetic)
- [x] Mobile responsive (hamburger sidebar, responsive padding)
- [x] Dashboard stats cards (Total, Good Fit, Pending, Urgent)
- [x] Skeleton loading + empty states

## Phase 4: Analytics & Reporting
- [x] Analytics API (5 parallel aggregation queries)
- [x] Classification donut chart
- [x] Weekly contract additions line chart
- [x] Top 10 agencies bar chart
- [x] Upcoming deadlines chart
- [x] Override rate tracking

## Phase 5: Settings & Integration
- [x] Settings page (company profile, email config, ingest triggers)
- [x] CSV import with drag-drop, preview, column mapping
- [x] Email digest via Resend (GOOD contracts + top 5 MAYBE)
- [x] n8n webhook compatibility (same URL/auth/body contract)
- [x] Bearer auth on all pipeline API routes

## Phase 6: Pipeline Optimization (Refactor)
- [x] 4-step pipeline: crawl → metadata classify → fetch descriptions → re-classify
- [x] Selective description fetch (only GOOD/MAYBE, saves ~90% API calls)
- [x] Daily pipeline wiring (full 4 steps in single trigger)
- [x] Pipeline controls in dashboard (4 buttons + API budget bar)
- [x] Expanded notice types (ptype=o,k,p,r)

## Phase 7: Test Suite
- [x] 30 test files, 258 tests, all passing (~1.5s)
- [x] Vitest with proxy-based Drizzle mock pattern
- [x] Full coverage: API routes, components, lib functions

---

## Phase 8: Go Live — IN PROGRESS
- [ ] Set `SAM_DRY_RUN=false` and run bulk metadata crawl (~18K contracts, ~2 days)
- [ ] Run metadata classification (~$2-5 Gemini cost)
- [ ] Run selective description fetch for GOOD/MAYBE (~500-2K contracts)
- [ ] Run re-classification with descriptions
- [ ] Spot-check quality: 10 GOOD, 10 MAYBE, 10 DISCARD
- [ ] Deploy to Railway
- [ ] Configure n8n daily workflow (6 AM: ingest → classify → digest)
- [ ] Set `NEXT_PUBLIC_APP_URL` and `RESEND_API_KEY` in Railway env
- [ ] Verify email digest delivery

## Phase 9: Application Facilitation — NOT STARTED
- [ ] "Good" contract application workflow (status tracking: IDENTIFIED → PURSUING → BID_SUBMITTED → WON/LOST)
- [ ] Application checklist/requirements per contract
- [ ] Document preparation assistance (capability statements, past performance)
- [ ] Deadline tracking with notifications
- [ ] Teaming partner identification for MAYBE contracts

## Phase 10: Refinements — BACKLOG
- [ ] NAICS code filtering in SAM.gov queries (reduce irrelevant contracts pre-classification)
- [ ] Increase DB connection pool (max: 1 → 5-10 for Railway)
- [ ] Fix `updatedAt` auto-update (app-level or Postgres trigger)
- [ ] Replace `NEXT_PUBLIC_INGEST_SECRET` with server actions
- [ ] Clickable document links in contract detail
- [ ] DOCX text extraction for classification (currently PDF-only)
- [ ] Consider Gemini batch API when SDK supports it
- [ ] React `act()` warnings in KanbanBoard tests (cosmetic)
