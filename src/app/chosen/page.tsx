"use client";

/**
 * /chosen - user-driven promoted opportunity families.
 *
 * Chosen is one card per promoted family, not one card per promoted notice row.
 * The API preserves the legacy promoted-row fallback while persisted families
 * exist, so the UI can stay family-shaped without duplicating family members.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { differenceInDays, parseISO } from "date-fns";
import { AlertTriangle, RefreshCw, Star } from "lucide-react";
import { KanbanCard, type ContractCard } from "@/components/kanban/card";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

type PromotedFamilySummary = {
  familyId: string;
  decision: "PROMOTE";
  totalNotices: number;
  needsReview: boolean;
  latestEventType: string | null;
  latestEventAt: string | null;
  current: ContractCard & {
    postedDate?: string | Date;
    reviewedAt?: string | Date | null;
    promotedAt?: string | Date | null;
    tags?: string[] | null;
    createdAt?: string | Date;
  };
};

function asCard(family: PromotedFamilySummary): ContractCard {
  return {
    ...family.current,
    responseDeadline: family.current.responseDeadline
      ? String(family.current.responseDeadline)
      : null,
    promoted: true,
  };
}

function familyBadge(family: PromotedFamilySummary): string | null {
  const tags = family.current.tags ?? [];
  if (
    family.needsReview ||
    tags.includes("PROMOTED_FAMILY_REVIEW_NEEDED")
  ) {
    return "Needs review";
  }
  if (tags.includes("PROMOTED_FAMILY_UPDATE")) {
    return "Family update";
  }

  switch (family.latestEventType) {
    case "new_notice_added":
      return "New notice";
    case "notice_progression":
      return "Progressed";
    case "deadline_changed":
      return "Deadline changed";
    case "documents_added":
      return "Documents added";
    default:
      return null;
  }
}

function noticeCountText(count: number): string {
  return `${count} notice${count === 1 ? "" : "s"}`;
}

export default function ChosenPage() {
  const [families, setFamilies] = useState<PromotedFamilySummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [demoting, setDemoting] = useState<Set<string>>(new Set());

  // Single in-flight fetch at a time. inFlight ref is the authoritative guard;
  // state flags are only for UI.
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
          decision: "PROMOTE",
          limit: String(PAGE_SIZE),
          page: String(pageNum),
        });
        const res = await fetch(`/api/opportunity-families?${params}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "fetch failed");
        const rows: PromotedFamilySummary[] = json.data ?? [];
        setFamilies((prev) => (append ? [...prev, ...rows] : rows));
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

  const demote = async (family: PromotedFamilySummary) => {
    setDemoting((prev) => new Set(prev).add(family.familyId));
    setFamilies((rows) => rows.filter((row) => row.familyId !== family.familyId));
    setTotal((t) => (t === null ? t : Math.max(0, t - 1)));
    try {
      const res = await fetch(`/api/contracts/${family.current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoted: false }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    } catch {
      await fetchPage(page, { append: false });
    } finally {
      setDemoting((d) => {
        const next = new Set(d);
        next.delete(family.familyId);
        return next;
      });
    }
  };

  const isFetching = loading || loadingMore;
  const hasMore = total !== null && families.length < total;

  const deadlineCount = families.reduce((n, family) => {
    const deadline = family.current.responseDeadline;
    if (!deadline) return n;
    const days = differenceInDays(parseISO(String(deadline)), new Date());
    return days >= 0 && days < 7 ? n + 1 : n;
  }, 0);

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4 max-w-6xl mx-auto">
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
            Promoted opportunity families with the current notice shown.
          </p>
          {total !== null && total > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              <strong className="text-[var(--text-primary)]">{total}</strong>{" "}
              promoted {total === 1 ? "family" : "families"}
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

      {error && !loading && (
        <div
          data-testid="chosen-error"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center"
        >
          <AlertTriangle className="w-8 h-8 mx-auto text-[var(--urgent)] mb-2" />
          <div className="text-base font-semibold text-[var(--text-primary)]">
            Couldn&rsquo;t load chosen families
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

      {loading && !error && (
        <div
          data-testid="chosen-loading"
          className="text-sm text-[var(--text-muted)]"
        >
          Loading&hellip;
        </div>
      )}

      {!loading && !error && families.length === 0 && (
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

      {!loading && !error && families.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {families.map((family) => {
              const badge = familyBadge(family);
              return (
                <div
                  key={family.familyId}
                  data-testid={`chosen-family-${family.familyId}`}
                  className="relative"
                >
                  <KanbanCard
                    contract={asCard(family)}
                    showClassification={true}
                    showNotesPreview={true}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    <span data-testid={`chosen-family-count-${family.familyId}`}>
                      {noticeCountText(family.totalNotices)}
                    </span>
                    {badge && (
                      <span
                        data-testid={`chosen-family-badge-${family.familyId}`}
                        className="rounded-full border border-[var(--chosen-border)] bg-[var(--chosen-bg)] px-2 py-0.5 font-semibold text-[var(--chosen)]"
                      >
                        {badge}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      data-testid={`chosen-demote-${family.current.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        demote(family);
                      }}
                      disabled={demoting.has(family.familyId)}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
                    >
                      <Star className="w-3.5 h-3.5" />
                      {demoting.has(family.familyId) ? "Demoting..." : "Demote"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                data-testid="chosen-load-more"
                onClick={() => fetchPage(page + 1, { append: true })}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
