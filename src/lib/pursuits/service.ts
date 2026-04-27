import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  contractFamilies,
  contractFamilyMembers,
  contracts,
  pursuitContacts,
  pursuitDocuments,
  pursuitInteractions,
  pursuits,
  pursuitStageHistory,
} from "@/lib/db/schema";
import {
  archiveContractFamily,
  hasOpportunityFamilyTables,
} from "@/lib/opportunity-family/service";
import type {
  CashBurden,
  DeadlineFilter,
  PursuitContactRole,
  PursuitInteractionType,
  PursuitOutcome,
  PursuitStage,
} from "./types";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

type ContractProjection = {
  id: string;
  noticeId: string;
  solicitationNumber: string | null;
  title: string;
  agency: string | null;
  noticeType: string | null;
  classification: "GOOD" | "MAYBE" | "DISCARD" | "PENDING";
  responseDeadline: Date | null;
  samUrl: string;
  resourceLinks: string[] | null;
  promotedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

type PursuitRow = typeof pursuits.$inferSelect;

export class PursuitStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PursuitStateError";
  }
}

export type PursuitListFilters = {
  page: number;
  limit: number;
  stage?: PursuitStage;
  outcome?: PursuitOutcome;
  includeHistory?: boolean;
  cashBurden?: CashBurden;
  contractType?: string;
  contactStatus?: string;
  deadline?: DeadlineFilter;
  search?: string;
};

export type PursuitUpdateInput = {
  stage?: PursuitStage;
  outcome?: PursuitOutcome | null;
  nextAction?: string | null;
  nextActionDueAt?: Date | null;
  contractType?: string;
  cashBurden?: CashBurden;
  contactStatus?: string;
  internalNotes?: string | null;
  historyNote?: string | null;
};

export type PursuitContactInput = {
  role: PursuitContactRole;
  name?: string | null;
  organization?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  url?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
};

export type PursuitInteractionInput = {
  contactId?: string | null;
  type: PursuitInteractionType;
  occurredAt?: Date;
  subject?: string | null;
  body?: string | null;
  metadata?: unknown;
};

export type PursuitDocumentInput = {
  contractId?: string | null;
  sourceUrl: string;
  fileName?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  extractedText?: string | null;
  objectKey?: string | null;
  storageProvider?: string | null;
};

const contractProjection = {
  id: contracts.id,
  noticeId: contracts.noticeId,
  solicitationNumber: contracts.solicitationNumber,
  title: contracts.title,
  agency: contracts.agency,
  noticeType: contracts.noticeType,
  classification: contracts.classification,
  responseDeadline: contracts.responseDeadline,
  samUrl: contracts.samUrl,
  resourceLinks: contracts.resourceLinks,
  promotedAt: contracts.promotedAt,
  updatedAt: contracts.updatedAt,
  createdAt: contracts.createdAt,
};

function isMissingFamilyTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("contract_families") ||
    message.includes("contract_family_members") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function filenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    const last = url.split("/").filter(Boolean).pop();
    return last || null;
  }
}

async function readContract(
  contractId: string,
  executor: DbExecutor = db,
): Promise<ContractProjection | null> {
  const rows = await executor
    .select(contractProjection)
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  return (rows[0] as ContractProjection | undefined) ?? null;
}

async function readFamilyForContract(
  contractId: string,
  executor: DbExecutor = db,
): Promise<{ familyId: string; currentContractId: string | null } | null> {
  try {
    const rows = await executor
      .select({
        familyId: contractFamilyMembers.familyId,
        currentContractId: contractFamilies.currentContractId,
      })
      .from(contractFamilyMembers)
      .innerJoin(
        contractFamilies,
        eq(contractFamilies.id, contractFamilyMembers.familyId),
      )
      .where(eq(contractFamilyMembers.contractId, contractId))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    if (isMissingFamilyTableError(err)) return null;
    throw err;
  }
}

async function findExistingPursuit(
  familyId: string | null,
  currentContractId: string,
  executor: DbExecutor = db,
): Promise<PursuitRow | null> {
  if (familyId) {
    const rows = await executor
      .select()
      .from(pursuits)
      .where(eq(pursuits.familyId, familyId))
      .limit(1);
    if (rows[0]) return rows[0] as PursuitRow;
  }

  const rows = await executor
    .select()
    .from(pursuits)
    .where(eq(pursuits.currentContractId, currentContractId))
    .limit(1);
  return (rows[0] as PursuitRow | undefined) ?? null;
}

