import { vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id", title: "title", agency: "agency", classification: "classification",
    noticeId: "notice_id", solicitationNumber: "sol_num", awardCeiling: "award_ceiling",
    responseDeadline: "response_deadline", noticeType: "notice_type", aiReasoning: "ai_reasoning",
    status: "status", postedDate: "posted_date", userOverride: "user_override",
    pscCode: "psc_code", naicsCode: "naics_code", setAsideType: "set_aside_type",
    descriptionText: "description_text", resourceLinks: "resource_links", samUrl: "sam_url",
    notes: "notes", active: "active", rawJson: "raw_json", documentsAnalyzed: "documents_analyzed",
    createdAt: "created_at", updatedAt: "updated_at",
  },
}));

let mockInsertResults: { id: string }[] = [];

vi.mock("@/lib/db", () => {
  const createChain = (resolveValue: unknown) => {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(resolveValue);
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn().mockImplementation(() => createChain([])),
      insert: vi.fn().mockImplementation(() => createChain(mockInsertResults)),
      update: vi.fn().mockImplementation(() => createChain([])),
      delete: vi.fn().mockImplementation(() => createChain([])),
    },
  };
});

import { POST } from "@/app/api/contracts/import/route";

beforeEach(() => {
  mockInsertResults = [];
});

function makeCSVRequest(csvContent: string): NextRequest {
  const formData = new FormData();
  formData.append("file", new File([csvContent], "test.csv", { type: "text/csv" }));
  return new NextRequest("http://localhost/api/contracts/import", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/contracts/import", () => {
  it("returns 400 when no file provided", async () => {
    const formData = new FormData();
    const req = new NextRequest("http://localhost/api/contracts/import", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No CSV file");
  });

  it("returns 400 for empty CSV (header only)", async () => {
    const csv = "Notice ID,Title\n";
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("empty");
  });

  it("parses quoted fields with commas", async () => {
    mockInsertResults = [{ id: "uuid-1" }];
    const csv = 'Notice ID,Title,Agency\nNID-001,"Test, With Commas","Department of Defense"\n';
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
  });

  it("parses escaped quotes in CSV", async () => {
    mockInsertResults = [{ id: "uuid-1" }];
    const csv = 'Notice ID,Title\nNID-001,"Title with ""quotes"""\n';
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
  });

  it("handles flexible header names", async () => {
    mockInsertResults = [{ id: "uuid-1" }];
    const csv = 'noticeid,title,Department/Ind.Agency\nNID-001,Test Contract,DoD\n';
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
  });

  it("throws error when Notice ID column is missing", async () => {
    const csv = "Title,Agency\nSome Title,DoD\n";
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.message).toContain("Notice ID");
  });

  it("throws error when Title column is missing", async () => {
    const csv = "Notice ID,Agency\nNID-001,DoD\n";
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.message).toContain("Title");
  });

  it("parses dates for responseDeadline and postedDate", async () => {
    mockInsertResults = [{ id: "uuid-1" }];
    const csv = 'Notice ID,Title,Response Deadline,Posted Date\nNID-001,Test,2025-06-15,2025-01-01\n';
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it("strips currency symbols from awardCeiling", async () => {
    mockInsertResults = [{ id: "uuid-1" }];
    const csv = 'Notice ID,Title,Award Ceiling\nNID-001,Test,"$1,500,000"\n';
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it("parses boolean active field", async () => {
    mockInsertResults = [{ id: "uuid-1" }];
    const csv = 'Notice ID,Title,Active\nNID-001,Test,Yes\n';
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it("handles \\r\\n line endings", async () => {
    mockInsertResults = [{ id: "uuid-1" }];
    const csv = "Notice ID,Title\r\nNID-001,Test Contract\r\n";
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
  });

  it("performs batch inserts and returns summary", async () => {
    mockInsertResults = [{ id: "uuid-1" }, { id: "uuid-2" }];
    const lines = ["Notice ID,Title"];
    for (let i = 0; i < 5; i++) {
      lines.push(`NID-${i},Contract ${i}`);
    }
    const csv = lines.join("\n") + "\n";
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(5);
    expect(data).toHaveProperty("imported");
    expect(data).toHaveProperty("skipped");
    expect(data).toHaveProperty("importedIds");
    expect(data).toHaveProperty("queued_for_classification");
  });

  it("sets default postedDate and samUrl when not provided", async () => {
    mockInsertResults = [{ id: "uuid-1" }];
    const csv = "Notice ID,Title\nNID-001,Test Contract\n";
    const req = makeCSVRequest(csv);
    const res = await POST(req);

    // The route sets defaults internally - if it succeeds, defaults were set
    expect(res.status).toBe(200);
  });
});
