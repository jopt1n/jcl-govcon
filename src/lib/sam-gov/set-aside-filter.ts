/**
 * Prefix-based set-aside filter.
 * Catches all SAM.gov code variants (e.g. SDVOSB, SDVOSBC, 8A, 8AN, HZC, WOSBSS).
 */

const RESTRICTED_PREFIXES = ["8A", "SDVOSB", "HZ", "WOSB", "EDWOSB", "ISBEE", "VSA", "VSB"];

export function isRestrictedSetAside(code: string | null): boolean {
  if (!code || code === "") return false;
  const upper = code.toUpperCase();
  return RESTRICTED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}
