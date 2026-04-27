import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    contracts: [] as Record<string, any>[],
    families: [] as Record<string, any>[],
    members: [] as Record<string, any>[],
    pursuits: [] as Record<string, any>[],
    documents: [] as Record<string, any>[],
    stageHistory: [] as Record<string, any>[],
    ids: { pursuit: 0, document: 0, history: 0 },
    selectTables: [] as string[],
  },
}));

function col(table: string, name: string) {
  return `${table}.${name}`;
}

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  asc: vi.fn((arg: unknown) => ({ kind: "asc", arg })),
  desc: vi.fn((arg: unknown) => ({ kind: "desc", arg })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  gte: vi.fn((left: unknown, right: unknown) => ({ kind: "gte", left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({ kind: "ilike", left, right })),
  isNull: vi.fn((arg: unknown) => ({ kind: "isNull", arg })),
  lt: vi.fn((left: unknown, right: unknown) => ({ kind: "lt", left, right })),
  lte: vi.fn((left: unknown, right: unknown) => ({ kind: "lte", left, right })),
  or: vi.fn((...args: unknown[]) => ({ kind: "or", args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    text: strings.join("?"),
    values,
  })),
}));

vi.mock("@/lib/db/schema", () => ({
  auditLog: { __name: "audit_log" },
  contractFamilies: {
    __name: "contract_families",
    id: col("contract_families", "id"),
    currentContractId: col("contract_families", "current_contract_id"),
    decision: col("contract_families", "decision"),
  },
  contractFamilyMembers: {
    __name: "contract_family_members",
    familyId: col("contract_family_members", "family_id"),
    contractId: col("contract_family_members", "contract_id"),
  },
  contracts: {
    __name: "contracts",
    id: col("contracts", "id"),
    noticeId: col("contracts", "notice_id"),
    solicitationNumber: col("contracts", "solicitation_number"),
    title: col("contracts", "title"),
    agency: col("contracts", "agency"),
    noticeType: col("contracts", "notice_type"),
    classification: col("contracts", "classification"),
    responseDeadline: col("contracts", "response_deadline"),
    samUrl: col("contracts", "sam_url"),
    resourceLinks: col("contracts", "resource_links"),
    promoted: col("contracts", "promoted"),
    promotedAt: col("contracts", "promoted_at"),
    tags: col("contracts", "tags"),
    updatedAt: col("contracts", "updated_at"),
    createdAt: col("contracts", "created_at"),
  },
  pursuitContacts: {
    __name: "pursuit_contacts",
    id: col("pursuit_contacts", "id"),
    pursuitId: col("pursuit_contacts", "pursuit_id"),
    isPrimary: col("pursuit_contacts", "is_primary"),
    createdAt: col("pursuit_contacts", "created_at"),
  },
  pursuitDocuments: {
    __name: "pursuit_documents",
    id: col("pursuit_documents", "id"),
    pursuitId: col("pursuit_documents", "pursuit_id"),
    contractId: col("pursuit_documents", "contract_id"),
    sourceUrl: col("pursuit_documents", "source_url"),
    createdAt: col("pursuit_documents", "created_at"),
  },
  pursuitInteractions: {
    __name: "pursuit_interactions",
    pursuitId: col("pursuit_interactions", "pursuit_id"),
    occurredAt: col("pursuit_interactions", "occurred_at"),
  },
  pursuits: {
    __name: "pursuits",
    id: col("pursuits", "id"),
    familyId: col("pursuits", "family_id"),
    currentContractId: col("pursuits", "current_contract_id"),
    stage: col("pursuits", "stage"),
    outcome: col("pursuits", "outcome"),
    nextActionDueAt: col("pursuits", "next_action_due_at"),
    responseDeadline: col("pursuits", "response_deadline"),
    updatedAt: col("pursuits", "updated_at"),
  },
  pursuitStageHistory: {
    __name: "pursuit_stage_history",
    pursuitId: col("pursuit_stage_history", "pursuit_id"),
    changedAt: col("pursuit_stage_history", "changed_at"),
  },
}));

function tableName(table: unknown): string {
  return (table as { __name: string }).__name;
}

function matches(row: Record<string, any>, condition: any): boolean {
  if (!condition) return true;
  if (condition.kind === "and") return condition.args.every((arg: any) => matches(row, arg));
  if (condition.kind !== "eq") return true;
  const left = String(condition.left);
  const key = left.split(".").pop() ?? left;
  const camel = key.replace(/_([a-z])/g, (_match, char) => char.toUpperCase());
  return row[camel] === condition.right;
}

