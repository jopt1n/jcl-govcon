# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — Bulk crawl complete. 17,824 contracts ingested from SAM.gov. All PENDING classification. Ready for Gemini metadata classification.

**Branch:** `main` (not pushed)

## What's Working
- SAM.gov bulk ingest: 17,824 contracts across 19 pages (ptype=o,k)
- Response deadlines backfilled from raw_json (17,820/17,824 have deadlines)
- DB connection pool increased to max=10
- Mapper fixes: empty strings coerced to null (setAsideType, awardCeiling, setAsideCode)
- Mapper fix: `responseDeadLine` field name corrected (was `responseDeadDate`)
- 30 test files, 258 tests, all passing
- Scripts: `bulk-ingest.ts` (with --offset resume, 10s delay, 429 retry), `test-crawl.ts`

## Completed This Session (2026-03-14)
1. **Bulk SAM.gov crawl** — ingested 17,824 contracts (all active solicitations + combined synopsis)
   - First run: 10 pages before hitting per-minute rate limit (7,318 new)
   - Second run with --offset 10000: 9 pages, 8,503 new, zero errors
2. **Mapper bug fixes:**
   - `responseDeadDate` → `responseDeadLine` (field name mismatch with SAM.gov API)
   - Empty string → null coercion for `setAsideType`, `awardCeiling`, `setAsideCode`
3. **Deadline backfill** — populated `response_deadline` for 17,820 contracts from `raw_json`
4. **DB pool increase** — `max: 1` → `max: 10` in `src/lib/db/index.ts`
5. **Bulk ingest script** — `scripts/bulk-ingest.ts` with --offset resume, 10s delay, 429 retry (3 attempts, 60s backoff)

## Decisions Made This Session
- **ptype=o,k only** (not o,k,p,r): Dropped presolicitations and sources sought from crawl. Rationale: not biddable, inflates contract count from 24,907 to 18,503 without adding value. Gemini cost savings.
- **10s delay between API calls**: SAM.gov has undocumented per-minute throttle (hit 429 after 10 rapid calls). 2s was too aggressive. 10s works reliably.
- **Batch INSERT per page**: Single INSERT for 1000 rows with onConflictDoNothing, fallback to row-by-row if batch fails. Much faster than individual inserts.
- **SQL backfill over app-level loop**: Used single `UPDATE ... SET ... FROM raw_json` query instead of iterating 17K rows in JS. Correct approach for bulk data fixes.

## Next Steps
1. **Metadata classification** — Run Gemini 2.5 Flash on 17,824 PENDING contracts (~$2-5 cost)
2. **Description fetch** — Fetch full descriptions for GOOD/MAYBE contracts
3. **Re-classify** — Re-classify with descriptions for better accuracy
4. **Quality check** — Spot-check 10 per category (GOOD/MAYBE/DISCARD)
5. **Deploy** — Push to Railway, configure n8n daily workflow, set env vars
6. **Email digest** — Configure Resend, test delivery

## Known Issues
- `updatedAt` columns don't auto-update (need app-level fix or Postgres trigger)
- All 17,824 contracts are PENDING (no Gemini calls made yet)
- `RESEND_API_KEY` and `NEXT_PUBLIC_APP_URL` not set yet
- Pre-existing lint warnings: ~50 `no-explicit-any` in test files (cosmetic)
- Not pushed to origin (user has not authorized push)
- 4 contracts have no response_deadline (no deadline in SAM.gov raw data)
