import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", title: "title", agency: "agency", classification: "classification",
    noticeId: "notice_id", solicitationNumber: "sol_num", awardCeiling: "award_ceiling",
    responseDeadline: "response_deadline", noticeType: "notice_type", aiReasoning: "ai_reasoning",
    status: "status", postedDate: "posted_date", userOverride: "user_override",
    pscCode: "psc_code", naicsCode: "naics_code", setAsideType: "set_aside_type",
    descriptionText: "description_text", resourceLinks: "resource_links", samUrl: "sam_url",
    notes: "notes", active: "active",
  },
}));

let mockSelectResult: unknown[] = [];

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
      select: vi.fn().mockImplementation(() => createChain(mockSelectResult)),
      insert: vi.fn().mockImplementation(() => createChain([])),
      update: vi.fn().mockImplementation(() => createChain([])),
      delete: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("@/lib/auth", () => ({
  authorize: vi.fn(),
}));

vi.mock("@/lib/ai/classifier", () => ({
  classifyContracts: vi.fn(),
}));

import { POST } from "@/app/api/classify/route";
import { authorize } from "@/lib/auth";
import { classifyContracts } from "@/lib/ai/classifier";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResult = [];
  vi.mocked(authorize).mockReturnValue(false);
});

function makeAuthReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/classify", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-secret",
    },
  });
}

describe("POST /api/classify", () => {
  it("returns 401 when unauthorized", async () => {
    const req = makeAuthReq({ contractIds: ["id-1"] });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    vi.mocked(authorize).mockReturnValue(true);

    const req = new NextRequest("http://localhost/api/classify", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "text/plain" },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });

  it("returns 400 for empty contractIds", async () => {
    vi.mocked(authorize).mockReturnValue(true);

    const req = makeAuthReq({ contractIds: [] });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("non-empty");
  });

  it("returns 400 when contractIds exceeds 100", async () => {
    vi.mocked(authorize).mockReturnValue(true);

    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const req = makeAuthReq({ contractIds: ids });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("100");
  });

  it("returns 404 when no contracts found", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [];

    const req = makeAuthReq({ contractIds: ["nonexistent-id"] });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("No contracts found");
  });

  it("returns classification summary on success", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [
      { id: "id-1", noticeId: "NID-1", title: "Contract A" },
      { id: "id-2", noticeId: "NID-2", title: "Contract B" },
    ];

    vi.mocked(classifyContracts).mockResolvedValue([
      { contractId: "id-1", noticeId: "NID-1", classification: "GOOD", reasoning: "Good fit", documentsAnalyzed: 1 },
      { contractId: "id-2", noticeId: "NID-2", classification: "DISCARD", reasoning: "Not relevant", documentsAnalyzed: 0 },
    ] as any);

    const req = makeAuthReq({ contractIds: ["id-1", "id-2"] });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.total).toBe(2);
    expect(data.summary.good).toBe(1);
    expect(data.summary.discard).toBe(1);
    expect(data.results).toHaveLength(2);
  });

  it("returns 400 when contractIds is missing", async () => {
    vi.mocked(authorize).mockReturnValue(true);

    const req = makeAuthReq({});
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
