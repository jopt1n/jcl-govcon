import { NextRequest, NextResponse } from "next/server";
import {
  createPursuitInteraction,
  listPursuitInteractions,
  pursuitContactBelongsToPursuit,
  pursuitExists,
} from "@/lib/pursuits/service";
import { isPursuitInteractionType } from "@/lib/pursuits/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    if (!(await pursuitExists(params.id))) {
      return NextResponse.json({ error: "Pursuit not found" }, { status: 404 });
    }
    const interactions = await listPursuitInteractions(params.id);
    return NextResponse.json({ data: interactions });
  } catch (err) {
    console.error("[api/pursuits/interactions] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch interactions",
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
    if (!isPursuitInteractionType(body.type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    if (!(await pursuitExists(params.id))) {
      return NextResponse.json({ error: "Pursuit not found" }, { status: 404 });
    }
    let contactId: string | null = null;
    if (body.contactId !== undefined && body.contactId !== null) {
      if (typeof body.contactId !== "string" || !body.contactId.trim()) {
        return NextResponse.json(
          { error: "Invalid contactId" },
          { status: 400 },
        );
      }
      const candidateContactId = body.contactId.trim();
      if (
        !(await pursuitContactBelongsToPursuit(params.id, candidateContactId))
      ) {
        return NextResponse.json(
          { error: "contactId must belong to this pursuit" },
          { status: 400 },
        );
      }
      contactId = candidateContactId;
    }
    let occurredAt: Date | undefined;
    if (body.occurredAt !== undefined) {
      occurredAt = new Date(body.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) {
        return NextResponse.json(
          { error: "Invalid occurredAt" },
          { status: 400 },
        );
      }
    }

    const interaction = await createPursuitInteraction(params.id, {
      type: body.type,
      contactId,
      occurredAt,
      subject: body.subject,
      body: body.body,
      metadata: body.metadata,
    });
    return NextResponse.json(interaction, { status: 201 });
  } catch (err) {
    console.error("[api/pursuits/interactions] POST Error:", err);
    return NextResponse.json(
      {
        error: "Failed to create interaction",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
