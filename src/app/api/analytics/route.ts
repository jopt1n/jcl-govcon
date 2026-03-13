import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * GET /api/analytics
 *
 * Returns aggregated analytics data for the dashboard.
 */
export async function GET() {
  try {
    const [
      classificationRows,
      agencyRows,
      overrideRows,
      deadlineRows,
      weeklyRows,
    ] = await Promise.all([
      // Classification breakdown
      db
        .select({
          classification: contracts.classification,
          count: sql<number>`count(*)::int`,
        })
        .from(contracts)
        .groupBy(contracts.classification),

      // Top 10 agencies
      db
        .select({
          agency: contracts.agency,
          count: sql<number>`count(*)::int`,
        })
        .from(contracts)
        .where(sql`${contracts.agency} IS NOT NULL`)
        .groupBy(contracts.agency)
        .orderBy(sql`count(*) DESC`)
        .limit(10),

      // Override rate
      db
        .select({
          total: sql<number>`count(*)::int`,
          overridden: sql<number>`count(*) FILTER (WHERE ${contracts.userOverride} = true)::int`,
        })
        .from(contracts)
        .where(sql`${contracts.classification} != 'PENDING'`),

      // Upcoming deadlines (next 30 days, grouped by day)
      db
        .select({
          date: sql<string>`${contracts.responseDeadline}::date::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(contracts)
        .where(
          sql`${contracts.responseDeadline} >= CURRENT_DATE AND ${contracts.responseDeadline} < CURRENT_DATE + INTERVAL '30 days'`
        )
        .groupBy(sql`${contracts.responseDeadline}::date`)
        .orderBy(sql`${contracts.responseDeadline}::date`),

      // Contracts by week (last 12 weeks)
      db
        .select({
          week: sql<string>`date_trunc('week', ${contracts.postedDate})::date::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(contracts)
        .where(
          sql`${contracts.postedDate} >= CURRENT_DATE - INTERVAL '12 weeks'`
        )
        .groupBy(sql`date_trunc('week', ${contracts.postedDate})`)
        .orderBy(sql`date_trunc('week', ${contracts.postedDate})`),
    ]);

    // Build classification counts map
    const classificationCounts: Record<string, number> = {
      GOOD: 0,
      MAYBE: 0,
      DISCARD: 0,
      PENDING: 0,
    };
    for (const row of classificationRows) {
      classificationCounts[row.classification] = row.count;
    }

    // Override rate
    const total = overrideRows[0]?.total ?? 0;
    const overridden = overrideRows[0]?.overridden ?? 0;
    const rate = total > 0 ? Math.round((overridden / total) * 100) : 0;

    return NextResponse.json({
      classificationCounts,
      topAgencies: agencyRows,
      overrideRate: { total, overridden, rate },
      upcomingDeadlines: deadlineRows,
      contractsByWeek: weeklyRows,
    });
  } catch (err) {
    console.error("[api/analytics] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch analytics",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
