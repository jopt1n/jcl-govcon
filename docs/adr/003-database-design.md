# ADR-003: Railway PostgreSQL with Drizzle ORM

## Status: Accepted

## Context
Need persistent storage for ~18K+ contracts with classification data, crawl progress, and settings.

## Decision
- **Railway PostgreSQL** — Managed hosting, co-located with app deployment
- **Drizzle ORM** — Type-safe queries, schema-as-code in TypeScript
- **Schema management**: `drizzle-kit push` (no migration files — schema pushed directly)
- **5 tables**: contracts, api_usage, settings, crawl_progress, batch_jobs
- **4 enums**: classification, contract_status, crawl_status, batch_job_status
- **Connection pool**: `max: 1` (serverless pattern — needs increase for production)

## Key Schema Decisions
- `notice_id` as unique dedup key (SAM.gov's identifier)
- `raw_json` column stores full API response for backfill capability
- `resource_links` as JSONB array (variable number of document URLs)
- `user_override` boolean to protect manual classifications from re-classification
- Pipeline tracking columns: `description_fetched`, `classified_from_metadata`

## Alternatives Considered
- **Turbopuffer**: Researched for semantic search — deferred as future enhancement
- **Supabase**: More features but Railway already used for deployment
- **SQLite**: Not suitable for Railway deployment pattern
