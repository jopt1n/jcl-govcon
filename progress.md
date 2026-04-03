# JCL GovCon — Progress

## Current State
**Phase 9 (Action Plans + Document Intelligence)** — XLSX extraction fixed, document labels added, all 98 action plans generated.

**Branch:** `fix/batch-import-hang` (19+ commits ahead of main)

## What's Working
- SAM.gov bulk ingest: 17,824 contracts
- Round 3 classification: 28 GOOD, 71 MAYBE, 17,725 DISCARD
- **Action plans: 98/98 generated** via xAI Batch API
- **Document viewer v2:** standalone `/viewer` page + proxy with magic-byte sniffing
- **Document text extraction:** PDF, DOCX, **XLSX** (fixed), CSV — all via `extractDocumentText()`
- **XLSX extraction now uses `sheet_to_csv()`** — clean readable output (was garbled UTF-16 with `sheet_to_txt`)
- **Document labels:** contract detail shows actual filenames + file type badges instead of "Document 1"
- Dashboard: Kanban board with action plan section on detail pages
- 30 test files, 263 tests, all passing

## Completed This Session (2026-04-03)

### XLSX Extraction Fix (Root Cause: Files Never Downloaded)
1. **Root cause found:** `ALLOWED_EXTENSIONS` in `documents.ts` excluded `.xlsx/.xls/.csv` — files were filtered before download
2. Added `.xlsx`, `.xls`, `.csv` to `ALLOWED_EXTENSIONS` and their MIME types to `ALLOWED_CONTENT_TYPES`
3. **Switched `sheet_to_txt()` → `sheet_to_csv()`** in `document-text.ts` — `sheet_to_txt` produced UTF-16LE garbage (105K chars of `ÿ þ S   A   A`), `sheet_to_csv` produces clean 36K chars of readable text
4. Added trailing-comma stripping to reduce token waste from empty spreadsheet cells
5. Added sheet name headers (`[Attach B-Specifications]`) for LLM navigation of multi-sheet workbooks
6. **Live-tested on "U.S. Senate Hair Care POS" contract** — extracted all 4 sheets (Pricing Table, 155 Specifications, Delivery Schedule, Past Performance), 83.9% content ratio

### Document Labels (contract-detail.tsx)
7. Added HEAD handler to `/api/documents/proxy` — returns filename from SAM.gov `Content-Disposition` without downloading file body
8. Added `docMeta` state to contract detail — resolves filenames on mount via HEAD requests
9. Documents now show actual names (e.g., "Purchase Order Clauses.pdf") with file type badges (PDF, Excel, Word) instead of "Document 1", "Document 2"

### Architecture Documentation
10. Generated comprehensive frontend architecture reference covering all components, API routes, schema, styling, and data flow

## Decisions Made
- **`sheet_to_csv` over `sheet_to_txt`** — `sheet_to_txt` produces UTF-16LE with BOM markers and null bytes between chars, completely unreadable by LLMs. `sheet_to_csv` produces clean UTF-8 CSV.
- **HEAD handler over full GET** for filename resolution — avoids downloading multi-MB files just to read the filename header
- **Strip trailing commas** from CSV output — spreadsheets have hundreds of empty trailing cells per row, wastes LLM tokens

## Next Steps
1. **Push to remote** and create PR to merge `fix/batch-import-hang` into main
2. **Re-generate action plans** for contracts that had XLSX attachments (now they'll include spreadsheet content)
3. **Visual verify** document labels and XLSX viewer on localhost:3001
4. **Deploy to Railway**
5. **Email digest** — set RESEND_API_KEY, configure n8n daily workflow
6. **Fix broken plugins** — run `/plugin to reinstall` for hookify and ralph-loop
