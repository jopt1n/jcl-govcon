# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — 17,824 contracts ingested. Prompt rewritten and validated with 1 test classification. Ready for full metadata classification run.

**Branch:** `main` (not pushed)

## What's Working
- SAM.gov bulk ingest: 17,824 contracts (ptype=o,k)
- Tags column: auto-populated (`SBA`: 10,143, `HAS_DOCS`: 5,441)
- Summary column: populated by Gemini during classification
- Improved classification prompt: explicit Can do/Cannot do lists, tightened NAICS exclusions, summary field
- 1 test classification run: NAWCAD drone contract correctly DISCARD'd (was false-positive GOOD before)
- 30 test files, 261 tests, all passing
- Schema pushed to Railway DB (tags + summary columns)

## Completed This Session (2026-03-15)
1. **Tags column** — added `tags: jsonb` to contracts schema, auto-populated by mapper (`SBA` if set-aside, `HAS_DOCS` if resource links)
2. **Tags backfill** — SQL backfill on 17,824 existing contracts (10,143 SBA, 5,441 HAS_DOCS)
3. **Summary column** — added `summary: text` to contracts schema for Gemini's plain-English contract description
4. **Prompt rewrite (metadata)** — explicit Can do/Cannot do capability lists, added NAICS exclusions (541330, 541713/714, 488xxx, 811xxx), tightened GOOD criteria to require explicit software/IT keywords, added summary field to JSON output
5. **Prompt rewrite (full)** — same Can do/Cannot do language and summary field for consistency
6. **Classifier updates** — `parseClassificationResponse` extracts summary, all 3 classifiers (classifier, metadata-classifier, reclassify-with-description) write summary to DB
7. **Validation** — 1 Gemini call on NAWCAD drone contract: old prompt → GOOD (false positive), new prompt → DISCARD (correct)
8. **3 new tests** — mapper tag tests (2), prompt insufficient-info test (1)

## Decisions Made This Session
- **Explicit exclusion lists over vague categories**: Old prompt said "hardware-only", new prompt lists specific exclusions (drones, weapons systems, physical R&D, lab work, etc.). Rationale: Gemini was classifying drone engineering as GOOD because "Reusable Architecture" sounded like software.
- **541330 added to irrelevant NAICS**: Engineering Services is almost always physical/mechanical, not software. Was causing false positives.
- **Summary field**: Added to both prompts and DB. Gives human-readable contract description without reading full SOW. Low cost (1 extra sentence per response).
- **Tags as jsonb array**: Chose `jsonb` over separate boolean columns. Rationale: extensible without schema migrations, supports array operators for filtering.

## Next Steps
1. **Run full metadata classification** — 17,823 remaining PENDING contracts (~$2-5 Gemini cost)
2. **Spot-check results** — Review 10 per category (GOOD/MAYBE/DISCARD) to validate prompt quality
3. **Description fetch** — Fetch full descriptions for GOOD/MAYBE contracts from SAM.gov
4. **Re-classify** — Re-classify with descriptions for better accuracy
5. **Deploy** — Push to Railway, configure n8n daily workflow
6. **Email digest** — Configure Resend, test delivery

## Known Issues
- 1 contract already classified (NAWCAD drone = DISCARD) — remaining 17,823 are PENDING
- Pre-existing lint warnings: ~50 `no-explicit-any` in test files (cosmetic)
- Not pushed to origin (user has not authorized push)
- `RESEND_API_KEY` and `NEXT_PUBLIC_APP_URL` not set yet
