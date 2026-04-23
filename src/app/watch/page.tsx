"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type WatchTargetSummary = {
  id: string;
  sourceContractId: string | null;
  sourceTitle: string;
  sourceAgency: string | null;
  status: string;
  statusLabel: string;
  currentNoticeType: string | null;
  lastCheckedAt: string | null;
  lastAlertedAt: string | null;
  recentChangeSummary: string | null;
  linkedCount: number;
};

const PAGE_SIZE = 50;

function statusClasses(status: string): string {
  switch (status) {
    case "MATCHED":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "NEEDS_REVIEW":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "INACTIVE":
      return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    default:
      return "bg-[var(--accent-10)] text-[var(--accent)] border-[var(--accent-30)]";
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function WatchPage() {
  const [targets, setTargets] = useState<WatchTargetSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [unwatching, setUnwatching] = useState<Set<string>>(new Set());
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
          limit: String(PAGE_SIZE),
          page: String(pageNum),
        });
        const res = await fetch(`/api/watch-targets?${params}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "fetch failed");
        const rows: WatchTargetSummary[] = json.data ?? [];
        setTargets((prev) => (append ? [...prev, ...rows] : rows));
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

  async function unwatch(id: string) {
    setUnwatching((prev) => new Set(prev).add(id));
    setTargets((rows) => rows.filter((row) => row.id !== id));
    setTotal((value) => (value === null ? value : Math.max(0, value - 1)));
    try {
      const res = await fetch(`/api/watch-targets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    } catch {
      await fetchPage(page, { append: false });
    } finally {
      setUnwatching((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const isFetching = loading || loadingMore;
  const hasMore = total !== null && targets.length < total;

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Eye className="w-6 h-6" />
            Watch
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Opportunities you want monitored until they mature into something
            actionable.
          </p>
          {total !== null && total > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              <strong className="text-[var(--text-primary)]">{total}</strong>{" "}
              active watch target{total === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <button
          data-testid="watch-refresh"
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
          data-testid="watch-error"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center"
        >
          <AlertTriangle className="w-8 h-8 mx-auto text-[var(--urgent)] mb-2" />
          <div className="text-base font-semibold text-[var(--text-primary)]">
            Couldn&rsquo;t load watch targets
          </div>
          <button
            data-testid="watch-error-retry"
            onClick={() => fetchPage(1, { append: false })}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] hover:bg-[var(--surface)]"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {loading && !error && (
        <div
          data-testid="watch-loading"
          className="text-sm text-[var(--text-muted)]"
        >
          Loading&hellip;
        </div>
      )}

      {!loading && !error && targets.length === 0 && (
        <div
          data-testid="watch-empty"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center"
        >
          <Eye className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-2" />
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            No watch targets yet
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Open a contract and click Watch to start tracking maturity changes.
          </p>
        </div>
      )}

      {!loading && !error && targets.length > 0 && (
        <>
          <div className="space-y-3">
            {targets.map((target) => (
              <div
                key={target.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/watch/${target.id}`}
                        className="text-base font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
                      >
                        {target.sourceTitle}
                      </Link>
                      <span
                        className={cn(
                          "text-[10px] font-semibold px-2 py-1 rounded-full border",
                          statusClasses(target.status),
                        )}
                      >
                        {target.statusLabel}
                      </span>
                    </div>
                    {target.sourceAgency && (
                      <div className="text-sm text-[var(--text-secondary)] mt-1">
                        {target.sourceAgency}
                      </div>
                    )}
                    <div className="text-xs text-[var(--text-muted)] mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        Current notice type: {target.currentNoticeType ?? "N/A"}
                      </span>
                      <span>Linked contracts: {target.linkedCount}</span>
                      <span>
                        Last checked: {formatDateTime(target.lastCheckedAt)}
                      </span>
                      <span>
                        Last alert: {formatDateTime(target.lastAlertedAt)}
                      </span>
                    </div>
                    {target.recentChangeSummary && (
                      <div className="text-sm text-[var(--text-secondary)] mt-3">
                        {target.recentChangeSummary}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/watch/${target.id}`}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] hover:bg-[var(--surface)]"
                    >
                      Open
                    </Link>
                    <button
                      data-testid={`watch-unwatch-${target.id}`}
                      onClick={() => unwatch(target.id)}
                      disabled={unwatching.has(target.id)}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)] disabled:opacity-50"
                    >
                      {unwatching.has(target.id) ? "Unwatching…" : "Unwatch"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                data-testid="watch-load-more"
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
