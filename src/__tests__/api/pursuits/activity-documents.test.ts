import { vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockCreatePursuitDocument,
  mockCreatePursuitInteraction,
  mockListPursuitDocuments,
  mockListPursuitInteractions,
} = vi.hoisted(() => ({
  mockCreatePursuitDocument: vi.fn(),
  mockCreatePursuitInteraction: vi.fn(),
  mockListPursuitDocuments: vi.fn(),
  mockListPursuitInteractions: vi.fn(),
}));

vi.mock("@/lib/pursuits/service", () => ({
  createPursuitDocument: mockCreatePursuitDocument,
  createPursuitInteraction: mockCreatePursuitInteraction,
  listPursuitDocuments: mockListPursuitDocuments,
  listPursuitInteractions: mockListPursuitInteractions,
}));

import {
  GET as DOCUMENTS_GET,
  POST as DOCUMENTS_POST,
} from "@/app/api/pursuits/[id]/documents/route";
import {
  GET as INTERACTIONS_GET,
  POST as INTERACTIONS_POST,
} from "@/app/api/pursuits/[id]/interactions/route";

beforeEach(() => {
  mockCreatePursuitDocument.mockReset();
  mockCreatePursuitInteraction.mockReset();
  mockListPursuitDocuments.mockReset();
  mockListPursuitInteractions.mockReset();
});

describe("pursuit interactions and documents", () => {
  it("creates interaction events for the activity history", async () => {
    mockCreatePursuitInteraction.mockResolvedValue({ id: "event-1" });
    const req = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "QUOTE_REQUESTED",
          subject: "Quote requested",
          body: "Sent request to vendor.",
        }),
      },
    );
    const res = await INTERACTIONS_POST(req, { params: { id: "pursuit-1" } });

    expect(res.status).toBe(201);
    expect(mockCreatePursuitInteraction).toHaveBeenCalledWith(
      "pursuit-1",
      expect.objectContaining({
        type: "QUOTE_REQUESTED",
        subject: "Quote requested",
      }),
    );
  });

  it("rejects invalid interaction types", async () => {
    const req = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "EMAIL_AUTOMATION" }),
      },
    );
    const res = await INTERACTIONS_POST(req, { params: { id: "pursuit-1" } });

    expect(res.status).toBe(400);
    expect(mockCreatePursuitInteraction).not.toHaveBeenCalled();
  });

  it("lists document metadata and accepts future storage metadata without blobs", async () => {
    mockListPursuitDocuments.mockResolvedValue([{ id: "doc-1" }]);
    const getReq = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/documents",
    );
    const getRes = await DOCUMENTS_GET(getReq, { params: { id: "pursuit-1" } });
    expect(getRes.status).toBe(200);

    mockCreatePursuitDocument.mockResolvedValue({ id: "doc-2" });
    const postReq = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/documents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: "https://example.test/file.pdf",
          contentType: "application/pdf",
          sha256: "abc123",
          objectKey: "future/r2/key",
        }),
      },
    );
    const postRes = await DOCUMENTS_POST(postReq, {
      params: { id: "pursuit-1" },
    });

    expect(postRes.status).toBe(201);
    expect(mockCreatePursuitDocument).toHaveBeenCalledWith(
      "pursuit-1",
      expect.objectContaining({
        sourceUrl: "https://example.test/file.pdf",
        contentType: "application/pdf",
        sha256: "abc123",
        objectKey: "future/r2/key",
      }),
    );
  });

  it("lists interactions", async () => {
    mockListPursuitInteractions.mockResolvedValue([{ id: "event-1" }]);
    const req = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/interactions",
    );
    const res = await INTERACTIONS_GET(req, { params: { id: "pursuit-1" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toHaveLength(1);
  });
});
