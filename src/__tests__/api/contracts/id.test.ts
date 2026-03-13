import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", title: "title", agency: "agency", classification: "classification",
    noticeId: "notice_id", solicitationNumber: "sol_num", awardCeiling: "award_ceiling",
    responseDeadline: "response_deadline", noticeType: "notice_type", aiReasoning: "ai_reasoning",
    status: "status", postedDate: "posted_date", userOverride: "user_override",
    pscCode: "psc_code", naicsCode: "naics_code", setAsideType: "set_aside_type",
    descriptionText: "description_text", resourceLinks: "resource_links", samUrl: "sam_url",
    notes: "notes", active: "active", rawJson: "raw_json", documentsAnalyzed: "documents_analyzed",
    createdAt: "created_at", updatedAt: "updated_at",
  },
}));

let mockSelectResult: unknown[] = [];
let mockUpdateResult: unknown[] = [];

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
      update: vi.fn().mockImplementation(() => createChain(mockUpdateResult)),
      delete: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

import { GET, PATCH } from "@/app/api/contracts/[id]/route";

beforeEach(() => {
  mockSelectResult = [];
  mockUpdateResult = [];
});

describe("GET /api/contracts/[id]", () => {
  it("returns contract when found", async () => {
    const contract = { id: "test-uuid", title: "Test Contract", agency: "DoD" };
    mockSelectResult = [contract];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid");
    const res = await GET(req, { params: { id: "test-uuid" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.id).toBe("test-uuid");
    expect(data.title).toBe("Test Contract");
  });

  it("returns 404 when contract not found", async () => {
    mockSelectResult = [];

    const req = new NextRequest("http://localhost/api/contracts/nonexistent");
    const res = await GET(req, { params: { id: "nonexistent" } });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Contract not found");
  });
});

describe("PATCH /api/contracts/[id]", () => {
  it("returns 400 for invalid classification", async () => {
    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ classification: "INVALID" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid classification");
  });

  it("returns 400 for invalid status", async () => {
    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ status: "BOGUS" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid status");
  });

  it("returns 400 when no valid fields provided", async () => {
    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ unknownField: "value" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("No valid fields to update");
  });

  it("returns 404 when contract not found for update", async () => {
    mockUpdateResult = [];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ classification: "GOOD" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Contract not found");
  });

  it("updates contract and sets updatedAt", async () => {
    const updated = { id: "test-uuid", classification: "GOOD", updatedAt: new Date().toISOString() };
    mockUpdateResult = [updated];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ classification: "GOOD", notes: "Looks promising" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("test-uuid");
  });

  it("accepts valid status values", async () => {
    mockUpdateResult = [{ id: "test-uuid", status: "PURSUING" }];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ status: "PURSUING" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
  });

  it("accepts userOverride field", async () => {
    mockUpdateResult = [{ id: "test-uuid", userOverride: true }];

    const req = new NextRequest("http://localhost/api/contracts/test-uuid", {
      method: "PATCH",
      body: JSON.stringify({ userOverride: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "test-uuid" } });

    expect(res.status).toBe(200);
  });
});
