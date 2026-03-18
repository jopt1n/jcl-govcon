import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";

async function main() {
  const rows = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN description_fetched = true THEN 1 END) as has_description,
      COUNT(CASE WHEN description_fetched = false OR description_fetched IS NULL THEN 1 END) as no_description,
      COUNT(CASE WHEN resource_links IS NOT NULL AND resource_links != '[]' THEN 1 END) as has_docs
    FROM contracts 
    WHERE classification IN ('GOOD','MAYBE') AND classification_round = 2
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main();
