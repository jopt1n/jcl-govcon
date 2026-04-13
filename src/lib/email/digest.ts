import { Resend } from "resend";
import { db } from "@/lib/db";
import { contracts, settings } from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";

const resend = new Resend(process.env.RESEND_API_KEY);

type Contract = typeof contracts.$inferSelect;

interface DigestResult {
  sent: boolean;
  recipients: number;
  good: number;
  maybe: number;
}

// ── Settings helpers ────────────────────────────────────────────────────────

async function getSetting<T>(key: string): Promise<T | null> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].value as T;
}

// ── Query helpers ───────────────────────────────────────────────────────────

function todayMidnightUTC(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

async function getNewContracts(
  classification: "GOOD" | "MAYBE",
  since: Date,
): Promise<Contract[]> {
  return db
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.classification, classification),
        gte(contracts.createdAt, since),
      ),
    );
}

// ── Email builder ───────────────────────────────────────────────────────────

function formatCurrency(value: string | null): string {
  if (!value) return "N/A";
  const num = parseFloat(value);
  if (isNaN(num)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

function formatDate(date: Date | null): string {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

function truncate(text: string | null, maxLen: number): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function buildContractRow(c: Contract): string {
  return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
        <a href="${c.samUrl}" style="color:#2563eb;text-decoration:none;font-weight:500;">${c.title}</a>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${c.agency ?? "N/A"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${formatCurrency(c.awardCeiling)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${formatDate(c.responseDeadline)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#4b5563;">${truncate(c.aiReasoning, 120)}</td>
    </tr>`;
}

function buildHtml(
  goodContracts: Contract[],
  maybeContracts: Contract[],
): string {
  const goodRows = goodContracts.map(buildContractRow).join("");
  const maybeSection =
    maybeContracts.length > 0
      ? `
    <h2 style="color:#92400e;font-size:18px;margin:32px 0 12px;">Maybe Contracts (${maybeContracts.length})</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#fffbeb;">
          <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #fbbf24;">Title</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #fbbf24;">Agency</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #fbbf24;">Ceiling</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #fbbf24;">Deadline</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #fbbf24;">Reasoning</th>
        </tr>
      </thead>
      <tbody>${maybeContracts.map(buildContractRow).join("")}</tbody>
    </table>`
      : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:900px;margin:0 auto;padding:20px;">
  <h1 style="color:#1e3a5f;font-size:22px;margin-bottom:4px;">JCL GovCon Daily Digest</h1>
  <p style="color:#6b7280;font-size:14px;margin-top:0;">${formatDate(new Date())}</p>

  <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;margin:16px 0;border-radius:4px;">
    <strong>${goodContracts.length}</strong> new GOOD contract${goodContracts.length !== 1 ? "s" : ""}
    ${maybeContracts.length > 0 ? ` &middot; <strong>${maybeContracts.length}</strong> MAYBE` : ""}
  </div>

  <h2 style="color:#166534;font-size:18px;margin:24px 0 12px;">Good Contracts</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr style="background:#f0fdf4;">
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #22c55e;">Title</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #22c55e;">Agency</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #22c55e;">Ceiling</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #22c55e;">Deadline</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #22c55e;">Reasoning</th>
      </tr>
    </thead>
    <tbody>${goodRows}</tbody>
  </table>

  ${maybeSection}

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
  <p style="color:#9ca3af;font-size:12px;">Sent by JCL GovCon contract intelligence system</p>
</body>
</html>`;
}

// ── Main digest function ────────────────────────────────────────────────────

export async function sendDigest(): Promise<DigestResult> {
  // Check if digest is enabled
  const digestEnabled = await getSetting<boolean>("digest_enabled");
  if (digestEnabled === false) {
    return { sent: false, recipients: 0, good: 0, maybe: 0 };
  }

  // Get recipients
  const recipients = await getSetting<string[]>("email_recipients");
  if (!recipients || recipients.length === 0) {
    return { sent: false, recipients: 0, good: 0, maybe: 0 };
  }

  // Query today's contracts
  const since = todayMidnightUTC();
  const goodContracts = await getNewContracts("GOOD", since);
  const maybeContracts = await getNewContracts("MAYBE", since);

  // Silent on days with no new GOODs
  if (goodContracts.length === 0) {
    return {
      sent: false,
      recipients: recipients.length,
      good: 0,
      maybe: maybeContracts.length,
    };
  }

  // Limit maybe contracts to top 5
  const topMaybes = maybeContracts.slice(0, 5);

  const html = buildHtml(goodContracts, topMaybes);
  const subject = `[GovCon] ${goodContracts.length} New Opportunity${goodContracts.length !== 1 ? "ies" : "y"} — ${formatDate(new Date())}`;

  await resend.emails.send({
    from: "JCL GovCon <notifications@resend.dev>",
    to: recipients,
    subject,
    html,
  });

  return {
    sent: true,
    recipients: recipients.length,
    good: goodContracts.length,
    maybe: topMaybes.length,
  };
}
