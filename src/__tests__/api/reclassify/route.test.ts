import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNotNull: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    classifiedFromMetadata: "classified_from_metadata",
    descriptionFetched: "description_fetched",
    descriptionText: "description_text",
    userOverride: "user_override",
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

vi.mock("@/lib/ai/reclassify-with-description", () => ({
  reclassifyWithDescription: vi.fn().mockResolvedValue({
    reclassified: 10, upgraded: 3, downgraded: 2, unchanged: 5, errors: 0,
  }),
}));

import { POST } from "@/app/api/reclassify/route";
import { authorize } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResult = [];
  vi.mocked(authorize).mockReturnValue(false);
});

function makeAuthReq(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reclassify", {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-secret",
    },
  });
}

describe("POST /api/reclassify", () => {
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

  it("starts reclassification and returns count", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [{ eligibleCount: 25 }];

    const res = await POST(makeAuthReq({ batchSize: 100 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.eligibleCount).toBe(25);
    expect(data.message).toContain("started");
  });

  it("handles missing body gracefully", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [{ eligibleCount: 5 }];

    const req = new NextRequest("http://localhost/api/reclassify", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.eligibleCount).toBe(5);
  });
});
