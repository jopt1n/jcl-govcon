"use client";

import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";
import { BarChart3, TrendingUp, PieChart as PieChartIcon, Calendar } from "lucide-react";

interface AnalyticsData {
  classificationCounts: Record<string, number>;
  topAgencies: { agency: string; count: number }[];
  overrideRate: { total: number; overridden: number; rate: number };
  upcomingDeadlines: { date: string; count: number }[];
  contractsByWeek: { week: string; count: number }[];
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  GOOD: "#10b981",
  MAYBE: "#f59e0b",
  DISCARD: "#64748b",
  PENDING: "#3b82f6",
};

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
      <p className="text-sm font-medium text-[var(--text-secondary)]">{label}</p>
      <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">{value}</p>
      {subtitle && (
        <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function formatWeek(label: unknown) {
  const d = new Date(String(label));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDate(label: unknown) {
  const d = new Date(String(label));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function truncateAgency(name: string, max = 30) {
  if (!name) return "Unknown";
  return name.length > max ? name.slice(0, max) + "..." : name;
}

const tooltipStyle = {
  borderRadius: "8px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  color: "var(--text-primary)",
};

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load analytics");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
        Loading analytics...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--urgent)]">
        {error ?? "No data available"}
      </div>
    );
  }

  const pieData = Object.entries(data.classificationCounts).map(
    ([name, value]) => ({ name, value })
  );

  const totalContracts = Object.values(data.classificationCounts).reduce(
    (a, b) => a + b,
    0
  );

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Contracts" value={totalContracts} />
        <StatCard
          label="Good Fit"
          value={data.classificationCounts.GOOD ?? 0}
          subtitle={`${totalContracts > 0 ? Math.round(((data.classificationCounts.GOOD ?? 0) / totalContracts) * 100) : 0}% of total`}
        />
        <StatCard
          label="Pending Review"
          value={data.classificationCounts.PENDING ?? 0}
        />
        <StatCard
          label="AI Override Rate"
          value={`${data.overrideRate.rate}%`}
          subtitle={`${data.overrideRate.overridden} of ${data.overrideRate.total} classified`}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Classification donut chart — legend only, no inline labels */}
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChartIcon className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
              Classification Breakdown
            </h2>
          </div>
          {pieData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[280px] text-[var(--text-muted)]">
              <PieChartIcon className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-sm">No classification data yet</span>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {pieData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={CLASSIFICATION_COLORS[entry.name] ?? "#6b7280"}
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-xs text-[var(--text-secondary)]">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* Contracts per week line chart */}
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
              Contracts Added per Week
            </h2>
          </div>
          {data.contractsByWeek.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[280px] text-[var(--text-muted)]">
              <TrendingUp className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-sm">No data yet</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.contractsByWeek}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="week"
                  tickFormatter={formatWeek}
                  fontSize={12}
                  tick={{ fill: "var(--text-muted)" }}
                />
                <YAxis
                  allowDecimals={false}
                  fontSize={12}
                  tick={{ fill: "var(--text-muted)" }}
                />
                <Tooltip
                  labelFormatter={formatWeek}
                  contentStyle={tooltipStyle}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={{ fill: "var(--accent)", r: 4 }}
                  name="Contracts"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top agencies bar chart */}
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
              Top 10 Agencies
            </h2>
          </div>
          {data.topAgencies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[320px] text-[var(--text-muted)]">
              <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-sm">No agency data yet</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={data.topAgencies}
                layout="vertical"
                margin={{ left: 10, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  fontSize={12}
                  tick={{ fill: "var(--text-muted)" }}
                />
                <YAxis
                  type="category"
                  dataKey="agency"
                  width={200}
                  tickFormatter={(v: string) => truncateAgency(v, 32)}
                  fontSize={11}
                  tick={{ fill: "var(--text-muted)" }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                />
                <Bar
                  dataKey="count"
                  fill="var(--accent)"
                  radius={[0, 4, 4, 0]}
                  name="Contracts"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Upcoming deadlines bar chart */}
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
              Upcoming Deadlines (Next 30 Days)
            </h2>
          </div>
          {data.upcomingDeadlines.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[320px] text-[var(--text-muted)]">
              <Calendar className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-sm">No upcoming deadlines</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={data.upcomingDeadlines}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  fontSize={11}
                  tick={{ fill: "var(--text-muted)" }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  allowDecimals={false}
                  fontSize={12}
                  tick={{ fill: "var(--text-muted)" }}
                />
                <Tooltip
                  labelFormatter={formatDate}
                  contentStyle={tooltipStyle}
                />
                <Bar
                  dataKey="count"
                  fill="var(--maybe)"
                  radius={[4, 4, 0, 0]}
                  name="Deadlines"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
