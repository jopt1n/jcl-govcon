/**
 * RFC 4180 CSV field escaping. Wraps fields in quotes if they contain
 * commas, quotes, or newlines; doubles internal quotes.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
