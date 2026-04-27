import { vi } from "vitest";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    selectResults: [] as Array<unknown[] | Error>,
    insertResults: [] as Array<unknown[] | Error>,
    updateCalls: [] as Array<{
      table: unknown;
      set?: Record<string, unknown>;
      where?: unknown;
    }>,
    insertCalls: [] as Array<{
      table: unknown;
      values?: unknown;
      returning?: unknown;
    }>,
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
  const createChain = (
    resolveValue: ResolveValue,
    record?: Record<string, unknown>,
  ) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: ResolveValue) => void) =>
            Promise.resolve(resolveValue).then(resolve);
        }
        return vi.fn().mockImplementation((value: unknown) => {
          if (prop === "set" && record) record.set = value;
          if (prop === "where" && record) record.where = value;
          if (prop === "values" && record) record.values = value;
          if (prop === "returning" && record) record.returning = value;
          return new Proxy({}, handler);
        });
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
      update: vi.fn().mockImplementation((table: unknown) => {
        const record = { table };
        mockState.updateCalls.push(record);
        return createChain([], record);
      }),
      insert: vi.fn().mockImplementation((table: unknown) => {
        const value = mockState.insertResults.shift() ?? [];
        if (value instanceof Error) throw value;
        const record = { table };
        mockState.insertCalls.push(record);
        return createChain(value, record);
      }),
    },
  };
});

import {
  getOpportunityFamilyForContract,
  linkContractsToPromotedFamilies,
  listPromotedOpportunityFamilies,
  promoteContractFamily,
  demoteContractFamily,
  PROMOTED_FAMILY_REVIEW_NEEDED_TAG,
  PROMOTED_FAMILY_UPDATE_TAG,
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

function familyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "family-1",
    title: "Family title",
    solicitationNumber: "SOL 001",
    agency: "Department of Defense",
    currentContractId: "source",
    decision: "PROMOTE",
    needsReview: false,
    matchStrategy: "solicitation_number",
    updatedAt: new Date("2026-04-25T12:00:00Z"),
    ...overrides,
  };
}

function memberRow(
  contract: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    memberRole: "current",
    matchConfidence: "1",
    matchReason: "same solicitation number",
    contract,
    ...overrides,
  };
}

function contractProjectionUpdates(promoted: boolean) {
  return mockState.updateCalls.filter(
    (call) =>
      (call.set as { promoted?: boolean } | undefined)?.promoted === promoted,
  );
}

