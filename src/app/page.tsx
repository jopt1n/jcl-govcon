import { Suspense } from "react";
import { KanbanBoard } from "@/components/kanban/board";
import { CrawlStatus } from "@/components/crawl-status";
import { DashboardStats } from "@/components/dashboard-stats";

export default function DashboardPage() {
  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          Contract Pipeline
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Drag contracts between columns to reclassify. Click a card for
          details.
        </p>
      </div>
      <CrawlStatus />
      <DashboardStats />
      <Suspense fallback={null}>
        <KanbanBoard />
      </Suspense>
    </div>
  );
}
