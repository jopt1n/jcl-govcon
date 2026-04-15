/**
 * Unit tests for the CSV field escaper used by /api/contracts/export.
 *
 * The export endpoint itself is covered by integration-style routing tests;
 * this file proves the escape logic handles all RFC 4180 edge cases.
 */

import { describe, it, expect, vi } from "vitest";

// Mock DB + drizzle so importing the route file doesn't try to connect
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ contracts: {} }));
vi.mock("drizzle-orm", () => ({
  inArray: vi.fn(),
  desc: vi.fn(),
}));

import { escapeCsvField } from "@/app/api/contracts/export/route";

describe("escapeCsvField", () => {
  it("passes through simple strings unchanged", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField("no-special-chars")).toBe("no-special-chars");
  });

  it("wraps fields containing commas in quotes", () => {
    expect(escapeCsvField("Navy, Dept of")).toBe('"Navy, Dept of"');
  });

  it("wraps and doubles internal quotes", () => {
    expect(escapeCsvField('Office of "Something"')).toBe(
      '"Office of ""Something"""',
    );
  });

  it("wraps fields with newlines", () => {
    expect(escapeCsvField("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(escapeCsvField("windows\r\nline")).toBe('"windows\r\nline"');
  });

  it("returns empty string for null/undefined", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("stringifies numbers and booleans", () => {
    expect(escapeCsvField(42)).toBe("42");
    expect(escapeCsvField(3.14)).toBe("3.14");
    expect(escapeCsvField(true)).toBe("true");
    expect(escapeCsvField(false)).toBe("false");
  });

  it("handles a contract title with all special chars combined", () => {
    const title = 'Request for Proposal: "Advanced, Research"\nSolicitation';
    expect(escapeCsvField(title)).toBe(
      '"Request for Proposal: ""Advanced, Research""\nSolicitation"',
    );
  });

  it("does not quote fields with just whitespace", () => {
    expect(escapeCsvField("  spaces  ")).toBe("  spaces  ");
  });
});
