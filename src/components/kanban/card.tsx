"use client";

import { format, differenceInDays, parseISO } from "date-fns";
import { Building2, DollarSign, Clock, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export interface ContractCard {
  id: string;
  title: string;
  agency: string | null;
  awardCeiling: string | null;
  responseDeadline: string | null;
  noticeType: string | null;
  classification: string;
  aiReasoning: string | null;
  status: string | null;
}

const classificationBorder: Record<string, string> = {
  GOOD: "border-l-[var(--good)]",
  MAYBE: "border-l-[var(--maybe)]",
  DISCARD: "border-l-[var(--discard)]",
  PENDING: "border-l-[var(--pending)]",
};

function getDeadlineInfo(deadline: string | null): {
  className: string;
  urgent: boolean;
  warning: boolean;
} {
  if (!deadline)
    return {
      className: "text-[var(--text-muted)]",
      urgent: false,
      warning: false,
    };
  const days = differenceInDays(parseISO(deadline), new Date());
  if (days < 0)
    return {
      className: "text-[var(--text-muted)] line-through",
      urgent: false,
      warning: false,
    };
  if (days < 3)
    return { className: "text-[var(--urgent)]", urgent: true, warning: false };
  if (days < 7)
    return { className: "text-[var(--maybe)]", urgent: false, warning: true };
  return { className: "text-[var(--good)]", urgent: false, warning: false };
}

function formatCeiling(value: string | null): string {
  if (!value) return "N/A";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

const classificationBadge: Record<string, string> = {
  GOOD: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  MAYBE: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  DISCARD: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

export function KanbanCard({
  contract,
  showClassification,
}: {
  contract: ContractCard;
  showClassification?: boolean;
}) {
  const deadlineInfo = contract.responseDeadline
    ? getDeadlineInfo(contract.responseDeadline)
    : null;

  return (
    <Link
      href={`/contracts/${contract.id}`}
      className={cn(
        "block bg-[var(--surface)] rounded-lg border border-[var(--border)] border-l-[3px] p-3 cursor-pointer hover:shadow-md transition-shadow",
        classificationBorder[contract.classification] ??
          "border-l-[var(--border)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] line-clamp-2 leading-tight">
          {contract.title}
        </span>
        {deadlineInfo?.urgent && (
          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/10 text-[var(--urgent)]">
            URGENT
          </span>
        )}
        {deadlineInfo?.warning && (
          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-[var(--maybe)]">
            SOON
          </span>
        )}
        {showClassification && classificationBadge[contract.classification] && (
          <span
            className={cn(
              "shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border",
              classificationBadge[contract.classification],
            )}
          >
            {contract.classification}
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {contract.agency && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Building2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{contract.agency}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <DollarSign className="w-3 h-3 shrink-0" />
            <span>{formatCeiling(contract.awardCeiling)}</span>
          </div>

          {contract.responseDeadline && (
            <div
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                getDeadlineInfo(contract.responseDeadline).className,
              )}
            >
              <Clock className="w-3 h-3 shrink-0" />
              <span>
                {format(parseISO(contract.responseDeadline), "MMM d")}
              </span>
            </div>
          )}
        </div>

        {contract.aiReasoning && (
          <div className="flex items-start gap-1.5 text-xs text-[var(--text-muted)] mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]">
            <Brain className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{contract.aiReasoning}</span>
          </div>
        )}
      </div>

      {contract.noticeType && (
        <div className="mt-2">
          <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--surface-alt)] text-[var(--text-secondary)]">
            {contract.noticeType}
          </span>
        </div>
      )}
    </Link>
  );
}
