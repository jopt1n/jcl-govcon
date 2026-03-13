import { vi } from "vitest";

// Use vi.hoisted to create the mock function before vi.mock hoisting
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn().mockResolvedValue({
    text: JSON.stringify({ classification: "GOOD", reasoning: "Great fit" }),
  }),
}));

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
      delete: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", noticeId: "notice_id", title: "title",
    classification: "classification", aiReasoning: "ai_reasoning",
    documentsAnalyzed: "documents_analyzed", updatedAt: "updated_at",
  },
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

vi.mock("@/lib/sam-gov/documents", () => ({
  downloadDocuments: vi.fn().mockResolvedValue([]),
  filterDownloadableLinks: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/ai/prompts", () => ({
  buildClassificationPrompt: vi.fn().mockReturnValue("test prompt text"),
}));

vi.mock("@/lib/utils", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { classifyContract, classifyContracts } from "@/lib/ai/classifier";
import { downloadDocuments } from "@/lib/sam-gov/documents";

const makeContract = (overrides: Partial<Parameters<typeof classifyContract>[0]> = {}) => ({
  id: "test-id",
  noticeId: "test-notice",
  title: "Test Contract",
  agency: "Test Agency",
  naicsCode: "541511",
  pscCode: "D301",
  noticeType: "Solicitation",
  setAsideType: "SBA",
  awardCeiling: "100000",
  descriptionText: "Test description",
  resourceLinks: null,
  ...overrides,
});

describe("classifyContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_GEMINI_API_KEY = "test-key";
    // Re-setup the default mock after clearAllMocks
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ classification: "GOOD", reasoning: "Great fit" }),
    });
  });

  afterEach(() => {
    delete process.env.GOOGLE_GEMINI_API_KEY;
  });

  it("returns GOOD classification on happy path", async () => {
    const result = await classifyContract(makeContract());

    expect(result.classification).toBe("GOOD");
    expect(result.reasoning).toBe("Great fit");
    expect(result.contractId).toBe("test-id");
    expect(result.noticeId).toBe("test-notice");
    expect(result.error).toBeUndefined();
  });

  it("sets documentsAnalyzed true when PDFs are downloaded", async () => {
    vi.mocked(downloadDocuments).mockResolvedValueOnce([
      {
        url: "https://example.com/file.pdf",
        filename: "file.pdf",
        contentType: "application/pdf",
        buffer: Buffer.from("pdf content"),
      },
    ]);

    const result = await classifyContract(makeContract({ resourceLinks: ["https://example.com/file.pdf"] }));
    expect(result.documentsAnalyzed).toBe(true);
  });

  it("sets documentsAnalyzed false when no PDFs downloaded", async () => {
    vi.mocked(downloadDocuments).mockResolvedValueOnce([]);
    const result = await classifyContract(makeContract());
    expect(result.documentsAnalyzed).toBe(false);
  });

  it("returns MAYBE with error message when Gemini throws", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Gemini API down"));

    const result = await classifyContract(makeContract());

    expect(result.classification).toBe("MAYBE");
    expect(result.reasoning).toContain("Classification failed");
    expect(result.error).toBe("Gemini API down");
  });

  it("updates database with classification result", async () => {
    await classifyContract(makeContract());
    expect(db.update).toHaveBeenCalled();
  });

  it("returns MAYBE when response text is undefined", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: undefined });

    const result = await classifyContract(makeContract());

    expect(result.classification).toBe("MAYBE");
    expect(result.reasoning).toContain("Failed to get AI response");
  });

  it("handles markdown-wrapped JSON response", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '```json\n{"classification": "DISCARD", "reasoning": "Not a fit"}\n```',
    });

    const result = await classifyContract(makeContract());

    expect(result.classification).toBe("DISCARD");
    expect(result.reasoning).toBe("Not a fit");
  });

  it("returns MAYBE for invalid classification value", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ classification: "EXCELLENT", reasoning: "Amazing" }),
    });

    const result = await classifyContract(makeContract());

    expect(result.classification).toBe("MAYBE");
    expect(result.reasoning).toContain("invalid classification");
  });

  it("returns MAYBE for malformed JSON response", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: "this is not json at all",
    });

    const result = await classifyContract(makeContract());

    expect(result.classification).toBe("MAYBE");
    expect(result.reasoning).toContain("Failed to parse AI response");
  });
});

