import { NextRequest, NextResponse } from "next/server";
import {
  createOrActivateWatchTarget,
  listWatchTargets,
} from "@/lib/watch/service";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)),
    );
    const includeInactive = searchParams.get("includeInactive") === "true";

    const result = await listWatchTargets({ page, limit, includeInactive });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/watch-targets] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch watch targets",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.contractId || typeof body.contractId !== "string") {
      return NextResponse.json(
        { error: "contractId is required" },
        { status: 400 },
      );
    }

    const detail = await createOrActivateWatchTarget(body.contractId);
    return NextResponse.json(detail, { status: 201 });
  } catch (err) {
    console.error("[api/watch-targets] POST Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "Contract not found" ? 404 : 500;
    return NextResponse.json(
      {
        error:
          status === 404
            ? "Contract not found"
            : "Failed to create watch target",
        message,
      },
      { status },
    );
  }
}
