import { vi } from "vitest";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    selectResults: [] as Array<unknown[] | Error>,
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  desc: vi.fn((arg: unknown) => ({ kind: "desc", arg })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({
    kind: "ilike",
    left,
    right,
  })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    kind: "inArray",
    left,
    right,
  })),
  or: vi.fn((...args: unknown[]) => ({ kind: "or", args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    text: strings.join("?"),
    values,
  })),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "contracts.id",
    noticeId: "contracts.notice_id",
    solicitationNumber: "contracts.solicitation_number",
    title: "contracts.title",
    agency: "contracts.agency",
    orgPathName: "contracts.org_path_name",
    orgPathCode: "contracts.org_path_code",
    noticeType: "contracts.notice_type",
    postedDate: "contracts.posted_date",
    responseDeadline: "contracts.response_deadline",
    awardCeiling: "contracts.award_ceiling",
    active: "contracts.active",
    classification: "contracts.classification",
    reviewedAt: "contracts.reviewed_at",
    promoted: "contracts.promoted",
    promotedAt: "contracts.promoted_at",
    tags: "contracts.tags",
    resourceLinks: "contracts.resource_links",
    samUrl: "contracts.sam_url",
    notes: "contracts.notes",
    summary: "contracts.summary",
    actionPlan: "contracts.action_plan",
    status: "contracts.status",
    createdAt: "contracts.created_at",
    updatedAt: "contracts.updated_at",
  },
  contractFamilies: {
    id: "contract_families.id",
    currentContractId: "contract_families.current_contract_id",
    decision: "contract_families.decision",
    needsReview: "contract_families.needs_review",
    matchStrategy: "contract_families.match_strategy",
    updatedAt: "contract_families.updated_at",
  },
  contractFamilyEvents: {
    familyId: "contract_family_events.family_id",
    eventType: "contract_family_events.event_type",
    createdAt: "contract_family_events.created_at",
  },
  contractFamilyMembers: {
    familyId: "contract_family_members.family_id",
    contractId: "contract_family_members.contract_id",
    memberRole: "contract_family_members.member_role",
    matchConfidence: "contract_family_members.match_confidence",
    matchReason: "contract_family_members.match_reason",
  },
}));

type ResolveValue = unknown[];

vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: ResolveValue) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: ResolveValue) => void) =>
            Promise.resolve(resolveValue).then(resolve);
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => {
        const value = mockState.selectResults.shift() ?? [];
        if (value instanceof Error) throw value;
        return createChain(value);
      }),
    },
  };
});

import {
  getOpportunityFamilyForContract,
  listPromotedOpportunityFamilies,
} from "@/lib/opportunity-family/service";
import * as drizzle from "drizzle-orm";

const baseContract = {
  id: "source",
  noticeId: "notice-source",
  solicitationNumber: " sol   001 ",
  title: "Old presolicitation title",
  agency: "Department of Defense",
  orgPathName: "Department of Defense",
  orgPathCode: "DOD",
  noticeType: "Presolicitation",
  postedDate: new Date("2026-03-01T00:00:00Z"),
  responseDeadline: new Date("2026-05-01T00:00:00Z"),
  active: true,
  classification: "GOOD",
  reviewedAt: null,
  promoted: false,
  promotedAt: null,
  tags: [],
  resourceLinks: [],
  samUrl: "https://sam.gov/opp/source",
  notes: null,
  summary: "Base summary",
  actionPlan: null,
  awardCeiling: null,
  status: "IDENTIFIED",
  createdAt: new Date("2026-02-01T00:00:00Z"),
  updatedAt: new Date("2026-03-01T00:00:00Z"),
};

function makePromotedContract(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...baseContract,
    id,
    noticeId: `notice-${id}`,
    title: `Promoted ${id}`,
    promoted: true,
    promotedAt: new Date("2026-04-25T12:00:00Z"),
    postedDate: new Date("2026-04-20T00:00:00Z"),
    createdAt: new Date("2026-04-20T00:00:00Z"),
    updatedAt: new Date("2026-04-25T12:00:00Z"),
    samUrl: `https://sam.gov/opp/${id}`,
    ...overrides,
  };
}

