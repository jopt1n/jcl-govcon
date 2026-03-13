// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
  };
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => null } },
}));

import { KanbanCard, type ContractCard } from "@/components/kanban/card";

function makeContract(overrides: Partial<ContractCard> = {}): ContractCard {
  return {
    id: "test-uuid-123",
    title: "Test Contract Title",
    agency: "Department of Testing",
    awardCeiling: "500000",
    responseDeadline: new Date(Date.now() + 10 * 86400000).toISOString(),
    noticeType: "Solicitation",
    classification: "GOOD",
    aiReasoning: "This is a great opportunity for AI work",
    status: "IDENTIFIED",
    ...overrides,
  };
}

describe("KanbanCard", () => {
  it("renders title text", () => {
    render(<KanbanCard contract={makeContract()} />);
    expect(screen.getByText("Test Contract Title")).toBeDefined();
  });

  it("title links to /contracts/{id}", () => {
    render(<KanbanCard contract={makeContract()} />);
    const link = screen.getByText("Test Contract Title").closest("a");
    expect(link).toBeDefined();
    expect(link?.getAttribute("href")).toBe("/contracts/test-uuid-123");
  });

  it("displays agency when provided", () => {
    render(<KanbanCard contract={makeContract()} />);
    expect(screen.getByText("Department of Testing")).toBeDefined();
  });

  it("hides agency when null", () => {
    render(<KanbanCard contract={makeContract({ agency: null })} />);
    expect(screen.queryByText("Department of Testing")).toBeNull();
  });

  it("formats millions for award ceiling (1500000 -> $1.5M)", () => {
    render(
      <KanbanCard contract={makeContract({ awardCeiling: "1500000" })} />
    );
    expect(screen.getByText("$1.5M")).toBeDefined();
  });

  it("formats thousands for award ceiling (75000 -> $75K)", () => {
    render(<KanbanCard contract={makeContract({ awardCeiling: "75000" })} />);
    expect(screen.getByText("$75K")).toBeDefined();
  });

  it('shows "N/A" when award ceiling is null', () => {
    render(
      <KanbanCard contract={makeContract({ awardCeiling: null })} />
    );
    expect(screen.getByText("N/A")).toBeDefined();
  });

  it("shows notice type badge when provided", () => {
    render(<KanbanCard contract={makeContract()} />);
    expect(screen.getByText("Solicitation")).toBeDefined();
  });

  it("shows AI reasoning when provided", () => {
    render(<KanbanCard contract={makeContract()} />);
    expect(
      screen.getByText("This is a great opportunity for AI work")
    ).toBeDefined();
  });

  it("hides AI reasoning when null", () => {
    render(
      <KanbanCard contract={makeContract({ aiReasoning: null })} />
    );
    expect(
      screen.queryByText("This is a great opportunity for AI work")
    ).toBeNull();
  });
});
