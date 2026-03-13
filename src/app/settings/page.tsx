import { db } from "@/lib/db";
import { settings, apiUsage } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { SettingsForm } from "@/components/settings-form";

async function getSettings(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(settings);
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

async function getTodayUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(apiUsage)
    .where(eq(apiUsage.date, today))
    .limit(1);

  if (rows.length > 0) {
    return { searchCalls: rows[0].searchCalls, docFetches: rows[0].docFetches };
  }
  return { searchCalls: 0, docFetches: 0 };
}

export default async function SettingsPage() {
  const [currentSettings, usage] = await Promise.all([
    getSettings(),
    getTodayUsage(),
  ]);

  return (
    <div className="p-4 md:p-6 pt-14 md:pt-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Settings</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Configure company profile, email digests, and ingestion.
        </p>
      </div>
      <SettingsForm initialSettings={currentSettings} apiUsage={usage} />
    </div>
  );
}
