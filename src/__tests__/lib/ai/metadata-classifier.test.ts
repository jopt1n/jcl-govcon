import { vi } from "vitest";

// Use vi.hoisted to create the mock function before vi.mock hoisting
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ classification: "DISCARD", reasoning: "Construction project" }) } }],
  }),
}));

// Track DB update calls for verification
let updateSetArgs: any[] = [];
let selectData: any[] = [];
let selectCallIndex = 0;
let selectDataSequence: any[][] = [];

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
      select: vi.fn().mockImplementation((..._args: any[]) => {
        const data = selectDataSequence.length > 0
          ? selectDataSequence[selectCallIndex++ % selectDataSequence.length]
          : selectData;
        return createChain(data);
      }),
      update: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", noticeId: "notice_id", title: "title", agency: "agency",
    naicsCode: "naics_code", pscCode: "psc_code", noticeType: "notice_type",
    setAsideType: "set_aside_type", setAsideCode: "set_aside_code",
    awardCeiling: "award_ceiling", classification: "classification",
    classifiedFromMetadata: "classified_from_metadata",
    orgPathName: "org_path_name", popState: "pop_state",
    postedDate: "posted_date", aiReasoning: "ai_reasoning",
    updatedAt: "updated_at",
  },
  crawlProgress: { id: "id", status: "status", classified: "classified", updatedAt: "updated_at" },
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
  buildUnifiedClassificationPrompt: vi.fn().mockReturnValue("test metadata prompt"),
}));

vi.mock("@/lib/ai/classifier", () => ({
  parseClassificationResponse: vi.fn().mockImplementation((text: string | undefined) => {
    if (!text) {
      return { classification: "MAYBE", reasoning: "Failed to get AI response" };
    }
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const classification = parsed.classification?.toUpperCase();
      if (!["GOOD", "MAYBE", "DISCARD"].includes(classification)) {
        return { classification: "MAYBE", reasoning: `Invalid classification "${parsed.classification}"` };
      }
      return { classification, reasoning: parsed.reasoning || "No reasoning" };
    } catch {
      return { classification: "MAYBE", reasoning: `Failed to parse: ${text.slice(0, 200)}` };
    }
  }),
}));

vi.mock("@/lib/utils", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { classifyFromMetadata } from "@/lib/ai/metadata-classifier";
import { buildUnifiedClassificationPrompt } from "@/lib/ai/prompts";
import { db } from "@/lib/db";

const makeContractRow = (overrides: Record<string, any> = {}) => ({
  id: "test-id",
  noticeId: "test-notice",
  title: "Highway Bridge Repair",
  naicsCode: "237310",
  pscCode: "Z2AA",
  agency: "Department of Transportation",
  orgPathName: "DOT > FHWA",
  noticeType: "Solicitation",
  setAsideType: "SBA",
  setAsideCode: "SBP",
  popState: "VA",
  awardCeiling: "500000",
  ...overrides,
});

describe("classifyFromMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetArgs = [];
    selectData = [];
    selectDataSequence = [];
    selectCallIndex = 0;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ classification: "DISCARD", reasoning: "Construction project" }) } }],
    });
  });

  it("returns zeros when no pending contracts found", async () => {
    selectData = [];
    const result = await classifyFromMetadata();
    expect(result).toEqual({ classified: 0, good: 0, maybe: 0, discard: 0, errors: 0 });
  });

  it("classifies contracts and returns correct counts", async () => {
    selectData = [
      makeContractRow({ id: "c1", noticeId: "n1" }),
      makeContractRow({ id: "c2", noticeId: "n2" }),
      makeContractRow({ id: "c3", noticeId: "n3", title: "IT Support Services", naicsCode: "541511" }),
    ];

    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ classification: "DISCARD", reasoning: "Construction" }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ classification: "MAYBE", reasoning: "Unclear scope" }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ classification: "GOOD", reasoning: "IT services" }) } }] });

    const result = await classifyFromMetadata();

    expect(result.classified).toBe(3);
    expect(result.good).toBe(1);
    expect(result.maybe).toBe(1);
    expect(result.discard).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("calls buildUnifiedClassificationPrompt with contract metadata", async () => {
    const contract = makeContractRow();
    selectData = [contract];

    await classifyFromMetadata();

    expect(buildUnifiedClassificationPrompt).toHaveBeenCalledWith({
      title: contract.title,
      naicsCode: contract.naicsCode,
      pscCode: contract.pscCode,
      agency: contract.agency,
      noticeType: contract.noticeType,
      setAsideType: contract.setAsideType,
      setAsideCode: contract.setAsideCode,
      popState: contract.popState,
      awardCeiling: contract.awardCeiling,
      responseDeadline: null,
      descriptionText: null,
      documentTexts: [],
    });
  });

  it("updates DB with classification and classifiedFromMetadata=true", async () => {
    selectData = [makeContractRow()];

    await classifyFromMetadata();

    expect(db.update).toHaveBeenCalled();
    expect(updateSetArgs.length).toBeGreaterThan(0);
    const setArg = updateSetArgs[0];
    expect(setArg.classification).toBe("DISCARD");
    expect(setArg.classifiedFromMetadata).toBe(true);
    expect(setArg.aiReasoning).toBe("Construction project");
  });

  it("skips contract on API error without marking it classified", async () => {
    selectData = [makeContractRow()];
    mockCreate.mockRejectedValueOnce(new Error("Rate limit exceeded"));

    const result = await classifyFromMetadata();

    expect(result.errors).toBe(1);
    expect(result.classified).toBe(0);
    expect(updateSetArgs.length).toBe(0);
  });

  it("handles malformed JSON by falling back to MAYBE", async () => {
    selectData = [makeContractRow()];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not valid json{" } }],
    });

    const result = await classifyFromMetadata();

    expect(result.classified).toBe(1);
    expect(result.maybe).toBe(1);
  });

  it("respects pause status between chunks", async () => {
    const manyContracts = Array.from({ length: 51 }, (_, i) =>
      makeContractRow({ id: `c${i}`, noticeId: `n${i}` })
    );

    selectDataSequence = [
      manyContracts,
      [{ status: "RUNNING" }],
      [{ status: "PAUSED" }],
    ];

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ classification: "DISCARD", reasoning: "Not relevant" }) } }],
    });

    const result = await classifyFromMetadata({ limit: 100, crawlProgressId: "progress-1" });

    expect(result.classified).toBe(50);
    expect(mockCreate).toHaveBeenCalledTimes(50);
  });

  it("respects limit option", async () => {
    selectData = [makeContractRow()];

    await classifyFromMetadata({ limit: 100 });

    expect(db.select).toHaveBeenCalled();
  });

  it("sends correct config to Grok", async () => {
    selectData = [makeContractRow()];

    await classifyFromMetadata();

    expect(mockCreate).toHaveBeenCalledWith({
      model: "grok-4-1-fast-non-reasoning",
      temperature: 0,
      messages: [{ role: "user", content: "test metadata prompt" }],
      response_format: { type: "json_object" },
    });
  });
});
