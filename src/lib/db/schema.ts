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
} from "drizzle-orm/pg-core";

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
    // AI-generated action plan (JSON string with deliverables, tools, steps)
    actionPlan: text("action_plan"),
    // Computed tags for filtering
    tags: jsonb("tags").$type<string[]>().default([]),
    // Pipeline phase tracking
    classificationRound: integer("classification_round").notNull().default(1),
    descriptionFetched: boolean("description_fetched").notNull().default(false),
    classifiedFromMetadata: boolean("classified_from_metadata").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    solicitationNumberIdx: index("solicitation_number_idx").on(
      table.solicitationNumber
    ),
  })
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
