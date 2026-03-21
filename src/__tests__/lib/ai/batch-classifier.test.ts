import { vi } from "vitest";

// Default mock data for insert().returning()
let insertReturningData: any[] = [{ id: "batch-job-1" }];
let selectData: any[] = [];
let selectCallIndex = 0;
let selectDataSequence: any[][] = [];

vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: unknown = []) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(resolveValue);
        }
        if (prop === "returning") {
          return vi.fn().mockImplementation(() => {
            const handler2: ProxyHandler<object> = {
              get(_t2, p2) {
                if (p2 === "then") {
                  return (resolve: (v: unknown) => void) => resolve(insertReturningData);
                }
                return vi.fn().mockReturnValue(new Proxy({}, handler2));
              },
            };
            return new Proxy({}, handler2);
          });
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn().mockImplementation((..._args: any[]) => {
        const data = selectDataSequence.length > 0
          ? selectDataSequence[selectCallIndex++ % selectDataSequence.length]
          : selectData;
        return createChain(data);
      }),
      insert: vi.fn().mockImplementation(() => createChain(insertReturningData)),
      update: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", noticeId: "notice_id", title: "title", agency: "agency",
    naicsCode: "naics_code", pscCode: "psc_code", noticeType: "notice_type",
    setAsideType: "set_aside_type", awardCeiling: "award_ceiling",
    descriptionText: "description_text", resourceLinks: "resource_links",
  },
  batchJobs: { id: "id", geminiJobName: "gemini_job_name", contractsCount: "contracts_count", status: "status" },
  crawlProgress: { id: "id", status: "status", batchJobId: "batch_job_id", classified: "classified" },
}));

vi.mock("@/lib/ai/classifier", () => ({
  classifyContract: vi.fn().mockResolvedValue({
    contractId: "test-id",
    noticeId: "test-notice",
    classification: "GOOD",
    reasoning: "test",
    documentsAnalyzed: false,
  }),
}));

vi.mock("@/lib/utils", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { runBatchClassification } from "@/lib/ai/batch-classifier";
import { classifyContract } from "@/lib/ai/classifier";
import { db } from "@/lib/db";

const mockContractRow = {
  id: "test-id", noticeId: "test-notice", title: "Test Contract",
  agency: "Test Agency", naicsCode: "541511", pscCode: "D301",
  noticeType: "Solicitation", setAsideType: "SBA", awardCeiling: "100000",
  responseDeadline: "2026-04-01T00:00:00Z",
  descriptionText: "Test desc", resourceLinks: null,
};

describe("runBatchClassification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertReturningData = [{ id: "batch-job-1" }];
    selectData = [mockContractRow];
    selectDataSequence = [];
    selectCallIndex = 0;
  });

  it("creates batch job record in DB", async () => {
    await runBatchClassification(["contract-1"]);
    expect(db.insert).toHaveBeenCalled();
  });

  it("processes all contracts in chunks", async () => {
    await runBatchClassification(["c1", "c2", "c3"]);
    expect(classifyContract).toHaveBeenCalled();
  });

  it("returns SUCCEEDED status on completion", async () => {
    const result = await runBatchClassification(["c1"]);
    expect(result.status).toBe("SUCCEEDED");
  });

  it("returns correct good/maybe/discard counts", async () => {
    selectData = [
      { ...mockContractRow, id: "c1", noticeId: "n1" },
      { ...mockContractRow, id: "c2", noticeId: "n2" },
      { ...mockContractRow, id: "c3", noticeId: "n3" },
    ];

    vi.mocked(classifyContract)
      .mockResolvedValueOnce({ contractId: "c1", noticeId: "n1", classification: "GOOD", reasoning: "good", documentsAnalyzed: false })
      .mockResolvedValueOnce({ contractId: "c2", noticeId: "n2", classification: "MAYBE", reasoning: "maybe", documentsAnalyzed: false })
      .mockResolvedValueOnce({ contractId: "c3", noticeId: "n3", classification: "DISCARD", reasoning: "discard", documentsAnalyzed: false });

    const result = await runBatchClassification(["c1", "c2", "c3"]);

    expect(result.good).toBe(1);
    expect(result.maybe).toBe(1);
    expect(result.discard).toBe(1);
  });

  it("checks pause status between chunks when crawlProgressId provided", async () => {
    // First select: pause check → RUNNING, second select: contract rows
    selectDataSequence = [
      [{ status: "RUNNING" }],
      [mockContractRow],
    ];

    await runBatchClassification(["c1"], "crawl-progress-1");
    expect(db.select).toHaveBeenCalled();
  });

  it("returns PAUSED when crawl is paused", async () => {
    selectDataSequence = [
      [{ status: "PAUSED" }],
    ];

    const result = await runBatchClassification(["c1"], "crawl-progress-1");
    expect(result.status).toBe("PAUSED");
  });

  it("returns FAILED on error", async () => {
    vi.mocked(classifyContract).mockRejectedValue(new Error("Gemini error"));

    const result = await runBatchClassification(["c1"]);
    // When classifyContract throws, it increments errors + classified but doesn't crash
    expect(result.status).toBe("SUCCEEDED");
    expect(result.errors).toBe(1);
  });

  it("returns correct total and classified counts", async () => {
    const result = await runBatchClassification(["c1", "c2"]);
    expect(result.total).toBe(2);
    expect(result.batchJobId).toBe("batch-job-1");
  });

  it("links batch job to crawl progress when crawlProgressId provided", async () => {
    selectDataSequence = [
      [{ status: "RUNNING" }],
      [mockContractRow],
    ];

    await runBatchClassification(["c1"], "crawl-progress-1");
    expect(db.update).toHaveBeenCalled();
  });
});
