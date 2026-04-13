"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
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
  Shield,
  AlertTriangle,
  Target,
  Zap,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { naicsDescription, pscDescription } from "@/lib/code-descriptions";
import Link from "next/link";

interface ActionPlan {
  description: string;
  implementationSummary: string[];
  deadline: string;
  bidRange: string;
  estimatedEffort: string;
  contractType: string | null;
  periodOfPerformance: string | null;
  numberOfAwards: string | null;
  naicsSizeStandard: string | null;
  placeOfPerformance: string | null;
  keyDates: Array<{ date: string; description: string }> | null;
  travelRequirements: { required: boolean; details: string };
  compliance: string[];
  risks: string[];
  positiveSignals: string[];
  lowBarrierEntry: boolean;
}

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
  actionPlan: string | null;
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
const STATUSES = [
  "IDENTIFIED",
  "PURSUING",
  "BID_SUBMITTED",
  "WON",
  "LOST",
] as const;

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
  const [pendingClassification, setPendingClassification] = useState<
    string | null
  >(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<string | null>(null);
  const [docMeta, setDocMeta] = useState<
    Record<string, { name: string; type: string }>
  >({});
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Fetch document when viewingDoc changes
  // DOCX: proxy returns JSON {html} → use srcdoc (no blob URL, no download dialog)
  // PDF: fetch as arrayBuffer → explicit Blob with MIME type → blob URL for iframe
  useEffect(() => {
    if (!viewingDoc) return;
    let cancelled = false;
    setDocLoading(true);
    setDocError(null);
    setBlobUrl(null);
    setDocHtml(null);

    fetch(viewingDoc)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
        const ct = res.headers.get("content-type") || "";

        if (ct.includes("application/json")) {
          // DOCX → proxy returned JSON with HTML string
          const data = await res.json();
          if (!cancelled) setDocHtml(data.html);
        } else {
          // PDF or other binary → create blob with explicit MIME type
          const buffer = await res.arrayBuffer();
          if (!cancelled) {
            const blob = new Blob([buffer], { type: ct || "application/pdf" });
            setBlobUrl(URL.createObjectURL(blob));
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setDocError(
          err instanceof Error ? err.message : "Failed to load document",
        );
      })
      .finally(() => {
        if (!cancelled) setDocLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewingDoc]);

  // Cleanup blob URL on change/unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  function closeDocViewer() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setDocHtml(null);
    setViewingDoc(null);
    setDocError(null);
    setDocLoading(false);
  }

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

  // Resolve document filenames from SAM.gov Content-Disposition headers
  useEffect(() => {
    if (!contract?.resourceLinks?.length) return;
    const links = contract.resourceLinks.filter(Boolean);
    if (links.length === 0) return;

    // Skip if already resolved for these links
    const allResolved = links.every((link) => docMeta[link]);
    if (allResolved) return;

    const extToLabel: Record<string, string> = {
      ".pdf": "PDF",
      ".docx": "Word",
      ".doc": "Word",
      ".xlsx": "Excel",
      ".xls": "Excel",
      ".csv": "CSV",
      ".txt": "Text",
      ".pptx": "PowerPoint",
      ".ppt": "PowerPoint",
    };

    Promise.all(
      links.map(async (link) => {
        if (docMeta[link]) return; // already resolved
        try {
          const proxyUrl = `/api/documents/proxy?url=${encodeURIComponent(link)}`;
          const res = await fetch(proxyUrl, { method: "HEAD" });
          const cd = res.headers.get("content-disposition") || "";
          const match = cd.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
          const rawName = match
            ? decodeURIComponent(match[1].replace(/\+/g, " ").replace(/"/g, ""))
            : null;
          const ext = rawName
            ? rawName.slice(rawName.lastIndexOf(".")).toLowerCase()
            : "";
          const fileType =
            extToLabel[ext] || ext.replace(".", "").toUpperCase() || "File";
          const displayName = rawName || `Document`;
          setDocMeta((prev) => ({
            ...prev,
            [link]: { name: displayName, type: fileType },
          }));
        } catch {
          setDocMeta((prev) => ({
            ...prev,
            [link]: { name: "Document", type: "File" },
          }));
        }
      }),
    );
  }, [contract?.resourceLinks, docMeta]);

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

  async function handleGenerateActionPlan() {
    setGeneratingPlan(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: "POST",
      });
      if (res.ok) {
        const updated = await res.json();
        setContract(updated);
      }
    } finally {
      setGeneratingPlan(false);
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
        <Link
          href="/"
          className="text-[var(--accent)] hover:underline text-sm mt-2 inline-block"
        >
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
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">
              {contract.title}
            </h1>
            <span
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-full border shrink-0",
                classificationColors[contract.classification] ??
                  classificationColors.PENDING,
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
            <RefreshCw
              className={cn("w-3 h-3", reclassifying && "animate-spin")}
            />
            {reclassifying
              ? "Classifying…"
              : contract.aiReasoning
                ? "Re-classify"
                : "Classify with AI"}
          </button>
        </div>

        {/* Action Plan */}
        <ActionPlanSection
          contract={contract}
          generating={generatingPlan}
          onGenerate={handleGenerateActionPlan}
        />

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Metadata */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MetaItem
                icon={Building2}
                label="Agency"
                value={contract.agency}
              />
              <MetaItem
                icon={Hash}
                label="Solicitation"
                value={contract.solicitationNumber}
              />
              <MetaItem
                icon={Tag}
                label="Notice Type"
                value={contract.noticeType}
              />
              <MetaItem
                icon={Tag}
                label="Set-Aside"
                value={contract.setAsideType}
              />
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
                    ? format(
                        parseISO(contract.responseDeadline),
                        "MMM d, yyyy 'at' h:mm a",
                      )
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
            <div className="flex gap-4 flex-wrap items-end">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Classification
                </label>
                <div className="flex gap-1">
                  {(["GOOD", "MAYBE", "DISCARD"] as const).map((c) => {
                    const selected =
                      (pendingClassification ?? contract.classification) === c;
                    const isPending =
                      pendingClassification === c &&
                      pendingClassification !== contract.classification;
                    return (
                      <button
                        key={c}
                        onClick={() => setPendingClassification(c)}
                        className={cn(
                          "px-3 py-1.5 text-xs font-medium rounded-lg border transition-all",
                          selected
                            ? classificationColors[c]
                            : "bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                          isPending && "ring-2 ring-[var(--accent)]",
                        )}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
              {pendingClassification &&
                pendingClassification !== contract.classification && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        updateField({
                          classification: pendingClassification,
                          userOverride: true,
                        });
                        setPendingClassification(null);
                      }}
                      disabled={saving}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Submit"}
                    </button>
                    <button
                      onClick={() => setPendingClassification(null)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      Cancel
                    </button>
                  </div>
                )}

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
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">
                  Documents
                </h3>
                <div className="space-y-1">
                  {contract.resourceLinks.filter(Boolean).map((link, i) => {
                    const viewUrl = `/api/documents/proxy?view=1&url=${encodeURIComponent(link)}`;
                    const downloadUrl = `/api/documents/proxy?url=${encodeURIComponent(link)}`;
                    const meta = docMeta[link];
                    const label = meta ? meta.name : `Document ${i + 1}`;
                    const badge = meta?.type;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <button
                          onClick={() => setViewingDoc(viewUrl)}
                          className="flex items-center gap-1.5 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          <span className="truncate max-w-[280px]">
                            {label}
                          </span>
                        </button>
                        {badge && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--surface-alt)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                            {badge}
                          </span>
                        )}
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
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">
                  Description
                </h3>
                <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 max-h-96 overflow-y-auto">
                  {contract.descriptionText}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">
                Notes
              </h3>
              <textarea
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Add notes about this contract..."
                className="w-full h-32 px-3 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Auto-saves after 1 second
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Document Viewer Modal */}
      {viewingDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closeDocViewer}
        >
          <div
            className="relative w-[90vw] h-[85vh] bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Document Viewer
              </h3>
              <div className="flex items-center gap-2">
                <a
                  href={viewingDoc.replace("view=1&", "")}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Download className="w-3 h-3" />
                  Download
                </a>
                <button
                  onClick={closeDocViewer}
                  className="p-1 rounded-md hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {docLoading && (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
                  <p className="text-sm text-[var(--text-muted)]">
                    Loading document...
                  </p>
                </div>
              )}
              {docError && (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <p className="text-sm text-red-400">{docError}</p>
                  <button
                    onClick={() => {
                      setViewingDoc(null);
                      setTimeout(() => setViewingDoc(viewingDoc), 0);
                    }}
                    className="px-3 py-1.5 text-xs rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Retry
                  </button>
                </div>
              )}
              {blobUrl && (
                <iframe
                  src={blobUrl}
                  className="w-full h-full border-0"
                  title="Document preview"
                />
              )}
              {docHtml && (
                <iframe
                  srcDoc={docHtml}
                  className="w-full h-full border-0"
                  title="Document preview"
                  sandbox="allow-same-origin"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActionPlanSection({
  contract,
  generating,
  onGenerate,
}: {
  contract: Contract;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (
    contract.classification !== "GOOD" &&
    contract.classification !== "MAYBE"
  ) {
    return null;
  }

  let plan: ActionPlan | null = null;
  if (contract.actionPlan) {
    try {
      plan = JSON.parse(contract.actionPlan);
    } catch {
      // Invalid JSON — show regenerate
    }
  }

  if (!plan) {
    return (
      <div className="relative bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-lg p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--accent)]/10 flex items-center justify-center">
            <Target className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              No Action Plan Yet
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Generate a strategic brief with bid range, implementation summary,
              and risks.
            </p>
          </div>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
          >
            <Zap className={cn("w-3.5 h-3.5", generating && "animate-pulse")} />
            {generating ? "Generating…" : "Generate Action Plan"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* ── Header with Regenerate ────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            Action Plan
          </span>
          {plan.lowBarrierEntry && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              LOW BARRIER
            </span>
          )}
        </div>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn("w-3 h-3", generating && "animate-spin")} />
          {generating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      {/* ── Key Metrics Strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-b border-[var(--border)]">
        <div className="px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-0.5">
            <Calendar className="w-3 h-3" /> Deadline
          </div>
          <p className="text-xs text-[var(--text-primary)] font-medium">
            {plan.deadline}
          </p>
        </div>
        <div className="px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-0.5">
            <DollarSign className="w-3 h-3" /> Bid Range
          </div>
          <p className="text-xs text-[var(--accent)] font-semibold">
            {plan.bidRange}
          </p>
        </div>
        <div className="px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-0.5">
            <Clock className="w-3 h-3" /> Effort
          </div>
          <p className="text-xs text-[var(--text-primary)] font-medium">
            {plan.estimatedEffort}
          </p>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* ── Description ───────────────────────────────────────────── */}
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
            What This Contract Is
          </h4>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            {plan.description}
          </p>
        </div>

        {/* ── Contract Details Grid ─────────────────────────────────── */}
        {(plan.contractType ||
          plan.periodOfPerformance ||
          plan.numberOfAwards ||
          plan.naicsSizeStandard ||
          plan.placeOfPerformance) && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
              Contract Details
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {plan.contractType && (
                <div className="p-2 bg-[var(--surface-alt)] border border-[var(--border)] rounded-md">
                  <div className="text-[10px] text-[var(--text-muted)] mb-0.5">
                    Type
                  </div>
                  <div className="text-xs text-[var(--text-primary)] font-medium">
                    {plan.contractType}
                  </div>
                </div>
              )}
              {plan.periodOfPerformance && (
                <div className="p-2 bg-[var(--surface-alt)] border border-[var(--border)] rounded-md">
                  <div className="text-[10px] text-[var(--text-muted)] mb-0.5">
                    Period
                  </div>
                  <div className="text-xs text-[var(--text-primary)] font-medium">
                    {plan.periodOfPerformance}
                  </div>
                </div>
              )}
              {plan.numberOfAwards && (
                <div className="p-2 bg-[var(--surface-alt)] border border-[var(--border)] rounded-md">
                  <div className="text-[10px] text-[var(--text-muted)] mb-0.5">
                    Awards
                  </div>
                  <div className="text-xs text-[var(--text-primary)] font-medium">
                    {plan.numberOfAwards}
                  </div>
                </div>
              )}
              {plan.naicsSizeStandard && (
                <div className="p-2 bg-[var(--surface-alt)] border border-[var(--border)] rounded-md">
                  <div className="text-[10px] text-[var(--text-muted)] mb-0.5">
                    Size Standard
                  </div>
                  <div className="text-xs text-[var(--text-primary)] font-medium">
                    {plan.naicsSizeStandard}
                  </div>
                </div>
              )}
              {plan.placeOfPerformance && (
                <div className="p-2 bg-[var(--surface-alt)] border border-[var(--border)] rounded-md col-span-2">
                  <div className="text-[10px] text-[var(--text-muted)] mb-0.5">
                    Place of Performance
                  </div>
                  <div className="text-xs text-[var(--text-primary)] font-medium">
                    {plan.placeOfPerformance}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Implementation Summary ───────────────────────────────── */}
        {plan.implementationSummary?.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
              Implementation Summary
            </h4>
            <div className="relative pl-4 border-l-2 border-[var(--border)] space-y-2">
              {plan.implementationSummary.map((item, i) => (
                <div key={i} className="relative">
                  <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-[var(--surface)] border-2 border-[var(--accent)]" />
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Key Dates ────────────────────────────────────────────── */}
        {plan.keyDates && plan.keyDates.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
              Key Dates
            </h4>
            <div className="space-y-1.5">
              {plan.keyDates.map((kd, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--accent)] font-mono shrink-0">
                    {kd.date}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {kd.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Travel Requirements ──────────────────────────────────── */}
        {plan.travelRequirements && (
          <div className="flex items-start gap-2 text-xs">
            <span
              className={cn(
                "px-1.5 py-0.5 rounded font-semibold shrink-0",
                plan.travelRequirements.required
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
              )}
            >
              {plan.travelRequirements.required
                ? "TRAVEL REQUIRED"
                : "NO TRAVEL"}
            </span>
            <span className="text-[var(--text-secondary)]">
              {plan.travelRequirements.details}
            </span>
          </div>
        )}

        {/* ── Positive Signals ─────────────────────────────────────── */}
        {plan.positiveSignals?.length > 0 && (
          <div className="p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-md">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-2">
              <Zap className="w-3 h-3" /> Positive Signals
            </div>
            <div className="space-y-1">
              {plan.positiveSignals.map((s, i) => (
                <p
                  key={i}
                  className="text-[11px] text-[var(--text-secondary)] leading-snug"
                >
                  {s}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* ── Compliance + Risks (Warning Strips) ───────────────────── */}
        {(plan.compliance?.length > 0 || plan.risks?.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {plan.compliance?.length > 0 && (
              <div className="p-3 bg-blue-500/5 border border-blue-500/15 rounded-md">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-blue-400 font-semibold mb-2">
                  <Shield className="w-3 h-3" /> Compliance Requirements
                </div>
                <div className="space-y-1">
                  {plan.compliance.map((c, i) => (
                    <p
                      key={i}
                      className="text-[11px] text-[var(--text-secondary)] leading-snug"
                    >
                      {c}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {plan.risks?.length > 0 && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-md">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-400 font-semibold mb-2">
                  <AlertTriangle className="w-3 h-3" /> Risks
                </div>
                <div className="space-y-1">
                  {plan.risks.map((r, i) => (
                    <p
                      key={i}
                      className="text-[11px] text-[var(--text-secondary)] leading-snug"
                    >
                      {r}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
        <div className="text-sm text-[var(--text-primary)] truncate">
          {value ?? "N/A"}
        </div>
        {subtitle && (
          <div className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
