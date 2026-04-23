"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LinkedContract = {
  id: string;
  noticeId: string;
  solicitationNumber: string | null;
  title: string;
  agency: string | null;
  noticeType: string | null;
  responseDeadline: string | null;
  postedDate: string;
  classification: string;
  reviewedAt: string | null;
  samUrl: string;
  resourceLinks: string[] | null;
  roles: string[];
  confidence: string | null;
  isPrimary: boolean;
};

type WatchEvent = {
  id: string;
  eventType: string;
  summary: string;
  notifiedAt: string | null;
  createdAt: string;
};

type WatchTargetDetail = {
  id: string;
  active: boolean;
  status: string;
  statusLabel: string;
  watchedAt: string;
  unwatchedAt: string | null;
  lastCheckedAt: string | null;
  lastAlertedAt: string | null;
  source: {
    contractId: string | null;
    noticeId: string | null;
    solicitationNumber: string | null;
    title: string | null;
    agency: string | null;
    noticeType: string | null;
    responseDeadline: string | null;
    setAsideCode: string | null;
    resourceUrls: string[];
  };
  currentSnapshot: {
    noticeId: string | null;
    solicitationNumber: string | null;
    title: string | null;
    agency: string | null;
    noticeType: string | null;
    responseDeadline: string | null;
    setAsideCode: string | null;
    resourceUrls: string[];
  } | null;
  primaryContractId: string | null;
  primaryContract: LinkedContract | null;
  linkedContracts: LinkedContract[];
  recentEvents: WatchEvent[];
};

type ContractSearchResult = {
  id: string;
  title: string;
  agency: string | null;
  noticeType: string | null;
  postedDate: string;
};

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

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

function roleLabel(role: string): string {
  switch (role) {
    case "source":
      return "Source";
    case "manual_candidate":
      return "Manual";
    case "auto_candidate":
      return "Auto";
    case "primary":
      return "Primary";
    default:
      return role;
  }
}

