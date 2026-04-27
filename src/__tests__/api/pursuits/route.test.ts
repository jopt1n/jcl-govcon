import { vi } from "vitest";
import { NextRequest } from "next/server";

const { mockEnsurePursuitForContract, mockListPursuits } = vi.hoisted(() => ({
  mockEnsurePursuitForContract: vi.fn(),
  mockListPursuits: vi.fn(),
}));

vi.mock("@/lib/pursuits/service", () => ({
  ensurePursuitForContract: mockEnsurePursuitForContract,
  listPursuits: mockListPursuits,
}));

import { GET, POST } from "@/app/api/pursuits/route";

beforeEach(() => {
  mockEnsurePursuitForContract.mockReset();
  mockListPursuits.mockReset();
  mockListPursuits.mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
  });
});

describe("GET /api/pursuits", () => {
  it("lists active pursuits with default pagination", async () => {
    const req = new NextRequest("http://localhost/api/pursuits");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockListPursuits).toHaveBeenCalledWith({
      page: 1,
      limit: 50,
      stage: undefined,
      outcome: undefined,
      includeHistory: false,
      cashBurden: undefined,
      contractType: undefined,
      contactStatus: undefined,
      deadline: undefined,
      search: undefined,
    });
  });

  it("passes Phase 1 CRM filters through to the service", async () => {
    const req = new NextRequest(
      "http://localhost/api/pursuits?stage=VENDOR_OUTREACH_NEEDED&cashBurden=OVER_40K&deadline=week&includeHistory=1&contractType=SUPPLIES_RESELLER&contactStatus=QUOTE_REQUESTED&search=printer",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockListPursuits).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "VENDOR_OUTREACH_NEEDED",
        cashBurden: "OVER_40K",
        deadline: "week",
        includeHistory: true,
        contractType: "SUPPLIES_RESELLER",
        contactStatus: "QUOTE_REQUESTED",
        search: "printer",
      }),
    );
  });

  it("rejects invalid enum filters", async () => {
    const req = new NextRequest(
      "http://localhost/api/pursuits?stage=CLOSED&cashBurden=BIG",
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(mockListPursuits).not.toHaveBeenCalled();
  });
});

describe("POST /api/pursuits", () => {
  it("creates or reactivates a pursuit from a contract id", async () => {
    mockEnsurePursuitForContract.mockResolvedValue({ id: "pursuit-1" });
    const req = new NextRequest("http://localhost/api/pursuits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractId: "contract-1" }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.id).toBe("pursuit-1");
    expect(mockEnsurePursuitForContract).toHaveBeenCalledWith("contract-1", {
      reactivate: true,
    });
  });

  it("returns 400 without a contract id", async () => {
    const req = new NextRequest("http://localhost/api/pursuits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockEnsurePursuitForContract).not.toHaveBeenCalled();
  });
});
