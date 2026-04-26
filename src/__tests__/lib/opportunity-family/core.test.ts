import { describe, expect, it } from "vitest";
import {
  attachmentOverlapScore,
  deriveFamilyDecision,
  matchFamilyContracts,
  roleForFamilyMember,
  selectCurrentNotice,
  type FamilyContract,
} from "@/lib/opportunity-family/core";

function makeContract(
  id: string,
  overrides: Partial<FamilyContract> = {},
): FamilyContract {
  return {
    id,
    noticeId: `notice-${id}`,
    solicitationNumber: "SOL-001",
    title: "Cloud migration support",
    agency: "Department of Defense",
    orgPathName: "Department of Defense",
    orgPathCode: "DOD",
    noticeType: "Presolicitation",
    postedDate: "2026-03-01T00:00:00Z",
    responseDeadline: "2026-04-01T00:00:00Z",
    active: true,
    classification: "GOOD",
    reviewedAt: null,
    promoted: false,
    tags: [],
    resourceLinks: ["https://example.com/a.pdf"],
    ...overrides,
  };
}

describe("opportunity-family matching", () => {
  it("groups exact solicitation number + agency matches", () => {
    const result = matchFamilyContracts(
      makeContract("older"),
      makeContract("newer", {
        noticeType: "Solicitation",
        postedDate: "2026-04-01T00:00:00Z",
      }),
    );

    expect(result.isMatch).toBe(true);
    expect(result.requiresReview).toBe(false);
    expect(result.strategy).toBe("solicitation_number");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("falls back to title + agency when solicitation numbers are missing", () => {
    const result = matchFamilyContracts(
      makeContract("a", { solicitationNumber: null }),
      makeContract("b", {
        solicitationNumber: null,
        title: "  CLOUD Migration Support ",
        agency: "department of defense",
      }),
    );

    expect(result.isMatch).toBe(true);
    expect(result.strategy).toBe("title_agency");
    expect(result.requiresReview).toBe(false);
  });

  it("falls back past blank org path codes for title + agency matches", () => {
    const result = matchFamilyContracts(
      makeContract("a", {
        solicitationNumber: null,
        orgPathCode: "",
        orgPathName: "Department of Defense",
        agency: null,
      }),
      makeContract("b", {
        solicitationNumber: null,
        orgPathCode: null,
        orgPathName: "Department of Defense",
        agency: null,
      }),
    );

    expect(result.isMatch).toBe(true);
    expect(result.strategy).toBe("title_agency");
  });

  it("keeps different solicitation numbers separate", () => {
    const result = matchFamilyContracts(
      makeContract("a", { solicitationNumber: "SOL-001" }),
      makeContract("b", { solicitationNumber: "SOL-002" }),
    );

    expect(result.isMatch).toBe(false);
    expect(result.reason).toBe("different solicitation numbers");
  });

  it("requires review for broad vehicle matches with different titles", () => {
    const result = matchFamilyContracts(
      makeContract("a", {
        solicitationNumber: "FA890326SC001",
        title: "SPEED CSO - Open Topic",
      }),
      makeContract("b", {
        solicitationNumber: "FA890326SC001",
        title: "SPEED CSO - Different Call",
      }),
    );

    expect(result.isMatch).toBe(true);
    expect(result.requiresReview).toBe(true);
    expect(result.reason).toContain("broad vehicle");
  });

  it("uses shared attachment overlap as a supporting signal", () => {
    const score = attachmentOverlapScore(
      ["https://example.com/a.pdf", "https://example.com/b.pdf"],
      ["https://example.com/a.pdf", "https://example.com/c.pdf"],
    );

    expect(score).toBe(0.5);

    const result = matchFamilyContracts(
      makeContract("a", {
        solicitationNumber: null,
        title: "First title",
        resourceLinks: ["https://example.com/shared.pdf"],
      }),
      makeContract("b", {
        solicitationNumber: null,
        title: "Second title",
        resourceLinks: ["https://example.com/shared.pdf"],
      }),
    );

    expect(result.isMatch).toBe(true);
    expect(result.strategy).toBe("attachment_overlap");
  });
});

describe("opportunity-family current notice selection", () => {
  it("prefers newer solicitation over older presolicitation", () => {
    const older = makeContract("older", {
      noticeType: "Presolicitation",
      postedDate: "2026-03-01T00:00:00Z",
    });
    const newer = makeContract("newer", {
      noticeType: "Solicitation",
      postedDate: "2026-04-01T00:00:00Z",
    });

    expect(selectCurrentNotice([older, newer])?.id).toBe("newer");
    expect(roleForFamilyMember(older, newer)).toBe("superseded");
  });

  it("does not let deadline status pull current backward to an older notice", () => {
    const older = makeContract("older", {
      noticeType: "Presolicitation",
      postedDate: "2026-03-01T00:00:00Z",
      responseDeadline: "2026-05-15T00:00:00Z",
    });
    const newer = makeContract("newer", {
      noticeType: "Solicitation",
      postedDate: "2026-04-15T00:00:00Z",
      responseDeadline: "2026-04-01T00:00:00Z",
    });

    expect(
      selectCurrentNotice([older, newer], new Date("2026-04-25T00:00:00Z"))
        ?.id,
    ).toBe("newer");
  });

  it("uses later deadline and document count as tie breakers", () => {
    const current = selectCurrentNotice([
      makeContract("short", {
        noticeType: "Solicitation",
        postedDate: "2026-04-01T00:00:00Z",
        responseDeadline: "2026-05-01T00:00:00Z",
        resourceLinks: ["https://example.com/a.pdf"],
      }),
      makeContract("long", {
        noticeType: "Solicitation",
        postedDate: "2026-04-01T00:00:00Z",
        responseDeadline: "2026-05-15T00:00:00Z",
        resourceLinks: ["https://example.com/a.pdf"],
      }),
      makeContract("docs", {
        noticeType: "Solicitation",
        postedDate: "2026-04-01T00:00:00Z",
        responseDeadline: "2026-05-15T00:00:00Z",
        resourceLinks: [
          "https://example.com/a.pdf",
          "https://example.com/b.pdf",
        ],
      }),
    ]);

    expect(current?.id).toBe("docs");
  });

  it("does not choose archived rows unless every member is archived", () => {
    const archivedNewer = makeContract("archived-newer", {
      postedDate: "2026-05-01T00:00:00Z",
      tags: ["ARCHIVED"],
    });
    const activeOlder = makeContract("active-older", {
      postedDate: "2026-04-01T00:00:00Z",
    });

    expect(selectCurrentNotice([archivedNewer, activeOlder])?.id).toBe(
      "active-older",
    );
  });

  it("derives family decision from member actions", () => {
    expect(
      deriveFamilyDecision([
        makeContract("a", { promoted: true }),
        makeContract("b"),
      ]),
    ).toBe("PROMOTE");

    expect(
      deriveFamilyDecision([
        makeContract("a", { tags: ["ARCHIVED"] }),
        makeContract("b", { tags: ["ARCHIVED"] }),
      ]),
    ).toBe("ARCHIVE");
  });
});
