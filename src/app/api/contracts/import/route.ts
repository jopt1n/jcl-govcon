import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";

/**
 * POST /api/contracts/import
 *
 * Accepts multipart/form-data with a CSV file from SAM.gov export.
 * Parses CSV, maps columns to contract fields, deduplicates by notice_id.
 * Returns summary of imported/skipped and list of imported contract IDs.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No CSV file provided. Send as multipart/form-data with field name 'file'." },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    const rows = parseCSV(csvText);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "CSV file is empty or has no data rows." },
        { status: 400 }
      );
    }

    const total = rows.length;
    const importedIds: string[] = [];
    let skipped = 0;

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      const results = await db
        .insert(contracts)
        .values(batch)
        .onConflictDoNothing({ target: contracts.noticeId })
        .returning({ id: contracts.id });

      for (const r of results) {
        importedIds.push(r.id);
      }

      skipped += batch.length - results.length;
    }

    return NextResponse.json({
      total,
      imported: importedIds.length,
      skipped,
      importedIds,
      queued_for_classification: importedIds.length,
    });
  } catch (err) {
    console.error("[api/contracts/import] Error:", err);
    return NextResponse.json(
      {
        error: "CSV import failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

// ── CSV Parsing ─────────────────────────────────────────────────────────────

/** Column name mapping — maps various SAM.gov header variations to our schema fields */
const COLUMN_MAP: Record<string, string> = {
  "notice id": "noticeId",
  "noticeid": "noticeId",
  "solicitation number": "solicitationNumber",
  "solicitationnumber": "solicitationNumber",
  "sol number": "solicitationNumber",
  "title": "title",
  "department/ind.agency": "agency",
  "department/ind. agency": "agency",
  "department": "agency",
  "agency": "agency",
  "naics code": "naicsCode",
  "naicscode": "naicsCode",
  "naics": "naicsCode",
  "classification code": "pscCode",
  "classificationcode": "pscCode",
  "psc code": "pscCode",
  "psc": "pscCode",
  "type": "noticeType",
  "notice type": "noticeType",
  "noticetype": "noticeType",
  "set-aside": "setAsideType",
  "set aside": "setAsideType",
  "setaside": "setAsideType",
  "set-aside type": "setAsideType",
  "award ceiling": "awardCeiling",
  "awardceiling": "awardCeiling",
  "response deadline": "responseDeadline",
  "responsedeadline": "responseDeadline",
  "response date": "responseDeadline",
  "posted date": "postedDate",
  "posteddate": "postedDate",
  "active": "active",
  "description": "descriptionText",
  "link": "samUrl",
  "url": "samUrl",
  "sam url": "samUrl",
};

function resolveColumnName(header: string): string | null {
  const normalized = header.trim().toLowerCase().replace(/[_\-\.]/g, " ").replace(/\s+/g, " ");
  return COLUMN_MAP[normalized] ?? null;
}

/**
 * Simple CSV parser that handles quoted fields with commas and escaped quotes.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

function parseCSV(csvText: string): Array<typeof contracts.$inferInsert> {
  // Split by newlines, handling \r\n and \n
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const columnMapping: Array<{ index: number; field: string }> = [];

  for (let i = 0; i < headers.length; i++) {
    const field = resolveColumnName(headers[i]);
    if (field) {
      columnMapping.push({ index: i, field });
    }
  }

  // Must have at least noticeId and title
  const fieldNames = columnMapping.map((c) => c.field);
  if (!fieldNames.includes("noticeId")) {
    throw new Error("CSV must have a 'Notice ID' column");
  }
  if (!fieldNames.includes("title")) {
    throw new Error("CSV must have a 'Title' column");
  }

  const rows: Array<typeof contracts.$inferInsert> = [];

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const values = parseCSVLine(lines[lineIdx]);
    const record: Record<string, unknown> = {};

    for (const { index, field } of columnMapping) {
      const raw = values[index] ?? "";
      if (!raw) continue;

      switch (field) {
        case "responseDeadline":
        case "postedDate": {
          const d = new Date(raw);
          if (!isNaN(d.getTime())) {
            record[field] = d;
          }
          break;
        }
        case "active":
          record[field] = raw.toLowerCase() === "yes" || raw.toLowerCase() === "true" || raw === "1";
          break;
        case "awardCeiling":
          // Strip $ and commas
          record[field] = raw.replace(/[$,]/g, "") || null;
          break;
        default:
          record[field] = raw;
      }
    }

    // Skip rows missing required fields
    if (!record.noticeId || !record.title) continue;

    // Ensure postedDate has a default
    if (!record.postedDate) {
      record.postedDate = new Date();
    }

    // Ensure samUrl has a default
    if (!record.samUrl) {
      record.samUrl = `https://sam.gov/opp/${record.noticeId}/view`;
    }

    rows.push(record as typeof contracts.$inferInsert);
  }

  return rows;
}
