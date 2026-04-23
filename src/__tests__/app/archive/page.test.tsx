// @vitest-environment jsdom
import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

import ArchivePage from "@/app/archive/page";

function makeCard(id: string, title: string) {
  return {
    id,
    title,
    agency: "Test Agency",
    awardCeiling: "100000",
    responseDeadline: "2026-04-01T00:00:00.000Z",
    noticeType: "Solicitation",
    classification: "GOOD",
    aiReasoning: null,
    summary: "Archived contract summary",
    actionPlan: null,
    status: "IDENTIFIED",
    promoted: false,
  };
}

function installMockFetch(rows: unknown[], total = rows.length) {
  const getCalls: string[] = [];

  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    getCalls.push(url);
    if (url.startsWith("/api/contracts?")) {
      return {
        ok: true,
        json: async () => ({
          data: rows,
          pagination: {
            page: 1,
            limit: 50,
            total,
            totalPages: Math.ceil(total / 50),
          },
        }),
      };
    }
    return { ok: false, json: async () => ({ error: "unexpected" }) };
  }) as unknown as typeof global.fetch;

  return getCalls;
}

describe("ArchivePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads contracts from the archive query", async () => {
    const getCalls = installMockFetch([
      makeCard("expired-1", "Expired GOOD Contract"),
    ]);

    render(<ArchivePage />);

    await waitFor(() => {
      expect(screen.getByText("Expired GOOD Contract")).toBeDefined();
    });

    expect(getCalls).toHaveLength(1);
    expect(getCalls[0]).toContain("archived=true");
    expect(getCalls[0]).toContain("includeUnreviewed=true");
  });

  it("renders an empty state when no archived contracts exist", async () => {
    installMockFetch([], 0);

    render(<ArchivePage />);

    await waitFor(() => {
      expect(screen.getByTestId("archive-empty")).toBeDefined();
    });
    expect(screen.getByText(/No archived contracts/i)).toBeDefined();
  });
});
