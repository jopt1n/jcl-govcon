// @vitest-environment jsdom
import { vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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
    FileText: icon,
    Search: icon,
    Filter: icon,
    X: icon,
    ArrowLeft: icon,
    Calendar: icon,
    ExternalLink: icon,
    Tag: icon,
    Hash: icon,
    Loader2: icon,
    RefreshCw: icon,
    Star: icon,
    Archive: icon,
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
    summary: "One-sentence summary of what this contract is asking for.",
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

  it("shows the full 'what this contract is' description from actionPlan", () => {
    const description =
      "This contract is for enterprise software modernization across multiple legacy systems, including migration planning, delivery, and training for the agency teams.";
    render(
      <KanbanCard
        contract={makeContract({
          actionPlan: JSON.stringify({ description }),
          summary: "Short fallback summary",
        })}
      />,
    );

    expect(screen.getByTestId("card-what-this-is")).toBeDefined();
    expect(
      screen.getByText(description),
    ).toBeDefined();
    expect(screen.queryByText("Short fallback summary")).toBeNull();
  });

  it("falls back to summary when actionPlan.description is unavailable", () => {
    render(<KanbanCard contract={makeContract()} />);
    expect(
      screen.getByText("One-sentence summary of what this contract is asking for."),
    ).toBeDefined();
  });

  it("does not fall back to aiReasoning when summary and actionPlan are missing", () => {
    render(
      <KanbanCard
        contract={makeContract({
          summary: null,
          actionPlan: null,
        })}
      />,
    );
    expect(screen.queryByTestId("card-what-this-is")).toBeNull();
    expect(
      screen.queryByText("This is a great opportunity for AI work"),
    ).toBeNull();
  });

  it("renders notes preview only when enabled", () => {
    render(
      <KanbanCard
        contract={makeContract({ notes: "Prime with a compliant mobile sub." })}
        showNotesPreview={true}
      />,
    );

    expect(screen.getByTestId("card-notes-preview")).toBeDefined();
    expect(
      screen.getByText("Prime with a compliant mobile sub."),
    ).toBeDefined();
  });

  it("does not render notes preview when disabled", () => {
    render(
      <KanbanCard
        contract={makeContract({ notes: "Stored note" })}
        showNotesPreview={false}
      />,
    );

    expect(screen.queryByTestId("card-notes-preview")).toBeNull();
    expect(screen.queryByText("Stored note")).toBeNull();
  });

  it("does not render archive action by default", () => {
    render(<KanbanCard contract={makeContract()} />);
    expect(screen.queryByTestId("kanban-card-archive-test-uuid-123")).toBeNull();
  });

  it("renders archive action when provided and calls the handler", () => {
    const onArchive = vi.fn();
    render(<KanbanCard contract={makeContract()} onArchive={onArchive} />);

    fireEvent.click(screen.getByTestId("kanban-card-archive-test-uuid-123"));

    expect(onArchive).toHaveBeenCalledWith("test-uuid-123");
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
    const card = screen.getByTestId("kanban-card");
    expect(card.className).toContain("border-l-[4px]");
    expect(card.className).toContain("border-l-[var(--chosen)]");

    // Default border classes NOT present — this is the specificity guard.
    // If both sets leaked through, Tailwind would arbitrate by CSS order
    // and the behavior would depend on stylesheet layout. State-exclusive
    // rendering avoids that entirely.
    expect(card.className).not.toContain("border-l-[3px]");
    expect(card.className).not.toContain("border-l-[var(--good)]");
  });

  it("renders default 3px classification border when promoted is falsy", () => {
    // promoted omitted -> undefined, treated as false
    render(<KanbanCard contract={makeContract()} />);

    expect(screen.queryByTestId("chosen-star")).toBeNull();

    const card = screen.getByTestId("kanban-card");
    expect(card.className).toContain("border-l-[3px]");
    expect(card.className).toContain("border-l-[var(--good)]");

    // Gold override classes NOT present on non-promoted cards
    expect(card.className).not.toContain("border-l-[4px]");
    expect(card.className).not.toContain("border-l-[var(--chosen)]");
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
      const card = container.querySelector('[data-testid="kanban-card"]')!;
      expect(card.className).toContain("border-l-[var(--chosen)]");
      expect(card.className).not.toContain("border-l-[var(--maybe)]");
      expect(card.className).not.toContain("border-l-[var(--discard)]");
      unmount();
    }
  });
});
