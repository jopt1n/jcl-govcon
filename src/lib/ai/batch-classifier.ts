/**
 * Batch classifier using chunked sequential processing.
 *
 * The Gemini @google/genai SDK doesn't have a stable batch API,
 * so we process contracts in chunks of 50 with delays between chunks.
 * Progress is tracked in the batch_jobs table.
 */

import { db } from "@/lib/db";
import { contracts, batchJobs, crawlProgress } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { classifyContract } from "./classifier";
import { delay } from "@/lib/utils";

const CHUNK_SIZE = 50;
const CHUNK_DELAY_MS = 2000; // 2s between chunks

interface BatchClassifyResult {
  batchJobId: string;
  total: number;
  classified: number;
  good: number;
  maybe: number;
  discard: number;
  errors: number;
  status: "SUCCEEDED" | "FAILED" | "PAUSED";
}

/**
 * Run batch classification on an array of contract IDs.
 * Processes in chunks of 50 with delays between chunks.
 * Tracks progress in batch_jobs and crawl_progress tables.
 */
export async function runBatchClassification(
  contractIds: string[],
  crawlProgressId?: string
): Promise<BatchClassifyResult> {
  // Create batch job record
  const jobName = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [batchJob] = await db
    .insert(batchJobs)
    .values({
      geminiJobName: jobName,
      contractsCount: contractIds.length,
      status: "RUNNING",
    })
    .returning();

  // Link batch job to crawl progress if provided
  if (crawlProgressId) {
    await db
      .update(crawlProgress)
      .set({ batchJobId: batchJob.id, updatedAt: new Date() })
      .where(eq(crawlProgress.id, crawlProgressId));
  }

  let classified = 0;
  let good = 0;
  let maybe = 0;
  let discard = 0;
  let errors = 0;

  try {
    // Process in chunks
    for (let i = 0; i < contractIds.length; i += CHUNK_SIZE) {
      // Check if crawl has been paused
      if (crawlProgressId) {
        const [progress] = await db
          .select({ status: crawlProgress.status })
          .from(crawlProgress)
          .where(eq(crawlProgress.id, crawlProgressId))
          .limit(1);

        if (progress?.status === "PAUSED") {
          console.log("[batch-classifier] Paused by user, stopping early");
          await db
            .update(batchJobs)
            .set({ status: "PAUSED", completedAt: new Date(), resultsJson: { good, maybe, discard, errors } })
            .where(eq(batchJobs.id, batchJob.id));
          return {
            batchJobId: batchJob.id,
            total: contractIds.length,
            classified,
            good,
            maybe,
            discard,
            errors,
            status: "PAUSED",
          };
        }
      }

      const chunkIds = contractIds.slice(i, i + CHUNK_SIZE);

      // Fetch contract data for this chunk
      const contractRows = await db
        .select({
          id: contracts.id,
          noticeId: contracts.noticeId,
          title: contracts.title,
          agency: contracts.agency,
          naicsCode: contracts.naicsCode,
          pscCode: contracts.pscCode,
          noticeType: contracts.noticeType,
          setAsideType: contracts.setAsideType,
          awardCeiling: contracts.awardCeiling,
          descriptionText: contracts.descriptionText,
          resourceLinks: contracts.resourceLinks,
        })
        .from(contracts)
        .where(inArray(contracts.id, chunkIds));

      // Classify each contract in the chunk sequentially
      for (const row of contractRows) {
        try {
          const result = await classifyContract(row);
          classified++;

          if (result.classification === "GOOD") good++;
          else if (result.classification === "MAYBE") maybe++;
          else discard++;

          if (result.error) errors++;
        } catch (err) {
          errors++;
          classified++;
          console.error(
            `[batch-classifier] Error on contract ${row.noticeId}:`,
            err instanceof Error ? err.message : err
          );
        }

        // Brief delay between individual calls within a chunk
        await delay(300);
      }

      // Update crawl progress after each chunk
      if (crawlProgressId) {
        await db
          .update(crawlProgress)
          .set({ classified, updatedAt: new Date() })
          .where(eq(crawlProgress.id, crawlProgressId));
      }

      // Delay between chunks
      if (i + CHUNK_SIZE < contractIds.length) {
        await delay(CHUNK_DELAY_MS);
      }
    }

    // Mark batch job as succeeded
    const resultsJson = { good, maybe, discard, errors };
    await db
      .update(batchJobs)
      .set({
        status: "SUCCEEDED",
        completedAt: new Date(),
        resultsJson,
      })
      .where(eq(batchJobs.id, batchJob.id));

    return {
      batchJobId: batchJob.id,
      total: contractIds.length,
      classified,
      good,
      maybe,
      discard,
      errors,
      status: "SUCCEEDED",
    };
  } catch (err) {
    // Mark batch job as failed
    await db
      .update(batchJobs)
      .set({
        status: "FAILED",
        completedAt: new Date(),
        resultsJson: { good, maybe, discard, errors, classified, error: String(err) },
      })
      .where(eq(batchJobs.id, batchJob.id));

    console.error("[batch-classifier] Batch job failed:", err);

    return {
      batchJobId: batchJob.id,
      total: contractIds.length,
      classified,
      good,
      maybe,
      discard,
      errors,
      status: "FAILED",
    };
  }
}
