/**
 * /admin/crawl-runs — read-only table of the last 30 crawl runs.
 *
 * Debug visibility for the weekly automated pipeline. Shows when each run
 * fired, how many contracts it found and classified, whether the Telegram
 * digest went out, and any error step.
 *
 * Server component — reads directly from the DB. No auth in v1 (personal
 * tool). Listed as a follow-up in the plan if this ever becomes multi-user.
 */

import { db } from "@/lib/db";
import { crawlRuns } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function fmtDurationMs(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

const statusColors: Record<string, string> = {
  running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  crawled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  classifying: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  succeeded: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  stalled: "bg-red-500/10 text-red-400 border-red-500/20",
};

export default async function CrawlRunsPage() {
  const rows = await db
    .select()
    .from(crawlRuns)
    .orderBy(desc(crawlRuns.createdAt))
    .limit(30);

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          Crawl Runs
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Last 30 weekly pipeline runs. Read-only.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)]">
          No crawl runs yet. The first weekly run will appear Sunday 03:00 UTC.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-xs">
            <thead className="bg-[var(--surface-alt)] text-[var(--text-secondary)] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Started</th>
                <th className="text-left px-3 py-2 font-semibold">Kind</th>
                <th className="text-left px-3 py-2 font-semibold">Window</th>
                <th className="text-right px-3 py-2 font-semibold">Found</th>
                <th className="text-right px-3 py-2 font-semibold">
                  Classified
                </th>
                <th className="text-left px-3 py-2 font-semibold">
                  Crawl Duration
                </th>
                <th className="text-left px-3 py-2 font-semibold">Batch</th>
                <th className="text-left px-3 py-2 font-semibold">Digest</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="text-left px-3 py-2 font-semibold">
                  Error Step
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--border-subtle)] text-[var(--text-primary)]"
                >
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {fmt(r.createdAt)}
                  </td>
                  <td className="px-3 py-2">{r.kind}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {fmt(r.windowStart)} → {fmt(r.windowEnd)}
                  </td>
                  <td className="px-3 py-2 text-right">{r.contractsFound}</td>
                  <td className="px-3 py-2 text-right">
                    {r.contractsClassified}
                  </td>
                  <td className="px-3 py-2">
                    {fmtDurationMs(r.crawlStartedAt, r.crawlFinishedAt)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {r.batchId
                      ? `${r.batchId.slice(0, 8)}… ${r.batchStatus ?? ""}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.digestSentAt ? fmt(r.digestSentAt) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded border font-medium ${
                        statusColors[r.status] ??
                        "bg-slate-500/10 text-slate-400 border-slate-500/20"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {r.errorStep ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.some((r) => r.error) && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
            Recent errors
          </h2>
          {rows
            .filter((r) => r.error)
            .slice(0, 5)
            .map((r) => (
              <div
                key={r.id}
                className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-xs"
              >
                <div className="font-mono text-[var(--text-muted)]">
                  {fmt(r.createdAt)} · {r.errorStep}
                </div>
                <div className="mt-1 text-[var(--text-primary)]">{r.error}</div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// Always fetch fresh
export const dynamic = "force-dynamic";
