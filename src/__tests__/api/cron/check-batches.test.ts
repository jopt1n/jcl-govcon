/**
 * Tests for POST /api/cron/check-batches covering Commit 1 scope:
 *   - Atomic-claim: lock held → skipped, no processing
 *   - Atomic-claim: claim succeeds → processing runs
 *   - Digest-retry regression (00c12be): digest failure leaves row
 *     status=succeeded + digestSentAt=NULL, next fire retries
 *   - No candidates → empty response
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

let candidates: Array<Record<string, unknown>> = [];
let claimResult: { rows: unknown[] } = { rows: [{ id: "run-1" }] };
let updatedRows: Array<{ setClause: Record<string, unknown> }> = [];

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn((...a: unknown[]) => a),
  or: vi.fn((...a: unknown[]) => a),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray) => ({ __sql: strings.join("?") }),
    { raw: vi.fn() },
  ),
}));

vi.mock("@/lib/db/schema", () => ({
  crawlRuns: {
    id: "id",
    batchId: "batch_id",
    batchStartedAt: "batch_started_at",
    batchFinishedAt: "batch_finished_at",
    digestSentAt: "digest_sent_at",
    status: "status",
  },
}));

function makeChain(resolveValue: unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => {
          Promise.resolve(resolveValue).then(resolve);
        };
      }
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockImplementation(() => makeChain(candidates)),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setClause: Record<string, unknown>) => {
        updatedRows.push({ setClause });
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    execute: vi.fn().mockImplementation(() => Promise.resolve(claimResult)),
  },
}));

const mockPollBatch = vi.fn();
const mockImportBatchResults = vi.fn();
vi.mock("@/lib/ai/batch-classify", () => ({
  pollBatch: mockPollBatch,
  importBatchResults: mockImportBatchResults,
}));

const mockSendWeeklyDigest = vi.fn();
vi.mock("@/lib/notifications/weekly-digest", () => ({
  sendWeeklyDigest: mockSendWeeklyDigest,
}));

vi.mock("@/lib/notifications/telegram", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/notifications/telegram")
  >("@/lib/notifications/telegram");
  return { ...actual, sendTelegram: vi.fn().mockResolvedValue(undefined) };
});

const VALID_SECRET = "test-secret-cron";
function req(): NextRequest {
  return new NextRequest("http://localhost/api/cron/check-batches", {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_SECRET}` },
  });
}

describe("POST /api/cron/check-batches", () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = VALID_SECRET;
    vi.stubEnv("NODE_ENV", "test");
    candidates = [];
    claimResult = { rows: [{ id: "run-1" }] };
    updatedRows = [];
    mockPollBatch.mockReset();
    mockImportBatchResults.mockReset();
    mockSendWeeklyDigest.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.INGEST_SECRET;
    vi.stubEnv("NODE_ENV", "test");
  });

  it("no candidates → returns { processed: 0, skipped: 0 }", async () => {
    candidates = [];
    const { POST } = await import("@/app/api/cron/check-batches/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(json.skipped).toBe(0);
  });

  it("atomic claim fails (rows: []) → row skipped, no processing", async () => {
    candidates = [
      {
        id: "run-1",
        batchId: "batch-a",
        batchStartedAt: new Date(),
        batchFinishedAt: null,
        digestSentAt: null,
        status: "classifying",
      },
    ];
    claimResult = { rows: [] };
    const { POST } = await import("@/app/api/cron/check-batches/route");
    const res = await POST(req());
    const json = await res.json();
    expect(json.skipped).toBe(1);
    expect(json.processed).toBe(0);
    expect(mockPollBatch).not.toHaveBeenCalled();
  });

  it("poll returns running → no import, row left for next fire", async () => {
    candidates = [
      {
        id: "run-1",
        batchId: "batch-a",
        batchStartedAt: new Date(),
        batchFinishedAt: null,
        digestSentAt: null,
        status: "classifying",
      },
    ];
    mockPollBatch.mockResolvedValue({
      status: "running",
      numSuccess: 0,
      numPending: 10,
      numError: 0,
      total: 10,
    });
    const { POST } = await import("@/app/api/cron/check-batches/route");
    const res = await POST(req());
    const json = await res.json();
    expect(json.processed).toBe(1);
    expect(mockImportBatchResults).not.toHaveBeenCalled();
  });

  it("poll returns completed → import runs, status=succeeded, digest fires", async () => {
    candidates = [
      {
        id: "run-1",
        batchId: "batch-a",
        batchStartedAt: new Date(),
        batchFinishedAt: null,
        digestSentAt: null,
        status: "classifying",
      },
    ];
    mockPollBatch.mockResolvedValue({
      status: "completed",
      numSuccess: 10,
      numPending: 0,
      numError: 0,
      total: 10,
    });
    mockImportBatchResults.mockResolvedValue({
      classified: 10,
      good: 2,
      maybe: 3,
      discard: 5,
    });
    mockSendWeeklyDigest.mockResolvedValue({
      good: 2,
      maybe: 3,
      triaged: 5,
      messageLength: 500,
    });
    const { POST } = await import("@/app/api/cron/check-batches/route");
    const res = await POST(req());
    const json = await res.json();
    expect(mockImportBatchResults).toHaveBeenCalled();
    expect(mockSendWeeklyDigest).toHaveBeenCalled();
    expect(json.processed).toBe(1);
  });

  it("batch_failed short-circuits before digest (pins #9 behavior)", async () => {
    candidates = [
      {
        id: "run-1",
        batchId: "batch-a",
        batchStartedAt: new Date(),
        batchFinishedAt: null,
        digestSentAt: null,
        status: "classifying",
      },
    ];
    mockPollBatch.mockResolvedValue({
      status: "failed",
      numSuccess: 0,
      numPending: 0,
      numError: 5,
      total: 5,
    });
    const { POST } = await import("@/app/api/cron/check-batches/route");
    await POST(req());

    // Explicit pin: sendWeeklyDigest must NOT be called on batch_failed.
    // The pre-split code accidentally skipped digest as a coincidence of
    // row state; the new code makes this an explicit early return.
    expect(mockSendWeeklyDigest).not.toHaveBeenCalled();
    expect(mockImportBatchResults).not.toHaveBeenCalled();
  });

  it("digest-retry regression: digest failure leaves status=succeeded, errorStep=digest", async () => {
    candidates = [
      {
        id: "run-1",
        batchId: null,
        batchStartedAt: null,
        batchFinishedAt: new Date(),
        digestSentAt: null,
        status: "succeeded",
      },
    ];
    mockSendWeeklyDigest.mockRejectedValue(new Error("telegram 429"));
    const { POST } = await import("@/app/api/cron/check-batches/route");
    await POST(req());

    // Assert: errorStep='digest' is set, but status is NOT flipped to 'failed'
    const digestErrUpdate = updatedRows.find(
      (u) => u.setClause.errorStep === "digest",
    );
    expect(digestErrUpdate).toBeDefined();
    expect(digestErrUpdate?.setClause.status).toBeUndefined();
  });
});
