import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  authorize: vi.fn(),
}));

vi.mock("@/lib/email/digest", () => ({
  sendDigest: vi.fn(),
}));

import { POST } from "@/app/api/digest/route";
import { authorize } from "@/lib/auth";
import { sendDigest } from "@/lib/email/digest";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorize).mockReturnValue(false);
});

describe("POST /api/digest", () => {
  it("returns 401 when unauthorized", async () => {
    const req = new NextRequest("http://localhost/api/digest", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("returns digest result on success", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    vi.mocked(sendDigest).mockResolvedValue({
      sent: true,
      recipients: 3,
      contractsIncluded: 5,
    } as any);

    const req = new NextRequest("http://localhost/api/digest", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sent).toBe(true);
    expect(data.recipients).toBe(3);
  });

  it("returns 500 when sendDigest throws", async () => {
    vi.mocked(authorize).mockReturnValue(true);
    vi.mocked(sendDigest).mockRejectedValue(new Error("SMTP error"));

    const req = new NextRequest("http://localhost/api/digest", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Failed to send digest");
  });
});
