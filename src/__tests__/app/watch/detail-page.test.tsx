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
    ExternalLink: icon,
    RefreshCw: icon,
    Search: icon,
    Star: icon,
  };
});

import WatchTargetDetailPage from "@/app/watch/[id]/page";

function makeDetail() {
  return {
    id: "watch-1",
    active: true,
    status: "NEEDS_REVIEW",
    statusLabel: "Needs Review",
    watchedAt: "2026-04-22T10:00:00Z",
    unwatchedAt: null,
    lastCheckedAt: "2026-04-22T11:00:00Z",
    lastAlertedAt: null,
    source: {
      contractId: "contract-source",
      noticeId: "notice-source",
      solicitationNumber: "SOL-001",
      title: "Cloud migration support",
      agency: "Department of Defense",
      noticeType: "Sources Sought",
      responseDeadline: "2026-04-30T12:00:00Z",
      setAsideCode: "SBA",
      resourceUrls: [],
    },
    currentSnapshot: null,
    primaryContractId: null,
    primaryContract: null,
    linkedContracts: [
      {
        id: "contract-source",
        noticeId: "notice-source",
        solicitationNumber: "SOL-001",
        title: "Cloud migration support",
        agency: "Department of Defense",
        noticeType: "Sources Sought",
        responseDeadline: "2026-04-30T12:00:00Z",
        postedDate: "2026-04-01T12:00:00Z",
        classification: "GOOD",
        reviewedAt: "2026-04-01T12:00:00Z",
        samUrl: "https://sam.gov/source",
        resourceLinks: [],
        roles: ["source"],
        confidence: null,
        isPrimary: false,
      },
      {
        id: "contract-successor",
        noticeId: "notice-successor",
        solicitationNumber: "SOL-001",
        title: "Cloud migration support",
        agency: "Department of Defense",
        noticeType: "Solicitation",
        responseDeadline: "2026-05-12T12:00:00Z",
        postedDate: "2026-04-20T12:00:00Z",
        classification: "PENDING",
        reviewedAt: "2026-04-20T12:00:00Z",
        samUrl: "https://sam.gov/successor",
        resourceLinks: [],
        roles: ["auto_candidate"],
        confidence: "1",
        isPrimary: false,
      },
    ],
    recentEvents: [],
  };
}

describe("WatchTargetDetailPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders linked contracts together and highlights NEEDS_REVIEW", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => makeDetail(),
      }) as unknown as typeof global.fetch;

    render(<WatchTargetDetailPage params={{ id: "watch-1" }} />);

    await waitFor(() => {
      expect(screen.getByTestId("watch-needs-review-banner")).toBeDefined();
    });
    expect(screen.getAllByText("Cloud migration support").length).toBeGreaterThan(
      1,
    );
  });

  it("Make primary PATCHes primaryContractId to the watch-target endpoint", async () => {
    const patchCalls: Array<{ url: string; body: unknown }> = [];
    global.fetch = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "PATCH") {
          patchCalls.push({
            url,
            body: JSON.parse(init?.body as string),
          });
          return {
            ok: true,
            json: async () => ({
              ...makeDetail(),
              status: "MATCHED",
              statusLabel: "Matched",
              primaryContractId: "contract-successor",
            }),
          };
        }
        return {
          ok: true,
          json: async () => makeDetail(),
        };
      }) as unknown as typeof global.fetch;

    render(<WatchTargetDetailPage params={{ id: "watch-1" }} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("watch-make-primary-contract-successor"),
      ).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("watch-make-primary-contract-successor"));

    await waitFor(() => {
      expect(patchCalls[0]).toEqual({
        url: "/api/watch-targets/watch-1",
        body: { primaryContractId: "contract-successor" },
      });
    });
  });
});
