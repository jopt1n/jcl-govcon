// ── SAM.gov API Types ────────────────────────────────────────────────────────

/** Raw opportunity from SAM.gov /v2/search response */
export interface SamOpportunity {
  noticeId: string;
  solicitationNumber: string | null;
  title: string;
  fullParentPathName: string | null; // agency hierarchy e.g. "DEPT OF DEFENSE.DEPT OF THE NAVY"
  fullParentPathCode: string | null; // agency code hierarchy e.g. "097.4730.47QTCA"
  naicsCode: string | null;
  classificationCode: string | null; // PSC code
  type: string; // e.g. "Solicitation", "Combined Synopsis/Solicitation"
  baseType: string; // e.g. "Solicitation"
  typeOfSetAside: string | null;
  archiveDate: string | null;
  responseDeadDate: string | null;
  postedDate: string;
  active: string; // "Yes" | "No"
  description: string | null; // URL to fetch description text (costs 1 API call)
  uiLink: string; // public-facing SAM.gov URL
  resourceLinks: SamResourceLink[] | null;
  award: SamAward | null;
  pointOfContact: SamContact[] | null;
  officeAddress: SamAddress | null;
  placeOfPerformance: SamPlaceOfPerformance | null;
  additionalInfoLink: string | null;
  organizationType: string | null;
}

export interface SamResourceLink {
  url: string;
  description: string | null;
}

export interface SamAward {
  amount: string | null;
  date: string | null;
  number: string | null;
  awardee: {
    name: string | null;
    ueiSAM: string | null;
  } | null;
}

export interface SamContact {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  type: string | null;
}

export interface SamAddress {
  city: string | null;
  state: string | null;
  zip: string | null;
  countryCode: string | null;
}

export interface SamPlaceOfPerformance {
  streetAddress?: string | null;
  city: { code?: string | null; name: string | null } | null;
  state: { code: string | null; name: string | null } | null;
  zip?: string | null;
  country: { code: string | null; name: string | null } | null;
}

/** Top-level SAM.gov search response */
export interface SamSearchResponse {
  totalRecords: number;
  opportunitiesData: SamOpportunity[] | null;
}

/** Search parameters for the SAM.gov API */
export interface SamSearchParams {
  /** Procurement types: o = solicitation, k = combined synopsis/solicitation */
  ptype: string;
  /** Start date for posted date range (MM/dd/yyyy) */
  postedFrom?: string;
  /** End date for posted date range (MM/dd/yyyy) */
  postedTo?: string;
  /** Filter active opportunities: "Yes" | "No" */
  active?: string;
  /** Max results per page (max 1000) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/** Result from the ingest trigger endpoint */
export interface IngestResult {
  total: number;
  new: number;
  skipped: number;
  docs_queued: number;
}

/** Downloaded document for analysis */
export interface DownloadedDocument {
  url: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}
