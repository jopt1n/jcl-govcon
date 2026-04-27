import { NextRequest, NextResponse } from "next/server";
import {
  contractBelongsToPursuit,
  createPursuitDocument,
  listPursuitDocuments,
  pursuitExists,
} from "@/lib/pursuits/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    if (!(await pursuitExists(params.id))) {
      return NextResponse.json({ error: "Pursuit not found" }, { status: 404 });
    }
    const documents = await listPursuitDocuments(params.id);
    return NextResponse.json({ data: documents });
  } catch (err) {
    console.error("[api/pursuits/documents] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch documents",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    if (typeof body.sourceUrl !== "string" || !body.sourceUrl.trim()) {
      return NextResponse.json(
        { error: "sourceUrl is required" },
        { status: 400 },
      );
    }
    if (
      body.sizeBytes !== undefined &&
      body.sizeBytes !== null &&
      (!Number.isInteger(body.sizeBytes) || body.sizeBytes < 0)
    ) {
      return NextResponse.json(
        { error: "Invalid sizeBytes" },
        { status: 400 },
      );
    }
    if (!(await pursuitExists(params.id))) {
      return NextResponse.json({ error: "Pursuit not found" }, { status: 404 });
    }
    let contractId: string | null = null;
    if (body.contractId !== undefined && body.contractId !== null) {
      if (typeof body.contractId !== "string" || !body.contractId.trim()) {
        return NextResponse.json(
          { error: "Invalid contractId" },
          { status: 400 },
        );
      }
      const candidateContractId = body.contractId.trim();
      if (!(await contractBelongsToPursuit(params.id, candidateContractId))) {
        return NextResponse.json(
          { error: "contractId must belong to this pursuit" },
          { status: 400 },
        );
      }
      contractId = candidateContractId;
    }

    const document = await createPursuitDocument(params.id, {
      contractId,
      sourceUrl: body.sourceUrl,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      extractedText: body.extractedText,
      objectKey: body.objectKey,
      storageProvider: body.storageProvider,
    });
    return NextResponse.json(document, { status: 201 });
  } catch (err) {
    console.error("[api/pursuits/documents] POST Error:", err);
    return NextResponse.json(
      {
        error: "Failed to create document metadata",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
