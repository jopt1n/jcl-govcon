import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq, ilike, and, sql, desc, type SQL } from "drizzle-orm";

/**
 * GET /api/contracts
 *
 * List contracts with filters, pagination, search.
 * Query params: classification, search, page, limit, agency, noticeType
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const classification = searchParams.get("classification");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
    const agency = searchParams.get("agency");
    const noticeType = searchParams.get("noticeType");
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];

    if (classification && ["GOOD", "MAYBE", "DISCARD", "PENDING"].includes(classification)) {
      conditions.push(eq(contracts.classification, classification as "GOOD" | "MAYBE" | "DISCARD" | "PENDING"));
    }

    if (search) {
      conditions.push(
        sql`(${ilike(contracts.title, `%${search}%`)} OR ${ilike(contracts.agency, `%${search}%`)} OR ${ilike(contracts.solicitationNumber, `%${search}%`)})`
      );
    }

    if (agency) {
      conditions.push(ilike(contracts.agency, `%${agency}%`));
    }

    if (noticeType) {
      conditions.push(eq(contracts.noticeType, noticeType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
        })
        .from(contracts)
        .where(whereClause)
        .orderBy(desc(contracts.postedDate))
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
      { error: "Failed to fetch contracts", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