function tagUpdateTexts() {
  return mockState.updateCalls
    .map((call) => (call.set as { tags?: unknown } | undefined)?.tags)
    .filter(Boolean)
    .map((tags) => JSON.stringify(tags));
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
    mockState.insertResults = [];
    mockState.updateCalls = [];
    mockState.insertCalls = [];
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

  it("syncs all family member rows to promoted=true when promoting a family", async () => {
    const otherMember = {
      ...baseContract,
      id: "other",
      noticeId: "notice-other",
      title: "Other family member",
      postedDate: new Date("2026-04-01T00:00:00Z"),
    };

    mockState.selectResults = [
      [baseContract],
      [{ familyId: "family-1" }],
      [familyRow({ decision: "UNREVIEWED" })],
      [
        memberRow(baseContract),
        memberRow(otherMember, { memberRole: "older_version" }),
      ],
    ];

    const result = await promoteContractFamily("source");

    expect(result.familyId).toBe("family-1");
    const [projection] = contractProjectionUpdates(true);
    expect(projection).toBeDefined();
    expect(projection.where).toMatchObject({
      kind: "inArray",
      left: "contracts.id",
      right: ["source", "other"],
    });
  });

  it("syncs all family member rows to promoted=false when demoting a family", async () => {
    const promotedSource = makePromotedContract("source");
    const promotedOther = makePromotedContract("other", {
      title: "Other family member",
    });

    mockState.selectResults = [
      [{ familyId: "family-1" }],
      [familyRow({ decision: "PROMOTE" })],
      [
        memberRow(promotedSource),
        memberRow(promotedOther, { memberRole: "current" }),
      ],
    ];

    const result = await demoteContractFamily("source");

    expect(result.familyId).toBe("family-1");
    const [projection] = contractProjectionUpdates(false);
    expect(projection).toBeDefined();
    expect(projection.set).toMatchObject({
      promoted: false,
      promotedAt: null,
    });
    expect(projection.where).toMatchObject({
      kind: "inArray",
      left: "contracts.id",
      right: ["source", "other"],
    });
  });

  it("syncs a newly linked promoted-family notice to promoted=true", async () => {
    const existing = makePromotedContract("existing", {
      title: "Cloud migration support",
      solicitationNumber: "SOL-001",
      noticeType: "Presolicitation",
      postedDate: new Date("2026-03-01T00:00:00Z"),
    });
    const linked = {
      ...baseContract,
      id: "linked",
      noticeId: "notice-linked",
      title: "Cloud migration support",
      solicitationNumber: "SOL-001",
      noticeType: "Solicitation",
      postedDate: new Date("2026-04-01T00:00:00Z"),
      samUrl: "https://sam.gov/opp/linked",
    };

    mockState.selectResults = [
      [linked],
      [existing],
      [
        {
          familyId: "family-1",
          currentContractId: "existing",
          needsReview: false,
          contract: existing,
        },
      ],
      [familyRow({ currentContractId: "existing" })],
      [memberRow(existing)],
      [],
      [familyRow({ currentContractId: "existing" })],
      [memberRow(existing)],
      [familyRow({ currentContractId: "linked" })],
      [
        memberRow(linked),
        memberRow(existing, { memberRole: "superseded" }),
      ],
    ];

    const result = await linkContractsToPromotedFamilies(["linked"]);

    expect(result).toMatchObject({ linked: 1, needsReview: 0, skipped: 0 });
    const projection = contractProjectionUpdates(true).find((call) =>
      JSON.stringify(call.where).includes("linked"),
    );
    expect(projection).toBeDefined();
    expect(projection?.where).toMatchObject({
      kind: "inArray",
      left: "contracts.id",
      right: ["linked", "existing"],
    });
    expect(tagUpdateTexts().some((text) => text.includes(PROMOTED_FAMILY_UPDATE_TAG))).toBe(
      true,
    );
  });

  it("marks ambiguous promoted-family matches for review without update tagging", async () => {
    const candidate = {
      ...baseContract,
      id: "candidate",
      noticeId: "notice-candidate",
      title: "Cloud migration support",
      solicitationNumber: "SOL-001",
      postedDate: new Date("2026-04-01T00:00:00Z"),
    };
    const matchOne = makePromotedContract("match-one", {
      title: "Cloud migration support",
      solicitationNumber: "SOL-001",
    });
    const matchTwo = makePromotedContract("match-two", {
      title: "Cloud migration support",
      solicitationNumber: "SOL-001",
    });

    mockState.selectResults = [
      [candidate],
      [matchOne, matchTwo],
      [
        {
          familyId: "family-1",
          currentContractId: "match-one",
          needsReview: false,
          contract: matchOne,
        },
        {
          familyId: "family-2",
          currentContractId: "match-two",
          needsReview: false,
          contract: matchTwo,
        },
      ],
    ];

    const result = await linkContractsToPromotedFamilies(["candidate"]);

    expect(result).toMatchObject({ linked: 0, needsReview: 1, skipped: 0 });

    const reviewUpdates = mockState.updateCalls.filter(
      (call) => (call.set as { needsReview?: boolean } | undefined)?.needsReview,
    );
    expect(reviewUpdates).toHaveLength(2);
    expect(tagUpdateTexts().some((text) => text.includes(PROMOTED_FAMILY_REVIEW_NEEDED_TAG))).toBe(
      true,
    );
    expect(tagUpdateTexts().some((text) => text.includes(PROMOTED_FAMILY_UPDATE_TAG))).toBe(
      false,
    );

    const reviewEvents = mockState.insertCalls.filter(
      (call) =>
        (call.values as { eventType?: string } | undefined)?.eventType ===
        "possible_match_needs_review",
    );
    expect(reviewEvents).toHaveLength(2);
    for (const event of reviewEvents) {
      expect(event.values).toMatchObject({
        contractId: "candidate",
        eventType: "possible_match_needs_review",
        afterJson: {
          candidateContractId: "candidate",
          candidateNoticeId: "notice-candidate",
          competingFamilyIds: ["family-1", "family-2"],
          needsReview: true,
        },
      });
    }
  });
});
