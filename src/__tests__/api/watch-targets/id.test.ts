import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetWatchTargetDetail, mockUpdateWatchTarget } = vi.hoisted(() => ({
  mockGetWatchTargetDetail: vi.fn(),
  mockUpdateWatchTarget: vi.fn(),
}));

vi.mock("@/lib/watch/service", () => ({
  getWatchTargetDetail: mockGetWatchTargetDetail,
  updateWatchTarget: mockUpdateWatchTarget,
}));

import { GET, PATCH } from "@/app/api/watch-targets/[id]/route";

beforeEach(() => {
  mockGetWatchTargetDetail.mockReset();
  mockUpdateWatchTarget.mockReset();
});

describe("GET /api/watch-targets/[id]", () => {
  it("returns 404 when the watch target does not exist", async () => {
    mockGetWatchTargetDetail.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/watch-targets/watch-1");
    const res = await GET(req, { params: { id: "watch-1" } });

    expect(res.status).toBe(404);
  });

  it("returns the watch-target detail payload", async () => {
    mockGetWatchTargetDetail.mockResolvedValue({ id: "watch-1" });

    const req = new NextRequest("http://localhost/api/watch-targets/watch-1");
    const res = await GET(req, { params: { id: "watch-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("watch-1");
  });
});

describe("PATCH /api/watch-targets/[id]", () => {
  it("passes manual primary selection through to the service", async () => {
    mockUpdateWatchTarget.mockResolvedValue({
      id: "watch-1",
      primaryContractId: "contract-2",
    });

    const req = new NextRequest("http://localhost/api/watch-targets/watch-1", {
      method: "PATCH",
      body: JSON.stringify({ primaryContractId: "contract-2" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "watch-1" } });

    expect(res.status).toBe(200);
    expect(mockUpdateWatchTarget).toHaveBeenCalledWith("watch-1", {
      active: undefined,
      primaryContractId: "contract-2",
      attachContractId: undefined,
      removeContractId: undefined,
    });
  });

  it("returns 400 for malformed update requests", async () => {
    mockUpdateWatchTarget.mockRejectedValue(
      new Error("Provide exactly one watch-target update action"),
    );

    const req = new NextRequest("http://localhost/api/watch-targets/watch-1", {
      method: "PATCH",
      body: JSON.stringify({ active: false, primaryContractId: "contract-2" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: { id: "watch-1" } });

    expect(res.status).toBe(400);
  });
});
