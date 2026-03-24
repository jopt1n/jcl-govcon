"use client";

import { useState, useEffect } from "react";

interface SpreadsheetViewerProps {
  proxyUrl: string;
}

interface SheetData {
  name: string;
  html: string;
  rowCount: number;
  colCount: number;
}

export default function SpreadsheetViewer({ proxyUrl }: SpreadsheetViewerProps) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function parseSpreadsheet() {
      try {
        // Dynamically import SheetJS (npm install xlsx)
        const XLSX = await import("xlsx");

        const resp = await fetch(proxyUrl);
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        const arrayBuffer = await resp.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });

        const parsed: SheetData[] = workbook.SheetNames.map((name) => {
          const ws = workbook.Sheets[name];
          const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
          const html = XLSX.utils.sheet_to_html(ws, {
            id: `sheet-${name.replace(/\s+/g, "-")}`,
            editable: false,
          });
          return {
            name,
            html,
            rowCount: range.e.r - range.s.r + 1,
            colCount: range.e.c - range.s.c + 1,
          };
        });

        if (!cancelled) {
          setSheets(parsed);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      }
    }

    parseSpreadsheet();
    return () => {
      cancelled = true;
    };
  }, [proxyUrl]);

  if (loading) {
    return (
      <div className="dv-sheet-loading">
        <div className="doc-viewer-spinner" />
        <p>Parsing spreadsheet…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="doc-viewer-error">
        <p>Could not parse spreadsheet: {error}</p>
        <a href={proxyUrl} download className="doc-viewer-download-btn" style={{ marginTop: "12px" }}>
          Download Instead
        </a>
      </div>
    );
  }

  if (sheets.length === 0) {
    return <div className="doc-viewer-error">Spreadsheet is empty.</div>;
  }

  return (
    <div className="dv-sheet-root">
      {/* Sheet tabs */}
      <div className="dv-sheet-tabs">
        {sheets.map((sheet, idx) => (
          <button
            key={sheet.name}
            className={`dv-sheet-tab ${idx === activeSheet ? "dv-sheet-tab-active" : ""}`}
            onClick={() => setActiveSheet(idx)}
          >
            {sheet.name}
            <span className="dv-sheet-tab-meta">
              {sheet.rowCount}×{sheet.colCount}
            </span>
          </button>
        ))}
      </div>

      {/* Active sheet content */}
      <div className="dv-sheet-content">
        <div
          className="dv-sheet-html"
          dangerouslySetInnerHTML={{ __html: sheets[activeSheet].html }}
        />
      </div>
    </div>
  );
}
