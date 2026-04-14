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

/**
 * Same-origin guard for browser-initiated GET endpoints that can't carry a
 * Bearer token (e.g. `window.location.href = /api/…` triggered by a button
 * click). Blocks non-browser clients (curl, crawlers, bots) and cross-origin
 * requests by checking the Origin or Referer header against an allowlist
 * built from NEXT_PUBLIC_APP_URL and the request's own Host header.
 *
 * This is NOT user authentication. It's the minimum-viable fix for a
 * single-user internal tool. Full session auth is a separate project-wide
 * concern tracked in TODOS.md.
 *
 * Host fallback rationale: Railway often exposes a project at both
 * *.railway.app and a custom domain; matching against the request's own
 * Host makes the browser button work on either URL without having to
 * maintain a comma-separated NEXT_PUBLIC_APP_URL list. The only bypass
 * scenario is someone forging the Host header, which requires network-
 * level access — at which point the CSV export is the least interesting
 * target.
 *
 * NODE_ENV is read per-call (not captured at module load) so tests that
 * mutate process.env.NODE_ENV inside the test process affect this helper.
 */
export function requireSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");

  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const appUrl = rawAppUrl ? rawAppUrl.replace(/\/$/, "") : null;

  const allowlist: string[] = [];
  if (appUrl) allowlist.push(appUrl);
  if (host) {
    allowlist.push(`https://${host}`);
    allowlist.push(`http://${host}`);
  }

  if (allowlist.length === 0) {
    // No config and no Host header — should be impossible for a real HTTP
    // request. Pass through in dev, fail closed in prod.
    return process.env.NODE_ENV !== "production";
  }

  if (origin) {
    for (const entry of allowlist) {
      if (origin === entry) return true;
    }
    return false;
  }

  if (referer) {
    for (const entry of allowlist) {
      if (referer.startsWith(entry)) return true;
    }
    return false;
  }

  // Neither origin nor referer present. curl typically sends neither;
  // browser same-origin GET navigation always sends at least Referer.
  return process.env.NODE_ENV !== "production";
}
