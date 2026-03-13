import { db } from "@/lib/db";
import { apiUsage } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import type { SamSearchParams, SamSearchResponse } from "./types";

const SAM_BASE_URL = "https://api.sam.gov/opportunities/v2/search";

function getApiKey(): string {
  const key = process.env.SAM_GOV_API_KEY;
  if (!key) throw new Error("SAM_GOV_API_KEY environment variable is not set");
  return key;
}

/** Format a Date as MM/dd/yyyy for the SAM.gov API */
export function formatSamDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/** Get today's date as YYYY-MM-DD for the api_usage table */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Increment search call count for today */
async function trackSearchCall(): Promise<void> {
  const today = todayKey();
  await db
    .insert(apiUsage)
    .values({ date: today, searchCalls: 1, docFetches: 0 })
    .onConflictDoUpdate({
      target: apiUsage.date,
      set: {
        searchCalls: sql`${apiUsage.searchCalls} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

/** Increment doc fetch count for today */
async function trackDocFetch(): Promise<void> {
  const today = todayKey();
  await db
    .insert(apiUsage)
    .values({ date: today, searchCalls: 0, docFetches: 1 })
    .onConflictDoUpdate({
      target: apiUsage.date,
      set: {
        docFetches: sql`${apiUsage.docFetches} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

/** Get current API usage for today to check rate limits */
export async function getTodayUsage(): Promise<{
  searchCalls: number;
  docFetches: number;
}> {
  const today = todayKey();
  const rows = await db
    .select()
    .from(apiUsage)
    .where(eq(apiUsage.date, today))
    .limit(1);

  if (rows.length === 0) return { searchCalls: 0, docFetches: 0 };
  return {
    searchCalls: rows[0].searchCalls,
    docFetches: rows[0].docFetches,
  };
}

/** Check whether we're still under the daily SAM.gov API call limit */
export async function canMakeCall(): Promise<boolean> {
  const dailyLimit = parseInt(process.env.SAM_DAILY_LIMIT || "950");
  const today = todayKey();
  const rows = await db
    .select()
    .from(apiUsage)
    .where(eq(apiUsage.date, today))
    .limit(1);

  if (rows.length === 0) return true;
  return rows[0].searchCalls < dailyLimit;
}

/**
 * Search SAM.gov opportunities with pagination.
 * Each call counts as 1 search API call (max 1,000/day).
 */
export async function searchOpportunities(
  params: SamSearchParams
): Promise<SamSearchResponse> {
  const dryRun = process.env.SAM_DRY_RUN === "true";

  const url = new URL(SAM_BASE_URL);
  url.searchParams.set("api_key", "REDACTED");
  url.searchParams.set("ptype", params.ptype);
  url.searchParams.set("limit", String(params.limit ?? 1000));
  url.searchParams.set("offset", String(params.offset ?? 0));

  if (params.postedFrom) url.searchParams.set("postedFrom", params.postedFrom);
  if (params.postedTo) url.searchParams.set("postedTo", params.postedTo);
  if (params.active) url.searchParams.set("active", params.active);

  if (dryRun) {
    console.log(`[DRY_RUN] searchOpportunities: ${url.toString()}`);
    return { totalRecords: 0, opportunitiesData: [] };
  }

  const apiKey = getApiKey();
  url.searchParams.set("api_key", apiKey);

  await trackSearchCall();

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `SAM.gov API error ${res.status}: ${res.statusText} — ${body}`
    );
  }

  const data: SamSearchResponse = await res.json();
  return data;
}

/**
 * Fetch the full description text from a SAM.gov description URL.
 * This costs 1 API call against the daily limit.
 */
export async function fetchDescription(descriptionUrl: string): Promise<string> {
  const dryRun = process.env.SAM_DRY_RUN === "true";

  if (dryRun) {
    console.log(`[DRY_RUN] fetchDescription: ${descriptionUrl}`);
    return "";
  }

  const apiKey = getApiKey();

  // The description URL may already have query params
  const separator = descriptionUrl.includes("?") ? "&" : "?";
  const url = `${descriptionUrl}${separator}api_key=${apiKey}`;

  await trackDocFetch();

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `SAM.gov description fetch error ${res.status}: ${res.statusText} — ${body}`
    );
  }

  const text = await res.text();
  return text;
}
