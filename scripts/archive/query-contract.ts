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
  const { ilike } = await import("drizzle-orm");

  const search = process.argv[2] || "Medical Disability";
  const rows = await db
    .select()
    .from(contracts)
    .where(ilike(contracts.title, `%${search}%`))
    .limit(5);

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
          responseDeadline: r.responseDeadline,
          actionPlan: r.actionPlan,
          description: r.description?.substring(0, 1500),
        },
        null,
        2,
      ),
    );
  }
  process.exit(0);
}
main();
