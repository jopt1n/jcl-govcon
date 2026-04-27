import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  timestamp,
  boolean,
  jsonb,
  integer,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

type WatchSnapshot = {
  contractId: string | null;
  noticeId: string | null;
  solicitationNumber: string | null;
  title: string | null;
  agency: string | null;
  noticeType: string | null;
  responseDeadline: string | null;
  setAsideCode: string | null;
  resourceUrls: string[];
};

// ── Enums ──────────────────────────────────────────────────────────────────

export const classificationEnum = pgEnum("classification", [
  "GOOD",
  "MAYBE",
  "DISCARD",
  "PENDING",
]);

export const contractStatusEnum = pgEnum("contract_status", [
  "IDENTIFIED",
  "PURSUING",
  "BID_SUBMITTED",
  "WON",
  "LOST",
]);

export const crawlStatusEnum = pgEnum("crawl_status", [
  "RUNNING",
  "PAUSED",
  "COMPLETE",
]);

export const batchJobStatusEnum = pgEnum("batch_job_status", [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "PAUSED",
]);

export const watchStatusEnum = pgEnum("watch_status", [
  "MONITORING",
  "MATCHED",
  "NEEDS_REVIEW",
  "INACTIVE",
]);

export const watchLinkTypeEnum = pgEnum("watch_link_type", [
  "source",
  "auto_candidate",
  "manual_candidate",
  "primary",
]);

// ── Tables ─────────────────────────────────────────────────────────────────

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: text("notice_id").notNull().unique(),
    solicitationNumber: text("solicitation_number"),
    title: text("title").notNull(),
    agency: text("agency"),
    naicsCode: text("naics_code"),
    pscCode: text("psc_code"),
    noticeType: text("notice_type"),
    setAsideType: text("set_aside_type"),
    awardCeiling: numeric("award_ceiling"),
    responseDeadline: timestamp("response_deadline", { withTimezone: true }),
    postedDate: timestamp("posted_date", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    classification: classificationEnum("classification")
      .notNull()
      .default("PENDING"),
    aiReasoning: text("ai_reasoning"),
    summary: text("summary"),
    descriptionText: text("description_text"),
    userOverride: boolean("user_override").notNull().default(false),
    status: contractStatusEnum("status").default("IDENTIFIED"),
    notes: text("notes"),
    samUrl: text("sam_url").notNull(),
    resourceLinks: jsonb("resource_links").$type<string[]>().default([]),
    rawJson: jsonb("raw_json"),
    documentsAnalyzed: boolean("documents_analyzed").notNull().default(false),
    // Organization hierarchy
    orgPathName: text("org_path_name"),
    orgPathCode: text("org_path_code"),
    // Place of performance
    popState: text("pop_state"),
    popCity: text("pop_city"),
    popZip: text("pop_zip"),
    // Contracting office location
    officeCity: text("office_city"),
    officeState: text("office_state"),
    // Set-aside code
    setAsideCode: text("set_aside_code"),
    // Contracting officer email (scraped from SAM.gov, not AI-extracted)
    contactEmail: text("contact_email"),
    // AI-generated action plan (JSON string with deliverables, tools, steps)
    actionPlan: text("action_plan"),
    // Computed tags for filtering
    tags: jsonb("tags").$type<string[]>().default([]),
    // Pipeline phase tracking
    classificationRound: integer("classification_round").notNull().default(1),
    descriptionFetched: boolean("description_fetched").notNull().default(false),
    classifiedFromMetadata: boolean("classified_from_metadata")
      .notNull()
      .default(false),
    // Inbox triage: null = unreviewed (shows on /inbox), non-null = triaged (shows on main Kanban)
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // User-driven promotion above the AI classifier. The classifier is tuned for
    // recall (see feedback_classification_recall.md memory) — most GOOD contracts
    // aren't actually ideal. `promoted=true` is the user's "this one's worth
    // pursuing" signal. Surfaced on /chosen with gold accent. Orthogonal to
    // classification (AI label is preserved) and to status (pipeline lifecycle).
    promoted: boolean("promoted").notNull().default(false),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    // Pipeline tracking: bumped whenever status changes; powers weekly retro stats
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    solicitationNumberIdx: index("solicitation_number_idx").on(
      table.solicitationNumber,
    ),
    inboxQueryIdx: index("contracts_inbox_idx").on(
      table.reviewedAt,
      table.createdAt,
    ),
    statusChangedAtIdx: index("contracts_status_changed_at_idx").on(
      table.statusChangedAt,
    ),
    // Standalone createdAt index for the weekly-crawl since-filter queries.
    // The composite (reviewedAt, createdAt) index does not reliably serve
    // `WHERE createdAt >= X` when reviewedAt isn't in the filter.
    createdAtIdx: index("contracts_created_at_idx").on(table.createdAt),
    // Partial index for /chosen page (ORDER BY promoted_at DESC WHERE promoted=true).
    // Stays tiny because 99%+ of rows have promoted=false. Fallback to composite
    // (promoted, promoted_at) if drizzle-kit drops the WHERE clause silently.
    promotedIdx: index("contracts_promoted_idx")
      .on(table.promotedAt)
      .where(sql`${table.promoted} = true`),
  }),
);