function project(row: Record<string, any>, projection: Record<string, string> | undefined) {
  if (!projection) return row;
  return Object.fromEntries(
    Object.entries(projection).map(([key, column]) => {
      const raw = String(column).split(".").pop() ?? String(column);
      const camel = raw.replace(/_([a-z])/g, (_match, char) => char.toUpperCase());
      return [key, row[camel]];
    }),
  );
}

class SelectBuilder {
  private fromTable = "";
  private condition: unknown;

  constructor(private projection?: Record<string, string>) {}

  from(table: unknown) {
    this.fromTable = tableName(table);
    return this;
  }

  innerJoin() {
    return this;
  }

  where(condition: unknown) {
    this.condition = condition;
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  offset() {
    return this;
  }

  then(resolve: (value: unknown[]) => void, reject: (err: unknown) => void) {
    try {
      resolve(this.execute());
    } catch (err) {
      reject(err);
    }
  }

  private execute() {
    state.selectTables.push(this.fromTable);

    if (this.fromTable === "contracts") {
      return state.contracts
        .filter((row) => matches(row, this.condition))
        .map((row) => project(row, this.projection));
    }
    if (this.fromTable === "contract_families") {
      return state.families
        .filter((row) => matches(row, this.condition))
        .map((row) => project(row, this.projection));
    }
    if (this.fromTable === "contract_family_members") {
      const contractId = (this.condition as any)?.right;
      return state.members
        .filter((member) => !contractId || member.contractId === contractId)
        .map((member) => {
          const family = state.families.find((row) => row.id === member.familyId);
          return {
            familyId: member.familyId,
            currentContractId: family?.currentContractId ?? null,
            contractId: member.contractId,
          };
        });
    }
    if (this.fromTable === "pursuits") {
      const rows = state.pursuits.filter((row) => matches(row, this.condition));
      if (this.projection && "count" in this.projection) {
        return [{ count: rows.length }];
      }
      return rows.map((row) => project(row, this.projection));
    }
    if (this.fromTable === "pursuit_documents") {
      return state.documents
        .filter((row) => matches(row, this.condition))
        .map((row) => project(row, this.projection));
    }
    return [];
  }
}

class InsertBuilder {
  private input: any;
  private conflictDoNothing = false;
  private executed = false;
  private result: unknown[] = [];

  constructor(private table: string) {}

  values(input: any) {
    this.input = input;
    return this;
  }

  onConflictDoNothing() {
    this.conflictDoNothing = true;
    return this;
  }

  returning() {
    return this;
  }

  then(resolve: (value: unknown[]) => void, reject: (err: unknown) => void) {
    try {
      resolve(this.execute());
    } catch (err) {
      reject(err);
    }
  }

  private execute() {
    if (this.executed) return this.result;
    this.executed = true;
    const values = Array.isArray(this.input) ? this.input : [this.input];

    if (this.table === "pursuits") {
      const value = values[0];
      const conflict = state.pursuits.find(
        (row) =>
          (value.familyId && row.familyId === value.familyId) ||
          (value.currentContractId && row.currentContractId === value.currentContractId),
      );
      if (conflict) {
        if (this.conflictDoNothing) return [];
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }
      const row = {
        id: `pursuit-${++state.ids.pursuit}`,
        stage: "NEEDS_DEEP_DIVE",
        outcome: null,
        closedAt: null,
        ...value,
      };
      state.pursuits.push(row);
      this.result = [row];
      return this.result;
    }

    if (this.table === "pursuit_documents") {
      const inserted: Record<string, any>[] = [];
      for (const value of values) {
        const conflict = state.documents.find(
          (row) =>
            row.pursuitId === value.pursuitId && row.sourceUrl === value.sourceUrl,
        );
        if (conflict) {
          if (this.conflictDoNothing) continue;
          throw Object.assign(new Error("duplicate key"), { code: "23505" });
        }
        const row = { id: `doc-${++state.ids.document}`, ...value };
        state.documents.push(row);
        inserted.push(row);
      }
      this.result = inserted;
      return this.result;
    }

    if (this.table === "pursuit_stage_history") {
      for (const value of values) {
        state.stageHistory.push({ id: `history-${++state.ids.history}`, ...value });
      }
    }

    return [];
  }
}

class UpdateBuilder {
  private patch: Record<string, any> = {};
  private condition: unknown;

  constructor(private table: string) {}

