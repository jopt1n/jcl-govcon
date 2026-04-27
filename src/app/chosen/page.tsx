"use client";

/**
 * /chosen — user-driven CHOSEN tier.
 *
 * Flat list of contracts the user has promoted above AI's classification.
 * Server-sorted by promotedAt DESC. Paginates 50/page with Load more.
 *
 * Three render states, handled explicitly (never conflate empty with error):
 *   - error + retry   → fetch failed; banner with retry button
 *   - empty           → fetch succeeded, zero rows
 *   - loaded          → list of KanbanCard + Demote button per card
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { differenceInDays, parseISO } from "date-fns";
import { AlertTriangle, RefreshCw, Star } from "lucide-react";
import { KanbanCard, type ContractCard } from "@/components/kanban/card";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export default function ChosenPage() {
  const [contracts, setContracts] = useState<ContractCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [demoting, setDemoting] = useState<Set<string>>(new Set());

  // Single in-flight fetch at a time. inFlight ref is the authoritative guard —
  // state flags are only for UI. A ref avoids the "guard on stale state" bug
  // where two rapid clicks both read loading===false before either setter runs.
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
          promoted: "true",
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

  // Optimistic demote, refetch-on-failure. Mirrors /inbox's revert pattern
  // (fetchGroup from the catch block) — snapshot-capture reverts lose data
  // when two demotes race and both PATCHes fail, because the second's
  // captured `prev` is already-filtered state from the first. Refetching
  // resyncs to server truth and avoids the whole class of races.
  const demote = async (id: string) => {
    setDemoting((prev) => new Set(prev).add(id));
    setContracts((cs) => cs.filter((c) => c.id !== id));
    setTotal((t) => (t === null ? t : Math.max(0, t - 1)));
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoted: false }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    } catch {
      // Resync to server truth. fetchPage guards against overlapping calls
      // via inFlight — if a refresh is already running, the revert is a no-op
      // and the in-flight refresh will catch the server state anyway.
      await fetchPage(page, { append: false });
    } finally {
      setDemoting((d) => {
        const next = new Set(d);
        next.delete(id);
        return next;
      });
    }
  };

  const isFetching = loading || loadingMore;
  const hasMore = total !== null && contracts.length < total;

  // Client-side sub-count of visible contracts with deadlines in the next
  // 7 days. Uses only fetched rows — accurate for the loaded page, not a
  // cross-page aggregate. Good enough for an at-a-glance header stat.
  const deadlineCount = contracts.reduce((n, c) => {
    if (!c.responseDeadline) return n;
    const days = differenceInDays(parseISO(c.responseDeadline), new Date());
    return days >= 0 && days < 7 ? n + 1 : n;
  }, 0);

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Star
              className="w-6 h-6 fill-[var(--chosen)] text-[var(--chosen)]"
              aria-label="Chosen"
            />
            Chosen
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Contracts you&rsquo;ve personally elevated above AI&rsquo;s
            classification.
          </p>
          {total !== null && total > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              <strong className="text-[var(--text-primary)]">{total}</strong>{" "}
              chosen
              {deadlineCount > 0 && (
                <>
                  {" "}
                  &bull;{" "}
                  <strong className="text-[var(--urgent)]">
                    {deadlineCount}
                  </strong>{" "}
                  with deadlines in &lt;7d
                </>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => fetchPage(1, { append: false })}
          disabled={isFetching}
          className="p-2 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)] disabled:opacity-50"
          title="Refresh"
          data-testid="chosen-refresh"
        >
          <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
        </button>
      </div>

      {/* Error state — explicit, distinct from empty. Retry re-fetches page 1. */}
      {error && !loading && (
        <div
          data-testid="chosen-error"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center"
        >
          <AlertTriangle className="w-8 h-8 mx-auto text-[var(--urgent)] mb-2" />
          <div className="text-base font-semibold text-[var(--text-primary)]">
            Couldn&rsquo;t load chosen contracts
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Check your connection and try again.
          </p>
          <button
            data-testid="chosen-error-retry"
            onClick={() => fetchPage(1, { append: false })}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] hover:bg-[var(--surface)]"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {/* Loading state (initial only; Load more has its own spinner) */}
      {loading && !error && (
        <div
          data-testid="chosen-loading"
          className="text-sm text-[var(--text-muted)]"
        >
          Loading&hellip;
        </div>
      )}

      {/* Empty state — distinct from error. Only renders when fetch succeeded
          and returned zero rows. */}
      {!loading && !error && contracts.length === 0 && (
        <div
          data-testid="chosen-empty"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center"
        >
          <Star className="w-8 h-8 mx-auto text-[var(--chosen)] mb-2" />
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            Nothing here yet
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Open a contract and click{" "}
            <span className="text-[var(--chosen)] font-medium">
              &star; Promote
            </span>{" "}
            to add it, or use the Promote button on /inbox cards.
          </p>
        </div>
      )}

      {/* Loaded state — grid of cards */}
      {!loading && !error && contracts.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {contracts.map((c) => (
              <div key={c.id} className="relative">
                <KanbanCard
                  contract={c}
                  showClassification={true}
                  showNotesPreview={true}
                />
                <div className="mt-2 flex gap-2">
                  <button
                    data-testid={`chosen-demote-${c.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      demote(c.id);
                    }}
                    disabled={demoting.has(c.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
                  >
                    <Star className="w-3.5 h-3.5" />
                    {demoting.has(c.id) ? "Demoting…" : "Demote"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                data-testid="chosen-load-more"
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
