# CLAUDE.md — JCL GovCon

## What This Is
Government contract pipeline for JCL Solutions LLC. Crawls SAM.gov, classifies contracts via Gemini 2.5 Flash AI (GOOD/MAYBE/DISCARD), presents in Kanban board for review. Mostly complete — core pipeline works, remaining work is application facilitation and go-live.

## Tech Stack
- **Framework**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Database**: PostgreSQL on Railway, Drizzle ORM (`drizzle-kit push` for schema)
- **AI**: Gemini 2.5 Flash via `@google/genai` SDK
- **UI**: @dnd-kit (drag-drop Kanban), Recharts, lucide-react, Resend (email)
- **Deploy**: Railway (nixpacks), n8n for workflow automation

## Commands
```bash
npm run dev          # Dev server (localhost:3001, NOT 3000)
npm run test:run     # Run all tests (30 files, 258 tests)
npx tsc --noEmit     # Type check only (use instead of npm run build for cleanup)
npm run build        # Full build (only when explicitly asked)
npm run lint         # ESLint
```

## Architecture
```
SAM.gov API → metadata crawl → metadata classification (Gemini) → ~80% DISCARD
                                    ↓ remaining GOOD/MAYBE
                          fetch full descriptions → re-classify with descriptions
                                    ↓
                          Dashboard Kanban → manual review → application
```

## Critical Rules
- **NEVER make external API calls** (SAM.gov, Gemini, Resend) unless user explicitly says to. Costs money, has rate limits.
- **NEVER run `npm run build`** during cleanup — use `npx tsc --noEmit` for type checking.
- **Always use CSS variable tokens** (`var(--surface)`, `var(--text-primary)`, etc.) — never hardcode `bg-white`, `text-gray-*`.
- Dev server: `localhost:3001` (port 3000 often occupied).
- Database schema changes: `drizzle-kit push` (no migration files).

## API Keys & Environment
When user provides an API key, **immediately add it to `.env`**. Current variables: `SAM_GOV_API_KEY`, `GOOGLE_GEMINI_API_KEY`, `RAILWAY_TOKEN`, `DATABASE_URL`, `INGEST_SECRET`, `RESEND_API_KEY`, `NEXT_PUBLIC_INGEST_SECRET`, `NEXT_PUBLIC_APP_URL`, `SAM_DRY_RUN`, `SAM_DAILY_LIMIT`.

## UI Design System
Dark-mode-first (Bloomberg Terminal meets Linear.app). CSS variable tokens in `globals.css` with `:root` (light) and `.dark` class. Classification colors: green=GOOD, amber=MAYBE, slate=DISCARD, blue=PENDING, red=urgent. Mobile: hamburger sidebar (<md). Kanban cards: 3px classification border + urgency badges.

## Key Files
- **Schema**: `src/lib/db/schema.ts` (5 tables, 4 enums)
- **SAM.gov client**: `src/lib/sam-gov/client.ts`, `bulk-crawl.ts`, `mappers.ts`
- **AI classification**: `src/lib/ai/classifier.ts`, `metadata-classifier.ts`, `prompts.ts`
- **Dashboard**: `src/components/kanban/board.tsx`, `src/app/page.tsx`
- **API routes**: `src/app/api/` (contracts, classify, crawl, ingest, settings, digest, analytics)

## SAM.gov API Notes
- Rate limit: 1,000 search calls/day (resets midnight UTC). `SAM_DRY_RUN=true` prevents real calls.
- `postedFrom`/`postedTo` params are REQUIRED. Max 6-month date range.
- `ptype=o,k,p,r` = Solicitation + Combined + Presolicitation + Sources Sought.

## Verification Protocol
Before marking any task complete:
1. `npx tsc --noEmit` — zero type errors
2. `npm run test:run` — all 258+ tests pass
3. `npm run lint` — no lint errors
4. Visual check if UI changed (dev server on 3001)