describe("classifyContracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_GEMINI_API_KEY = "test-key";
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ classification: "GOOD", reasoning: "Great fit" }),
    });
  });

  afterEach(() => {
    delete process.env.GOOGLE_GEMINI_API_KEY;
  });

  it("processes all contracts sequentially", async () => {
    const contracts = [
      makeContract({ id: "id-1", noticeId: "notice-1" }),
      makeContract({ id: "id-2", noticeId: "notice-2" }),
      makeContract({ id: "id-3", noticeId: "notice-3" }),
    ];

    const results = await classifyContracts(contracts);

    expect(results).toHaveLength(3);
    expect(results[0].contractId).toBe("id-1");
    expect(results[1].contractId).toBe("id-2");
    expect(results[2].contractId).toBe("id-3");
  });

  it("returns all results even with partial failures", async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({ classification: "GOOD", reasoning: "Great" }),
      })
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValueOnce({
        text: JSON.stringify({ classification: "DISCARD", reasoning: "Not fit" }),
      });

    const contracts = [
      makeContract({ id: "id-1", noticeId: "notice-1" }),
      makeContract({ id: "id-2", noticeId: "notice-2" }),
      makeContract({ id: "id-3", noticeId: "notice-3" }),
    ];

    const results = await classifyContracts(contracts);

    expect(results).toHaveLength(3);
    expect(results[0].classification).toBe("GOOD");
    expect(results[1].classification).toBe("MAYBE");
    expect(results[1].error).toBe("API error");
    expect(results[2].classification).toBe("DISCARD");
  });
});

describe("buildContentParts (via classifyContract)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_GEMINI_API_KEY = "test-key";
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ classification: "GOOD", reasoning: "Great fit" }),
    });
  });

  afterEach(() => {
    delete process.env.GOOGLE_GEMINI_API_KEY;
  });

  it("sends PDFs as base64 inline data", async () => {
    const pdfBuffer = Buffer.from("fake pdf content");
    vi.mocked(downloadDocuments).mockResolvedValueOnce([
      {
        url: "https://example.com/doc.pdf",
        filename: "doc.pdf",
        contentType: "application/pdf",
        buffer: pdfBuffer,
      },
    ]);

    await classifyContract(makeContract({ resourceLinks: ["https://example.com/doc.pdf"] }));

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateContent.mock.calls[0][0];
    const parts = callArgs.contents[0].parts;
    const inlinePart = parts.find((p: any) => p.inlineData);
    expect(inlinePart).toBeDefined();
    expect(inlinePart.inlineData.mimeType).toBe("application/pdf");
    expect(inlinePart.inlineData.data).toBe(pdfBuffer.toString("base64"));
  });

  it("excludes non-PDF documents from content parts", async () => {
    vi.mocked(downloadDocuments).mockResolvedValueOnce([
      {
        url: "https://example.com/doc.docx",
        filename: "doc.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: Buffer.from("docx content"),
      },
    ]);

    await classifyContract(makeContract({ resourceLinks: ["https://example.com/doc.docx"] }));

    const callArgs = mockGenerateContent.mock.calls[0][0];
    const parts = callArgs.contents[0].parts;
    const inlineParts = parts.filter((p: any) => p.inlineData);
    expect(inlineParts).toHaveLength(0);
  });

  it("adds text prompt as the last part", async () => {
    vi.mocked(downloadDocuments).mockResolvedValueOnce([
      {
        url: "https://example.com/doc.pdf",
        filename: "doc.pdf",
        contentType: "application/pdf",
        buffer: Buffer.from("pdf content"),
      },
    ]);

    await classifyContract(makeContract({ resourceLinks: ["https://example.com/doc.pdf"] }));

    const callArgs = mockGenerateContent.mock.calls[0][0];
    const parts = callArgs.contents[0].parts;
    const lastPart = parts[parts.length - 1];
    expect(lastPart.text).toBeDefined();
    expect(lastPart.text).toBe("test prompt text");
  });
});
