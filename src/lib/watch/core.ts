import { createHash } from "node:crypto";

export const WATCH_STATUSES = [
  "MONITORING",
  "MATCHED",
  "NEEDS_REVIEW",
  "INACTIVE",
] as const;

export type WatchStatus = (typeof WATCH_STATUSES)[number];

export const WATCH_EVENT_TYPES = [
  "notice_progression",
  "deadline_added",
  "deadline_changed",
  "set_aside_changed",
  "title_changed",
  "agency_changed",
  "docs_added",
] as const;

export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];

export type WatchSnapshot = {
  contractId: string | null;
  noticeId: string | null;
  solicitationNumber: string | null;
  title: string | null;
  agency: string | null;
  noticeType: string | null;
  responseDeadline: string | null;
  setAsideCode: string | null;
  resourceUrls: string[];
};

export type MatchCandidate = WatchSnapshot & {
  contractId: string;
};

export type WatchMatchResult = {
  matched: MatchCandidate[];
  resolved: MatchCandidate | null;
  requiresReview: boolean;
};

export type WatchMaterialChange = {
  eventType: WatchEventType;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
};

export function normalizeWatchText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrlSet(urls: string[] | null | undefined): string[] {
  return Array.from(
    new Set((urls ?? []).filter(Boolean).map((url) => url.trim())),
  ).sort();
}

function canonicalNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function canonicalDeadline(
  value: string | Date | null | undefined,
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function watchSnapshotFromContract(
  contract: {
    id: string;
    noticeId: string | null;
    solicitationNumber: string | null;
    title: string | null;
    agency: string | null;
    noticeType: string | null;
    responseDeadline: Date | string | null;
    setAsideCode: string | null;
    resourceLinks: string[] | null;
  },
): WatchSnapshot {
  return {
    contractId: contract.id,
    noticeId: canonicalNullable(contract.noticeId),
    solicitationNumber: canonicalNullable(contract.solicitationNumber),
    title: canonicalNullable(contract.title),
    agency: canonicalNullable(contract.agency),
    noticeType: canonicalNullable(contract.noticeType),
    responseDeadline: canonicalDeadline(contract.responseDeadline),
    setAsideCode: canonicalNullable(contract.setAsideCode),
    resourceUrls: normalizeUrlSet(contract.resourceLinks),
  };
}

export function watchSnapshotFromTarget(target: {
  sourceContractId: string | null;
  sourceNoticeId: string | null;
  sourceSolicitationNumber: string | null;
  sourceTitle: string | null;
  sourceAgency: string | null;
  sourceNoticeType: string | null;
  sourceResponseDeadline: Date | string | null;
  sourceSetAsideCode: string | null;
  sourceResourceUrls: string[] | null;
}): WatchSnapshot {
  return {
    contractId: target.sourceContractId,
    noticeId: canonicalNullable(target.sourceNoticeId),
    solicitationNumber: canonicalNullable(target.sourceSolicitationNumber),
    title: canonicalNullable(target.sourceTitle),
    agency: canonicalNullable(target.sourceAgency),
    noticeType: canonicalNullable(target.sourceNoticeType),
    responseDeadline: canonicalDeadline(target.sourceResponseDeadline),
    setAsideCode: canonicalNullable(target.sourceSetAsideCode),
    resourceUrls: normalizeUrlSet(target.sourceResourceUrls),
  };
}

export function normalizeNoticeType(value: string | null | undefined): string {
  return normalizeWatchText(value);
}

export function noticeTypeRank(value: string | null | undefined): number {
  const normalized = normalizeNoticeType(value);
  if (!normalized) return 0;
  if (normalized.includes("sources sought") || normalized === "rfi") return 1;
  if (normalized.includes("presolicitation")) return 2;
  if (
    normalized === "solicitation" ||
    normalized.includes("combined synopsis solicitation")
  ) {
    return 3;
  }
  return 0;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function equalNormalizedText(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return normalizeWatchText(left) === normalizeWatchText(right);
}

function sameContract(candidate: MatchCandidate, contractId: string | null): boolean {
  return Boolean(contractId && candidate.contractId === contractId);
}

function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const byContractId = new Map<string, MatchCandidate>();
  for (const candidate of candidates) {
    if (!byContractId.has(candidate.contractId)) {
      byContractId.set(candidate.contractId, candidate);
    }
  }
  return Array.from(byContractId.values());
}

export function matchWatchTarget(
  source: WatchSnapshot,
  candidates: MatchCandidate[],
  opts: {
    existingPrimaryContractId?: string | null;
    baselineNoticeType?: string | null;
  } = {},
): WatchMatchResult {
  const deduped = dedupeCandidates(candidates);
  const sourceSolicitation = canonicalNullable(source.solicitationNumber);

  const matched = deduped.filter((candidate) => {
    if (sourceSolicitation) {
      return canonicalNullable(candidate.solicitationNumber) === sourceSolicitation;
    }
    return (
      equalNormalizedText(candidate.title, source.title) &&
      equalNormalizedText(candidate.agency, source.agency)
    );
  });

  if (matched.length === 0) {
    return { matched, resolved: null, requiresReview: false };
  }

  const existingPrimary = matched.find((candidate) =>
    sameContract(candidate, opts.existingPrimaryContractId ?? null),
  );
  if (existingPrimary) {
    return { matched, resolved: existingPrimary, requiresReview: false };
  }

  if (matched.length === 1) {
    return { matched, resolved: matched[0], requiresReview: false };
  }

  const nonSourceMatches = matched.filter(
    (candidate) => candidate.contractId !== source.contractId,
  );
  if (nonSourceMatches.length === 1) {
    const baselineRank = noticeTypeRank(
      opts.baselineNoticeType ?? source.noticeType,
    );
    const candidateRank = noticeTypeRank(nonSourceMatches[0].noticeType);
    if (candidateRank > baselineRank) {
      return {
        matched,
        resolved: nonSourceMatches[0],
        requiresReview: false,
      };
    }
  }

  return { matched, resolved: null, requiresReview: true };
}

export function diffWatchSnapshots(
  before: WatchSnapshot | null,
  after: WatchSnapshot | null,
): WatchMaterialChange[] {
  if (!before || !after) return [];

  const changes: WatchMaterialChange[] = [];

  const beforeRank = noticeTypeRank(before.noticeType);
  const afterRank = noticeTypeRank(after.noticeType);
  if (beforeRank > 0 && afterRank > beforeRank) {
    changes.push({
      eventType: "notice_progression",
      beforeJson: { noticeType: before.noticeType, rank: beforeRank },
      afterJson: { noticeType: after.noticeType, rank: afterRank },
    });
  }

  if (!before.responseDeadline && after.responseDeadline) {
    changes.push({
      eventType: "deadline_added",
      beforeJson: null,
      afterJson: { responseDeadline: after.responseDeadline },
    });
  } else if (
    before.responseDeadline &&
    after.responseDeadline &&
    before.responseDeadline !== after.responseDeadline
  ) {
    changes.push({
      eventType: "deadline_changed",
      beforeJson: { responseDeadline: before.responseDeadline },
      afterJson: { responseDeadline: after.responseDeadline },
    });
  }

  if (
    canonicalNullable(before.setAsideCode) !==
    canonicalNullable(after.setAsideCode)
  ) {
    changes.push({
      eventType: "set_aside_changed",
      beforeJson: { setAsideCode: before.setAsideCode },
      afterJson: { setAsideCode: after.setAsideCode },
    });
  }

  if (
    canonicalNullable(before.title) !== canonicalNullable(after.title) &&
    normalizeWatchText(before.title) !== normalizeWatchText(after.title)
  ) {
    changes.push({
      eventType: "title_changed",
      beforeJson: { title: before.title },
      afterJson: { title: after.title },
    });
  }

  if (
    canonicalNullable(before.agency) !== canonicalNullable(after.agency) &&
    normalizeWatchText(before.agency) !== normalizeWatchText(after.agency)
  ) {
    changes.push({
      eventType: "agency_changed",
      beforeJson: { agency: before.agency },
      afterJson: { agency: after.agency },
    });
  }

  const beforeUrls = new Set(normalizeUrlSet(before.resourceUrls));
  const addedUrls = normalizeUrlSet(after.resourceUrls).filter(
    (url) => !beforeUrls.has(url),
  );
  if (addedUrls.length > 0) {
    changes.push({
      eventType: "docs_added",
      beforeJson: { resourceUrls: normalizeUrlSet(before.resourceUrls) },
      afterJson: {
        resourceUrls: normalizeUrlSet(after.resourceUrls),
        addedUrls,
      },
    });
  }

  return changes;
}

export function fingerprintWatchEvent(
  watchTargetId: string,
  eventType: WatchEventType,
  beforeJson: Record<string, unknown> | null,
  afterJson: Record<string, unknown> | null,
): string {
  return createHash("sha256")
    .update(
      stableStringify({
        watchTargetId,
        eventType,
        beforeJson,
        afterJson,
      }),
    )
    .digest("hex");
}

export function watchStatusLabel(status: WatchStatus | string): string {
  switch (status) {
    case "MATCHED":
      return "Matched";
    case "NEEDS_REVIEW":
      return "Needs Review";
    case "INACTIVE":
      return "Inactive";
    default:
      return "Monitoring";
  }
}

export function summarizeWatchEvent(event: {
  eventType: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
}): string {
  switch (event.eventType) {
    case "notice_progression":
      return `Notice progressed to ${String(event.afterJson?.noticeType ?? "a later stage")}`;
    case "deadline_added":
      return `Deadline added: ${String(event.afterJson?.responseDeadline ?? "set")}`;
    case "deadline_changed":
      return `Deadline changed to ${String(event.afterJson?.responseDeadline ?? "updated")}`;
    case "set_aside_changed":
      return `Set-aside changed to ${String(event.afterJson?.setAsideCode ?? "none")}`;
    case "title_changed":
      return `Title updated to ${String(event.afterJson?.title ?? "updated title")}`;
    case "agency_changed":
      return `Agency updated to ${String(event.afterJson?.agency ?? "updated agency")}`;
    case "docs_added": {
      const addedUrls = Array.isArray(event.afterJson?.addedUrls)
        ? event.afterJson?.addedUrls
        : [];
      return `${addedUrls.length} new document${addedUrls.length === 1 ? "" : "s"} added`;
    }
    default:
      return "Watch updated";
  }
}
