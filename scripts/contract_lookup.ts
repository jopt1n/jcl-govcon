import "./load-env";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: contract_lookup.ts <uuid>");
    process.exit(1);
  }
  const rows = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!rows.length) {
    console.log("NOT FOUND");
    process.exit(1);
  }
  const c = rows[0];
  console.log(
    JSON.stringify(
      {
        id: c.id,
        noticeId: c.noticeId,
        solicitationNumber: c.solicitationNumber,
        title: c.title,
        agency: c.agency,
        orgPathName: c.orgPathName,
        naicsCode: c.naicsCode,
        pscCode: c.pscCode,
        noticeType: c.noticeType,
        setAsideType: c.setAsideType,
        setAsideCode: c.setAsideCode,
        awardCeiling: c.awardCeiling,
        responseDeadline: c.responseDeadline,
        postedDate: c.postedDate,
        classification: c.classification,
        aiReasoning: c.aiReasoning,
        summary: c.summary,
        popState: c.popState,
        popCity: c.popCity,
        popZip: c.popZip,
        officeCity: c.officeCity,
        officeState: c.officeState,
        contactEmail: c.contactEmail,
        samUrl: c.samUrl,
        resourceLinks: c.resourceLinks,
        tags: c.tags,
        descriptionFetched: c.descriptionFetched,
        documentsAnalyzed: c.documentsAnalyzed,
        actionPlan: c.actionPlan,
        descriptionLength: c.descriptionText?.length ?? 0,
      },
      null,
      2,
    ),
  );
  console.log("\n--- DESCRIPTION TEXT ---");
  console.log(c.descriptionText ?? "(no description)");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
