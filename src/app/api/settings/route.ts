import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/settings
 *
 * Returns all settings as a key-value map.
 * No auth required — dashboard-only route.
 */
export async function GET() {
  try {
    const rows = await db.select().from(settings);
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[settings] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings
 *
 * Upserts settings from a key-value map.
 * Body: { company_profile: "...", email_recipients: [...], digest_enabled: true }
 * No auth required — dashboard-only route.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const entries = Object.entries(body) as [string, unknown][];

    for (const [key, value] of entries) {
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(settings)
          .set({ value: value as Record<string, unknown> })
          .where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({
          key,
          value: value as Record<string, unknown>,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[settings] PUT error:", err);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
