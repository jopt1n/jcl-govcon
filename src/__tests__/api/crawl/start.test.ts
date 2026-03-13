import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  authorize: vi.fn(),
}));

vi.mock("@/lib/sam-gov/bulk-crawl", () => ({
  runBulkCrawl: vi.fn().mockResolvedValue({
    totalFound: 100, newInserted: 50, skipped: 50, status: "COMPLETE", pagesProcessed: 5,
  }),
}));

import { POST } from "@/app/api/crawl/start/route";
import { authorize } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorize).mockReturnValue(false);
});

describe("POST /api/crawl/start", () => {
  it("returns 401 when unauthorized", async () => {
    const req = new NextRequest("http://localhost/api/crawl/start", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("returns immediately with 'started' status and metadata phase", async () => {
    vi.mocked(authorize).mockReturnValue(true);

    const req = new NextRequest("http://localhost/api/crawl/start", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("started");
    expect(data.phase).toBe("metadata");
  });

  it("returns correct response shape", async () => {
    vi.mocked(authorize).mockReturnValue(true);

    const req = new NextRequest("http://localhost/api/crawl/start", { method: "POST" });
    const res = await POST(req);

    const data = await res.json();
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("phase");
    expect(data).toHaveProperty("message");
    expect(data.message).toContain("/api/crawl/status");
  });
});
