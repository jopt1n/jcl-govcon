import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(__dirname, "../.env");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

async function main() {
  const { db } = await import("../src/lib/db");
  const { contracts } = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const noticeId = process.argv[2];
  const rows = await db
    .select()
    .from(contracts)
    .where(eq(contracts.noticeId, noticeId))
    .limit(1);

  for (const r of rows) {
    console.log(
      JSON.stringify(
        {
          id: r.id,
          noticeId: r.noticeId,
          title: r.title,
          classification: r.classification,
          classificationReason: r.classificationReason,
          noticeType: r.noticeType,
          setAsideCode: r.setAsideCode,
          naicsCode: r.naicsCode,
          responseDeadline: r.responseDeadline,
          actionPlan: r.actionPlan,
          description: r.description?.substring(0, 3000),
        },
        null,
        2,
      ),
    );
  }
  process.exit(0);
}
main();
