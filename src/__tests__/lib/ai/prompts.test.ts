import {
  buildClassificationPrompt,
  buildMetadataClassificationPrompt,
  JCL_CAPABILITY_PROFILE,
  type ClassificationPromptInput,
  type MetadataClassificationInput,
} from "@/lib/ai/prompts";

function makeInput(
  overrides: Partial<ClassificationPromptInput> = {}
): ClassificationPromptInput {
  return {
    title: "IT Support Services",
    agency: "Department of Defense",
    naicsCode: "541511",
    pscCode: "D301",
    noticeType: "Solicitation",
    setAsideType: "SBA",
    awardCeiling: "500000",
    responseDeadline: "2026-04-01T00:00:00Z",
    descriptionText: "Provide IT support services.",
    documentTexts: [],
    ...overrides,
  };
}

describe("buildClassificationPrompt", () => {
  it("includes JCL_CAPABILITY_PROFILE text", () => {
    const prompt = buildClassificationPrompt(makeInput());
    expect(prompt).toContain(JCL_CAPABILITY_PROFILE);
  });

  it("includes the title in metadata", () => {
    const prompt = buildClassificationPrompt(makeInput());
    expect(prompt).toContain("Title: IT Support Services");
  });

  it("includes agency when provided", () => {
    const prompt = buildClassificationPrompt(makeInput());
    expect(prompt).toContain("Agency: Department of Defense");
  });

  it("omits agency when null", () => {
    const prompt = buildClassificationPrompt(makeInput({ agency: null }));
    expect(prompt).not.toContain("Agency:");
  });

  it("includes NAICS code when provided", () => {
    const prompt = buildClassificationPrompt(makeInput());
    expect(prompt).toContain("NAICS Code: 541511");
  });

  it("includes award ceiling with $ prefix", () => {
    const prompt = buildClassificationPrompt(makeInput());
    expect(prompt).toContain("Award Ceiling: $500000");
  });

  it("truncates description to 15,000 chars", () => {
    const longDescription = "x".repeat(20000);
    const prompt = buildClassificationPrompt(
      makeInput({ descriptionText: longDescription })
    );
    const descStart = prompt.indexOf("## Contract Description\n");
    expect(descStart).toBeGreaterThan(-1);
    const descContent = prompt.slice(descStart + "## Contract Description\n".length);
    // Count only the x's that come before the next section
    const nextSection = descContent.indexOf("\n\n##");
    const xRegion = nextSection > -1 ? descContent.slice(0, nextSection) : descContent;
    const xCount = (xRegion.match(/x/g) ?? []).length;
    expect(xCount).toBe(15000);
  });

  it("truncates each document to 10,000 chars", () => {
    // Use a char unlikely to appear in the prompt template
    const longDoc = "\u2603".repeat(15000); // snowman
    const prompt = buildClassificationPrompt(
      makeInput({ documentTexts: [longDoc] })
    );
    const charCount = (prompt.match(/\u2603/g) ?? []).length;
    expect(charCount).toBe(10000);
  });

  it("omits documents section when documentTexts is empty", () => {
    const prompt = buildClassificationPrompt(
      makeInput({ documentTexts: [] })
    );
    expect(prompt).not.toContain("## Attached Document Content");
  });

  it("ends with JSON response format instruction", () => {
    const prompt = buildClassificationPrompt(makeInput());
    expect(prompt).toContain("Respond with valid JSON only");
    expect(prompt).toContain('"classification": "GOOD" | "MAYBE" | "DISCARD"');
  });

  it("includes sole-source DISCARD rule", () => {
    const prompt = buildClassificationPrompt(makeInput());
    expect(prompt).toContain("sole-source awards");
    expect(prompt).toContain("sole source");
    expect(prompt).toContain("not a request for competitive quotes");
  });

  it("includes expired deadline DISCARD rule", () => {
    const prompt = buildClassificationPrompt(makeInput());
    expect(prompt).toContain("response deadline has already passed");
    expect(prompt).toContain("opportunity has closed");
  });

  it("includes responseDeadline in metadata when provided", () => {
    const prompt = buildClassificationPrompt(
      makeInput({ responseDeadline: "2026-04-01T00:00:00Z" })
    );
    expect(prompt).toContain("Response Deadline: 2026-04-01T00:00:00Z");
  });

  it("omits responseDeadline when null", () => {
    const prompt = buildClassificationPrompt(
      makeInput({ responseDeadline: null })
    );
    expect(prompt).not.toContain("Response Deadline:");
  });
});

// ── Metadata Classification Prompt ────────────────────────────────────────

function makeMetadataInput(
  overrides: Partial<MetadataClassificationInput> = {}
): MetadataClassificationInput {
  return {
    title: "IT Support Services",
    naicsCode: "541511",
    pscCode: "D301",
    agency: "Department of Defense",
    orgPathName: "DOD > Army",
    noticeType: "Solicitation",
    setAsideType: "SBA",
    setAsideCode: "SBP",
    popState: "VA",
    awardCeiling: "500000",
    ...overrides,
  };
}

describe("buildMetadataClassificationPrompt", () => {
  it("includes the title", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("Title: IT Support Services");
  });

  it("includes NAICS code when provided", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("NAICS Code: 541511");
  });

  it("includes set-aside type and code", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("Set-Aside: SBA");
    expect(prompt).toContain("Set-Aside Code: SBP");
  });

  it("includes organization path", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("Organization: DOD > Army");
  });

  it("includes place of performance state", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("Place of Performance: VA");
  });

  it("includes award ceiling with $ prefix", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("Award Ceiling: $500000");
  });

  it("omits null fields gracefully", () => {
    const prompt = buildMetadataClassificationPrompt(
      makeMetadataInput({
        naicsCode: null,
        pscCode: null,
        agency: null,
        orgPathName: null,
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
    expect(prompt).not.toContain("Organization:");
    expect(prompt).not.toContain("Set-Aside:");
    expect(prompt).not.toContain("Place of Performance:");
    expect(prompt).not.toContain("Award Ceiling:");
  });

  it("includes NAICS code hints section", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("541511");
    expect(prompt).toContain("Likely relevant");
    expect(prompt).toContain("Likely irrelevant");
  });

  it("includes set-aside boost section", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("Set-Aside Boost");
    expect(prompt).toContain("SBA, SBP, 8A, 8AN");
  });

  it("includes METADATA-ONLY TRIAGE mode indicator", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("METADATA-ONLY TRIAGE");
  });

  it("does NOT include JCL_CAPABILITY_PROFILE (uses its own summary)", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).not.toContain(JCL_CAPABILITY_PROFILE);
  });

  it("ends with JSON response format instruction", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("Respond with valid JSON only");
    expect(prompt).toContain('"classification": "GOOD" | "MAYBE" | "DISCARD"');
  });

  it("includes insufficient information guidance", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("very little information to judge");
    expect(prompt).toContain("classify as MAYBE");
  });

  it("includes conservative classification guidance", () => {
    const prompt = buildMetadataClassificationPrompt(makeMetadataInput());
    expect(prompt).toContain("When in doubt, classify as MAYBE");
  });
});
