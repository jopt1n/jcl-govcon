"use client";

import { format, parseISO } from "date-fns";
import { ExternalLink, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CASH_BURDENS,
  PURSUIT_OUTCOMES,
  PURSUIT_STAGES,
  type CashBurden,
  type PursuitOutcome,
  type PursuitStage,
} from "@/lib/pursuits/types";
import {
  ContactEditor,
  type PursuitContact,
} from "./contact-editor";
import {
  ActivityTimeline,
  type PursuitInteraction,
} from "./activity-timeline";
import {
  DocumentMetadataList,
  type PursuitDocument,
} from "./document-metadata-list";

export type PursuitDetail = {
  pursuit: {
    id: string;
    title: string;
    agency: string | null;
    solicitationNumber: string | null;
    noticeType: string | null;
    classification: string | null;
    responseDeadline: string | null;
    samUrl: string | null;
    stage: PursuitStage;
    outcome: PursuitOutcome | null;
    nextAction: string | null;
    nextActionDueAt: string | null;
    contractType: string;
    cashBurden: CashBurden;
    contactStatus: string;
    internalNotes: string | null;
  };
  contacts: PursuitContact[];
  interactions: PursuitInteraction[];
  documents: PursuitDocument[];
  stageHistory: Array<{
    id: string;
    fromStage: string | null;
    toStage: string | null;
    fromOutcome: string | null;
    toOutcome: string | null;
    note: string | null;
    changedAt: string;
  }>;
};

type Draft = {
  stage: PursuitStage;
  outcome: PursuitOutcome | "";
  nextAction: string;
  nextActionDueAt: string;
  contractType: string;
  cashBurden: CashBurden;
  contactStatus: string;
  internalNotes: string;
};

function label(value: string | null): string {
  if (!value) return "None";
  return value
    .split("_")
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");
}

function datetimeLocal(value: string | null): string {
  if (!value) return "";
  try {
    const date = parseISO(value);
    return format(date, "yyyy-MM-dd'T'HH:mm");
  } catch {
    return "";
  }
}

function displayDate(value: string | null): string {
  if (!value) return "No deadline";
  try {
    return format(parseISO(value), "MMM d, yyyy h:mm a");
  } catch {
    return "Invalid date";
  }
}

