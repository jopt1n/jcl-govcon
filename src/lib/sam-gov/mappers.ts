import type { SamOpportunity, SamResourceLink } from "./types";

/**
 * Map a SAM.gov opportunity to a contract insert row.
 */
export function mapOpportunityToContract(opp: SamOpportunity) {
  const linkUrls: string[] = (opp.resourceLinks ?? []).map(
    (rl: SamResourceLink) => rl.url
  );

  return {
    noticeId: opp.noticeId,
    solicitationNumber: opp.solicitationNumber,
    title: opp.title,
    agency: opp.fullParentPathName,
    naicsCode: opp.naicsCode,
    pscCode: opp.classificationCode,
    noticeType: opp.type,
    setAsideType: opp.typeOfSetAside,
    awardCeiling: opp.award?.amount ?? null,
    responseDeadline: opp.responseDeadDate
      ? new Date(opp.responseDeadDate)
      : null,
    postedDate: new Date(opp.postedDate),
    active: opp.active === "Yes",
    samUrl: opp.uiLink,
    resourceLinks: linkUrls,
    rawJson: opp as unknown as Record<string, unknown>,
    // New columns
    orgPathName: opp.fullParentPathName ?? null,
    orgPathCode: opp.fullParentPathCode ?? null,
    popState: opp.placeOfPerformance?.state?.code ?? null,
    popCity: opp.placeOfPerformance?.city?.name ?? null,
    popZip: opp.placeOfPerformance?.zip ?? null,
    officeCity: opp.officeAddress?.city ?? null,
    officeState: opp.officeAddress?.state ?? null,
    setAsideCode: opp.typeOfSetAside ?? null,
    descriptionFetched: false,
    classifiedFromMetadata: false,
  };
}
