import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts, watchTargetLinks, watchTargets } from "@/lib/db/schema";
import { RESTRICTED_SET_ASIDE_PREFIXES } from "@/lib/sam-gov/set-aside-filter";
import {
  eq,
  ilike,
  and,
  gt,
  gte,
  ne,
  sql,
  desc,
  asc,
  inArray,
  isNull,
  isNotNull,
  type SQL,
} from "drizzle-orm";

/**
 * GET /api/contracts
 *
 * List contracts with filters, pagination, search.
 * Query params: classification, search, page, limit, agency, noticeType,
 *               postedAfter, setAsideQualifying, unreviewed, includeUnreviewed,
 *               expired, includeExpired, archived, includeArchived, watched
 *
 * noticeType accepts a single value or comma-separated list:
 *   ?noticeType=Solicitation,Presolicitation
 *
 * postedAfter: ISO timestamp string; filters postedDate >= value.
 *
 * setAsideQualifying=true restricts to set-aside codes JCL qualifies for
 * (SBA, SBP, NONE, empty, or NULL).
 *
 * Review filter (default behavior):
 *   Main Kanban only shows contracts the user has triaged (reviewedAt IS
 *   NOT NULL). New weekly contracts live on /inbox until marked reviewed.
 *
 *   - unreviewed=true         → only unreviewed (for /inbox page)
 *   - includeUnreviewed=true  → ignore the review filter entirely
 *   - default                 → reviewedAt IS NOT NULL
 *
 * Expiration filter (default behavior):
 *   Active views hide expired response deadlines and manually archived rows
 *   by default. This preserves the original AI classification while keeping
 *   stale opportunities out of daily triage surfaces.
 *
 *   - expired=true         → only expired contracts
 *   - includeExpired=true  → ignore expiration entirely
 *   - default              → responseDeadline is NULL or still in the future
 *
 * Manual archive filter:
 *   Manual archive state is stored as the "ARCHIVED" tag. `archived=true`
 *   returns manual archives OR expired rows for the unified /archive view.
 *   `includeArchived=true` disables both the manual archive and expiration
 *   default filters.
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
    const noticeTypeParam = searchParams.get("noticeType");
    const noticeTypes = noticeTypeParam
      ? noticeTypeParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const postedAfterParam = searchParams.get("postedAfter");
    const postedAfter = postedAfterParam ? new Date(postedAfterParam) : null;
    const setAsideQualifying =
      searchParams.get("setAsideQualifying") === "true" ||
      searchParams.get("setAsideQualifying") === "1";
    const unreviewed = searchParams.get("unreviewed") === "true";
    const includeUnreviewed = searchParams.get("includeUnreviewed") === "true";
    const expired =
      searchParams.get("expired") === "true" ||
      searchParams.get("expired") === "1";
    const includeExpired =
      searchParams.get("includeExpired") === "true" ||
      searchParams.get("includeExpired") === "1";
    const archived =
      searchParams.get("archived") === "true" ||
      searchParams.get("archived") === "1";
    const includeArchived =
      searchParams.get("includeArchived") === "true" ||
      searchParams.get("includeArchived") === "1";
    // ?promoted=true|false — filter by user-driven promotion. Anything other
    // than those two literal strings is rejected below with 400.
    const promotedParam = searchParams.get("promoted");
    // ?watched=true|false — filter by whether this contract is linked to an
    // active watch target. Watch is an orthogonal workflow flag, not a stored
    // field on contracts, so this compiles down to an EXISTS subquery below.
    const watchedParam = searchParams.get("watched");
    const offset = (page - 1) * limit;

    if (
      promotedParam !== null &&
      promotedParam !== "true" &&
      promotedParam !== "false"
    ) {
      return NextResponse.json({ error: "Invalid promoted" }, { status: 400 });
    }
    if (
      watchedParam !== null &&
      watchedParam !== "true" &&
      watchedParam !== "false"
    ) {
      return NextResponse.json({ error: "Invalid watched" }, { status: 400 });
    }

    const isDeadlines = classification === "DEADLINES";

    const conditions: SQL[] = [];

    // Review filter: unreviewed mode wins, then default to reviewed-only
    if (unreviewed) {
      conditions.push(isNull(contracts.reviewedAt));
    } else if (!includeUnreviewed) {
      conditions.push(isNotNull(contracts.reviewedAt));
    }

    // Archive filters:
    // - Expired archive is computed from the current deadline.
    // - Manual archive is persisted as a tag so it survives SAM.gov metadata
    //   refreshes without needing a schema push.
    //
    // Both preserve GOOD/MAYBE/DISCARD for analytics while hiding stale or
    // explicitly skipped rows from active triage by default.
    if (archived) {
      conditions.push(
        sql`((COALESCE(${contracts.tags}, '[]'::jsonb) @> '["ARCHIVED"]'::jsonb) OR (${contracts.responseDeadline} IS NOT NULL AND ${contracts.responseDeadline} < NOW()))`,
      );
    } else if (expired) {
      conditions.push(
        sql`${contracts.responseDeadline} IS NOT NULL AND ${contracts.responseDeadline} < NOW()`,
      );
    } else if (!includeArchived) {
      conditions.push(
        sql`NOT (COALESCE(${contracts.tags}, '[]'::jsonb) @> '["ARCHIVED"]'::jsonb)`,
      );
    }

    if (!archived && !includeArchived && !includeExpired && !expired) {
      conditions.push(
        sql`(${contracts.responseDeadline} IS NULL OR ${contracts.responseDeadline} >= NOW())`,
      );
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

    if (noticeTypes.length === 1) {
      conditions.push(eq(contracts.noticeType, noticeTypes[0]));
    } else if (noticeTypes.length > 1) {
      conditions.push(inArray(contracts.noticeType, noticeTypes));
    }

    if (postedAfter && !Number.isNaN(postedAfter.getTime())) {
      conditions.push(gte(contracts.postedDate, postedAfter));
    }

    if (setAsideQualifying) {
      // Mirror isRestrictedSetAside(): NULL/empty qualify; otherwise exclude
      // any code whose uppercase form starts with a restricted prefix
      // (8A, SDVOSB, HZ, WOSB, EDWOSB, ISBEE, VSA, VSB).
      const prefixPattern = `^(${RESTRICTED_SET_ASIDE_PREFIXES.join("|")})`;
      conditions.push(
        sql`(${contracts.setAsideCode} IS NULL OR ${contracts.setAsideCode} = '' OR ${contracts.setAsideCode} !~* ${prefixPattern})`,
      );
    }

    if (promotedParam === "true") {
      conditions.push(eq(contracts.promoted, true));
    } else if (promotedParam === "false") {
      conditions.push(eq(contracts.promoted, false));
    }

    if (watchedParam === "true") {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM ${watchTargetLinks}
        INNER JOIN ${watchTargets}
          ON ${watchTargets.id} = ${watchTargetLinks.watchTargetId}
        WHERE ${watchTargetLinks.contractId} = ${contracts.id}
          AND ${watchTargets.active} = true
      )`);
    } else if (watchedParam === "false") {
      conditions.push(sql`NOT EXISTS (
        SELECT 1
        FROM ${watchTargetLinks}
        INNER JOIN ${watchTargets}
          ON ${watchTargets.id} = ${watchTargetLinks.watchTargetId}
        WHERE ${watchTargetLinks.contractId} = ${contracts.id}
          AND ${watchTargets.active} = true
      )`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Deadlines mode: sort by classification priority (GOOD=1, MAYBE=2, DISCARD=3), then deadline ASC.
    // Promoted mode: sort by promotedAt DESC (most recently elevated first) so /chosen
    // surfaces fresh promotions at the top. Tiebreak on id DESC so same-millisecond
    // promotions (bulk scripts, test fixtures) have deterministic page boundaries.
    const orderClause = isDeadlines
      ? [
          sql`CASE classification WHEN 'GOOD' THEN 1 WHEN 'MAYBE' THEN 2 ELSE 3 END`,
          asc(contracts.responseDeadline),
        ]
      : promotedParam === "true"
        ? [desc(contracts.promotedAt), desc(contracts.id)]
        : expired
          ? [desc(contracts.responseDeadline), desc(contracts.postedDate)]
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
          summary: contracts.summary,
          actionPlan: contracts.actionPlan,
          notes: contracts.notes,
          status: contracts.status,
          postedDate: contracts.postedDate,
          userOverride: contracts.userOverride,
          reviewedAt: contracts.reviewedAt,
          promoted: contracts.promoted,
          promotedAt: contracts.promotedAt,
          tags: contracts.tags,
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
