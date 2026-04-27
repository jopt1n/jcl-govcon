import { NextRequest, NextResponse } from "next/server";
import {
  getPursuitDetail,
  updatePursuit,
  type PursuitUpdateInput,
} from "@/lib/pursuits/service";
import {
  isCashBurden,
  isPursuitOutcome,
  isPursuitStage,
} from "@/lib/pursuits/types";

function parseNullableDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid date");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid date");
  return parsed;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const detail = await getPursuitDetail(params.id);
    if (!detail) {
      return NextResponse.json(
        { error: "Pursuit not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(detail);
  } catch (err) {
    console.error("[api/pursuits/id] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch pursuit",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const input: PursuitUpdateInput = {};

    if (body.stage !== undefined) {
      if (!isPursuitStage(body.stage)) {
        return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
      }
      input.stage = body.stage;
    }

    if (body.outcome !== undefined) {
      if (body.outcome !== null && !isPursuitOutcome(body.outcome)) {
        return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
      }
      input.outcome = body.outcome;
    }

    if (body.cashBurden !== undefined) {
      if (!isCashBurden(body.cashBurden)) {
        return NextResponse.json(
          { error: "Invalid cashBurden" },
          { status: 400 },
        );
      }
      input.cashBurden = body.cashBurden;
    }

    if (body.nextAction !== undefined) input.nextAction = body.nextAction;
    if (body.nextActionDueAt !== undefined) {
      try {
        input.nextActionDueAt = parseNullableDate(body.nextActionDueAt);
      } catch {
        return NextResponse.json(
          { error: "Invalid nextActionDueAt" },
          { status: 400 },
        );
      }
    }
    if (body.contractType !== undefined) input.contractType = body.contractType;
    if (body.contactStatus !== undefined) {
      input.contactStatus = body.contactStatus;
    }
    if (body.internalNotes !== undefined) {
      input.internalNotes = body.internalNotes;
    }
    if (body.historyNote !== undefined) input.historyNote = body.historyNote;

    if (Object.keys(input).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const detail = await updatePursuit(params.id, input);
    if (!detail) {
      return NextResponse.json(
        { error: "Pursuit not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(detail);
  } catch (err) {
    console.error("[api/pursuits/id] PATCH Error:", err);
    return NextResponse.json(
      {
        error: "Failed to update pursuit",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
