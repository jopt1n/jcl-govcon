import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateActionPlan } from "@/lib/ai/classifier";
import { downloadDocuments } from "@/lib/sam-gov/documents";

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
 * Generate or regenerate action plan for a contract.
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

    // Extract text from documents (documents.ts now sniffs real content type)
    const downloadedDocs = await downloadDocuments(contract.resourceLinks);
    const docTexts: string[] = [];
    for (const doc of downloadedDocs) {
      try {
        const ct = doc.contentType;
        if (ct.includes("pdf")) {
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse({ data: new Uint8Array(doc.buffer) });
          const pdfResult = await parser.getText();
          await parser.destroy();
          if (pdfResult.text?.trim()) docTexts.push(pdfResult.text.trim());
        } else if (ct.includes("spreadsheet") || ct.includes("ms-excel")) {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(new Uint8Array(doc.buffer), { type: "array" });
          const sheetTexts = wb.SheetNames.map((name) => XLSX.utils.sheet_to_txt(wb.Sheets[name])).join("\n");
          if (sheetTexts.trim()) docTexts.push(sheetTexts.trim());
        } else if (ct.includes("wordprocessing") || ct.includes("msword")) {
          const mammoth = await import("mammoth");
          const mammothResult = await mammoth.convertToHtml({ buffer: doc.buffer });
          if (mammothResult.value) docTexts.push(mammothResult.value.replace(/<[^>]+>/g, " ").trim());
        }
      } catch {
        // Skip unparseable documents
      }
    }

    const actionPlan = await generateActionPlan(contract, docTexts);

    if (!actionPlan) {
      return NextResponse.json({ error: "Failed to generate action plan" }, { status: 500 });
    }

    const [updated] = await db
      .update(contracts)
      .set({ actionPlan, updatedAt: new Date() })
      .where(eq(contracts.id, params.id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[api/contracts/id] POST Error:", err);
    return NextResponse.json(
      { error: "Failed to generate action plan", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
