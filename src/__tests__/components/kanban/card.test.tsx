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
  // Pass through ALL props (className, data-testid, aria-label, etc.) so
  // tests can target specific icons by data-testid when needed.
  const icon = (props: any) => <span {...props} />;
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
    Star: icon,
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
    render(<KanbanCard contract={makeContract({ awardCeiling: "1500000" })} />);
    expect(screen.getByText("$1.5M")).toBeDefined();
  });

  it("formats thousands for award ceiling (75000 -> $75K)", () => {
    render(<KanbanCard contract={makeContract({ awardCeiling: "75000" })} />);
    expect(screen.getByText("$75K")).toBeDefined();
  });

  it('shows "N/A" when award ceiling is null', () => {
    render(<KanbanCard contract={makeContract({ awardCeiling: null })} />);
    expect(screen.getByText("N/A")).toBeDefined();
  });

  it("shows notice type badge when provided", () => {
    render(<KanbanCard contract={makeContract()} />);
    expect(screen.getByText("Solicitation")).toBeDefined();
  });

  it("shows AI reasoning when provided", () => {
    render(<KanbanCard contract={makeContract()} />);
    expect(
      screen.getByText("This is a great opportunity for AI work"),
    ).toBeDefined();
  });

  it("hides AI reasoning when null", () => {
    render(<KanbanCard contract={makeContract({ aiReasoning: null })} />);
    expect(
      screen.queryByText("This is a great opportunity for AI work"),
    ).toBeNull();
  });

  // ── CHOSEN tier rendering (Commit 3) ────────────────────────────────
  //
  // Border-left styling is state-exclusive: when `promoted=true`, ONLY the
  // gold 4px classes are in the DOM. The default 3px + classification-color
  // classes must NOT also be present — otherwise Tailwind specificity/order
  // would determine which wins and could silently regress. Watchpoint 2
  // from the Commit 3 review calls for asserting the final computed styling,
  // not just "class present." These assertions verify exclusivity.

  it("renders gold left-border + star icon when promoted=true", () => {
    render(<KanbanCard contract={makeContract({ promoted: true })} />);

    // Star icon rendered next to the title
    expect(screen.getByTestId("chosen-star")).toBeDefined();

    // Gold border classes present
    const link = screen.getByText("Test Contract Title").closest("a")!;
    expect(link.className).toContain("border-l-[4px]");
    expect(link.className).toContain("border-l-[var(--chosen)]");

    // Default border classes NOT present — this is the specificity guard.
    // If both sets leaked through, Tailwind would arbitrate by CSS order
    // and the behavior would depend on stylesheet layout. State-exclusive
    // rendering avoids that entirely.
    expect(link.className).not.toContain("border-l-[3px]");
    expect(link.className).not.toContain("border-l-[var(--good)]");
  });

  it("renders default 3px classification border when promoted is falsy", () => {
    // promoted omitted -> undefined, treated as false
    render(<KanbanCard contract={makeContract()} />);

    expect(screen.queryByTestId("chosen-star")).toBeNull();

    const link = screen.getByText("Test Contract Title").closest("a")!;
    expect(link.className).toContain("border-l-[3px]");
    expect(link.className).toContain("border-l-[var(--good)]");

    // Gold override classes NOT present on non-promoted cards
    expect(link.className).not.toContain("border-l-[4px]");
    expect(link.className).not.toContain("border-l-[var(--chosen)]");
  });

  it("gold border wins on promoted MAYBE and DISCARD cards too", () => {
    // Cross-classification promote: user signals "AI was wrong about this
    // MAYBE/DISCARD — I want it". Gold overrides the underlying class color.
    for (const classification of ["MAYBE", "DISCARD"] as const) {
      const { container, unmount } = render(
        <KanbanCard
          contract={makeContract({ classification, promoted: true })}
        />,
      );
      const link = container.querySelector("a")!;
      expect(link.className).toContain("border-l-[var(--chosen)]");
      expect(link.className).not.toContain("border-l-[var(--maybe)]");
      expect(link.className).not.toContain("border-l-[var(--discard)]");
      unmount();
    }
  });
});
