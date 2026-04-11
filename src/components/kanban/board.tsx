"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "./column";
import { KanbanCard, type ContractCard } from "./card";
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

export function KanbanBoard() {
  const [columns, setColumns] = useState<Record<ColumnId, ColumnState>>({
    DEADLINES: { contracts: [], page: 1, total: 0, loading: true },
    GOOD: { contracts: [], page: 1, total: 0, loading: true },
    MAYBE: { contracts: [], page: 1, total: 0, loading: true },
    DISCARD: { contracts: [], page: 1, total: 0, loading: true },
  });

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [agencyFilter, setAgencyFilter] = useState("");
  const [noticeTypeFilter, setNoticeTypeFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [activeCard, setActiveCard] = useState<ContractCard | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
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
      if (noticeTypeFilter) params.set("noticeType", noticeTypeFilter);

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
    [search, agencyFilter, noticeTypeFilter]
  );

  useEffect(() => {
    COLUMNS.forEach((col) => fetchColumn(col.id, 1, false));
  }, [fetchColumn]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setAgencyFilter("");
    setNoticeTypeFilter("");
  }

  function handleDragStart(event: DragStartEvent) {
    const contract = event.active.data.current?.contract as ContractCard | undefined;
    if (contract) setActiveCard(contract);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const contract = active.data.current?.contract as ContractCard | undefined;
    if (!contract) return;

    const targetColumn = over.id as string;
    // Only allow dropping into classification columns, not DEADLINES
    if (!["GOOD", "MAYBE", "DISCARD"].includes(targetColumn)) return;
    if (contract.classification === targetColumn) return;

    const sourceClassification = contract.classification as ColumnId;
    const targetClassification = targetColumn as ColumnId;

    // Optimistic update
    setColumns((prev) => {
      const updatedContract = {
        ...contract,
        classification: targetClassification,
      };
      const next = {
        ...prev,
        [sourceClassification]: {
          ...prev[sourceClassification],
          contracts: prev[sourceClassification].contracts.filter(
            (c) => c.id !== contract.id
          ),
          total: prev[sourceClassification].total - 1,
        },
        [targetClassification]: {
          ...prev[targetClassification],
          contracts: [updatedContract, ...prev[targetClassification].contracts],
          total: prev[targetClassification].total + 1,
        },
        // Update the DEADLINES column to reflect the classification change
        DEADLINES: {
          ...prev.DEADLINES,
          contracts: prev.DEADLINES.contracts.map((c) =>
            c.id === contract.id ? { ...c, classification: targetClassification as string } : c
          ),
        },
      };
      return next;
    });

    // Persist
    try {
      await fetch(`/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classification: targetClassification,
          userOverride: true,
        }),
      });
    } catch {
      // Revert on failure — refetch all columns including deadlines
      COLUMNS.forEach((col) => fetchColumn(col.id, 1, false));
    }
  }

  const hasFilters = search || agencyFilter || noticeTypeFilter;

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
            showFilters || hasFilters
              ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface)]"
          )}
        >
          <Filter className="w-4 h-4" />
          Filters
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

      {showFilters && (
        <div className="flex gap-3 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
          <input
            type="text"
            value={agencyFilter}
            onChange={(e) => setAgencyFilter(e.target.value)}
            placeholder="Filter by agency..."
            className="flex-1 px-3 py-1.5 text-sm bg-[var(--surface-alt)] border border-[var(--border)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                COLUMNS.forEach((col) => fetchColumn(col.id, 1, false));
              }
            }}
          />
          <input
            type="text"
            value={noticeTypeFilter}
            onChange={(e) => setNoticeTypeFilter(e.target.value)}
            placeholder="Notice type..."
            className="flex-1 px-3 py-1.5 text-sm bg-[var(--surface-alt)] border border-[var(--border)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                COLUMNS.forEach((col) => fetchColumn(col.id, 1, false));
              }
            }}
          />
          <button
            onClick={() => COLUMNS.forEach((col) => fetchColumn(col.id, 1, false))}
            className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]"
          >
            Apply
          </button>
        </div>
      )}

      {/* Kanban Columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
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
                onLoadMore={() =>
                  fetchColumn(col.id, state.page + 1, true)
                }
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeCard ? <KanbanCard contract={activeCard} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
