# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — Round 2 deep scan complete. 58 GOOD/MAYBE contracts remain. Descriptions not yet fetched (SAM.gov rate-limited until Mar 19 midnight UTC).

**Branch:** `main`

## What's Working
- SAM.gov bulk ingest: 17,824 contracts (ptype=o,k,p,r)
- AI classification via Grok `grok-4-1-fast-non-reasoning`
- Round 1 metadata classification: 98.6% DISCARD rate
- Round 2 deep scan: 254 → 58 (28 GOOD, 30 MAYBE) with PDF doc analysis
- Document downloading from SAM.gov (octet-stream handled)
- Dashboard: Kanban board, stats, dark mode, mobile responsive
- 30 test files, 259 tests, all passing

## Completed This Session (2026-03-18)
1. **Fixed deep-scan `--dry-run`** — was skipping description fetches and doc downloads
   - Added `delete process.env.SAM_DRY_RUN` at top of script (overrides env var)
   - `--dry-run` now only skips the final bulk DB update
2. **Fixed SAM.gov document downloading** — 3 bugs found and fixed:
   - `filterDownloadableLinks()`: SAM.gov URLs end in `/download` not `.pdf` — added pattern match for SAM.gov API URLs
   - `downloadOne()`: SAM.gov serves files as `application/octet-stream` — accepted for SAM.gov URLs
   - `deep-scan.ts` PDF check: tried PDF parsing on `octet-stream` files too
3. **Ran full deep scan** — all 254 GOOD/MAYBE contracts classified with documents
   - Results: 28 GOOD, 30 MAYBE, 196 DISCARD
   - 16 upgraded MAYBE→GOOD, 167 eliminated MAYBE→DISCARD
   - 890K tokens (~$2-3 on Grok)
   - All 254 rows updated in DB (classification_round=2)
4. **Added debug logging** to deep-scan for document download visibility

## Decisions Made
- **Override SAM_DRY_RUN in deep-scan**: Script has its own `--dry-run` semantics. `SAM_DRY_RUN=true` in .env is for the web app pipeline, not scripts.
- **Accept octet-stream for SAM.gov URLs**: SAM.gov doesn't set proper content types. Pattern-match on URL path instead of relying on content-type headers.
- **Try PDF parse on all octet-stream**: Many SAM.gov files are PDFs served as octet-stream. Gracefully skip non-PDFs.

## Next Steps
1. **Fetch descriptions for 58 GOOD/MAYBE** — SAM.gov rate limit resets Mar 19 midnight UTC. Run deep-scan again (or a targeted description-fetch script) to get actual description text.
2. **Re-run deep scan on 58** with descriptions — will improve classification quality
3. **Spot-check results** — review 10 GOOD, 10 MAYBE, 10 DISCARD for quality
4. **Deploy to Railway** — go live
5. **Email digest** — set `RESEND_API_KEY` and `NEXT_PUBLIC_APP_URL`
6. **Configure n8n daily workflow** — 6 AM: ingest → classify → digest

## Known Issues
- Lint warnings (pre-existing): `no-explicit-any` in test files, unused imports in 2 route files
- 0/58 GOOD/MAYBE contracts have descriptions (SAM.gov 429 during full scan)
- Gemini code still in codebase (unused) — clean up later
- Not pushed to origin
- Some SAM.gov docs are DOCX/DOC served as octet-stream — PDF parse skips them gracefully
- `scripts/debug-prompts/` and `scripts/deep-scan-dry-run.json` are untracked artifacts
