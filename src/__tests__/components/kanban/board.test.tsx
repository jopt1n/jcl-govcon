// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    Archive: icon,
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
    Star: icon,
  };
});

// next/navigation mock — mutable search params so router.replace updates state
let mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn((url: string) => {
  const qIdx = url.indexOf("?");
  mockSearchParams = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/",
}));

import { KanbanBoard } from "@/components/kanban/board";

const emptyResponse = {
  data: [],
  pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
};

function makeMockFetch(responses?: Record<string, any>) {
  return vi.fn().mockImplementation((url: string) => {
    const classification = new URL(url, "http://localhost").searchParams.get(
      "classification",
    );
    const body = responses?.[classification ?? ""] ?? emptyResponse;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    });
  });
}

function lastFetchUrlsByClassification() {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const byClass: Record<string, string> = {};
  for (const [url] of calls) {
    const parsed = new URL(url, "http://localhost");
    const cls = parsed.searchParams.get("classification") ?? "";
    byClass[cls] = url;
  }
  return byClass;
}

describe("KanbanBoard", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockReplace.mockClear();
    global.fetch = makeMockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders four columns (UPCOMING DEADLINES, GOOD, MAYBE, DISCARD)", async () => {
    render(<KanbanBoard />);
    await waitFor(() => {
      expect(screen.getByText("UPCOMING DEADLINES")).toBeDefined();
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
      (c: any[]) => c[0],
    );
    expect(
      urls.some((u: string) => u.includes("classification=DEADLINES")),
    ).toBe(true);
    expect(urls.some((u: string) => u.includes("classification=GOOD"))).toBe(
      true,
    );
    expect(urls.some((u: string) => u.includes("classification=MAYBE"))).toBe(
      true,
    );
    expect(urls.some((u: string) => u.includes("classification=DISCARD"))).toBe(
      true,
    );
  });

  it("excludes promoted and watched contracts from every main-board column fetch", async () => {
    render(<KanbanBoard />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    const byClass = lastFetchUrlsByClassification();
    expect(byClass["DEADLINES"]).toContain("promoted=false");
    expect(byClass["GOOD"]).toContain("promoted=false");
    expect(byClass["MAYBE"]).toContain("promoted=false");
    expect(byClass["DISCARD"]).toContain("promoted=false");
    expect(byClass["DEADLINES"]).toContain("watched=false");
    expect(byClass["GOOD"]).toContain("watched=false");
    expect(byClass["MAYBE"]).toContain("watched=false");
    expect(byClass["DISCARD"]).toContain("watched=false");
  });

  it("shows search input", async () => {
    render(<KanbanBoard />);
    expect(screen.getByPlaceholderText("Search contracts...")).toBeDefined();
  });

  it("shows agency filter button", async () => {
    render(<KanbanBoard />);
    expect(screen.getByText("Agency")).toBeDefined();
  });

  it("renders filter chips (notice type, posted window, set-aside)", async () => {
    render(<KanbanBoard />);
    expect(screen.getByRole("button", { name: "Solicitation" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Presolicitation" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Sources Sought" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "This week" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Qualifying only" }),
    ).toBeDefined();
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
          summary: "Alpha summary",
          actionPlan: null,
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

  it("archives a contract from the dashboard and removes it from every loaded column", async () => {
    const patchCalls: Array<{ url: string; body: unknown }> = [];
    const contractData = {
      data: [
        {
          id: "c1",
          title: "Alpha Contract",
          agency: "DOD",
          awardCeiling: "100000",
          responseDeadline: "2026-05-10T00:00:00.000Z",
          noticeType: "Solicitation",
          classification: "GOOD",
          aiReasoning: null,
          summary: "Alpha summary",
          actionPlan: null,
          status: "IDENTIFIED",
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    };

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        patchCalls.push({
          url,
          body: JSON.parse(init?.body as string),
        });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "c1", tags: ["ARCHIVED"] }),
        });
      }

      const classification = new URL(url, "http://localhost").searchParams.get(
        "classification",
      );
      const body =
        classification === "GOOD" || classification === "DEADLINES"
          ? contractData
          : emptyResponse;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
      });
    });

    render(<KanbanBoard />);

    await waitFor(() => {
      expect(screen.getAllByTestId("kanban-card-archive-c1")).toHaveLength(2);
    });

    const user = userEvent.setup();
    await user.click(screen.getAllByTestId("kanban-card-archive-c1")[0]);

    await waitFor(() => {
      expect(patchCalls).toEqual([
        { url: "/api/contracts/c1", body: { archived: true } },
      ]);
      expect(screen.queryAllByTestId("kanban-card-archive-c1")).toHaveLength(0);
      expect(screen.queryAllByText("Alpha Contract")).toHaveLength(0);
    });
  });

  it("search form submission pushes search param to URL", async () => {
    render(<KanbanBoard />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    const input = screen.getByPlaceholderText("Search contracts...");
    const user = userEvent.setup();
    await user.type(input, "test query");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
    const lastCall = mockReplace.mock.calls.at(-1)![0] as string;
    expect(lastCall).toContain("search=test+query");
  });

  it("clicking a notice type chip updates the URL with noticeType param", async () => {
    render(<KanbanBoard />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Solicitation" }));

    await waitFor(() => {
      const lastCall = mockReplace.mock.calls.at(-1)![0] as string;
      expect(lastCall).toContain("noticeType=Solicitation");
    });
  });

  it("toggling a second notice type produces a comma-separated list", async () => {
    mockSearchParams = new URLSearchParams("noticeType=Solicitation");
    render(<KanbanBoard />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Presolicitation" }));

    await waitFor(() => {
      const lastCall = mockReplace.mock.calls.at(-1)![0] as string;
      expect(decodeURIComponent(lastCall)).toContain(
        "noticeType=Solicitation,Presolicitation",
      );
    });
  });

  it("re-clicking an active notice type chip removes it from the URL", async () => {
    mockSearchParams = new URLSearchParams("noticeType=Solicitation");
    render(<KanbanBoard />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Solicitation" }));

    await waitFor(() => {
      const lastCall = mockReplace.mock.calls.at(-1)![0] as string;
      expect(lastCall).not.toContain("noticeType");
    });
  });

  it("picking 'This week' writes postedWindow=week to the URL", async () => {
    render(<KanbanBoard />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "This week" }));

    await waitFor(() => {
      const lastCall = mockReplace.mock.calls.at(-1)![0] as string;
      expect(lastCall).toContain("postedWindow=week");
    });
  });

  it("hydrates chip state from URL on mount", async () => {
    mockSearchParams = new URLSearchParams(
      "noticeType=Solicitation&postedWindow=week&setAsideQualifying=1",
    );
    render(<KanbanBoard />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    const byClass = lastFetchUrlsByClassification();
    expect(byClass["GOOD"]).toContain("noticeType=Solicitation");
    expect(byClass["GOOD"]).toMatch(/postedAfter=/);
    expect(byClass["GOOD"]).toContain("setAsideQualifying=1");

    // Active chips reflect URL state
    expect(
      screen
        .getByRole("button", { name: "Solicitation" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "This week" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Qualifying only" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("clear filters button appears when filters are active and wipes URL", async () => {
    mockSearchParams = new URLSearchParams("noticeType=Solicitation");
    render(<KanbanBoard />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    const clear = screen.getByText("Clear");
    const user = userEvent.setup();
    await user.click(clear);

    await waitFor(() => {
      const lastCall = mockReplace.mock.calls.at(-1)![0] as string;
      expect(lastCall).toBe("/");
    });
  });
});
