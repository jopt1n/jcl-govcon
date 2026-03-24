# JCL GovCon — Progress

## Current State
**Phase 8 (Go Live)** — Round 3 complete (17,824 classified). Document viewer built. Needs deploy + automation.

**Branch:** `fix/batch-import-hang` (12 commits ahead of main, not yet merged)

## What's Working
- SAM.gov bulk ingest: 17,824 contracts
- Round 3 classification: 28 GOOD, 71 MAYBE, 17,725 DISCARD, 0 PENDING
- Batch import: bulk DB updates, auto-retry, pagination resume, --import-batch-id
- Document viewer: PDF inline via Brave's viewer, DOCX→HTML via srcdoc
- Dashboard: Kanban board, stats, dark mode, mobile responsive
- 30 test files, 263 tests, all passing

## Completed This Session (2026-03-21 → 2026-03-24)

### Batch Import Fix
1. **Committed Round 3 pipeline** — sole-source/expired DISCARD rules, responseDeadline
2. **Fixed batch import hang** — root cause: 17,824 individual DB UPDATEs over remote Postgres
   - Bulk UPDATE via `UPDATE ... FROM (VALUES ...)` in 500-row chunks (35 queries vs 17,824)
   - Progress logging on every page fetch
   - `--import-batch-id` flag for retrying just the import step
   - Auto-retry: 5 attempts with 30s delay, per-chunk retry with backoff
   - Pagination resume: retries skip already-imported pages
   - Batch ID saved to `scripts/last-batch-id.txt` immediately after creation
3. **Ran full Round 3 batch** — 17,824 contracts classified successfully
4. **Verified DB** — all contracts at round 3, 0 PENDING, AI reasoning references description content

### Document Viewer
5. **Built document proxy** (`/api/documents/proxy`) — fetches SAM.gov docs with API key
6. **Built document viewer modal** — loading spinner, error+retry, close/cleanup
7. **Root cause of download dialogs found:** SAM.gov returns `Content-Type: application/octet-stream` for ALL files (PDFs, DOCX, everything). Previous fixes (blob URLs, Content-Disposition, srcdoc) were treating symptoms.
8. **Fixed:** Proxy detects real MIME type from filename in Content-Disposition header (.pdf→application/pdf, .docx→mammoth HTML conversion)
9. **DOCX rendering:** proxy converts to HTML via mammoth, returns JSON `{html}`, client uses `<iframe srcdoc={html}>` — no blob URL, no MIME confusion
10. **PDF rendering:** client creates `new Blob([buffer], {type: "application/pdf"})` with explicit MIME, browser renders inline

### Findings
- **xAI batch did NOT include document text** — `batch-classify.ts` passes `documentTexts: []`. Only `descriptionText` (SAM.gov synopsis) included. Deferred fix: add `document_texts` column, persist in deep-scan, pass in batch-classify.

## Decisions Made
- **Blob URL + srcdoc over react-pdf** — react-pdf adds ~500KB for canvas rendering. Since we're on Brave (Chromium), explicit MIME blob URLs work. react-pdf deferred as fallback if needed.
- **MIME detection from filename over trusting SAM.gov Content-Type** — SAM.gov always sends `application/octet-stream`, so we parse the filename from Content-Disposition and map extensions to MIME types.
- **JSON response for DOCX over streaming HTML** — proxy returns `{html, filename}` for DOCX so client can use `srcdoc` attribute directly.

## Next Steps
1. **Test document viewer in Brave** — verify PDFs render inline, DOCX renders as HTML
2. **Merge branch to main** — 12 commits, all tests passing
3. **Deploy to Railway** — go live with dashboard
4. **Email digest** — set RESEND_API_KEY and NEXT_PUBLIC_APP_URL
5. **Configure n8n daily workflow** — 6 AM: ingest → classify → digest
6. **Review 99 contracts** — 28 GOOD + 71 MAYBE in dashboard
