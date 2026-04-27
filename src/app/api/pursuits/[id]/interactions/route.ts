import { NextRequest, NextResponse } from "next/server";
import {
  createPursuitInteraction,
  listPursuitInteractions,
} from "@/lib/pursuits/service";
import { isPursuitInteractionType } from "@/lib/pursuits/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
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
      contactId: body.contactId,
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
