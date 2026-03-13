import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", noticeId: "notice_id",
  },
}));

vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: unknown = []) => {
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
      select: vi.fn().mockImplementation(() => createChain([])),
      insert: vi.fn().mockImplementation(() => createChain([{ id: "new-id" }])),
      update: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("@/lib/auth", () => ({
  authorize: vi.fn(),
}));

vi.mock("@/lib/sam-gov/client", () => ({
  searchOpportunities: vi.fn(),
  formatSamDate: vi.fn().mockReturnValue("01/01/2025"),
}));

vi.mock("@/lib/sam-gov/bulk-crawl", () => ({
  runBulkCrawl: vi.fn(),
}));

vi.mock("@/lib/sam-gov/mappers", () => ({
  mapOpportunityToContract: vi.fn().mockReturnValue({
    noticeId: "NID-1", title: "Test", agency: "DoD",
  }),
}));

vi.mock("@/lib/sam-gov/documents", () => ({
  filterDownloadableLinks: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/ai/metadata-classifier", () => ({
  classifyFromMetadata: vi.fn().mockResolvedValue({
    classified: 2, good: 1, maybe: 1, discard: 0, errors: 0,
  }),
}));

vi.mock("@/lib/sam-gov/fetch-descriptions", () => ({
  fetchDescriptionsForRelevant: vi.fn().mockResolvedValue({
    fetched: 1, errors: 0, stoppedAtLimit: false,
  }),
}));

vi.mock("@/lib/ai/reclassify-with-description", () => ({
  reclassifyWithDescription: vi.fn().mockResolvedValue({
    reclassified: 1, upgraded: 0, downgraded: 0, unchanged: 1, errors: 0,
  }),
}));

import { POST } from "@/app/api/ingest/trigger/route";
import { authorize } from "@/lib/auth";
import { searchOpportunities } from "@/lib/sam-gov/client";
import { runBulkCrawl } from "@/lib/sam-gov/bulk-crawl";
import { classifyFromMetadata } from "@/lib/ai/metadata-classifier";
import { fetchDescriptionsForRelevant } from "@/lib/sam-gov/fetch-descriptions";
import { reclassifyWithDescription } from "@/lib/ai/reclassify-with-description";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorize).mockReturnValue(false);
});

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ingest/trigger", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-secret",
    },
  });
}

describe("POST /api/ingest/trigger", () => {
  it("returns 401 when unauthorized", async () => {
    const req = makeReq({ mode: "daily" });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("runs full pipeline in daily mode", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    vi.mocked(searchOpportunities).mockResolvedValue({
      totalRecords: 2,
      opportunitiesData: [
        { noticeId: "NID-1", title: "Opp 1", resourceLinks: [] },
        { noticeId: "NID-2", title: "Opp 2", resourceLinks: [] },
      ],
    } as any);

    const req = makeReq({ mode: "daily" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("daily");
    expect(data.ingest.total).toBe(2);
    expect(searchOpportunities).toHaveBeenCalled();
    expect(classifyFromMetadata).toHaveBeenCalledWith({ limit: 1000 });
    expect(fetchDescriptionsForRelevant).toHaveBeenCalledWith({ limit: 1000 });
    expect(reclassifyWithDescription).toHaveBeenCalledWith({ batchSize: 1000 });
    expect(data.classify).toBeDefined();
    expect(data.fetchDescriptions).toBeDefined();
    expect(data.reclassify).toBeDefined();
  });

  it("delegates to bulk crawl in bulk mode", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    vi.mocked(runBulkCrawl).mockResolvedValue({
      totalFound: 500, newInserted: 200, skipped: 300,
      docsQueued: 50, status: "COMPLETE", pagesProcessed: 10,
    } as any);

    const req = makeReq({ mode: "bulk" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("bulk");
    expect(data.total).toBe(500);
    expect(runBulkCrawl).toHaveBeenCalled();
  });

  it("defaults to daily mode when mode not specified", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    vi.mocked(searchOpportunities).mockResolvedValue({
      totalRecords: 0,
      opportunitiesData: [],
    } as any);

    const req = makeReq({});
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("daily");
    expect(data.ingest).toBeDefined();
  });

  it("returns 400 for invalid JSON body", async () => {
    vi.mocked(authorize).mockReturnValue(true);

    const req = new NextRequest("http://localhost/api/ingest/trigger", {
      method: "POST",
      body: "not json",
      headers: {
        "Content-Type": "text/plain",
        Authorization: "Bearer test-secret",
      },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });

  it("returns 500 when daily ingest fails", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    vi.mocked(searchOpportunities).mockRejectedValue(new Error("SAM.gov down"));

    const req = makeReq({ mode: "daily" });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Daily ingest failed");
  });
});
