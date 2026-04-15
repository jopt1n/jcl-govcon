import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import {
  eq,
  ilike,
  and,
  gt,
  ne,
  sql,
  desc,
  asc,
  isNull,
  isNotNull,
  type SQL,
} from "drizzle-orm";

/**
 * GET /api/contracts
 *
 * List contracts with filters, pagination, search.
 * Query params: classification, search, page, limit, agency, noticeType,
 *               unreviewed, includeUnreviewed
 *
 * Review filter (default behavior):
 *   Main Kanban only shows contracts the user has triaged (reviewedAt IS
 *   NOT NULL). New weekly contracts live on /inbox until marked reviewed.
 *
 *   - unreviewed=true         → only unreviewed (for /inbox page)
 *   - includeUnreviewed=true  → ignore the review filter entirely
 *   - default                 → reviewedAt IS NOT NULL
 *
 * Special mode: classification=DEADLINES
 *   Returns GOOD/MAYBE/DISCARD contracts with future deadlines,
 *   grouped by classification priority (GOOD first, then MAYBE, then DISCARD)
 *   and sorted by deadline ascending within each group.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const classification = searchParams.get("classification");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)),
    );
    const agency = searchParams.get("agency");
    const noticeType = searchParams.get("noticeType");
    const unreviewed = searchParams.get("unreviewed") === "true";
    const includeUnreviewed = searchParams.get("includeUnreviewed") === "true";
    const offset = (page - 1) * limit;

    const isDeadlines = classification === "DEADLINES";

    const conditions: SQL[] = [];

    // Review filter: unreviewed mode wins, then default to reviewed-only
    if (unreviewed) {
      conditions.push(isNull(contracts.reviewedAt));
    } else if (!includeUnreviewed) {
      conditions.push(isNotNull(contracts.reviewedAt));
    }

    if (isDeadlines) {
      // Future deadlines only, exclude PENDING
      conditions.push(gt(contracts.responseDeadline, new Date()));
      conditions.push(ne(contracts.classification, "PENDING"));
    } else if (
      classification &&
      ["GOOD", "MAYBE", "DISCARD", "PENDING"].includes(classification)
    ) {
      conditions.push(
        eq(
          contracts.classification,
          classification as "GOOD" | "MAYBE" | "DISCARD" | "PENDING",
        ),
      );
    }

    if (search) {
      conditions.push(
        sql`(${ilike(contracts.title, `%${search}%`)} OR ${ilike(contracts.agency, `%${search}%`)} OR ${ilike(contracts.solicitationNumber, `%${search}%`)})`,
      );
    }

    if (agency) {
      conditions.push(ilike(contracts.agency, `%${agency}%`));
    }

    if (noticeType) {
      conditions.push(eq(contracts.noticeType, noticeType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Deadlines mode: sort by classification priority (GOOD=1, MAYBE=2, DISCARD=3), then deadline ASC
    const orderClause = isDeadlines
      ? [
          sql`CASE classification WHEN 'GOOD' THEN 1 WHEN 'MAYBE' THEN 2 ELSE 3 END`,
          asc(contracts.responseDeadline),
        ]
      : [desc(contracts.postedDate)];

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: contracts.id,
          title: contracts.title,
          agency: contracts.agency,
          awardCeiling: contracts.awardCeiling,
          responseDeadline: contracts.responseDeadline,
          noticeType: contracts.noticeType,
          classification: contracts.classification,
          aiReasoning: contracts.aiReasoning,
          status: contracts.status,
          postedDate: contracts.postedDate,
          userOverride: contracts.userOverride,
          reviewedAt: contracts.reviewedAt,
          createdAt: contracts.createdAt,
        })
        .from(contracts)
        .where(whereClause)
        .orderBy(...orderClause)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(contracts)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return NextResponse.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[api/contracts] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch contracts",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