export function PursuitDetailDrawer({
  detail,
  loading,
  onClose,
  onPatch,
  onCreateContact,
  onUpdateContact,
  onDeleteContact,
  onAddNote,
}: {
  detail: PursuitDetail | null;
  loading: boolean;
  onClose: () => void;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onCreateContact: (body: Record<string, unknown>) => Promise<void>;
  onUpdateContact: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onAddNote: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!detail) {
      setDraft(null);
      return;
    }
    setDraft({
      stage: detail.pursuit.stage,
      outcome: detail.pursuit.outcome ?? "",
      nextAction: detail.pursuit.nextAction ?? "",
      nextActionDueAt: datetimeLocal(detail.pursuit.nextActionDueAt),
      contractType: detail.pursuit.contractType,
      cashBurden: detail.pursuit.cashBurden,
      contactStatus: detail.pursuit.contactStatus,
      internalNotes: detail.pursuit.internalNotes ?? "",
    });
  }, [detail]);

  if (!detail && !loading) {
    return (
      <aside className="hidden xl:block xl:w-[420px] shrink-0 border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
        Select a pursuit to inspect the CRM record.
      </aside>
    );
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await onPatch({
        stage: draft.stage,
        outcome: draft.outcome || null,
        nextAction: draft.nextAction || null,
        nextActionDueAt: draft.nextActionDueAt
          ? new Date(draft.nextActionDueAt).toISOString()
          : null,
        contractType: draft.contractType || "UNKNOWN",
        cashBurden: draft.cashBurden,
        contactStatus: draft.contactStatus || "UNKNOWN",
        internalNotes: draft.internalNotes || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      data-testid="pursuit-detail-drawer"
      className="w-full shrink-0 border border-[var(--border)] bg-[var(--surface)] xl:w-[460px]"
    >
      {loading || !detail || !draft ? (
        <div className="p-4 text-sm text-[var(--text-muted)]">
          Loading pursuit...
        </div>
      ) : (
        <div className="max-h-[calc(100vh-120px)] overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-sm border border-[var(--pursuit-brass-border)] bg-[var(--pursuit-brass-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--pursuit-brass)]">
                    Pursuit
                  </span>
                  {detail.pursuit.outcome && (
                    <span className="rounded-sm border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                      {label(detail.pursuit.outcome)}
                    </span>
                  )}
                </div>
                <h2 className="line-clamp-3 text-base font-semibold leading-5 text-[var(--text-primary)]">
                  {detail.pursuit.title}
                </h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {detail.pursuit.agency ?? "Unknown agency"} /{" "}
                  {detail.pursuit.solicitationNumber ?? "No solicitation"}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                aria-label="Close detail drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-5 p-4">
            <section className="grid grid-cols-2 gap-2 text-xs">
              <Info label="Deadline" value={displayDate(detail.pursuit.responseDeadline)} />
              <Info label="Notice" value={detail.pursuit.noticeType ?? "Unknown"} />
              <Info label="Classification" value={detail.pursuit.classification ?? "Unknown"} />
              <Info label="Type" value={detail.pursuit.contractType} />
              {detail.pursuit.samUrl && (
                <a
                  href={detail.pursuit.samUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="col-span-2 inline-flex items-center gap-1 text-[var(--pursuit-brass)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View SAM.gov source
                </a>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Controls
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  label="Stage"
                  testId="pursuit-stage-select"
                  value={draft.stage}
                  onChange={(stage) =>
                    setDraft({ ...draft, stage: stage as PursuitStage })
                  }
                  options={PURSUIT_STAGES}
                />
                <Select
                  label="Outcome"
                  testId="pursuit-outcome-select"
                  value={draft.outcome}
                  onChange={(outcome) =>
                    setDraft({
                      ...draft,
                      outcome: outcome as PursuitOutcome | "",
                    })
                  }
                  options={PURSUIT_OUTCOMES}
                  allowEmpty={!detail.pursuit.outcome}
                />
                <Select
                  label="Cash"
                  value={draft.cashBurden}
                  onChange={(cashBurden) =>
                    setDraft({
                      ...draft,
                      cashBurden: cashBurden as CashBurden,
                    })
                  }
                  options={CASH_BURDENS}
                />
                <Field
                  label="Contact status"
                  value={draft.contactStatus}
                  onChange={(contactStatus) =>
                    setDraft({ ...draft, contactStatus })
                  }
                />
                <Field
                  label="Contract type"
                  value={draft.contractType}
                  onChange={(contractType) =>
                    setDraft({ ...draft, contractType })
                  }
                />
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                    Next due
                  </span>
                  <input
                    type="datetime-local"
                    value={draft.nextActionDueAt}
                    onChange={(e) =>
                      setDraft({ ...draft, nextActionDueAt: e.target.value })
                    }
                    className="w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                  />
                </label>
              </div>
              <label className="mt-2 block">
                <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                  Next action
                </span>
                <input
                  value={draft.nextAction}
                  onChange={(e) =>
                    setDraft({ ...draft, nextAction: e.target.value })
                  }
                  className="w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                />
              </label>
              <label className="mt-2 block">
                <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                  Vendor notes
                </span>
                <textarea
                  value={draft.internalNotes}
                  onChange={(e) =>
                    setDraft({ ...draft, internalNotes: e.target.value })
                  }
                  className="min-h-24 w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                />
              </label>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="mt-2 inline-flex items-center gap-1.5 border border-[var(--pursuit-brass-border)] bg-[var(--pursuit-brass-bg)] px-3 py-2 text-xs font-semibold text-[var(--pursuit-brass)] disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save pursuit"}
              </button>
            </section>

            <ContactEditor
              contacts={detail.contacts}
              onCreate={onCreateContact}
              onUpdate={onUpdateContact}
              onDelete={onDeleteContact}
            />
            <DocumentMetadataList documents={detail.documents} />
            <ActivityTimeline
              interactions={detail.interactions}
              onAddNote={onAddNote}
            />
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Stage history
              </h3>
              <div className="space-y-2">
                {detail.stageHistory.map((item) => (
                  <div
                    key={item.id}
                    className="border border-[var(--border-subtle)] bg-[var(--surface-alt)] p-2 text-xs text-[var(--text-secondary)]"
                  >
                    {label(item.fromStage)}
                    {" -> "}
                    {label(item.toStage)}
                    {item.toOutcome && ` / ${label(item.toOutcome)}`}
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {displayDate(item.changedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </aside>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--border-subtle)] bg-[var(--surface-alt)] p-2">
      <div className="text-[10px] uppercase text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[var(--text-secondary)]">{value}</div>
    </div>
  );
}

function Field({
  label: fieldLabel,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
        {fieldLabel}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
      />
    </label>
  );
}

function Select({
  label: selectLabel,
  testId,
  value,
  onChange,
  options,
  allowEmpty,
}: {
  label: string;
  testId?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  allowEmpty?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--text-muted)]">
        {selectLabel}
      </span>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
      >
        {allowEmpty && <option value="">None</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {label(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
