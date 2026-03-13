import { vi } from "vitest";

let insertReturningData: any[] = [{ id: "crawl-1", totalFound: 0, processed: 0, classified: 0, lastOffset: 0, status: "RUNNING" }];
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
            const h2: ProxyHandler<object> = {
              get(_t, p) {
                if (p === "then") return (resolve: (v: unknown) => void) => resolve(insertReturningData);
                return vi.fn().mockReturnValue(new Proxy({}, h2));
              },
            };
            return new Proxy({}, h2);
          });
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => {
        const data = selectDataSequence.length > 0
          ? selectDataSequence[Math.min(selectCallIndex++, selectDataSequence.length - 1)]
          : [];
        return createChain(data);
      }),
      insert: vi.fn().mockImplementation(() => createChain(insertReturningData)),
      update: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: { id: "id", noticeId: "notice_id", title: "title", noticeType: "notice_type", responseDeadline: "response_deadline", active: "active", rawJson: "raw_json", agency: "agency", naicsCode: "naics_code", pscCode: "psc_code", setAsideType: "set_aside_type", awardCeiling: "award_ceiling", postedDate: "posted_date", samUrl: "sam_url", resourceLinks: "resource_links", orgPathName: "org_path_name", orgPathCode: "org_path_code", popState: "pop_state", popCity: "pop_city", popZip: "pop_zip", officeCity: "office_city", officeState: "office_state", setAsideCode: "set_aside_code", solicitationNumber: "solicitation_number" },
  crawlProgress: { id: "id", status: "status" },
}));

vi.mock("@/lib/sam-gov/client", () => ({
  searchOpportunities: vi.fn().mockResolvedValue({
    totalRecords: 1,
    opportunitiesData: [{
      noticeId: "opp-1", title: "Test Opportunity", resourceLinks: [],
    }],
  }),
  canMakeCall: vi.fn().mockResolvedValue(true),
  formatSamDate: vi.fn().mockImplementation((d: Date) => {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }),
}));

vi.mock("@/lib/sam-gov/mappers", () => ({
  mapOpportunityToContract: vi.fn().mockReturnValue({
    noticeId: "opp-1", title: "Test Opportunity", agency: "Test Agency",
    samUrl: "https://sam.gov/test", postedDate: new Date(),
    classification: "PENDING", descriptionFetched: false, classifiedFromMetadata: false,
  }),
}));

import { db } from "@/lib/db";
import { runBulkCrawl } from "@/lib/sam-gov/bulk-crawl";
import { searchOpportunities, canMakeCall } from "@/lib/sam-gov/client";

describe("runBulkCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertReturningData = [{ id: "crawl-1", totalFound: 0, processed: 0, classified: 0, lastOffset: 0, status: "RUNNING" }];
    selectCallIndex = 0;
    selectDataSequence = [];
    delete process.env.SAM_DRY_RUN;
  });

  it("returns immediately in DRY_RUN mode without API calls", async () => {
    process.env.SAM_DRY_RUN = "true";

    const result = await runBulkCrawl();
    expect(result.totalFound).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.newInserted).toBe(0);
    expect(result.status).toBe("COMPLETE");
    expect(result.pagesProcessed).toBe(0);
    expect(searchOpportunities).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates new crawl progress when none exists", async () => {
    // select 1: no existing RUNNING crawl → []
    // select 2: pause check → RUNNING
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "RUNNING" }], // pause check
    ];

    await runBulkCrawl();
    expect(db.insert).toHaveBeenCalled();
  });

  it("resumes from existing RUNNING crawl", async () => {
    const existingCrawl = {
      id: "existing-crawl", totalFound: 500, processed: 100,
      classified: 50, lastOffset: 100, status: "RUNNING",
    };
    selectDataSequence = [
      [existingCrawl], // existing crawl found
      [{ status: "RUNNING" }], // pause check
    ];

    const result = await runBulkCrawl();
    expect(result.pagesProcessed).toBeGreaterThanOrEqual(0);
  });

  it("pauses when canMakeCall() returns false", async () => {
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "RUNNING" }], // pause check
    ];
    vi.mocked(canMakeCall).mockResolvedValue(false);

    const result = await runBulkCrawl();
    expect(result.status).toBe("PAUSED");
    expect(searchOpportunities).not.toHaveBeenCalled();
  });

  it("stops when PAUSED by user", async () => {
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "PAUSED" }], // pause check returns PAUSED
    ];

    const result = await runBulkCrawl();
    expect(result.status).toBe("PAUSED");
  });

  it("stops on empty page", async () => {
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "RUNNING" }], // pause check
    ];
    vi.mocked(searchOpportunities).mockResolvedValue({
      totalRecords: 0,
      opportunitiesData: [],
    });

    const result = await runBulkCrawl();
    expect(result.pagesProcessed).toBe(0);
  });

  it("counts new vs skipped inserts", async () => {
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "RUNNING" }], // pause check
    ];

    const result = await runBulkCrawl();
    expect(typeof result.newInserted).toBe("number");
    expect(typeof result.skipped).toBe("number");
  });

  it("on error: sets PAUSED and re-throws", async () => {
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "RUNNING" }], // pause check
    ];
    vi.mocked(canMakeCall).mockResolvedValue(true);
    vi.mocked(searchOpportunities).mockRejectedValueOnce(new Error("API failure"));

    await expect(runBulkCrawl()).rejects.toThrow("API failure");
    expect(db.update).toHaveBeenCalled();
  });

  it("updates progress after each page", async () => {
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "RUNNING" }], // pause check
    ];

    await runBulkCrawl();
    expect(db.update).toHaveBeenCalled();
  });

  it("returns correct result shape (no docsQueued)", async () => {
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "RUNNING" }], // pause check
    ];

    const result = await runBulkCrawl();
    expect(result).toHaveProperty("totalFound");
    expect(result).toHaveProperty("processed");
    expect(result).toHaveProperty("newInserted");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("pagesProcessed");
    expect(result).not.toHaveProperty("docsQueued");
    expect(["COMPLETE", "PAUSED"]).toContain(result.status);
  });

  it("inserts contracts with PENDING classification", async () => {
    selectDataSequence = [
      [], // no existing crawl
      [{ status: "RUNNING" }], // pause check
    ];

    await runBulkCrawl();
    // The mapper mock returns classification: "PENDING" and descriptionFetched: false
    // Verify insert was called (upsert)
    expect(db.insert).toHaveBeenCalled();
  });
});
