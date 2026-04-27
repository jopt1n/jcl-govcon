export const FAMILY_DECISIONS = [
  "UNREVIEWED",
  "PROMOTE",
  "ARCHIVE",
] as const;

export type FamilyDecision = (typeof FAMILY_DECISIONS)[number];

export const FAMILY_MEMBER_ROLES = [
  "current",
  "older_version",
  "superseded",
  "duplicate",
  "possible_match",
  "manual_match",
] as const;

export type FamilyMemberRole = (typeof FAMILY_MEMBER_ROLES)[number];

export const FAMILY_MATCH_STRATEGIES = [
  "solicitation_number",
  "title_agency",
  "attachment_overlap",
  "manual",
] as const;

export type FamilyMatchStrategy = (typeof FAMILY_MATCH_STRATEGIES)[number];

export type FamilyContract = {
  id: string;
  noticeId: string | null;
  solicitationNumber: string | null;
  title: string;
  agency: string | null;
  orgPathName?: string | null;
  orgPathCode?: string | null;
  noticeType: string | null;
  postedDate: Date | string;
  responseDeadline: Date | string | null;
  active: boolean;
  classification?: string;
  reviewedAt?: Date | string | null;
  promoted?: boolean;
  tags?: string[] | null;
  resourceLinks?: string[] | null;
};

export type FamilyMatchResult = {
  isMatch: boolean;
  requiresReview: boolean;
  confidence: number;
  strategy: FamilyMatchStrategy | null;
  reason: string;
};

