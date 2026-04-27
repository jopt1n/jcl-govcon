import { NextRequest, NextResponse } from "next/server";
import {
  deletePursuitContact,
  pursuitExists,
  updatePursuitContact,
} from "@/lib/pursuits/service";
import { isPursuitContactRole } from "@/lib/pursuits/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; contactId: string } },
) {
  try {
    const body = await req.json();
    if (body.role !== undefined && !isPursuitContactRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (!(await pursuitExists(params.id))) {
      return NextResponse.json({ error: "Pursuit not found" }, { status: 404 });
    }

    const contact = await updatePursuitContact(params.id, params.contactId, {
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
    if (!contact) {
      return NextResponse.json(
        { error: "Contact not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(contact);
  } catch (err) {
    console.error("[api/pursuits/contact] PATCH Error:", err);
    return NextResponse.json(
      {
        error: "Failed to update contact",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; contactId: string } },
) {
  try {
    if (!(await pursuitExists(params.id))) {
      return NextResponse.json({ error: "Pursuit not found" }, { status: 404 });
    }
    const deleted = await deletePursuitContact(params.id, params.contactId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Contact not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/pursuits/contact] DELETE Error:", err);
    return NextResponse.json(
      {
        error: "Failed to delete contact",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
