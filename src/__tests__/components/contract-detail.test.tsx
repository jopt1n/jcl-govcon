// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("lucide-react", () => {
  // Pass through ALL props so tests can query by data-testid / aria-label.
  const icon = (props: any) => <span {...props} />;
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
    Archive: icon,
    Target: icon,
    Zap: icon,
    Star: icon,
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
  tags: [] as string[],
  promoted: false,
  watched: false,
  watchTargetId: null as string | null,
  watchStatus: null as string | null,
  watchLastCheckedAt: null as string | null,
  watchLastAlertedAt: null as string | null,
  // Typed as `string | null` so overrides in CHOSEN tests can supply an ISO
  // timestamp without TS narrowing the base type to literal null.
  promotedAt: null as string | null,
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
    mockPush.mockReset();
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

  it("pipeline status dropdown is always visible regardless of classification", async () => {
    mockFetchSuccess();
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByText("Pipeline Status")).toBeDefined();
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

  // ── CHOSEN tier (Commit 3) ──────────────────────────────────────────
  //
  // Contract detail surfaces the user-driven promotion: a Promote/Demote
  // toggle button, a CHOSEN pill in the header, and a top gold accent
  // border — all gated on `contract.promoted`. The button renders for
  // all classifications including DISCARD (promoting a DISCARD is the
  // user signaling "AI was wrong"; original label stays in the badge).

  function mockFetchContract(contract: typeof mockContract) {
    global.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          // Return the contract with the patched fields merged in.
          const body = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...contract, ...body }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(contract),
        });
      }) as typeof global.fetch;
  }

  function mockFetchContractWithWatchApis(initial: typeof mockContract) {
    let current = initial;
    global.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";

        if (url.startsWith("/api/watch-targets") && method === "POST") {
          current = {
            ...current,
            watched: true,
            watchTargetId: "watch-1",
            watchStatus: "MONITORING",
          };
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: "watch-1" }),
          });
        }

        if (url === "/api/watch-targets/watch-1" && method === "PATCH") {
          current = {
            ...current,
            watched: false,
            watchTargetId: null,
            watchStatus: null,
          };
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: "watch-1", active: false }),
          });
        }

        if (url === `/api/contracts/${current.id}` && method === "GET") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(current),
          });
        }

        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          current = { ...current, ...body };
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(current),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(current),
        });
      }) as typeof global.fetch;
  }

  it("shows Promote button (not Demote) when promoted=false", async () => {
    mockFetchContract({ ...mockContract, promoted: false });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("promote-toggle")).toBeDefined();
    });
    const btn = screen.getByTestId("promote-toggle");
    expect(btn.textContent).toContain("Promote");
    expect(btn.textContent).not.toContain("Demote");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    // No CHOSEN pill, no top accent
    expect(screen.queryByTestId("chosen-pill")).toBeNull();
    expect(screen.queryByTestId("chosen-top-accent")).toBeNull();
  });

  it("shows Demote button + CHOSEN pill + top accent when promoted=true", async () => {
    mockFetchContract({
      ...mockContract,
      promoted: true,
      promotedAt: "2026-04-18T12:00:00Z",
    });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("promote-toggle")).toBeDefined();
    });
    const btn = screen.getByTestId("promote-toggle");
    expect(btn.textContent).toContain("Demote");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    // Header pill + top accent visible
    expect(screen.getByTestId("chosen-pill")).toBeDefined();
    expect(screen.getByTestId("chosen-pill").textContent).toContain("CHOSEN");
    expect(screen.getByTestId("chosen-top-accent")).toBeDefined();
  });

  it("Promote button renders on DISCARD-classified contracts too", async () => {
    mockFetchContract({
      ...mockContract,
      classification: "DISCARD",
      promoted: false,
    });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("promote-toggle")).toBeDefined();
    });
    expect(screen.getByTestId("promote-toggle").textContent).toContain(
      "Promote",
    );
    // Classification badge still shows DISCARD — promote doesn't overwrite it
    expect(screen.getAllByText("DISCARD").length).toBeGreaterThanOrEqual(1);
  });

  it("clicking Promote PATCHes { promoted: true } to the contract endpoint", async () => {
    mockFetchContract({ ...mockContract, promoted: false });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("promote-toggle")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("promote-toggle"));

    await waitFor(() => {
      const patchCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          (args) =>
            typeof args[0] === "string" &&
            args[0].startsWith("/api/contracts/test-uuid") &&
            (args[1] as RequestInit | undefined)?.method === "PATCH",
        );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ promoted: true });
    });
  });

  it("clicking Demote PATCHes { promoted: false }", async () => {
    mockFetchContract({
      ...mockContract,
      promoted: true,
      promotedAt: "2026-04-18T12:00:00Z",
    });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("promote-toggle")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("promote-toggle"));

    await waitFor(() => {
      const patchCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          (args) => (args[1] as RequestInit | undefined)?.method === "PATCH",
        );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ promoted: false });
    });
  });

  it("shows Archive button when the contract is not manually archived", async () => {
    mockFetchContract({ ...mockContract, tags: [] });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("archive-toggle")).toBeDefined();
    });

    const btn = screen.getByTestId("archive-toggle");
    expect(btn.textContent).toContain("Archive");
    expect(btn.textContent).not.toContain("Unarchive");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("archive-pill")).toBeNull();
  });

  it("shows Unarchive button and ARCHIVED pill when ARCHIVED tag is present", async () => {
    mockFetchContract({ ...mockContract, tags: ["SBA", "ARCHIVED"] });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("archive-toggle")).toBeDefined();
    });

    const btn = screen.getByTestId("archive-toggle");
    expect(btn.textContent).toContain("Unarchive");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("archive-pill").textContent).toContain(
      "ARCHIVED",
    );
  });

  it("shows Watch button when the contract is not being watched", async () => {
    mockFetchContract({ ...mockContract, watched: false, watchTargetId: null });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("watch-toggle")).toBeDefined();
    });

    const btn = screen.getByTestId("watch-toggle");
    expect(btn.textContent).toContain("Watch");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("watch-pill")).toBeNull();
  });

  it("shows WATCHING pill and family link when the contract is watched", async () => {
    mockFetchContract({
      ...mockContract,
      watched: true,
      watchTargetId: "watch-1",
      watchStatus: "NEEDS_REVIEW",
      watchLastCheckedAt: "2026-04-22T09:00:00Z",
      watchLastAlertedAt: "2026-04-22T10:00:00Z",
    });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("watch-pill")).toBeDefined();
    });

    expect(screen.getByTestId("watch-status-card")).toBeDefined();
    expect(screen.getByTestId("watch-family-link").closest("a")?.href).toContain(
      "/watch/watch-1",
    );
  });

  it("clicking Watch POSTs to /api/watch-targets with the contract id", async () => {
    mockFetchContractWithWatchApis({
      ...mockContract,
      watched: false,
      watchTargetId: null,
    });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("watch-toggle")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("watch-toggle"));

    await waitFor(() => {
      const postCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          (args) =>
            args[0] === "/api/watch-targets" &&
            (args[1] as RequestInit | undefined)?.method === "POST",
        );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body).toEqual({ contractId: "test-uuid" });
    });
  });

  it("clicking Unwatch PATCHes active:false to the watch target", async () => {
    mockFetchContractWithWatchApis({
      ...mockContract,
      watched: true,
      watchTargetId: "watch-1",
      watchStatus: "MATCHED",
    });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("watch-toggle")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("watch-toggle"));

    await waitFor(() => {
      const patchCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          (args) =>
            args[0] === "/api/watch-targets/watch-1" &&
            (args[1] as RequestInit | undefined)?.method === "PATCH",
        );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ active: false });
    });
  });

  it("clicking Archive PATCHes { archived: true }", async () => {
    mockFetchContract({ ...mockContract, tags: [] });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("archive-toggle")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("archive-toggle"));

    await waitFor(() => {
      const patchCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          (args) =>
            typeof args[0] === "string" &&
            args[0].startsWith("/api/contracts/test-uuid") &&
            (args[1] as RequestInit | undefined)?.method === "PATCH",
        );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ archived: true });
    });
  });

  it("clicking Archive redirects back to the dashboard", async () => {
    mockFetchContract({ ...mockContract, tags: [] });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("archive-toggle")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("archive-toggle"));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });

  it("clicking Unarchive PATCHes { archived: false }", async () => {
    mockFetchContract({ ...mockContract, tags: ["ARCHIVED"] });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("archive-toggle")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("archive-toggle"));

    await waitFor(() => {
      const patchCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          (args) =>
            typeof args[0] === "string" &&
            args[0].startsWith("/api/contracts/test-uuid") &&
            (args[1] as RequestInit | undefined)?.method === "PATCH",
        );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ archived: false });
    });
  });

  it("clicking Unarchive does not redirect", async () => {
    mockFetchContract({ ...mockContract, tags: ["ARCHIVED"] });
    render(<ContractDetail contractId="test-uuid" />);
    await waitFor(() => {
      expect(screen.getByTestId("archive-toggle")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("archive-toggle"));

    await waitFor(() => {
      const patchCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          (args) =>
            typeof args[0] === "string" &&
            args[0].startsWith("/api/contracts/test-uuid") &&
            (args[1] as RequestInit | undefined)?.method === "PATCH",
        );
      expect(patchCall).toBeDefined();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
