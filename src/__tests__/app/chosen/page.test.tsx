// @vitest-environment jsdom
import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("lucide-react", () => {
  const icon = (props: any) => <span {...props} />;
  return {
    AlertTriangle: icon,
    Archive: icon,
    Building2: icon,
    DollarSign: icon,
    Clock: icon,
    Brain: icon,
    FileText: icon,
    RefreshCw: icon,
    Star: icon,
  };
});

import ChosenPage from "@/app/chosen/page";

type PatchCall = { url: string; body: unknown; method: string };

function makeCard(
  id: string,
  title: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    title,
    agency: "Test Agency",
    awardCeiling: "100000",
    responseDeadline: null,
    noticeType: "Solicitation",
    classification: "GOOD",
    aiReasoning: null,
    summary: "Chosen contract summary",
    actionPlan: null,
    notes: null,
    status: "IDENTIFIED",
    promoted: true,
    tags: [],
    ...overrides,
  };
}

function makeFamily(
  familyId: string,
  currentId: string,
  title: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    familyId,
    decision: "PROMOTE",
    totalNotices: 1,
    needsReview: false,
    latestEventType: null,
    latestEventAt: null,
    current: makeCard(currentId, title),
    ...overrides,
  };
}

function installMockFetch(opts: {
  pages?: Record<number, unknown[]>;
  total?: number;
  rejectGet?: boolean;
  rejectPatch?: boolean;
}) {
  const patchCalls: PatchCall[] = [];
  const getCalls: string[] = [];

  global.fetch = vi
    .fn()
    .mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";

      if (method === "PATCH") {
        patchCalls.push({
          url,
          method,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        if (opts.rejectPatch) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "boom" }),
          };
        }
        return { ok: true, json: async () => ({ id: url.split("/").pop() }) };
      }

      if (opts.rejectGet) {
        getCalls.push(url);
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "boom" }),
        };
      }

      if (url.startsWith("/api/opportunity-families?")) {
        getCalls.push(url);
        const parsed = new URL(url, "http://localhost");
        const page = parseInt(parsed.searchParams.get("page") ?? "1", 10);
        const rows = opts.pages?.[page] ?? [];
        return {
          ok: true,
          json: async () => ({
            data: rows,
            pagination: {
              page,
              limit: 50,
              total: opts.total ?? rows.length,
              totalPages: Math.ceil((opts.total ?? rows.length) / 50),
            },
          }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected" }) };
    }) as unknown as typeof global.fetch;

  return { patchCalls, getCalls };
}

