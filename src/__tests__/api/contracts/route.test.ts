import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  ilike: vi.fn(),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn().mockReturnValue(""),
  desc: vi.fn(),
  inArray: vi.fn(),
  gte: vi.fn(),
  type: { SQL: {} },
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", title: "title", agency: "agency", classification: "classification",
    noticeId: "notice_id", solicitationNumber: "sol_num", awardCeiling: "award_ceiling",
    responseDeadline: "response_deadline", noticeType: "notice_type", aiReasoning: "ai_reasoning",
    status: "status", postedDate: "posted_date", userOverride: "user_override",
  },
}));

// Track select call count so first resolves to rows, second to count
let selectCallCount = 0;
let mockRows: unknown[] = [];
let mockTotal = 0;
let shouldError = false;

vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: unknown) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (
            resolve: (v: unknown) => void,
            _reject?: (e: unknown) => void
          ) => {
            Promise.resolve(resolveValue).then(resolve);
          };
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => {
        if (shouldError) throw new Error("DB failure");
        selectCallCount++;
        if (selectCallCount % 2 === 1) {
          return createChain(mockRows);
        }
        return createChain([{ count: mockTotal }]);
      }),
      insert: vi.fn().mockImplementation(() => createChain([])),
      update: vi.fn().mockImplementation(() => createChain([])),
      delete: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

import { GET } from "@/app/api/contracts/route";

beforeEach(() => {
  selectCallCount = 0;
  mockRows = [];
  mockTotal = 0;
  shouldError = false;
});

describe("GET /api/contracts", () => {
  it("returns default pagination (page=1, limit=50)", async () => {
    const req = new NextRequest("http://localhost/api/contracts");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.limit).toBe(50);
  });

  it("filters by classification", async () => {
    const req = new NextRequest("http://localhost/api/contracts?classification=GOOD");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("filters by search term", async () => {
    const req = new NextRequest("http://localhost/api/contracts?search=cybersecurity");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("filters by agency", async () => {
    const req = new NextRequest("http://localhost/api/contracts?agency=DoD");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("filters by notice type", async () => {
    const req = new NextRequest("http://localhost/api/contracts?noticeType=Solicitation");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("clamps limit to max 100", async () => {
    const req = new NextRequest("http://localhost/api/contracts?limit=500");
    const res = await GET(req);
    const data = await res.json();
    expect(data.pagination.limit).toBe(100);
  });

  it("clamps page to min 1", async () => {
    const req = new NextRequest("http://localhost/api/contracts?page=-5");
    const res = await GET(req);
    const data = await res.json();
    expect(data.pagination.page).toBe(1);
  });

  it("returns correct pagination metadata", async () => {
    mockRows = [{ id: "1", title: "Test" }];
    mockTotal = 75;

    const req = new NextRequest("http://localhost/api/contracts?page=2&limit=25");
    const res = await GET(req);
    const data = await res.json();

    expect(data.pagination).toEqual({
      page: 2,
      limit: 25,
      total: 75,
      totalPages: 3,
    });
    expect(data.data).toHaveLength(1);
  });

  it("handles combined filters", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?classification=GOOD&search=test&agency=DoD&noticeType=Solicitation"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("returns 500 on DB error", async () => {
    shouldError = true;

    const req = new NextRequest("http://localhost/api/contracts");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to fetch contracts");
  });
});
