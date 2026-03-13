"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, HelpCircle, Trash2 } from "lucide-react";

interface Stats {
  good: number;
  maybe: number;
  discard: number;
  pending: number;
}

export function DashboardStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/crawl/status")
      .then((res) => res.json())
      .then((data) => {
        const c = data.contracts ?? {};
        setStats({
          good: c.good ?? 0,
          maybe: c.maybe ?? 0,
          discard: c.discard ?? 0,
          pending: c.pending ?? 0,
        });
      })
      .catch(() => {});
  }, []);

  if (!stats) return null;

  const items = [
    { label: "Good Fit", value: stats.good, icon: CheckCircle2, color: "var(--good)" },
    { label: "Maybe — Needs Review", value: stats.maybe, icon: HelpCircle, color: "var(--maybe)" },
    { label: "Pending Classification", value: stats.pending, icon: Clock, color: "var(--pending)" },
    { label: "Discarded", value: stats.discard, icon: Trash2, color: "var(--discard)" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 flex items-center gap-3"
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${item.color}15` }}
            >
              <Icon className="w-4.5 h-4.5" style={{ color: item.color }} />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text-primary)]">
                {item.value.toLocaleString()}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{item.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