export const apiUsage = pgTable("api_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull().unique(),
  searchCalls: integer("search_calls").notNull().default(0),
  docFetches: integer("doc_fetches").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const settings = pgTable("settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
});

export const crawlProgress = pgTable("crawl_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  totalFound: integer("total_found").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  classified: integer("classified").notNull().default(0),
  lastOffset: integer("last_offset").notNull().default(0),
  batchJobId: text("batch_job_id"),
  status: crawlStatusEnum("status").notNull().default("RUNNING"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const batchJobs = pgTable("batch_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  geminiJobName: text("gemini_job_name").notNull(),
  contractsCount: integer("contracts_count").notNull(),
  status: batchJobStatusEnum("status").notNull().default("PENDING"),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  resultsJson: jsonb("results_json"),
});

// ── Weekly pipeline runs ───────────────────────────────────────────────────
//
// One row per automated weekly crawl (kind="weekly") or manual trigger
// (kind="manual"). Spans multiple HTTP requests:
//
//   weekly-crawl route → INSERT row, crawl, submit xAI batch, return
//   check-batches route (every 30 min) → atomic-claim via processingAt,
//     poll batch, import on completion, fire Telegram digest once,
//     set digestSentAt
//
// Concurrency gate: processingAt acts as a 5-minute lease. Only the winning
// claimant processes a given row; crash recovery happens when the lease
// expires. digestSentAt ensures the Telegram digest fires exactly once per
// succeeded run.
//
// Status lifecycle: running → crawled → classifying → succeeded | failed | stalled
export const crawlRuns = pgTable(
  "crawl_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // "weekly" | "manual"
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    crawlStartedAt: timestamp("crawl_started_at", { withTimezone: true }),
    crawlFinishedAt: timestamp("crawl_finished_at", { withTimezone: true }),
    batchId: text("batch_id"),
    batchStatus: text("batch_status"), // "submitted" | "running" | "completed" | "failed"
    batchStartedAt: timestamp("batch_started_at", { withTimezone: true }),
    batchFinishedAt: timestamp("batch_finished_at", { withTimezone: true }),
    contractsFound: integer("contracts_found").notNull().default(0),
    contractsClassified: integer("contracts_classified").notNull().default(0),
    digestSentAt: timestamp("digest_sent_at", { withTimezone: true }),
    // Atomic claim lease: non-null + fresh = another request is processing
    processingAt: timestamp("processing_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    errorStep: text("error_step"), // "crawl" | "batch_submit" | "batch_poll" | "import" | "digest" | "telegram_config"
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    activeBatchIdx: index("crawl_runs_active_batch_idx").on(
      table.batchFinishedAt,
      table.batchId,
    ),
  }),
);

