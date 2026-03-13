import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  crawlProgress: { id: "id", status: "status", processed: "processed", classified: "classified", totalFound: "total_found", updatedAt: "updated_at" },
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
      update: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("@/lib/auth", () => ({
  authorize: vi.fn(),
}));

import { POST } from "@/app/api/crawl/pause/route";
import { authorize } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResult = [];
  vi.mocked(authorize).mockReturnValue(false);
});

describe("POST /api/crawl/pause", () => {
  it("returns 401 when unauthorized", async () => {
    const req = new NextRequest("http://localhost/api/crawl/pause", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("returns 404 when no running crawl exists", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [];

    const req = new NextRequest("http://localhost/api/crawl/pause", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("No running crawl");
  });

  it("pauses a running crawl successfully", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    mockSelectResult = [{
      id: "crawl-1",
      status: "RUNNING",
      processed: 50,
      classified: 30,
      totalFound: 100,
    }];

    const req = new NextRequest("http://localhost/api/crawl/pause", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Crawl paused");
    expect(data.crawlId).toBe("crawl-1");
    expect(data.processed).toBe(50);
    expect(data.totalFound).toBe(100);
  });
});
