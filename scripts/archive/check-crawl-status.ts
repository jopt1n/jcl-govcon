import { getTodayUsage } from "../src/lib/sam-gov/client";
import { db } from "../src/lib/db";
import { contracts, crawlProgress } from "../src/lib/db/schema";
import { sql, eq } from "drizzle-orm";

async function main() {
  const usage = await getTodayUsage();
  console.log("API usage today:", usage);

  const [total] = await db.select({ count: sql<number>`count(*)` }).from(contracts);
  console.log("Total contracts in DB:", total.count);

  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(contracts).where(eq(contracts.classification, "PENDING"));
  console.log("PENDING:", pending.count);

  const crawls = await db.select().from(crawlProgress).orderBy(sql`id desc`).limit(2);
  console.log("Crawl progress:", JSON.stringify(crawls, null, 2));

  process.exit(0);
}

main().catch(console.error);
