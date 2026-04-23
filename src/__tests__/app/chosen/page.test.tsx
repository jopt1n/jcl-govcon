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
    Building2: icon,
    DollarSign: icon,
    Clock: icon,
    Brain: icon,
    FileText: icon,
    RefreshCw: icon,
    Star: icon,
  };
});

// Import AFTER mocks.
import ChosenPage from "@/app/chosen/page";

// ──────────────────────────────────────────────────────────────────
// Fetch scaffolding
//
// /chosen hits exactly one endpoint shape on mount and on Load more:
//   GET /api/contracts?promoted=true&includeUnreviewed=true&limit=50&page=N
//
// Demote click hits:
//   PATCH /api/contracts/:id with { promoted: false }
// ──────────────────────────────────────────────────────────────────

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
    status: "IDENTIFIED",
    promoted: true,
    ...overrides,
  };
}

/**
 * Install a fetch mock whose GET response for /api/contracts is driven by a
 * per-page map. `pages[N]` = the rows to return for page=N. `total` is the
 * declared grand total so Load more surfaces only when appropriate.
 */
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

      if (url.startsWith("/api/contracts?")) {
        getCalls.push(url);
        const parsed = new URL(`http://x/${url.slice(1)}`);
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

describe("ChosenPage (Commit 5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── State 1: error ────────────────────────────────────────────────
  it("renders explicit error state with retry button when fetch fails", async () => {
    installMockFetch({ rejectGet: true });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-error")).toBeDefined();
    });
    // Retry button is present and distinct
    expect(screen.getByTestId("chosen-error-retry")).toBeDefined();
    // Must NOT render the empty state on error — the two states are distinct
    expect(screen.queryByTestId("chosen-empty")).toBeNull();
    // Error copy is specific, not generic
    expect(screen.getByText(/Couldn.t load chosen contracts/i)).toBeDefined();
  });

  it("Retry button on the error state re-triggers the fetch and recovers", async () => {
    // First GET fails, next one succeeds — swap the mock mid-test.
    installMockFetch({ rejectGet: true });
    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-error")).toBeDefined();
    });

    // Swap to a successful mock, then click retry.
    installMockFetch({ pages: { 1: [makeCard("c1", "Contract One")] } });
    fireEvent.click(screen.getByTestId("chosen-error-retry"));

    await waitFor(() => {
      expect(screen.queryByTestId("chosen-error")).toBeNull();
    });
    expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
  });

  // ── State 2: empty ────────────────────────────────────────────────
  it("renders explicit empty state when fetch succeeds with zero rows", async () => {
    installMockFetch({ pages: { 1: [] }, total: 0 });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-empty")).toBeDefined();
    });
    // Must NOT render error state for an empty list
    expect(screen.queryByTestId("chosen-error")).toBeNull();
    // Empty copy is specific
    expect(screen.getByText(/Nothing here yet/i)).toBeDefined();
  });

  // ── State 3: loaded ───────────────────────────────────────────────
  it("renders cards in server-returned order (promotedAt DESC) with classification badge", async () => {
    // Server returns rows already sorted by promotedAt DESC. The page renders
    // them in order — verify DOM order matches server order, which is the
    // guarantee the API provides.
    installMockFetch({
      pages: {
        1: [
          makeCard("newest", "Most recently promoted"),
          makeCard("middle", "Middle promoted"),
          makeCard("oldest", "Oldest promoted"),
        ],
      },
    });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-newest")).toBeDefined();
    });

    // Assert DOM order = server order
    const demoteButtons = screen.getAllByText(/Demote/);
    expect(demoteButtons).toHaveLength(3);
    const cardIds = demoteButtons.map(
      (b) => b.closest("button")?.getAttribute("data-testid") ?? "",
    );
    expect(cardIds).toEqual([
      "chosen-demote-newest",
      "chosen-demote-middle",
      "chosen-demote-oldest",
    ]);
  });

  it("surfaces analyst summary notes on chosen cards", async () => {
    installMockFetch({
      pages: {
        1: [
          makeCard("summary", "Summarized contract", {
            notes:
              "Real RFQ for on-site media destruction. Confirm missing SOW before bid.",
          }),
        ],
      },
    });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("card-notes-preview")).toBeDefined();
    });

    expect(screen.getByText(/Real RFQ for on-site media destruction/i)).toBeDefined();
  });

  it("Load more fetches the next page and appends (URL contains page=2)", async () => {
    const { getCalls } = installMockFetch({
      pages: {
        1: [makeCard("a", "Page 1 card")],
        2: [makeCard("b", "Page 2 card")],
      },
      total: 2,
    });
    render(<ChosenPage />);

    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-a")).toBeDefined();
    });
    // Mount fired exactly one GET (page=1). Regression guard for the inFlight
    // short-circuit not double-firing on initial render.
    const mountCalls = getCalls.length;
    expect(mountCalls).toBe(1);
    expect(getCalls[0]).toContain("page=1");

    // Load more surfaces because total > contracts.length
    expect(screen.getByTestId("chosen-load-more")).toBeDefined();

    fireEvent.click(screen.getByTestId("chosen-load-more"));

    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-b")).toBeDefined();
    });
    // First page still present — page 2 was appended, not replaced
    expect(screen.getByTestId("chosen-demote-a")).toBeDefined();
    // Load more gone once all rows are in the DOM
    expect(screen.queryByTestId("chosen-load-more")).toBeNull();

    // The second GET must target page=2. A silent regression that turned
    // `page + 1` into `page` (same pagination, wrong increment) would
    // otherwise pass because the mock returns page 1 rows for both pages.
    expect(getCalls).toHaveLength(2);
    expect(getCalls[1]).toContain("page=2");
  });

  // ── Demote ────────────────────────────────────────────────────────
  it("Demote button PATCHes { promoted: false } and optimistically removes the card", async () => {
    const { patchCalls } = installMockFetch({
      pages: { 1: [makeCard("c1", "A"), makeCard("c2", "B")] },
    });
    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("chosen-demote-c1"));

    // Optimistic: c1 gone immediately; c2 still present.
    await waitFor(() => {
      expect(screen.queryByTestId("chosen-demote-c1")).toBeNull();
    });
    expect(screen.getByTestId("chosen-demote-c2")).toBeDefined();

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
    });
    expect(patchCalls[0].url).toBe("/api/contracts/c1");
    expect(patchCalls[0].method).toBe("PATCH");
    expect(patchCalls[0].body).toEqual({ promoted: false });
  });

  it("Demote refetches on PATCH failure to resync with server truth", async () => {
    const { getCalls } = installMockFetch({
      pages: { 1: [makeCard("c1", "A"), makeCard("c2", "B")] },
      rejectPatch: true,
    });
    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
    });
    const mountCalls = getCalls.length;

    fireEvent.click(screen.getByTestId("chosen-demote-c1"));

    // Card reappears once PATCH fails + refetch completes
    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
    });
    expect(screen.getByTestId("chosen-demote-c2")).toBeDefined();

    // The refetch fired — we saw one extra GET after the mount call.
    expect(getCalls.length).toBeGreaterThanOrEqual(mountCalls + 1);
  });

  it("Two rapid demotes that both fail: both cards stay visible (no snapshot race)", async () => {
    // Under the old snapshot-capture revert pattern, two concurrent demotes
    // with both PATCHes failing could lose the first card — the second demote
    // captured an already-filtered state as its `prev`, and its revert would
    // overwrite the first revert. The refetch-on-failure pattern (matching
    // /inbox's fetchGroup revert) is immune because both catch blocks resync
    // against server truth via fetchPage, not against a captured snapshot.
    const { patchCalls } = installMockFetch({
      pages: { 1: [makeCard("c1", "A"), makeCard("c2", "B")] },
      rejectPatch: true,
    });
    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
      expect(screen.getByTestId("chosen-demote-c2")).toBeDefined();
    });

    // Fire both demotes back-to-back before either PATCH resolves.
    fireEvent.click(screen.getByTestId("chosen-demote-c1"));
    fireEvent.click(screen.getByTestId("chosen-demote-c2"));

    // After both reverts settle, both cards must be present.
    await waitFor(() => {
      expect(screen.getByTestId("chosen-demote-c1")).toBeDefined();
      expect(screen.getByTestId("chosen-demote-c2")).toBeDefined();
    });

    // Both PATCHes actually fired (not one swallowed by inFlight on the
    // PATCH side — the inFlight ref gates GETs, not PATCHes).
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[0].body).toEqual({ promoted: false });
    expect(patchCalls[1].body).toEqual({ promoted: false });
  });

  // ── Race guard: Refresh during Load more ──────────────────────────
  it("Refresh click is short-circuited while Load more is in flight (no second GET)", async () => {
    // Scenario: Load more is still awaiting a slow page-2 response. The user
    // clicks Refresh. Without the inFlight guard (plus the disabled attr on
    // the button), the Refresh would kick off a page-1 fetch that races with
    // the in-flight page-2 fetch, and whichever resolves last would clobber
    // the visible list (e.g., refresh wins first, load-more resolves second
    // and appends page-2 onto the refreshed page 1, producing stale/duplicate
    // rows). This test holds page 2 open, clicks Refresh, then verifies no
    // additional GET was issued beyond mount + load-more.

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
        const parsed = new URL(`http://x/${url.slice(1)}`);
        const page = parseInt(parsed.searchParams.get("page") ?? "1", 10);
        if (page === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: [makeCard("a", "Page 1")],
              pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
            }),
          });
        }
        // page === 2 — hang until the test resolves it manually.
        return page2Pending;
      }) as unknown as typeof global.fetch;

    render(<ChosenPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chosen-load-more")).toBeDefined();
    });
    const afterMount = getCalls.length;
    expect(afterMount).toBe(1); // page=1 on mount

    // Start Load more — fires a page=2 GET that will hang on page2Pending.
    fireEvent.click(screen.getByTestId("chosen-load-more"));
    await waitFor(() => {
      expect(getCalls.length).toBe(afterMount + 1);
    });
    expect(getCalls[1]).toContain("page=2");

    // Click Refresh while page=2 is still pending.
    fireEvent.click(screen.getByTestId("chosen-refresh"));

    // Give React a tick to process any handler. If the inFlight guard works
    // (plus the disabled attr), no new GET fires.
    await new Promise((r) => setTimeout(r, 30));

    expect(getCalls.length).toBe(afterMount + 1);

    // Release the page-2 fetch so the test cleans up properly.
    resolvePage2({
      ok: true,
      json: async () => ({
        data: [makeCard("b", "Page 2")],
        pagination: { page: 2, limit: 50, total: 2, totalPages: 1 },
      }),
    });
  });
});
