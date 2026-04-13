// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
    Download: icon,
    Eye: icon,
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
    Shield: icon,
    AlertTriangle: icon,
    Target: icon,
    Zap: icon,
  };
});

import { ContractDetail } from "@/components/contract-detail";

const mockContract = {
  id: "test-uuid",
  noticeId: "N123",
  solicitationNumber: "SOL-001",
  title: "Test Contract",
  agency: "DOD",
  naicsCode: "541511",
  pscCode: "D302",
  noticeType: "Solicitation",
  setAsideType: "Small Business",
  awardCeiling: "500000",
  responseDeadline: "2026-04-01T00:00:00Z",
  postedDate: "2026-03-01T00:00:00Z",
  active: true,
  classification: "GOOD",
  aiReasoning: "Strong AI fit",
  descriptionText: "Build a web app",
  userOverride: false,
  status: "IDENTIFIED",
  notes: "Some notes",
  samUrl: "https://sam.gov/opp/123",
  resourceLinks: ["https://example.com/doc.pdf"],
  documentsAnalyzed: true,
  createdAt: "2026-03-01T00:00:00Z",
  updatedAt: "2026-03-01T00:00:00Z",
};

function mockFetchSuccess() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockContract),
  });
}

function mockFetchNotFound() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: () => Promise.resolve({ error: "Not found" }),
  });
}

describe("ContractDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    render(<ContractDetail contractId="test-uuid" />);
    // Loader2 is mocked as a span; the loading wrapper has a flex class
    const container = document.querySelector(
      ".flex.items-center.justify-center",
    );
    expect(container).toBeDefined();
    expect(container).not.toBeNull();
  });

  it("fetches and displays contract on mount", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByText("Test Contract")).toBeDefined();
    });
    expect(global.fetch).toHaveBeenCalledWith("/api/contracts/test-uuid");
  });

  it("shows not-found state for missing contract", async () => {
    mockFetchNotFound();
    render(<ContractDetail contractId="missing-id" />);
    await waitFor(() => {
      expect(screen.getByText("Contract not found")).toBeDefined();
    });
  });

  it("displays title", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByText("Test Contract")).toBeDefined();
    });
  });

  it("shows classification badge", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      // The badge contains "GOOD" - find it by the badge styling
      const badges = screen.getAllByText("GOOD");
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows AI reasoning section", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByText("AI Reasoning")).toBeDefined();
      expect(screen.getByText("Strong AI fit")).toBeDefined();
    });
  });

  it("classification buttons render for GOOD/MAYBE/DISCARD", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByText("Classification")).toBeDefined();
    });
    expect(screen.getByRole("button", { name: "GOOD" })).toBeDefined();
    expect(screen.getByRole("button", { name: "MAYBE" })).toBeDefined();
    expect(screen.getByRole("button", { name: "DISCARD" })).toBeDefined();
  });

  it("status dropdown visible only for GOOD classification", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByText("Status")).toBeDefined();
    });
    const statusSelect = screen.getByDisplayValue("IDENTIFIED");
    expect(statusSelect).toBeDefined();
  });

  it("notes textarea renders with initial value", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(
        "Add notes about this contract...",
      );
      expect(textarea).toBeDefined();
      expect((textarea as HTMLTextAreaElement).value).toBe("Some notes");
    });
  });

  it("SAM.gov link renders", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      const link = screen.getByText("View on SAM.gov");
      expect(link).toBeDefined();
      expect(link.closest("a")?.getAttribute("href")).toBe(
        "https://sam.gov/opp/123",
      );
    });
  });
});
