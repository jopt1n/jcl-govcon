import { NextRequest, NextResponse } from "next/server";
import { getWatchTargetDetail, updateWatchTarget } from "@/lib/watch/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const detail = await getWatchTargetDetail(params.id);
    if (!detail) {
      return NextResponse.json(
        { error: "Watch target not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(detail);
  } catch (err) {
    console.error("[api/watch-targets/id] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch watch target",
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
    const detail = await updateWatchTarget(params.id, {
      active: body.active,
      primaryContractId: body.primaryContractId,
      attachContractId: body.attachContractId,
      removeContractId: body.removeContractId,
    });

    return NextResponse.json(detail);
  } catch (err) {
    console.error("[api/watch-targets/id] PATCH Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message === "Watch target not found" || message.endsWith("not found")
        ? 404
        : message.startsWith("Provide exactly one") ||
            message.startsWith("Cannot remove") ||
            message.startsWith("Select a different primary")
          ? 400
          : 500;

    return NextResponse.json(
      {
        error:
          status === 404
            ? "Watch target not found"
            : status === 400
              ? message
              : "Failed to update watch target",
        message,
      },
      { status },
    );
  }
}
