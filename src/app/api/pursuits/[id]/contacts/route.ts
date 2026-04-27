import { NextRequest, NextResponse } from "next/server";
import {
  createPursuitContact,
  listPursuitContacts,
  pursuitExists,
} from "@/lib/pursuits/service";
import { isPursuitContactRole } from "@/lib/pursuits/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    if (!(await pursuitExists(params.id))) {
      return NextResponse.json({ error: "Pursuit not found" }, { status: 404 });
    }
    const contacts = await listPursuitContacts(params.id);
    return NextResponse.json({ data: contacts });
  } catch (err) {
    console.error("[api/pursuits/contacts] GET Error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch contacts",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    if (!isPursuitContactRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (!(await pursuitExists(params.id))) {
      return NextResponse.json({ error: "Pursuit not found" }, { status: 404 });
    }
    const contact = await createPursuitContact(params.id, {
      role: body.role,
      name: body.name,
      organization: body.organization,
      title: body.title,
      email: body.email,
      phone: body.phone,
      url: body.url,
      notes: body.notes,
      isPrimary: body.isPrimary,
    });
    return NextResponse.json(contact, { status: 201 });
  } catch (err) {
    console.error("[api/pursuits/contacts] POST Error:", err);
    return NextResponse.json(
      {
        error: "Failed to create contact",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
