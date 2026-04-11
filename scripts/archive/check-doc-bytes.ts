import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";

async function main() {
  const rows = await db.select({ resourceLinks: contracts.resourceLinks, title: contracts.title })
    .from(contracts)
    .where(and(eq(contracts.classification, "PENDING"), sql`jsonb_array_length(coalesce(resource_links, '[]'::jsonb)) >= 1`))
    .limit(5);

  for (const c of rows) {
    const links = (c.resourceLinks ?? []) as any[];
    const url = typeof links[0] === "string" ? links[0] : links[0]?.url;
    console.log(`\n${c.title}`);
    console.log(`  URL: ${url}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "follow" });
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "";
      const cd = res.headers.get("content-disposition") ?? "";
      console.log(`  Status: ${res.status}, CT: ${ct}, CD: ${cd}`);
      console.log(`  First 20 bytes: ${buf.slice(0, 20).toString("hex")}`);
      console.log(`  First 20 as text: ${buf.slice(0, 20).toString("utf-8")}`);
      console.log(`  Size: ${buf.length} bytes`);
    } catch (err) {
      console.log(`  Error: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(0);
}
main().catch(console.error);
