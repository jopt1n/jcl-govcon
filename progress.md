# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — 17,824 contracts ingested. AI switched from Gemini to Grok (xAI). ~120 classified so far. Ready for full metadata classification run.

**Branch:** `main`

## What's Working
- SAM.gov bulk ingest: 17,824 contracts (ptype=o,k)
- AI classification via Grok `grok-4-1-fast-non-reasoning` (1.4s/call)
- Metadata classifier: skips on API error (stays PENDING for retry)
- Tags/summary columns populated during classification
- 30 test files, 259 tests, all passing

## Completed This Session (2026-03-16)
1. **First classification run (100 contracts via Gemini)** — 95 DISCARD, 3 GOOD, 2 MAYBE
2. **Error handling fix** — API errors no longer mark contracts MAYBE; they stay PENDING for retry
3. **Reset 80 error-fallback contracts** back to PENDING
4. **Switched AI to Grok (xAI)** — `openai` SDK, `grok-client.ts`, all 3 classifiers updated
5. **Model: `grok-4-1-fast-non-reasoning`** — 1.4s vs 7.8s reasoning, same accuracy
6. **Validated** — SUAS drone contract: DISCARD with equivalent reasoning to Gemini
7. **Updated all test files** — mocks switched from GoogleGenAI to OpenAI response shape
8. **Utility scripts** — `scripts/classify-100.ts`, `scripts/classify-one-grok.ts`, `scripts/reset-failed-classifications.ts`

## Decisions Made
- **Grok over Gemini**: Free tier = 20 calls/day. xAI has no such limit. Gemini code left for fallback.
- **Non-reasoning model**: 5.5x faster, 37% fewer tokens, same accuracy for triage.
- **Skip-on-error**: API errors leave contracts PENDING (retryable) vs MAYBE (permanent).

## Next Steps
1. **Full metadata classification** — ~17,700 PENDING contracts via Grok
2. **Spot-check** — 10 per category to validate quality
3. **Description fetch** — SAM.gov full descriptions for GOOD/MAYBE
4. **Re-classify with descriptions** — second pass for accuracy
5. **Deploy** — Railway + n8n daily workflow
6. **Email digest** — Resend setup

## Known Issues
- Gemini code still in codebase (unused) — clean up later
- `RESEND_API_KEY` and `NEXT_PUBLIC_APP_URL` not set
- Not pushed to origin