export default function WatchTargetDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [detail, setDetail] = useState<WatchTargetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<ContractSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/watch-targets/${params.id}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "fetch failed");
      setDetail(json);
    } catch {
      setError(true);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const linkedIds = useMemo(
    () => new Set(detail?.linkedContracts.map((contract) => contract.id) ?? []),
    [detail],
  );

  async function patchWatchTarget(body: Record<string, unknown>, busyKey: string) {
    setActionBusy(busyKey);
    try {
      const res = await fetch(`/api/watch-targets/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "update failed");
      setDetail(json);
      if (body.removeContractId || body.attachContractId) {
        setSearchResults((rows) =>
          rows.filter((row) => row.id !== body.attachContractId),
        );
      }
    } finally {
      setActionBusy(null);
    }
  }

  async function searchContracts() {
    if (!searchInput.trim()) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({
        search: searchInput.trim(),
        includeUnreviewed: "true",
        includeArchived: "true",
        limit: "10",
        page: "1",
      });
      const res = await fetch(`/api/contracts?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "search failed");
      setSearchResults((json.data ?? []) as ContractSearchResult[]);
    } finally {
      setSearching(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 pt-14 md:pt-6">
        <div
          data-testid="watch-detail-loading"
          className="text-sm text-[var(--text-muted)]"
        >
          Loading&hellip;
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 md:p-6 pt-14 md:pt-6">
        <div
          data-testid="watch-detail-error"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center"
        >
          <AlertTriangle className="w-8 h-8 mx-auto text-[var(--urgent)] mb-2" />
          <div className="text-base font-semibold text-[var(--text-primary)]">
            Couldn&rsquo;t load this watch target
          </div>
          <button
            onClick={fetchDetail}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] hover:bg-[var(--surface)]"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">
              {detail.source.title ?? "Watch target"}
            </h1>
            <span
              className={cn(
                "text-[10px] font-semibold px-2 py-1 rounded-full border",
                statusClasses(detail.status),
              )}
            >
              {detail.statusLabel}
            </span>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Watched since {formatDateTime(detail.watchedAt)}
          </p>
          <div className="text-xs text-[var(--text-muted)] mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>Last checked: {formatDateTime(detail.lastCheckedAt)}</span>
            <span>Last alert: {formatDateTime(detail.lastAlertedAt)}</span>
            <span>Linked contracts: {detail.linkedContracts.length}</span>
          </div>
        </div>
        <button
          onClick={fetchDetail}
          className="p-2 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)]"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {detail.status === "NEEDS_REVIEW" && (
        <div
          data-testid="watch-needs-review-banner"
          className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            Manual review needed
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Multiple plausible contracts are linked. Pick a primary contract to
            resolve the family before maturity alerts resume.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                  Source Opportunity
                </div>
                <div className="text-sm text-[var(--text-secondary)] mt-1">
                  {detail.source.agency ?? "Agency unavailable"}
                </div>
              </div>
              {detail.source.contractId && (
                <Link
                  href={`/contracts/${detail.source.contractId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)]"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open source contract
                </Link>
              )}
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[var(--text-muted)]">Notice ID</div>
                <div className="text-[var(--text-primary)]">
                  {detail.source.noticeId ?? "N/A"}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">Solicitation</div>
                <div className="text-[var(--text-primary)]">
                  {detail.source.solicitationNumber ?? "N/A"}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">Notice Type</div>
                <div className="text-[var(--text-primary)]">
                  {detail.source.noticeType ?? "N/A"}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">Response Deadline</div>
                <div className="text-[var(--text-primary)]">
                  {formatDateTime(detail.source.responseDeadline)}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Linked Contracts
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Keep separate SAM rows visible here, then choose the primary
                  one for current-state display and alerts.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {detail.linkedContracts.map((contract) => (
                <div
                  key={contract.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] p-4"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/contracts/${contract.id}`}
                          className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
                        >
                          {contract.title}
                        </Link>
                        {contract.isPrimary && (
                          <span className="text-[10px] font-semibold px-2 py-1 rounded-full border bg-[var(--chosen-bg)] text-[var(--chosen)] border-[var(--chosen-border)] flex items-center gap-1">
                            <Star className="w-3 h-3 fill-[var(--chosen)]" />
                            PRIMARY
                          </span>
                        )}
                        {contract.roles.map((role) => (
                          <span
                            key={role}
                            className="text-[10px] font-medium px-2 py-1 rounded-full border bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
                          >
                            {roleLabel(role)}
                          </span>
                        ))}
                      </div>
                      <div className="text-sm text-[var(--text-secondary)] mt-1">
                        {contract.agency ?? "Agency unavailable"}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        <span>Notice type: {contract.noticeType ?? "N/A"}</span>
                        <span>
                          Solicitation: {contract.solicitationNumber ?? "N/A"}
                        </span>
                        <span>
                          Posted: {formatDateTime(contract.postedDate)}
                        </span>
                        <span>
                          Deadline: {formatDateTime(contract.responseDeadline)}
                        </span>
                        <span>
                          Classification: {contract.classification}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!contract.isPrimary && (
                        <button
                          data-testid={`watch-make-primary-${contract.id}`}
                          onClick={() =>
                            patchWatchTarget(
                              { primaryContractId: contract.id },
                              `primary:${contract.id}`,
                            )
                          }
                          disabled={actionBusy === `primary:${contract.id}`}
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-[var(--chosen-border)] text-[var(--chosen)] hover:bg-[var(--chosen-bg)] disabled:opacity-50"
                        >
                          <Star className="w-3.5 h-3.5" />
                          {actionBusy === `primary:${contract.id}`
                            ? "Saving…"
                            : "Make primary"}
                        </button>
                      )}
                      {!contract.roles.includes("source") && !contract.isPrimary && (
                        <button
                          data-testid={`watch-remove-${contract.id}`}
                          onClick={() =>
                            patchWatchTarget(
                              { removeContractId: contract.id },
                              `remove:${contract.id}`,
                            )
                          }
                          disabled={actionBusy === `remove:${contract.id}`}
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
                        >
                          {actionBusy === `remove:${contract.id}`
                            ? "Removing…"
                            : "Remove"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Manual Link Management
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Search existing contracts, attach candidates, then promote the
              right one to primary.
            </p>
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search title, agency, solicitation..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--surface-alt)] border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <button
                onClick={searchContracts}
                disabled={searching}
                className="px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-alt)] p-3"
                >
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    {result.title}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">
                    {result.agency ?? "Agency unavailable"} •{" "}
                    {result.noticeType ?? "N/A"} • Posted{" "}
                    {formatDateTime(result.postedDate)}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Link
                      href={`/contracts/${result.id}`}
                      className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)]"
                    >
                      Open
                    </Link>
                    <button
                      data-testid={`watch-attach-${result.id}`}
                      onClick={() =>
                        patchWatchTarget(
                          { attachContractId: result.id },
                          `attach:${result.id}`,
                        )
                      }
                      disabled={
                        linkedIds.has(result.id) ||
                        actionBusy === `attach:${result.id}`
                      }
                      className="text-xs px-2 py-1 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
                    >
                      {linkedIds.has(result.id)
                        ? "Already linked"
                        : actionBusy === `attach:${result.id}`
                          ? "Attaching…"
                          : "Attach"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Recent Watch Events
            </h2>
            <div className="mt-3 space-y-2">
              {detail.recentEvents.length === 0 && (
                <div className="text-sm text-[var(--text-muted)]">
                  No watch events yet.
                </div>
              )}
              {detail.recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-alt)] p-3"
                >
                  <div className="text-sm text-[var(--text-primary)]">
                    {event.summary}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span>{formatDateTime(event.createdAt)}</span>
                    <span>
                      {event.notifiedAt
                        ? `Alerted ${formatDateTime(event.notifiedAt)}`
                        : "Pending alert"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
