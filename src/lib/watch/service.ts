import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  contracts,
  watchEvents,
  watchTargetLinks,
  watchTargets,
} from "@/lib/db/schema";
import {
  summarizeWatchEvent,
  watchSnapshotFromContract,
  watchSnapshotFromTarget,
  watchStatusLabel,
  type WatchSnapshot,
} from "./core";

type ContractFamilyRow = {
  id: string;
  noticeId: string;
  solicitationNumber: string | null;
  title: string;
  agency: string | null;
  noticeType: string | null;
  responseDeadline: Date | null;
  setAsideCode: string | null;
  postedDate: Date;
  classification: string;
  reviewedAt: Date | null;
  samUrl: string;
  resourceLinks: string[] | null;
};

// Any drizzle query-builder: the top-level `db` OR a `tx` passed into a
// `db.transaction(async (tx) => ...)` callback. Both expose the same
// select/insert/update/delete surface used below. Callers that want
// atomicity thread their own `tx` through; callers that don't care can
// omit the argument and the helper runs its own transaction.
type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

type WatchTargetRow = typeof watchTargets.$inferSelect;
type WatchTargetLinkRow = typeof watchTargetLinks.$inferSelect;
type WatchEventRow = typeof watchEvents.$inferSelect;

type WatchContractLinkView = ContractFamilyRow & {
  roles: string[];
  confidence: string | null;
  isPrimary: boolean;
};

export type WatchEventView = {
  id: string;
  eventType: string;
  summary: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  notifiedAt: string | null;
  createdAt: string;
};

export type WatchTargetSummary = {
  id: string;
  sourceContractId: string | null;
  sourceTitle: string;
  sourceAgency: string | null;
  status: string;
  statusLabel: string;
  currentNoticeType: string | null;
  lastCheckedAt: string | null;
  lastAlertedAt: string | null;
  recentChangeSummary: string | null;
  linkedCount: number;
};

export type WatchTargetDetail = {
  id: string;
  active: boolean;
  status: string;
  statusLabel: string;
  watchedAt: string;
  unwatchedAt: string | null;
  lastCheckedAt: string | null;
  lastAlertedAt: string | null;
  source: WatchSnapshot;
  currentSnapshot: WatchSnapshot | null;
  primaryContractId: string | null;
  primaryContract: WatchContractLinkView | null;
  linkedContracts: WatchContractLinkView[];
  recentEvents: WatchEventView[];
};

export type ContractWatchMetadata = {
  watched: boolean;
  watchTargetId: string | null;
  watchStatus: string | null;
  watchLastCheckedAt: Date | null;
  watchLastAlertedAt: Date | null;
};

type ListWatchTargetOptions = {
  includeInactive?: boolean;
  page?: number;
  limit?: number;
};

type UpdateWatchTargetInput = {
  active?: boolean;
  primaryContractId?: string;
  attachContractId?: string;
  removeContractId?: string;
};

const contractFamilySelect = {
  id: contracts.id,
  noticeId: contracts.noticeId,
  solicitationNumber: contracts.solicitationNumber,
  title: contracts.title,
  agency: contracts.agency,
  noticeType: contracts.noticeType,
  responseDeadline: contracts.responseDeadline,
  setAsideCode: contracts.setAsideCode,
  postedDate: contracts.postedDate,
  classification: contracts.classification,
  reviewedAt: contracts.reviewedAt,
  samUrl: contracts.samUrl,
  resourceLinks: contracts.resourceLinks,
};

function serializeSnapshot(
  snapshot: WatchSnapshot | null,
): WatchSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    responseDeadline: snapshot.responseDeadline ?? null,
    resourceUrls: [...(snapshot.resourceUrls ?? [])],
  };
}