describe("ChosenPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders explicit error state with retry button when fetch fails", async () => {
    installMockFetch({ rejectGet: true });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-error")).toBeDefined();
    });
    expect(screen.getByTestId("chosen-error-retry")).toBeDefined();
    expect(screen.queryByTestId("chosen-empty")).toBeNull();
    expect(screen.getByText(/Couldn.t load chosen families/i)).toBeDefined();
  });

  it("Retry button on the error state re-triggers the fetch and recovers", async () => {
    installMockFetch({ rejectGet: true });
    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-error")).toBeDefined();
    });

    installMockFetch({
      pages: { 1: [makeFamily("family-1", "c1", "Contract One")] },
    });
    fireEvent.click(screen.getByTestId("chosen-error-retry"));

    await waitFor(() => {
      expect(screen.queryByTestId("chosen-error")).toBeNull();
    });
    expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
  });

  it("renders explicit empty state when fetch succeeds with zero rows", async () => {
    installMockFetch({ pages: { 1: [] }, total: 0 });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-empty")).toBeDefined();
    });
    expect(screen.queryByTestId("chosen-error")).toBeNull();
    expect(screen.getByText(/Nothing here yet/i)).toBeDefined();
  });

  it("fetches promoted families and renders one card per returned family", async () => {
    const { getCalls } = installMockFetch({
      pages: {
        1: [
          makeFamily("family-newest", "newest", "Most recently promoted"),
          makeFamily("family-middle", "middle", "Middle promoted"),
          makeFamily("family-oldest", "oldest", "Oldest promoted"),
        ],
      },
    });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-newest")).toBeDefined();
    });

    expect(getCalls[0]).toContain("/api/opportunity-families?");
    expect(getCalls[0]).toContain("decision=PROMOTE");
    expect(getCalls[0]).toContain("page=1");
    expect(screen.getAllByTestId("kanban-card")).toHaveLength(3);
    expect(screen.getByTestId("chosen-family-family-newest")).toBeDefined();
    expect(screen.getByTestId("chosen-family-family-middle")).toBeDefined();
    expect(screen.getByTestId("chosen-family-family-oldest")).toBeDefined();
  });

  it("shows one Chosen card for a promoted family with multiple notices", async () => {
    installMockFetch({
      pages: {
        1: [
          makeFamily("family-1", "current-notice", "Current notice", {
            totalNotices: 2,
          }),
        ],
      },
    });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-family-family-1")).toBeDefined();
    });

    expect(screen.getAllByTestId("kanban-card")).toHaveLength(1);
    expect(screen.getByTestId("chosen-family-count-family-1").textContent).toBe(
      "2 notices",
    );
  });

  it("surfaces promoted family update badges", async () => {
    installMockFetch({
      pages: {
        1: [
          makeFamily("family-1", "current-notice", "Current notice", {
            current: makeCard("current-notice", "Current notice", {
              tags: ["PROMOTED_FAMILY_UPDATE"],
            }),
          }),
        ],
      },
    });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-family-badge-family-1")).toBeDefined();
    });
    expect(screen.getByTestId("chosen-family-badge-family-1").textContent).toBe(
      "Family update",
    );
  });

  it("surfaces analyst summary notes on chosen cards", async () => {
    installMockFetch({
      pages: {
        1: [
          makeFamily("family-1", "summary", "Summarized contract", {
            current: makeCard("summary", "Summarized contract", {
              notes:
                "Real RFQ for on-site media destruction. Confirm missing SOW before bid.",
            }),
          }),
        ],
      },
    });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("card-notes-preview")).toBeDefined();
    });

    expect(
      screen.getByText(/Real RFQ for on-site media destruction/i),
    ).toBeDefined();
  });

  it("Load more fetches the next page and appends", async () => {
    const { getCalls } = installMockFetch({
      pages: {
        1: [makeFamily("family-a", "a", "Page 1 card")],
        2: [makeFamily("family-b", "b", "Page 2 card")],
      },
      total: 2,
    });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-a")).toBeDefined();
    });
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0]).toContain("page=1");
    expect(screen.getByTestId("chosen-load-more")).toBeDefined();

    fireEvent.click(screen.getByTestId("chosen-load-more"));

    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-b")).toBeDefined();
    });
    expect(screen.getByTestId("chosen-demote-a")).toBeDefined();
    expect(screen.queryByTestId("chosen-load-more")).toBeNull();
    expect(getCalls).toHaveLength(2);
    expect(getCalls[1]).toContain("page=2");
  });

  it("Demote button PATCHes the current notice and optimistically removes the family", async () => {
    const { patchCalls } = installMockFetch({
      pages: {
        1: [
          makeFamily("family-1", "c1", "A"),
          makeFamily("family-2", "c2", "B"),
        ],
      },
    });
    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("chosen-demote-c1"));

    await waitFor(() => {
      expect(screen.queryByTestId("chosen-family-family-1")).toBeNull();
    });
    expect(screen.getByTestId("chosen-family-family-2")).toBeDefined();

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
    });
    expect(patchCalls[0].url).toBe("/api/contracts/c1");
    expect(patchCalls[0].method).toBe("PATCH");
    expect(patchCalls[0].body).toEqual({ promoted: false });
  });

  it("Demote refetches on PATCH failure to resync with server truth", async () => {
    const { getCalls } = installMockFetch({
      pages: {
        1: [
          makeFamily("family-1", "c1", "A"),
          makeFamily("family-2", "c2", "B"),
        ],
      },
      rejectPatch: true,
    });
    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
    });
    const mountCalls = getCalls.length;

    fireEvent.click(screen.getByTestId("chosen-demote-c1"));

    await waitFor(() => {
      expect(screen.getByTestId("chosen-family-family-1")).toBeDefined();
    });
    expect(screen.getByTestId("chosen-family-family-2")).toBeDefined();
    expect(getCalls.length).toBeGreaterThanOrEqual(mountCalls + 1);
  });

  it("Two rapid demotes that both fail: both families stay visible", async () => {
    const { patchCalls } = installMockFetch({
      pages: {
        1: [
          makeFamily("family-1", "c1", "A"),
          makeFamily("family-2", "c2", "B"),
        ],
      },
      rejectPatch: true,
    });
    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
      expect(screen.getByTestId("chosen-demote-c2")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("chosen-demote-c1"));
    fireEvent.click(screen.getByTestId("chosen-demote-c2"));

    await waitFor(() => {
      expect(screen.getByTestId("chosen-family-family-1")).toBeDefined();
      expect(screen.getByTestId("chosen-family-family-2")).toBeDefined();
    });

    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[0].body).toEqual({ promoted: false });
    expect(patchCalls[1].body).toEqual({ promoted: false });
  });

  it("Refresh click is short-circuited while Load more is in flight", async () => {
    let resolvePage2: (value: any) => void = () => {};
    const page2Pending = new Promise((r) => {
      resolvePage2 = r;
    });
    const getCalls: string[] = [];

    global.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method !== "GET") {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        getCalls.push(url);
        const parsed = new URL(url, "http://localhost");
        const page = parseInt(parsed.searchParams.get("page") ?? "1", 10);
        if (page === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: [makeFamily("family-a", "a", "Page 1")],
              pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
            }),
          });
        }
        return page2Pending;
      }) as unknown as typeof global.fetch;

    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-load-more")).toBeDefined();
    });
    const afterMount = getCalls.length;
    expect(afterMount).toBe(1);

    fireEvent.click(screen.getByTestId("chosen-load-more"));
    await waitFor(() => {
      expect(getCalls.length).toBe(afterMount + 1);
    });
    expect(getCalls[1]).toContain("page=2");

    fireEvent.click(screen.getByTestId("chosen-refresh"));
    await new Promise((r) => setTimeout(r, 30));

    expect(getCalls.length).toBe(afterMount + 1);

    resolvePage2({
      ok: true,
      json: async () => ({
        data: [makeFamily("family-b", "b", "Page 2")],
        pagination: { page: 2, limit: 50, total: 2, totalPages: 1 },
      }),
    });
  });
});
