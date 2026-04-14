/**
 * Auth gate smoke test for the weekly cron routes.
 *
 * Both cron endpoints share the same authorize() helper, so one test file
 * covers the 401 path for both. The happy-path paths require extensive
 * DB + xAI + Telegram mocking and are covered by manual smoke testing
 * documented in the plan.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock dependencies so importing the route file doesn't pull in the real
// DB or xAI client.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  crawlRuns: {},
  contracts: {},
}));
vi.mock("@/lib/sam-gov/bulk-crawl", () => ({
  runBulkCrawl: vi.fn(),
}));
vi.mock("@/lib/ai/batch-classify", () => ({
  submitBatchClassify: vi.fn(),
  pollBatch: vi.fn(),
  importBatchResults: vi.fn(),
}));
vi.mock("@/lib/notifications/telegram", () => ({
  sendTelegram: vi.fn(),
}));
vi.mock("@/lib/notifications/weekly-digest", () => ({
  sendWeeklyDigest: vi.fn(),
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  or: vi.fn(),
  desc: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

const VALID_SECRET = "test-secret-cron";

describe("cron route auth", () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = VALID_SECRET;
  });

  afterEach(() => {
    delete process.env.INGEST_SECRET;
    vi.resetModules();
  });

  it("weekly-crawl returns 401 when Authorization header is missing", async () => {
    const { POST } = await import("@/app/api/cron/weekly-crawl/route");
    const req = new NextRequest("http://localhost/api/cron/weekly-crawl", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("weekly-crawl returns 401 with wrong token", async () => {
    const { POST } = await import("@/app/api/cron/weekly-crawl/route");
    const req = new NextRequest("http://localhost/api/cron/weekly-crawl", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("check-batches returns 401 when Authorization header is missing", async () => {
    const { POST } = await import("@/app/api/cron/check-batches/route");
    const req = new NextRequest("http://localhost/api/cron/check-batches", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("check-batches returns 401 with wrong token", async () => {
    const { POST } = await import("@/app/api/cron/check-batches/route");
    const req = new NextRequest("http://localhost/api/cron/check-batches", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
