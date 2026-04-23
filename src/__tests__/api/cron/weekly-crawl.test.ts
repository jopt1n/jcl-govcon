/**
 * Tests for POST /api/cron/weekly-crawl covering Commit 1 (#10):
 *   - Telegram config preflight (prod fails, dev passes)
 *   - Advisory lock concurrent-fire guard
 *   - Crawl-step failure
 *   - Batch-submit-step failure
 *   - Happy path end-to-end
 *
 * The route is complex (DB insert/update, runBulkCrawl, submitBatchClassify,
 * telegram, advisory lock). Every external dependency is mocked. The DB mock
 * uses a thin chainable proxy plus a configurable `execute` function for the
 * advisory lock SELECTs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ── Mock state (reset in beforeEach) ─────────────────────────────────────
let insertedRows: Array<Record<string, unknown>> = [];
let updatedRows: Array<{ setClause: Record<string, unknown> }> = [];
let executeCalls: string[] = [];
let lockAcquired = true; // pg_try_advisory_lock outcome
let selectResult: unknown[] = [{ id: "contract-1" }];

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

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn((...args: unknown[]) => args),
  gte: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray) => ({ __sql: strings.join("?") }),
    { raw: vi.fn() },
  ),
}));

vi.mock("@/lib/db/schema", () => ({
  crawlRuns: { id: "id" },
  contracts: {
    id: "id",
    classification: "classification",
    userOverride: "user_override",
    createdAt: "created_at",
    tags: "tags",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
        insertedRows.push(vals);
        return {
          returning: vi
            .fn()
            .mockResolvedValue([{ id: `run-${insertedRows.length}` }]),
        };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setClause: Record<string, unknown>) => {
        updatedRows.push({ setClause });
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      }),
    })),
    select: vi.fn().mockImplementation(() => makeChain(selectResult)),
    execute: vi.fn().mockImplementation((arg: { __sql?: string }) => {
      const sqlText = arg?.__sql ?? "";
      executeCalls.push(sqlText);
      if (sqlText.includes("pg_try_advisory_lock")) {
        return Promise.resolve({ rows: [{ locked: lockAcquired }] });
      }
      if (sqlText.includes("pg_advisory_unlock")) {
        return Promise.resolve({ rows: [{ pg_advisory_unlock: true }] });
      }
      return Promise.resolve({ rows: [] });
    }),
  },
}));

const mockRunBulkCrawl = vi.fn();
vi.mock("@/lib/sam-gov/bulk-crawl", () => ({
  runBulkCrawl: mockRunBulkCrawl,
}));

const mockSubmitBatchClassify = vi.fn();
vi.mock("@/lib/ai/batch-classify", () => ({
  submitBatchClassify: mockSubmitBatchClassify,
}));

vi.mock("@/lib/notifications/telegram", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/notifications/telegram")
  >("@/lib/notifications/telegram");
  return {
    ...actual,
    sendTelegram: vi.fn().mockResolvedValue(undefined),
  };
});

const VALID_SECRET = "test-secret-cron";

function req(): NextRequest {
  return new NextRequest("http://localhost/api/cron/weekly-crawl", {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_SECRET}` },
  });
}

describe("POST /api/cron/weekly-crawl", () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = VALID_SECRET;
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    insertedRows = [];
    updatedRows = [];
    executeCalls = [];
    lockAcquired = true;
    selectResult = [];
    mockRunBulkCrawl.mockReset();
    mockSubmitBatchClassify.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.INGEST_SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.stubEnv("NODE_ENV", "test");
  });

  describe("Telegram preflight", () => {
    it("returns 500 + inserts failed crawl_runs row when config missing in prod", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      const res = await POST(req());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Telegram config missing");
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].status).toBe("failed");
      expect(insertedRows[0].errorStep).toBe("telegram_config");
      expect(mockRunBulkCrawl).not.toHaveBeenCalled();
    });

    it("proceeds normally when config missing in dev/test", async () => {
      vi.stubEnv("NODE_ENV", "test");
      mockRunBulkCrawl.mockResolvedValue({ totalFound: 0, newInserted: 0 });
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(mockRunBulkCrawl).toHaveBeenCalled();
    });

    it("proceeds normally when config present in prod", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.TELEGRAM_BOT_TOKEN = "x";
      process.env.TELEGRAM_CHAT_ID = "y";
      mockRunBulkCrawl.mockResolvedValue({ totalFound: 0, newInserted: 0 });
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      const res = await POST(req());
      expect(res.status).toBe(200);
    });
  });

  describe("Advisory lock", () => {
    it("returns 200 {skipped} when another run holds the lock", async () => {
      lockAcquired = false;
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      const res = await POST(req());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.skipped).toBe("another weekly-crawl in progress");
      expect(insertedRows).toHaveLength(0);
      expect(mockRunBulkCrawl).not.toHaveBeenCalled();
    });

    it("proceeds when lock acquired and releases it in finally", async () => {
      lockAcquired = true;
      mockRunBulkCrawl.mockResolvedValue({ totalFound: 0, newInserted: 0 });
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      await POST(req());
      const lockedCalls = executeCalls.filter((s) =>
        s.includes("pg_try_advisory_lock"),
      );
      const unlockCalls = executeCalls.filter((s) =>
        s.includes("pg_advisory_unlock"),
      );
      expect(lockedCalls.length).toBe(1);
      expect(unlockCalls.length).toBe(1);
    });

    it("releases lock even if crawl throws", async () => {
      lockAcquired = true;
      mockRunBulkCrawl.mockRejectedValue(new Error("sam-gov boom"));
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      await POST(req());
      const unlockCalls = executeCalls.filter((s) =>
        s.includes("pg_advisory_unlock"),
      );
      expect(unlockCalls.length).toBe(1);
    });
  });

  describe("Crawl + batch-submit failures", () => {
    it("marks status=failed errorStep=crawl when runBulkCrawl throws", async () => {
      mockRunBulkCrawl.mockRejectedValue(new Error("sam-gov 500"));
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      const res = await POST(req());
      expect(res.status).toBe(500);
      const failedUpdate = updatedRows.find(
        (u) => u.setClause.errorStep === "crawl",
      );
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate?.setClause.status).toBe("failed");
    });

    it("marks status=failed errorStep=batch_submit when submit throws", async () => {
      mockRunBulkCrawl.mockResolvedValue({ totalFound: 5, newInserted: 5 });
      selectResult = [{ id: "c1" }]; // pending row exists
      mockSubmitBatchClassify.mockRejectedValue(new Error("xai 500"));
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      const res = await POST(req());
      expect(res.status).toBe(500);
      const failedUpdate = updatedRows.find(
        (u) => u.setClause.errorStep === "batch_submit",
      );
      expect(failedUpdate).toBeDefined();
    });
  });

  describe("Happy path", () => {
    it("fast-path: no pending contracts → succeeded with 0 classified", async () => {
      mockRunBulkCrawl.mockResolvedValue({ totalFound: 10, newInserted: 3 });
      selectResult = []; // no pending
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      const res = await POST(req());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("succeeded");
      expect(mockSubmitBatchClassify).not.toHaveBeenCalled();
    });

    it("full path: crawl + submit → status=classifying", async () => {
      mockRunBulkCrawl.mockResolvedValue({ totalFound: 10, newInserted: 3 });
      selectResult = [{ id: "c1" }];
      mockSubmitBatchClassify.mockResolvedValue({
        batchId: "batch-abc",
        submitted: 3,
        preFilteredDiscard: 0,
      });
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      const res = await POST(req());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("classifying");
      expect(json.batchId).toBe("batch-abc");
      expect(mockSubmitBatchClassify).toHaveBeenCalled();
    });
  });

  describe("#3 since filter", () => {
    it("passes a `since` Date to submitBatchClassify", async () => {
      mockRunBulkCrawl.mockResolvedValue({ totalFound: 10, newInserted: 3 });
      selectResult = [{ id: "c1" }];
      mockSubmitBatchClassify.mockResolvedValue({
        batchId: "batch-abc",
        submitted: 3,
        preFilteredDiscard: 0,
      });
      const { POST } = await import("@/app/api/cron/weekly-crawl/route");

      await POST(req());
      const call = mockSubmitBatchClassify.mock.calls[0]?.[0];
      expect(call).toBeDefined();
      expect(call.pendingOnly).toBe(true);
      expect(call.since).toBeInstanceOf(Date);
      // Assert the Date is ~7 days ago (±5s clock tolerance)
      const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(call.since.getTime() - expected)).toBeLessThan(5_000);
    });
  });
});
