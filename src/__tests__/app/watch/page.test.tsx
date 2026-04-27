// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
    Eye: icon,
    RefreshCw: icon,
  };
});

import WatchPage from "@/app/watch/page";

function installMockFetch(opts: {
  rows?: unknown[];
  total?: number;
  rejectGet?: boolean;
}) {
  const patchCalls: Array<{ url: string; body: unknown }> = [];

  global.fetch = vi
    .fn()
    .mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";

      if (method === "PATCH") {
        patchCalls.push({
          url,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        return { ok: true, json: async () => ({ id: "watch-1", active: false }) };
      }

      if (opts.rejectGet) {
        return { ok: false, json: async () => ({ error: "boom" }) };
      }

      return {
        ok: true,
        json: async () => ({
          data: opts.rows ?? [],
          pagination: {
            page: 1,
            limit: 50,
            total: opts.total ?? (opts.rows ?? []).length,
            totalPages: 1,
          },
        }),
      };
    }) as unknown as typeof global.fetch;

  return { patchCalls };
}

describe("WatchPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads watch targets from the watch-targets endpoint", async () => {
    installMockFetch({
      rows: [
        {
          id: "watch-1",
          sourceTitle: "Cloud migration support",
          sourceAgency: "Department of Defense",
          status: "MONITORING",
          statusLabel: "Monitoring",
          currentNoticeType: "Sources Sought",
          lastCheckedAt: null,
          lastAlertedAt: null,
          recentChangeSummary: null,
          linkedCount: 1,
        },
      ],
    });

    render(<WatchPage />);

    await waitFor(() => {
      expect(screen.getByText("Cloud migration support")).toBeDefined();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/watch-targets?limit=50&page=1",
      expect.any(Object),
    );
  });

  it("renders an empty state when no watch targets exist", async () => {
    installMockFetch({ rows: [], total: 0 });

    render(<WatchPage />);

    await waitFor(() => {
      expect(screen.getByTestId("watch-empty")).toBeDefined();
    });
  });

  it("Unwatch PATCHes active:false to the watch-target endpoint", async () => {
    const { patchCalls } = installMockFetch({
      rows: [
        {
          id: "watch-1",
          sourceTitle: "Cloud migration support",
          sourceAgency: "Department of Defense",
          status: "MONITORING",
          statusLabel: "Monitoring",
          currentNoticeType: "Sources Sought",
          lastCheckedAt: null,
          lastAlertedAt: null,
          recentChangeSummary: null,
          linkedCount: 1,
        },
      ],
    });

    render(<WatchPage />);

    await waitFor(() => {
      expect(screen.getByTestId("watch-unwatch-watch-1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("watch-unwatch-watch-1"));

    await waitFor(() => {
      expect(patchCalls[0]).toEqual({
        url: "/api/watch-targets/watch-1",
        body: { active: false },
      });
    });
  });
});
