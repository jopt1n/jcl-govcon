import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    classification: "classification",
    descriptionFetched: "description_fetched",
    descriptionText: "description_text",
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
    },
  };
});

vi.mock("@/lib/auth", () => ({
  authorize: vi.fn(),
}));

vi.mock("@/lib/sam-gov/fetch-descriptions", () => ({
  fetchDescriptionsForRelevant: vi.fn().mockResolvedValue({ fetched: 5, errors: 0, stoppedAtLimit: false }),
}));

import { POST } from "@/app/api/fetch-descriptions/route";
import { authorize } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResult = [];
  vi.mocked(authorize).mockReturnValue(false);
});

function makeAuthReq(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/fetch-descriptions", {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-secret",
    },
  });
}

describe("POST /api/fetch-descriptions", () => {
  it("returns 401 when unauthorized", async () => {
    const res = await POST(makeAuthReq());
    expect(res.status).toBe(401);
  });

  it("returns message when no eligible contracts", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [{ eligibleCount: 0 }];

    const res = await POST(makeAuthReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.eligibleCount).toBe(0);
    expect(data.message).toContain("No eligible");
  });

  it("starts fetch and returns count when contracts exist", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [{ eligibleCount: 42 }];

    const res = await POST(makeAuthReq({ limit: 100 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.eligibleCount).toBe(42);
    expect(data.message).toContain("started");
  });

  it("handles missing body gracefully", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [{ eligibleCount: 10 }];

    const req = new NextRequest("http://localhost/api/fetch-descriptions", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.eligibleCount).toBe(10);
  });
});
