"use client";

import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,

  Pause,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  Brain,
  FileText,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CrawlData {
  crawl: {
    status: string;
    totalFound: number;
    processed: number;
    classified: number;
    startedAt: string;
    updatedAt: string;
  } | null;
  batchJob: {
    status: string;
    contractsCount: number;
    submittedAt: string;
    completedAt: string | null;
  } | null;
  contracts: {
    total: number;
    good: number;
    maybe: number;
    discard: number;
    pending: number;
  };
  apiUsage?: {
    searchCalls: number;
    docFetches: number;
    dailyLimit: number;
    remaining: number;
  };
  pipeline?: {
    totalIngested: number;
    pendingClassification: number;
    classified: number;
    goodCount: number;
    maybeCount: number;
    discardCount: number;
    descriptionsFetched: number;
  };
}

type PipelineAction =
  | "crawl-start"
  | "classify-metadata"
  | "fetch-descriptions"
  | "reclassify";

const PHASES: {
  key: PipelineAction;
  label: string;
  icon: typeof Download;
}[] = [
  { key: "crawl-start", label: "Crawl Metadata", icon: Download },
  { key: "classify-metadata", label: "Classify (Meta)", icon: Brain },
  { key: "fetch-descriptions", label: "Fetch Descriptions", icon: FileText },
  { key: "reclassify", label: "Re-classify", icon: RotateCcw },
];

export function CrawlStatus() {
  const [data, setData] = useState<CrawlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<PipelineAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline?action=crawl-status");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError("Could not load crawl status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function handlePipelineAction(action: PipelineAction) {
    const phase = PHASES.find((p) => p.key === action);
    if (!phase) return;

    setRunningAction(action);
    try {
      await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchStatus();
    } catch {
      setError(`Failed to start ${phase.label}`);
    } finally {
      setRunningAction(null);
    }
  }

  async function handlePause() {
    setRunningAction("crawl-start");
    try {
      await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "crawl-pause" }),
      });
      await fetchStatus();
    } catch {
      setError("Failed to pause crawl");
    } finally {
      setRunningAction(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-4 animate-pulse">
        <div className="h-4 bg-[var(--border-subtle)] rounded w-32 mb-3" />
        <div className="h-3 bg-[var(--border-subtle)] rounded w-full mb-2" />
        <div className="h-3 bg-[var(--border-subtle)] rounded w-3/4" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-4">
        <div className="flex items-center gap-2 text-[var(--urgent)] text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  const crawl = data?.crawl;
  const contractCounts = data?.contracts;
  const apiUsage = data?.apiUsage;
  const pipeline = data?.pipeline;
  const isRunning = crawl?.status === "RUNNING";
  const progress =
    crawl && crawl.totalFound > 0
      ? Math.round((crawl.processed / crawl.totalFound) * 100)
      : 0;

  const apiUsagePercent = apiUsage
    ? Math.round((apiUsage.searchCalls / apiUsage.dailyLimit) * 100)
    : 0;

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]"
        >
          <RefreshCw
            className={cn("w-4 h-4", isRunning && "animate-spin text-[var(--accent)]")}
          />
          Pipeline Status
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", collapsed && "-rotate-90")} />
        </button>
        <div className="flex items-center gap-1">
          {isRunning && (
            <button
              onClick={handlePause}
              disabled={runningAction !== null}
              className="p-1.5 rounded hover:bg-amber-500/10 text-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Pause crawl"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* API Budget Bar */}
          {apiUsage && (
            <div>
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>SAM.gov API Budget</span>
                <span>
                  {apiUsage.searchCalls} search + {apiUsage.docFetches} doc / {apiUsage.dailyLimit} limit
                </span>
              </div>
              <div className="w-full bg-[var(--border-subtle)] rounded-full h-1.5">
                <div
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    apiUsagePercent > 90
                      ? "bg-[var(--urgent)]"
                      : apiUsagePercent > 70
                        ? "bg-[var(--maybe)]"
                        : "bg-[var(--good)]"
                  )}
                  style={{ width: `${Math.min(apiUsagePercent, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Crawl Progress */}
          {crawl && (
            <div>
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>
                  {crawl.processed.toLocaleString()} / {crawl.totalFound.toLocaleString()} ingested
                </span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-[var(--border-subtle)] rounded-full h-2">
                <div
                  className={cn(
                    "h-2 rounded-full transition-all",
                    isRunning ? "bg-[var(--accent)]" : "bg-[var(--good)]"
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {crawl.classified.toLocaleString()} classified
                {crawl.status === "COMPLETE" && (
                  <CheckCircle2 className="w-3 h-3 inline ml-1 text-[var(--good)]" />
                )}
              </div>
            </div>
          )}

          {/* Pipeline Phase Buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            {PHASES.map((phase) => {
              const Icon = phase.icon;
              const isActive = runningAction === phase.key;
              return (
                <button
                  key={phase.key}
                  onClick={() => handlePipelineAction(phase.key)}
                  disabled={runningAction !== null}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors",
                    "border border-[var(--border)] hover:bg-[var(--surface-alt)] disabled:opacity-40 disabled:cursor-not-allowed",
                    "text-[var(--text-secondary)]",
                    isActive && "bg-[var(--accent-10)] border-[var(--accent-30)]"
                  )}
                >
                  {isActive ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                  ) : (
                    <Icon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  )}
                  {phase.label}
                </button>
              );
            })}
          </div>

          {/* Pipeline Stats */}
          {pipeline && (
            <div className="text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-2 space-y-0.5">
              <div className="flex justify-between">
                <span>Descriptions fetched</span>
                <span className="font-medium">{pipeline.descriptionsFetched}</span>
              </div>
              <div className="flex justify-between">
                <span>Pending classification</span>
                <span className="font-medium">{pipeline.pendingClassification}</span>
              </div>
            </div>
          )}

          {/* Classification Counts */}
          {contractCounts && (
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-emerald-500/10 rounded p-1.5">
                <div className="text-sm font-bold text-[var(--good)]">{contractCounts.good}</div>
                <div className="text-[10px] text-[var(--good)]">GOOD</div>
              </div>
              <div className="bg-amber-500/10 rounded p-1.5">
                <div className="text-sm font-bold text-[var(--maybe)]">{contractCounts.maybe}</div>
                <div className="text-[10px] text-[var(--maybe)]">MAYBE</div>
              </div>
              <div className="bg-slate-500/10 rounded p-1.5">
                <div className="text-sm font-bold text-[var(--discard)]">{contractCounts.discard}</div>
                <div className="text-[10px] text-[var(--discard)]">DISCARD</div>
              </div>
              <div className="bg-blue-500/10 rounded p-1.5">
                <div className="text-sm font-bold text-[var(--pending)]">{contractCounts.pending}</div>
                <div className="text-[10px] text-[var(--pending)]">PENDING</div>
              </div>
            </div>
          )}

          {/* Batch job */}
          {data?.batchJob && (
            <div className="text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-2">
              Batch: {data.batchJob.status} ({data.batchJob.contractsCount} contracts)
            </div>
          )}
        </>
      )}
    </div>
  );
}
