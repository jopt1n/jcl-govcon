// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("lucide-react", () => {
  const icon = ({ className }: any) => <span className={className} />;
  return {
    Building2: icon,
    DollarSign: icon,
    Clock: icon,
    Brain: icon,
    Search: icon,
    Filter: icon,
    X: icon,
    ArrowLeft: icon,
    Calendar: icon,
    ExternalLink: icon,
    FileText: icon,
    Tag: icon,
    Hash: icon,
    Loader2: icon,
    RefreshCw: icon,
    Inbox: icon,
  };
});

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => (
    <div data-testid="dnd-context">{children}</div>
  ),
  DragOverlay: ({ children }: any) => (
    <div data-testid="drag-overlay">{children}</div>
  ),
  closestCorners: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  SortableContext: ({ children }: any) => <div>{children}</div>,
  verticalListSortingStrategy: {},
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => null } },
}));

import { KanbanBoard } from "@/components/kanban/board";

const emptyResponse = {
  data: [],
  pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
};

function makeMockFetch(responses?: Record<string, any>) {
  return vi.fn().mockImplementation((url: string) => {
    const classification = new URL(url, "http://localhost").searchParams.get(
      "classification"
    );
    const body = responses?.[classification ?? ""] ?? emptyResponse;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    });
  });
}

describe("KanbanBoard", () => {
  beforeEach(() => {
    global.fetch = makeMockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders three columns (GOOD, MAYBE, DISCARD)", async () => {
    render(<KanbanBoard />);
    await waitFor(() => {
      expect(screen.getByText("GOOD")).toBeDefined();
      expect(screen.getByText("MAYBE")).toBeDefined();
      expect(screen.getByText("DISCARD")).toBeDefined();
    });
  });

  it("fetches data on mount (4 fetch calls, one per column)", async () => {
    render(<KanbanBoard />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: any[]) => c[0]
    );
    expect(urls.some((u: string) => u.includes("classification=PENDING"))).toBe(
      true
    );
    expect(urls.some((u: string) => u.includes("classification=GOOD"))).toBe(
      true
    );
    expect(urls.some((u: string) => u.includes("classification=MAYBE"))).toBe(
      true
    );
    expect(
      urls.some((u: string) => u.includes("classification=DISCARD"))
    ).toBe(true);
  });

  it("shows search input", async () => {
    render(<KanbanBoard />);
    expect(
      screen.getByPlaceholderText("Search contracts...")
    ).toBeDefined();
  });

  it("shows filter button", async () => {
    render(<KanbanBoard />);
    expect(screen.getByText("Filters")).toBeDefined();
  });

  it("renders contracts in columns when data returned", async () => {
    const contractData = {
      data: [
        {
          id: "c1",
          title: "Alpha Contract",
          agency: "DOD",
          awardCeiling: "100000",
          responseDeadline: null,
          noticeType: null,
          classification: "GOOD",
          aiReasoning: null,
          status: "IDENTIFIED",
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    };

    global.fetch = makeMockFetch({ GOOD: contractData });
    render(<KanbanBoard />);

    await waitFor(() => {
      expect(screen.getByText("Alpha Contract")).toBeDefined();
    });
  });

  it("search form submission triggers re-fetch", async () => {
    render(<KanbanBoard />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    const input = screen.getByPlaceholderText("Search contracts...");
    const user = userEvent.setup();
    await user.type(input, "test query");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      // Initial 4 + 4 re-fetches after search
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(8);
    });
  });

  it("clear filters button appears when filters are active", async () => {
    render(<KanbanBoard />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    // Initially no clear button
    expect(screen.queryByText("Clear")).toBeNull();

    // Type search and submit
    const input = screen.getByPlaceholderText("Search contracts...");
    const user = userEvent.setup();
    await user.type(input, "something");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Clear")).toBeDefined();
    });
  });

  it("has DnD context wrapper", async () => {
    render(<KanbanBoard />);
    expect(screen.getByTestId("dnd-context")).toBeDefined();
  });
});
