#!/usr/bin/env bash
#
# End-to-end smoke test for the weekly pipeline (cron routes + export).
# Starts the dev server with SAM_DRY_RUN=true, curls both cron routes,
# asserts terminal states, and verifies the export route.
#
# Not run in CI — too heavy — but required before merge. Catches
# integration bugs the Proxy-mocked unit tests cannot see.
#
# Prerequisites:
#   - INGEST_SECRET set in the current shell (or .env)
#   - Dev dependencies installed (npm ci / npm install)
#
# Usage:
#   bash scripts/smoke-weekly-pipeline.sh
#
set -euo pipefail

if [ -z "${INGEST_SECRET:-}" ]; then
  # Try pulling from .env as a convenience.
  if [ -f .env ]; then
    # shellcheck disable=SC1091
    INGEST_SECRET=$(grep -E '^INGEST_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '"')
  fi
fi
if [ -z "${INGEST_SECRET:-}" ]; then
  echo "ERROR: INGEST_SECRET not set. Export it or add it to .env." >&2
  exit 1
fi

# ── 1. Start dev server in background with dry-run env ──────────────
SAM_DRY_RUN=true npm run dev >/tmp/smoke-dev.log 2>&1 &
DEV_PID=$!
trap "kill $DEV_PID 2>/dev/null || true" EXIT

# Wait for dev server on :3001 (poll, not sleep). 30s timeout.
echo "waiting for dev server on :3001..."
READY=0
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3001/ >/dev/null 2>&1; then
    echo "dev server ready after ${i}s"
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "dev server did not start within 30s" >&2
  echo "--- /tmp/smoke-dev.log (tail) ---" >&2
  tail -40 /tmp/smoke-dev.log >&2 || true
  exit 1
fi

# ── 2. Weekly crawl → expect 200 + classifying or succeeded ─────────
echo "POST /api/cron/weekly-crawl..."
curl -fsS -X POST http://localhost:3001/api/cron/weekly-crawl \
  -H "Authorization: Bearer $INGEST_SECRET" \
  | jq -e '.status == "classifying" or .status == "succeeded" or .skipped == "another weekly-crawl in progress"' \
  >/dev/null
echo "  ✓ weekly-crawl terminal state reached"

# ── 3. check-batches → expect 200 + ok:true ─────────────────────────
echo "POST /api/cron/check-batches..."
curl -fsS -X POST http://localhost:3001/api/cron/check-batches \
  -H "Authorization: Bearer $INGEST_SECRET" \
  | jq -e '.ok == true' \
  >/dev/null
echo "  ✓ check-batches ok"

# ── 4. Export without Referer → expect 200 in dev ───────────────────
#
# Dev mode passes through requireSameOrigin when no Origin/Referer is
# present. Asserting the CSV header lands is the simplest smoke. The
# prod-mode path (bogus Referer → 403) is covered by the unit tests at
# src/__tests__/api/contracts/export-same-origin.test.ts, which mutate
# process.env.NODE_ENV inside the test process. Don't re-create that
# coverage here — it's bureaucratic overhead for no additional signal.
echo "GET /api/contracts/export (dev pass-through)..."
curl -fsS "http://localhost:3001/api/contracts/export?status=PURSUING" \
  | head -1 | grep -q "id,notice_id"
echo "  ✓ export returns CSV header in dev"

echo ""
echo "smoke: PASS"