async function seedPursuitDocuments(
  pursuitId: string,
  contract: ContractProjection,
  executor: DbExecutor = db,
) {
  const links = Array.from(new Set((contract.resourceLinks ?? []).filter(Boolean)));
  if (links.length === 0) return;

  await executor
    .insert(pursuitDocuments)
    .values(
      links.map((sourceUrl) => ({
        pursuitId,
        contractId: contract.id,
        sourceUrl,
        fileName: filenameFromUrl(sourceUrl),
      })),
    )
    .onConflictDoNothing();
}

export async function ensurePursuitForContract(
  contractId: string,
  options: { reactivate?: boolean; executor?: DbExecutor } = {},
): Promise<PursuitRow | null> {
  const executor = options.executor ?? db;
  const source = await readContract(contractId, executor);
  if (!source) return null;

  const family = await readFamilyForContract(contractId, executor);
  const current =
    family?.currentContractId && family.currentContractId !== source.id
      ? (await readContract(family.currentContractId, executor)) ?? source
      : source;

  const existing = await findExistingPursuit(
    family?.familyId ?? null,
    current.id,
    executor,
  );

  if (existing) {
    if (options.reactivate) {
      const [updated] = await executor
        .update(pursuits)
        .set({
          familyId: family?.familyId ?? existing.familyId,
          currentContractId: current.id,
          title: current.title,
          agency: current.agency,
          solicitationNumber: current.solicitationNumber,
          noticeType: current.noticeType,
          classification: current.classification,
          responseDeadline: current.responseDeadline,
          samUrl: current.samUrl,
          outcome: null,
          closedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(pursuits.id, existing.id))
        .returning();
      await seedPursuitDocuments(updated.id, current, executor);
      return updated as PursuitRow;
    }

    await seedPursuitDocuments(existing.id, current, executor);
    return existing;
  }

  const [created] = await executor
    .insert(pursuits)
    .values({
      familyId: family?.familyId ?? null,
      currentContractId: current.id,
      title: current.title,
      agency: current.agency,
      solicitationNumber: current.solicitationNumber,
      noticeType: current.noticeType,
      classification: current.classification,
      responseDeadline: current.responseDeadline,
      samUrl: current.samUrl,
      promotedAt: current.promotedAt ?? new Date(),
    })
    .onConflictDoNothing()
    .returning();

  const pursuit =
    (created as PursuitRow | undefined) ??
    (await findExistingPursuit(family?.familyId ?? null, current.id, executor));
  if (!pursuit) return null;

  await seedPursuitDocuments(pursuit.id, current, executor);
  return pursuit;
}

export async function backfillPromotedPursuits(): Promise<{
  families: number;
  legacyContracts: number;
}> {
  let families = 0;
  let legacyContracts = 0;

  try {
    const familyRows = await db
      .select({
        currentContractId: contractFamilies.currentContractId,
      })
      .from(contractFamilies)
      .where(eq(contractFamilies.decision, "PROMOTE"));

    for (const family of familyRows) {
      if (!family.currentContractId) continue;
      const pursuit = await ensurePursuitForContract(family.currentContractId, {
        reactivate: false,
      });
      if (pursuit) families++;
    }
  } catch (err) {
    if (!isMissingFamilyTableError(err)) throw err;
  }

  const legacyRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.promoted, true));

  for (const row of legacyRows) {
    const pursuit = await ensurePursuitForContract(row.id, {
      reactivate: false,
    });
    if (pursuit) legacyContracts++;
  }

  return { families, legacyContracts };
}

