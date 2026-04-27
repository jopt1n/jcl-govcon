// @vitest-environment jsdom
import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PursuitsWorkspace } from "@/components/pursuits/pursuits-workspace";

vi.mock("lucide-react", () => {
  const icon = (props: any) => <span {...props} />;
  return {
    CalendarClock: icon,
    CircleDollarSign: icon,
    Contact: icon,
    Database: icon,
    ExternalLink: icon,
    FileText: icon,
    Filter: icon,
    History: icon,
    ListChecks: icon,
    Plus: icon,
    RefreshCw: icon,
    Save: icon,
    SearchCheck: icon,
    Trash2: icon,
    Users: icon,
    X: icon,
  };
});

const pursuit = {
  id: "pursuit-1",
  title: "Printer supplies BPA",
  agency: "GSA",
  solicitationNumber: "ABC-123",
  noticeType: "Solicitation",
  classification: "GOOD",
  responseDeadline: "2026-05-10T17:00:00.000Z",
  stage: "NEEDS_DEEP_DIVE",
  outcome: null as null | "WON" | "LOST" | "NO_BID" | "ARCHIVED",
  nextAction: "Read SOW",
  nextActionDueAt: null,
  contractType: "SUPPLIES_RESELLER",
  cashBurden: "UNKNOWN",
  contactStatus: "UNKNOWN",
  promotedAt: "2026-04-26T12:00:00.000Z",
};

function installFetch(pursuitOverride: Partial<typeof pursuit> = {}) {
  const row = { ...pursuit, ...pursuitOverride };
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });

    if (url.startsWith("/api/pursuits?")) {
      return {
        ok: true,
        json: async () => ({
          data: [row],
          pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
        }),
      };
    }

    if (url === "/api/pursuits/pursuit-1" && method === "GET") {
      return {
        ok: true,
        json: async () => ({
          pursuit: row,
          contacts: [
            {
              id: "contact-1",
              role: "GOVERNMENT_POC",
              name: "Jane Doe",
              organization: "GSA",
              title: null,
              email: "jane@example.gov",
              phone: null,
              url: null,
              notes: "Contracting office",
              isPrimary: true,
            },
          ],
          interactions: [],
          documents: [
            {
              id: "doc-1",
              sourceUrl: "https://example.test/sow.pdf",
              fileName: "sow.pdf",
              contentType: "application/pdf",
              sizeBytes: null,
              sha256: null,
              objectKey: null,
              storageProvider: null,
            },
          ],
          stageHistory: [],
        }),
      };
    }

    if (url === "/api/pursuits/pursuit-1" && method === "PATCH") {
      const lastCall = calls[calls.length - 1];
      return {
        ok: true,
        json: async () => ({
          pursuit: { ...pursuit, ...(lastCall?.body as object) },
          contacts: [],
          interactions: [],
          documents: [],
          stageHistory: [],
        }),
      };
    }

    if (url === "/api/pursuits/pursuit-1/interactions" && method === "POST") {
      return { ok: true, json: async () => ({ id: "event-1" }) };
    }

    return { ok: false, json: async () => ({ error: "unexpected" }) };
  }) as unknown as typeof global.fetch;

  return calls;
}

describe("PursuitsWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the dense pursuit list and detail drawer", async () => {
    installFetch();
    render(<PursuitsWorkspace />);

    await waitFor(() => {
      expect(screen.getByTestId("pursuit-row-pursuit-1")).toBeDefined();
    });
    expect(screen.getAllByText("Printer supplies BPA").length).toBeGreaterThan(0);
    expect(screen.getByTestId("pursuit-detail-drawer")).toBeDefined();
    expect(screen.getByTestId("pursuit-list-scroll").className).toContain(
      "overflow-x-auto",
    );
    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeDefined();
      expect(screen.getByText("sow.pdf")).toBeDefined();
    });
  });

  it("does not offer direct terminal outcome clearing in the drawer", async () => {
    installFetch({ outcome: "ARCHIVED" });
    render(<PursuitsWorkspace />);

    const outcomeSelect = await screen.findByTestId(
      "pursuit-outcome-select",
    ) as HTMLSelectElement;

    expect(outcomeSelect.value).toBe("ARCHIVED");
    expect(outcomeSelect.querySelector('option[value=""]')).toBeNull();
  });

  it("aborts stale list requests when filters change", async () => {
    const signals: AbortSignal[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (!url.startsWith("/api/pursuits?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            pursuit,
            contacts: [],
            interactions: [],
            documents: [],
            stageHistory: [],
          }),
        });
      }

      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return new Promise((resolve, reject) => {
        const finish = () =>
          resolve({
            ok: true,
            json: async () => ({
              data: [pursuit],
              pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
            }),
          });
        if (signal.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
        setTimeout(finish, 25);
      });
    }) as unknown as typeof global.fetch;

    render(<PursuitsWorkspace />);
    await waitFor(() => {
      expect(signals).toHaveLength(1);
    });
    fireEvent.change(screen.getByPlaceholderText("Title, agency, solicitation"), {
      target: { value: "printer" },
    });

    await waitFor(() => {
      expect(signals).toHaveLength(2);
    });
    expect(signals[0].aborted).toBe(true);
  });

  it("updates pursuit stage controls through PATCH", async () => {
    const calls = installFetch();
    render(<PursuitsWorkspace />);

    await waitFor(() => {
      expect(screen.getByTestId("pursuit-detail-drawer")).toBeDefined();
    });
    const stageSelect = await screen.findByTestId(
      "pursuit-stage-select",
    ) as HTMLSelectElement;
    fireEvent.change(stageSelect, { target: { value: "RESEARCH_COMPLETE" } });
    fireEvent.click(screen.getByText("Save pursuit"));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === "PATCH" &&
            (call.body as Record<string, unknown>)?.stage ===
              "RESEARCH_COMPLETE",
        ),
      ).toBe(true);
    });
  });

  it("adds a note interaction from the activity panel", async () => {
    const calls = installFetch();
    render(<PursuitsWorkspace />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Add event note")).toBeDefined();
    });
    fireEvent.change(screen.getByPlaceholderText("Add event note"), {
      target: { value: "Called vendor" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.url === "/api/pursuits/pursuit-1/interactions" &&
            call.method === "POST" &&
            (call.body as Record<string, unknown>)?.body === "Called vendor",
        ),
      ).toBe(true);
    });
  });
});
