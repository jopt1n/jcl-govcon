"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { KanbanColumn } from "./column";
import { type ContractCard } from "./card";
import { KanbanFilterChips, type PostedWindow } from "./filter-chips";
import { Search, Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ColumnId = "DEADLINES" | "GOOD" | "MAYBE" | "DISCARD";

interface ColumnState {
  contracts: ContractCard[];
  page: number;
  total: number;
  loading: boolean;
}

const COLUMNS: { id: ColumnId; title: string; color: string }[] = [
  { id: "DEADLINES", title: "UPCOMING DEADLINES", color: "red" },
  { id: "GOOD", title: "GOOD", color: "green" },
  { id: "MAYBE", title: "MAYBE", color: "amber" },
  { id: "DISCARD", title: "DISCARD", color: "gray" },
];

const LIMIT = 50;

function postedAfterFromWindow(window: PostedWindow): string | null {
  if (window === "all") return null;
  const now = new Date();
  if (window === "week") {
    now.setUTCDate(now.getUTCDate() - 7);
  } else {
    now.setUTCDate(1);
    now.setUTCHours(0, 0, 0, 0);
  }
  return now.toISOString();
}

export function KanbanBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const noticeTypeParam = searchParams.get("noticeType") ?? "";
  const postedWindow =
    (searchParams.get("postedWindow") as PostedWindow) ?? "all";
  const qualifyingOnly = searchParams.get("setAsideQualifying") === "1";
  const search = searchParams.get("search") ?? "";
  const agencyFilter = searchParams.get("agency") ?? "";

  const noticeTypes = noticeTypeParam
    ? noticeTypeParam.split(",").filter(Boolean)
    : [];

  const [columns, setColumns] = useState<Record<ColumnId, ColumnState>>({
    DEADLINES: { contracts: [], page: 1, total: 0, loading: true },
    GOOD: { contracts: [], page: 1, total: 0, loading: true },
    MAYBE: { contracts: [], page: 1, total: 0, loading: true },
    DISCARD: { contracts: [], page: 1, total: 0, loading: true },
  });

  const [searchInput, setSearchInput] = useState(search);
  const [agencyInput, setAgencyInput] = useState(agencyFilter);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);
  useEffect(() => {
    setAgencyInput(agencyFilter);
  }, [agencyFilter]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const fetchColumn = useCallback(
    async (columnId: ColumnId, page: number, append: boolean) => {
      setColumns((prev) => ({
        ...prev,
        [columnId]: { ...prev[columnId], loading: true },
      }));

      const params = new URLSearchParams({
        classification: columnId,
        page: String(page),
        limit: String(LIMIT),
      });
      if (search) params.set("search", search);
      if (agencyFilter) params.set("agency", agencyFilter);
      if (noticeTypeParam) params.set("noticeType", noticeTypeParam);
      const postedAfter = postedAfterFromWindow(postedWindow);
      if (postedAfter) params.set("postedAfter", postedAfter);
      if (qualifyingOnly) params.set("setAsideQualifying", "1");

      try {
        const res = await fetch(`/api/contracts?${params}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const json = await res.json();

        if (!res.ok || !json.data) {
          throw new Error(json.error ?? "Failed to fetch");
        }

        setColumns((prev) => ({
          ...prev,
          [columnId]: {
            contracts: append
              ? [...prev[columnId].contracts, ...json.data]
              : json.data,
            page,
            total: json.pagination?.total ?? 0,
            loading: false,
          },
        }));
      } catch {
        // On failure, revert to previous page so "Load more" reappears
        setColumns((prev) => ({
          ...prev,
          [columnId]: {
            ...prev[columnId],
            page: append ? prev[columnId].page : 1,
            loading: false,
          },
        }));
      }
    },
    [search, agencyFilter, noticeTypeParam, postedWindow, qualifyingOnly],
  );

  useEffect(() => {
    COLUMNS.forEach((col) => fetchColumn(col.id, 1, false));
  }, [fetchColumn]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ search: searchInput });
  }

  function toggleNoticeType(type: string) {
    const next = noticeTypes.includes(type)
      ? noticeTypes.filter((t) => t !== type)
      : [...noticeTypes, type];
    updateParams({ noticeType: next.length ? next.join(",") : null });
  }

  function setPostedWindowValue(window: PostedWindow) {
    updateParams({ postedWindow: window === "all" ? null : window });
  }

  function toggleQualifying() {
    updateParams({ setAsideQualifying: qualifyingOnly ? null : "1" });
  }

  function clearFilters() {
    setSearchInput("");
    setAgencyInput("");
    router.replace(pathname, { scroll: false });
  }

  const hasFilters =
    search ||
    agencyFilter ||
    noticeTypeParam ||
    postedWindow !== "all" ||
    qualifyingOnly;

  return (
    <div className="space-y-4">
      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search contracts..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
          />
        </form>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors",
            showFilters || agencyFilter
              ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface)]",
          )}
        >
          <Filter className="w-4 h-4" />
          Agency
        </button>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-2 py-2 text-sm text-[var(--urgent)] hover:bg-red-500/5 rounded-lg"
          >
            <X className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      <KanbanFilterChips
        noticeTypes={noticeTypes}
        onToggleNoticeType={toggleNoticeType}
        postedWindow={postedWindow}
        onPostedWindow={setPostedWindowValue}
        qualifyingOnly={qualifyingOnly}
        onToggleQualifying={toggleQualifying}
      />

      {showFilters && (
        <div className="flex gap-3 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
          <input
            type="text"
            value={agencyInput}
            onChange={(e) => setAgencyInput(e.target.value)}
            placeholder="Filter by agency..."
            className="flex-1 px-3 py-1.5 text-sm bg-[var(--surface-alt)] border border-[var(--border)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                updateParams({ agency: agencyInput });
              }
            }}
          />
          <button
            onClick={() => updateParams({ agency: agencyInput })}
            className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]"
          >
            Apply
          </button>
        </div>
      )}

      {/* Kanban Columns */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const state = columns[col.id];
          return (
            <KanbanColumn
              key={col.id}
              id={col.id}
              title={col.title}
              count={state.total}
              contracts={state.contracts}
              color={col.color}
              loading={state.loading}
              hasMore={state.contracts.length < state.total}
              onLoadMore={() => fetchColumn(col.id, state.page + 1, true)}
            />
          );
        })}
      </div>
    </div>
  );
}
