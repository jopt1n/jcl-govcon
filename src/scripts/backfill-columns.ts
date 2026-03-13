/**
 * One-time backfill script: populates new columns from raw_json for existing contracts.
 * Makes ZERO external API calls — reads/writes only to the database.
 *
 * Usage: npx tsx src/scripts/backfill-columns.ts
 */
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq, isNotNull } from "drizzle-orm";

interface RawOpportunity {
  fullParentPathName?: string | null;
  fullParentPathCode?: string | null;
  placeOfPerformance?: {
    city?: { name?: string | null } | null;
    state?: { code?: string | null } | null;
    zip?: string | null;
  } | null;
  officeAddress?: {
    city?: string | null;
    state?: string | null;
  } | null;
  typeOfSetAside?: string | null;
}

async function backfill() {
  console.log("Starting backfill of new columns from raw_json...");

  const rows = await db
    .select({
      id: contracts.id,
      rawJson: contracts.rawJson,
      descriptionText: contracts.descriptionText,
    })
    .from(contracts)
    .where(isNotNull(contracts.rawJson));

  console.log(`Found ${rows.length} contracts with raw_json`);

  let updated = 0;
  const BATCH_SIZE = 20;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (row) => {
        const raw = row.rawJson as RawOpportunity | null;
        if (!raw) return;

        await db
          .update(contracts)
          .set({
            orgPathName: raw.fullParentPathName ?? null,
            orgPathCode: raw.fullParentPathCode ?? null,
            popState: raw.placeOfPerformance?.state?.code ?? null,
            popCity: raw.placeOfPerformance?.city?.name ?? null,
            popZip: raw.placeOfPerformance?.zip ?? null,
            officeCity: raw.officeAddress?.city ?? null,
            officeState: raw.officeAddress?.state ?? null,
            setAsideCode: raw.typeOfSetAside ?? null,
            descriptionFetched: row.descriptionText != null,
          })
          .where(eq(contracts.id, row.id));

        updated++;
      })
    );

    if ((i + BATCH_SIZE) % 100 < BATCH_SIZE) {
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
    }
  }

  console.log(`Backfilled ${updated} contracts`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
