import { vi } from "vitest";
import { NextRequest } from "next/server";

const { mockListPromotedOpportunityFamilies } = vi.hoisted(() => ({
  mockListPromotedOpportunityFamilies: vi.fn(),
}));

vi.mock("@/lib/opportunity-family/service", () => ({
  listPromotedOpportunityFamilies: mockListPromotedOpportunityFamilies,
}));

import { GET } from "@/app/api/opportunity-families/route";

beforeEach(() => {
  mockListPromotedOpportunityFamilies.mockReset();
});

describe("GET /api/opportunity-families", () => {
  it("returns promoted family summaries", async () => {
    mockListPromotedOpportunityFamilies.mockResolvedValue({
      data: [
        {
          familyId: "family-1",
          decision: "PROMOTE",
          totalNotices: 2,
          current: { id: "contract-2", title: "Current notice" },
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    const req = new NextRequest(
      "http://localhost/api/opportunity-families?decision=PROMOTE",
    );
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockListPromotedOpportunityFamilies).toHaveBeenCalledWith({
      page: 1,
      limit: 50,
    });
    expect(data.data).toHaveLength(1);
    expect(data.data[0].familyId).toBe("family-1");
  });

  it("returns 400 for unsupported decisions", async () => {
    const req = new NextRequest(
      "http://localhost/api/opportunity-families?decision=ARCHIVE",
    );
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid decision");
    expect(mockListPromotedOpportunityFamilies).not.toHaveBeenCalled();
  });
});
