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

- [x] 51 test files, 454 tests, all passing
- [x] Vitest with proxy-based Drizzle mock pattern
- [x] Full coverage: API routes, components, lib functions

---

## Phase 8: Go Live — COMPLETE (2026-04-16)

- [x] Fix NEXT_PUBLIC_INGEST_SECRET — moved to server-only env var
- [x] Set `SAM_DRY_RUN=false` and run bulk metadata crawl (35,667 contracts ingested)
- [x] Run metadata classification (Grok xAI Batch API)
- [x] Run selective description fetch for GOOD/MAYBE (1,014 fetched)
- [x] Run re-classification with descriptions
- [x] Deploy to Railway web service (`jcl-govcon-web`)
- [x] Configure weekly cron workflow (initial target Mon 15:00 UTC; current local cron config/docs target Fri 15:00 UTC: crawl → batch → digest)
- [x] Verify Telegram digest delivery (replaced email digest per user)

## Phase 8.5: Dashboard UX — COMPLETE (2026-04-17)

- [x] Kanban filter chips (Notice / Posted / Set-aside) with URL-persisted state
- [x] Shared `RESTRICTED_SET_ASIDE_PREFIXES` for "qualifying only" filter
- [x] Remove all-zero DashboardStats summary row

## Phase 8.6: CHOSEN tier — COMPLETE (2026-04-20)

User-driven promotion above AI's GOOD classification. Full spec: `docs/plans/chosen-tier.md`. Shipped as PR #2 (merge commit `fcfcea0`).

- [x] Commit 1: schema (promoted + promotedAt + audit_log table + partial index) + plan doc + E2E TODO
- [x] Commit 2: API (PATCH promoted with atomic audit transaction + COALESCE, GET ?promoted= filter with 400 validation)
- [x] Commit 3: styling (gold CSS tokens + Kanban card state-exclusive border + contract-detail Promote button/pill/top-accent) + codebase-wide Tailwind alpha-token fix
- [x] Commit 4: /inbox inline ★ Promote button + `removeFromInbox` closure-based helper
- [x] Commit 5: /chosen page (flat list sorted by promotedAt DESC, Load more 50/page, empty/error/loaded states, Demote per card) + sidebar `useNavCounts` (Promise.allSettled) + Chosen nav item with Star + gold badge
- [x] `/qa`, `/ship` as PR #2, merged to main

## Phase 8.7: Cron service architecture fix — CODE MERGED, Railway provisioning pending (2026-04-21)

Sedgewick shipped with `[[cron]]` blocks that aren't valid Railway schema; Railway silently ignored them and the weekly pipeline had not run since 2026-04-16. Three-service Railway topology replaced the dead config in code. Remaining work is Railway dashboard follow-through. Current local cron config/docs point to Friday 15:00 UTC (`0 15 * * 5`), but live Railway state still needs fresh confirmation. Full spec: `docs/plans/cron-services.md`.

- [x] Three-service Railway topology: `jcl-govcon-web` (always-on) + `jcl-govcon-weekly-crawl` (current local config `0 15 * * 5`, Fri 15:00 UTC) + `jcl-govcon-check-batches` (every 30 min). See `docs/deployment-railway.md`.
- [x] Dockerfile (alpine+curl) + two JSON configs + railway.toml cleanup + deployment doc + reusable infra-review-checklist.
- [x] `/review` + `/ship` via PR #3 merge (`f42f046`)
- [ ] Post-merge: connect `jcl-govcon-web` to GitHub in Railway dashboard
- [ ] Post-merge: provision both cron services in Railway dashboard (`INGEST_SECRET` + `WEB_BASE_URL` as reference vars)
- [ ] Verify first scheduled fire — smoke-trigger check-batches immediately after provisioning, then confirm the next live weekly-crawl schedule in Railway (local config/docs currently imply Friday 2026-04-24 15:00 UTC)

## Phase 8.8: Dashboard triage workflow polish — IN PROGRESS on `main` local worktree (2026-04-22)

- [x] `/archive` page + API filters for archived / expired / includeArchived / includeExpired contract views
- [x] Main dashboard excludes promoted contracts so they live on `/chosen`
- [x] Main dashboard excludes watched contracts so they live on `/watch`
- [x] Dashboard Kanban cards support inline Archive action
- [x] Chosen cards render analyst summary previews from saved notes
- [x] Dashboard cards show the full "What This Contract Is" description instead of truncated AI reasoning

## Phase 9: Application Facilitation & GoHighLevel Pipeline — NOT STARTED

- [ ] Define the first GoHighLevel pipeline experiment for watched / chosen contracts
- [ ] Decide source-of-truth boundaries between this app and GoHighLevel
- [ ] Map contract/application stages into a GoHighLevel-friendly pipeline model
- [x] Add concrete GoHighLevel implementation tasks to `TODOS.md`
- [ ] "Good" contract application workflow (status tracking: IDENTIFIED → PURSUING → BID_SUBMITTED → WON/LOST)
- [ ] Application checklist/requirements per contract
- [ ] Document preparation assistance (capability statements, past performance)
- [ ] Deadline tracking with notifications
- [ ] Teaming partner identification for MAYBE contracts

## Phase 10: Refinements — BACKLOG

- [ ] Presol → Solicitation merge strategy (needs `solicitationNumber` stability check)
- [ ] `api_usage` purge cron (P2, trivial addition to check-batches or separate cron)
- [ ] Internal Railway DATABASE_URL for lower latency (~1ms vs 20-50ms public proxy)
- [ ] Chip row `overflow-x-auto` on narrow screens if wrapping feels messy
- [ ] "This week" chip empty-state → affordance to /inbox for unreviewed
- [ ] Inbox filter chips (parallel to Kanban, for triage)
- [ ] NAICS code filtering in SAM.gov queries
- [ ] Fix `updatedAt` auto-update (app-level or Postgres trigger)
- [x] Replace `NEXT_PUBLIC_INGEST_SECRET` with server-side proxy
- [ ] Clickable document links in contract detail
- [ ] DOCX text extraction for classification (currently PDF-only)
- [ ] React `act()` warnings in KanbanBoard tests (cosmetic)
- [ ] Next.js 14 → 15 upgrade
- [ ] Consider turbopuffer for semantic search
- [ ] Explore self-hosted LLM for document analysis at scale

## Later (deprioritized)

- [ ] Configure n8n daily workflow — superseded by Railway cron on Next.js routes
- [ ] Email digest via Resend — superseded by Telegram digest
