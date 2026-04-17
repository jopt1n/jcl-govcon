"use client";

import { cn } from "@/lib/utils";

export type PostedWindow = "week" | "month" | "all";

export const NOTICE_TYPE_OPTIONS = [
  "Solicitation",
  "Combined Synopsis/Solicitation",
  "Presolicitation",
  "Sources Sought",
] as const;

const POSTED_WINDOW_OPTIONS: { value: PostedWindow; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

interface KanbanFilterChipsProps {
  noticeTypes: string[];
  onToggleNoticeType: (type: string) => void;
  postedWindow: PostedWindow;
  onPostedWindow: (window: PostedWindow) => void;
  qualifyingOnly: boolean;
  onToggleQualifying: () => void;
}

export function KanbanFilterChips({
  noticeTypes,
  onToggleNoticeType,
  postedWindow,
  onPostedWindow,
  qualifyingOnly,
  onToggleQualifying,
}: KanbanFilterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ChipGroup label="Notice">
        {NOTICE_TYPE_OPTIONS.map((type) => (
          <Chip
            key={type}
            active={noticeTypes.includes(type)}
            onClick={() => onToggleNoticeType(type)}
            label={type}
          />
        ))}
      </ChipGroup>

      <ChipGroup label="Posted">
        {POSTED_WINDOW_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            active={postedWindow === opt.value}
            onClick={() => onPostedWindow(opt.value)}
            label={opt.label}
          />
        ))}
      </ChipGroup>

      <ChipGroup label="Set-aside">
        <Chip
          active={qualifyingOnly}
          onClick={onToggleQualifying}
          label="Qualifying only"
        />
      </ChipGroup>
    </div>
  );
}

function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "text-xs font-medium px-2.5 py-1 rounded-full border transition-colors",
        active
          ? "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/30"
          : "bg-[var(--surface-alt)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]",
      )}
    >
      {label}
    </button>
  );
}
