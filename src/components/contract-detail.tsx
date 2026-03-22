"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  Building2,
  Calendar,
  DollarSign,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Brain,
  Tag,
  Hash,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { naicsDescription, pscDescription } from "@/lib/code-descriptions";
import Link from "next/link";

interface Contract {
  id: string;
  noticeId: string;
  solicitationNumber: string | null;
  title: string;
  agency: string | null;
  naicsCode: string | null;
  pscCode: string | null;
  noticeType: string | null;
  setAsideType: string | null;
  awardCeiling: string | null;
  responseDeadline: string | null;
  postedDate: string;
  active: boolean;
  classification: string;
  aiReasoning: string | null;
  descriptionText: string | null;
  userOverride: boolean;
  status: string | null;
  notes: string | null;
  samUrl: string;
  resourceLinks: string[] | null;
  documentsAnalyzed: boolean;
  createdAt: string;
  updatedAt: string;
}

const CLASSIFICATIONS = ["GOOD", "MAYBE", "DISCARD", "PENDING"] as const;
const STATUSES = ["IDENTIFIED", "PURSUING", "BID_SUBMITTED", "WON", "LOST"] as const;

const classificationColors: Record<string, string> = {
  GOOD: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  MAYBE: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  DISCARD: "bg-slate-500/10 text-slate-500 border-slate-500/30",
  PENDING: "bg-blue-500/10 text-blue-500 border-blue-500/30",
};

export function ContractDetail({ contractId }: { contractId: string }) {
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [reclassifying, setReclassifying] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<string | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>();

  const fetchContract = useCallback(async () => {
    try {
      const res = await fetch(`/api/contracts/${contractId}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setContract(data);
      setNotes(data.notes ?? "");
    } catch {
      setContract(null);
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    fetchContract();
  }, [fetchContract]);

  async function updateField(updates: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setContract(updated);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleNotesChange(value: string) {
    setNotes(value);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      updateField({ notes: value });
    }, 1000);
  }

  async function handleReclassify() {
    setReclassifying(true);
    try {
      await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "classify", contractIds: [contractId] }),
      });
      await fetchContract();
    } finally {
      setReclassifying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--text-secondary)]">Contract not found</p>
        <Link href="/" className="text-[var(--accent)] hover:underline text-sm mt-2 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <>
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to board
        </Link>

        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">{contract.title}</h1>
          <span
            className={cn(
              "px-2.5 py-1 text-xs font-semibold rounded-full border shrink-0",
              classificationColors[contract.classification] ?? classificationColors.PENDING
            )}
          >
            {contract.classification}
            {contract.userOverride && " (manual)"}
          </span>
        </div>
      </div>

      {/* AI Reasoning + Classify */}
      <div className="bg-[var(--accent)]/5 border border-[var(--accent)]/20 rounded-lg p-4">
        {contract.aiReasoning ? (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--accent)] mb-2">
              <Brain className="w-4 h-4" />
              AI Reasoning
            </div>
            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
              {contract.aiReasoning}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Brain className="w-4 h-4" />
            No AI reasoning yet — classify this contract to generate one.
          </div>
        )}
        <button
          onClick={handleReclassify}
          disabled={reclassifying}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--accent)]/30 text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3 h-3", reclassifying && "animate-spin")} />
          {reclassifying ? "Classifying…" : contract.aiReasoning ? "Re-classify" : "Classify with AI"}
        </button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Metadata */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MetaItem icon={Building2} label="Agency" value={contract.agency} />
            <MetaItem icon={Hash} label="Solicitation" value={contract.solicitationNumber} />
            <MetaItem icon={Tag} label="Notice Type" value={contract.noticeType} />
            <MetaItem icon={Tag} label="Set-Aside" value={contract.setAsideType} />
            <MetaItem
              icon={Hash}
              label="NAICS"
              value={contract.naicsCode}
              subtitle={naicsDescription(contract.naicsCode)}
            />
            <MetaItem
              icon={Hash}
              label="PSC"
              value={contract.pscCode}
              subtitle={pscDescription(contract.pscCode)}
            />
            <MetaItem
              icon={DollarSign}
              label="Award Ceiling"
              value={
                contract.awardCeiling
                  ? `$${parseFloat(contract.awardCeiling).toLocaleString()}`
                  : null
              }
            />
            <MetaItem
              icon={Calendar}
              label="Response Deadline"
              value={
                contract.responseDeadline
                  ? format(parseISO(contract.responseDeadline), "MMM d, yyyy 'at' h:mm a")
                  : null
              }
            />
            <MetaItem
              icon={Calendar}
              label="Posted"
              value={format(parseISO(contract.postedDate), "MMM d, yyyy")}
            />
            <MetaItem
              icon={FileText}
              label="Notice ID"
              value={contract.noticeId}
            />
          </div>

          {/* Classification & Status Controls */}
          <div className="flex gap-4 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                Classification
              </label>
              <select
                value={contract.classification}
                onChange={(e) =>
                  updateField({ classification: e.target.value, userOverride: true })
                }
                className="px-3 py-1.5 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {contract.classification === "GOOD" && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Status
                </label>
                <select
                  value={contract.status ?? "IDENTIFIED"}
                  onChange={(e) => updateField({ status: e.target.value })}
                  className="px-3 py-1.5 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {saving && (
              <div className="flex items-end pb-1.5">
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                </span>
              </div>
            )}
          </div>

          {/* SAM.gov Link */}
          <div>
            <a
              href={contract.samUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)]"
            >
              <ExternalLink className="w-4 h-4" />
              View on SAM.gov
            </a>
          </div>

          {/* Resource Links — proxy through our API for auth */}
          {contract.resourceLinks && contract.resourceLinks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Documents</h3>
              <div className="space-y-1">
                {contract.resourceLinks.filter(Boolean).map((link, i) => {
                  const viewUrl = `/api/documents/proxy?view=1&url=${encodeURIComponent(link)}`;
                  const downloadUrl = `/api/documents/proxy?url=${encodeURIComponent(link)}`;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <button
                        onClick={() => setViewingDoc(viewUrl)}
                        className="flex items-center gap-1.5 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
                      >
                        <Eye className="w-3 h-3" />
                        Document {i + 1}
                      </button>
                      <a
                        href={downloadUrl}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        title="Download"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Description + Notes */}
        <div className="space-y-4">
          {/* Description */}
          {contract.descriptionText && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Description</h3>
              <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 max-h-96 overflow-y-auto">
                {contract.descriptionText}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Add notes about this contract..."
              className="w-full h-32 px-3 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">Auto-saves after 1 second</p>
          </div>
        </div>
      </div>
    </div>

    {/* Document Viewer Modal */}
    {viewingDoc && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={() => setViewingDoc(null)}
      >
        <div
          className="relative w-[90vw] h-[85vh] bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Document Viewer</h3>
            <div className="flex items-center gap-2">
              <a
                href={viewingDoc}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <Download className="w-3 h-3" />
                Download
              </a>
              <button
                onClick={() => setViewingDoc(null)}
                className="p-1 rounded-md hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe
              src={viewingDoc}
              className="w-full h-full border-0"
              title="Document preview"
            />
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function MetaItem({
  icon: Icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
  subtitle?: string | null;
}) {
  return (
    <div className="flex items-start gap-2.5 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
      <Icon className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-xs text-[var(--text-muted)]">{label}</div>
        <div className="text-sm text-[var(--text-primary)] truncate">{value ?? "N/A"}</div>
        {subtitle && (
          <div className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{subtitle}</div>
        )}
      </div>
    </div>
  );
}