function serializeEvent(event: WatchEventRow): WatchEventView {
  const summaryEvent = {
    eventType: event.eventType,
    beforeJson: (event.beforeJson ?? null) as Record<string, unknown> | null,
    afterJson: (event.afterJson ?? null) as Record<string, unknown> | null,
  };
  return {
    id: event.id,
    eventType: event.eventType,
    summary: summarizeWatchEvent(summaryEvent),
    beforeJson: summaryEvent.beforeJson,
    afterJson: summaryEvent.afterJson,
    notifiedAt: event.notifiedAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

async function fetchContractsByIds(
  ids: string[],
): Promise<ContractFamilyRow[]> {
  if (ids.length === 0) return [];
  return db
    .select(contractFamilySelect)
    .from(contracts)
    .where(inArray(contracts.id, ids));
}

async function fetchLinksByWatchTargetIds(
  watchTargetIds: string[],
): Promise<WatchTargetLinkRow[]> {
  if (watchTargetIds.length === 0) return [];
  return db
    .select()
    .from(watchTargetLinks)
    .where(inArray(watchTargetLinks.watchTargetId, watchTargetIds))
    .orderBy(desc(watchTargetLinks.updatedAt));
}

async function fetchRecentEventsByWatchTargetIds(
  watchTargetIds: string[],
): Promise<WatchEventRow[]> {
  if (watchTargetIds.length === 0) return [];
  return db
    .select()
    .from(watchEvents)
    .where(inArray(watchEvents.watchTargetId, watchTargetIds))
    .orderBy(desc(watchEvents.createdAt));
}

function buildLinkedContracts(
  target: WatchTargetRow,
  linkRows: WatchTargetLinkRow[],
  contractRows: ContractFamilyRow[],
): WatchContractLinkView[] {
  const byContractId = new Map(contractRows.map((row) => [row.id, row]));
  const grouped = new Map<
    string,
    {
      contract: ContractFamilyRow;
      roles: Set<string>;
      confidence: string | null;
    }
  >();

  for (const link of linkRows) {
    const contract = byContractId.get(link.contractId);
    if (!contract) continue;
    const current = grouped.get(contract.id) ?? {
      contract,
      roles: new Set<string>(),
      confidence: null,
    };
    current.roles.add(link.linkType);
    current.confidence =
      current.confidence ?? (link.confidence as string | null);
    grouped.set(contract.id, current);
  }

  const linked = Array.from(grouped.values()).map(
    ({ contract, roles, confidence }) => ({
      ...contract,
      roles: Array.from(roles).sort(),
      confidence,
      isPrimary: contract.id === target.primaryContractId,
    }),
  );

  linked.sort((left, right) => {
    const leftRank =
      (left.isPrimary ? 0 : 1) +
      (left.roles.includes("source") ? 0 : 1) +
      (left.roles.includes("manual_candidate") ? 0 : 1);
    const rightRank =
      (right.isPrimary ? 0 : 1) +
      (right.roles.includes("source") ? 0 : 1) +
      (right.roles.includes("manual_candidate") ? 0 : 1);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return right.postedDate.getTime() - left.postedDate.getTime();
  });

  return linked;
}

function buildWatchTargetDetail(
  target: WatchTargetRow,
  linkRows: WatchTargetLinkRow[],
  contractRows: ContractFamilyRow[],
  eventRows: WatchEventRow[],
): WatchTargetDetail {
  const linkedContracts = buildLinkedContracts(target, linkRows, contractRows);
  const primaryContract =
    linkedContracts.find(
      (contract) => contract.id === target.primaryContractId,
    ) ?? null;

  return {
    id: target.id,
    active: target.active,
    status: target.status,
    statusLabel: watchStatusLabel(target.status),
    watchedAt: target.watchedAt.toISOString(),
    unwatchedAt: target.unwatchedAt?.toISOString() ?? null,
    lastCheckedAt: target.lastCheckedAt?.toISOString() ?? null,
    lastAlertedAt: target.lastAlertedAt?.toISOString() ?? null,
    source: watchSnapshotFromTarget(target),
    currentSnapshot: serializeSnapshot(target.currentSnapshot),
    primaryContractId: target.primaryContractId,
    primaryContract,
    linkedContracts,
    recentEvents: eventRows.slice(0, 20).map(serializeEvent),
  };
}

async function readWatchTargetRow(id: string): Promise<WatchTargetRow | null> {
  const rows = await db
    .select()
    .from(watchTargets)
    .where(eq(watchTargets.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getContractWatchMetadata(
  contractId: string,
): Promise<ContractWatchMetadata> {
  const rows = await db
    .select({
      watchTargetId: watchTargets.id,
      status: watchTargets.status,
      lastCheckedAt: watchTargets.lastCheckedAt,
      lastAlertedAt: watchTargets.lastAlertedAt,
      active: watchTargets.active,
      linkType: watchTargetLinks.linkType,
    })
    .from(watchTargetLinks)
    .innerJoin(
      watchTargets,
      eq(watchTargets.id, watchTargetLinks.watchTargetId),
    )
    .where(
      and(
        eq(watchTargetLinks.contractId, contractId),
        eq(watchTargets.active, true),
      ),
    );

  if (rows.length === 0) {
    return {
      watched: false,
      watchTargetId: null,
      watchStatus: null,
      watchLastCheckedAt: null,
      watchLastAlertedAt: null,
    };
  }

  rows.sort((left, right) => {
    const leftRank =
      left.linkType === "primary" ? 0 : left.linkType === "source" ? 1 : 2;
    const rightRank =
      right.linkType === "primary" ? 0 : right.linkType === "source" ? 1 : 2;
    return leftRank - rightRank;
  });

  const first = rows[0];
  return {
    watched: true,
    watchTargetId: first.watchTargetId,
    watchStatus: first.status,
    watchLastCheckedAt: first.lastCheckedAt,
    watchLastAlertedAt: first.lastAlertedAt,
  };
}

export async function listWatchTargets(
  options: ListWatchTargetOptions = {},
): Promise<{
  data: WatchTargetSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = (page - 1) * limit;
  const whereExpr = options.includeInactive
    ? undefined
    : eq(watchTargets.active, true);

  const [targets, countRows] = await Promise.all([
    db
      .select()
      .from(watchTargets)
      .where(whereExpr)
      .orderBy(desc(watchTargets.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchTargets)
      .where(whereExpr),
  ]);

  const targetIds = targets.map((target) => target.id);
  const [linkRows, eventRows] = await Promise.all([
    fetchLinksByWatchTargetIds(targetIds),
    fetchRecentEventsByWatchTargetIds(targetIds),
  ]);

  const linkCountByTargetId = new Map<string, number>();
  for (const link of linkRows) {
    linkCountByTargetId.set(
      link.watchTargetId,
      (linkCountByTargetId.get(link.watchTargetId) ?? 0) + 1,
    );
  }

  const recentEventByTargetId = new Map<string, WatchEventRow>();
  for (const event of eventRows) {
    if (!recentEventByTargetId.has(event.watchTargetId)) {
      recentEventByTargetId.set(event.watchTargetId, event);
    }
  }

  return {
    data: targets.map((target) => {
      const currentSnapshot = serializeSnapshot(target.currentSnapshot);
      const recentEvent = recentEventByTargetId.get(target.id);
      const recentSummary = recentEvent
        ? summarizeWatchEvent({
            eventType: recentEvent.eventType,
            beforeJson: (recentEvent.beforeJson ?? null) as Record<
              string,
              unknown
            > | null,
            afterJson: (recentEvent.afterJson ?? null) as Record<
              string,
              unknown
            > | null,
          })
        : null;
      return {
        id: target.id,
        sourceContractId: target.sourceContractId,
        sourceTitle: target.sourceTitle,
        sourceAgency: target.sourceAgency,
        status: target.status,
        statusLabel: watchStatusLabel(target.status),
        currentNoticeType:
          currentSnapshot?.noticeType ?? target.sourceNoticeType ?? null,
        lastCheckedAt: target.lastCheckedAt?.toISOString() ?? null,
        lastAlertedAt: target.lastAlertedAt?.toISOString() ?? null,
        recentChangeSummary: recentSummary,
        linkedCount: linkCountByTargetId.get(target.id) ?? 0,
      };
    }),
    pagination: {
      page,
      limit,
      total: countRows[0]?.count ?? 0,
      totalPages: Math.ceil((countRows[0]?.count ?? 0) / limit),
    },
  };
}

export async function getWatchTargetDetail(
  id: string,
): Promise<WatchTargetDetail | null> {
  const target = await readWatchTargetRow(id);
  if (!target) return null;

  const linkRows = await fetchLinksByWatchTargetIds([id]);
  const contractRows = await fetchContractsByIds(
    Array.from(new Set(linkRows.map((row) => row.contractId))),
  );
  const eventRows = await fetchRecentEventsByWatchTargetIds([id]);

  return buildWatchTargetDetail(target, linkRows, contractRows, eventRows);
}

export async function createOrActivateWatchTarget(
  contractId: string,
): Promise<WatchTargetDetail> {
  const contractRows = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      solicitationNumber: contracts.solicitationNumber,
      title: contracts.title,
      agency: contracts.agency,
      noticeType: contracts.noticeType,
      responseDeadline: contracts.responseDeadline,
      setAsideCode: contracts.setAsideCode,
      resourceLinks: contracts.resourceLinks,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);

  const contract = contractRows[0];
  if (!contract) {
    throw new Error("Contract not found");
  }

  const sourceSnapshot = watchSnapshotFromContract(contract);
  const now = new Date();

  const targetId = await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(watchTargets)
      .where(eq(watchTargets.sourceContractId, contractId))
      .limit(1);
    const existing = existingRows[0] ?? null;

    if (existing) {
      await tx
        .update(watchTargets)
        .set({
          sourceNoticeId: contract.noticeId,
          sourceSolicitationNumber: contract.solicitationNumber,
          sourceTitle: contract.title,
          sourceAgency: contract.agency,
          sourceNoticeType: contract.noticeType,
          sourceResponseDeadline: contract.responseDeadline,
          sourceSetAsideCode: contract.setAsideCode,
          sourceResourceUrls: contract.resourceLinks ?? [],
          currentSnapshot: sourceSnapshot,
          active: true,
          status: existing.primaryContractId ? "MATCHED" : "MONITORING",
          watchedAt: now,
          unwatchedAt: null,
          updatedAt: now,
        })
        .where(eq(watchTargets.id, existing.id));

      await tx
        .insert(watchTargetLinks)
        .values({
          watchTargetId: existing.id,
          contractId,
          linkType: "source",
          updatedAt: now,
        })
        .onConflictDoNothing();

      if (!existing.active) {
        await tx.insert(auditLog).values({
          contractId,
          action: "watch",
          metadata: { watchTargetId: existing.id },
        });
      }

      return existing.id;
    }

    const inserted = await tx
      .insert(watchTargets)
      .values({
        sourceContractId: contract.id,
        sourceNoticeId: contract.noticeId,
        sourceSolicitationNumber: contract.solicitationNumber,
        sourceTitle: contract.title,
        sourceAgency: contract.agency,
        sourceNoticeType: contract.noticeType,
        sourceResponseDeadline: contract.responseDeadline,
        sourceSetAsideCode: contract.setAsideCode,
        sourceResourceUrls: contract.resourceLinks ?? [],
        currentSnapshot: sourceSnapshot,
        status: "MONITORING",
        active: true,
        watchedAt: now,
        updatedAt: now,
      })
      .returning({ id: watchTargets.id });

    await tx.insert(watchTargetLinks).values({
      watchTargetId: inserted[0].id,
      contractId,
      linkType: "source",
      updatedAt: now,
    });

    await tx.insert(auditLog).values({
      contractId,
      action: "watch",
      metadata: { watchTargetId: inserted[0].id },
    });

    return inserted[0].id;
  });

  const detail = await getWatchTargetDetail(targetId);
  if (!detail) {
    throw new Error("Failed to load created watch target");
  }
  return detail;
}

export async function updateWatchTarget(
  id: string,
  input: UpdateWatchTargetInput,
): Promise<WatchTargetDetail> {
  const target = await readWatchTargetRow(id);
  if (!target) {
    throw new Error("Watch target not found");
  }

  const actions = [
    input.active !== undefined,
    Boolean(input.primaryContractId),
    Boolean(input.attachContractId),
    Boolean(input.removeContractId),
  ].filter(Boolean).length;

  if (actions !== 1) {
    throw new Error("Provide exactly one watch-target update action");
  }

  const now = new Date();

  if (input.active === false) {
    await db.transaction(async (tx) => {
      await deactivateWatchTargetInExecutor(
        tx,
        id,
        target.sourceContractId,
        now,
      );
    });
  } else if (input.attachContractId) {
    const contractRows = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.id, input.attachContractId))
      .limit(1);
    if (contractRows.length === 0) {
      throw new Error("Candidate contract not found");
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(watchTargetLinks)
        .values({
          watchTargetId: id,
          contractId: input.attachContractId!,
          linkType: "manual_candidate",
          updatedAt: now,
        })
        .onConflictDoNothing();

      await tx
        .update(watchTargets)
        .set({
          status:
            target.primaryContractId === input.attachContractId
              ? "MATCHED"
              : "NEEDS_REVIEW",
          updatedAt: now,
        })
        .where(eq(watchTargets.id, id));
    });
  } else if (input.removeContractId) {
    if (input.removeContractId === target.sourceContractId) {
      throw new Error("Cannot remove the source contract from a watch target");
    }
    if (input.removeContractId === target.primaryContractId) {
      throw new Error("Select a different primary contract before removing it");
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(watchTargetLinks)
        .where(
          and(
            eq(watchTargetLinks.watchTargetId, id),
            eq(watchTargetLinks.contractId, input.removeContractId!),
          ),
        );

      await tx
        .update(watchTargets)
        .set({
          updatedAt: now,
        })
        .where(eq(watchTargets.id, id));
    });
  } else if (input.primaryContractId) {
    const [contract] = await db
      .select(contractFamilySelect)
      .from(contracts)
      .where(eq(contracts.id, input.primaryContractId))
      .limit(1);
    if (!contract) {
      throw new Error("Primary contract not found");
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(watchTargetLinks)
        .values({
          watchTargetId: id,
          contractId: input.primaryContractId!,
          linkType: "manual_candidate",
          updatedAt: now,
        })
        .onConflictDoNothing();

      await tx
        .delete(watchTargetLinks)
        .where(
          and(
            eq(watchTargetLinks.watchTargetId, id),
            eq(watchTargetLinks.linkType, "primary"),
          ),
        );

      await tx.insert(watchTargetLinks).values({
        watchTargetId: id,
        contractId: input.primaryContractId!,
        linkType: "primary",
        updatedAt: now,
      });

      await tx
        .update(watchTargets)
        .set({
          primaryContractId: input.primaryContractId,
          status: "MATCHED",
          currentSnapshot: watchSnapshotFromContract(contract),
          updatedAt: now,
        })
        .where(eq(watchTargets.id, id));
    });
  }

  const detail = await getWatchTargetDetail(id);
  if (!detail) {
    throw new Error("Failed to load updated watch target");
  }
  return detail;
}