// ── Audit log ──────────────────────────────────────────────────────────────
//
// Records user-driven lifecycle actions on contracts (promote/demote/watch/
// unwatch in v1; status transitions in Phase 9). Written-only in v1 — no
// admin viewer yet.
//
// IMPORTANT: contractId is intentionally nullable + onDelete: 'set null'.
// The whole point of an audit log is to answer "what did I do?" even when the
// source contract is deleted. Orphaned rows keep their action + created_at as
// forensic records. Do NOT add .notNull() here — it would break the SET NULL
// cascade and lose history on contract deletion.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").references(() => contracts.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(), // "promote" | "demote" | future: status transitions
    metadata: jsonb("metadata"), // optional forensic context, unused in v1
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    contractIdIdx: index("audit_log_contract_id_idx").on(
      table.contractId,
      table.createdAt,
    ),
  }),
);

// ── Watch targets ─────────────────────────────────────────────────────────
//
// A watch target is a first-class operator workflow separate from the raw
// contract rows underneath it. It starts from one source contract snapshot,
// can later link to multiple candidate contract rows, and tracks the current
// resolved snapshot for change diffing + alert dedupe.
export const watchTargets = pgTable(
  "watch_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceContractId: uuid("source_contract_id").references(() => contracts.id, {
      onDelete: "set null",
    }),
    sourceNoticeId: text("source_notice_id").notNull(),
    sourceSolicitationNumber: text("source_solicitation_number"),
    sourceTitle: text("source_title").notNull(),
    sourceAgency: text("source_agency"),
    sourceNoticeType: text("source_notice_type"),
    sourceResponseDeadline: timestamp("source_response_deadline", {
      withTimezone: true,
    }),
    sourceSetAsideCode: text("source_set_aside_code"),
    sourceResourceUrls: jsonb("source_resource_urls")
      .$type<string[]>()
      .notNull()
      .default([]),
    currentSnapshot: jsonb("current_snapshot").$type<WatchSnapshot | null>(),
    status: watchStatusEnum("status").notNull().default("MONITORING"),
    primaryContractId: uuid("primary_contract_id").references(() => contracts.id, {
      onDelete: "set null",
    }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    watchedAt: timestamp("watched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    unwatchedAt: timestamp("unwatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceContractIdIdx: uniqueIndex("watch_targets_source_contract_id_idx").on(
      table.sourceContractId,
    ),
    activeStatusIdx: index("watch_targets_active_status_idx").on(
      table.active,
      table.status,
      table.watchedAt,
    ),
    primaryContractIdx: index("watch_targets_primary_contract_idx").on(
      table.primaryContractId,
    ),
  }),
);

export const watchTargetLinks = pgTable(
  "watch_target_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchTargetId: uuid("watch_target_id")
      .notNull()
      .references(() => watchTargets.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    linkType: watchLinkTypeEnum("link_type").notNull(),
    confidence: numeric("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueLinkIdx: uniqueIndex("watch_target_links_unique_idx").on(
      table.watchTargetId,
      table.contractId,
      table.linkType,
    ),
    watchTargetIdx: index("watch_target_links_watch_target_idx").on(
      table.watchTargetId,
      table.createdAt,
    ),
    contractIdx: index("watch_target_links_contract_idx").on(table.contractId),
    onePrimaryIdx: uniqueIndex("watch_target_links_one_primary_idx")
      .on(table.watchTargetId)
      .where(sql`${table.linkType} = 'primary'`),
  }),
);

export const watchEvents = pgTable(
  "watch_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchTargetId: uuid("watch_target_id")
      .notNull()
      .references(() => watchTargets.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").references(() => contracts.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    fingerprint: text("fingerprint").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    fingerprintIdx: uniqueIndex("watch_events_fingerprint_idx").on(
      table.fingerprint,
    ),
    watchTargetIdx: index("watch_events_watch_target_idx").on(
      table.watchTargetId,
      table.createdAt,
    ),
    pendingNotifyIdx: index("watch_events_pending_notify_idx").on(
      table.notifiedAt,
      table.createdAt,
    ),
  }),
);
