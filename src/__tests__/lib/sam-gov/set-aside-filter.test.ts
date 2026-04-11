import { isRestrictedSetAside } from "@/lib/sam-gov/set-aside-filter";

describe("isRestrictedSetAside", () => {
  // JCL qualifies — should NOT be filtered
  it("returns false for null", () => {
    expect(isRestrictedSetAside(null)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRestrictedSetAside("")).toBe(false);
  });

  it("returns false for SBA (JCL qualifies)", () => {
    expect(isRestrictedSetAside("SBA")).toBe(false);
  });

  it("returns false for SBP (JCL qualifies)", () => {
    expect(isRestrictedSetAside("SBP")).toBe(false);
  });

  it("returns false for NONE", () => {
    expect(isRestrictedSetAside("NONE")).toBe(false);
  });

  // 8(a) variants
  it("returns true for 8A", () => {
    expect(isRestrictedSetAside("8A")).toBe(true);
  });

  it("returns true for 8AN", () => {
    expect(isRestrictedSetAside("8AN")).toBe(true);
  });

  // SDVOSB variants
  it("returns true for SDVOSB", () => {
    expect(isRestrictedSetAside("SDVOSB")).toBe(true);
  });

  it("returns true for SDVOSBC", () => {
    expect(isRestrictedSetAside("SDVOSBC")).toBe(true);
  });

  // HUBZone variants
  it("returns true for HZ", () => {
    expect(isRestrictedSetAside("HZ")).toBe(true);
  });

  it("returns true for HZC", () => {
    expect(isRestrictedSetAside("HZC")).toBe(true);
  });

  // WOSB variants
  it("returns true for WOSB", () => {
    expect(isRestrictedSetAside("WOSB")).toBe(true);
  });

  it("returns true for WOSBSS", () => {
    expect(isRestrictedSetAside("WOSBSS")).toBe(true);
  });

  // EDWOSB
  it("returns true for EDWOSB", () => {
    expect(isRestrictedSetAside("EDWOSB")).toBe(true);
  });

  // ISBEE (Indian Small Business Economic Enterprise)
  it("returns true for ISBEE", () => {
    expect(isRestrictedSetAside("ISBEE")).toBe(true);
  });

  // Veteran-owned variants
  it("returns true for VSA", () => {
    expect(isRestrictedSetAside("VSA")).toBe(true);
  });

  it("returns true for VSB", () => {
    expect(isRestrictedSetAside("VSB")).toBe(true);
  });

  // Case insensitivity
  it("is case insensitive", () => {
    expect(isRestrictedSetAside("sdvosbc")).toBe(true);
    expect(isRestrictedSetAside("Wosb")).toBe(true);
    expect(isRestrictedSetAside("sba")).toBe(false);
  });
});
