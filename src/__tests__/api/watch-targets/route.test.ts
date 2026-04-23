import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockListWatchTargets, mockCreateOrActivateWatchTarget } = vi.hoisted(
  () => ({
    mockListWatchTargets: vi.fn(),
    mockCreateOrActivateWatchTarget: vi.fn(),
  }),
);

vi.mock("@/lib/watch/service", () => ({
  listWatchTargets: mockListWatchTargets,
  createOrActivateWatchTarget: mockCreateOrActivateWatchTarget,
}));

import { GET, POST } from "@/app/api/watch-targets/route";

beforeEach(() => {
  mockListWatchTargets.mockReset();
  mockCreateOrActivateWatchTarget.mockReset();
});

describe("GET /api/watch-targets", () => {
  it("passes pagination and active-only defaults to the service", async () => {
    mockListWatchTargets.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });

    const req = new NextRequest("http://localhost/api/watch-targets");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockListWatchTargets).toHaveBeenCalledWith({
      page: 1,
      limit: 50,
      includeInactive: false,
    });
  });

  it("honors includeInactive=true", async () => {
    mockListWatchTargets.mockResolvedValue({
      data: [],
      pagination: { page: 2, limit: 10, total: 0, totalPages: 0 },
    });

    const req = new NextRequest(
      "http://localhost/api/watch-targets?page=2&limit=10&includeInactive=true",
    );
    await GET(req);

    expect(mockListWatchTargets).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      includeInactive: true,
    });
  });
});

describe("POST /api/watch-targets", () => {
  it("returns 400 when contractId is missing", async () => {
    const req = new NextRequest("http://localhost/api/watch-targets", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("creates a watch target from a contract id", async () => {
    mockCreateOrActivateWatchTarget.mockResolvedValue({ id: "watch-1" });

    const req = new NextRequest("http://localhost/api/watch-targets", {
      method: "POST",
      body: JSON.stringify({ contractId: "contract-1" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(mockCreateOrActivateWatchTarget).toHaveBeenCalledWith("contract-1");
    expect(json.id).toBe("watch-1");
  });
});
