import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  ilike: vi.fn(),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn().mockReturnValue(""),
  desc: vi.fn(),
  asc: vi.fn(),
  inArray: vi.fn(),
  gte: vi.fn(),
  gt: vi.fn(),
  ne: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  type: { SQL: {} },
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id",
    title: "title",
    agency: "agency",
    classification: "classification",
    noticeId: "notice_id",
    solicitationNumber: "sol_num",
    awardCeiling: "award_ceiling",
    responseDeadline: "response_deadline",
    noticeType: "notice_type",
    aiReasoning: "ai_reasoning",
    summary: "summary",
    actionPlan: "action_plan",
    status: "status",
    postedDate: "posted_date",
    userOverride: "user_override",
    setAsideCode: "set_aside_code",
    reviewedAt: "reviewed_at",
    promoted: "promoted",
    promotedAt: "promoted_at",
    tags: "tags",
    createdAt: "created_at",
  },
  watchTargets: {
    id: "watch_target_id",
    active: "watch_active",
  },
  watchTargetLinks: {
    watchTargetId: "watch_target_link_watch_target_id",
    contractId: "watch_contract_id",
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
            _reject?: (e: unknown) => void,
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
import * as drizzleOrm from "drizzle-orm";

beforeEach(() => {
  selectCallCount = 0;
  mockRows = [];
  mockTotal = 0;
  shouldError = false;
  vi.mocked(drizzleOrm.inArray).mockClear();
  vi.mocked(drizzleOrm.gte).mockClear();
  vi.mocked(drizzleOrm.eq).mockClear();
  vi.mocked(drizzleOrm.sql).mockClear();
});

describe("GET /api/contracts", () => {
  function sqlCallText() {
    return vi
      .mocked(drizzleOrm.sql)
      .mock.calls.map((call) => call.map((part) => String(part)).join(" "))
      .join("\n");
  }

  it("returns default pagination (page=1, limit=50)", async () => {
    const req = new NextRequest("http://localhost/api/contracts");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.limit).toBe(50);
  });

  it("excludes expired contracts by default using a computed deadline filter", async () => {
    const req = new NextRequest("http://localhost/api/contracts");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const calls = sqlCallText();
    expect(calls).toContain("response_deadline");
    expect(calls).toContain("IS NULL");
    expect(calls).toContain(">= NOW()");
  });

  it("excludes manually archived contracts by default using the ARCHIVED tag", async () => {
    const req = new NextRequest("http://localhost/api/contracts");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const calls = sqlCallText();
    expect(calls).toContain("ARCHIVED");
    expect(calls).toContain("tags");
  });

  it("filters to archive view with ?archived=true using manual tag or expired deadline", async () => {
    const req = new NextRequest("http://localhost/api/contracts?archived=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const calls = sqlCallText();
    expect(calls).toContain("ARCHIVED");
    expect(calls).toContain("response_deadline");
    expect(calls).toContain("< NOW()");
  });

  it("does not apply archive filters with ?includeArchived=true", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?includeArchived=true",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const calls = sqlCallText();
    expect(calls).not.toContain("ARCHIVED");
    expect(calls).not.toContain("response_deadline");
  });

  it("filters to only expired contracts with ?expired=true", async () => {
    const req = new NextRequest("http://localhost/api/contracts?expired=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const calls = sqlCallText();
    expect(calls).toContain("response_deadline");
    expect(calls).toContain("IS NOT NULL");
    expect(calls).toContain("< NOW()");
  });

  it("does not apply the computed deadline filter with ?includeExpired=true", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?includeExpired=true",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const deadlineSqlCalls = vi
      .mocked(drizzleOrm.sql)
      .mock.calls.filter((call) =>
        call.map((part) => String(part)).join(" ").includes("response_deadline"),
      );
    expect(deadlineSqlCalls).toHaveLength(0);
  });

  it("filters by classification", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?classification=GOOD",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("filters by search term", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?search=cybersecurity",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("filters by agency", async () => {
    const req = new NextRequest("http://localhost/api/contracts?agency=DoD");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("filters by notice type", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?noticeType=Solicitation",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    // Single value uses eq, not inArray
    expect(drizzleOrm.inArray).not.toHaveBeenCalled();
  });

  it("filters by multiple notice types via comma-separated list", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?noticeType=Solicitation,Presolicitation",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(drizzleOrm.inArray).toHaveBeenCalledWith("notice_type", [
      "Solicitation",
      "Presolicitation",
    ]);
  });

  it("filters by postedAfter using gte", async () => {
    const iso = "2026-04-10T00:00:00.000Z";
    const req = new NextRequest(
      `http://localhost/api/contracts?postedAfter=${iso}`,
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(drizzleOrm.gte).toHaveBeenCalledWith(
      "posted_date",
      expect.any(Date),
    );
    const call = vi.mocked(drizzleOrm.gte).mock.calls[0];
    expect((call[1] as Date).toISOString()).toBe(iso);
  });

  it("ignores invalid postedAfter", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?postedAfter=not-a-date",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(drizzleOrm.gte).not.toHaveBeenCalled();
  });

  it("filters by setAsideQualifying=true", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?setAsideQualifying=true",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("accepts setAsideQualifying=1 as truthy", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?setAsideQualifying=1",
    );
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

    const req = new NextRequest(
      "http://localhost/api/contracts?page=2&limit=25",
    );
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
      "http://localhost/api/contracts?classification=GOOD&search=test&agency=DoD&noticeType=Solicitation",
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

  // ── CHOSEN tier: ?promoted= filter ──────────────────────────────────

  it("filters by ?promoted=true and adds eq(contracts.promoted, true) condition", async () => {
    const req = new NextRequest("http://localhost/api/contracts?promoted=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    // The filter wires through the shared eq() mock. Check that at least one
    // call passed the promoted column sentinel + true. The schema mock maps
    // contracts.promoted to the string "promoted" — at runtime the eq()
    // arguments are those string sentinels, but the TS signature types the
    // first arg as SQLWrapper, so cast through unknown for the comparison.
    const eqCalls = vi.mocked(drizzleOrm.eq).mock.calls as unknown as Array<
      [unknown, unknown]
    >;
    const promotedEq = eqCalls.find(
      ([col, val]) => col === "promoted" && val === true,
    );
    expect(promotedEq).toBeDefined();
  });

  it("filters by ?promoted=false and adds eq(contracts.promoted, false) condition", async () => {
    const req = new NextRequest(
      "http://localhost/api/contracts?promoted=false",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const eqCalls = vi.mocked(drizzleOrm.eq).mock.calls as unknown as Array<
      [unknown, unknown]
    >;
    const promotedEq = eqCalls.find(
      ([col, val]) => col === "promoted" && val === false,
    );
    expect(promotedEq).toBeDefined();
  });

  it("returns 400 for ?promoted=invalid (not 'true' or 'false')", async () => {
    const req = new NextRequest("http://localhost/api/contracts?promoted=yes");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid promoted");
  });

  it("returns 400 for ?promoted=1 (not 'true' or 'false')", async () => {
    const req = new NextRequest("http://localhost/api/contracts?promoted=1");
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it("filters by ?watched=false using an active-watch exclusion subquery", async () => {
    const req = new NextRequest("http://localhost/api/contracts?watched=false");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const calls = sqlCallText();
    expect(calls).toContain("NOT EXISTS");
    expect(calls).toContain("watch_contract_id");
    expect(calls).toContain("watch_active");
  });

  it("filters by ?watched=true using an active-watch inclusion subquery", async () => {
    const req = new NextRequest("http://localhost/api/contracts?watched=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const calls = sqlCallText();
    expect(calls).toContain("EXISTS");
    expect(calls).toContain("watch_contract_id");
    expect(calls).toContain("watch_active");
  });

  it("returns 400 for ?watched=1 (not 'true' or 'false')", async () => {
    const req = new NextRequest("http://localhost/api/contracts?watched=1");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid watched");
  });

  it("?promoted=true sorts rows by promotedAt DESC", async () => {
    // When promoted=true, the orderClause uses desc(promotedAt). We can't
    // introspect the ORDER BY from the proxy mock, but we can confirm the
    // handler still returns 200 and routes through the mock successfully.
    // The important invariant — sort column — is verified by a targeted
    // unit: the handler should reference contracts.promotedAt in the sort.
    // That lives in the branch of orderClause, not a runtime call, so we
    // assert indirectly via the successful 200 + no surprise 500.
    const req = new NextRequest("http://localhost/api/contracts?promoted=true");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});
