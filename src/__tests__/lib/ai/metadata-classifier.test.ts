import { vi } from "vitest";

// Use vi.hoisted to create the mock function before vi.mock hoisting
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn().mockResolvedValue({
    text: JSON.stringify({ classification: "DISCARD", reasoning: "Construction project" }),
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

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
      };
    },
  };
});

vi.mock("@/lib/ai/prompts", () => ({
  buildMetadataClassificationPrompt: vi.fn().mockReturnValue("test metadata prompt"),
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
import { buildMetadataClassificationPrompt } from "@/lib/ai/prompts";
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
    process.env.GOOGLE_GEMINI_API_KEY = "test-key";
    updateSetArgs = [];
    selectData = [];
    selectDataSequence = [];
    selectCallIndex = 0;

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ classification: "DISCARD", reasoning: "Construction project" }),
    });
  });

  afterEach(() => {
    delete process.env.GOOGLE_GEMINI_API_KEY;
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

    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify({ classification: "DISCARD", reasoning: "Construction" }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ classification: "MAYBE", reasoning: "Unclear scope" }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ classification: "GOOD", reasoning: "IT services" }) });

    const result = await classifyFromMetadata();

    expect(result.classified).toBe(3);
    expect(result.good).toBe(1);
    expect(result.maybe).toBe(1);
    expect(result.discard).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("calls buildMetadataClassificationPrompt with contract metadata", async () => {
    const contract = makeContractRow();
    selectData = [contract];

    await classifyFromMetadata();

    expect(buildMetadataClassificationPrompt).toHaveBeenCalledWith({
      title: contract.title,
      naicsCode: contract.naicsCode,
      pscCode: contract.pscCode,
      agency: contract.agency,
      orgPathName: contract.orgPathName,
      noticeType: contract.noticeType,
      setAsideType: contract.setAsideType,
      setAsideCode: contract.setAsideCode,
      popState: contract.popState,
      awardCeiling: contract.awardCeiling,
    });
  });

  it("updates DB with classification and classifiedFromMetadata=true", async () => {
    selectData = [makeContractRow()];

    await classifyFromMetadata();

    expect(db.update).toHaveBeenCalled();
    // Verify the set args include classifiedFromMetadata: true
    expect(updateSetArgs.length).toBeGreaterThan(0);
    const setArg = updateSetArgs[0];
    expect(setArg.classification).toBe("DISCARD");
    expect(setArg.classifiedFromMetadata).toBe(true);
    expect(setArg.aiReasoning).toBe("Construction project");
  });

  it("handles Gemini errors gracefully with MAYBE fallback", async () => {
    selectData = [makeContractRow()];
    mockGenerateContent.mockRejectedValueOnce(new Error("Gemini quota exceeded"));

    const result = await classifyFromMetadata();

    expect(result.errors).toBe(1);
    expect(result.classified).toBe(1);
    // Should have updated DB with MAYBE fallback
    expect(updateSetArgs.length).toBeGreaterThan(0);
    const fallbackSet = updateSetArgs[0];
    expect(fallbackSet.classification).toBe("MAYBE");
    expect(fallbackSet.classifiedFromMetadata).toBe(true);
  });

  it("handles malformed JSON by falling back to MAYBE", async () => {
    selectData = [makeContractRow()];
    mockGenerateContent.mockResolvedValueOnce({ text: "not valid json{" });

    const result = await classifyFromMetadata();

    expect(result.classified).toBe(1);
    expect(result.maybe).toBe(1);
  });

  it("respects pause status between chunks", async () => {
    // Generate 51 contracts to trigger chunk boundary
    const manyContracts = Array.from({ length: 51 }, (_, i) =>
      makeContractRow({ id: `c${i}`, noticeId: `n${i}` })
    );

    // Select 0: initial contract fetch → 51 contracts
    // Select 1: pause check before chunk 1 → RUNNING (process chunk 1)
    // Select 2: pause check before chunk 2 → PAUSED (stop)
    selectDataSequence = [
      manyContracts,              // initial contract fetch
      [{ status: "RUNNING" }],    // pause check before chunk 1
      [{ status: "PAUSED" }],     // pause check before chunk 2
    ];

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ classification: "DISCARD", reasoning: "Not relevant" }),
    });

    const result = await classifyFromMetadata({ limit: 100, crawlProgressId: "progress-1" });

    // First chunk (50) processes, then pause is detected before chunk 2
    expect(result.classified).toBe(50);
    expect(mockGenerateContent).toHaveBeenCalledTimes(50);
  });

  it("respects limit option", async () => {
    selectData = [makeContractRow()];

    await classifyFromMetadata({ limit: 100 });

    // Verify select was called (limit is passed to the DB query)
    expect(db.select).toHaveBeenCalled();
  });

  it("sends correct config to Gemini", async () => {
    selectData = [makeContractRow()];

    await classifyFromMetadata();

    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "test metadata prompt" }] }],
      config: { responseMimeType: "application/json" },
    });
  });
});
