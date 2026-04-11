import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { and, inArray, isNull, sql } from "drizzle-orm";

async function main() {
const rows = await db
  .select({
    id: contracts.id,
    title: contracts.title,
    classification: contracts.classification,
    resourceLinks: contracts.resourceLinks,
  })
  .from(contracts)
  .where(
    and(
      inArray(contracts.classification, ["GOOD", "MAYBE"]),
      isNull(contracts.actionPlan)
    )
  );

// Sort by link count descending
const sorted = rows
  .map((r) => ({ ...r, linkCount: (r.resourceLinks || []).length }))
  .filter((r) => r.linkCount > 0)
  .sort((a, b) => b.linkCount - a.linkCount);

for (const r of sorted.slice(0, 15)) {
  const links = r.resourceLinks || [];
  const urls = links.map((l) => {
    try {
      const path = new URL(l).pathname;
      const parts = path.split("/");
      return parts[parts.length - 1]?.slice(0, 30) || "?";
    } catch {
      return "?";
    }
  });
  console.log(`[${r.linkCount} docs] ${r.classification} — ${r.title.slice(0, 70)}`);
  console.log(`  ID: ${r.id}`);
  console.log(`  Files: ${urls.join(", ")}`);
}
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
