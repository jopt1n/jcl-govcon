import { vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ classification: "GOOD", reasoning: "Strong IT match with description" }) } }],
  }),
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
  isNotNull: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", noticeId: "notice_id", title: "title", agency: "agency",
    naicsCode: "naics_code", pscCode: "psc_code", noticeType: "notice_type",
    setAsideType: "set_aside_type", awardCeiling: "award_ceiling",
    descriptionText: "description_text", classification: "classification",
    classifiedFromMetadata: "classified_from_metadata",
    descriptionFetched: "description_fetched",
    userOverride: "user_override", aiReasoning: "ai_reasoning",
    updatedAt: "updated_at",
  },
}));

vi.mock("@/lib/ai/grok-client", () => ({
  getGrokClient: vi.fn().mockReturnValue({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }),
  GROK_MODEL: "grok-4-1-fast-non-reasoning",
}));

vi.mock("@/lib/ai/prompts", () => ({
  buildUnifiedClassificationPrompt: vi.fn().mockReturnValue("test full prompt"),
}));

vi.mock("@/lib/ai/classifier", () => ({
  parseClassificationResponse: vi.fn().mockImplementation((text: string | undefined) => {
    if (!text) return { classification: "MAYBE", reasoning: "No response" };
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const classification = parsed.classification?.toUpperCase();
      if (!["GOOD", "MAYBE", "DISCARD"].includes(classification)) {
        return { classification: "MAYBE", reasoning: "Invalid classification" };
      }
      return { classification, reasoning: parsed.reasoning || "No reasoning" };
    } catch {
      return { classification: "MAYBE", reasoning: "Parse error" };
    }
  }),
}));

vi.mock("@/lib/utils", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { reclassifyWithDescription } from "@/lib/ai/reclassify-with-description";
import { buildUnifiedClassificationPrompt } from "@/lib/ai/prompts";
import { db } from "@/lib/db";

const makeContract = (overrides: Record<string, any> = {}) => ({
  id: "test-id",
  noticeId: "test-notice",
  title: "IT Support Services",
  agency: "GSA",
  naicsCode: "541511",
  pscCode: "D302",
  noticeType: "Solicitation",
  setAsideType: "SBA",
  awardCeiling: "250000",
  descriptionText: "Full description of IT services needed...",
  classification: "MAYBE",
  ...overrides,
});

describe("reclassifyWithDescription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetArgs = [];
    selectData = [];

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ classification: "GOOD", reasoning: "Strong IT match" }) } }],
    });
  });

  it("returns zeros when no eligible contracts found", async () => {
    selectData = [];
    const result = await reclassifyWithDescription();
    expect(result).toEqual({
      reclassified: 0, upgraded: 0, downgraded: 0, unchanged: 0, errors: 0,
    });
  });

  it("re-classifies contracts with full prompt", async () => {
    selectData = [makeContract()];

    const result = await reclassifyWithDescription();

    expect(result.reclassified).toBe(1);
    expect(buildUnifiedClassificationPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "IT Support Services",
        descriptionText: "Full description of IT services needed...",
        documentTexts: [],
      })
    );
  });

  it("sets classifiedFromMetadata to false after re-classification", async () => {
    selectData = [makeContract()];

    await reclassifyWithDescription();

    expect(db.update).toHaveBeenCalled();
    expect(updateSetArgs[0].classifiedFromMetadata).toBe(false);
  });

  it("tracks upgrades correctly (MAYBE -> GOOD)", async () => {
    selectData = [makeContract({ classification: "MAYBE" })];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: "GOOD", reasoning: "Upgraded" }) } }],
    });

    const result = await reclassifyWithDescription();

    expect(result.upgraded).toBe(1);
    expect(result.downgraded).toBe(0);
    expect(result.unchanged).toBe(0);
  });

  it("tracks downgrades correctly (GOOD -> DISCARD)", async () => {
    selectData = [makeContract({ classification: "GOOD" })];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: "DISCARD", reasoning: "Not relevant after full review" }) } }],
    });

    const result = await reclassifyWithDescription();

    expect(result.downgraded).toBe(1);
    expect(result.upgraded).toBe(0);
  });

  it("tracks unchanged correctly (MAYBE -> MAYBE)", async () => {
    selectData = [makeContract({ classification: "MAYBE" })];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: "MAYBE", reasoning: "Still ambiguous" }) } }],
    });

    const result = await reclassifyWithDescription();

    expect(result.unchanged).toBe(1);
  });

  it("handles API errors gracefully", async () => {
    selectData = [makeContract()];
    mockCreate.mockRejectedValueOnce(new Error("Rate limit exceeded"));

    const result = await reclassifyWithDescription();

    expect(result.errors).toBe(1);
    expect(result.reclassified).toBe(1);
  });

  it("processes multiple contracts with mixed results", async () => {
    selectData = [
      makeContract({ id: "c1", noticeId: "n1", classification: "MAYBE" }),
      makeContract({ id: "c2", noticeId: "n2", classification: "MAYBE" }),
      makeContract({ id: "c3", noticeId: "n3", classification: "GOOD" }),
    ];

    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ classification: "GOOD", reasoning: "Upgrade" }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ classification: "DISCARD", reasoning: "Downgrade" }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ classification: "GOOD", reasoning: "Same" }) } }] });

    const result = await reclassifyWithDescription();

    expect(result.reclassified).toBe(3);
    expect(result.upgraded).toBe(1);
    expect(result.downgraded).toBe(1);
    expect(result.unchanged).toBe(1);
  });

  it("sends correct config to Grok", async () => {
    selectData = [makeContract()];

    await reclassifyWithDescription();

    expect(mockCreate).toHaveBeenCalledWith({
      model: "grok-4-1-fast-non-reasoning",
      temperature: 0,
      messages: [{ role: "user", content: "test full prompt" }],
      response_format: { type: "json_object" },
    });
  });
});
