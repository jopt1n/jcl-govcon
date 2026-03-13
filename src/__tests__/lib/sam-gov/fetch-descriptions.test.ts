import { vi } from "vitest";

const { mockCanMakeCall, mockFetchDescription } = vi.hoisted(() => ({
  mockCanMakeCall: vi.fn().mockResolvedValue(true),
  mockFetchDescription: vi.fn().mockResolvedValue("Full description text here"),
}));

let updateSetArgs: any[] = [];
let selectData: any[] = [];

vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: unknown = []) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(resolveValue);
        }
        if (prop === "set") {
          return vi.fn().mockImplementation((args: any) => {
            updateSetArgs.push(args);
            return new Proxy({}, handler);
          });
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => createChain(selectData)),
      update: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", noticeId: "notice_id", classification: "classification",
    descriptionFetched: "description_fetched", descriptionText: "description_text",
    rawJson: "raw_json", updatedAt: "updated_at",
  },
}));

vi.mock("@/lib/sam-gov/client", () => ({
  canMakeCall: mockCanMakeCall,
  fetchDescription: mockFetchDescription,
}));

vi.mock("@/lib/utils", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { fetchDescriptionsForRelevant } from "@/lib/sam-gov/fetch-descriptions";
import { db } from "@/lib/db";

const makeContract = (overrides: Record<string, any> = {}) => ({
  id: "test-id",
  noticeId: "test-notice",
  rawJson: { description: "https://api.sam.gov/opportunities/v2/search/description/test" },
  ...overrides,
});

describe("fetchDescriptionsForRelevant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetArgs = [];
    selectData = [];
    mockCanMakeCall.mockResolvedValue(true);
    mockFetchDescription.mockResolvedValue("Full description text here");
  });

  it("returns zeros when no eligible contracts found", async () => {
    selectData = [];
    const result = await fetchDescriptionsForRelevant();
    expect(result).toEqual({ fetched: 0, errors: 0, stoppedAtLimit: false });
  });

  it("fetches descriptions and updates DB", async () => {
    selectData = [makeContract()];

    const result = await fetchDescriptionsForRelevant();

    expect(result.fetched).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockFetchDescription).toHaveBeenCalledWith(
      "https://api.sam.gov/opportunities/v2/search/description/test"
    );
    expect(db.update).toHaveBeenCalled();
    expect(updateSetArgs[0].descriptionFetched).toBe(true);
    expect(updateSetArgs[0].descriptionText).toBe("Full description text here");
  });

  it("handles missing description URL by marking as fetched", async () => {
    selectData = [makeContract({ rawJson: {} })];

    const result = await fetchDescriptionsForRelevant();

    expect(result.fetched).toBe(1);
    expect(mockFetchDescription).not.toHaveBeenCalled();
    expect(updateSetArgs[0].descriptionFetched).toBe(true);
  });

  it("handles 'null' string description URL", async () => {
    selectData = [makeContract({ rawJson: { description: "null" } })];

    const result = await fetchDescriptionsForRelevant();

    expect(result.fetched).toBe(1);
    expect(mockFetchDescription).not.toHaveBeenCalled();
  });

  it("cleans null-like response text", async () => {
    selectData = [makeContract()];
    mockFetchDescription.mockResolvedValueOnce("null");

    const result = await fetchDescriptionsForRelevant();

    expect(result.fetched).toBe(1);
    expect(updateSetArgs[0].descriptionText).toBeNull();
  });

  it("cleans 'Description not found' response", async () => {
    selectData = [makeContract()];
    mockFetchDescription.mockResolvedValueOnce("Description not found");

    await fetchDescriptionsForRelevant();

    expect(updateSetArgs[0].descriptionText).toBeNull();
  });

  it("stops when rate limit is reached", async () => {
    selectData = [
      makeContract({ id: "c1", noticeId: "n1" }),
      makeContract({ id: "c2", noticeId: "n2" }),
    ];
    mockCanMakeCall.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await fetchDescriptionsForRelevant();

    expect(result.fetched).toBe(1);
    expect(result.stoppedAtLimit).toBe(true);
    expect(mockFetchDescription).toHaveBeenCalledTimes(1);
  });

  it("handles fetch errors gracefully", async () => {
    selectData = [makeContract()];
    mockFetchDescription.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchDescriptionsForRelevant();

    expect(result.errors).toBe(1);
    // Should still mark as fetched to avoid retries
    expect(updateSetArgs[0].descriptionFetched).toBe(true);
  });

  it("processes multiple contracts", async () => {
    selectData = [
      makeContract({ id: "c1", noticeId: "n1" }),
      makeContract({ id: "c2", noticeId: "n2" }),
      makeContract({ id: "c3", noticeId: "n3" }),
    ];

    const result = await fetchDescriptionsForRelevant();

    expect(result.fetched).toBe(3);
    expect(mockFetchDescription).toHaveBeenCalledTimes(3);
  });
});
