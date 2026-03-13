"use client";

import { useState, useCallback } from "react";
import {
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Play,
  Building2,
  Mail,
  Zap,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsFormProps {
  initialSettings: Record<string, unknown>;
  apiUsage: { searchCalls: number; docFetches: number };
}

export function SettingsForm({ initialSettings, apiUsage }: SettingsFormProps) {
  const [companyProfile, setCompanyProfile] = useState<string>(
    (initialSettings.company_profile as string) ?? ""
  );
  const [emailRecipients, setEmailRecipients] = useState<string>(
    Array.isArray(initialSettings.email_recipients)
      ? (initialSettings.email_recipients as string[]).join(", ")
      : ""
  );
  const [digestEnabled, setDigestEnabled] = useState<boolean>(
    (initialSettings.digest_enabled as boolean) ?? false
  );

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState("");

  const [ingesting, setIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [ingestMessage, setIngestMessage] = useState("");

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      const recipients = emailRecipients
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_profile: companyProfile,
          email_recipients: recipients,
          digest_enabled: digestEnabled,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }

      setSaveStatus("success");
      setSaveMessage("Settings saved successfully.");
    } catch (err) {
      setSaveStatus("error");
      setSaveMessage(
        err instanceof Error ? err.message : "Failed to save settings"
      );
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus("idle"), 4000);
    }
  }, [companyProfile, emailRecipients, digestEnabled]);

  const handleIngest = useCallback(async (mode: "daily" | "bulk") => {
    setIngesting(true);
    setIngestStatus("idle");
    setIngestMessage("");
    try {
      const res = await fetch("/api/ingest/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Ingest failed");
      }

      setIngestStatus("success");
      setIngestMessage(
        mode === "daily"
          ? `Daily ingest complete: ${data.new ?? 0} new, ${data.skipped ?? 0} skipped`
          : `Bulk crawl complete: ${data.new ?? 0} new, ${data.total ?? 0} total found`
      );
    } catch (err) {
      setIngestStatus("error");
      setIngestMessage(
        err instanceof Error ? err.message : "Ingest failed"
      );
    } finally {
      setIngesting(false);
      setTimeout(() => setIngestStatus("idle"), 8000);
    }
  }, []);

  return (
    <div className="space-y-8">
      {/* Company Profile */}
      <section className="bg-[var(--surface)] rounded-lg border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] p-6">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-5 h-5 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Company Profile
          </h2>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-3">
          Describe your company capabilities. This feeds into the AI
          classification prompt to evaluate contract fit.
        </p>
        <textarea
          value={companyProfile}
          onChange={(e) => setCompanyProfile(e.target.value)}
          rows={6}
          placeholder="e.g. JCL provides IT services including cloud migration, cybersecurity, and data analytics to federal agencies. We hold a Secret clearance and are 8(a) certified..."
          className="w-full rounded-md bg-[var(--surface-alt)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent resize-y"
        />
      </section>

      {/* Email Configuration */}
      <section className="bg-[var(--surface)] rounded-lg border border-[var(--border)] border-l-[3px] border-l-[var(--good)] p-6">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-[var(--good)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Email Configuration
          </h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              Digest Recipients
            </label>
            <input
              type="text"
              value={emailRecipients}
              onChange={(e) => setEmailRecipients(e.target.value)}
              placeholder="alice@company.com, bob@company.com"
              className="w-full rounded-md bg-[var(--surface-alt)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Comma-separated email addresses for the daily digest.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={digestEnabled}
              onClick={() => setDigestEnabled(!digestEnabled)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2",
                digestEnabled ? "bg-[var(--accent)]" : "bg-[var(--border)]"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out",
                  digestEnabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
            <span className="text-sm text-[var(--text-secondary)]">
              {digestEnabled ? "Daily digest enabled" : "Daily digest disabled"}
            </span>
          </div>
        </div>
      </section>

      {/* Ingestion */}
      <section className="bg-[var(--surface)] rounded-lg border border-[var(--border)] border-l-[3px] border-l-[var(--maybe)] p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-[var(--maybe)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Ingestion</h2>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          Manually trigger a SAM.gov data ingest. Daily mode fetches the last 24
          hours; bulk mode crawls all active solicitations.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleIngest("daily")}
            disabled={ingesting}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {ingesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Run Daily Ingest
          </button>
          <button
            onClick={() => handleIngest("bulk")}
            disabled={ingesting}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {ingesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Run Bulk Crawl
          </button>
        </div>
        {ingestStatus !== "idle" && (
          <div
            className={cn(
              "mt-3 flex items-center gap-2 text-sm rounded-md px-3 py-2",
              ingestStatus === "success"
                ? "bg-emerald-500/10 text-[var(--good)]"
                : "bg-red-500/10 text-[var(--urgent)]"
            )}
          >
            {ingestStatus === "success" ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            {ingestMessage}
          </div>
        )}
      </section>

      {/* API Usage */}
      <section className="bg-[var(--surface)] rounded-lg border border-[var(--border)] border-l-[3px] border-l-[var(--discard)] p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-[var(--discard)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            API Usage (Today)
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-md bg-[var(--surface-alt)] border border-[var(--border)] p-4">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
              SAM.gov Search Calls
            </p>
            <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">
              {apiUsage.searchCalls}
            </p>
          </div>
          <div className="rounded-md bg-[var(--surface-alt)] border border-[var(--border)] p-4">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Document Fetches
            </p>
            <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">
              {apiUsage.docFetches}
            </p>
          </div>
        </div>
      </section>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-6 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Settings
        </button>
        {saveStatus !== "idle" && (
          <div
            className={cn(
              "flex items-center gap-2 text-sm",
              saveStatus === "success" ? "text-[var(--good)]" : "text-[var(--urgent)]"
            )}
          >
            {saveStatus === "success" ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            {saveMessage}
          </div>
        )}
      </div>
    </div>
  );
}
