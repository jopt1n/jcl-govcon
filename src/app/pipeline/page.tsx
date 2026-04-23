"use client";

/**
 * /pipeline — active contract pipeline.
 *
 * Four-column Kanban grouped by contractStatusEnum, excluding IDENTIFIED
 * (those live on the main board). Drag cards between columns to change
 * status — fires a PATCH that also bumps statusChangedAt, feeding the
 * weekly retro stats.
 *
 * Only shows contracts with status IN (PURSUING, BID_SUBMITTED, WON, LOST).
 * Export CSV button downloads the current pipeline in one click.
 */

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type ContractCard, KanbanCard } from "@/components/kanban/card";
import { Download, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

type PipelineStatus = "PURSUING" | "BID_SUBMITTED" | "WON" | "LOST";

const COLUMNS: {
  id: PipelineStatus;
  title: string;
  accentVar: string;
}[] = [
  { id: "PURSUING", title: "PURSUING", accentVar: "var(--accent)" },
  { id: "BID_SUBMITTED", title: "BID SUBMITTED", accentVar: "var(--pending)" },
  { id: "WON", title: "WON", accentVar: "var(--good)" },
  { id: "LOST", title: "LOST", accentVar: "var(--discard)" },
];

type State = Record<PipelineStatus, ContractCard[]>;

const EMPTY_STATE: State = {
  PURSUING: [],
  BID_SUBMITTED: [],
  WON: [],
  LOST: [],
};

// Cards in the pipeline have a `status` field we depend on for grouping
type PipelineCard = ContractCard & { status: string | null };

function groupByStatus(rows: PipelineCard[]): State {
  const out: State = { PURSUING: [], BID_SUBMITTED: [], WON: [], LOST: [] };
  for (const row of rows) {
    const s = row.status as PipelineStatus;
    if (s in out) out[s].push(row);
  }
  return out;
}

export default function PipelinePage() {
  const [state, setState] = useState<State>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [activeCard, setActiveCard] = useState<ContractCard | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const fetchPipeline = useCallback(async () => {
    setLoading(true);
    // Fetch from the dedicated pipeline export endpoint, which returns CSV
    // of all pipeline statuses in one query. For the UI we want JSON, so
    // hit /api/contracts once with a generous limit and filter client-side.
    try {
      const params = new URLSearchParams({
        limit: "500",
        includeUnreviewed: "true",
        includeExpired: "true",
      });
      const res = await fetch(`/api/contracts?${params}`);
      const json = await res.json();
      if (!res.ok || !json.data) {
        setState(EMPTY_STATE);
        return;
      }
      const pipelineRows = (json.data as PipelineCard[]).filter(
        (r) => r.status && r.status !== "IDENTIFIED",
      );
      setState(groupByStatus(pipelineRows));
    } catch {
      setState(EMPTY_STATE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    for (const col of COLUMNS) {
      const found = state[col.id].find((c) => c.id === id);
      if (found) {
        setActiveCard(found);
        return;
      }
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;
    const cardId = active.id as string;
    const overId = over.id as string;

    // over.id is the column ID (we set it as the droppable id)
    if (!COLUMNS.some((c) => c.id === overId)) return;

    // Find the source column
    let sourceCol: PipelineStatus | null = null;
    for (const col of COLUMNS) {
      if (state[col.id].some((c) => c.id === cardId)) {
        sourceCol = col.id;
        break;
      }
    }
    if (!sourceCol || sourceCol === overId) return;

    const targetCol = overId as PipelineStatus;
    const card = state[sourceCol].find((c) => c.id === cardId);
    if (!card) return;

    // Optimistic update
    setState((prev) => ({
      ...prev,
      [sourceCol!]: prev[sourceCol!].filter((c) => c.id !== cardId),
      [targetCol]: [{ ...card, status: targetCol }, ...prev[targetCol]],
    }));

    try {
      const res = await fetch(`/api/contracts/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetCol }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    } catch {
      // Revert on error
      fetchPipeline();
    }
  }

  async function handleExport() {
    // Export all currently-visible statuses
    const statuses = COLUMNS.map((c) => c.id).join(",");
    window.location.href = `/api/contracts/export?status=${statuses}`;
  }

  const totalCount =
    state.PURSUING.length +
    state.BID_SUBMITTED.length +
    state.WON.length +
    state.LOST.length;

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <GitBranch className="w-6 h-6" /> Pipeline
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Drag contracts between columns to advance. {totalCount} active.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={totalCount === 0}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-[var(--border)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] disabled:opacity-50"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--text-muted)]">
          Loading pipeline…
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {COLUMNS.map((col) => (
              <PipelineColumn
                key={col.id}
                id={col.id}
                title={col.title}
                accentVar={col.accentVar}
                cards={state[col.id]}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard && (
              <div className="opacity-90 rotate-1">
                <KanbanCard contract={activeCard} showClassification />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────────

function PipelineColumn({
  id,
  title,
  accentVar,
  cards,
}: {
  id: PipelineStatus;
  title: string;
  accentVar: string;
  cards: ContractCard[];
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-lg border bg-[var(--surface-alt)] min-w-[280px] w-full max-w-[360px] transition-colors",
        isOver
          ? "border-[var(--accent)] ring-2 ring-[var(--accent-20)]"
          : "border-[var(--border)]",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: accentVar }}
          />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {title}
          </h2>
        </div>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--surface)] text-[var(--text-secondary)]">
          {cards.length}
        </span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)] min-h-[200px]">
        {cards.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] text-center py-6">
            Drop contracts here
          </div>
        )}
        {cards.map((c) => (
          <DraggableCard key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}

// ── Draggable wrapper ────────────────────────────────────────────────────

function DraggableCard({ card }: { card: ContractCard }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "touch-none cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <KanbanCard contract={card} showClassification />
    </div>
  );
}
