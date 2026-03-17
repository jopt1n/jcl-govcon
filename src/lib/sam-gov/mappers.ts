import type { SamOpportunity } from "./types";

/**
 * Map a SAM.gov opportunity to a contract insert row.
 */
export function mapOpportunityToContract(opp: SamOpportunity) {
  const linkUrls: string[] = (opp.resourceLinks ?? [])
    .map((rl) => (typeof rl === "string" ? rl : rl.url))
    .filter(Boolean) as string[];

  const tags: string[] = [];
  if (opp.typeOfSetAside) tags.push("SBA");
  if (linkUrls.length > 0) tags.push("HAS_DOCS");

  return {
    noticeId: opp.noticeId,
    solicitationNumber: opp.solicitationNumber,
    title: opp.title,
    agency: opp.fullParentPathName,
    naicsCode: opp.naicsCode,
    pscCode: opp.classificationCode,
    noticeType: opp.type,
    setAsideType: opp.typeOfSetAside || null,
    awardCeiling: opp.award?.amount || null,
    responseDeadline: opp.responseDeadLine
      ? new Date(opp.responseDeadLine)
      : null,
    postedDate: new Date(opp.postedDate),
    active: opp.active === "Yes",
    samUrl: opp.uiLink,
    resourceLinks: linkUrls,
    rawJson: opp as unknown as Record<string, unknown>,
    orgPathName: opp.fullParentPathName ?? null,
    orgPathCode: opp.fullParentPathCode ?? null,
    popState: opp.placeOfPerformance?.state?.code ?? null,
    popCity: opp.placeOfPerformance?.city?.name ?? null,
    popZip: opp.placeOfPerformance?.zip ?? null,
    officeCity: opp.officeAddress?.city ?? null,
    officeState: opp.officeAddress?.state ?? null,
    setAsideCode: opp.typeOfSetAside || null,
    tags,
    classificationRound: 0,
    descriptionFetched: false,
    classifiedFromMetadata: false,
  };
}
