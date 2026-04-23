// @vitest-environment jsdom
import { vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("lucide-react", () => {
  const icon = (props: any) => <span {...props} />;
  return {
    RefreshCw: icon,
    Pause: icon,
    CheckCircle2: icon,
    AlertCircle: icon,
    Loader2: icon,
    Download: icon,
    Brain: icon,
    FileText: icon,
    RotateCcw: icon,
    ChevronDown: icon,
  };
});

import { CrawlStatus } from "@/components/crawl-status";

const mockStatus = {
  crawl: {
    status: "COMPLETE",
    totalFound: 5630,
    processed: 5630,
    classified: 0,
    startedAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  },
  batchJob: null,
  contracts: {
    total: 35667,
    good: 369,
    maybe: 375,
    discard: 34923,
    pending: 0,
  },
  apiUsage: {
    searchCalls: 0,
    docFetches: 0,
    dailyLimit: 950,
    remaining: 950,
  },
  pipeline: {
    totalIngested: 5630,
    pendingClassification: 0,
    classified: 0,
    goodCount: 369,
    maybeCount: 375,
    discardCount: 34923,
    descriptionsFetched: 1014,
  },
};

describe("CrawlStatus", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStatus),
    }) as typeof global.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is collapsed by default", async () => {
    render(<CrawlStatus />);

    await waitFor(() => {
      expect(screen.getByText("Pipeline Status")).toBeDefined();
    });

    expect(screen.queryByText("SAM.gov API Budget")).toBeNull();
    expect(screen.queryByText("Crawl Metadata")).toBeNull();
  });

  it("expands when the header is clicked", async () => {
    render(<CrawlStatus />);

    await waitFor(() => {
      expect(screen.getByText("Pipeline Status")).toBeDefined();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Pipeline Status/i }));

    await waitFor(() => {
      expect(screen.getByText("SAM.gov API Budget")).toBeDefined();
      expect(screen.getByText("Crawl Metadata")).toBeDefined();
    });
  });
});
