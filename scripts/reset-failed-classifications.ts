/**
 * Reset contracts that were incorrectly marked as classified due to API errors.
 * Usage: npx tsx scripts/reset-failed-classifications.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env
const envPath = resolve(__dirname, "../.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) continue;
  const key = trimmed.slice(0, eqIndex).trim();
  const value = trimmed.slice(eqIndex + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { contracts } = await import("../src/lib/db/schema");
  const { eq, and, like, sql } = await import("drizzle-orm");

  // Reset contracts where ai_reasoning indicates an API error fallback
  const result = await db
    .update(contracts)
    .set({
      classification: "PENDING",
      classifiedFromMetadata: false,
      aiReasoning: null,
      summary: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contracts.classifiedFromMetadata, true),
        like(contracts.aiReasoning, "Metadata classification failed:%")
      )
    )
    .returning({ id: contracts.id });

  console.log(`Reset ${result.length} contracts back to PENDING`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
