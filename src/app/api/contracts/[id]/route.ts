import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateActionPlan } from "@/lib/ai/classifier";
import { downloadDocuments } from "@/lib/sam-gov/documents";
import { extractAllDocumentTexts } from "@/lib/document-text";

/**
 * GET /api/contracts/[id]
 *
 * Get full contract detail.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [contract] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.id, params.id))
      .limit(1);

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    return NextResponse.json(contract);
  } catch (err) {
    console.error("[api/contracts/id] GET Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch contract", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/contracts/[id]
 *
 * Update contract: classification, status, notes, userOverride
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.classification !== undefined) {
      if (!["GOOD", "MAYBE", "DISCARD", "PENDING"].includes(body.classification)) {
        return NextResponse.json({ error: "Invalid classification" }, { status: 400 });
      }
      updates.classification = body.classification;
    }

    if (body.status !== undefined) {
      if (!["IDENTIFIED", "PURSUING", "BID_SUBMITTED", "WON", "LOST"].includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updates.status = body.status;
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

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    updates.updatedAt = new Date();

    const [updated] = await db
      .update(contracts)
      .set(updates)
      .where(eq(contracts.id, params.id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/contracts/id] PATCH Error:", err);
    return NextResponse.json(
      { error: "Failed to update contract", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
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
  { params }: { params: { id: string } }
) {
  try {
    const [contract] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.id, params.id))
      .limit(1);

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Extract text from documents (documents.ts sniffs real content type via magic bytes)
    const downloadedDocs = await downloadDocuments(contract.resourceLinks);
    const docTexts = await extractAllDocumentTexts(downloadedDocs);

    const rawResponse = await generateActionPlan(contract, docTexts);

    if (!rawResponse) {
      return NextResponse.json({ error: "Failed to generate unified classification" }, { status: 500 });
    }

    // Parse the unified response: { classification, reasoning, summary, actionPlan }
    const parsed = JSON.parse(rawResponse);
    const classification = parsed.classification?.toUpperCase();
    const validClassifications = ["GOOD", "MAYBE", "DISCARD"];

    const [updated] = await db
      .update(contracts)
      .set({
        classification: validClassifications.includes(classification) ? classification : contract.classification,
        aiReasoning: parsed.reasoning || contract.aiReasoning,
        summary: parsed.summary || contract.summary,
        actionPlan: parsed.actionPlan ? JSON.stringify(parsed.actionPlan) : null,
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
      { error: "Failed to generate unified classification", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
