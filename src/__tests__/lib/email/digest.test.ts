import { vi } from "vitest";

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ id: "test-email-id" }),
}));

vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});

vi.mock("@/lib/db", () => {
  const createChain = () => {
    const chain: any = {};
    ["from","where","limit","offset","orderBy","groupBy","returning","onConflictDoNothing","onConflictDoUpdate","set","values"].forEach(m => {
      chain[m] = vi.fn().mockReturnValue(chain);
    });
    return chain;
  };
  return {
    db: {
      select: vi.fn().mockImplementation(() => createChain()),
      insert: vi.fn().mockImplementation(() => createChain()),
      update: vi.fn().mockImplementation(() => createChain()),
      delete: vi.fn().mockImplementation(() => createChain()),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  gte: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    classification: "classification",
    createdAt: "created_at",
  },
  settings: {
    key: "key",
  },
}));

import { db } from "@/lib/db";
import { sendDigest } from "@/lib/email/digest";

const makeContract = (overrides: Record<string, any> = {}) => ({
  id: "contract-1",
  noticeId: "notice-1",
  solicitationNumber: null,
  title: "Test IT Contract",
  agency: "Department of Test",
  naicsCode: "541511",
  pscCode: "D301",
  noticeType: "Solicitation",
  setAsideType: "SBA",
  awardCeiling: "150000",
  responseDeadline: new Date("2024-06-15"),
  postedDate: new Date("2024-01-01"),
  active: true,
  classification: "GOOD" as const,
  aiReasoning: "Strong software development fit for JCL capabilities",
  descriptionText: "Need software developer",
  userOverride: false,
  status: "IDENTIFIED" as const,
  notes: null,
  samUrl: "https://sam.gov/test",
  resourceLinks: [],
  rawJson: null,
  documentsAnalyzed: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

/**
 * Configure the db.select() mock to return specific values for sequential calls.
 * The digest function calls getSetting twice (digest_enabled, email_recipients)
 * then getNewContracts twice (GOOD, MAYBE).
 */
function setupSelectMocks(
  digestEnabled: boolean | null,
  recipients: string[] | null,
  goodContracts: any[],
  maybeContracts: any[]
) {
  let callCount = 0;

  vi.mocked(db.select).mockImplementation(() => {
    callCount++;
    const currentCall = callCount;

    const chain: any = {};
    ["from","where","limit","offset","orderBy","groupBy"].forEach(m => {
      chain[m] = vi.fn().mockReturnValue(chain);
    });

    // getSetting calls use .limit(1) as the terminal call
    if (currentCall === 1) {
      // digest_enabled setting
      chain.limit = vi.fn().mockResolvedValue(
        digestEnabled !== null ? [{ value: digestEnabled }] : []
      );
    } else if (currentCall === 2) {
      // email_recipients setting
      chain.limit = vi.fn().mockResolvedValue(
        recipients !== null ? [{ value: recipients }] : []
      );
    } else if (currentCall === 3) {
      // getNewContracts("GOOD") — no .limit(), .where() is terminal
      chain.where = vi.fn().mockResolvedValue(goodContracts);
    } else if (currentCall === 4) {
      // getNewContracts("MAYBE") — no .limit(), .where() is terminal
      chain.where = vi.fn().mockResolvedValue(maybeContracts);
    }

    return chain;
  });
}

describe("sendDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-resend-key";
    mockSend.mockResolvedValue({ id: "test-email-id" });
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("returns silent when digest_enabled is false", async () => {
    setupSelectMocks(false, null, [], []);

    const result = await sendDigest();

    expect(result.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns silent when no recipients", async () => {
    setupSelectMocks(true, [], [], []);

    const result = await sendDigest();

    expect(result.sent).toBe(false);
    expect(result.recipients).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns silent when no GOOD contracts even if MAYBE exist", async () => {
    const maybeContract = makeContract({ classification: "MAYBE" });
    setupSelectMocks(true, ["user@example.com"], [], [maybeContract]);

    const result = await sendDigest();

    expect(result.sent).toBe(false);
    expect(result.good).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends email when GOOD contracts exist", async () => {
    const goodContract = makeContract();
    setupSelectMocks(true, ["user@example.com"], [goodContract], []);

    const result = await sendDigest();

    expect(result.sent).toBe(true);
    expect(result.good).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("sends email with correct subject format", async () => {
    const goodContract = makeContract();
    setupSelectMocks(true, ["user@example.com"], [goodContract], []);

    await sendDigest();

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.subject).toContain("[GovCon]");
    expect(sendArgs.subject).toContain("1 New Opportunity");
  });

  it("limits MAYBE contracts to top 5", async () => {
    const goodContract = makeContract();
    const maybeContracts = Array.from({ length: 8 }, (_, i) =>
      makeContract({
        id: `maybe-${i}`,
        noticeId: `maybe-notice-${i}`,
        classification: "MAYBE",
        title: `Maybe Contract ${i}`,
      })
    );
    setupSelectMocks(true, ["user@example.com"], [goodContract], maybeContracts);

    const result = await sendDigest();

    expect(result.sent).toBe(true);
    expect(result.maybe).toBe(5); // limited to 5
  });

  it("formats null currency as N/A in email HTML", async () => {
    const goodContract = makeContract({ awardCeiling: null });
    setupSelectMocks(true, ["user@example.com"], [goodContract], []);

    await sendDigest();

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.html).toContain("N/A");
  });

  it("formats currency with $ and commas in email HTML", async () => {
    const goodContract = makeContract({ awardCeiling: "1500000" });
    setupSelectMocks(true, ["user@example.com"], [goodContract], []);

    await sendDigest();

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.html).toContain("$1,500,000");
  });

  it("handles null aiReasoning (truncate returns empty string)", async () => {
    const goodContract = makeContract({ aiReasoning: null });
    setupSelectMocks(true, ["user@example.com"], [goodContract], []);

    await sendDigest();

    // Should not throw and email should still be sent
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("truncates long aiReasoning with ellipsis in email HTML", async () => {
    const longReasoning = "A".repeat(200);
    const goodContract = makeContract({ aiReasoning: longReasoning });
    setupSelectMocks(true, ["user@example.com"], [goodContract], []);

    await sendDigest();

    const sendArgs = mockSend.mock.calls[0][0];
    expect(sendArgs.html).toContain("...");
    // Should not contain the full 200-char string (truncated at 120)
    expect(sendArgs.html).not.toContain("A".repeat(200));
  });
});