export async function listPursuits(filters: PursuitListFilters) {
  await backfillPromotedPursuits();

  const conditions: SQL[] = [];
  if (filters.stage) conditions.push(eq(pursuits.stage, filters.stage));
  if (filters.outcome) {
    conditions.push(eq(pursuits.outcome, filters.outcome));
  } else if (!filters.includeHistory) {
    conditions.push(isNull(pursuits.outcome));
  }
  if (filters.cashBurden) {
    conditions.push(eq(pursuits.cashBurden, filters.cashBurden));
  }
  if (filters.contractType) {
    conditions.push(eq(pursuits.contractType, filters.contractType));
  }
  if (filters.contactStatus) {
    conditions.push(eq(pursuits.contactStatus, filters.contactStatus));
  }
  if (filters.search) {
    conditions.push(
      or(
        ilike(pursuits.title, `%${filters.search}%`),
        ilike(pursuits.agency, `%${filters.search}%`),
        ilike(pursuits.solicitationNumber, `%${filters.search}%`),
      ) as SQL,
    );
  }

  const now = new Date();
  if (filters.deadline === "overdue") {
    conditions.push(lt(pursuits.responseDeadline, now));
  } else if (filters.deadline === "week") {
    const week = new Date(now);
    week.setUTCDate(week.getUTCDate() + 7);
    conditions.push(gte(pursuits.responseDeadline, now));
    conditions.push(lte(pursuits.responseDeadline, week));
  } else if (filters.deadline === "month") {
    const month = new Date(now);
    month.setUTCDate(month.getUTCDate() + 30);
    conditions.push(gte(pursuits.responseDeadline, now));
    conditions.push(lte(pursuits.responseDeadline, month));
  } else if (filters.deadline === "none") {
    conditions.push(isNull(pursuits.responseDeadline));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (filters.page - 1) * filters.limit;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(pursuits)
      .where(whereClause)
      .orderBy(
        sql`${pursuits.nextActionDueAt} IS NULL`,
        asc(pursuits.nextActionDueAt),
        desc(pursuits.updatedAt),
      )
      .limit(filters.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(pursuits)
      .where(whereClause),
  ]);

  const total = countRows[0]?.count ?? 0;
  return {
    data: rows,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    },
  };
}