export function normalizeFamilyText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrlSet(
  urls: string[] | null | undefined,
): string[] {
  return Array.from(
    new Set(
      (urls ?? [])
        .map((url) => url.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();
}

export function noticeTypeRank(noticeType: string | null | undefined): number {
  const normalized = normalizeFamilyText(noticeType);
  if (normalized.includes("award")) return 5;
  if (normalized.includes("amendment")) return 4;
  if (normalized.includes("combined")) return 3;
  if (normalized.includes("solicitation")) return 2;
  if (normalized.includes("sources sought")) return 1;
  if (normalized.includes("presolicitation")) return 1;
  return 0;
}

export function canonicalSolicitation(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase().replace(/\s+/g, " ") : null;
}

export function agencyKey(contract: {
  agency?: string | null;
  orgPathName?: string | null;
  orgPathCode?: string | null;
}): string | null {
  for (const value of [
    contract.orgPathCode,
    contract.orgPathName,
    contract.agency,
  ]) {
    const normalized = normalizeFamilyText(value);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizedTitle(value: string | null | undefined): string | null {
  const normalized = normalizeFamilyText(value);
  return normalized || null;
}

export function isArchived(contract: { tags?: string[] | null }): boolean {
  return (contract.tags ?? []).includes("ARCHIVED");
}

export function documentCount(contract: {
  resourceLinks?: string[] | null;
}): number {
  return normalizeUrlSet(contract.resourceLinks).length;
}

export function attachmentOverlapScore(
  leftUrls: string[] | null | undefined,
  rightUrls: string[] | null | undefined,
): number {
  const left = normalizeUrlSet(leftUrls);
  const right = normalizeUrlSet(rightUrls);
  const denominator = Math.min(left.length, right.length);
  if (denominator === 0) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter((url) => rightSet.has(url)).length;
  return overlap / denominator;
}

function hasAgencyMatch(left: FamilyContract, right: FamilyContract): boolean {
  const leftAgency = agencyKey(left);
  const rightAgency = agencyKey(right);
  return Boolean(leftAgency && rightAgency && leftAgency === rightAgency);
}

function hasMissingAgency(left: FamilyContract, right: FamilyContract): boolean {
  return !agencyKey(left) || !agencyKey(right);
}

function isBroadVehicle(contract: FamilyContract): boolean {
  const text = normalizeFamilyText(
    `${contract.title} ${contract.noticeType ?? ""}`,
  );
  return /\b(cso|baa|bpa|idiq|multiple award|broad agency|call order)\b/.test(
    text,
  );
}

function progressionReason(left: FamilyContract, right: FamilyContract): string {
  const leftRank = noticeTypeRank(left.noticeType);
  const rightRank = noticeTypeRank(right.noticeType);
  if (leftRank > 0 && rightRank > leftRank) {
    return "notice type progressed";
  }
  if (rightRank > 0 && leftRank > rightRank) {
    return "older notice type is preserved";
  }
  return "notice metadata matches";
}

export function matchFamilyContracts(
  left: FamilyContract,
  right: FamilyContract,
): FamilyMatchResult {
  if (left.id === right.id) {
    return {
      isMatch: true,
      requiresReview: false,
      confidence: 1,
      strategy: "manual",
      reason: "same contract row",
    };
  }

  const leftSolicitation = canonicalSolicitation(left.solicitationNumber);
  const rightSolicitation = canonicalSolicitation(right.solicitationNumber);
  const leftTitle = normalizedTitle(left.title);
  const rightTitle = normalizedTitle(right.title);
  const titleMatches = Boolean(leftTitle && rightTitle && leftTitle === rightTitle);
  const agencyMatches = hasAgencyMatch(left, right);

  if (leftSolicitation && rightSolicitation) {
    if (leftSolicitation !== rightSolicitation) {
      return {
        isMatch: false,
        requiresReview: false,
        confidence: 0,
        strategy: null,
        reason: "different solicitation numbers",
      };
    }

    if ((isBroadVehicle(left) || isBroadVehicle(right)) && !titleMatches) {
      return {
        isMatch: true,
        requiresReview: true,
        confidence: 0.72,
        strategy: "solicitation_number",
        reason:
          "same solicitation number on a broad vehicle; title differs and needs review",
      };
    }

    if (agencyMatches || hasMissingAgency(left, right)) {
      return {
        isMatch: true,
        requiresReview: false,
        confidence: agencyMatches ? 0.98 : 0.9,
        strategy: "solicitation_number",
        reason: `same solicitation number; ${progressionReason(left, right)}`,
      };
    }

    return {
      isMatch: true,
      requiresReview: true,
      confidence: 0.74,
      strategy: "solicitation_number",
      reason: "same solicitation number but agency differs",
    };
  }

  if (!leftSolicitation && !rightSolicitation && titleMatches && agencyMatches) {
    return {
      isMatch: true,
      requiresReview: false,
      confidence: 0.86,
      strategy: "title_agency",
      reason: "same normalized title and agency with no solicitation number",
    };
  }

  if (titleMatches && agencyMatches) {
    return {
      isMatch: true,
      requiresReview: true,
      confidence: 0.76,
      strategy: "title_agency",
      reason:
        "same normalized title and agency but only one notice has a solicitation number",
    };
  }

  const overlap = attachmentOverlapScore(left.resourceLinks, right.resourceLinks);
  if (overlap >= 0.5 && agencyMatches) {
    return {
      isMatch: true,
      requiresReview: overlap < 1,
      confidence: overlap >= 1 ? 0.84 : 0.78,
      strategy: "attachment_overlap",
      reason: `shared attachment/resource links (${Math.round(overlap * 100)}% overlap)`,
    };
  }

  return {
    isMatch: false,
    requiresReview: false,
    confidence: 0,
    strategy: null,
    reason: "no family match signal",
  };
}

function deadlineScore(value: Date | string | null, now: Date): number {
  if (!value) return 1;
  const deadline = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(deadline.getTime())) return 1;
  return deadline >= now ? 2 : 0;
}

function dateMillis(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function compareCurrentNotice(
  left: FamilyContract,
  right: FamilyContract,
  now: Date,
): number {
  const checks = [
    Number(right.active) - Number(left.active),
    noticeTypeRank(right.noticeType) - noticeTypeRank(left.noticeType),
    dateMillis(right.postedDate) - dateMillis(left.postedDate),
    deadlineScore(right.responseDeadline, now) -
      deadlineScore(left.responseDeadline, now),
    dateMillis(right.responseDeadline) - dateMillis(left.responseDeadline),
    documentCount(right) - documentCount(left),
  ];

  for (const check of checks) {
    if (check !== 0) return check;
  }

  return right.id.localeCompare(left.id);
}

export function selectCurrentNotice<T extends FamilyContract>(
  members: T[],
  now = new Date(),
): T | null {
  if (members.length === 0) return null;

  const allArchived = members.every(isArchived);
  const candidates = allArchived
    ? [...members]
    : members.filter((member) => !isArchived(member));

  candidates.sort((left, right) => compareCurrentNotice(left, right, now));
  return candidates[0] ?? null;
}

export function roleForFamilyMember(
  member: FamilyContract,
  current: FamilyContract | null,
  match: Pick<FamilyMatchResult, "requiresReview"> | null = null,
): FamilyMemberRole {
  if (match?.requiresReview) return "possible_match";
  if (current && member.id === current.id) return "current";
  if (!current) return "older_version";

  const memberPosted = dateMillis(member.postedDate);
  const currentPosted = dateMillis(current.postedDate);
  const memberRank = noticeTypeRank(member.noticeType);
  const currentRank = noticeTypeRank(current.noticeType);

  if (memberPosted < currentPosted || memberRank < currentRank) {
    return "superseded";
  }

  return "older_version";
}

export function deriveFamilyDecision(members: FamilyContract[]): FamilyDecision {
  if (members.some((member) => member.promoted)) return "PROMOTE";
  if (members.length > 0 && members.every(isArchived)) return "ARCHIVE";
  return "UNREVIEWED";
}
