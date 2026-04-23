"use client";

/**
 * /archive — expired and manually archived contracts.
 *
 * Expiration is computed from responseDeadline. Manual archive is persisted
 * as an ARCHIVED tag. Both preserve the AI's original GOOD/MAYBE/DISCARD call
 * while keeping closed or skipped opportunities out of daily triage surfaces.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, RefreshCw } from "lucide-react";
import { KanbanCard, type ContractCard } from "@/components/kanban/card";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export default function ArchivePage() {
  const [contracts, setContracts] = useState<ContractCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  const fetchPage = useCallback(
    async (pageNum: number, { append }: { append: boolean }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(false);
      try {
        const params = new URLSearchParams({
          archived: "true",
          includeUnreviewed: "true",
          limit: String(PAGE_SIZE),
          page: String(pageNum),
        });
        const res = await fetch(`/api/contracts?${params}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "fetch failed");
        const rows: ContractCard[] = json.data ?? [];
        setContracts((prev) => (append ? [...prev, ...rows] : rows));
        setTotal(json.pagination?.total ?? rows.length);
        setPage(pageNum);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        inFlight.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    fetchPage(1, { append: false });
  }, [fetchPage]);

  const isFetching = loading || loadingMore;
  const hasMore = total !== null && contracts.length < total;

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Archive className="w-6 h-6" />
            Archive
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Expired and manually archived contracts, preserving their original
            AI classification.
          </p>
          {total !== null && total > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              <strong className="text-[var(--text-primary)]">{total}</strong>{" "}
              archived
            </p>
          )}
        </div>
        <button
          data-testid="archive-refresh"
          onClick={() => fetchPage(1, { append: false })}
          disabled={isFetching}
          className="p-2 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)] disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
        </button>
      </div>

      {error && !loading && (
        <div
          data-testid="archive-error"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center"
        >
          <AlertTriangle className="w-8 h-8 mx-auto text-[var(--urgent)] mb-2" />
          <div className="text-base font-semibold text-[var(--text-primary)]">
            Couldn&rsquo;t load archived contracts
          </div>
          <button
            data-testid="archive-error-retry"
            onClick={() => fetchPage(1, { append: false })}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] hover:bg-[var(--surface)]"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {loading && !error && (
        <div
          data-testid="archive-loading"
          className="text-sm text-[var(--text-muted)]"
        >
          Loading&hellip;
        </div>
      )}

      {!loading && !error && contracts.length === 0 && (
        <div
          data-testid="archive-empty"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center"
        >
          <Archive className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-2" />
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            No archived contracts
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Closed or manually archived opportunities will appear here.
          </p>
        </div>
      )}

      {!loading && !error && contracts.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {contracts.map((c) => (
              <KanbanCard key={c.id} contract={c} showClassification />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                data-testid="archive-load-more"
                onClick={() => fetchPage(page + 1, { append: true })}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
