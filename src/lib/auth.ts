import { NextRequest } from "next/server";

/**
 * Verify the request carries a valid Bearer token matching INGEST_SECRET.
 * Used by all protected API routes.
 */
export function authorize(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  return token === process.env.INGEST_SECRET;
}
