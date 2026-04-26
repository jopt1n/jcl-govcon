import {
  and,
  desc,
  eq,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contractFamilies,
  contractFamilyEvents,
  contractFamilyMembers,
  contracts,
} from "@/lib/db/schema";
import {
  agencyKey,
  canonicalSolicitation,
  deriveFamilyDecision,
  documentCount,
  matchFamilyContracts,
  normalizedTitle,
  normalizeUrlSet,
  noticeTypeRank,
  roleForFamilyMember,
  selectCurrentNotice,
  type FamilyContract,
  type FamilyDecision,
  type FamilyMatchResult,
  type FamilyMatchStrategy,
  type FamilyMemberRole,
} from "./core";

export const PROMOTED_FAMILY_UPDATE_TAG = "PROMOTED_FAMILY_UPDATE";

type DbExecutor = Pick<typeof db, "insert" | "select" | "update">;

type ContractRow = FamilyContract & {
  classification: string;
  reviewedAt: Date | null;
  promoted: boolean;
  tags: string[] | null;
  samUrl: string;
  notes: string | null;
  summary: string | null;
  actionPlan: string | null;
  awardCeiling: string | null;
  status: string | null;
  promotedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type FamilyRow = {
  id: string;
  title: string;
  solicitationNumber: string | null;
  agency: string | null;
  currentContractId: string | null;
  decision: FamilyDecision;
  needsReview: boolean;
  matchStrategy: FamilyMatchStrategy;
  updatedAt: Date;
};

type PersistedMember = {
  contract: ContractRow;
  role: FamilyMemberRole;
  confidence: number;
  reason: string | null;
};

export type OpportunityFamilyMember = {
  id: string;
  noticeId: string | null;
  solicitationNumber: string | null;
  title: string;
  agency: string | null;
  noticeType: string | null;
  postedDate: Date | string;
  responseDeadline: Date | string | null;
  active: boolean;
  classification: string;
  reviewedAt: Date | null;
  promoted: boolean;
  archived: boolean;
  tags: string[] | null;
  samUrl: string;
  documentsCount: number;
  role: FamilyMemberRole;
  matchConfidence: number;
  matchReason: string | null;
  isCurrent: boolean;
};

export type OpportunityFamilyResponse = {
  familyId: string | null;
  source: "persisted" | "inferred";
  summary: {
    totalNotices: number;
    currentContractId: string | null;
    viewingContractId: string;
    isViewingCurrent: boolean;
    newerVersionAvailable: boolean;
    needsReview: boolean;
    matchStrategy: FamilyMatchStrategy | null;
    familyDecision: FamilyDecision;
    promoted: boolean;
    archived: boolean;
  };
  current: OpportunityFamilyMember | null;
  members: OpportunityFamilyMember[];
};

export type PromotedFamilySummary = {
  familyId: string;
  decision: "PROMOTE";
  totalNotices: number;
  needsReview: boolean;
  latestEventType: string | null;
  latestEventAt: string | null;
  current: {
    id: string;
    title: string;
    agency: string | null;
    awardCeiling: string | null;
    responseDeadline: Date | string | null;
    noticeType: string | null;
    classification: string;
    aiReasoning: null;
    summary: string | null;
    actionPlan: string | null;
    notes: string | null;
    status: string | null;
    postedDate: Date | string;
    userOverride: false;
    reviewedAt: Date | null;
    promoted: boolean;
    promotedAt: Date | null;
    tags: string[] | null;
    createdAt: Date;
  };
};

export type PromotedFamilyListResponse = {
  data: PromotedFamilySummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const familyContractSelect = {
  id: contracts.id,
  noticeId: contracts.noticeId,
  solicitationNumber: contracts.solicitationNumber,
  title: contracts.title,
  agency: contracts.agency,
  orgPathName: contracts.orgPathName,
  orgPathCode: contracts.orgPathCode,
  noticeType: contracts.noticeType,
  postedDate: contracts.postedDate,
  responseDeadline: contracts.responseDeadline,
  active: contracts.active,
  classification: contracts.classification,
  reviewedAt: contracts.reviewedAt,
  promoted: contracts.promoted,
  tags: contracts.tags,
  resourceLinks: contracts.resourceLinks,
  samUrl: contracts.samUrl,
  notes: contracts.notes,
  summary: contracts.summary,
  actionPlan: contracts.actionPlan,
  awardCeiling: contracts.awardCeiling,
  status: contracts.status,
  promotedAt: contracts.promotedAt,
  createdAt: contracts.createdAt,
  updatedAt: contracts.updatedAt,
};

function isArchived(tags: string[] | null): boolean {
  return (tags ?? []).includes("ARCHIVED");
}

function toConfidence(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingFamilyTableError(err: unknown): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  const familyTableNames = [
    "contract_families",
    "contract_family_members",
    "contract_family_events",
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    const code =
      typeof current === "object" && "code" in current
        ? (current as { code?: unknown }).code
        : null;
    if (code === "42P01") return true;

    const message =
      current instanceof Error ? current.message : String(current);
    const referencesFamilyTable = familyTableNames.some((table) =>
      message.includes(table),
    );
    if (
      !code &&
      referencesFamilyTable &&
      ((message.includes("relation") && message.includes("does not exist")) ||
        message.includes("Failed query"))
    ) {
      return true;
    }

    if (typeof current === "object" && "cause" in current) {
      queue.push((current as { cause?: unknown }).cause);
    }
  }

  return false;
}

export async function hasOpportunityFamilyTables(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT
      to_regclass('contract_families') AS contract_families,
      to_regclass('contract_family_members') AS contract_family_members,
      to_regclass('contract_family_events') AS contract_family_events
  `);

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  const row = rows[0] as
    | {
        contract_families?: string | null;
        contract_family_members?: string | null;
        contract_family_events?: string | null;
      }
    | undefined;

  return Boolean(
    row?.contract_families &&
      row.contract_family_members &&
      row.contract_family_events,
  );
}

async function getContractRow(
  contractId: string,
  executor: DbExecutor = db,
): Promise<ContractRow | null> {
  const rows = await executor
    .select(familyContractSelect)
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  return (rows[0] as ContractRow | undefined) ?? null;
}

async function getContractRows(
  contractIds: string[],
  executor: DbExecutor = db,
): Promise<ContractRow[]> {
  if (contractIds.length === 0) return [];
  const rows = await executor
    .select(familyContractSelect)
    .from(contracts)
    .where(inArray(contracts.id, contractIds));
  return rows as ContractRow[];
}

async function findCandidateContracts(
  source: ContractRow,
  executor: DbExecutor = db,
): Promise<ContractRow[]> {
  const conditions: SQL[] = [];
  const sourceSolicitation = canonicalSolicitation(source.solicitationNumber);
  const sourceTitle = normalizedTitle(source.title);
  const sourceAgency = agencyKey(source);
  const sourceResourceLinks = normalizeUrlSet(source.resourceLinks);

  if (sourceSolicitation) {
    conditions.push(
      sql`upper(regexp_replace(trim(${contracts.solicitationNumber}), '\\s+', ' ', 'g')) = ${sourceSolicitation}`,
    );
  }

  if (sourceTitle && sourceAgency) {
    const normalizedTitleCondition = sql`trim(regexp_replace(regexp_replace(lower(coalesce(${contracts.title}, '')), '[^a-z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) = ${sourceTitle}`;
    const normalizedAgencyCondition = sql`trim(regexp_replace(regexp_replace(lower(coalesce(nullif(${contracts.orgPathCode}, ''), nullif(${contracts.orgPathName}, ''), ${contracts.agency}, '')), '[^a-z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) = ${sourceAgency}`;
    const titleAgencyCondition = and(
      normalizedTitleCondition,
      normalizedAgencyCondition,
    );
    if (titleAgencyCondition) conditions.push(titleAgencyCondition);
  } else if (sourceTitle) {
    conditions.push(
      sql`trim(regexp_replace(regexp_replace(lower(coalesce(${contracts.title}, '')), '[^a-z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) = ${sourceTitle}`,
    );
  }

  if (sourceResourceLinks.length > 0) {
    const resourceLinkConditions = sourceResourceLinks.map(
      (link) =>
        sql`coalesce(${contracts.resourceLinks}, '[]'::jsonb) @> ${JSON.stringify([link])}::jsonb`,
    );
    const resourceLinkCondition =
      resourceLinkConditions.length === 1
        ? resourceLinkConditions[0]
        : or(...resourceLinkConditions);
    if (resourceLinkCondition) conditions.push(resourceLinkCondition);
  }

  const whereClause =
    conditions.length === 0
      ? eq(contracts.id, source.id)
      : conditions.length === 1
        ? conditions[0]
        : (or(...conditions) ?? eq(contracts.id, source.id));

  const rows = await executor
    .select(familyContractSelect)
    .from(contracts)
    .where(whereClause)
    .orderBy(desc(contracts.postedDate))
    .limit(500);

  return rows as ContractRow[];
}

async function getPersistedFamily(
  contractId: string,
  executor: DbExecutor = db,
): Promise<{
  family: FamilyRow | null;
  members: PersistedMember[];
}> {
  try {
    const membershipRows = await executor
      .select({ familyId: contractFamilyMembers.familyId })
      .from(contractFamilyMembers)
      .where(eq(contractFamilyMembers.contractId, contractId))
      .limit(1);

    const membership = membershipRows[0] ?? null;
    if (!membership) {
      return { family: null, members: [] };
    }

    return getFamilyById(String(membership.familyId), executor);
  } catch (err) {
    if (isMissingFamilyTableError(err)) {
      return { family: null, members: [] };
    }
    throw err;
  }
}

async function getFamilyById(
  familyId: string,
  executor: DbExecutor = db,
): Promise<{
  family: FamilyRow | null;
  members: PersistedMember[];
}> {
  const [familyRow] = await executor
    .select({
      id: contractFamilies.id,
      title: contractFamilies.title,
      solicitationNumber: contractFamilies.solicitationNumber,
      agency: contractFamilies.agency,
      currentContractId: contractFamilies.currentContractId,
      decision: contractFamilies.decision,
      needsReview: contractFamilies.needsReview,
      matchStrategy: contractFamilies.matchStrategy,
      updatedAt: contractFamilies.updatedAt,
    })
    .from(contractFamilies)
    .where(eq(contractFamilies.id, familyId))
    .limit(1);

  if (!familyRow) {
    return { family: null, members: [] };
  }

  const rows = await executor
    .select({
      memberRole: contractFamilyMembers.memberRole,
      matchConfidence: contractFamilyMembers.matchConfidence,
      matchReason: contractFamilyMembers.matchReason,
      contract: familyContractSelect,
    })
    .from(contractFamilyMembers)
    .innerJoin(contracts, eq(contracts.id, contractFamilyMembers.contractId))
    .where(eq(contractFamilyMembers.familyId, familyRow.id))
    .orderBy(desc(contracts.postedDate));

  return {
    family: familyRow as FamilyRow,
    members: rows.map((row) => ({
      contract: row.contract as ContractRow,
      role: row.memberRole,
      confidence: toConfidence(row.matchConfidence),
      reason: row.matchReason,
    })),
  };
}

function inferredMemberRows(
  source: ContractRow,
  candidates: ContractRow[],
): Array<{
  contract: ContractRow;
  match: FamilyMatchResult;
}> {
  const byContractId = new Map<
    string,
    { contract: ContractRow; match: FamilyMatchResult }
  >();

  for (const candidate of candidates) {
    const match = matchFamilyContracts(source, candidate);
    if (!match.isMatch) continue;
    const existing = byContractId.get(candidate.id);
    if (!existing || match.confidence > existing.match.confidence) {
      byContractId.set(candidate.id, { contract: candidate, match });
    }
  }

  if (!byContractId.has(source.id)) {
    byContractId.set(source.id, {
      contract: source,
      match: matchFamilyContracts(source, source),
    });
  }

  return Array.from(byContractId.values());
}

function buildMemberView(
  contract: ContractRow,
  current: ContractRow | null,
  role: FamilyMemberRole,
  confidence: number,
  reason: string | null,
): OpportunityFamilyMember {
  return {
    id: contract.id,
    noticeId: contract.noticeId,
    solicitationNumber: contract.solicitationNumber,
    title: contract.title,
    agency: contract.agency,
    noticeType: contract.noticeType,
    postedDate: contract.postedDate,
    responseDeadline: contract.responseDeadline,
    active: contract.active,
    classification: contract.classification,
    reviewedAt: contract.reviewedAt,
    promoted: contract.promoted,
    archived: isArchived(contract.tags),
    tags: contract.tags,
    samUrl: contract.samUrl,
    documentsCount: documentCount(contract),
    role,
    matchConfidence: confidence,
    matchReason: reason,
    isCurrent: Boolean(current && contract.id === current.id),
  };
}

function sortFamilyMembers(members: OpportunityFamilyMember[]) {
  members.sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    return (
      new Date(right.postedDate).getTime() - new Date(left.postedDate).getTime()
    );
  });
}

function familyDecisionForView(
  persistedDecision: FamilyDecision | null,
  members: OpportunityFamilyMember[],
): FamilyDecision {
  if (persistedDecision) return persistedDecision;
  return deriveFamilyDecision(
    members.map((member) => ({
      ...member,
      resourceLinks: null,
    })),
  );
}

function primaryStrategy(
  matches: Array<{ match: FamilyMatchResult }>,
): FamilyMatchStrategy {
  return (
    matches
      .map(({ match }) => match.strategy)
      .find((strategy): strategy is FamilyMatchStrategy =>
        Boolean(strategy && strategy !== "manual"),
      ) ?? "manual"
  );
}

function roleForMatch(
  contract: ContractRow,
  current: ContractRow | null,
  match: FamilyMatchResult,
): FamilyMemberRole {
  return roleForFamilyMember(contract, current, {
    requiresReview: match.requiresReview,
  });
}

async function refreshFamilyCurrent(
  familyId: string,
  executor: DbExecutor = db,
): Promise<{
  previousCurrentId: string | null;
  current: ContractRow | null;
  members: PersistedMember[];
}> {
  const persisted = await getFamilyById(familyId, executor);
  if (!persisted.family) {
    return { previousCurrentId: null, current: null, members: [] };
  }

  const current = selectCurrentNotice(
    persisted.members.map((member) => member.contract),
  );
  const previousCurrentId = persisted.family.currentContractId;

  await executor
    .update(contractFamilies)
    .set({
      currentContractId: current?.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(contractFamilies.id, familyId));

  await Promise.all(
    persisted.members.map((member) => {
      const role =
        member.contract.id === current?.id
          ? "current"
          : member.role === "possible_match"
            ? "possible_match"
            : roleForFamilyMember(member.contract, current);
      return executor
        .update(contractFamilyMembers)
        .set({
          memberRole: role,
          updatedAt: new Date(),
        })
        .where(eq(contractFamilyMembers.contractId, member.contract.id));
    }),
  );

  return { previousCurrentId, current, members: persisted.members };
}

async function addFamilyEvent(
  familyId: string,
  contractId: string | null,
  eventType: string,
  beforeJson: unknown,
  afterJson: unknown,
  executor: DbExecutor = db,
) {
  await executor.insert(contractFamilyEvents).values({
    familyId,
    contractId,
    eventType,
    beforeJson,
    afterJson,
  });
}

async function createFamilyFromMatches(
  source: ContractRow,
  matches: Array<{ contract: ContractRow; match: FamilyMatchResult }>,
  decision: FamilyDecision,
  executor: DbExecutor = db,
): Promise<string> {
  const current = selectCurrentNotice(matches.map(({ contract }) => contract));
  const sourceMatch =
    matches.find(({ contract }) => contract.id === source.id)?.match ??
    matchFamilyContracts(source, source);
  const needsReview = matches.some(({ match }) => match.requiresReview);
  const matchStrategy = primaryStrategy(matches);
  const now = new Date();

  const [family] = await executor
    .insert(contractFamilies)
    .values({
      title: current?.title ?? source.title,
      solicitationNumber:
        canonicalSolicitation(current?.solicitationNumber) ??
        canonicalSolicitation(source.solicitationNumber),
      agency: current?.agency ?? source.agency,
      currentContractId: current?.id ?? source.id,
      decision,
      needsReview,
      matchStrategy,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: contractFamilies.id });

  const familyId = family.id;

  await executor.insert(contractFamilyMembers).values(
    matches.map(({ contract, match }) => ({
      familyId,
      contractId: contract.id,
      memberRole: roleForMatch(contract, current, match),
      matchConfidence: String(match.confidence),
      matchReason:
        contract.id === source.id
          ? `original promoted source; ${sourceMatch.reason}`
          : match.reason,
      createdAt: now,
      updatedAt: now,
    })),
  );

  await addFamilyEvent(
    familyId,
    source.id,
    decision === "PROMOTE" ? "family_promoted" : "family_created",
    null,
    {
      sourceContractId: source.id,
      currentContractId: current?.id ?? null,
      totalNotices: matches.length,
    },
    executor,
  );

  return familyId;
}

async function findPromotedFamilyMatches(
  source: ContractRow,
  executor: DbExecutor = db,
): Promise<
  Array<{
    familyId: string;
    currentContractId: string | null;
    needsReview: boolean;
    match: FamilyMatchResult;
    matchedContract: ContractRow;
  }>
> {
  const candidates = await findCandidateContracts(source, executor);
  const candidateIds = candidates.map((candidate) => candidate.id);
  if (candidateIds.length === 0) return [];

  const rows = await executor
    .select({
      familyId: contractFamilyMembers.familyId,
      currentContractId: contractFamilies.currentContractId,
      needsReview: contractFamilies.needsReview,
      contract: familyContractSelect,
    })
    .from(contractFamilyMembers)
    .innerJoin(
      contractFamilies,
      eq(contractFamilies.id, contractFamilyMembers.familyId),
    )
    .innerJoin(contracts, eq(contracts.id, contractFamilyMembers.contractId))
    .where(
      and(
        eq(contractFamilies.decision, "PROMOTE"),
        inArray(contractFamilyMembers.contractId, candidateIds),
      ),
    );

  const byFamily = new Map<
    string,
    {
      familyId: string;
      currentContractId: string | null;
      needsReview: boolean;
      match: FamilyMatchResult;
      matchedContract: ContractRow;
    }
  >();

  for (const row of rows) {
    const contract = row.contract as ContractRow;
    const match = matchFamilyContracts(source, contract);
    if (!match.isMatch) continue;

    const existing = byFamily.get(row.familyId);
    if (!existing || match.confidence > existing.match.confidence) {
      byFamily.set(row.familyId, {
        familyId: row.familyId,
        currentContractId: row.currentContractId,
        needsReview: row.needsReview,
        match,
        matchedContract: contract,
      });
    }
  }

  return Array.from(byFamily.values());
}

async function addContractToFamily(
  familyId: string,
  contract: ContractRow,
  match: FamilyMatchResult,
  executor: DbExecutor = db,
): Promise<{ inserted: boolean }> {
  const existing = await executor
    .select({ familyId: contractFamilyMembers.familyId })
    .from(contractFamilyMembers)
    .where(eq(contractFamilyMembers.contractId, contract.id))
    .limit(1);

  if (existing[0]) {
    return { inserted: existing[0].familyId !== familyId ? false : false };
  }

  const persisted = await getFamilyById(familyId, executor);
  const currentBefore = persisted.family?.currentContractId ?? null;
  const candidateMembers = [
    ...persisted.members.map((member) => member.contract),
    contract,
  ];
  const current = selectCurrentNotice(candidateMembers);

  await executor.insert(contractFamilyMembers).values({
    familyId,
    contractId: contract.id,
    memberRole: roleForMatch(contract, current, match),
    matchConfidence: String(match.confidence),
    matchReason: match.reason,
  });

  await executor
    .update(contractFamilies)
    .set({
      currentContractId: current?.id ?? currentBefore,
      needsReview: persisted.family?.needsReview || match.requiresReview,
      matchStrategy:
        match.strategy ?? persisted.family?.matchStrategy ?? "manual",
      updatedAt: new Date(),
    })
    .where(eq(contractFamilies.id, familyId));

  return { inserted: true };
}

async function tagPromotedFamilyUpdate(
  contractId: string,
  executor: DbExecutor = db,
) {
  await executor
    .update(contracts)
    .set({
      tags: sql`CASE
        WHEN COALESCE(${contracts.tags}, '[]'::jsonb) @> ${JSON.stringify([PROMOTED_FAMILY_UPDATE_TAG])}::jsonb
        THEN COALESCE(${contracts.tags}, '[]'::jsonb)
        ELSE COALESCE(${contracts.tags}, '[]'::jsonb) || ${JSON.stringify([PROMOTED_FAMILY_UPDATE_TAG])}::jsonb
      END`,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, contractId));
}

function familyEventTypesForNewNotice(
  previousCurrent: ContractRow | null,
  nextCurrent: ContractRow | null,
  linked: ContractRow,
): string[] {
  const events = new Set<string>(["new_notice_added"]);

  if (previousCurrent && nextCurrent?.id === linked.id) {
    if (
      noticeTypeRank(linked.noticeType) >
      noticeTypeRank(previousCurrent.noticeType)
    ) {
      events.add("notice_progression");
    }

    const previousDeadline = previousCurrent.responseDeadline
      ? new Date(previousCurrent.responseDeadline).toISOString()
      : null;
    const nextDeadline = linked.responseDeadline
      ? new Date(linked.responseDeadline).toISOString()
      : null;
    if (previousDeadline !== nextDeadline) {
      events.add("deadline_changed");
    }

    if (documentCount(linked) > documentCount(previousCurrent)) {
      events.add("documents_added");
    }
  }

  return Array.from(events);
}

export async function promoteContractFamily(
  contractId: string,
  executor: DbExecutor = db,
): Promise<{ familyId: string | null; currentContractId: string | null }> {
  const source = await getContractRow(contractId, executor);
  if (!source) return { familyId: null, currentContractId: null };

  const persisted = await getPersistedFamily(contractId, executor);
  if (persisted.family) {
    const current = selectCurrentNotice(
      persisted.members.map((member) => member.contract),
    );
    await executor
      .update(contractFamilies)
      .set({
        decision: "PROMOTE",
        currentContractId: current?.id ?? persisted.family.currentContractId,
        updatedAt: new Date(),
      })
      .where(eq(contractFamilies.id, persisted.family.id));
    await addFamilyEvent(
      persisted.family.id,
      contractId,
      "family_promoted",
      { decision: persisted.family.decision },
      { decision: "PROMOTE", sourceContractId: contractId },
      executor,
    );
    return {
      familyId: persisted.family.id,
      currentContractId: current?.id ?? persisted.family.currentContractId,
    };
  }

  const promotedMatches = await findPromotedFamilyMatches(source, executor);
  const safePromotedMatches = promotedMatches.filter(
    (match) => !match.match.requiresReview,
  );

  if (safePromotedMatches.length === 1) {
    const target = safePromotedMatches[0];
    await addContractToFamily(target.familyId, source, target.match, executor);
    await executor
      .update(contractFamilies)
      .set({
        decision: "PROMOTE",
        updatedAt: new Date(),
      })
      .where(eq(contractFamilies.id, target.familyId));
    await addFamilyEvent(
      target.familyId,
      contractId,
      "family_promoted",
      null,
      { decision: "PROMOTE", sourceContractId: contractId },
      executor,
    );
    const refreshed = await refreshFamilyCurrent(target.familyId, executor);
    return {
      familyId: target.familyId,
      currentContractId: refreshed.current?.id ?? target.currentContractId,
    };
  }

  const candidates = await findCandidateContracts(source, executor);
  const matches = inferredMemberRows(source, candidates);
  const familyId = await createFamilyFromMatches(
    source,
    matches,
    "PROMOTE",
    executor,
  );
  const refreshed = await refreshFamilyCurrent(familyId, executor);
  return { familyId, currentContractId: refreshed.current?.id ?? null };
}

export async function demoteContractFamily(
  contractId: string,
  executor: DbExecutor = db,
): Promise<{ familyId: string | null }> {
  const persisted = await getPersistedFamily(contractId, executor);
  if (!persisted.family) return { familyId: null };

  await executor
    .update(contractFamilies)
    .set({
      decision: "UNREVIEWED",
      updatedAt: new Date(),
    })
    .where(eq(contractFamilies.id, persisted.family.id));
  await addFamilyEvent(
    persisted.family.id,
    contractId,
    "family_demoted",
    { decision: persisted.family.decision },
    { decision: "UNREVIEWED", sourceContractId: contractId },
    executor,
  );

  return { familyId: persisted.family.id };
}

export async function archiveContractFamily(
  contractId: string,
  executor: DbExecutor = db,
): Promise<{ familyId: string | null }> {
  const persisted = await getPersistedFamily(contractId, executor);
  if (!persisted.family) return { familyId: null };

  await executor
    .update(contractFamilies)
    .set({
      decision: "ARCHIVE",
      updatedAt: new Date(),
    })
    .where(eq(contractFamilies.id, persisted.family.id));
  await addFamilyEvent(
    persisted.family.id,
    contractId,
    "family_archived",
    { decision: persisted.family.decision },
    { decision: "ARCHIVE", sourceContractId: contractId },
    executor,
  );

  return { familyId: persisted.family.id };
}

export async function linkContractsToPromotedFamilies(
  contractIds: string[],
): Promise<{
  linked: number;
  needsReview: number;
  skipped: number;
}> {
  const uniqueIds = Array.from(new Set(contractIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { linked: 0, needsReview: 0, skipped: 0 };
  }

  let linked = 0;
  let needsReview = 0;
  let skipped = 0;

  let rows: ContractRow[];
  try {
    rows = await getContractRows(uniqueIds);
  } catch (err) {
    if (isMissingFamilyTableError(err)) {
      return { linked: 0, needsReview: 0, skipped: uniqueIds.length };
    }
    throw err;
  }
  for (const contract of rows) {
    let matches: Awaited<ReturnType<typeof findPromotedFamilyMatches>>;
    try {
      matches = await findPromotedFamilyMatches(contract);
    } catch (err) {
      if (isMissingFamilyTableError(err)) {
        skipped++;
        continue;
      }
      throw err;
    }
    if (matches.length === 0) {
      skipped++;
      continue;
    }

    const safeMatches = matches.filter((match) => !match.match.requiresReview);
    if (safeMatches.length !== 1) {
      needsReview++;
      for (const match of matches) {
        await addFamilyEvent(
          match.familyId,
          contract.id,
          "possible_match_needs_review",
          null,
          {
            contractId: contract.id,
            matchedContractId: match.matchedContract.id,
            reason: match.match.reason,
            confidence: match.match.confidence,
          },
        );
      }
      continue;
    }

    const target = safeMatches[0];
    const persistedBefore = await getFamilyById(target.familyId);
    const previousCurrent =
      persistedBefore.members.find(
        (member) => member.contract.id === persistedBefore.family?.currentContractId,
      )?.contract ?? null;

    const { inserted } = await addContractToFamily(
      target.familyId,
      contract,
      target.match,
    );

    if (!inserted) {
      skipped++;
      continue;
    }

    await tagPromotedFamilyUpdate(contract.id);
    const refreshed = await refreshFamilyCurrent(target.familyId);
    const eventTypes = familyEventTypesForNewNotice(
      previousCurrent,
      refreshed.current,
      contract,
    );

    for (const eventType of eventTypes) {
      await addFamilyEvent(
        target.familyId,
        contract.id,
        eventType,
        {
          previousCurrentContractId:
            persistedBefore.family?.currentContractId ?? null,
        },
        {
          contractId: contract.id,
          currentContractId: refreshed.current?.id ?? null,
          reason: target.match.reason,
          confidence: target.match.confidence,
        },
      );
    }

    linked++;
  }

  return { linked, needsReview, skipped };
}

export async function getOpportunityFamilyForContract(
  contractId: string,
): Promise<OpportunityFamilyResponse | null> {
  const source = await getContractRow(contractId);
  if (!source) return null;

  const persisted = await getPersistedFamily(contractId);

  let familyId: string | null = null;
  let sourceKind: "persisted" | "inferred" = "inferred";
  let needsReview = false;
  let matchStrategy: FamilyMatchStrategy | null = null;
  let persistedDecision: FamilyDecision | null = null;
  let memberInputs: Array<{
    contract: ContractRow;
    role: FamilyMemberRole | null;
    confidence: number;
    reason: string | null;
    matchRequiresReview: boolean;
  }>;

  if (persisted.family && persisted.members.length > 0) {
    familyId = persisted.family.id;
    sourceKind = "persisted";
    needsReview = persisted.family.needsReview;
    matchStrategy = persisted.family.matchStrategy;
    persistedDecision = persisted.family.decision;
    memberInputs = persisted.members.map((member) => ({
      contract: member.contract,
      role: member.role,
      confidence: member.confidence,
      reason: member.reason,
      matchRequiresReview: member.role === "possible_match",
    }));
  } else {
    const candidates = await findCandidateContracts(source);
    const inferred = inferredMemberRows(source, candidates);
    needsReview = inferred.some(({ match }) => match.requiresReview);
    matchStrategy =
      inferred
        .map(({ match }) => match.strategy)
        .find((strategy): strategy is FamilyMatchStrategy =>
          Boolean(strategy && strategy !== "manual"),
        ) ?? null;
    memberInputs = inferred.map(({ contract, match }) => ({
      contract,
      role: null,
      confidence: match.confidence,
      reason: match.reason,
      matchRequiresReview: match.requiresReview,
    }));
  }

  const contractRows = memberInputs.map((member) => member.contract);
  const current =
    persisted.family?.currentContractId
      ? contractRows.find(
          (contract) => contract.id === persisted.family?.currentContractId,
        ) ?? selectCurrentNotice(contractRows)
      : selectCurrentNotice(contractRows);

  const members = memberInputs.map((member) => {
    const role =
      member.role ??
      roleForFamilyMember(member.contract, current, {
        requiresReview: member.matchRequiresReview,
      });
    return buildMemberView(
      member.contract,
      current,
      role,
      member.confidence,
      member.reason,
    );
  });

  sortFamilyMembers(members);

  const currentMember =
    members.find((member) => member.id === current?.id) ?? null;
  const familyDecision = familyDecisionForView(persistedDecision, members);

  return {
    familyId,
    source: sourceKind,
    summary: {
      totalNotices: members.length,
      currentContractId: current?.id ?? null,
      viewingContractId: contractId,
      isViewingCurrent: current?.id === contractId,
      newerVersionAvailable: Boolean(current && current.id !== contractId),
      needsReview,
      matchStrategy,
      familyDecision,
      promoted: familyDecision === "PROMOTE",
      archived: familyDecision === "ARCHIVE",
    },
    current: currentMember,
    members,
  };
}

type PromotedFamilyListItem = {
  summary: PromotedFamilySummary;
  sortAt: Date | string | null;
  sourceRank: number;
};

function timestampValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function currentContractSummary(
  current: ContractRow,
  promoted: boolean,
): PromotedFamilySummary["current"] {
  return {
    id: current.id,
    title: current.title,
    agency: current.agency,
    awardCeiling: current.awardCeiling,
    responseDeadline: current.responseDeadline,
    noticeType: current.noticeType,
    classification: current.classification,
    aiReasoning: null,
    summary: current.summary,
    actionPlan: current.actionPlan,
    notes: current.notes,
    status: current.status,
    postedDate: current.postedDate,
    userOverride: false,
    reviewedAt: current.reviewedAt,
    promoted,
    promotedAt: current.promotedAt,
    tags: current.tags,
    createdAt: current.createdAt,
  };
}

function legacyPromotedFamilyItem(contract: ContractRow): PromotedFamilyListItem {
  return {
    summary: {
      familyId: `legacy-${contract.id}`,
      decision: "PROMOTE",
      totalNotices: 1,
      needsReview: false,
      latestEventType: null,
      latestEventAt: null,
      current: currentContractSummary(contract, true),
    },
    sortAt: contract.promotedAt ?? contract.updatedAt ?? contract.createdAt,
    sourceRank: 1,
  };
}

async function listPersistedPromotedFamilyItems(): Promise<{
  items: PromotedFamilyListItem[];
  tablesAvailable: boolean;
}> {
  try {
    const familyRows = await db
      .select({
        id: contractFamilies.id,
        currentContractId: contractFamilies.currentContractId,
        decision: contractFamilies.decision,
        needsReview: contractFamilies.needsReview,
        updatedAt: contractFamilies.updatedAt,
      })
      .from(contractFamilies)
      .where(eq(contractFamilies.decision, "PROMOTE"))
      .orderBy(desc(contractFamilies.updatedAt), desc(contractFamilies.id));

    const familyIds = familyRows.map((family) => family.id);
    if (familyIds.length === 0) {
      return { items: [], tablesAvailable: true };
    }

    const memberRows = await db
      .select({
        familyId: contractFamilyMembers.familyId,
        contract: familyContractSelect,
      })
      .from(contractFamilyMembers)
      .innerJoin(contracts, eq(contracts.id, contractFamilyMembers.contractId))
      .where(inArray(contractFamilyMembers.familyId, familyIds))
      .orderBy(desc(contracts.postedDate));

    const eventRows = await db
      .select({
        familyId: contractFamilyEvents.familyId,
        eventType: contractFamilyEvents.eventType,
        createdAt: contractFamilyEvents.createdAt,
      })
      .from(contractFamilyEvents)
      .where(inArray(contractFamilyEvents.familyId, familyIds))
      .orderBy(desc(contractFamilyEvents.createdAt));

    const membersByFamilyId = new Map<string, ContractRow[]>();
    for (const row of memberRows) {
      const existing = membersByFamilyId.get(row.familyId) ?? [];
      existing.push(row.contract as ContractRow);
      membersByFamilyId.set(row.familyId, existing);
    }

    const latestEventByFamilyId = new Map<
      string,
      { eventType: string; createdAt: Date }
    >();
    for (const row of eventRows) {
      if (latestEventByFamilyId.has(row.familyId)) continue;
      latestEventByFamilyId.set(row.familyId, {
        eventType: row.eventType,
        createdAt: row.createdAt,
      });
    }

    const items: PromotedFamilyListItem[] = [];
    for (const family of familyRows) {
      const members = membersByFamilyId.get(family.id) ?? [];
      const current =
        members.find((member) => member.id === family.currentContractId) ??
        selectCurrentNotice(members);
      if (!current) continue;
      const latestEvent = latestEventByFamilyId.get(family.id) ?? null;

      items.push({
        summary: {
          familyId: family.id,
          decision: "PROMOTE",
          totalNotices: members.length,
          needsReview: family.needsReview,
          latestEventType: latestEvent?.eventType ?? null,
          latestEventAt: latestEvent?.createdAt.toISOString() ?? null,
          current: currentContractSummary(
            current,
            family.decision === "PROMOTE",
          ),
        },
        sortAt: family.updatedAt,
        sourceRank: 0,
      });
    }

    return { items, tablesAvailable: true };
  } catch (err) {
    if (isMissingFamilyTableError(err)) {
      return { items: [], tablesAvailable: false };
    }
    throw err;
  }
}

async function getExistingFamilyMemberContractIds(
  contractIds: string[],
): Promise<Set<string> | null> {
  if (contractIds.length === 0) return new Set<string>();

  try {
    const rows = await db
      .select({ contractId: contractFamilyMembers.contractId })
      .from(contractFamilyMembers)
      .where(inArray(contractFamilyMembers.contractId, contractIds));

    return new Set(rows.map((row) => String(row.contractId)));
  } catch (err) {
    if (isMissingFamilyTableError(err)) return null;
    throw err;
  }
}

export async function listPromotedOpportunityFamilies({
  page,
  limit,
}: {
  page: number;
  limit: number;
}): Promise<PromotedFamilyListResponse> {
  const offset = (page - 1) * limit;

  const { items: persistedItems, tablesAvailable } =
    await listPersistedPromotedFamilyItems();
  const legacyRows = (await db
    .select(familyContractSelect)
    .from(contracts)
    .where(eq(contracts.promoted, true))
    .orderBy(desc(contracts.promotedAt), desc(contracts.id))) as ContractRow[];

  const existingMemberIds = tablesAvailable
    ? await getExistingFamilyMemberContractIds(
        legacyRows.map((contract) => contract.id),
      )
    : null;

  const legacyItems = legacyRows
    .filter((contract) => !existingMemberIds?.has(contract.id))
    .map(legacyPromotedFamilyItem);

  const items = [...persistedItems, ...legacyItems].sort((a, b) => {
    const timeDiff = timestampValue(b.sortAt) - timestampValue(a.sortAt);
    if (timeDiff !== 0) return timeDiff;
    if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
    return b.summary.familyId.localeCompare(a.summary.familyId);
  });

  const total = items.length;
  return {
    data: items.slice(offset, offset + limit).map((item) => item.summary),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
