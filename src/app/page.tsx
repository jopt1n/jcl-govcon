import { KanbanBoard } from "@/components/kanban/board";
import { CrawlStatus } from "@/components/crawl-status";
import { DashboardStats } from "@/components/dashboard-stats";
import { ClassifyControl } from "@/components/classify-control";

export default function DashboardPage() {
  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Contract Pipeline</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Drag contracts between columns to reclassify. Click a card for details.
        </p>
      </div>
      <CrawlStatus />
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="flex-1">
          <DashboardStats />
        </div>
        <div className="lg:w-80 shrink-0">
          <ClassifyControl />
        </div>
      </div>
      <KanbanBoard />
    </div>
  );
}
