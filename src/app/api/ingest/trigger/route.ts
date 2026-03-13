import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import {
  searchOpportunities,
  formatSamDate,
} from "@/lib/sam-gov/client";
import { runBulkCrawl } from "@/lib/sam-gov/bulk-crawl";
import { mapOpportunityToContract } from "@/lib/sam-gov/mappers";
import { filterDownloadableLinks } from "@/lib/sam-gov/documents";
import { authorize } from "@/lib/auth";
import { classifyFromMetadata } from "@/lib/ai/metadata-classifier";
import { fetchDescriptionsForRelevant } from "@/lib/sam-gov/fetch-descriptions";
import { reclassifyWithDescription } from "@/lib/ai/reclassify-with-description";

/**
 * POST /api/ingest/trigger
 *
 * Modes:
 *   - { mode: "daily" }  — full pipeline: ingest → classify → fetch descriptions → re-classify
 *   - { mode: "bulk" }   — full crawl of all active solicitations
 *
 * Auth: Authorization: Bearer {INGEST_SECRET}
 *
 * Note: Related contracts (e.g. amendments) are linked at read-time via
 * solicitationNumber, which is stored with a DB index. No special linking
 * logic is needed at ingest time.
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const mode = body.mode ?? "daily";

  if (mode === "bulk") {
    try {
      const result = await runBulkCrawl();
      return NextResponse.json({
        mode: "bulk",
        total: result.totalFound,
        processed: result.processed,
        new: result.newInserted,
        skipped: result.skipped,
        status: result.status,
        pages_processed: result.pagesProcessed,
      });
    } catch (err) {
      console.error("[ingest/trigger] Bulk crawl error:", err);
      return NextResponse.json(
        {
          error: "Bulk crawl failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 500 }
      );
    }
  }

  // ── Daily mode: full pipeline ─────────────────────────────────────────────

  try {
    // Step 1: Metadata ingest — fetch yesterday-today from SAM.gov
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const response = await searchOpportunities({
      ptype: "o,k,p,r",
      postedFrom: formatSamDate(yesterday),
      postedTo: formatSamDate(now),
      active: "Yes",
      limit: 1000,
      offset: 0,
    });

    const opportunities = response.opportunitiesData ?? [];
    let newCount = 0;
    let skippedCount = 0;
    let docsQueued = 0;
    let ingestErrors = 0;

    for (const opp of opportunities) {
      try {
        const row = mapOpportunityToContract(opp);

        const result = await db
          .insert(contracts)
          .values(row)
          .onConflictDoNothing({ target: contracts.noticeId })
          .returning({ id: contracts.id });

        if (result.length > 0) {
          newCount++;
          docsQueued += filterDownloadableLinks(opp.resourceLinks ?? []).length;
        } else {
          skippedCount++;
        }
      } catch (err) {
        ingestErrors++;
        console.error(`[ingest/trigger] Error inserting ${opp.noticeId}:`, err instanceof Error ? err.message : err);
      }
    }

    // Step 2: Metadata classification — classify new PENDING contracts
    const classifyResult = await classifyFromMetadata({ limit: 1000 });

    // Step 3: Selective description fetch — fetch descriptions for GOOD/MAYBE
    const fetchResult = await fetchDescriptionsForRelevant({ limit: 1000 });

    // Step 4: Re-classify — re-classify contracts that now have descriptions
    const reclassifyResult = await reclassifyWithDescription({ batchSize: 1000 });

    return NextResponse.json({
      mode: "daily",
      ingest: {
        total: opportunities.length,
        totalAvailable: response.totalRecords,
        new: newCount,
        skipped: skippedCount,
        errors: ingestErrors,
        docs_queued: docsQueued,
      },
      classify: classifyResult,
      fetchDescriptions: fetchResult,
      reclassify: reclassifyResult,
    });
  } catch (err) {
    console.error("[ingest/trigger] Daily ingest error:", err);
    return NextResponse.json(
      {
        error: "Daily ingest failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
