import { AnalyticsDashboard } from "@/components/analytics-dashboard";

export default function AnalyticsPage() {
  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Analytics</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Contract pipeline insights and classification metrics.
        </p>
      </div>
      <AnalyticsDashboard />
    </div>
  );
}
