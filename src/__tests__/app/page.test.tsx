// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/kanban/board", () => ({
  KanbanBoard: () => <div data-testid="kanban-board">KANBAN</div>,
}));

vi.mock("@/components/crawl-status", () => ({
  CrawlStatus: () => <div data-testid="crawl-status">PIPELINE STATUS</div>,
}));

import DashboardPage from "@/app/page";

describe("DashboardPage", () => {
  it("renders the kanban board before pipeline status", () => {
    render(<DashboardPage />);

    const board = screen.getByTestId("kanban-board");
    const status = screen.getByTestId("crawl-status");

    const children = Array.from(board.parentElement!.children);
    expect(children.indexOf(board)).toBeLessThan(children.indexOf(status));
  });
});