// Core deactivation: delete the primary link, flip the target inactive, and
// write the `unwatch` audit row. All three statements run on the provided
// executor (db or tx). Callers decide the atomicity boundary — `updateWatchTarget`
// wraps it in its own transaction; `deactivateWatchTargetByContractId` can be
// invoked inside another route's transaction so archive + unwatch are atomic.
async function deactivateWatchTargetInExecutor(
  executor: DbExecutor,
  watchTargetId: string,
  sourceContractId: string | null,
  now: Date,
  reason?: string,
): Promise<void> {
  await executor
    .delete(watchTargetLinks)
    .where(
      and(
        eq(watchTargetLinks.watchTargetId, watchTargetId),
        eq(watchTargetLinks.linkType, "primary"),
      ),
    );

  await executor
    .update(watchTargets)
    .set({
      active: false,
      status: "INACTIVE",
      primaryContractId: null,
      unwatchedAt: now,
      updatedAt: now,
    })
    .where(eq(watchTargets.id, watchTargetId));

  const metadata: Record<string, unknown> = { watchTargetId };
  if (reason !== undefined) metadata.reason = reason;

  await executor.insert(auditLog).values({
    contractId: sourceContractId,
    action: "unwatch",
    metadata,
  });
}

// Public entry point keyed by contract id. Looks up the single active watch
// target whose source is this contract (enforced unique by
// `watch_targets_source_contract_id_idx`) and deactivates it.
//
// If the caller passes an `executor` (a tx), the lookup + mutations run on
// that tx — atomic with whatever surrounding work the caller is doing
// (e.g. archiving the contract). If no executor is passed, the helper runs
// its own transaction so the three writes can't tear.
//
// Returns the deactivated watch target id, or null if there was no active
// watch target sourced from this contract (a cheap no-op for plain rows).
export async function deactivateWatchTargetByContractId(
  contractId: string,
  reason?: string,
  executor?: DbExecutor,
): Promise<{ watchTargetId: string } | null> {
  const run = async (
    exec: DbExecutor,
  ): Promise<{ watchTargetId: string } | null> => {
    const rows = await exec
      .select({
        id: watchTargets.id,
        sourceContractId: watchTargets.sourceContractId,
      })
      .from(watchTargets)
      .where(
        and(
          eq(watchTargets.sourceContractId, contractId),
          eq(watchTargets.active, true),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;

    const { id: watchTargetId, sourceContractId } = rows[0];
    await deactivateWatchTargetInExecutor(
      exec,
      watchTargetId,
      sourceContractId,
      new Date(),
      reason,
    );
    return { watchTargetId };
  };

  if (executor) return run(executor);
  return db.transaction(run);
}
