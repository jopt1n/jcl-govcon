-- Backfill reviewed_at and status_changed_at for existing contracts.
--
-- Context: the weekly-pipeline PR adds a `reviewed_at` column to contracts
-- and changes the default behavior of the main Kanban query to only show
-- rows where `reviewed_at IS NOT NULL`. Without this backfill, all existing
-- contracts would disappear from the main board on deploy.
--
-- Safety: idempotent. Only touches rows where the target column is NULL.
-- Can be re-run without effect.
--
-- Run against the Railway production database AFTER `drizzle-kit push` has
-- applied the new columns, and BEFORE deploying the new UI code.
--
--   psql "$DATABASE_URL" -f scripts/backfill-reviewed-at.sql

BEGIN;

-- Mark every existing contract as already-reviewed so it stays on the main
-- Kanban. New contracts ingested after this backfill will have
-- reviewed_at=NULL until the user triages them on /inbox.
UPDATE contracts
SET reviewed_at = created_at
WHERE reviewed_at IS NULL;

-- Seed status_changed_at from updated_at so the weekly retro query has a
-- sensible baseline. Not strictly required (column has a default), but
-- ensures the first weekly run doesn't falsely report every contract as a
-- "transition this week".
UPDATE contracts
SET status_changed_at = updated_at
WHERE status_changed_at IS NULL
   OR status_changed_at < updated_at;

-- Verify: every row has a reviewed_at after the UPDATE.
DO $$
DECLARE
  unreviewed_count integer;
BEGIN
  SELECT COUNT(*) INTO unreviewed_count
  FROM contracts
  WHERE reviewed_at IS NULL;

  IF unreviewed_count > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % rows still have reviewed_at IS NULL', unreviewed_count;
  END IF;

  RAISE NOTICE 'Backfill complete. All contracts have reviewed_at set.';
END $$;

COMMIT;
