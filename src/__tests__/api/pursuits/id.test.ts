import { vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetPursuitDetail, mockUpdatePursuit } = vi.hoisted(() => ({
  mockGetPursuitDetail: vi.fn(),
  mockUpdatePursuit: vi.fn(),
}));

vi.mock("@/lib/pursuits/service", () => ({
  getPursuitDetail: mockGetPursuitDetail,
  updatePursuit: mockUpdatePursuit,
}));

import { GET, PATCH } from "@/app/api/pursuits/[id]/route";

beforeEach(() => {
  mockGetPursuitDetail.mockReset();
  mockUpdatePursuit.mockReset();
});

describe("GET /api/pursuits/[id]", () => {
  it("returns pursuit detail", async () => {
    mockGetPursuitDetail.mockResolvedValue({
      pursuit: { id: "pursuit-1" },
      contacts: [],
      interactions: [],
      documents: [],
      stageHistory: [],
    });

    const req = new NextRequest("http://localhost/api/pursuits/pursuit-1");
    const res = await GET(req, { params: { id: "pursuit-1" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.pursuit.id).toBe("pursuit-1");
  });

  it("returns 404 when missing", async () => {
    mockGetPursuitDetail.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/pursuits/missing");
    const res = await GET(req, { params: { id: "missing" } });

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/pursuits/[id]", () => {
  it("updates stage, outcome, next action, and cash burden", async () => {
    mockUpdatePursuit.mockResolvedValue({ pursuit: { id: "pursuit-1" } });
    const req = new NextRequest("http://localhost/api/pursuits/pursuit-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "OUTREACH_SENT",
        outcome: "NO_BID",
        nextAction: "Log no-bid reason",
        nextActionDueAt: "2026-05-01T00:00:00.000Z",
        cashBurden: "LOW",
      }),
    });
    const res = await PATCH(req, { params: { id: "pursuit-1" } });

    expect(res.status).toBe(200);
    expect(mockUpdatePursuit).toHaveBeenCalledWith(
      "pursuit-1",
      expect.objectContaining({
        stage: "OUTREACH_SENT",
        outcome: "NO_BID",
        nextAction: "Log no-bid reason",
        cashBurden: "LOW",
      }),
    );
    expect(
      mockUpdatePursuit.mock.calls[0][1].nextActionDueAt.toISOString(),
    ).toBe("2026-05-01T00:00:00.000Z");
  });

  it("rejects CLOSED as a collapsed terminal stage", async () => {
    const req = new NextRequest("http://localhost/api/pursuits/pursuit-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "CLOSED" }),
    });
    const res = await PATCH(req, { params: { id: "pursuit-1" } });

    expect(res.status).toBe(400);
    expect(mockUpdatePursuit).not.toHaveBeenCalled();
  });

  it("allows clearing final outcome without changing active stage", async () => {
    mockUpdatePursuit.mockResolvedValue({ pursuit: { id: "pursuit-1" } });
    const req = new NextRequest("http://localhost/api/pursuits/pursuit-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: null }),
    });
    const res = await PATCH(req, { params: { id: "pursuit-1" } });

    expect(res.status).toBe(200);
    expect(mockUpdatePursuit).toHaveBeenCalledWith("pursuit-1", {
      outcome: null,
    });
  });
});