function undefinedTableError(tableName = "contract_family_members") {
  return Object.assign(
    new Error(`relation "${tableName}" does not exist`),
    { code: "42P01" },
  );
}

function permissionError() {
  return Object.assign(
    new Error(
      'Failed query: select "family_id" from "contract_family_members"',
    ),
    { code: "42501" },
  );
}

describe("opportunity-family service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.selectResults = [];
  });

  it("uses canonical solicitation matching when fetching inferred candidates", async () => {
    const successor = {
      ...baseContract,
      id: "successor",
      noticeId: "notice-successor",
      solicitationNumber: "SOL 001",
      title: "Changed solicitation title",
      noticeType: "Solicitation",
      postedDate: new Date("2026-04-01T00:00:00Z"),
      responseDeadline: new Date("2026-05-15T00:00:00Z"),
      samUrl: "https://sam.gov/opp/successor",
    };

    mockState.selectResults = [
      [baseContract],
      [],
      [baseContract, successor],
      [],
    ];

    const family = await getOpportunityFamilyForContract("source");

    expect(family?.members.map((member) => member.id).sort()).toEqual([
      "source",
      "successor",
    ]);
    expect(family?.summary.currentContractId).toBe("successor");

    const solicitationCall = vi
      .mocked(drizzle.sql)
      .mock.calls.find((call) =>
        call[0].join("?").includes("upper(regexp_replace(trim("),
      );
    expect(solicitationCall).toBeDefined();
    expect(solicitationCall?.[0].join("?")).toContain("\\s+");
    expect(solicitationCall?.[1]).toBe("contracts.solicitation_number");
    expect(solicitationCall?.[2]).toBe("SOL 001");
  });

  it("fetches normalized title/agency fallback candidates when solicitation is missing", async () => {
    const source = {
      ...baseContract,
      solicitationNumber: null,
      title: "Cloud Migration Support",
      resourceLinks: [],
    };
    const punctuationVariant = {
      ...source,
      id: "punctuation-variant",
      noticeId: "notice-punctuation-variant",
      title: "Cloud--Migration, Support",
      postedDate: new Date("2026-04-01T00:00:00Z"),
      samUrl: "https://sam.gov/opp/punctuation-variant",
    };

    mockState.selectResults = [
      [source],
      undefinedTableError(),
      [source, punctuationVariant],
      [],
    ];

    const family = await getOpportunityFamilyForContract("source");

    expect(family?.members.map((member) => member.id).sort()).toEqual([
      "punctuation-variant",
      "source",
    ]);

    const sqlCalls = vi.mocked(drizzle.sql).mock.calls;
    const sqlTexts = sqlCalls.map((call) => call[0].join("?"));
    const sqlValues = sqlCalls.flatMap((call) => call.slice(1));
    expect(sqlTexts.some((text) => text.includes("[^a-z0-9]+"))).toBe(true);
    expect(sqlValues).toContain("contracts.org_path_code");
    expect(sqlValues).toContain("cloud migration support");
    expect(sqlValues).toContain("dod");
  });

  it("fetches attachment-overlap candidates when titles differ", async () => {
    const source = {
      ...baseContract,
      solicitationNumber: null,
      title: "Original requirement",
      resourceLinks: ["https://example.com/shared.pdf"],
    };
    const documentVariant = {
      ...source,
      id: "document-variant",
      noticeId: "notice-document-variant",
      title: "Renamed requirement",
      resourceLinks: ["https://example.com/shared.pdf"],
      postedDate: new Date("2026-04-01T00:00:00Z"),
      samUrl: "https://sam.gov/opp/document-variant",
    };

    mockState.selectResults = [
      [source],
      undefinedTableError(),
      [source, documentVariant],
      [],
    ];

    const family = await getOpportunityFamilyForContract("source");

    expect(family?.members.map((member) => member.id).sort()).toEqual([
      "document-variant",
      "source",
    ]);

    const sqlCalls = vi.mocked(drizzle.sql).mock.calls;
    const sqlTexts = sqlCalls.map((call) => call[0].join("?"));
    const sqlValues = sqlCalls.flatMap((call) => call.slice(1));
    expect(sqlValues).toContain("contracts.resource_links");
    expect(sqlTexts.some((text) => text.includes("@>"))).toBe(true);
    expect(sqlValues).toContain(JSON.stringify(["https://example.com/shared.pdf"]));
  });

  it("falls back to inferred families only for missing family tables", async () => {
    mockState.selectResults = [
      [baseContract],
      undefinedTableError(),
      [baseContract],
      [],
    ];

    const family = await getOpportunityFamilyForContract("source");

    expect(family?.source).toBe("inferred");
    expect(family?.members).toHaveLength(1);
  });

  it("surfaces non-missing family-table database errors", async () => {
    mockState.selectResults = [[baseContract], permissionError()];

    await expect(getOpportunityFamilyForContract("source")).rejects.toThrow(
      "Failed query",
    );
  });

  it("lists legacy promoted contracts when family tables are absent", async () => {
    mockState.selectResults = [
      undefinedTableError("contract_families"),
      [makePromotedContract("legacy-1")],
    ];

    const result = await listPromotedOpportunityFamilies({ page: 1, limit: 50 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      familyId: "legacy-legacy-1",
      decision: "PROMOTE",
      totalNotices: 1,
      current: {
        id: "legacy-1",
        promoted: true,
      },
    });
    expect(result.pagination.total).toBe(1);
  });

  it("lists legacy promoted contracts when family tables exist but are empty", async () => {
    mockState.selectResults = [
      [],
      [makePromotedContract("legacy-1")],
      [],
    ];

    const result = await listPromotedOpportunityFamilies({ page: 1, limit: 50 });

    expect(result.data.map((item) => item.familyId)).toEqual([
      "legacy-legacy-1",
    ]);
    expect(result.pagination.totalPages).toBe(1);
  });

  it("adds promoted contracts that are not represented by family members", async () => {
    const current = makePromotedContract("family-current", {
      promoted: false,
      promotedAt: null,
      title: "Persisted family current notice",
    });
    const legacy = makePromotedContract("legacy-1", {
      promotedAt: new Date("2026-04-26T12:00:00Z"),
    });

    mockState.selectResults = [
      [
        {
          id: "family-1",
          currentContractId: "family-current",
          decision: "PROMOTE",
          needsReview: false,
          updatedAt: new Date("2026-04-24T12:00:00Z"),
        },
      ],
      [{ familyId: "family-1", contract: current }],
      [],
      [legacy],
      [],
    ];

    const result = await listPromotedOpportunityFamilies({ page: 1, limit: 50 });

    expect(result.data.map((item) => item.familyId).sort()).toEqual([
      "family-1",
      "legacy-legacy-1",
    ]);
    expect(result.pagination.total).toBe(2);
  });

  it("does not duplicate promoted contracts that already belong to a family", async () => {
    const promotedMember = makePromotedContract("promoted-member");

    mockState.selectResults = [
      [
        {
          id: "family-1",
          currentContractId: "promoted-member",
          decision: "PROMOTE",
          needsReview: false,
          updatedAt: new Date("2026-04-24T12:00:00Z"),
        },
      ],
      [{ familyId: "family-1", contract: promotedMember }],
      [],
      [promotedMember],
      [{ contractId: "promoted-member" }],
    ];

    const result = await listPromotedOpportunityFamilies({ page: 1, limit: 50 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].familyId).toBe("family-1");
    expect(result.data[0].current.id).toBe("promoted-member");
    expect(result.pagination.total).toBe(1);
  });
});
