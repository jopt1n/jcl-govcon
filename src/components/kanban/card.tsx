"use client";

import { format, differenceInDays, parseISO } from "date-fns";
import {
  Building2,
  DollarSign,
  Clock,
  Star,
  FileText,
  Archive,
} from "lucide-react";
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
  summary?: string | null;
  actionPlan?: string | null;
  status: string | null;
  notes?: string | null;
  /** User-driven promotion (CHOSEN tier). Optional — cards from older code
   *  paths may omit the field. Renders a gold border + star when true. */
  promoted?: boolean;
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

function getWhatThisContractIsText(contract: ContractCard): string | null {
  if (contract.actionPlan) {
    try {
      const parsed = JSON.parse(contract.actionPlan) as {
        description?: unknown;
      };
      if (
        typeof parsed.description === "string" &&
        parsed.description.trim().length > 0
      ) {
        return parsed.description.trim();
      }
    } catch {
      // Ignore invalid action-plan JSON in cards.
    }
  }

  if (typeof contract.summary === "string" && contract.summary.trim().length > 0) {
    return contract.summary.trim();
  }

  return null;
}

export function KanbanCard({
  contract,
  showClassification,
  showNotesPreview,
  onArchive,
  archiveBusy = false,
}: {
  contract: ContractCard;
  showClassification?: boolean;
  showNotesPreview?: boolean;
  onArchive?: (contractId: string) => void;
  archiveBusy?: boolean;
}) {
  const deadlineInfo = contract.responseDeadline
    ? getDeadlineInfo(contract.responseDeadline)
    : null;
  const notePreview = contract.notes?.trim() || null;
  const whatThisContractIs = getWhatThisContractIsText(contract);

  // Border-left styling is STATE-EXCLUSIVE: when promoted, ONLY the gold
  // 4px classes are applied; the default 3px + classification-color classes
  // are omitted entirely. Rendering both sets and relying on Tailwind
  // specificity/order is fragile — this way only one border-left width and
  // color exist in the DOM per state. Regression test asserts this exclusivity.
  const borderClasses = contract.promoted
    ? "border-l-[4px] border-l-[var(--chosen)]"
    : cn(
        "border-l-[3px]",
        classificationBorder[contract.classification] ??
          "border-l-[var(--border)]",
      );

  return (
    <div
      data-testid="kanban-card"
      className={cn(
        "group bg-[var(--surface)] rounded-lg border border-[var(--border)] p-3 hover:shadow-md transition-shadow",
        borderClasses,
      )}
    >
      <Link href={`/contracts/${contract.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <span className="text-base font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] line-clamp-2 leading-tight flex items-center gap-1">
            {contract.promoted && (
              <Star
                data-testid="chosen-star"
                className="w-3 h-3 shrink-0 fill-[var(--chosen)] text-[var(--chosen)]"
                aria-label="Chosen"
              />
            )}
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
            <div
              className={cn(
                "shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border",
                classificationBadge[contract.classification],
              )}
            >
              {contract.classification}
            </div>
          )}
        </div>

        <div className="mt-2 space-y-1">
          {contract.agency && (
            <div className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
              <Building2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{contract.agency}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
              <DollarSign className="w-3 h-3 shrink-0" />
              <span>{formatCeiling(contract.awardCeiling)}</span>
            </div>

            {contract.responseDeadline && (
              <div
                className={cn(
                  "flex items-center gap-1 text-sm font-medium",
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

          {whatThisContractIs && (
            <div
              data-testid="card-what-this-is"
              className="mt-1.5 flex items-start gap-1.5 border-t border-[var(--border-subtle)] pt-1.5 text-sm leading-5 text-[var(--text-muted)]"
            >
              <FileText className="w-3 h-3 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{whatThisContractIs}</span>
            </div>
          )}

          {showNotesPreview && notePreview && (
            <div
              data-testid="card-notes-preview"
              className="mt-1.5 rounded-md border border-[var(--chosen-border)] bg-[var(--chosen-bg)] px-2.5 py-2"
            >
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--chosen)]">
                <FileText className="w-3 h-3" />
                Analyst Summary
              </div>
              <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)] whitespace-pre-wrap line-clamp-4">
                {notePreview}
              </p>
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

      {onArchive && (
        <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            data-testid={`kanban-card-archive-${contract.id}`}
            onClick={() => onArchive(contract.id)}
            disabled={archiveBusy}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <Archive className="w-3.5 h-3.5" />
            {archiveBusy ? "Archiving…" : "Archive"}
          </button>
        </div>
      )}
    </div>
  );
}
