import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { searchOpportunities, formatSamDate } from "@/lib/sam-gov/client";
import { mapOpportunityToContract } from "@/lib/sam-gov/mappers";
import type { SamOpportunity } from "@/lib/sam-gov/types";
import {
  contracts,
  watchEvents,
  watchTargetLinks,
  watchTargets,
} from "@/lib/db/schema";
import {
  diffWatchSnapshots,
  fingerprintWatchEvent,
  matchWatchTarget,
  normalizeWatchText,
  summarizeWatchEvent,
  watchSnapshotFromContract,
  watchSnapshotFromTarget,
  type MatchCandidate,
  type WatchSnapshot,
} from "./core";
import { sendTelegram } from "@/lib/notifications/telegram";

const PAGE_SIZE = 1_000;
const WATCH_SEARCH_LOOKBACK_DAYS = 180;
const TELEGRAM_MAX_LENGTH = 4_000;
const WATCH_IMPORT_TAG = "WATCH_IMPORT";

type ActiveWatchTarget = typeof watchTargets.$inferSelect;
type WatchContractRow = {
  id: string;
  noticeId: string;
  solicitationNumber: string | null;
  title: string;
  agency: string | null;
  noticeType: string | null;
  responseDeadline: Date | null;
  setAsideCode: string | null;
  resourceLinks: string[] | null;
};

type PendingWatchEventRow = {
  id: string;
  watchTargetId: string;
  contractId: string | null;
  eventType: string;
  beforeJson: unknown;
  afterJson: unknown;
  notifiedAt: Date | null;
  createdAt: Date;
  sourceTitle: string;
};

type ProcessedTargetResult = {
  insertedEvents: number;
};

