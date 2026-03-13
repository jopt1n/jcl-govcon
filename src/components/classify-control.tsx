"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";

export function ClassifyControl() {
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  async function handleClassify() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/classify/metadata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_INGEST_SECRET ?? ""}`,
        },
        body: JSON.stringify({ limit }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error ?? "Classification failed", type: "error" });
      } else {
        setMessage({ text: data.message, type: "success" });
      }
    } catch {
      setMessage({ text: "Network error — could not reach server", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 flex flex-wrap items-center gap-3">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: "var(--accent)15" }}
      >
        <Sparkles className="w-4.5 h-4.5" style={{ color: "var(--accent)" }} />
      </div>
      <label className="text-sm font-medium text-[var(--text-primary)]">
        Classify
      </label>
      <input
        type="number"
        min={1}
        max={5000}
        value={limit}
        onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
        className="w-20 px-2 py-1.5 text-sm rounded-md border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
      />
      <button
        onClick={handleClassify}
        disabled={loading}
        className="px-3 py-1.5 text-sm font-medium rounded-md text-white disabled:opacity-60"
        style={{ backgroundColor: loading ? "var(--text-muted)" : "var(--accent)" }}
      >
        {loading ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Classifying…
          </span>
        ) : (
          `Classify ${limit} Contracts`
        )}
      </button>
      {message && (
        <p
          className="text-xs w-full mt-1"
          style={{ color: message.type === "success" ? "var(--good)" : "var(--urgent)" }}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
