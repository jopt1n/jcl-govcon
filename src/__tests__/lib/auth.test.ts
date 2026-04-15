import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { authorize, requireSameOrigin } from "@/lib/auth";

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

describe("requireSameOrigin", () => {
  function mkReq(headers: Record<string, string>): NextRequest {
    return new NextRequest("http://localhost/api/contracts/export", {
      method: "GET",
      headers,
    });
  }

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.unstubAllEnvs();
  });

  it("prod + no APP_URL + no Origin/Referer → false (self-host fallback rejects)", () => {
    vi.stubEnv("NODE_ENV", "production");
    // Host is "localhost" from the URL, so the allowlist is non-empty,
    // but neither Origin nor Referer is present → the missing-header
    // branch returns dev-only true. In prod this means false.
    const req = mkReq({});
    expect(requireSameOrigin(req)).toBe(false);
  });

  it("dev + no APP_URL + no Origin/Referer → true (dev fallthrough)", () => {
    vi.stubEnv("NODE_ENV", "test");
    const req = mkReq({});
    expect(requireSameOrigin(req)).toBe(true);
  });

  it("Origin exactly matches APP_URL → true", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const req = mkReq({ origin: "https://jclgovcon.com" });
    expect(requireSameOrigin(req)).toBe(true);
  });

  it("Origin matches http://Host self-host fallback → true", () => {
    const req = mkReq({ origin: "http://localhost" });
    expect(requireSameOrigin(req)).toBe(true);
  });

  it("Origin mismatches all allowlist entries → false", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const req = mkReq({ origin: "https://evil.com" });
    expect(requireSameOrigin(req)).toBe(false);
  });

  it("Referer starts with APP_URL → true", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const req = mkReq({ referer: "https://jclgovcon.com/pipeline" });
    expect(requireSameOrigin(req)).toBe(true);
  });

  it("Referer starts with self-host → true", () => {
    const req = mkReq({ referer: "http://localhost/pipeline" });
    expect(requireSameOrigin(req)).toBe(true);
  });

  it("Referer for unrelated host → false", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const req = mkReq({ referer: "https://evil.com/attack" });
    expect(requireSameOrigin(req)).toBe(false);
  });

  it("APP_URL with trailing slash is normalized", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://x.com/";
    const req = mkReq({ referer: "https://x.com/page" });
    expect(requireSameOrigin(req)).toBe(true);
  });

  it("rejects Referer from suffix-attack domain (jclgovcon.com.evil.com)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const req = mkReq({
      referer: "https://jclgovcon.com.evil.com/page",
    });
    expect(requireSameOrigin(req)).toBe(false);
  });

  it("rejects Referer from hyphen-suffix-attack domain", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const req = mkReq({
      referer: "https://jclgovcon.com-evil.com/page",
    });
    expect(requireSameOrigin(req)).toBe(false);
  });

  it("rejects Referer that is not a valid URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const req = mkReq({ referer: "not a url" });
    expect(requireSameOrigin(req)).toBe(false);
  });
});