export type WatchCheckResult = {
  activeTargets: number;
  opportunitiesScanned: number;
  matchedNotices: number;
  eventsInserted: number;
  notificationsSent: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function uniqueByNoticeId(opportunities: SamOpportunity[]): SamOpportunity[] {
  const byNoticeId = new Map<string, SamOpportunity>();
  for (const opportunity of opportunities) {
    byNoticeId.set(opportunity.noticeId, opportunity);
  }
  return Array.from(byNoticeId.values());
}

function toCandidate(contract: WatchContractRow): MatchCandidate {
  return watchSnapshotFromContract(contract) as MatchCandidate;
}

function buildAlertMessage(events: PendingWatchEventRow[]): string {
  const grouped = new Map<string, { title: string; lines: string[] }>();

  for (const event of events) {
    const current = grouped.get(event.watchTargetId) ?? {
      title: event.sourceTitle,
      lines: [],
    };
    current.lines.push(
      `- ${summarizeWatchEvent({
        eventType: event.eventType,
        beforeJson: (event.beforeJson ?? null) as Record<string, unknown> | null,
        afterJson: (event.afterJson ?? null) as Record<string, unknown> | null,
      })}`,
    );
    grouped.set(event.watchTargetId, current);
  }

  const lines: string[] = ["👀 JCL GovCon watch alerts", ""];
  for (const { title, lines: groupLines } of Array.from(grouped.values())) {
    lines.push(title);
    lines.push(...groupLines);
    lines.push("");
  }

  let message = lines.join("\n").trim();
  if (message.length > TELEGRAM_MAX_LENGTH) {
    message = `${message.slice(0, TELEGRAM_MAX_LENGTH - 20)}\n…(truncated)`;
  }
  return message;
}

async function loadActiveWatchTargets(): Promise<ActiveWatchTarget[]> {
  return db
    .select()
    .from(watchTargets)
    .where(eq(watchTargets.active, true))
    .orderBy(desc(watchTargets.updatedAt));
}

export async function searchRecentWatchOpportunities(): Promise<SamOpportunity[]> {
  const now = new Date();
  const postedFrom = new Date(now);
  postedFrom.setDate(postedFrom.getDate() - WATCH_SEARCH_LOOKBACK_DAYS);

  let offset = 0;
  let total = 0;
  const opportunities: SamOpportunity[] = [];

  do {
    const response = await searchOpportunities({
      ptype: "o,k,p,r",
      active: "Yes",
      postedFrom: formatSamDate(postedFrom),
      postedTo: formatSamDate(now),
      limit: PAGE_SIZE,
      offset,
    });

    total = response.totalRecords ?? 0;
    const page = response.opportunitiesData ?? [];
    opportunities.push(...page);
    offset += page.length;

    if (page.length === 0) break;
  } while (offset < total);

  return uniqueByNoticeId(opportunities);
}

async function upsertMatchedContracts(
  opportunities: SamOpportunity[],
): Promise<Map<string, WatchContractRow>> {
  const deduped = uniqueByNoticeId(opportunities);
  if (deduped.length === 0) {
    return new Map();
  }

  const now = new Date();
  const values = deduped.map((opportunity) => {
    const mapped = mapOpportunityToContract(opportunity);
    const tags = Array.from(
      new Set([...(mapped.tags ?? []), WATCH_IMPORT_TAG]),
    );
    return {
      ...mapped,
      tags,
      reviewedAt: now,
      updatedAt: now,
    };
  });

  for (const rows of chunk(values, 500)) {
    await db
      .insert(contracts)
      .values(rows)
      .onConflictDoUpdate({
        target: contracts.noticeId,
        set: {
          title: sql`excluded.title`,
          noticeType: sql`excluded.notice_type`,
          responseDeadline: sql`excluded.response_deadline`,
          active: sql`excluded.active`,
          rawJson: sql`excluded.raw_json`,
          agency: sql`excluded.agency`,
          naicsCode: sql`excluded.naics_code`,
          pscCode: sql`excluded.psc_code`,
          setAsideType: sql`excluded.set_aside_type`,
          awardCeiling: sql`excluded.award_ceiling`,
          postedDate: sql`excluded.posted_date`,
          samUrl: sql`excluded.sam_url`,
          resourceLinks: sql`excluded.resource_links`,
          orgPathName: sql`excluded.org_path_name`,
          orgPathCode: sql`excluded.org_path_code`,
          popState: sql`excluded.pop_state`,
          popCity: sql`excluded.pop_city`,
          popZip: sql`excluded.pop_zip`,
          officeCity: sql`excluded.office_city`,
          officeState: sql`excluded.office_state`,
          setAsideCode: sql`excluded.set_aside_code`,
          contactEmail: sql`excluded.contact_email`,
          solicitationNumber: sql`excluded.solicitation_number`,
          updatedAt: sql`now()`,
        },
      });
  }

  const noticeIds = deduped.map((opportunity) => opportunity.noticeId);
  const rows = await db
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
    .where(inArray(contracts.noticeId, noticeIds));

  return new Map(rows.map((row) => [row.noticeId, row]));
}

async function ensureLink(
  tx: { insert: typeof db.insert },
  watchTargetId: string,
  contractId: string,
  linkType: "auto_candidate" | "primary",
): Promise<void> {
  await tx
    .insert(watchTargetLinks)
    .values({
      watchTargetId,
      contractId,
      linkType,
      confidence: "1",
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

async function processWatchTarget(
  target: ActiveWatchTarget,
  candidates: MatchCandidate[],
): Promise<ProcessedTargetResult> {
  const sourceSnapshot = watchSnapshotFromTarget(target);
  const previousSnapshot =
    (target.currentSnapshot as WatchSnapshot | null) ?? sourceSnapshot;
  const matchResult = matchWatchTarget(sourceSnapshot, candidates, {
    existingPrimaryContractId: target.primaryContractId,
    baselineNoticeType: previousSnapshot.noticeType ?? sourceSnapshot.noticeType,
  });

  let nextStatus: ActiveWatchTarget["status"] = target.status;
  let nextPrimaryContractId = target.primaryContractId;
  let nextSnapshot = target.currentSnapshot as WatchSnapshot | null;
  let notifyableChanges = false;

  if (matchResult.requiresReview) {
    nextStatus = "NEEDS_REVIEW";
  } else if (matchResult.resolved) {
    const resolvedSnapshot = {
      ...matchResult.resolved,
      resourceUrls: [...matchResult.resolved.resourceUrls],
    };

    if (
      target.primaryContractId &&
      matchResult.resolved.contractId === sourceSnapshot.contractId
    ) {
      nextStatus = "MATCHED";
      nextPrimaryContractId = target.primaryContractId;
      nextSnapshot =
        (target.currentSnapshot as WatchSnapshot | null) ?? previousSnapshot;
    } else if (
      matchResult.resolved.contractId === sourceSnapshot.contractId &&
      !target.primaryContractId
    ) {
      nextStatus = "MONITORING";
      nextPrimaryContractId = null;
      nextSnapshot = resolvedSnapshot;
      notifyableChanges = true;
    } else {
      nextStatus = "MATCHED";
      nextPrimaryContractId = matchResult.resolved.contractId;
      nextSnapshot = resolvedSnapshot;
      notifyableChanges = true;
    }
  } else if (target.primaryContractId && target.currentSnapshot) {
    nextStatus = "MATCHED";
    nextPrimaryContractId = target.primaryContractId;
    nextSnapshot = target.currentSnapshot as WatchSnapshot;
  } else {
    nextStatus = "MONITORING";
    nextPrimaryContractId = null;
    nextSnapshot = target.currentSnapshot as WatchSnapshot | null;
  }

  const insertedEvents = await db.transaction(async (tx) => {
    for (const candidate of matchResult.matched) {
      if (candidate.contractId !== target.sourceContractId) {
        await ensureLink(tx, target.id, candidate.contractId, "auto_candidate");
      }
    }

    if (nextPrimaryContractId) {
      await tx
        .delete(watchTargetLinks)
        .where(
          and(
            eq(watchTargetLinks.watchTargetId, target.id),
            eq(watchTargetLinks.linkType, "primary"),
          ),
        );
      await ensureLink(tx, target.id, nextPrimaryContractId, "primary");
    }

    await tx
      .update(watchTargets)
      .set({
        primaryContractId: nextPrimaryContractId,
        status: nextStatus,
        currentSnapshot: nextSnapshot,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(watchTargets.id, target.id));

    if (!notifyableChanges || nextStatus === "NEEDS_REVIEW" || !nextSnapshot) {
      return 0;
    }

    const changes = diffWatchSnapshots(previousSnapshot, nextSnapshot);
    let inserted = 0;

    for (const change of changes) {
      const returningRows = await tx
        .insert(watchEvents)
        .values({
          watchTargetId: target.id,
          contractId: nextPrimaryContractId ?? target.sourceContractId,
          eventType: change.eventType,
          fingerprint: fingerprintWatchEvent(
            target.id,
            change.eventType,
            change.beforeJson,
            change.afterJson,
          ),
          beforeJson: change.beforeJson,
          afterJson: change.afterJson,
        })
        .onConflictDoNothing()
        .returning({ id: watchEvents.id });

      inserted += returningRows.length;
    }

    return inserted;
  });

  return { insertedEvents };
}

async function sendPendingWatchAlerts(): Promise<number> {
  const pendingEvents = await db
    .select({
      id: watchEvents.id,
      watchTargetId: watchEvents.watchTargetId,
      contractId: watchEvents.contractId,
      eventType: watchEvents.eventType,
      beforeJson: watchEvents.beforeJson,
      afterJson: watchEvents.afterJson,
      notifiedAt: watchEvents.notifiedAt,
      createdAt: watchEvents.createdAt,
      sourceTitle: watchTargets.sourceTitle,
    })
    .from(watchEvents)
    .innerJoin(watchTargets, eq(watchTargets.id, watchEvents.watchTargetId))
    .where(and(isNull(watchEvents.notifiedAt), eq(watchTargets.active, true)))
    .orderBy(desc(watchEvents.createdAt));

  if (pendingEvents.length === 0) {
    return 0;
  }

  await sendTelegram(buildAlertMessage(pendingEvents), {
    disableWebPagePreview: true,
  });

  const now = new Date();
  const eventIds = pendingEvents.map((event) => event.id);
  const targetIds = Array.from(
    new Set(pendingEvents.map((event) => event.watchTargetId)),
  );

  await db
    .update(watchEvents)
    .set({ notifiedAt: now })
    .where(inArray(watchEvents.id, eventIds));

  await db
    .update(watchTargets)
    .set({ lastAlertedAt: now, updatedAt: now })
    .where(inArray(watchTargets.id, targetIds));

  return pendingEvents.length;
}

export async function runWatchCheck(): Promise<WatchCheckResult> {
  const activeTargets = await loadActiveWatchTargets();
  if (activeTargets.length === 0) {
    return {
      activeTargets: 0,
      opportunitiesScanned: 0,
      matchedNotices: 0,
      eventsInserted: 0,
      notificationsSent: 0,
    };
  }

  const opportunities = await searchRecentWatchOpportunities();
  const matchesByTargetId = new Map<string, SamOpportunity[]>();
  const matchedNoticeMap = new Map<string, SamOpportunity>();

  for (const target of activeTargets) {
    const sourceSnapshot = watchSnapshotFromTarget(target);
    const matched = opportunities.filter((opportunity) => {
      const solicitationMatches = sourceSnapshot.solicitationNumber
        ? opportunity.solicitationNumber === sourceSnapshot.solicitationNumber
        : false;
      const fallbackMatches = !sourceSnapshot.solicitationNumber
        ? sourceSnapshot.title &&
          sourceSnapshot.agency &&
          opportunity.title &&
          opportunity.fullParentPathName &&
          normalizeWatchText(sourceSnapshot.title) ===
            normalizeWatchText(opportunity.title) &&
          normalizeWatchText(sourceSnapshot.agency) ===
            normalizeWatchText(opportunity.fullParentPathName)
        : false;
      return solicitationMatches || fallbackMatches;
    });
    matchesByTargetId.set(target.id, matched);
    for (const opportunity of matched) {
      matchedNoticeMap.set(opportunity.noticeId, opportunity);
    }
  }

  const matchedContracts = await upsertMatchedContracts(
    Array.from(matchedNoticeMap.values()),
  );
  let eventsInserted = 0;

  for (const target of activeTargets) {
    const targetMatches = matchesByTargetId.get(target.id) ?? [];
    const candidates = targetMatches
      .map((opportunity) => matchedContracts.get(opportunity.noticeId))
      .filter((contract): contract is WatchContractRow => Boolean(contract))
      .map(toCandidate);

    const result = await processWatchTarget(target, candidates);
    eventsInserted += result.insertedEvents;
  }

  const notificationsSent = await sendPendingWatchAlerts();

  return {
    activeTargets: activeTargets.length,
    opportunitiesScanned: opportunities.length,
    matchedNotices: matchedNoticeMap.size,
    eventsInserted,
    notificationsSent,
  };
}
