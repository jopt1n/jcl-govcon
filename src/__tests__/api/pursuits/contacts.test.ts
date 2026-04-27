import { vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockCreatePursuitContact,
  mockDeletePursuitContact,
  mockListPursuitContacts,
  mockPursuitExists,
  mockUpdatePursuitContact,
} = vi.hoisted(() => ({
  mockCreatePursuitContact: vi.fn(),
  mockDeletePursuitContact: vi.fn(),
  mockListPursuitContacts: vi.fn(),
  mockPursuitExists: vi.fn(),
  mockUpdatePursuitContact: vi.fn(),
}));

vi.mock("@/lib/pursuits/service", () => ({
  createPursuitContact: mockCreatePursuitContact,
  deletePursuitContact: mockDeletePursuitContact,
  listPursuitContacts: mockListPursuitContacts,
  pursuitExists: mockPursuitExists,
  updatePursuitContact: mockUpdatePursuitContact,
}));

import {
  GET as CONTACTS_GET,
  POST as CONTACTS_POST,
} from "@/app/api/pursuits/[id]/contacts/route";
import {
  DELETE as CONTACT_DELETE,
  PATCH as CONTACT_PATCH,
} from "@/app/api/pursuits/[id]/contacts/[contactId]/route";

beforeEach(() => {
  mockCreatePursuitContact.mockReset();
  mockDeletePursuitContact.mockReset();
  mockListPursuitContacts.mockReset();
  mockPursuitExists.mockReset();
  mockPursuitExists.mockResolvedValue(true);
  mockUpdatePursuitContact.mockReset();
});

describe("pursuit contact routes", () => {
  it("lists contacts", async () => {
    mockListPursuitContacts.mockResolvedValue([{ id: "contact-1" }]);
    const req = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/contacts",
    );
    const res = await CONTACTS_GET(req, { params: { id: "pursuit-1" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toHaveLength(1);
  });

  it("creates a government POC contact", async () => {
    mockCreatePursuitContact.mockResolvedValue({ id: "contact-1" });
    const req = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/contacts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "GOVERNMENT_POC",
          name: "Jane Doe",
          email: "jane@example.gov",
        }),
      },
    );
    const res = await CONTACTS_POST(req, { params: { id: "pursuit-1" } });

    expect(res.status).toBe(201);
    expect(mockCreatePursuitContact).toHaveBeenCalledWith("pursuit-1", {
      role: "GOVERNMENT_POC",
      name: "Jane Doe",
      organization: undefined,
      title: undefined,
      email: "jane@example.gov",
      phone: undefined,
      url: undefined,
      notes: undefined,
      isPrimary: undefined,
    });
  });

  it("rejects invalid contact roles", async () => {
    const req = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/contacts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "CUSTOMER" }),
      },
    );
    const res = await CONTACTS_POST(req, { params: { id: "pursuit-1" } });

    expect(res.status).toBe(400);
    expect(mockCreatePursuitContact).not.toHaveBeenCalled();
  });

  it("returns 404 instead of relying on FK errors when pursuit is missing", async () => {
    mockPursuitExists.mockResolvedValue(false);
    const req = new NextRequest(
      "http://localhost/api/pursuits/missing/contacts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "GOVERNMENT_POC" }),
      },
    );
    const res = await CONTACTS_POST(req, { params: { id: "missing" } });

    expect(res.status).toBe(404);
    expect(mockCreatePursuitContact).not.toHaveBeenCalled();
  });

  it("updates and deletes contacts", async () => {
    mockUpdatePursuitContact.mockResolvedValue({ id: "contact-1" });
    mockDeletePursuitContact.mockResolvedValue(true);

    const patchReq = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/contacts/contact-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "VENDOR", organization: "Acme" }),
      },
    );
    const patchRes = await CONTACT_PATCH(patchReq, {
      params: { id: "pursuit-1", contactId: "contact-1" },
    });
    expect(patchRes.status).toBe(200);

    const deleteReq = new NextRequest(
      "http://localhost/api/pursuits/pursuit-1/contacts/contact-1",
      { method: "DELETE" },
    );
    const deleteRes = await CONTACT_DELETE(deleteReq, {
      params: { id: "pursuit-1", contactId: "contact-1" },
    });
    expect(deleteRes.status).toBe(200);
  });
});
