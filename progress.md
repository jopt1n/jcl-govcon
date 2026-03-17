# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — 17,824 contracts ingested. First batch classification complete (7,898 of 17,824). 9,805 still PENDING.

**Branch:** `main`

## What's Working
- SAM.gov bulk ingest: 17,824 contracts (ptype=o,k,p,r)
- AI classification via Grok `grok-4-1-fast-non-reasoning`
- xAI Batch API scripts: `batch-classify.ts` (submit + poll + import), `import-batch-results.ts` (import only)
- Metadata classifier: 98.6% DISCARD rate on metadata alone
- Tags/summary columns populated during classification
- Dashboard: Kanban board, stats, dark mode, mobile responsive
- 30 test files, 259 tests, all passing

## Completed This Session (2026-03-16)
1. **Built `scripts/batch-classify.ts`** — xAI Batch API for bulk classification (50% cheaper, no rate limits)
2. **Built `scripts/import-batch-results.ts`** — paginated result fetcher with retry logic
3. **First batch run** — 7,898 classified: 16 GOOD, 92 MAYBE, 7,790 DISCARD, 2 errors
4. **Resilience fixes** — AbortSignal.timeout(60s), retry with exponential backoff (5s/15s/45s), 429+5xx handling
5. **CLI args for resume** — `--batch-id`, `--skip`, `--poll-only` flags on batch-classify.ts
6. **Bulk SQL UPDATE** — import script uses `UPDATE FROM VALUES` (18 queries vs 8,697 individual updates)
7. **Removed ClassifyControl** — manual "Classify N Contracts" button from dashboard (batch API replaces it)
8. **Built `scripts/check-classifications.ts`** — quick DB status query

## DB State (after first batch)
| Classification | Count |
|---|---|
| PENDING | 9,805 |
| DISCARD | 7,905 |
| MAYBE | 95 |
| GOOD | 19 |

## Decisions Made
- **xAI Batch API over sequential**: 50% cheaper, no rate limits, handles 10K+ contracts
- **Bulk SQL UPDATE**: Individual Drizzle updates over Railway PG too slow. Raw SQL `UPDATE FROM VALUES` does 500/query
- **Removed ClassifyControl UI**: Manual classify button obsolete — batch scripts handle classification
- **Response path**: `batch_result.response.chat_get_completion.choices[0].message.content` (discovered from actual API)

## Next Steps
1. **Run second batch** — `npx tsx scripts/batch-classify.ts` to classify remaining 9,805 PENDING
2. **Spot-check results** — verify 10 GOOD, 10 MAYBE, 10 DISCARD for quality
3. **Description fetch** — SAM.gov full descriptions for GOOD/MAYBE contracts
4. **Re-classify with descriptions** — second pass with full text for accuracy
5. **Deploy to Railway** — go live
6. **Email digest** — Resend setup for daily notifications

## Known Issues
- Lint warnings (pre-existing): `no-explicit-any` in test files, unused imports in 2 route files
- Gemini code still in codebase (unused) — clean up later
- `RESEND_API_KEY` and `NEXT_PUBLIC_APP_URL` not set
- Not pushed to origin
- xAI API returns 520 errors intermittently — retry logic handles it
