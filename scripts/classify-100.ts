/**
 * Classify 100 PENDING contracts using metadata-only classification (Gemini 2.5 Flash).
 * Usage: npx tsx --tsconfig tsconfig.json scripts/classify-100.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env manually
const envPath = resolve(__dirname, "../.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) continue;
  const key = trimmed.slice(0, eqIndex).trim();
  const value = trimmed.slice(eqIndex + 1).trim();
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

// Now import after env is loaded — tsx handles @/ paths with tsconfig
async function main() {
  const { db } = await import("../src/lib/db");
  const { contracts } = await import("../src/lib/db/schema");
  const { classifyFromMetadata } = await import(
    "../src/lib/ai/metadata-classifier"
  );
  const { eq, and } = await import("drizzle-orm");

  console.log("=== Metadata Classification: 100 PENDING contracts ===\n");

  const startTime = Date.now();
  const result = await classifyFromMetadata({ limit: 100 });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n=== RESULTS (${elapsed}s) ===`);
  console.log(`Classified: ${result.classified}`);
  console.log(`  GOOD:    ${result.good}`);
  console.log(`  MAYBE:   ${result.maybe}`);
  console.log(`  DISCARD: ${result.discard}`);
  console.log(`  Errors:  ${result.errors}`);

  // Estimate cost: Gemini 2.5 Flash pricing
  // Input: $0.15/1M tokens, Output: $0.60/1M tokens
  // Each metadata prompt ~500 tokens input, ~100 tokens output
  const estInputTokens = result.classified * 500;
  const estOutputTokens = result.classified * 100;
  const estCost =
    (estInputTokens / 1_000_000) * 0.15 +
    (estOutputTokens / 1_000_000) * 0.6;
  console.log(
    `\nEstimated cost: ~$${estCost.toFixed(4)} (${estInputTokens} input + ${estOutputTokens} output tokens)`
  );

  // Sample contracts
  console.log("\n=== SAMPLE CONTRACTS ===\n");

  const goodSamples = await db
    .select({
      title: contracts.title,
      agency: contracts.agency,
      summary: contracts.summary,
      reasoning: contracts.aiReasoning,
      tags: contracts.tags,
      naicsCode: contracts.naicsCode,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "GOOD"),
        eq(contracts.classifiedFromMetadata, true)
      )
    )
    .limit(2);

  const discardSamples = await db
    .select({
      title: contracts.title,
      agency: contracts.agency,
      summary: contracts.summary,
      reasoning: contracts.aiReasoning,
      tags: contracts.tags,
      naicsCode: contracts.naicsCode,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "DISCARD"),
        eq(contracts.classifiedFromMetadata, true)
      )
    )
    .limit(2);

  const maybeSamples = await db
    .select({
      title: contracts.title,
      agency: contracts.agency,
      summary: contracts.summary,
      reasoning: contracts.aiReasoning,
      tags: contracts.tags,
      naicsCode: contracts.naicsCode,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, "MAYBE"),
        eq(contracts.classifiedFromMetadata, true)
      )
    )
    .limit(1);

  function printSample(
    label: string,
    s: {
      title: string;
      agency: string | null;
      summary: string | null;
      reasoning: string | null;
      tags: string[] | null;
      naicsCode: string | null;
    }
  ) {
    console.log(`[${label}] ${s.title}`);
    console.log(`  Agency: ${s.agency || "N/A"}`);
    console.log(`  NAICS: ${s.naicsCode || "N/A"}`);
    console.log(`  Summary: ${s.summary || "N/A"}`);
    console.log(`  Reasoning: ${s.reasoning || "N/A"}`);
    console.log(`  Tags: ${(s.tags || []).join(", ") || "none"}`);
    console.log();
  }

  for (const s of goodSamples) printSample("GOOD", s);
  for (const s of discardSamples) printSample("DISCARD", s);
  for (const s of maybeSamples) printSample("MAYBE", s);

  if (
    goodSamples.length === 0 &&
    discardSamples.length === 0 &&
    maybeSamples.length === 0
  ) {
    console.log("(No classified samples found)");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
