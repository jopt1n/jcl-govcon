export const PURSUIT_STAGES = [
  "NEEDS_DEEP_DIVE",
  "RESEARCH_COMPLETE",
  "VENDOR_OUTREACH_NEEDED",
  "OUTREACH_SENT",
  "RESPONSE_RECEIVED",
  "BID_DECISION",
  "PROPOSAL_IN_PROGRESS",
  "SUBMITTED",
] as const;

export const PURSUIT_OUTCOMES = [
  "WON",
  "LOST",
  "NO_BID",
  "ARCHIVED",
] as const;

export const CASH_BURDENS = [
  "UNKNOWN",
  "LOW",
  "MEDIUM",
  "HIGH",
  "OVER_40K",
] as const;

export const PURSUIT_CONTACT_ROLES = [
  "GOVERNMENT_POC",
  "VENDOR",
  "MANUFACTURER",
  "RESELLER",
  "PARTNER",
] as const;

export const PURSUIT_INTERACTION_TYPES = [
  "EMAIL_SENT",
  "CALL_MADE",
  "QUOTE_REQUESTED",
  "RESPONSE_RECEIVED",
  "FOLLOW_UP_NEEDED",
  "NO_BID_DECISION",
  "NOTE",
  "STAGE_CHANGED",
] as const;

export type PursuitStage = (typeof PURSUIT_STAGES)[number];
export type PursuitOutcome = (typeof PURSUIT_OUTCOMES)[number];
export type CashBurden = (typeof CASH_BURDENS)[number];
export type PursuitContactRole = (typeof PURSUIT_CONTACT_ROLES)[number];
export type PursuitInteractionType = (typeof PURSUIT_INTERACTION_TYPES)[number];

export type DeadlineFilter = "overdue" | "week" | "month" | "none";

export function isPursuitStage(value: unknown): value is PursuitStage {
  return PURSUIT_STAGES.includes(value as PursuitStage);
}

export function isPursuitOutcome(value: unknown): value is PursuitOutcome {
  return PURSUIT_OUTCOMES.includes(value as PursuitOutcome);
}

export function isCashBurden(value: unknown): value is CashBurden {
  return CASH_BURDENS.includes(value as CashBurden);
}

export function isPursuitContactRole(
  value: unknown,
): value is PursuitContactRole {
  return PURSUIT_CONTACT_ROLES.includes(value as PursuitContactRole);
}

export function isPursuitInteractionType(
  value: unknown,
): value is PursuitInteractionType {
  return PURSUIT_INTERACTION_TYPES.includes(value as PursuitInteractionType);
}
