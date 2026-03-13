import { mapOpportunityToContract } from "@/lib/sam-gov/mappers";
import type { SamOpportunity } from "@/lib/sam-gov/types";

function makeOpportunity(
  overrides: Partial<SamOpportunity> = {}
): SamOpportunity {
  return {
    noticeId: "OPP-001",
    solicitationNumber: "SOL-123",
    title: "Test Contract Title",
    fullParentPathName: "Department of Defense.Army",
    fullParentPathCode: "097.21",
    naicsCode: "541511",
    classificationCode: "D301",
    type: "Solicitation",
    baseType: "Solicitation",
    typeOfSetAside: "SBA",
    archiveDate: null,
    responseDeadDate: "2026-06-01T00:00:00Z",
    postedDate: "2026-03-01T00:00:00Z",
    active: "Yes",
    description: "A test opportunity",
    uiLink: "https://sam.gov/opp/OPP-001",
    resourceLinks: [
      { url: "https://sam.gov/doc1.pdf", description: "SOW" },
      { url: "https://sam.gov/doc2.pdf", description: null },
    ],
    award: { amount: "500000", date: null, number: null, awardee: null },
    pointOfContact: null,
    officeAddress: null,
    placeOfPerformance: null,
    additionalInfoLink: null,
    organizationType: null,
    ...overrides,
  };
}

describe("mapOpportunityToContract", () => {
  it("maps noticeId and title directly", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.noticeId).toBe("OPP-001");
    expect(result.title).toBe("Test Contract Title");
  });

  it("maps fullParentPathName to agency", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.agency).toBe("Department of Defense.Army");
  });

  it("maps classificationCode to pscCode", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.pscCode).toBe("D301");
  });

  it("maps type to noticeType", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.noticeType).toBe("Solicitation");
  });

  it("maps typeOfSetAside to setAsideType", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.setAsideType).toBe("SBA");
  });

  it("parses responseDeadDate into a Date object", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.responseDeadline).toBeInstanceOf(Date);
    expect(result.responseDeadline!.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z"
    );
  });

  it("parses postedDate into a Date object", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.postedDate).toBeInstanceOf(Date);
    expect(result.postedDate.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it('converts active "Yes" to true and "No" to false', () => {
    const yesResult = mapOpportunityToContract(
      makeOpportunity({ active: "Yes" })
    );
    expect(yesResult.active).toBe(true);

    const noResult = mapOpportunityToContract(
      makeOpportunity({ active: "No" })
    );
    expect(noResult.active).toBe(false);
  });

  it("returns null awardCeiling when award is null", () => {
    const result = mapOpportunityToContract(
      makeOpportunity({ award: null })
    );
    expect(result.awardCeiling).toBeNull();
  });

  it("returns empty array for resourceLinks when null", () => {
    const result = mapOpportunityToContract(
      makeOpportunity({ resourceLinks: null })
    );
    expect(result.resourceLinks).toEqual([]);
  });

  it("stores the full opportunity as rawJson", () => {
    const opp = makeOpportunity();
    const result = mapOpportunityToContract(opp);
    expect(result.rawJson).toEqual(opp);
  });

  it("maps orgPathName and orgPathCode", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.orgPathName).toBe("Department of Defense.Army");
    expect(result.orgPathCode).toBe("097.21");
  });

  it("maps place of performance fields", () => {
    const result = mapOpportunityToContract(
      makeOpportunity({
        placeOfPerformance: {
          city: { name: "San Diego" },
          state: { code: "CA", name: "California" },
          zip: "92101",
          country: { code: "US", name: "United States" },
        },
      })
    );
    expect(result.popState).toBe("CA");
    expect(result.popCity).toBe("San Diego");
    expect(result.popZip).toBe("92101");
  });

  it("maps office address fields", () => {
    const result = mapOpportunityToContract(
      makeOpportunity({
        officeAddress: { city: "Arlington", state: "VA", zip: "22202", countryCode: "US" },
      })
    );
    expect(result.officeCity).toBe("Arlington");
    expect(result.officeState).toBe("VA");
  });

  it("maps setAsideCode from typeOfSetAside", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.setAsideCode).toBe("SBA");
  });

  it("sets pipeline tracking flags to false", () => {
    const result = mapOpportunityToContract(makeOpportunity());
    expect(result.descriptionFetched).toBe(false);
    expect(result.classifiedFromMetadata).toBe(false);
  });

  it("returns null for new fields when source data is null", () => {
    const result = mapOpportunityToContract(
      makeOpportunity({
        fullParentPathCode: null,
        placeOfPerformance: null,
        officeAddress: null,
        typeOfSetAside: null,
      })
    );
    expect(result.orgPathCode).toBeNull();
    expect(result.popState).toBeNull();
    expect(result.popCity).toBeNull();
    expect(result.popZip).toBeNull();
    expect(result.officeCity).toBeNull();
    expect(result.officeState).toBeNull();
    expect(result.setAsideCode).toBeNull();
  });
});
