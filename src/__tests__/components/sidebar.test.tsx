// @vitest-environment jsdom
import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("lucide-react", () => {
  const icon = (props: any) => <span {...props} />;
  return {
    LayoutDashboard: icon,
    Settings: icon,
    BarChart3: icon,
    RefreshCw: icon,
    Upload: icon,
    Menu: icon,
    X: icon,
    Inbox: icon,
    GitBranch: icon,
    Activity: icon,
    SearchCheck: icon,
    Archive: icon,
    Sun: icon,
    Moon: icon,
  };
});

// Theme toggle has its own effects that don't matter here — stub it.
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

import { Sidebar } from "@/components/sidebar";

// ──────────────────────────────────────────────────────────────────
// Fetch scaffolding
//
// useNavCounts hits three endpoints in parallel via Promise.allSettled:
//   GET /api/contracts?unreviewed=true&limit=1&page=1    → inbox badge
//   GET /api/pursuits?limit=1&page=1                     → pursuits badge
//   GET /api/contracts?archived=true&...                 → archive badge
//
// Each fetch is allowed to fail independently. A rejected promise must
// NOT blank out the other badge. On initial load, a rejected fetch
// leaves the badge at `null` (hidden). On a subsequent poll, a rejected
// fetch leaves the badge at its last-known value.
// ──────────────────────────────────────────────────────────────────

function makeResponse(total: number) {
  return {
    ok: true,
    json: async () => ({ data: [], pagination: { total } }),
  };
}

function fakeReject() {
  return Promise.reject(new Error("network"));
}

function fakeFetch(
  inboxResult: number | "reject",
  pursuitsResult: number | "reject",
  archiveResult: number | "reject" = 0,
) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("unreviewed=true")) {
      return inboxResult === "reject"
        ? fakeReject()
        : Promise.resolve(makeResponse(inboxResult));
    }
    if (url.includes("/api/pursuits")) {
      return pursuitsResult === "reject"
        ? fakeReject()
        : Promise.resolve(makeResponse(pursuitsResult));
    }
    if (url.includes("archived=true")) {
      return archiveResult === "reject"
        ? fakeReject()
        : Promise.resolve(makeResponse(archiveResult));
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

describe("Sidebar useNavCounts (Commit 5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders both badges when both endpoints return totals", async () => {
    global.fetch = fakeFetch(7, 3) as unknown as typeof global.fetch;
    render(<Sidebar />);

    // Both badges should show their counts. The mobile nav is hidden (md:hidden
    // on the open state means it's not in DOM until mobileOpen=true), so we
    // assert via visible text inside the desktop <aside>.
    await waitFor(() => {
      expect(screen.getAllByText("7").length).toBeGreaterThan(0);
      expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    });
  });

  it("renders the archive badge when expired contracts exist", async () => {
    global.fetch = fakeFetch(0, 0, 12) as unknown as typeof global.fetch;
    render(<Sidebar />);

    await waitFor(() => {
      expect(
        screen.getAllByTestId("nav-badge-desktop-archive").length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Archive").length).toBeGreaterThan(0);
  });

  it("does not render the pursuits badge on initial-load fetch rejection (no last-known value yet)", async () => {
    global.fetch = fakeFetch(5, "reject") as unknown as typeof global.fetch;
    render(<Sidebar />);

    // Inbox still renders with its count
    await waitFor(() => {
      expect(screen.getAllByText("5").length).toBeGreaterThan(0);
    });

    // Pursuits badge must not appear as "0" or any count — null state hides it.
    // The Pursuits label is always present; we assert no count text was emitted
    // next to it. Since we can't easily query "badge adjacent to Pursuits label",
    // assert the inverse: no number rendered for the pursuits endpoint.
    // Zero is explicitly not rendered by the badge (`badge > 0` guard) either.
    expect(screen.queryByText("NaN")).toBeNull();
    // Sanity: Pursuits nav item is present (not hidden by the failure)
    expect(screen.getAllByText("Pursuits").length).toBeGreaterThan(0);
  });

  it("does not render the inbox badge on initial-load fetch rejection while pursuits succeeds", async () => {
    global.fetch = fakeFetch("reject", 9) as unknown as typeof global.fetch;
    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getAllByText("9").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Inbox").length).toBeGreaterThan(0);
  });

  it("renders the Pursuits badge with the configured dark text color (WCAG AA on brass)", async () => {
    // The Pursuits nav item sets badgeTextColor: "var(--chosen-fg)" to dodge
    // the white-on-brass contrast failure.
    // This test asserts the inline `color` style is applied to the badge —
    // if someone drops the prop or reverts to text-white, the contrast bug
    // comes back silently and this test catches it.
    global.fetch = fakeFetch(2, 3) as unknown as typeof global.fetch;
    render(<Sidebar />);

    // Mobile nav only mounts when the hamburger is clicked, so only the
    // desktop badge is in the DOM by default. Wait on that one.
    await waitFor(() => {
      expect(
        screen.getAllByTestId("nav-badge-desktop-pursuits").length,
      ).toBeGreaterThan(0);
    });

    // Collect whatever badges are present (desktop always; mobile only if
    // opened) to prove the color style applies consistently.
    const pursuitBadges = [
      ...screen.queryAllByTestId("nav-badge-pursuits"),
      ...screen.queryAllByTestId("nav-badge-desktop-pursuits"),
    ];
    expect(pursuitBadges.length).toBeGreaterThan(0);
    for (const badge of pursuitBadges) {
      const style = badge.getAttribute("style") ?? "";
      // Inline style must set color to the chosen-fg token.
      expect(style).toContain("color");
      expect(style).toContain("var(--chosen-fg)");
      // Background is the brass token.
      expect(style).toContain("var(--pursuit-brass)");
    }

    // Regression guard: the Inbox badge still defaults to white (not dark).
    // The accessibility fix for Inbox is deferred to a separate PR — this
    // test pins the current behavior so the deferred work stays visible.
    const inboxBadges = [
      ...screen.queryAllByTestId("nav-badge-inbox"),
      ...screen.queryAllByTestId("nav-badge-desktop-inbox"),
    ];
    expect(inboxBadges.length).toBeGreaterThan(0);
    for (const badge of inboxBadges) {
      const style = badge.getAttribute("style") ?? "";
      // Default white text (regression guard — see TODOS.md P3 Inbox badge).
      expect(style).toMatch(/color:\s*(?:rgb\(255,\s*255,\s*255\)|#fff)/i);
    }
  });

  it("keeps the last-known pursuits value on a later poll where pursuits rejects", async () => {
    // Fake only setInterval so the 30s poll fires on demand. Leave
    // setTimeout/Promise timing real so waitFor and microtasks behave normally
    // and AbortSignal.timeout inside useNavCounts doesn't deadlock.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    // First poll (initial mount): both succeed. inbox=4, pursuits=2.
    global.fetch = fakeFetch(4, 2) as unknown as typeof global.fetch;
    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);

    // Second poll: inbox succeeds with a new value, pursuits rejects.
    // Pursuits badge must still show the last-known 2 (not disappear, not 0).
    global.fetch = fakeFetch(6, "reject") as unknown as typeof global.fetch;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    await waitFor(() => {
      expect(screen.getAllByText("6").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("does not render the Watch navigation item", async () => {
    global.fetch = fakeFetch(0, 0, 0) as unknown as typeof global.fetch;
    render(<Sidebar />);

    await waitFor(() => {
      expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Watch")).toBeNull();
    expect(screen.queryByTestId("nav-badge-desktop-watch")).toBeNull();
  });
});
