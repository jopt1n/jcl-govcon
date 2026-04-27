"use client";

import { Filter } from "lucide-react";
import {
  CASH_BURDENS,
  PURSUIT_OUTCOMES,
  PURSUIT_STAGES,
  type CashBurden,
  type DeadlineFilter,
  type PursuitOutcome,
  type PursuitStage,
} from "@/lib/pursuits/types";

export type PursuitFilters = {
  stage: PursuitStage | "";
  outcome: PursuitOutcome | "";
  includeHistory: boolean;
  cashBurden: CashBurden | "";
  deadline: DeadlineFilter | "";
  contractType: string;
  contactStatus: string;
  search: string;
};

type Props = {
  filters: PursuitFilters;
  onChange: (filters: PursuitFilters) => void;
};

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");
}

function update<K extends keyof PursuitFilters>(
  filters: PursuitFilters,
  key: K,
  value: PursuitFilters[K],
): PursuitFilters {
  return { ...filters, [key]: value };
}

export function PursuitFilterRail({ filters, onChange }: Props) {
  return (
    <aside className="w-full lg:w-64 shrink-0 border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        <Filter className="h-3.5 w-3.5 text-[var(--pursuit-brass)]" />
        Filters
      </div>
      <div className="space-y-3 p-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
            Search
          </span>
          <input
            value={filters.search}
            onChange={(e) => onChange(update(filters, "search", e.target.value))}
            className="w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--pursuit-brass)]"
            placeholder="Title, agency, solicitation"
          />
        </label>

        <Select
          label="Stage"
          value={filters.stage}
          onChange={(value) =>
            onChange(update(filters, "stage", value as PursuitStage | ""))
          }
          options={PURSUIT_STAGES.map((value) => ({
            value,
            label: label(value),
          }))}
        />

        <Select
          label="Cash burden"
          value={filters.cashBurden}
          onChange={(value) =>
            onChange(update(filters, "cashBurden", value as CashBurden | ""))
          }
          options={CASH_BURDENS.map((value) => ({ value, label: label(value) }))}
        />

        <Select
          label="Deadline"
          value={filters.deadline}
          onChange={(value) =>
            onChange(update(filters, "deadline", value as DeadlineFilter | ""))
          }
          options={[
            { value: "overdue", label: "Overdue" },
            { value: "week", label: "Next 7 days" },
            { value: "month", label: "Next 30 days" },
            { value: "none", label: "No deadline" },
          ]}
        />

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
            Contract type
          </span>
          <input
            value={filters.contractType}
            onChange={(e) =>
              onChange(update(filters, "contractType", e.target.value))
            }
            className="w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--pursuit-brass)]"
            placeholder="SUPPLIES_RESELLER"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
            Contact status
          </span>
          <input
            value={filters.contactStatus}
            onChange={(e) =>
              onChange(update(filters, "contactStatus", e.target.value))
            }
            className="w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--pursuit-brass)]"
            placeholder="UNKNOWN"
          />
        </label>

        <Select
          label="Outcome"
          value={filters.outcome}
          onChange={(value) =>
            onChange(update(filters, "outcome", value as PursuitOutcome | ""))
          }
          options={PURSUIT_OUTCOMES.map((value) => ({
            value,
            label: label(value),
          }))}
        />

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={filters.includeHistory}
            onChange={(e) =>
              onChange(update(filters, "includeHistory", e.target.checked))
            }
            className="h-4 w-4 accent-[var(--pursuit-brass)]"
          />
          Show history
        </label>
      </div>
    </aside>
  );
}

function Select({
  label: selectLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
        {selectLabel}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--pursuit-brass)]"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
