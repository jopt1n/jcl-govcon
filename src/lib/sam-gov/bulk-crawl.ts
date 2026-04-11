import { db } from "@/lib/db";
import { contracts, crawlProgress } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { searchOpportunities, formatSamDate, canMakeCall } from "./client";
import { mapOpportunityToContract } from "./mappers";

/** Page size for SAM.gov pagination */
const PAGE_SIZE = 1000;

interface BulkCrawlResult {
  totalFound: number;
  processed: number;
  newInserted: number;
  skipped: number;
  status: "COMPLETE" | "PAUSED";
  pagesProcessed: number;
}

/**
 * Run a full-year crawl by splitting into two 6-month windows (SAM.gov max range).
 * Aggregates results from both windows.
 */
export async function runFullYearCrawl(): Promise<BulkCrawlResult> {
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  console.log(`[bulk-crawl] Full year crawl: Window 1 = ${formatSamDate(oneYearAgo)} → ${formatSamDate(sixMonthsAgo)}`);
  const r1 = await runBulkCrawl(oneYearAgo, sixMonthsAgo);

  if (r1.status === "PAUSED") {
    console.log("[bulk-crawl] Window 1 paused — skipping window 2");
    return r1;
  }

  console.log(`[bulk-crawl] Full year crawl: Window 2 = ${formatSamDate(sixMonthsAgo)} → ${formatSamDate(now)}`);
  const r2 = await runBulkCrawl(sixMonthsAgo, now);

  return {
    totalFound: r1.totalFound + r2.totalFound,
    processed: r1.processed + r2.processed,
    newInserted: r1.newInserted + r2.newInserted,
    skipped: r1.skipped + r2.skipped,
    status: r2.status,
    pagesProcessed: r1.pagesProcessed + r2.pagesProcessed,
  };
}

/**
 * Orchestrate a metadata-only bulk crawl of all active solicitations from SAM.gov.
 * - Fetches all active opportunities (ptype=o,k,p,r) with pagination
 * - Upserts metadata into contracts table (no descriptions, no classification)
 * - Tracks progress in crawl_progress table
 * - Resumes from last offset if a previous run was paused
 * - Stops when API rate limit is reached
 */
