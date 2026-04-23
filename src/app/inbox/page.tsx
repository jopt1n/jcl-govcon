"use client";

/**
 * /inbox — the triage view.
 *
 * Shows all un-triaged contracts (reviewedAt IS NULL), grouped by
 * classification. Each card has a "Mark reviewed" button that PATCHes
 * reviewedAt to now() and optimistically removes the card from the list.
 * Once reviewed, contracts flow into the main Kanban at /.
 *
 * Mobile-first: you check this on your phone after the Friday crawl.
 */

import { useState, useEffect, useCallback } from "react";
import { KanbanCard, type ContractCard } from "@/components/kanban/card";
import { Check, Inbox as InboxIcon, RefreshCw, Star } from "lucide-react";
import { cn } from "@/lib/utils";

type Classification = "GOOD" | "MAYBE" | "DISCARD";

const GROUPS: { id: Classification; title: string; color: string }[] = [
  { id: "GOOD", title: "GOOD", color: "emerald" },
  { id: "MAYBE", title: "MAYBE", color: "amber" },
  { id: "DISCARD", title: "DISCARD", color: "slate" },
];

type GroupState = {
  contracts: ContractCard[];
  loading: boolean;
};

type LatestRun = {
  id: string;
  kind: string;
  windowStart: string;
  windowEnd: string;
  status: string;
  contractsFound: number;
  contractsClassified: number;
  digestSentAt: string | null;
  createdAt: string;
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function InboxPage() {
  const [groups, setGroups] = useState<Record<Classification, GroupState>>({
    GOOD: { contracts: [], loading: true },
    MAYBE: { contracts: [], loading: true },
    DISCARD: { contracts: [], loading: true },
  });
  const [latestRun, setLatestRun] = useState<LatestRun | null>(null);
  const [marking, setMarking] = useState<Set<string>>(new Set());

  const fetchGroup = useCallback(async (classification: Classification) => {
    setGroups((prev) => ({
      ...prev,
      [classification]: { ...prev[classification], loading: true },
    }));
    try {
      const params = new URLSearchParams({
        classification,
        unreviewed: "true",
        limit: "100",
      });
      const res = await fetch(`/api/contracts?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "fetch failed");
      setGroups((prev) => ({
        ...prev,
        [classification]: { contracts: json.data ?? [], loading: false },
      }));
    } catch {
      setGroups((prev) => ({
        ...prev,
        [classification]: { ...prev[classification], loading: false },
      }));
    }
  }, []);

  const fetchLatestRun = useCallback(async () => {
    try {
      const res = await fetch("/api/crawl-runs/latest?kind=weekly");
      const json = await res.json();
      if (res.ok) setLatestRun(json.run);
    } catch {
      // non-fatal
    }
  }, []);

  const refreshAll = useCallback(() => {
    for (const g of GROUPS) fetchGroup(g.id);
    fetchLatestRun();
  }, [fetchGroup, fetchLatestRun]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Shared optimistic-remove primitive for /inbox actions that triage a
  // contract off this page in a single PATCH. Two callers today:
  //   markReviewed  → { reviewedAt: true }
  //   promote       → { promoted: true }   (PATCH handler also implies
  //                                          reviewedAt via COALESCE)
  //
  // Kept as an inner function inside InboxPage so it closes over marking,
  // groups, and fetchGroup naturally. A standalone helper taking all three
  // as parameters would add a 4-arg signature at call sites for no readability
  // gain — the Commit 3 eng review's C1 decision landed on the closure shape.
  async function removeFromInbox(
    id: string,
    classification: Classification,
    body: Record<string, unknown>,
  ) {
    setMarking((prev) => new Set(prev).add(id));
    // Optimistic remove
    setGroups((prev) => ({
      ...prev,
      [classification]: {
        ...prev[classification],
        contracts: prev[classification].contracts.filter((c) => c.id !== id),
      },
    }));
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`PATCH failed: ${res.status}`);
      }
    } catch {
      // Revert on error
      fetchGroup(classification);
    } finally {
      setMarking((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const markReviewed = (id: string, classification: Classification) =>
    removeFromInbox(id, classification, { reviewedAt: true });

  const promote = (id: string, classification: Classification) =>
    removeFromInbox(id, classification, { promoted: true });

  const totalUnreviewed =
    groups.GOOD.contracts.length +
    groups.MAYBE.contracts.length +
    groups.DISCARD.contracts.length;
  const anyLoading =
    groups.GOOD.loading || groups.MAYBE.loading || groups.DISCARD.loading;

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <InboxIcon className="w-6 h-6" /> Inbox
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            New contracts from the latest weekly run. Mark reviewed to send them
            to the main board.
          </p>
        </div>
        <button
          onClick={refreshAll}
          className="p-2 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)]"
          title="Refresh"
        >
          <RefreshCw className={cn("w-4 h-4", anyLoading && "animate-spin")} />
        </button>
      </div>

      {/* Latest run summary */}
      {latestRun && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-alt)] p-3 text-sm text-[var(--text-secondary)]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Last run:{" "}
              <strong className="text-[var(--text-primary)]">
                {formatRelative(latestRun.createdAt)}
              </strong>
            </span>
            <span>
              Status:{" "}
              <strong className="text-[var(--text-primary)]">
                {latestRun.status}
              </strong>
            </span>
            <span>
              Crawled:{" "}
              <strong className="text-[var(--text-primary)]">
                {latestRun.contractsFound}
              </strong>
            </span>
            <span>
              Classified:{" "}
              <strong className="text-[var(--text-primary)]">
                {latestRun.contractsClassified}
              </strong>
            </span>
            {latestRun.digestSentAt && (
              <span>
                Digest sent:{" "}
                <strong className="text-[var(--text-primary)]">
                  {formatRelative(latestRun.digestSentAt)}
                </strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!anyLoading && totalUnreviewed === 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <div className="text-4xl mb-2">✅</div>
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            All caught up
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            No un-triaged contracts. Next weekly run: Friday 15:00 UTC.
          </p>
        </div>
      )}

      {/* Groups */}
      {GROUPS.map((group) => {
        const state = groups[group.id];
        if (state.contracts.length === 0 && !state.loading) return null;
        return (
          <section key={group.id} className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
              {group.title}
              <span className="text-xs font-normal text-[var(--text-muted)]">
                {state.contracts.length}
              </span>
            </h2>
            {state.loading ? (
              <div className="text-sm text-[var(--text-muted)]">Loading…</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {state.contracts.map((c) => (
                  <div key={c.id} className="relative">
                    <KanbanCard contract={c} showClassification={false} />
                    <div className="mt-2 flex gap-2">
                      {/* Defensive guard — promote-implies-reviewed COALESCE in
                          the PATCH handler (§2a) should filter any just-promoted
                          contract off /inbox on the next fetch, so this button
                          should never render on a c.promoted === true card in
                          practice. Kept for stale-render safety (promote in
                          tab A, /inbox still open in tab B) and to make intent
                          explicit. Do not delete. */}
                      {!c.promoted && (
                        <button
                          data-testid={`inbox-promote-${c.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            promote(c.id, group.id);
                          }}
                          disabled={marking.has(c.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-[var(--chosen-border)] bg-[var(--surface)] text-[var(--chosen)] hover:bg-[var(--chosen-bg)] disabled:opacity-50"
                        >
                          <Star className="w-3.5 h-3.5" />
                          {marking.has(c.id) ? "Promoting…" : "Promote"}
                        </button>
                      )}
                      <button
                        data-testid={`inbox-mark-reviewed-${c.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          markReviewed(c.id, group.id);
                        }}
                        disabled={marking.has(c.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {marking.has(c.id) ? "Marking…" : "Mark reviewed"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
