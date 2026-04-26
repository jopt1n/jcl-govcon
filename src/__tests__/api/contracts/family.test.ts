import { vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetOpportunityFamilyForContract } = vi.hoisted(() => ({
  mockGetOpportunityFamilyForContract: vi.fn(),
}));

vi.mock("@/lib/opportunity-family/service", () => ({
  getOpportunityFamilyForContract: mockGetOpportunityFamilyForContract,
}));

import { GET } from "@/app/api/contracts/[id]/family/route";

beforeEach(() => {
  mockGetOpportunityFamilyForContract.mockReset();
});

describe("GET /api/contracts/[id]/family", () => {
  it("returns the current notice, history, and superseded state", async () => {
    mockGetOpportunityFamilyForContract.mockResolvedValue({
      familyId: "family-1",
      source: "inferred",
      summary: {
        totalNotices: 2,
        currentContractId: "newer",
        viewingContractId: "older",
        isViewingCurrent: false,
        newerVersionAvailable: true,
        needsReview: false,
        matchStrategy: "solicitation_number",
        familyDecision: "PROMOTE",
        promoted: false,
        archived: false,
      },
      current: {
        id: "newer",
        classification: "GOOD",
        promoted: false,
        archived: false,
        role: "current",
        documentsCount: 19,
      },
      members: [
        {
          id: "newer",
          classification: "GOOD",
          promoted: false,
          archived: false,
          role: "current",
          documentsCount: 19,
        },
        {
          id: "older",
          classification: "DISCARD",
          promoted: false,
          archived: true,
          role: "superseded",
          documentsCount: 15,
        },
      ],
    });

    const req = new NextRequest(
      "http://localhost/api/contracts/older/family",
    );
    const res = await GET(req, { params: { id: "older" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetOpportunityFamilyForContract).toHaveBeenCalledWith("older");
    expect(data.current.id).toBe("newer");
    expect(data.summary.newerVersionAvailable).toBe(true);
    expect(data.summary.familyDecision).toBe("PROMOTE");
    expect(data.members).toHaveLength(2);
  });

  it("returns 404 when the contract does not exist", async () => {
    mockGetOpportunityFamilyForContract.mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost/api/contracts/missing/family",
    );
    const res = await GET(req, { params: { id: "missing" } });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe("Contract not found");
  });

  it("returns 500 when family lookup fails", async () => {
    mockGetOpportunityFamilyForContract.mockRejectedValue(
      new Error("db failure"),
    );

    const req = new NextRequest("http://localhost/api/contracts/a/family");
    const res = await GET(req, { params: { id: "a" } });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe("Failed to fetch contract family");
  });
});
