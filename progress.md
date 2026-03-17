# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — 17,824 contracts ingested. Metadata classification complete. Deep scan script ready for Round 2.

**Branch:** `main`

## What's Working
- SAM.gov bulk ingest: 17,824 contracts (ptype=o,k,p,r)
- AI classification via Grok `grok-4-1-fast-non-reasoning`
- xAI Batch API scripts: `batch-classify.ts`, `import-batch-results.ts`
- Metadata classifier: 98.6% DISCARD rate on metadata alone
- **Deep scan script** (`scripts/deep-scan.ts`): Round 2 classification with full descriptions + PDF text extraction
- Dashboard: Kanban board, stats, dark mode, mobile responsive
- 30 test files, 259 tests, all passing

## Completed This Session (2026-03-16)
1. **Built `scripts/deep-scan.ts`** — Round 2 classifier for GOOD/MAYBE contracts
   - Fetches full descriptions from SAM.gov (uses cached if already fetched)
   - Downloads PDFs via `downloadDocuments()`, extracts text via `pdf-parse` (PDFParse class API)
   - Skips scanned-image PDFs (empty text) and non-PDF docs (DOCX/DOC)
   - Caps total document text at 50K chars
   - Grok classification with 3-attempt retry (2s/6s/18s backoff)
   - Bulk SQL update in 500-row chunks with `__SKIP__` sentinel for unfetched descriptions
   - CLI: `--dry-run`, `--limit N`, `--skip N`
2. **Added `pdf-parse` dependency** to package.json

## Decisions Made
- **pdf-parse v2 class API**: Uses `new PDFParse({ data })` + `getText()` (not default export — v2 breaking change)
- **50K char doc cap**: Prevents Grok context overflow while still capturing key document content
- **`__SKIP__` sentinel in bulk SQL**: Preserves existing `description_text` when fetch failed, avoids NULLing good data
- **Sequential processing**: One contract at a time (not batch API) because each needs SAM.gov fetch + doc download + PDF parse

## Next Steps
1. **Run deep scan dry run** — `npx tsx --import ./scripts/load-env.ts scripts/deep-scan.ts --dry-run --limit 5`
2. **Review dry run output** — check `scripts/deep-scan-dry-run.json` for quality
3. **Run full deep scan** — classify all 254 GOOD/MAYBE contracts with descriptions + docs
4. **Spot-check results** — verify classification quality after Round 2
5. **Deploy to Railway** — go live
6. **Email digest** — Resend setup for daily notifications

## Known Issues
- Lint warnings (pre-existing): `no-explicit-any` in test files, unused imports in 2 route files
- Gemini code still in codebase (unused) — clean up later
- `RESEND_API_KEY` and `NEXT_PUBLIC_APP_URL` not set
- Not pushed to origin (8 commits ahead)
- xAI API returns 520 errors intermittently — retry logic handles it
