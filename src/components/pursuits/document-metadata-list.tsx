"use client";

import { Database, FileText } from "lucide-react";

export type PursuitDocument = {
  id: string;
  sourceUrl: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  objectKey: string | null;
  storageProvider: string | null;
};

export function DocumentMetadataList({
  documents,
}: {
  documents: PursuitDocument[];
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <FileText className="h-3.5 w-3.5 text-[var(--pursuit-brass)]" />
        Documents
      </h3>
      <div className="space-y-2">
        {documents.length === 0 && (
          <div className="border border-dashed border-[var(--border)] p-3 text-sm text-[var(--text-muted)]">
            No document metadata yet.
          </div>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="border border-[var(--border)] bg-[var(--surface-alt)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {doc.fileName || "Document"}
                </div>
                <div className="mt-1 truncate text-xs text-[var(--text-muted)]">
                  {doc.sourceUrl}
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                {doc.contentType || "metadata"}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-muted)]">
              <span>Size: {doc.sizeBytes ?? "unknown"}</span>
              <span>SHA: {doc.sha256 ? doc.sha256.slice(0, 10) : "pending"}</span>
              <span className="col-span-2 flex items-center gap-1">
                <Database className="h-3 w-3" />
                {doc.objectKey
                  ? `${doc.storageProvider ?? "object"}:${doc.objectKey}`
                  : "No object storage copy in Phase 1"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
