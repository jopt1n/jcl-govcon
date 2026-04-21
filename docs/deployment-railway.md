# Railway deployment — three-service architecture

## 1. Topology

JCL GovCon runs as three Railway services in a single project, all backed by the same GitHub repo (`jcl-govcon`). The web app is always on; the two cron services are ephemeral — they wake on schedule, run a single curl, and exit.

| Service                    | Role                                                                          | Build                                       | Runtime          | Schedule                      |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ---------------- | ----------------------------- |
| `jcl-govcon-web`           | Always-on Next.js webapp (dashboard, API routes, cron route handlers)         | nixpacks via `railway.toml`                 | persistent       | n/a                           |
| `jcl-govcon-weekly-crawl`  | Triggers the weekly SAM.gov crawl + xAI batch submission                      | `dockerfiles/cron.Dockerfile` (alpine+curl) | runs once, exits | `0 15 * * 1` (Mon 15:00 UTC)  |
| `jcl-govcon-check-batches` | Polls in-flight xAI batches, imports on completion, fires the Telegram digest | `dockerfiles/cron.Dockerfile` (alpine+curl) | runs once, exits | `*/30 * * * *` (every 30 min) |

Postgres lives alongside as the fourth Railway service; all three app services read `DATABASE_URL` from its reference variable.

### Weekly-crawl fire sequence

```mermaid
sequenceDiagram
    autonumber
    participant R as Railway scheduler
    participant C as jcl-govcon-weekly-crawl
    participant W as jcl-govcon-web
    participant DB as Postgres
    participant SAM as SAM.gov
    participant X as xAI Batch

    R->>C: Mon 15:00 UTC — start container
    C->>W: POST /api/cron/weekly-crawl<br/>Authorization: Bearer $INGEST_SECRET
    W->>W: authorize() + requireTelegramConfig()
    W->>DB: INSERT crawl_runs (kind=weekly, status=running)
    W->>SAM: search + fetch descriptions (7-day window)
    W->>X: submit batch classify
    W->>DB: UPDATE crawl_runs SET status=classifying, batchId=...
    W-->>C: HTTP 200 (response captured via curl -i)
    C->>C: exit 0
```

`check-batches` follows the same shape but polls xAI, imports results when ready, fires the weekly digest exactly once per succeeded run (gated by `digest_sent_at`), and atomic-claims rows (`processing_at` + 5-min lease) to prevent double-processing.

## 2. Why this shape

**The Sedgewick failure mode.** The prior `railway.toml` declared crons as `[[cron]]` array-of-tables blocks. That schema is not part of Railway's current config — Railway parsed the TOML without error and silently ignored the blocks. The weekly pipeline ran exactly once (a manual curl on 2026-04-16) and never fired on schedule. The first scheduled Monday after deploy (2026-04-20) passed silently. Root cause was not a Railway bug; it was a schema-validation gap in the PR review.

**Three services not one.** Reusing the Next.js image for crons would couple cron lifecycle to web-build success. If the web build breaks, the cron should still fire and alert; a shared image means a bad web deploy kills the crons too. Alpine+curl builds in seconds and has nothing to break.

**Public URL, not private networking.** Each cron service could reach `jcl-govcon-web` via Railway's private network (`jcl-govcon-web.railway.internal`) instead of the public `*.up.railway.app` URL. We chose the public URL deliberately — at <100 fires/week the extra latency is a non-issue, while private networking introduces port-discovery, HTTP-vs-HTTPS handling, and service-to-service auth wrinkles that aren't worth the overhead at this volume. Revisit if the fire frequency grows by an order of magnitude or if we add bandwidth-heavy cron-to-web traffic.

Railway cron docs: <https://docs.railway.com/reference/cron-jobs>.

## 3. Provisioning a cron service

After the PR landing these files merges to `main`, the two cron services still need to be created in the Railway dashboard — config-as-code governs an existing service, it does not create one. Steps for each of `jcl-govcon-weekly-crawl` and `jcl-govcon-check-batches`:

1. **New Service → Deploy from GitHub Repo → `jcl-govcon`.** Same repo as the web service. Railway offers to deploy the default `railway.toml`; override in the next step.
2. **Settings → Name.** Set to `jcl-govcon-weekly-crawl` (or `-check-batches`). The name also becomes the default container hostname on the private network.
3. **Settings → Config-as-code file.** Point at `railway.weekly-crawl.json` (or `railway.check-batches.json`). Railway now uses the JSON config's `build.dockerfilePath` and `deploy.cronSchedule` instead of the root `railway.toml`.
4. **Variables tab → `INGEST_SECRET`.** Reference variable. Source: `jcl-govcon-web`. Key: `INGEST_SECRET`. Rotating the secret on the web service then propagates to the cron automatically.
5. **Variables tab → `WEB_BASE_URL`.** Reference expression. Value: `https://${{jcl-govcon-web.RAILWAY_PUBLIC_DOMAIN}}`. Railway resolves this at container start; future domain changes propagate without edits.
6. **Deploy.** First build takes ~seconds (alpine + curl, not a Node build). The first "cron run" slot may not show up until the next scheduled tick; use the manual trigger in step 4 below to smoke-test before waiting.

## 4. Verification

**Did the cron register?** Cron service → Settings → Cron Schedule should display the expected cron expression. If it's blank, the config-as-code file isn't being read; double-check the filename at Settings → Config-as-code.

**Did the cron fire?** Cron service → Deployments tab. Each scheduled fire appears as a deployment with status `Exit 0` (or `Exit 1` on failure). The Deploy logs show the curl response including HTTP headers (because the `startCommand` uses `curl -i`).

**Did the web service handle the call?** jcl-govcon-web → Deploy logs, filtered for `kind: weekly-crawl` or `kind: check-batches`. Each fire produces multiple structured JSON log lines (`step: preflight`, `step: crawl`, `step: done`, etc.). Missing log lines mean the curl never reached the web service — check `WEB_BASE_URL` and `INGEST_SECRET`.

**Did the DB record it?** From a local terminal with `DATABASE_URL` set:

```sh
psql "$DATABASE_URL" -c "SELECT kind, status, created_at FROM crawl_runs ORDER BY created_at DESC LIMIT 5;"
```

Expect a new `kind='weekly'` row every Monday 15:00 UTC. `check-batches` only writes when it has work — expect a row only when a batch completed that cycle.

**Manual trigger (for smoke-testing).** Cron service → Deployments → ... menu → "Trigger". Railway runs the `startCommand` immediately outside the cron schedule. Useful before waiting for Monday.

## 5. Postmortem

The Sedgewick PR merged with `[[cron]]` blocks in `railway.toml`. Railway silently dropped them; the pipeline never fired on schedule. The review process caught several real issues in that PR (tests, schema, prompt tuning) but did not check the cron config against Railway's current schema.

The reusable lesson lives in **[`infra-review-checklist.md`](./infra-review-checklist.md)**. Any future PR that touches a platform config (`railway.toml`, `railway.*.json`, Dockerfiles wired into a Railway service, `vercel.json`, GitHub Actions workflow, etc.) should walk that checklist before merge.
