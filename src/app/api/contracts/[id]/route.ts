import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts, auditLog } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { generateActionPlan } from "@/lib/ai/classifier";
import { downloadDocuments } from "@/lib/sam-gov/documents";
import { extractAllDocumentTexts } from "@/lib/document-text";
import {
  deactivateWatchTargetByContractId,
  getContractWatchMetadata,
} from "@/lib/watch/service";

/**
 * GET /api/contracts/[id]
 *
 * Get full contract detail.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const [[contract], watchMetadata] = await Promise.all([
      db.select().from(contracts).where(eq(contracts.id, params.id)).limit(1),
      getContractWatchMetadata(params.id),
    ]);

    if (!contract) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ...contract,
      watched: watchMetadata.watched,
      watchTargetId: watchMetadata.watchTargetId,
      watchStatus: watchMetadata.watchStatus,
      watchLastCheckedAt: watchMetadata.watchLastCheckedAt,
      watchLastAlertedAt: watchMetadata.watchLastAlertedAt,
    });
  } catch (err) {
    console.error("[api/contracts/id] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch contract",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/contracts/[id]
 *
 * Update contract: classification, status, notes, userOverride, promoted,
 * archived
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    // Archive is terminal — it strips all qualities (demotes + unwatches). A
    // request that tries to archive and promote in the same PATCH is incoherent;
    // reject it up front rather than silently letting one win.
    if (body.archived === true && body.promoted === true) {
      return NextResponse.json(
        {
          error:
            "Cannot set archived=true and promoted=true in the same request",
        },
        { status: 400 },
      );
    }

    if (body.classification !== undefined) {
      if (
        !["GOOD", "MAYBE", "DISCARD", "PENDING"].includes(body.classification)
      ) {
        return NextResponse.json(
          { error: "Invalid classification" },
          { status: 400 },
        );
      }
      updates.classification = body.classification;
    }

    // status: only bump statusChangedAt when the value actually changes.
    // Load the existing row once so we can diff and also return it from the
    // 404 branch without an extra round trip.
    let existing: typeof contracts.$inferSelect | undefined;
    if (body.status !== undefined) {
      if (
        !["IDENTIFIED", "PURSUING", "BID_SUBMITTED", "WON", "LOST"].includes(
          body.status,
        )
      ) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      const [row] = await db
        .select()
        .from(contracts)
        .where(eq(contracts.id, params.id))
        .limit(1);
      existing = row;
      if (!existing) {
        return NextResponse.json(
          { error: "Contract not found" },
          { status: 404 },
        );
      }
      updates.status = body.status;
      if (existing.status !== body.status) {
        updates.statusChangedAt = new Date();
      }
    }

    if (body.notes !== undefined) {
      updates.notes = body.notes;
    }

    if (body.userOverride !== undefined) {
      updates.userOverride = body.userOverride;
    }

    if (body.actionPlan !== undefined) {
      updates.actionPlan = body.actionPlan;
    }

    // reviewedAt: allow explicit timestamps or `true` shorthand for
    // "mark reviewed now". Null un-triages a contract.
    if (body.reviewedAt !== undefined) {
      if (body.reviewedAt === null) {
        updates.reviewedAt = null;
      } else if (body.reviewedAt === true) {
        updates.reviewedAt = new Date();
      } else if (typeof body.reviewedAt === "string") {
        const parsed = new Date(body.reviewedAt);
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "Invalid reviewedAt" },
            { status: 400 },
          );
        }
        updates.reviewedAt = parsed;
      } else {
        return NextResponse.json(
          { error: "Invalid reviewedAt" },
          { status: 400 },
        );
      }
    }

    // Manual archive is intentionally orthogonal to classification and
    // promotion. Store it as a durable tag so weekly SAM.gov metadata refreshes
    // do not overwrite the user's "skip this" decision.
    if (body.archived !== undefined) {
      if (typeof body.archived !== "boolean") {
        return NextResponse.json(
          { error: "Invalid archived" },
          { status: 400 },
        );
      }

      if (body.archived) {
        updates.tags = sql`CASE
          WHEN COALESCE(${contracts.tags}, '[]'::jsonb) @> '["ARCHIVED"]'::jsonb
          THEN COALESCE(${contracts.tags}, '[]'::jsonb)
          ELSE COALESCE(${contracts.tags}, '[]'::jsonb) || '["ARCHIVED"]'::jsonb
        END`;
        // Archive is terminal: strip the user-promotion quality from the row
        // itself. The promoted block below runs after this one; for the only
        // compatible combined case ({ archived: true, promoted: false }) both
        // assign the same values so ordering is safe. The incompatible case
        // ({ archived: true, promoted: true }) is rejected at the top of the
        // handler.
        updates.promoted = false;
        updates.promotedAt = null;
        if (body.reviewedAt === undefined) {
          updates.reviewedAt = sql`COALESCE(${contracts.reviewedAt}, now())`;
        }
      } else {
        updates.tags = sql`COALESCE(${contracts.tags}, '[]'::jsonb) - 'ARCHIVED'`;
      }
    }

    // User-driven promotion above the AI classifier. Any classification can
    // be promoted (promoting a DISCARD signals "AI was wrong"; the original
    // label stays visible). This block runs AFTER the reviewedAt block so
    // that promote-implies-reviewed wins when the client sends only
    // `{ promoted: true }` — but if the client EXPLICITLY sent a reviewedAt
    // value in the same PATCH, that value is respected and we skip the
    // COALESCE default (see the `body.reviewedAt === undefined` guard).
    // NOTE: no row-level CAS / SERIALIZABLE wrapping — single-user assumption
    // (v1). Concurrent promote=true / promote=false is last-write-wins; the
    // audit_log table reveals if this bites. Tighten with WHERE-clause CAS
    // if it does.
    if (body.promoted !== undefined) {
      if (typeof body.promoted !== "boolean") {
        return NextResponse.json(
          { error: "Invalid promoted" },
          { status: 400 },
        );
      }
      const setPromoted = body.promoted;
      updates.promoted = setPromoted;
      updates.promotedAt = setPromoted ? new Date() : null;
      if (setPromoted && body.reviewedAt === undefined) {
        updates.reviewedAt = sql`COALESCE(${contracts.reviewedAt}, now())`;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    updates.updatedAt = new Date();

    // Atomic transaction when promoted is touched OR archived=true (archive is
    // terminal and also deactivates any source watch target). IMPORTANT: every
    // call inside the callback uses the `tx` argument, NOT the outer `db` —
    // using `db` silently breaks atomicity (the INSERT runs on its own
    // connection).
    let updated: typeof contracts.$inferSelect | undefined;
    const usesTransaction =
      body.promoted !== undefined || body.archived === true;

    if (usesTransaction) {
      updated = await db.transaction(async (tx) => {
        // When archiving, pre-read the pre-update promoted flag inside the tx
        // so the demote audit row fires exactly when the archive actually
        // removes a promotion. A SELECT-then-UPDATE is noisier than RETURNING,
        // but RETURNING only exposes post-update values.
        let previousPromoted = false;
        if (body.archived === true) {
          const [existing] = await tx
            .select({ promoted: contracts.promoted })
            .from(contracts)
            .where(eq(contracts.id, params.id))
            .limit(1);
          if (existing) previousPromoted = existing.promoted;
        }

        const [row] = await tx
          .update(contracts)
          .set(updates)
          .where(eq(contracts.id, params.id))
          .returning();
        if (!row) return row;

        // Explicit promote/demote audit row — only when archive isn't driving
        // the change. For { archived: true, promoted: false } the archive
        // branch below owns the audit row so we don't write two for one action.
        // Use strict === true so a future relaxation of the typeof guard
        // doesn't silently log "demote" for 0 / "" / null / undefined payloads.
        if (body.promoted !== undefined && body.archived !== true) {
          await tx.insert(auditLog).values({
            contractId: params.id,
            action: body.promoted === true ? "promote" : "demote",
          });
        }

        // Archive side effects: record the implicit demote (if we actually
        // stripped a promotion) and deactivate the watch target sourced from
        // this contract. Both are tagged with `reason: "archive"` so retros
        // can distinguish them from user-initiated demote/unwatch.
        if (body.archived === true) {
          if (previousPromoted) {
            await tx.insert(auditLog).values({
              contractId: params.id,
              action: "demote",
              metadata: { reason: "archive" },
            });
          }
          await deactivateWatchTargetByContractId(params.id, "archive", tx);
        }

        return row;
      });
    } else {
      [updated] = await db
        .update(contracts)
        .set(updates)
        .where(eq(contracts.id, params.id))
        .returning();
    }

    if (!updated) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/contracts/id] PATCH Error:", err);
    return NextResponse.json(
      {
        error: "Failed to update contract",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/contracts/[id]
 *
 * Run unified classification + action plan for a contract.
 * Parses classification + actionPlan from the single response.
 * Sets classificationRound=4, classifiedFromMetadata=false, documentsAnalyzed=true.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const [contract] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.id, params.id))
      .limit(1);

    if (!contract) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 },
      );
    }

    // Extract text from documents (documents.ts sniffs real content type via magic bytes)
    const downloadedDocs = await downloadDocuments(contract.resourceLinks);
    const docTexts = await extractAllDocumentTexts(downloadedDocs);

    const rawResponse = await generateActionPlan(contract, docTexts);

    if (!rawResponse) {
      return NextResponse.json(
        { error: "Failed to generate unified classification" },
        { status: 500 },
      );
    }

    // Parse the unified response: { classification, reasoning, summary, actionPlan }
    const parsed = JSON.parse(rawResponse);
    const classification = parsed.classification?.toUpperCase();
    const validClassifications = ["GOOD", "MAYBE", "DISCARD"];

    const [updated] = await db
      .update(contracts)
      .set({
        classification: validClassifications.includes(classification)
          ? classification
          : contract.classification,
        aiReasoning: parsed.reasoning || contract.aiReasoning,
        summary: parsed.summary || contract.summary,
        actionPlan: parsed.actionPlan
          ? JSON.stringify(parsed.actionPlan)
          : null,
        classificationRound: 4,
        classifiedFromMetadata: false,
        documentsAnalyzed: true,
        updatedAt: new Date(),
      })
      .where(eq(contracts.id, params.id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/contracts/id] POST Error:", err);
    return NextResponse.json(
      {
        error: "Failed to generate unified classification",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
