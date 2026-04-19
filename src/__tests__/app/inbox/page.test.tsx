// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("lucide-react", () => {
  // Pass through ALL props so tests can query by data-testid / aria-label.
  const icon = (props: any) => <span {...props} />;
  return {
    Building2: icon,
    DollarSign: icon,
    Clock: icon,
    Brain: icon,
    Check: icon,
    Inbox: icon,
    RefreshCw: icon,
    Star: icon,
  };
});

// Import AFTER mocks are set up.
import InboxPage from "@/app/inbox/page";

// ──────────────────────────────────────────────────────────────────
// Fetch scaffolding
//
// /inbox hits two endpoints on mount:
//   - GET /api/contracts?classification=GOOD|MAYBE|DISCARD&unreviewed=true&...
//   - GET /api/crawl-runs/latest?kind=weekly
//
// Action callbacks hit:
//   - PATCH /api/contracts/:id with { reviewedAt: true } or { promoted: true }
//
// The helper below returns a mock that responds to each URL shape with
// the supplied group data. PATCH calls resolve to { ok: true } and are
// tracked so tests can assert on the body that was sent.
// ──────────────────────────────────────────────────────────────────

type Group = {
  GOOD?: unknown[];
  MAYBE?: unknown[];
  DISCARD?: unknown[];
};

function installMockFetch(groups: Group) {
  const patchCalls: Array<{ url: string; body: unknown; method: string }> = [];

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
        return {
          ok: true,
          json: async () => ({ id: url.split("/").pop() }),
        };
      }

      // GET /api/contracts?classification=X
      if (url.startsWith("/api/contracts?")) {
        const classification = new URL(
          `http://x/${url.slice(1)}`,
        ).searchParams.get("classification") as keyof Group | null;
        return {
          ok: true,
          json: async () => ({
            data: classification ? (groups[classification] ?? []) : [],
            pagination: {
              page: 1,
              limit: 100,
              total: classification ? (groups[classification]?.length ?? 0) : 0,
              totalPages: 1,
            },
          }),
        };
      }

      // GET /api/crawl-runs/latest
      if (url.startsWith("/api/crawl-runs/latest")) {
        return {
          ok: true,
          json: async () => ({ run: null }),
        };
      }

      return { ok: false, json: async () => ({ error: "unexpected" }) };
    }) as unknown as typeof global.fetch;

  return patchCalls;
}

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
    status: "IDENTIFIED",
    promoted: false,
    ...overrides,
  };
}

describe("InboxPage — promote (Commit 4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a ★ Promote button on each unreviewed card", async () => {
    installMockFetch({ GOOD: [makeCard("c1", "Contract One")] });
    render(<InboxPage />);
    await waitFor(() => {
      expect(screen.getByTestId("inbox-promote-c1")).toBeDefined();
    });
    // Also Mark reviewed is still there — regression guard for the shared helper.
    expect(screen.getByTestId("inbox-mark-reviewed-c1")).toBeDefined();
  });

  it("clicking ★ Promote PATCHes { promoted: true } to the contract endpoint", async () => {
    const patchCalls = installMockFetch({
      GOOD: [makeCard("c1", "Contract One")],
    });
    render(<InboxPage />);
    await waitFor(() => {
      expect(screen.getByTestId("inbox-promote-c1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("inbox-promote-c1"));

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
    });
    expect(patchCalls[0].url).toBe("/api/contracts/c1");
    expect(patchCalls[0].method).toBe("PATCH");
    expect(patchCalls[0].body).toEqual({ promoted: true });
  });

  it("promoted card optimistically disappears from the list", async () => {
    installMockFetch({
      GOOD: [makeCard("c1", "Contract One"), makeCard("c2", "Contract Two")],
    });
    render(<InboxPage />);
    await waitFor(() => {
      expect(screen.getByTestId("inbox-promote-c1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("inbox-promote-c1"));

    // c1 should disappear from the DOM optimistically — no wait for PATCH to resolve.
    await waitFor(() => {
      expect(screen.queryByTestId("inbox-promote-c1")).toBeNull();
    });
    // c2 still present — we only removed the clicked card.
    expect(screen.getByTestId("inbox-promote-c2")).toBeDefined();
  });

  it("Mark reviewed still PATCHes { reviewedAt: true } after the refactor (helper-sharing regression)", async () => {
    const patchCalls = installMockFetch({
      GOOD: [makeCard("c1", "Contract One")],
    });
    render(<InboxPage />);
    await waitFor(() => {
      expect(screen.getByTestId("inbox-mark-reviewed-c1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("inbox-mark-reviewed-c1"));

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
    });
    expect(patchCalls[0].body).toEqual({ reviewedAt: true });
  });

  it("Mark reviewed card also optimistically disappears (helper-shared behavior)", async () => {
    installMockFetch({
      GOOD: [makeCard("c1", "Contract One"), makeCard("c2", "Contract Two")],
    });
    render(<InboxPage />);
    await waitFor(() => {
      expect(screen.getByTestId("inbox-mark-reviewed-c1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("inbox-mark-reviewed-c1"));

    await waitFor(() => {
      expect(screen.queryByTestId("inbox-mark-reviewed-c1")).toBeNull();
    });
    expect(screen.getByTestId("inbox-mark-reviewed-c2")).toBeDefined();
  });

  it("Promote button is hidden when contract.promoted === true (defensive guard)", async () => {
    // In practice the COALESCE in the PATCH handler filters promoted-and-
    // unreviewed off /inbox on next fetch, so this card shouldn't appear.
    // But a multi-tab scenario (promote in tab A, /inbox still open in tab B)
    // can leave a stale promoted=true card on screen. The guard ensures the
    // button doesn't render on it — Mark reviewed still does.
    installMockFetch({
      GOOD: [makeCard("c1", "Stale promoted card", { promoted: true })],
    });
    render(<InboxPage />);
    await waitFor(() => {
      expect(screen.getByTestId("inbox-mark-reviewed-c1")).toBeDefined();
    });
    expect(screen.queryByTestId("inbox-promote-c1")).toBeNull();
  });
});
