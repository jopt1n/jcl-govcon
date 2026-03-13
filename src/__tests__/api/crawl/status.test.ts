import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  ne: vi.fn(),
  sql: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: { classification: "classification", descriptionFetched: "description_fetched" },
  crawlProgress: { id: "id", status: "status", totalFound: "total_found", processed: "processed", classified: "classified", lastOffset: "last_offset", startedAt: "started_at", updatedAt: "updated_at" },
  batchJobs: { id: "id", geminiJobName: "gemini_job_name", status: "status", contractsCount: "contracts_count", submittedAt: "submitted_at", completedAt: "completed_at", resultsJson: "results_json" },
  apiUsage: { date: "date", searchCalls: "search_calls", docFetches: "doc_fetches" },
}));

// Track select calls to return different data for each query
let selectCallIndex = 0;
let mockCrawlResult: unknown[] = [];
let mockBatchResult: unknown[] = [];
let mockClassificationCounts: unknown[] = [];
let mockApiUsageResult: unknown[] = [];
let mockPipelineCounts: unknown[] = [];

vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: unknown) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(resolveValue);
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => {
        selectCallIndex++;
        if (selectCallIndex === 1) return createChain(mockCrawlResult);
        if (selectCallIndex === 2) return createChain(mockBatchResult);
        if (selectCallIndex === 3) return createChain(mockClassificationCounts);
        if (selectCallIndex === 4) return createChain(mockApiUsageResult);
        return createChain(mockPipelineCounts);
      }),
    },
  };
});

vi.mock("@/lib/auth", () => ({
  authorize: vi.fn(),
}));

import { GET } from "@/app/api/crawl/status/route";
import { authorize } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  selectCallIndex = 0;
  mockCrawlResult = [];
  mockBatchResult = [];
  mockClassificationCounts = [];
  mockApiUsageResult = [];
  mockPipelineCounts = [];
  vi.mocked(authorize).mockReturnValue(false);
});

describe("GET /api/crawl/status", () => {
  it("returns 401 when unauthorized", async () => {
    const req = new NextRequest("http://localhost/api/crawl/status");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("returns crawl, batchJob, contracts, phase, apiUsage, and pipeline shape", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockCrawlResult = [{
      id: "crawl-1", status: "COMPLETE", totalFound: 100, processed: 100,
      classified: 80, lastOffset: 100, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }];
    mockBatchResult = [{
      id: "batch-1", geminiJobName: "job-123", status: "COMPLETE",
      contractsCount: 80, submittedAt: new Date().toISOString(), completedAt: new Date().toISOString(), resultsJson: null,
    }];
    mockClassificationCounts = [
      { classification: "GOOD", count: 30 },
      { classification: "MAYBE", count: 20 },
      { classification: "DISCARD", count: 25 },
      { classification: "PENDING", count: 5 },
    ];
    mockApiUsageResult = [{ searchCalls: 15, docFetches: 3 }];
    mockPipelineCounts = [{
      totalIngested: 80, pendingClassification: 5, classified: 75,
      goodCount: 30, maybeCount: 20, discardCount: 25, descriptionsFetched: 10,
    }];

    const req = new NextRequest("http://localhost/api/crawl/status");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("crawl");
    expect(data).toHaveProperty("batchJob");
    expect(data).toHaveProperty("contracts");
    expect(data).toHaveProperty("phase");
    expect(data).toHaveProperty("apiUsage");
    expect(data).toHaveProperty("pipeline");
    expect(data.crawl.id).toBe("crawl-1");
    expect(data.batchJob.id).toBe("batch-1");
    expect(data.contracts.good).toBe(30);
    expect(data.contracts.maybe).toBe(20);
    expect(data.contracts.total).toBe(80);
    expect(data.phase).toBe("metadata");
    expect(data.apiUsage.searchCalls).toBe(15);
    expect(data.apiUsage.docFetches).toBe(3);
    expect(data.apiUsage.dailyLimit).toBe(950);
    expect(data.apiUsage.remaining).toBe(935);
    expect(data.pipeline.totalIngested).toBe(80);
    expect(data.pipeline.pendingClassification).toBe(5);
    expect(data.pipeline.descriptionsFetched).toBe(10);
  });

  it("handles null crawl and batch results with defaults", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockCrawlResult = [];
    mockBatchResult = [];
    mockClassificationCounts = [];
    mockApiUsageResult = [];
    mockPipelineCounts = [{
      totalIngested: 0, pendingClassification: 0, classified: 0,
      goodCount: 0, maybeCount: 0, discardCount: 0, descriptionsFetched: 0,
    }];

    const req = new NextRequest("http://localhost/api/crawl/status");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.crawl).toBeNull();
    expect(data.batchJob).toBeNull();
    expect(data.contracts.total).toBe(0);
    expect(data.apiUsage.searchCalls).toBe(0);
    expect(data.apiUsage.remaining).toBe(950);
    expect(data.pipeline.totalIngested).toBe(0);
  });
});