export async function runBulkCrawl(windowStart?: Date, windowEnd?: Date): Promise<BulkCrawlResult> {
  // Default to 6-month lookback if no dates provided
  if (!windowEnd) windowEnd = new Date();
  if (!windowStart) {
    windowStart = new Date(windowEnd);
    windowStart.setMonth(windowStart.getMonth() - 6);
  }
  // DRY_RUN: log and return immediately without any API calls
  if (process.env.SAM_DRY_RUN === "true") {
    console.log("[bulk-crawl] DRY_RUN enabled — skipping crawl");
    return {
      totalFound: 0,
      processed: 0,
      newInserted: 0,
      skipped: 0,
      status: "COMPLETE",
      pagesProcessed: 0,
    };
  }

  // Check for existing RUNNING crawl to resume
  const existing = await db
    .select()
    .from(crawlProgress)
    .where(eq(crawlProgress.status, "RUNNING"))
    .limit(1);

  let crawlRow: typeof existing[0] | null = existing[0] ?? null;
  let startOffset = crawlRow?.lastOffset ?? 0;

  // Create new crawl progress row if none exists
  if (!crawlRow) {
    const inserted = await db
      .insert(crawlProgress)
      .values({
        totalFound: 0,
        processed: 0,
        classified: 0,
        lastOffset: 0,
        status: "RUNNING",
      })
      .returning();
    crawlRow = inserted[0];
    startOffset = 0;
  }

  const crawlId = crawlRow.id;
  let totalFound = crawlRow.totalFound;
  let processed = crawlRow.processed;
  let newInserted = 0;
  let skipped = 0;
  let pagesProcessed = 0;
  let offset = startOffset;
  let status: "COMPLETE" | "PAUSED" = "COMPLETE";

  try {
    // Paginate through all active opportunities
    let hasMore = true;

    while (hasMore) {
      // Check if crawl has been paused by user
      const [currentStatus] = await db
        .select({ status: crawlProgress.status })
        .from(crawlProgress)
        .where(eq(crawlProgress.id, crawlId))
        .limit(1);

      if (currentStatus?.status === "PAUSED") {
        console.log("[bulk-crawl] Paused by user, stopping early");
        status = "PAUSED";
        break;
      }

      // Check API rate limit before each page fetch
      if (!(await canMakeCall())) {
        status = "PAUSED";
        console.log("[bulk-crawl] Pausing: daily API limit reached");
        break;
      }

      // SAM.gov requires postedFrom/postedTo — use date window from caller
      const response = await searchOpportunities({
        ptype: "o,k,p,r",
        active: "Yes",
        postedFrom: formatSamDate(windowStart),
        postedTo: formatSamDate(windowEnd),
        limit: PAGE_SIZE,
        offset,
      });

      // Update total on first page
      if (pagesProcessed === 0 || totalFound === 0) {
        totalFound = response.totalRecords;
      }

      const opportunities = response.opportunitiesData ?? [];

      if (opportunities.length === 0) {
        hasMore = false;
        break;
      }

      // Bulk upsert in chunks of 500 (Railway PostgreSQL — minimize round trips)
      const CHUNK_SIZE = 500;
      const rows = opportunities.map(mapOpportunityToContract);

      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        try {
          const result = await db
            .insert(contracts)
            .values(chunk)
            .onConflictDoUpdate({
              target: contracts.noticeId,
              set: {
                title: sql`excluded.title`,
                noticeType: sql`excluded.notice_type`,
                responseDeadline: sql`excluded.response_deadline`,
                active: sql`excluded.active`,
                rawJson: sql`excluded.raw_json`,
                agency: sql`excluded.agency`,
                naicsCode: sql`excluded.naics_code`,
                pscCode: sql`excluded.psc_code`,
                setAsideType: sql`excluded.set_aside_type`,
                awardCeiling: sql`excluded.award_ceiling`,
                postedDate: sql`excluded.posted_date`,
                samUrl: sql`excluded.sam_url`,
                resourceLinks: sql`excluded.resource_links`,
                orgPathName: sql`excluded.org_path_name`,
                orgPathCode: sql`excluded.org_path_code`,
                popState: sql`excluded.pop_state`,
                popCity: sql`excluded.pop_city`,
                popZip: sql`excluded.pop_zip`,
                officeCity: sql`excluded.office_city`,
                officeState: sql`excluded.office_state`,
                setAsideCode: sql`excluded.set_aside_code`,
                contactEmail: sql`excluded.contact_email`,
                solicitationNumber: sql`excluded.solicitation_number`,
                updatedAt: sql`now()`,
              },
            })
            .returning({ id: contracts.id });

          newInserted += result.length;
        } catch (err) {
          console.error(`[bulk-crawl] Error upserting chunk at offset ${i}:`, err instanceof Error ? err.message : err);
          skipped += chunk.length;
        }
      }

      processed += rows.length;

      offset += opportunities.length;
      pagesProcessed++;

      // Update progress after each page
      await db
        .update(crawlProgress)
        .set({
          totalFound,
          processed,
          lastOffset: offset,
          updatedAt: new Date(),
        })
        .where(eq(crawlProgress.id, crawlId));

      console.log(`[bulk-crawl] Page ${Math.ceil(offset / PAGE_SIZE)}/${Math.ceil(totalFound / PAGE_SIZE)} — ${offset} records processed`);

      // Check if we've fetched everything
      if (offset >= totalFound) {
        hasMore = false;
      }
    }

    // Mark crawl status
    await db
      .update(crawlProgress)
      .set({
        totalFound,
        processed,
        lastOffset: offset,
        status,
        updatedAt: new Date(),
      })
      .where(eq(crawlProgress.id, crawlId));
  } catch (err) {
    // On error, pause the crawl so it can be resumed
    await db
      .update(crawlProgress)
      .set({
        totalFound,
        processed,
        lastOffset: offset,
        status: "PAUSED",
        updatedAt: new Date(),
      })
      .where(eq(crawlProgress.id, crawlId));

    throw err;
  }

  return {
    totalFound,
    processed,
    newInserted,
    skipped,
    status,
    pagesProcessed,
  };
}
