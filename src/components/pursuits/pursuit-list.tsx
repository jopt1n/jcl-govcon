"use client";

import { format, parseISO } from "date-fns";
import { CalendarClock, CircleDollarSign, Contact, History } from "lucide-react";
import { cn } from "@/lib/utils";

export type PursuitListItem = {
  id: string;
  title: string;
  agency: string | null;
  solicitationNumber: string | null;
  noticeType: string | null;
  classification: string | null;
  responseDeadline: string | null;
  stage: string;
  outcome: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  contractType: string;
  cashBurden: string;
  contactStatus: string;
  promotedAt: string;
};

type Props = {
  pursuits: PursuitListItem[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
};

function label(value: string | null): string {
  if (!value) return "None";
  return value
    .split("_")
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");
}

function dateLabel(value: string | null): string {
  if (!value) return "No date";
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return "Invalid";
  }
}

export function PursuitList({
  pursuits,
  selectedId,
  loading,
  onSelect,
}: Props) {
  if (loading) {
    return (
      <div className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
        Loading pursuits...
      </div>
    );
  }

  if (pursuits.length === 0) {
    return (
      <div
        data-testid="pursuits-empty"
        className="border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center"
      >
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          No pursuits match these filters
        </div>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Promote a contract to create a pursuit, or show history to review
          archived and no-bid opportunities.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="pursuit-list-scroll"
      className="overflow-x-auto border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="grid min-w-[790px] grid-cols-[minmax(280px,1.5fr)_120px_120px_120px_130px] gap-0 border-b border-[var(--border)] bg-[var(--pursuit-ledger)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <div>Pursuit</div>
        <div>Stage</div>
        <div>Next</div>
        <div>Cash</div>
        <div>Contact</div>
      </div>
      <div className="max-h-[calc(100vh-230px)] min-w-[790px] overflow-y-auto">
        {pursuits.map((pursuit) => (
          <button
            key={pursuit.id}
            type="button"
            data-testid={`pursuit-row-${pursuit.id}`}
            onClick={() => onSelect(pursuit.id)}
            className={cn(
              "grid min-h-[88px] w-full grid-cols-[minmax(280px,1.5fr)_120px_120px_120px_130px] items-stretch border-b border-[var(--border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-alt)]",
              selectedId === pursuit.id &&
                "bg-[var(--pursuit-brass-bg)] outline outline-1 outline-[var(--pursuit-brass-border)]",
            )}
          >
            <div className="min-w-0 pr-3">
              <div className="flex items-center gap-2">
                <span className="rounded-sm border border-[var(--pursuit-brass-border)] bg-[var(--pursuit-brass-bg)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--pursuit-brass)]">
                  Pursuit
                </span>
                {pursuit.outcome && (
                  <span className="inline-flex items-center gap-1 rounded-sm border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                    <History className="h-3 w-3" />
                    {label(pursuit.outcome)}
                  </span>
                )}
              </div>
              <div className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-[var(--text-primary)]">
                {pursuit.title}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                <span>{pursuit.agency ?? "Unknown agency"}</span>
                <span>{pursuit.solicitationNumber ?? "No solicitation"}</span>
                <span>{pursuit.noticeType ?? "Unknown notice"}</span>
              </div>
            </div>
            <Cell>{label(pursuit.stage)}</Cell>
            <Cell icon={<CalendarClock className="h-3.5 w-3.5" />}>
              <span>{pursuit.nextAction || "Set next action"}</span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {dateLabel(pursuit.nextActionDueAt)}
              </span>
            </Cell>
            <Cell icon={<CircleDollarSign className="h-3.5 w-3.5" />}>
              {label(pursuit.cashBurden)}
            </Cell>
            <Cell icon={<Contact className="h-3.5 w-3.5" />}>
              {label(pursuit.contactStatus)}
            </Cell>
          </button>
        ))}
      </div>
    </div>
  );
}

function Cell({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1 border-l border-[var(--border-subtle)] px-3 text-xs text-[var(--text-secondary)]">
      <div className="flex min-w-0 items-center gap-1.5">
        {icon}
        <span className="truncate">{children}</span>
      </div>
    </div>
  );
}
