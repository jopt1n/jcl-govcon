import { NextRequest, NextResponse } from "next/server";
import {
  ensurePursuitForContract,
  listPursuits,
} from "@/lib/pursuits/service";
import {
  isCashBurden,
  isPursuitOutcome,
  isPursuitStage,
  type CashBurden,
  type DeadlineFilter,
  type PursuitOutcome,
  type PursuitStage,
} from "@/lib/pursuits/types";

const DEADLINE_FILTERS = ["overdue", "week", "month", "none"] as const;

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stage = searchParams.get("stage");
    const outcome = searchParams.get("outcome");
    const cashBurden = searchParams.get("cashBurden");
    const deadline = searchParams.get("deadline");

    if (stage && !isPursuitStage(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }
    if (outcome && !isPursuitOutcome(outcome)) {
      return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
    }
    if (cashBurden && !isCashBurden(cashBurden)) {
      return NextResponse.json(
        { error: "Invalid cashBurden" },
        { status: 400 },
      );
    }
    if (
      deadline &&
      !DEADLINE_FILTERS.includes(deadline as DeadlineFilter)
    ) {
      return NextResponse.json({ error: "Invalid deadline" }, { status: 400 });
    }

    const result = await listPursuits({
      page: parsePositiveInt(searchParams.get("page"), 1, 10_000),
      limit: parsePositiveInt(searchParams.get("limit"), 50, 100),
      stage: (stage as PursuitStage | null) || undefined,
      outcome: (outcome as PursuitOutcome | null) || undefined,
      includeHistory:
        searchParams.get("includeHistory") === "true" ||
        searchParams.get("includeHistory") === "1",
      cashBurden: (cashBurden as CashBurden | null) || undefined,
      contractType: searchParams.get("contractType") || undefined,
      contactStatus: searchParams.get("contactStatus") || undefined,
      deadline: (deadline as DeadlineFilter | null) || undefined,
      search: searchParams.get("search") || undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/pursuits] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch pursuits",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body.contractId !== "string" || !body.contractId.trim()) {
      return NextResponse.json(
        { error: "contractId is required" },
        { status: 400 },
      );
    }

    const pursuit = await ensurePursuitForContract(body.contractId, {
      reactivate: true,
    });
    if (!pursuit) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(pursuit, { status: 201 });
  } catch (err) {
    console.error("[api/pursuits] POST Error:", err);
    return NextResponse.json(
      {
        error: "Failed to create pursuit",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