export async function getPursuitDetail(pursuitId: string) {
  const [pursuit] = await db
    .select()
    .from(pursuits)
    .where(eq(pursuits.id, pursuitId))
    .limit(1);
  if (!pursuit) return null;

  const [currentContract, contacts, interactions, documents, stageHistory] =
    await Promise.all([
      pursuit.currentContractId
        ? db
            .select(contractProjection)
            .from(contracts)
            .where(eq(contracts.id, pursuit.currentContractId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select()
        .from(pursuitContacts)
        .where(eq(pursuitContacts.pursuitId, pursuitId))
        .orderBy(desc(pursuitContacts.isPrimary), asc(pursuitContacts.createdAt)),
      db
        .select()
        .from(pursuitInteractions)
        .where(eq(pursuitInteractions.pursuitId, pursuitId))
        .orderBy(desc(pursuitInteractions.occurredAt)),
      db
        .select()
        .from(pursuitDocuments)
        .where(eq(pursuitDocuments.pursuitId, pursuitId))
        .orderBy(asc(pursuitDocuments.createdAt)),
      db
        .select()
        .from(pursuitStageHistory)
        .where(eq(pursuitStageHistory.pursuitId, pursuitId))
        .orderBy(desc(pursuitStageHistory.changedAt)),
    ]);

  return {
    pursuit,
    currentContract: currentContract[0] ?? null,
    contacts,
    interactions,
    documents,
    stageHistory,
  };
}

async function archiveContractProjection(
  contractId: string,
  executor: DbExecutor,
) {
  await executor
    .update(contracts)
    .set({
      tags: sql`CASE
        WHEN COALESCE(${contracts.tags}, '[]'::jsonb) @> '["ARCHIVED"]'::jsonb
        THEN COALESCE(${contracts.tags}, '[]'::jsonb)
        ELSE COALESCE(${contracts.tags}, '[]'::jsonb) || '["ARCHIVED"]'::jsonb
      END`,
      promoted: false,
      promotedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, contractId));
}

export async function updatePursuit(
  pursuitId: string,
  input: PursuitUpdateInput,
) {
  const [existing] = await db
    .select()
    .from(pursuits)
    .where(eq(pursuits.id, pursuitId))
    .limit(1);
  if (!existing) return null;
  if (input.outcome === null && existing.outcome !== null) {
    throw new PursuitStateError(
      "Terminal outcomes cannot be cleared directly in Phase 1",
    );
  }

  const updates: Partial<typeof pursuits.$inferInsert> = { updatedAt: new Date() };
  if (input.stage !== undefined) updates.stage = input.stage;
  if (input.outcome !== undefined) {
    updates.outcome = input.outcome;
    updates.closedAt = input.outcome ? new Date() : null;
  }
  if (input.nextAction !== undefined) updates.nextAction = cleanText(input.nextAction);
  if (input.nextActionDueAt !== undefined) {
    updates.nextActionDueAt = input.nextActionDueAt;
  }
  if (input.contractType !== undefined) {
    updates.contractType = cleanText(input.contractType) ?? "UNKNOWN";
  }
  if (input.cashBurden !== undefined) updates.cashBurden = input.cashBurden;
  if (input.contactStatus !== undefined) {
    updates.contactStatus = cleanText(input.contactStatus) ?? "UNKNOWN";
  }
  if (input.internalNotes !== undefined) {
    updates.internalNotes = cleanText(input.internalNotes);
  }

  const stageChanged =
    input.stage !== undefined && input.stage !== existing.stage;
  const outcomeChanged =
    input.outcome !== undefined && input.outcome !== existing.outcome;
  const archiveFamily =
    input.outcome === "ARCHIVED" && Boolean(existing.currentContractId);
  const runFamilyArchive = archiveFamily ? await hasOpportunityFamilyTables() : false;

  await db.transaction(async (tx) => {
    await tx.update(pursuits).set(updates).where(eq(pursuits.id, pursuitId));

    if (stageChanged || outcomeChanged) {
      await tx.insert(pursuitStageHistory).values({
        pursuitId,
        fromStage: existing.stage,
        toStage: input.stage ?? existing.stage,
        fromOutcome: existing.outcome,
        toOutcome:
          input.outcome === undefined ? existing.outcome : input.outcome,
        note: cleanText(input.historyNote),
      });

      await tx.insert(pursuitInteractions).values({
        pursuitId,
        type:
          input.outcome === "NO_BID"
            ? "NO_BID_DECISION"
            : "STAGE_CHANGED",
        subject: "Pursuit state updated",
        body: cleanText(input.historyNote),
        metadata: {
          fromStage: existing.stage,
          toStage: input.stage ?? existing.stage,
          fromOutcome: existing.outcome,
          toOutcome:
            input.outcome === undefined ? existing.outcome : input.outcome,
        },
      });
    }

    if (input.outcome === "ARCHIVED" && existing.currentContractId) {
      await archiveContractProjection(existing.currentContractId, tx);
      await tx.insert(auditLog).values({
        contractId: existing.currentContractId,
        action: "demote",
        metadata: { reason: "pursuit_archive" },
      });
      if (runFamilyArchive) {
        await archiveContractFamily(existing.currentContractId, tx);
      }
    }
  });

  return getPursuitDetail(pursuitId);
}

export async function archivePursuitForContract(
  contractId: string,
  executor: DbExecutor = db,
): Promise<PursuitRow | null> {
  const family = await readFamilyForContract(contractId, executor);
  let rows: PursuitRow[] = [];
  if (family?.familyId) {
    rows = (await executor
      .select()
      .from(pursuits)
      .where(eq(pursuits.familyId, family.familyId))
      .limit(1)) as PursuitRow[];
  }
  if (rows.length === 0) {
    rows = (await executor
      .select()
      .from(pursuits)
      .where(eq(pursuits.currentContractId, contractId))
      .limit(1)) as PursuitRow[];
  }

  const pursuit =
    rows[0] ??
    (await ensurePursuitForContract(contractId, {
      reactivate: false,
      executor,
    }));
  if (!pursuit || pursuit.outcome === "ARCHIVED") return pursuit ?? null;

  const [updated] = await executor
    .update(pursuits)
    .set({
      outcome: "ARCHIVED",
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pursuits.id, pursuit.id))
    .returning();

  await executor.insert(pursuitStageHistory).values({
    pursuitId: pursuit.id,
    fromStage: pursuit.stage,
    toStage: pursuit.stage,
    fromOutcome: pursuit.outcome,
    toOutcome: "ARCHIVED",
    note: "Archived from contract action",
  });

  return (updated as PursuitRow | undefined) ?? null;
}

export async function listPursuitContacts(pursuitId: string) {
  return db
    .select()
    .from(pursuitContacts)
    .where(eq(pursuitContacts.pursuitId, pursuitId))
    .orderBy(desc(pursuitContacts.isPrimary), asc(pursuitContacts.createdAt));
}

export async function pursuitExists(pursuitId: string): Promise<boolean> {
  const rows = await db
    .select({ id: pursuits.id })
    .from(pursuits)
    .where(eq(pursuits.id, pursuitId))
    .limit(1);
  return rows.length > 0;
}

export async function pursuitContactBelongsToPursuit(
  pursuitId: string,
  contactId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: pursuitContacts.id })
    .from(pursuitContacts)
    .where(
      and(
        eq(pursuitContacts.id, contactId),
        eq(pursuitContacts.pursuitId, pursuitId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function contractBelongsToPursuit(
  pursuitId: string,
  contractId: string,
): Promise<boolean> {
  const [pursuit] = await db
    .select({
      currentContractId: pursuits.currentContractId,
      familyId: pursuits.familyId,
    })
    .from(pursuits)
    .where(eq(pursuits.id, pursuitId))
    .limit(1);
  if (!pursuit) return false;
  if (pursuit.currentContractId === contractId) return true;
  if (!pursuit.familyId) return false;

  try {
    const rows = await db
      .select({ contractId: contractFamilyMembers.contractId })
      .from(contractFamilyMembers)
      .where(
        and(
          eq(contractFamilyMembers.familyId, pursuit.familyId),
          eq(contractFamilyMembers.contractId, contractId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    if (isMissingFamilyTableError(err)) return false;
    throw err;
  }
}

export async function createPursuitContact(
  pursuitId: string,
  input: PursuitContactInput,
) {
  const [row] = await db
    .insert(pursuitContacts)
    .values({
      pursuitId,
      role: input.role,
      name: cleanText(input.name),
      organization: cleanText(input.organization),
      title: cleanText(input.title),
      email: cleanText(input.email),
      phone: cleanText(input.phone),
      url: cleanText(input.url),
      notes: cleanText(input.notes),
      isPrimary: Boolean(input.isPrimary),
    })
    .returning();
  return row;
}

export async function updatePursuitContact(
  pursuitId: string,
  contactId: string,
  input: Partial<PursuitContactInput>,
) {
  const updates: Partial<typeof pursuitContacts.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.role !== undefined) updates.role = input.role;
  if (input.name !== undefined) updates.name = cleanText(input.name);
  if (input.organization !== undefined) {
    updates.organization = cleanText(input.organization);
  }
  if (input.title !== undefined) updates.title = cleanText(input.title);
  if (input.email !== undefined) updates.email = cleanText(input.email);
  if (input.phone !== undefined) updates.phone = cleanText(input.phone);
  if (input.url !== undefined) updates.url = cleanText(input.url);
  if (input.notes !== undefined) updates.notes = cleanText(input.notes);
  if (input.isPrimary !== undefined) updates.isPrimary = input.isPrimary;

  const [row] = await db
    .update(pursuitContacts)
    .set(updates)
    .where(
      and(
        eq(pursuitContacts.id, contactId),
        eq(pursuitContacts.pursuitId, pursuitId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deletePursuitContact(
  pursuitId: string,
  contactId: string,
) {
  const rows = await db
    .delete(pursuitContacts)
    .where(
      and(
        eq(pursuitContacts.id, contactId),
        eq(pursuitContacts.pursuitId, pursuitId),
      ),
    )
    .returning();
  return rows.length > 0;
}

export async function listPursuitInteractions(pursuitId: string) {
  return db
    .select()
    .from(pursuitInteractions)
    .where(eq(pursuitInteractions.pursuitId, pursuitId))
    .orderBy(desc(pursuitInteractions.occurredAt));
}

export async function createPursuitInteraction(
  pursuitId: string,
  input: PursuitInteractionInput,
) {
  const [row] = await db
    .insert(pursuitInteractions)
    .values({
      pursuitId,
      contactId: input.contactId ?? null,
      type: input.type,
      occurredAt: input.occurredAt ?? new Date(),
      subject: cleanText(input.subject),
      body: cleanText(input.body),
      metadata: input.metadata ?? null,
    })
    .returning();
  return row;
}

export async function listPursuitDocuments(pursuitId: string) {
  return db
    .select()
    .from(pursuitDocuments)
    .where(eq(pursuitDocuments.pursuitId, pursuitId))
    .orderBy(asc(pursuitDocuments.createdAt));
}

export async function createPursuitDocument(
  pursuitId: string,
  input: PursuitDocumentInput,
) {
  const values = {
    pursuitId,
    contractId: input.contractId ?? null,
    sourceUrl: input.sourceUrl,
    fileName: cleanText(input.fileName) ?? filenameFromUrl(input.sourceUrl),
    contentType: cleanText(input.contentType),
    sizeBytes: input.sizeBytes ?? null,
    sha256: cleanText(input.sha256),
    extractedText: cleanText(input.extractedText),
    objectKey: cleanText(input.objectKey),
    storageProvider: cleanText(input.storageProvider),
  };
  const [row] = await db
    .insert(pursuitDocuments)
    .values(values)
    .onConflictDoNothing()
    .returning();
  if (row) return row;

  const [existing] = await db
    .select()
    .from(pursuitDocuments)
    .where(
      and(
        eq(pursuitDocuments.pursuitId, pursuitId),
        eq(pursuitDocuments.sourceUrl, input.sourceUrl),
      ),
    )
    .limit(1);
  return existing ?? null;
}
