import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  settings: { id: "id", key: "key", value: "value" },
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
    },
  };
});

import { GET, PUT } from "@/app/api/settings/route";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResult = [];
});

describe("GET /api/settings", () => {
  it("returns settings as key-value map", async () => {
    mockSelectResult = [
      { key: "company_profile", value: "Test Corp" },
      { key: "digest_enabled", value: true },
    ];

    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.company_profile).toBe("Test Corp");
    expect(data.digest_enabled).toBe(true);
  });
});

describe("PUT /api/settings", () => {
  it("upserts settings from body", async () => {
    // Mock select to return empty (new key), triggering insert path
    mockSelectResult = [];

    const req = new NextRequest("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ company_profile: "Updated Corp" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("returns 400 for non-object body", async () => {
    const req = new NextRequest("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify("not an object"),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);

    // Note: typeof "not an object" === "string", not "object", so it should return 400
    // However, JSON.parse of a string gives a string, and typeof string !== "object"
    // But the route checks `!body || typeof body !== "object"` — a string passes !body as false
    // but typeof "string" !== "object" is true, so it returns 400
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("JSON object");
  });

  it("returns 400 for null body", async () => {
    const req = new NextRequest("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify(null),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PUT(req);

    expect(res.status).toBe(400);
  });
});
