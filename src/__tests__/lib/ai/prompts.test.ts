import {
  buildUnifiedClassificationPrompt,
  JCL_CAPABILITY_PROFILE,
  type UnifiedClassificationInput,
} from "@/lib/ai/prompts";

function makeInput(
  overrides: Partial<UnifiedClassificationInput> = {}
): UnifiedClassificationInput {
  return {
    title: "IT Support Services",
    agency: "Department of Defense",
    naicsCode: "541511",
    pscCode: "D301",
    noticeType: "Solicitation",
    setAsideType: "SBA",
    setAsideCode: "SBP",
    awardCeiling: "500000",
    responseDeadline: "2026-04-01T00:00:00Z",
    popState: "VA",
    descriptionText: "Provide IT support services.",
    documentTexts: [],
    ...overrides,
  };
}

describe("buildUnifiedClassificationPrompt", () => {
  it("includes JCL_CAPABILITY_PROFILE text", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain(JCL_CAPABILITY_PROFILE);
  });

  it("includes the title in metadata", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("Title: IT Support Services");
  });

  it("includes agency when provided", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("Agency: Department of Defense");
  });

  it("omits agency when null", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput({ agency: null }));
    expect(prompt).not.toContain("Agency:");
  });

  it("includes NAICS code when provided", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("NAICS Code: 541511");
  });

  it("includes award ceiling with $ prefix", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("Award Ceiling: $500000");
  });

  it("includes set-aside type and code", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("Set-Aside: SBA");
    expect(prompt).toContain("Set-Aside Code: SBP");
  });

  it("includes place of performance state", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("Place of Performance: VA");
  });

  it("truncates description to 15,000 chars", () => {
    const longDescription = "x".repeat(20000);
    const prompt = buildUnifiedClassificationPrompt(
      makeInput({ descriptionText: longDescription })
    );
    const descStart = prompt.indexOf("## Contract Description\n");
    expect(descStart).toBeGreaterThan(-1);
    const descContent = prompt.slice(descStart + "## Contract Description\n".length);
    const nextSection = descContent.indexOf("\n\n##");
    const xRegion = nextSection > -1 ? descContent.slice(0, nextSection) : descContent;
    const xCount = (xRegion.match(/x/g) ?? []).length;
    expect(xCount).toBe(15000);
  });

  it("truncates each document to 10,000 chars", () => {
    const longDoc = "\u2603".repeat(15000);
    const prompt = buildUnifiedClassificationPrompt(
      makeInput({ documentTexts: [longDoc] })
    );
    const charCount = (prompt.match(/\u2603/g) ?? []).length;
    expect(charCount).toBe(10000);
  });

  it("omits documents section when documentTexts is empty", () => {
    const prompt = buildUnifiedClassificationPrompt(
      makeInput({ documentTexts: [] })
    );
    expect(prompt).not.toContain("## Attached Document Content");
  });

  it("ends with JSON response format instruction", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("Respond with valid JSON only");
  });

  it("includes hard DISCARD rules", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("sole source");
    expect(prompt).toContain("opportunity has closed");
    expect(prompt).toContain("FedRAMP");
    expect(prompt).toContain("CMMC");
    expect(prompt).toContain("security clearance");
  });

  it("includes the feasibility test", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("Could one resourceful person");
    expect(prompt).toContain("credit card, basic tools, AI software");
  });

  it("includes action plan fields for GOOD/MAYBE", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("implementationSummary");
    expect(prompt).toContain("bidRange");
    expect(prompt).toContain("travelRequirements");
    expect(prompt).toContain("positiveSignals");
    expect(prompt).toContain("lowBarrierEntry");
    expect(prompt).toContain("contractType");
    expect(prompt).toContain("periodOfPerformance");
    expect(prompt).toContain("keyDates");
  });

  it("includes responseDeadline in metadata when provided", () => {
    const prompt = buildUnifiedClassificationPrompt(
      makeInput({ responseDeadline: "2026-04-01T00:00:00Z" })
    );
    expect(prompt).toContain("Response Deadline: 2026-04-01T00:00:00Z");
  });

  it("omits responseDeadline when null", () => {
    const prompt = buildUnifiedClassificationPrompt(
      makeInput({ responseDeadline: null })
    );
    expect(prompt).not.toContain("Response Deadline:");
  });

  it("omits null fields gracefully", () => {
    const prompt = buildUnifiedClassificationPrompt(
      makeInput({
        naicsCode: null,
        pscCode: null,
        agency: null,
        setAsideType: null,
        setAsideCode: null,
        popState: null,
        awardCeiling: null,
      })
    );
    expect(prompt).toContain("Title: IT Support Services");
    expect(prompt).not.toContain("NAICS Code:");
    expect(prompt).not.toContain("PSC Code:");
    expect(prompt).not.toContain("Agency:");
    expect(prompt).not.toContain("Set-Aside:");
    expect(prompt).not.toContain("Set-Aside Code:");
    expect(prompt).not.toContain("Place of Performance:");
    expect(prompt).not.toContain("Award Ceiling:");
  });

  it("includes today's date in the deadline check", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    const today = new Date().toISOString().split("T")[0];
    expect(prompt).toContain(today);
  });

  it("includes strong MAYBE bias instruction", () => {
    const prompt = buildUnifiedClassificationPrompt(makeInput());
    expect(prompt).toContain("When in doubt, ALWAYS classify as MAYBE");
    expect(prompt).toContain("Only classify as DISCARD when you are highly confident");
  });
});
