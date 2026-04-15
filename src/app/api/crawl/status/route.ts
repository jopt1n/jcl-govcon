import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crawlProgress, batchJobs, contracts, apiUsage } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/**
 * GET /api/crawl/status
 *
 * Get current crawl progress, API usage, and pipeline counts.
 *
 * Auth: Authorization: Bearer {INGEST_SECRET}
 */
export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get latest crawl progress
    const [latestCrawl] = await db
      .select()
      .from(crawlProgress)
      .orderBy(desc(crawlProgress.startedAt))
      .limit(1);

    // Get latest batch job
    const [latestBatch] = await db
      .select()
      .from(batchJobs)
      .orderBy(desc(batchJobs.submittedAt))
      .limit(1);

    // Get classification counts
    const classificationCounts = await db
      .select({
        classification: contracts.classification,
        count: sql<number>`count(*)::int`,
      })
      .from(contracts)
      .groupBy(contracts.classification);

    const counts: Record<string, number> = {};
    for (const row of classificationCounts) {
      counts[row.classification] = row.count;
    }

    // Get today's API usage
    const today = new Date().toISOString().slice(0, 10);
    const [todayUsage] = await db
      .select()
      .from(apiUsage)
      .where(eq(apiUsage.date, today))
      .limit(1);

    const dailyLimit = 950;
    const searchCalls = todayUsage?.searchCalls ?? 0;
    const docFetches = todayUsage?.docFetches ?? 0;

    // Get pipeline counts
    const [pipelineCounts] = await db
      .select({
        totalIngested: sql<number>`count(*)::int`,
        pendingClassification: sql<number>`count(*) filter (where ${contracts.classification} = 'PENDING')::int`,
        classified: sql<number>`count(*) filter (where ${contracts.classification} != 'PENDING')::int`,
        goodCount: sql<number>`count(*) filter (where ${contracts.classification} = 'GOOD')::int`,
        maybeCount: sql<number>`count(*) filter (where ${contracts.classification} = 'MAYBE')::int`,
        discardCount: sql<number>`count(*) filter (where ${contracts.classification} = 'DISCARD')::int`,
        descriptionsFetched: sql<number>`count(*) filter (where ${contracts.descriptionFetched} = true)::int`,
      })
      .from(contracts);

    return NextResponse.json({
      crawl: latestCrawl
        ? {
            id: latestCrawl.id,
            status: latestCrawl.status,
            totalFound: latestCrawl.totalFound,
            processed: latestCrawl.processed,
            classified: latestCrawl.classified,
            lastOffset: latestCrawl.lastOffset,
            startedAt: latestCrawl.startedAt,
            updatedAt: latestCrawl.updatedAt,
          }
        : null,
      batchJob: latestBatch
        ? {
            id: latestBatch.id,
            jobName: latestBatch.geminiJobName,
            status: latestBatch.status,
            contractsCount: latestBatch.contractsCount,
            submittedAt: latestBatch.submittedAt,
            completedAt: latestBatch.completedAt,
            results: latestBatch.resultsJson,
          }
        : null,
      contracts: {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        good: counts["GOOD"] ?? 0,
        maybe: counts["MAYBE"] ?? 0,
        discard: counts["DISCARD"] ?? 0,
        pending: counts["PENDING"] ?? 0,
      },
      phase: "metadata",
      apiUsage: {
        searchCalls,
        docFetches,
        dailyLimit,
        remaining: dailyLimit - searchCalls,
      },
      pipeline: {
        totalIngested: pipelineCounts?.totalIngested ?? 0,
        pendingClassification: pipelineCounts?.pendingClassification ?? 0,
        classified: pipelineCounts?.classified ?? 0,
        goodCount: pipelineCounts?.goodCount ?? 0,
        maybeCount: pipelineCounts?.maybeCount ?? 0,
        discardCount: pipelineCounts?.discardCount ?? 0,
        descriptionsFetched: pipelineCounts?.descriptionsFetched ?? 0,
      },
    });
  } catch (err) {
    console.error("[crawl/status] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to get status",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
