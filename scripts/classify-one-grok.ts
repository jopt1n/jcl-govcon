/**
 * Classify a single contract with Grok to compare against Gemini.
 * Usage: npx tsx scripts/classify-one-grok.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

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
  const { like, eq } = await import("drizzle-orm");
  const { getGrokClient, GROK_MODEL } = await import("../src/lib/ai/grok-client");
  const { buildMetadataClassificationPrompt } = await import("../src/lib/ai/prompts");
  const { parseClassificationResponse } = await import("../src/lib/ai/classifier");

  // Find the SUAS drone contract
  const [contract] = await db
    .select({
      id: contracts.id,
      noticeId: contracts.noticeId,
      title: contracts.title,
      naicsCode: contracts.naicsCode,
      pscCode: contracts.pscCode,
      agency: contracts.agency,
      orgPathName: contracts.orgPathName,
      noticeType: contracts.noticeType,
      setAsideType: contracts.setAsideType,
      setAsideCode: contracts.setAsideCode,
      popState: contracts.popState,
      awardCeiling: contracts.awardCeiling,
      classification: contracts.classification,
      aiReasoning: contracts.aiReasoning,
      summary: contracts.summary,
    })
    .from(contracts)
    .where(like(contracts.title, "%SUAS%Reusable Architecture%"))
    .limit(1);

  if (!contract) {
    console.error("Contract not found!");
    process.exit(1);
  }

  console.log(`Found: ${contract.title}`);
  console.log(`Current classification: ${contract.classification}`);
  console.log(`Current reasoning: ${contract.aiReasoning}\n`);

  const prompt = buildMetadataClassificationPrompt({
    title: contract.title,
    naicsCode: contract.naicsCode,
    pscCode: contract.pscCode,
    agency: contract.agency,
    orgPathName: contract.orgPathName,
    noticeType: contract.noticeType,
    setAsideType: contract.setAsideType,
    setAsideCode: contract.setAsideCode,
    popState: contract.popState,
    awardCeiling: contract.awardCeiling,
  });

  const ai = getGrokClient();

  console.log(`Calling Grok (${GROK_MODEL})...`);
  const start = Date.now();

  const response = await ai.chat.completions.create({
    model: GROK_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - start;
  const rawContent = response.choices[0]?.message?.content ?? "";

  console.log(`API call took: ${elapsed}ms`);
  console.log(`\nRaw response:\n${rawContent}\n`);

  const result = parseClassificationResponse(rawContent || undefined);

  console.log("=== GROK RESULT ===");
  console.log(`Classification: ${result.classification}`);
  console.log(`Reasoning: ${result.reasoning}`);
  console.log(`Summary: ${result.summary}`);

  // Write to DB
  await db
    .update(contracts)
    .set({
      classification: result.classification,
      aiReasoning: result.reasoning,
      summary: result.summary,
      classifiedFromMetadata: true,
      updatedAt: new Date(),
    })
    .where(eq(contracts.id, contract.id));

  // Verify DB write
  const [updated] = await db
    .select({
      classification: contracts.classification,
      aiReasoning: contracts.aiReasoning,
      summary: contracts.summary,
    })
    .from(contracts)
    .where(eq(contracts.id, contract.id))
    .limit(1);

  console.log("\n=== DB VERIFICATION ===");
  console.log(`Classification: ${updated.classification}`);
  console.log(`Reasoning: ${updated.aiReasoning}`);
  console.log(`Summary: ${updated.summary}`);

  // Usage info
  if (response.usage) {
    console.log(`\nTokens — prompt: ${response.usage.prompt_tokens}, completion: ${response.usage.completion_tokens}, total: ${response.usage.total_tokens}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
