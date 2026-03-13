import { vi } from "vitest";

// Use Proxy-based mock so any chain of method calls works
vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: unknown = []) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(resolveValue);
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => createChain([])),
      insert: vi.fn().mockImplementation(() => createChain([])),
      update: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  apiUsage: { date: "date", searchCalls: "search_calls", docFetches: "doc_fetches" },
}));

import { db } from "@/lib/db";
import { formatSamDate, searchOpportunities, fetchDescription, getTodayUsage, canMakeCall } from "@/lib/sam-gov/client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("formatSamDate", () => {
  it("pads single-digit months with leading zeros", () => {
    const date = new Date(2024, 0, 15); // January 15
    expect(formatSamDate(date)).toBe("01/15/2024");
  });

  it("pads single-digit days with leading zeros", () => {
    const date = new Date(2024, 0, 5); // January 5
    expect(formatSamDate(date)).toBe("01/05/2024");
  });

  it("handles double-digit month and day correctly", () => {
    const date = new Date(2024, 11, 25); // December 25
    expect(formatSamDate(date)).toBe("12/25/2024");
  });
});

describe("searchOpportunities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SAM_GOV_API_KEY = "test-key";
    delete process.env.SAM_DRY_RUN;
  });

  afterEach(() => {
    delete process.env.SAM_GOV_API_KEY;
    delete process.env.SAM_DRY_RUN;
  });

  it("constructs correct URL with all params", async () => {
    const mockResponse = { totalRecords: 1, opportunitiesData: [] };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    await searchOpportunities({
      ptype: "o,k",
      limit: 500,
      offset: 100,
      postedFrom: "01/01/2024",
      postedTo: "01/31/2024",
      active: "Yes",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe("https://api.sam.gov/opportunities/v2/search");
    expect(calledUrl.searchParams.get("api_key")).toBe("test-key");
    expect(calledUrl.searchParams.get("ptype")).toBe("o,k");
    expect(calledUrl.searchParams.get("limit")).toBe("500");
    expect(calledUrl.searchParams.get("offset")).toBe("100");
    expect(calledUrl.searchParams.get("postedFrom")).toBe("01/01/2024");
    expect(calledUrl.searchParams.get("postedTo")).toBe("01/31/2024");
    expect(calledUrl.searchParams.get("active")).toBe("Yes");
  });

  it("throws on non-OK response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("server error"),
    });

    await expect(searchOpportunities({ ptype: "o" })).rejects.toThrow(
      "SAM.gov API error 500"
    );
  });

  it("throws when API key is missing", async () => {
    delete process.env.SAM_GOV_API_KEY;

    await expect(searchOpportunities({ ptype: "o" })).rejects.toThrow(
      "SAM_GOV_API_KEY environment variable is not set"
    );
  });

  it("defaults limit to 1000 and offset to 0", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ totalRecords: 0, opportunitiesData: [] }),
    });

    await searchOpportunities({ ptype: "o" });

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("limit")).toBe("1000");
    expect(calledUrl.searchParams.get("offset")).toBe("0");
  });

  it("returns empty result in DRY_RUN mode without calling fetch", async () => {
    process.env.SAM_DRY_RUN = "true";

    const result = await searchOpportunities({ ptype: "o" });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual({ totalRecords: 0, opportunitiesData: [] });
  });
});

describe("fetchDescription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SAM_GOV_API_KEY = "test-key";
    delete process.env.SAM_DRY_RUN;
  });

  afterEach(() => {
    delete process.env.SAM_GOV_API_KEY;
    delete process.env.SAM_DRY_RUN;
  });

  it("uses ? separator when no existing query params", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("description text"),
    });

    const result = await fetchDescription("https://api.sam.gov/opportunities/v2/desc/123");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://api.sam.gov/opportunities/v2/desc/123?api_key=test-key");
    expect(result).toBe("description text");
  });

  it("uses & separator when URL already has query params", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("description text"),
    });

    await fetchDescription("https://api.sam.gov/opportunities/v2/desc/123?format=json");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "https://api.sam.gov/opportunities/v2/desc/123?format=json&api_key=test-key"
    );
  });

  it("throws on non-OK response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("not found"),
    });

    await expect(
      fetchDescription("https://api.sam.gov/opportunities/v2/desc/123")
    ).rejects.toThrow("SAM.gov description fetch error 404");
  });

  it("returns empty string in DRY_RUN mode without calling fetch", async () => {
    process.env.SAM_DRY_RUN = "true";

    const result = await fetchDescription("https://api.sam.gov/opportunities/v2/desc/123");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toBe("");
  });
});

describe("getTodayUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros when no row exists", async () => {
    // Default mock returns [], so getTodayUsage should return zeros
    const result = await getTodayUsage();
    expect(result).toEqual({ searchCalls: 0, docFetches: 0 });
  });

  it("returns stored values when row exists", async () => {
    const createChainWithData = () => {
      const handler: ProxyHandler<object> = {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) =>
              resolve([{ searchCalls: 5, docFetches: 10 }]);
          }
          return vi.fn().mockReturnValue(new Proxy({}, handler));
        },
      };
      return new Proxy({}, handler);
    };

    vi.mocked(db.select).mockImplementationOnce(() => createChainWithData() as any);

    const result = await getTodayUsage();
    expect(result).toEqual({ searchCalls: 5, docFetches: 10 });
  });
});

describe("canMakeCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SAM_DAILY_LIMIT = "950";
  });

  afterEach(() => {
    delete process.env.SAM_DAILY_LIMIT;
  });

  it("returns true when no usage row exists (zero calls today)", async () => {
    const result = await canMakeCall();
    expect(result).toBe(true);
  });

  it("returns true when under the limit", async () => {
    const createChainWithData = () => {
      const handler: ProxyHandler<object> = {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) =>
              resolve([{ searchCalls: 100, docFetches: 0 }]);
          }
          return vi.fn().mockReturnValue(new Proxy({}, handler));
        },
      };
      return new Proxy({}, handler);
    };

    vi.mocked(db.select).mockImplementationOnce(() => createChainWithData() as any);

    const result = await canMakeCall();
    expect(result).toBe(true);
  });

  it("returns false when at or over the limit", async () => {
    const createChainWithData = () => {
      const handler: ProxyHandler<object> = {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) =>
              resolve([{ searchCalls: 950, docFetches: 0 }]);
          }
          return vi.fn().mockReturnValue(new Proxy({}, handler));
        },
      };
      return new Proxy({}, handler);
    };

    vi.mocked(db.select).mockImplementationOnce(() => createChainWithData() as any);

    const result = await canMakeCall();
    expect(result).toBe(false);
  });
});
