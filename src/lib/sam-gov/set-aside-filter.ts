/**
 * Prefix-based set-aside filter.
 * Catches all SAM.gov code variants (e.g. SDVOSB, SDVOSBC, 8A, 8AN, HZC, WOSBSS).
 */

export const RESTRICTED_SET_ASIDE_PREFIXES = [
  "8A",
  "SDVOSB",
  "HZ",
  "WOSB",
  "EDWOSB",
  "ISBEE",
  "VSA",
  "VSB",
] as const;

export function isRestrictedSetAside(code: string | null): boolean {
  if (!code || code === "") return false;
  const upper = code.toUpperCase();
  return RESTRICTED_SET_ASIDE_PREFIXES.some((prefix) =>
    upper.startsWith(prefix),
  );
}
