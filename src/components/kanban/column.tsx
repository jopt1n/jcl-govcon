"use client";

import { KanbanCard, type ContractCard } from "./card";
import { cn } from "@/lib/utils";
import { Loader2, Inbox } from "lucide-react";

interface ColumnProps {
  id: string;
  title: string;
  count: number;
  contracts: ContractCard[];
  color: string;
  loading: boolean;
  onLoadMore: () => void;
  hasMore: boolean;
  onArchive?: (contractId: string) => void;
  archivingIds?: Set<string>;
}

const colorMap: Record<string, { accent: string; badge: string }> = {
  green: {
    accent: "var(--good)",
    badge: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
  },
  amber: {
    accent: "var(--maybe)",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  gray: {
    accent: "var(--discard)",
    badge: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  },
  blue: {
    accent: "var(--pending)",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  red: {
    accent: "var(--urgent)",
    badge: "bg-red-500/10 text-red-500 dark:text-red-400",
  },
};

export function KanbanColumn({
  id,
  title,
  count,
  contracts,
  color,
  loading,
  onLoadMore,
  hasMore,
  onArchive,
  archivingIds,
}: ColumnProps) {
  const colors = colorMap[color] ?? colorMap.gray;

  return (
    <div className="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] min-w-[300px] w-full max-w-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: colors.accent }}
          />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {title}
          </h2>
        </div>
        <span
          className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full",
            colors.badge,
          )}
        >
          {count.toLocaleString()}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] min-h-[200px]">
        {contracts.map((contract) => (
          <KanbanCard
            key={contract.id}
            contract={contract}
            showClassification={id === "DEADLINES"}
            onArchive={onArchive}
            archiveBusy={archivingIds?.has(contract.id) ?? false}
          />
        ))}

        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
          </div>
        )}

        {!loading && hasMore && (
          <button
            onClick={onLoadMore}
            className="w-full py-2 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-5)] rounded transition-colors"
          >
            Load more...
          </button>
        )}

        {!loading && contracts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
            <Inbox className="w-8 h-8 mb-2 opacity-50" />
            <span className="text-xs">No contracts</span>
          </div>
        )}
      </div>
    </div>
  );
}
