"use client";

import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

type ImportResult = {
  total: number;
  imported: number;
  skipped: number;
  importedIds: string[];
  queued_for_classification: number;
};

type PreviewRow = Record<string, string>;

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
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

function parsePreview(text: string): { headers: string[]; rows: PreviewRow[]; totalRows: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [], totalRows: 0 };

  const headers = parseCSVLine(lines[0]);
  const totalRows = lines.length - 1;
  const previewRows: PreviewRow[] = [];

  for (let i = 1; i <= Math.min(5, lines.length - 1); i++) {
    const values = parseCSVLine(lines[i]);
    const row: PreviewRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    previewRows.push(row);
  }

  return { headers, rows: previewRows, totalRows };
}

export function CsvImport() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    headers: string[];
    rows: PreviewRow[];
    totalRows: number;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyDone, setClassifyDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
    setClassifyDone(false);

    try {
      const text = await f.text();
      const parsed = parsePreview(text);
      if (parsed.headers.length === 0) {
        setError("File appears empty or has no headers.");
        setPreview(null);
        return;
      }
      setPreview(parsed);
    } catch {
      setError("Failed to read CSV file.");
      setPreview(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/contracts/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }

      setResult(data as ImportResult);
    } catch {
      setError("Network error during import.");
    } finally {
      setImporting(false);
    }
  };

  const handleClassify = async () => {
    if (!result || result.importedIds.length === 0) return;
    setClassifying(true);

    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIds: result.importedIds }),
      });

      if (res.ok) {
        setClassifyDone(true);
      } else {
        const data = await res.json();
        setError(data.error || "Classification failed");
      }
    } catch {
      setError("Network error during classification.");
    } finally {
      setClassifying(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setClassifyDone(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      {/* Upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--border)] hover:border-[var(--text-muted)] bg-[var(--surface)]"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <div className="text-[var(--text-secondary)]">
          {file ? (
            <div>
              <p className="font-medium text-[var(--text-primary)]">{file.name}</p>
              <p className="text-sm mt-1">
                {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
          ) : (
            <div>
              <p className="font-medium">Drop a SAM.gov CSV file here</p>
              <p className="text-sm mt-1">or click to browse</p>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-[var(--urgent)] text-sm">
          {error}
        </div>
      )}

      {/* Preview */}
      {preview && !result && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-[var(--surface-alt)] border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              Preview ({preview.totalRows} rows total, showing first{" "}
              {preview.rows.length})
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {preview.headers.length} columns detected
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--surface-alt)]">
                  {preview.headers.map((h, i) => (
                    <th
                      key={i}
                      className="px-3 py-2 text-left font-medium text-[var(--text-secondary)] whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    {preview.headers.map((h, j) => (
                      <td
                        key={j}
                        className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap max-w-[200px] truncate"
                      >
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      {preview && !result && (
        <div className="flex gap-3">
          <button
            onClick={handleImport}
            disabled={importing}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors",
              importing
                ? "bg-[var(--accent)]/60 cursor-not-allowed"
                : "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
            )}
          >
            {importing ? "Importing..." : `Import ${preview.totalRows} Contracts`}
          </button>
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-alt)] hover:bg-[var(--border-subtle)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 space-y-4">
          <h3 className="font-semibold text-[var(--text-primary)]">Import Complete</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[var(--surface-alt)] rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-[var(--text-primary)]">{result.total}</p>
              <p className="text-xs text-[var(--text-muted)]">Total in CSV</p>
            </div>
            <div className="bg-emerald-500/10 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-[var(--good)]">
                {result.imported}
              </p>
              <p className="text-xs text-[var(--good)]">Imported</p>
            </div>
            <div className="bg-amber-500/10 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-[var(--maybe)]">
                {result.skipped}
              </p>
              <p className="text-xs text-[var(--maybe)]">
                Skipped (duplicates)
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            {result.imported > 0 && !classifyDone && (
              <button
                onClick={handleClassify}
                disabled={classifying}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors",
                  classifying
                    ? "bg-purple-400 cursor-not-allowed"
                    : "bg-purple-600 hover:bg-purple-700"
                )}
              >
                {classifying
                  ? "Classifying..."
                  : `Classify ${result.imported} Contracts`}
              </button>
            )}
            {classifyDone && (
              <span className="text-sm text-[var(--good)] font-medium self-center">
                Classification complete
              </span>
            )}
            <button
              onClick={reset}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-alt)] hover:bg-[var(--border-subtle)] transition-colors"
            >
              Import Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
