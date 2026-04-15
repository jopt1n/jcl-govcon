/**
 * GET /api/crawl-runs/latest?kind=weekly
 *
 * Returns the most recent crawl_runs row matching the given kind. Used by
 * the Inbox page header to show "Last weekly run: <timestamp>" and by the
 * Admin page for a quick status snapshot.
 *
 * Public read: no auth. The data it exposes (run timestamps + counts) is
 * already visible on the admin page and is not sensitive.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crawlRuns } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? "weekly";

  const rows = await db
    .select()
    .from(crawlRuns)
    .where(eq(crawlRuns.kind, kind))
    .orderBy(desc(crawlRuns.createdAt))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ run: null });
  }

  return NextResponse.json({ run: rows[0] });
}
