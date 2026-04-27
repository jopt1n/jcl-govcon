"use client";

import { format, parseISO } from "date-fns";
import { ListChecks, Plus } from "lucide-react";
import { useState } from "react";

export type PursuitInteraction = {
  id: string;
  type: string;
  occurredAt: string;
  subject: string | null;
  body: string | null;
};

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");
}

function dateLabel(value: string): string {
  try {
    return format(parseISO(value), "MMM d, h:mm a");
  } catch {
    return value;
  }
}

export function ActivityTimeline({
  interactions,
  onAddNote,
}: {
  interactions: PursuitInteraction[];
  onAddNote: (body: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try {
      await onAddNote(note);
      setNote("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <ListChecks className="h-3.5 w-3.5 text-[var(--pursuit-brass)]" />
        Activity
      </h3>
      <form onSubmit={submit} className="mb-3 flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-w-0 flex-1 border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--pursuit-brass)]"
          placeholder="Add event note"
        />
        <button
          type="submit"
          disabled={saving || !note.trim()}
          className="inline-flex items-center gap-1 border border-[var(--pursuit-brass-border)] bg-[var(--pursuit-brass-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--pursuit-brass)] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </form>
      <div className="space-y-2">
        {interactions.length === 0 && (
          <div className="border border-dashed border-[var(--border)] p-3 text-sm text-[var(--text-muted)]">
            No pursuit activity yet.
          </div>
        )}
        {interactions.map((item) => (
          <div
            key={item.id}
            className="border-l-2 border-[var(--pursuit-brass-border)] bg-[var(--surface-alt)] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase text-[var(--text-secondary)]">
                {label(item.type)}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {dateLabel(item.occurredAt)}
              </span>
            </div>
            {item.subject && (
              <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">
                {item.subject}
              </div>
            )}
            {item.body && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
                {item.body}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
