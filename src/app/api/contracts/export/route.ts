/**
 * GET /api/contracts/export?status=PURSUING,BID_SUBMITTED,WON
 *
 * Returns a CSV of contracts filtered by status. Powers the "Export CSV"
 * button on /pipeline. Used for sharing with stakeholders, tax records, or
 * future CRM imports.
 *
 * Query params:
 *   status — comma-separated contract status values. Default:
 *            PURSUING,BID_SUBMITTED,WON (all actively-pursued contracts).
 *
 * Output: text/csv with RFC 4180 escaping (titles containing commas,
 * quotes, or newlines are wrapped in quotes; internal quotes are doubled).
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { inArray, desc } from "drizzle-orm";
import { requireSameOrigin } from "@/lib/auth";

type ContractStatus =
  | "IDENTIFIED"
  | "PURSUING"
  | "BID_SUBMITTED"
  | "WON"
  | "LOST";

const VALID_STATUSES: ContractStatus[] = [
  "IDENTIFIED",
  "PURSUING",
  "BID_SUBMITTED",
  "WON",
  "LOST",
];

const DEFAULT_STATUSES: ContractStatus[] = ["PURSUING", "BID_SUBMITTED", "WON"];

/**
 * RFC 4180 CSV field escaping. Wraps fields in quotes if they contain
 * commas, quotes, or newlines; doubles internal quotes.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatRow(values: unknown[]): string {
  return values.map(escapeCsvField).join(",");
}

export async function GET(req: NextRequest) {
  if (!requireSameOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");

  let statuses: ContractStatus[];
  if (statusParam) {
    const parts = statusParam.split(",").map((s) => s.trim().toUpperCase());
    const invalid = parts.filter(
      (p) => !VALID_STATUSES.includes(p as ContractStatus),
    );
    if (invalid.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Invalid status value(s)",
          invalid,
          valid: VALID_STATUSES,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    statuses = parts as ContractStatus[];
  } else {
    statuses = DEFAULT_STATUSES;
  }

  const rows = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      title: contracts.title,
      agency: contracts.agency,
      classification: contracts.classification,
      status: contracts.status,
      awardCeiling: contracts.awardCeiling,
      responseDeadline: contracts.responseDeadline,
      postedDate: contracts.postedDate,
      samUrl: contracts.samUrl,
      statusChangedAt: contracts.statusChangedAt,
    })
    .from(contracts)
    .where(inArray(contracts.status, statuses))
    .orderBy(desc(contracts.statusChangedAt));

  const header = formatRow([
    "id",
    "notice_id",
    "title",
    "agency",
    "classification",
    "status",
    "award_ceiling",
    "response_deadline",
    "posted_date",
    "status_changed_at",
    "sam_url",
  ]);

  const body = rows
    .map((r) =>
      formatRow([
        r.id,
        r.noticeId,
        r.title,
        r.agency ?? "",
        r.classification,
        r.status ?? "",
        r.awardCeiling ?? "",
        r.responseDeadline?.toISOString() ?? "",
        r.postedDate?.toISOString() ?? "",
        r.statusChangedAt?.toISOString() ?? "",
        r.samUrl,
      ]),
    )
    .join("\n");

  const csv = body ? `${header}\n${body}\n` : `${header}\n`;

  const filename = `jcl-govcon-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
