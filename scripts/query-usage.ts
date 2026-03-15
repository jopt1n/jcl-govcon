process.env.SAM_DRY_RUN = "true";
import { db } from "@/lib/db";
import { apiUsage } from "@/lib/db/schema";

async function main() {
  const rows = await db.select().from(apiUsage).orderBy(apiUsage.date);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
