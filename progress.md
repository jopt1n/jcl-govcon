# JCL GovCon — Progress

## Current State
**Phase 9 (Action Plans + Document Intelligence)** — Document proxy fix complete, all 98 action plans generated.

**Branch:** `fix/batch-import-hang` (20+ commits ahead of main)

## What's Working
- SAM.gov bulk ingest: 17,824 contracts
- Round 3 classification: 28 GOOD, 71 MAYBE, 17,725 DISCARD
- **Action plans: 98/98 generated** via xAI Batch API
- **Document viewer v2:** standalone `/viewer` page + proxy with magic-byte sniffing
- **Document proxy fixed:** inline viewing now works (PDF, DOCX, XLSX all display correctly)
- **Document text extraction:** PDF, DOCX, XLSX, CSV — all via `extractDocumentText()`
- **Document labels:** contract detail shows actual filenames + file type badges
- Dashboard: Kanban board with action plan section on detail pages
- 30 test files, 263 tests, all passing

## Completed This Session (2026-04-03)

### Document Proxy Fix (Root Cause: SAM.gov 303 Redirect + S3 Signed URL Expiry)
1. **Root cause:** SAM.gov returns 303 redirect to S3 with **9-second signed URL expiry**. `fetch()` auto-followed redirect, losing SAM.gov's original Content-Type and Content-Disposition headers. S3 often returned `application/xml` (expired signature error) or `application/octet-stream`, causing browser to download instead of display inline.
2. **Fix:** Added `fetchFromSam()` helper using `redirect: "manual"` to capture SAM.gov headers before following S3 redirect separately
3. **Added magic-byte sniffing** (via `sniffContentType()`) as fallback for MIME detection — handles UUID filenames with no extension
4. **Buffered response** instead of streaming — enables magic-byte sniffing and consistent Content-Length
5. **HEAD handler** also updated to use `redirect: "manual"` for consistent filename resolution
6. **Verified:** Both PDF and XLSX documents return correct Content-Type and `Content-Disposition: inline`

## Decisions Made
- **`redirect: "manual"` over auto-follow** — SAM.gov's 303 response has correct headers (Content-Type, Content-Disposition with filename), but S3's response loses them. Manual redirect preserves this metadata.
- **Buffer over streaming** — Streaming is faster but can't sniff magic bytes. Since documents are typically <10MB, buffering is acceptable for inline viewing.
- **Kept both proxy endpoints** — `/api/documents/proxy` (newer, used by contract-detail) and `/api/proxy-document` (older, used by standalone viewer). Both now work correctly but via different approaches.

## Pre-existing Issues (not from this session)
- TS error in `unified-prompts.ts:301` — duplicate export of `UnifiedClassificationInput`
- Lint errors: unused `techStackIcons` in contract-detail.tsx, unused `inArray` in digest.ts

## Next Steps
1. **Push to remote** and create PR to merge `fix/batch-import-hang` into main
2. **Re-generate action plans** for contracts that had XLSX attachments (now they'll include spreadsheet content)
3. **Visual verify** document viewer on localhost:3001 — test PDF, XLSX, DOCX inline viewing
4. **Deploy to Railway**
5. **Email digest** — set RESEND_API_KEY, configure n8n daily workflow
6. **Fix pre-existing issues** — unified-prompts.ts duplicate export, unused vars
