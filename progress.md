# JCL GovCon — Progress

## Current State

**Phase 11 complete. Batch classification done. Dashboard updated.**

**Branch:** `fix/batch-import-hang`

## Database State (30,037 contracts)

- **118 GOOD** — actionable contracts with full action plans
- **206 MAYBE** — borderline, worth human review
- **2,327 DISCARD** — AI-classified as not feasible
- **~27,384 DISCARD** — pre-filtered (expired, restricted set-asides, goods, construction)
- **1 reclassified** — `d67eb13356c64270b19cb64a00911166` had malformed JSON, re-ran successfully → GOOD

## Completed This Session

1. **Tested document extraction pipeline** — PDF, DOCX, XLSX all extract correctly via SAM.gov download URLs with magic-byte content sniffing
2. **Ran full xAI Batch API classification** on 2,651 PENDING contracts
   - Batch ID: `batch_d990c4d4-da08-432b-a9c7-db5a9690442f`
   - Cost: ~$10-20 (xAI batch, 50% cheaper than real-time)
   - 0 errors except 1 malformed JSON (reclassified individually)
3. **Fixed batch-classify.ts query** — scoped to PENDING only (was querying all 30K)
4. **Replaced PENDING kanban column with UPCOMING DEADLINES**
   - Shows GOOD/MAYBE/DISCARD contracts with future deadlines
   - Sorted: GOODs first → MAYBEs → DISCARDs, then by deadline ASC
   - Classification badge on each card since classifications are mixed
   - Not a drag-drop target (view-only column)
5. **Fixed "Load More" hang** — Railway DB connection timeouts caused stuck loading state; added client-side timeout + page revert on failure

## Decisions Made

- **PENDING → DEADLINES column**: User wanted deadline visibility over pending tracking. PENDING contracts are now zero anyway after batch classification.
- **Query scoped to PENDING only**: Without this fix, batch-classify would re-process all 30K contracts (~$100+ instead of ~$15). Added `AND classification = 'PENDING'` to the WHERE clause.
- **No doc cap per contract**: Considered limiting to 10 docs per contract but ran without cap. Some contracts had 150 docs — worked fine, just slow (~4hrs total for download phase).
- **Client-side fetch timeout (15s)**: Railway proxy can timeout under load. Reverts page number on failure so "Load More" stays clickable.

## Next Steps

1. **Spot-check GOOD/MAYBE quality** — review 10 GOODs and 10 MAYBEs in the dashboard
2. **Deploy to Railway** — all classification done, dashboard updated
3. **Configure n8n daily workflow** (6 AM: ingest → classify → digest)
4. **Set Railway env vars** — `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY`
5. **Verify email digest** delivery
6. **Consider adding `summary` to kanban cards** — stored but not displayed
