/**
 * Integration test for the same-origin guard on /api/contracts/export
 * from Commit 5 (#4). Asserts the route returns 403 for cross-origin
 * requests and 200 for browser-initiated same-origin requests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

function makeChain(resolveValue: unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => {
          Promise.resolve(resolveValue).then(resolve);
        };
      }
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

vi.mock("drizzle-orm", () => ({
  inArray: vi.fn(),
  desc: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id",
    noticeId: "notice_id",
    title: "title",
    agency: "agency",
    classification: "classification",
    status: "status",
    awardCeiling: "award_ceiling",
    responseDeadline: "response_deadline",
    postedDate: "posted_date",
    samUrl: "sam_url",
    statusChangedAt: "status_changed_at",
  },
}));

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn().mockImplementation(() => makeChain([])) },
}));

function req(
  headers: Record<string, string>,
  url = "http://localhost/api/contracts/export",
): NextRequest {
  return new NextRequest(url, { method: "GET", headers });
}

describe("GET /api/contracts/export same-origin guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.unstubAllEnvs();
  });

  it("returns 403 when no Origin/Referer in prod with APP_URL set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const { GET } = await import("@/app/api/contracts/export/route");
    const res = await GET(
      req({}, "https://jclgovcon.com/api/contracts/export"),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Forbidden");
  });

  it("returns 200 for Referer matching APP_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const { GET } = await import("@/app/api/contracts/export/route");
    const res = await GET(
      req(
        { referer: "https://jclgovcon.com/pipeline" },
        "https://jclgovcon.com/api/contracts/export",
      ),
    );
    expect(res.status).toBe(200);
  });

  it("returns 403 for Referer from unrelated host", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const { GET } = await import("@/app/api/contracts/export/route");
    const res = await GET(
      req(
        { referer: "https://evil.com/attack" },
        "https://jclgovcon.com/api/contracts/export",
      ),
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 for Origin matching APP_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "https://jclgovcon.com";
    const { GET } = await import("@/app/api/contracts/export/route");
    const res = await GET(
      req(
        { origin: "https://jclgovcon.com" },
        "https://jclgovcon.com/api/contracts/export",
      ),
    );
    expect(res.status).toBe(200);
  });

  it("Railway self-host fallback: Host + Referer match without APP_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // No NEXT_PUBLIC_APP_URL set
    const { GET } = await import("@/app/api/contracts/export/route");
    const res = await GET(
      req(
        {
          referer: "https://app.railway.app/pipeline",
          host: "app.railway.app",
        },
        "https://app.railway.app/api/contracts/export",
      ),
    );
    expect(res.status).toBe(200);
  });

  it("dev passes through with no headers", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { GET } = await import("@/app/api/contracts/export/route");
    const res = await GET(req({}));
    expect(res.status).toBe(200);
  });
});