  set(patch: Record<string, any>) {
    this.patch = patch;
    return this;
  }

  where(condition: unknown) {
    this.condition = condition;
    return this;
  }

  returning() {
    return this;
  }

  then(resolve: (value: unknown[]) => void, reject: (err: unknown) => void) {
    try {
      resolve(this.execute());
    } catch (err) {
      reject(err);
    }
  }

  private execute() {
    if (this.table !== "pursuits") return [];
    const row = state.pursuits.find((candidate) => matches(candidate, this.condition));
    if (!row) return [];
    Object.assign(row, this.patch);
    return [row];
  }
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((projection?: Record<string, string>) => new SelectBuilder(projection)),
    insert: vi.fn((table: unknown) => new InsertBuilder(tableName(table))),
    update: vi.fn((table: unknown) => new UpdateBuilder(tableName(table))),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/opportunity-family/service", () => ({
  archiveContractFamily: vi.fn(),
  hasOpportunityFamilyTables: vi.fn().mockResolvedValue(true),
}));

import {
  archivePursuitForContract,
  backfillPromotedPursuits,
  listPursuits,
} from "@/lib/pursuits/service";

function seedPromotedFamily() {
  state.contracts.push({
    id: "contract-1",
    noticeId: "notice-1",
    solicitationNumber: "SOL-1",
    title: "Printer supplies BPA",
    agency: "GSA",
    noticeType: "Solicitation",
    classification: "GOOD",
    responseDeadline: new Date("2026-05-01T00:00:00Z"),
    samUrl: "https://sam.gov/opp/contract-1",
    resourceLinks: ["https://example.test/sow.pdf"],
    promoted: true,
    promotedAt: new Date("2026-04-25T00:00:00Z"),
    createdAt: new Date("2026-04-20T00:00:00Z"),
    updatedAt: new Date("2026-04-25T00:00:00Z"),
  });
  state.families.push({
    id: "family-1",
    currentContractId: "contract-1",
    decision: "PROMOTE",
  });
  state.members.push({ familyId: "family-1", contractId: "contract-1" });
}

describe("pursuits service backfill", () => {
  beforeEach(() => {
    state.contracts = [];
    state.families = [];
    state.members = [];
    state.pursuits = [];
    state.documents = [];
    state.stageHistory = [];
    state.ids = { pursuit: 0, document: 0, history: 0 };
    state.selectTables = [];
  });

  it("handles concurrent lazy backfills without duplicate pursuits or documents", async () => {
    seedPromotedFamily();

    await expect(
      Promise.all([backfillPromotedPursuits(), backfillPromotedPursuits()]),
    ).resolves.toHaveLength(2);

    expect(state.pursuits).toHaveLength(1);
    expect(state.pursuits[0]).toMatchObject({
      familyId: "family-1",
      currentContractId: "contract-1",
    });
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0]).toMatchObject({
      pursuitId: state.pursuits[0].id,
      sourceUrl: "https://example.test/sow.pdf",
    });
  });

  it("creates and archives a pursuit when contract archive happens before backfill", async () => {
    seedPromotedFamily();

    const archived = await archivePursuitForContract("contract-1");

    expect(archived).toMatchObject({
      familyId: "family-1",
      currentContractId: "contract-1",
      outcome: "ARCHIVED",
    });
    expect(state.pursuits).toHaveLength(1);
    expect(state.stageHistory).toHaveLength(1);
    expect(state.stageHistory[0]).toMatchObject({
      pursuitId: state.pursuits[0].id,
      toOutcome: "ARCHIVED",
    });
  });

  it("does not repeat the expensive promoted backfill scan once pursuits exist", async () => {
    state.pursuits.push({
      id: "pursuit-existing",
      familyId: null,
      currentContractId: "contract-existing",
      title: "Existing pursuit",
      agency: "GSA",
      solicitationNumber: "SOL-EXISTING",
      noticeType: "Solicitation",
      classification: "GOOD",
      responseDeadline: null,
      samUrl: "https://sam.gov/opp/contract-existing",
      stage: "NEEDS_DEEP_DIVE",
      outcome: null,
      nextActionDueAt: null,
      updatedAt: new Date("2026-04-26T00:00:00Z"),
    });

    await listPursuits({ page: 1, limit: 50 });
    await listPursuits({ page: 1, limit: 50 });

    expect(state.selectTables).not.toContain("contract_families");
    expect(state.selectTables).not.toContain("contracts");
  });
});
