import { NextRequest } from "next/server";
import { authorize } from "@/lib/auth";

describe("authorize", () => {
  const VALID_SECRET = "test-secret-123";

  beforeEach(() => {
    process.env.INGEST_SECRET = VALID_SECRET;
  });

  afterEach(() => {
    delete process.env.INGEST_SECRET;
  });

  it("returns true for a valid Bearer token", () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: `Bearer ${VALID_SECRET}` },
    });
    expect(authorize(req)).toBe(true);
  });

  it("returns false when Authorization header is missing", () => {
    const req = new NextRequest("http://localhost/api/test");
    expect(authorize(req)).toBe(false);
  });

  it("returns false for wrong prefix (e.g. Basic)", () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(authorize(req)).toBe(false);
  });

  it("returns false for wrong token", () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(authorize(req)).toBe(false);
  });

  it("returns false for empty token after Bearer prefix", () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: "Bearer " },
    });
    expect(authorize(req)).toBe(false);
  });

  it("returns false when INGEST_SECRET env var is undefined", () => {
    delete process.env.INGEST_SECRET;
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: "Bearer some-token" },
    });
    expect(authorize(req)).toBe(false);
  });
});
