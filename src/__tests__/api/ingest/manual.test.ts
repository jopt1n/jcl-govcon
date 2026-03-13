import { vi } from "vitest";
import { NextRequest } from "next/server";

// Save original fetch
const originalFetch = globalThis.fetch;

import { POST } from "@/app/api/ingest/manual/route";

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("POST /api/ingest/manual", () => {
  it("returns 500 when INGEST_SECRET is not configured", async () => {
    const origSecret = process.env.INGEST_SECRET;
    delete process.env.INGEST_SECRET;

    const req = new NextRequest("http://localhost/api/ingest/manual", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("INGEST_SECRET");

    // Restore
    if (origSecret) process.env.INGEST_SECRET = origSecret;
  });

  it("proxies request to /api/ingest/trigger with server secret", async () => {
    process.env.INGEST_SECRET = "my-secret";
    delete process.env.NEXT_PUBLIC_APP_URL;

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ mode: "daily", ingest: { total: 5 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const req = new NextRequest("http://localhost/api/ingest/manual", {
      method: "POST",
      body: JSON.stringify({ mode: "daily" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("daily");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/ingest/trigger",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer my-secret",
        }),
      })
    );
  });

  it("uses NEXT_PUBLIC_APP_URL when set", async () => {
    process.env.INGEST_SECRET = "my-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://myapp.railway.app";

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ mode: "daily" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const req = new NextRequest("http://localhost/api/ingest/manual", {
      method: "POST",
      body: JSON.stringify({ mode: "daily" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://myapp.railway.app/api/ingest/trigger",
      expect.anything()
    );

    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("passes mode parameter through", async () => {
    process.env.INGEST_SECRET = "my-secret";

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ mode: "bulk", total: 500 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const req = new NextRequest("http://localhost/api/ingest/manual", {
      method: "POST",
      body: JSON.stringify({ mode: "bulk" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const fetchBody = JSON.parse(fetchCall[1]?.body as string);
    expect(fetchBody.mode).toBe("bulk");
  });

  it("forwards error responses from trigger endpoint", async () => {
    process.env.INGEST_SECRET = "my-secret";

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Daily ingest failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );

    const req = new NextRequest("http://localhost/api/ingest/manual", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("ingest failed");
  });
});
