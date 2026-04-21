# Plan: cron services — three-service Railway architecture

## Context

The Sedgewick merge (`3d37a9a`, 2026-04-16) shipped with `[[cron]]` array-of-tables blocks in `railway.toml`. That schema is **not** valid for Railway — Railway's cron model is a single `deploy.cronSchedule` field per service. Railway silently ignored the blocks. Consequence: the weekly pipeline has not run since 2026-04-16. Current state confirmed via Railway Postgres: exactly one `crawl_runs` row (`6250e36e`, 2026-04-16 08:09 UTC, a manual curl — that was a Thursday, not the scheduled Monday 15:00 UTC), zero rows since. Today is Tuesday 2026-04-21; the first scheduled Monday fell on 2026-04-20 and did not fire. The 332 PENDING rows drained to 0 sometime between the Sedgewick merge and today; mechanism unconfirmed but likely the 2026-04-16 manual curl. Not blocking.

Fix is architectural: the two cron jobs become their own Railway services. Each runs an alpine+curl container on its own `cronSchedule` and posts to the existing always-on web service. This matches Railway's model and decouples cron execution from web-build health — a broken web build no longer stops the cron from firing and alerting.

## Architectural decision

Three-service layout, not alternatives. Alternatives considered and rejected:

- **External scheduler (GitHub Actions cron, EasyCron, etc.)** — extra moving part outside Railway, extra secret to manage, no visibility alongside the web service.
- **In-process `node-cron` inside the Next.js app** — Railway scales the web app horizontally; multiple replicas would multi-fire. Fighting horizontal scale for a cron is wrong.
- **Single service with Railway's cron UI (no config-as-code)** — works but loses the config-in-repo property. Joe already runs infra-as-code via `railway.toml`; staying consistent.
- **Reuse the Next.js container for the cron services** — makes cron lifecycle depend on web-build success; the whole point is decoupling.

Three-service wins on: native Railway idiom, isolated failure domains, tiny build, config in repo, zero new secrets.

## Current state (discovery)

- Branch cut from `origin/main` at `fcfcea0 feat: Chosen tier (#2)`. (Local `main` is stale auto-checkpoints; not used.)
- `dockerfiles/` directory does **not** exist — will be created.
- No `railway.*.json` files exist.
- `docs/plans/` exists with `chosen-tier.md` (the structural template for this plan).
- Route handlers confirmed:
  - `src/app/api/cron/weekly-crawl/route.ts:71` — `export async function POST(req: NextRequest)`, gated by `authorize(req)` at line 72.
  - `src/app/api/cron/check-batches/route.ts` — same shape, POST + `authorize(req)`.
- `src/lib/auth.ts:7` — `authorize()` checks `Authorization: Bearer ${INGEST_SECRET}` exactly.
- Current Railway services: `Postgres` + `jcl-govcon-web`. Public domain: `https://jcl-govcon-web-production.up.railway.app` (MEMORY.md).
- Project uses **npm**. Per-commit gates: `npm run test:run`, `npx tsc --noEmit`, `npm run lint`.

## Orthogonal (out of scope, but worth noting)

The discovery report also surfaced a latent correctness bug in the Sedgewick advisory-lock implementation: `db.execute()` on the unpinned postgres-js pool means acquire and release can hit different pool connections, silently leaking the lock. That is **not** fixed by this plan — this plan is strictly about getting the crons to fire at all. Once cron firing is restored and we have real run data, the lock question can be revisited. Tracked as a P2 TODO added in Commit 5.

## File inventory

| Path                             | State           | Purpose                                                                                                                                                    |
| -------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dockerfiles/cron.Dockerfile`    | NEW             | Minimal alpine+curl image used by both cron services. ~12 lines.                                                                                           |
| `railway.weekly-crawl.json`      | NEW             | Config-as-code for the `jcl-govcon-weekly-crawl` service. `cronSchedule = "0 15 * * 1"`.                                                                   |
| `railway.check-batches.json`     | NEW             | Config-as-code for the `jcl-govcon-check-batches` service. `cronSchedule = "*/30 * * * *"`.                                                                |
| `railway.toml`                   | MODIFIED        | Remove the two `[[cron]]` blocks and their comment. Replace with a comment explaining the three-service layout. `[build]` / `[deploy]` sections untouched. |
| `docs/plans/cron-services.md`    | NEW (this file) | Plan doc, committed in Commit 1.                                                                                                                           |
| `docs/deployment-railway.md`     | NEW             | Full architecture doc: topology, provisioning, verification, postmortem reference.                                                                         |
| `docs/infra-review-checklist.md` | NEW             | Reusable checklist extracted from this PR's postmortem, consumable by future infra PRs.                                                                    |
| `TODOS.md`                       | MODIFIED        | Add advisory-lock-pinning P2 entry.                                                                                                                        |
| `progress.md`                    | MODIFIED        | Update "Current Phase" + "Recently Completed" for cron architecture work.                                                                                  |
| `plan.md`                        | MODIFIED        | Add entry reflecting the three-service topology.                                                                                                           |

No source-under-`src/` changes. No schema changes. No tests added (no code logic changed; route handlers and auth already covered by existing tests). No migrations.

## 1. Infrastructure layout

Three services, same repo:

| Service                    | Role                     | Build                         | Runtime          |
| -------------------------- | ------------------------ | ----------------------------- | ---------------- |
| `jcl-govcon-web`           | Always-on Next.js webapp | nixpacks (existing)           | persistent       |
| `jcl-govcon-weekly-crawl`  | Mon 15:00 UTC trigger    | `dockerfiles/cron.Dockerfile` | runs once, exits |
| `jcl-govcon-check-batches` | every-30-min poller      | `dockerfiles/cron.Dockerfile` | runs once, exits |

Each cron service's `startCommand` is a single curl to the web service. Authorization uses `INGEST_SECRET` (Railway reference variable from `jcl-govcon-web`). Target host is `WEB_BASE_URL`, set as a Railway reference variable pointing at `jcl-govcon-web`'s public domain — rotating the domain propagates automatically to both cron services.

## 2. New files (exact contents — committed in Commit 2)

### 2a. `dockerfiles/cron.Dockerfile`

```dockerfile
# Minimal image for Railway cron services.
#
# The jcl-govcon cron services (weekly-crawl, check-batches) do nothing
# but fire an authenticated POST to the always-on jcl-govcon-web service
# and exit. They don't need Node or the Next.js build — just curl.
#
# Decoupling the cron services from the web build means:
#   - ~5s build instead of ~2min
#   - If the web build breaks, the crons still run and alert
#   - Cron service lifecycle is independent of web deployments
#
# Used by railway.weekly-crawl.json and railway.check-batches.json via
# build.dockerfilePath. Each cron service supplies its own startCommand.

FROM alpine:3.19

RUN apk add --no-cache curl ca-certificates

CMD ["sh", "-c", "echo 'No startCommand configured' && exit 1"]
```

### 2b. `railway.weekly-crawl.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "dockerfiles/cron.Dockerfile"
  },
  "deploy": {
    "startCommand": "curl -fsSi -X POST -H \"Authorization: Bearer $INGEST_SECRET\" \"$WEB_BASE_URL/api/cron/weekly-crawl\"",
    "cronSchedule": "0 15 * * 1",
    "restartPolicyType": "NEVER"
  }
}
```

### 2c. `railway.check-batches.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "dockerfiles/cron.Dockerfile"
  },
  "deploy": {
    "startCommand": "curl -fsSi -X POST -H \"Authorization: Bearer $INGEST_SECRET\" \"$WEB_BASE_URL/api/cron/check-batches\"",
    "cronSchedule": "*/30 * * * *",
    "restartPolicyType": "NEVER"
  }
}
```

**Curl flags:** `-f` (fail on 4xx/5xx so Railway marks the run failed), `-s` (silent progress), `-S` (show errors despite `-s`), `-i` (include response headers — captured as cron run logs).

**Restart policy `NEVER`:** correct for crons — a failed run logs and waits for the next scheduled run. `ON_FAILURE` would retry aggressively and risk double-firing a weekly crawl.

**Validation gate (Commit 2):** `jq . railway.weekly-crawl.json` and `jq . railway.check-batches.json` exit 0.

## 3. `railway.toml` edits (Commit 3)

Remove the `# ── Weekly pipeline cron ──` comment block plus both `[[cron]]` entries (current lines 12–32). Replace with:

```toml
# ── Crons are separate Railway services ────────────────────────────────────
#
# Railway's native cron schema is `deploy.cronSchedule` (single value per
# service) — NOT [[cron]] array-of-tables blocks. Cron services are their
# own services that start on schedule, execute a task, and terminate.
#
# This service (jcl-govcon-web) is the always-on web app. The two scheduled
# tasks live in sibling services, each with its own config file:
#   - jcl-govcon-weekly-crawl   → railway.weekly-crawl.json
#   - jcl-govcon-check-batches  → railway.check-batches.json
#
# See docs/deployment-railway.md for the full architecture and provisioning.
```

`[build]` + `[deploy]` sections unchanged.

## 4. Deployment architecture doc (Commit 4)

New file `docs/deployment-railway.md`, sections in order:

1. **Topology** — table matching §1 above, plus a Mermaid sequence diagram (GitHub renders natively) of a weekly-crawl firing: cron service wakes → curl POST → web service auth + body → web service writes `crawl_runs` row → batch submitted → cron service exits (HTTP 200 or 500 captured in cron logs).
2. **Why this shape** — 4-sentence summary of the Sedgewick `[[cron]]` failure mode plus a dedicated "Public URL vs private networking" paragraph naming that we chose the public URL over `jcl-govcon-web.railway.internal` deliberately. Reasoning: pragmatic for <100 fires/week, private networking would add port-discovery and HTTP-vs-HTTPS complications not worth it at this volume. Revisit if volume grows. Link to Railway cron docs: `https://docs.railway.com/reference/cron-jobs`.
3. **Provisioning a new cron service** — step-by-step Railway dashboard walkthrough. Each step has the exact click or field value:
   - New Service → Deploy from GitHub repo → select `jcl-govcon`.
   - Settings → Name → `jcl-govcon-weekly-crawl` (or `-check-batches`).
   - Settings → Config-as-code → file path → `railway.weekly-crawl.json`.
   - Variables → `INGEST_SECRET` → reference variable → select `jcl-govcon-web` → pick `INGEST_SECRET`.
   - Variables → `WEB_BASE_URL` → reference variable expression → `https://${{jcl-govcon-web.RAILWAY_PUBLIC_DOMAIN}}` (Railway will resolve this at start time; domain changes auto-propagate).
   - Deploy → confirm.
4. **Verification** — how to confirm the cron is firing:
   - Cron service → Deployments tab → look for entries named `Cron Job`, status `Exit 0`, at the scheduled times.
   - Web service → Deploy logs → filter for `kind: weekly-crawl` or `kind: check-batches` — should appear within seconds of the scheduled time.
   - DB query: `SELECT kind, created_at, status FROM crawl_runs ORDER BY created_at DESC LIMIT 5;` — new row every Monday 15:00 UTC (weekly) and a row per successful check-batches import (not every poll — only when work happened).
5. **Postmortem** — one-paragraph root cause of the original `[[cron]]` mistake, named plainly: the Sedgewick PR shipped with invalid Railway schema that Railway silently ignored; the review process did not include platform-schema validation. Points at `docs/infra-review-checklist.md` for the reusable "don't do this again" checklist (see Commit 4b below).

### 4b. `docs/infra-review-checklist.md`

Reusable checklist extracted from the postmortem so future infra PRs don't have to re-derive it. Bullets:

- **(a) Config schema validated against current platform docs.** Include the link to the specific docs page used for validation in the PR description. Platforms deprecate and re-shape their config schemas; validating against current docs (not LLM memory, not old examples) is the only safe move.
- **(b) Dashboard screenshot confirming the config registered as expected.** "Registered" beats "parsed". A config file can parse without actually wiring anything up (that is exactly what `[[cron]]` did — valid TOML, silently dropped).
- **(c) End-to-end verification that the config does what it claims.** A registered cron must be observed firing at least once before the PR is considered complete. For Sedgewick, we could have verified by triggering a manual fire through the Railway UI or by waiting for the first scheduled run.
- **(d) Rollback plan names a working pre-state OR explicitly flags none exists.** Some fixes have no pre-state to roll back to (the crons had never fired on schedule before Sedgewick; reverting Sedgewick would not restore a working cron). Naming this explicitly prevents the rollback plan from becoming false comfort.

## 5. Tracker updates (Commit 5)

**`TODOS.md`** — append under the appropriate priority block:

```markdown
## P2: Advisory lock doesn't pin a postgres-js connection

**File:** `src/app/api/cron/weekly-crawl/route.ts:125-162`
**Why:** `db.execute(sql\`SELECT pg_try_advisory_lock(...)\`)`and`db.execute(sql\`SELECT pg_advisory_unlock(...)\`)`run on the unpinned postgres-js pool — acquire and release can land on different pool connections. Release may return`false`on a connection that doesn't hold the lock, leaving the real lock held on the acquiring connection until that connection's`idle_timeout: 20s`inactivity expires it. The code comment at line 128 is also wrong — Postgres releases session locks on session/connection END, not on pool return.
**Impact:** Under cron-only load (one fire per week), the lock will release naturally within 20s of pool idle, so the bug is probably benign in practice for this workload. Under manual concurrent curls or future load, it would surface as spurious "another weekly-crawl in progress" skips.
**Fix:** Wrap the try/finally body in`sql.reserve()`(postgres-js 3.4+ API) or`sql.begin()`; either pins one connection for the lifetime of the lock. Add a real pool test that grabs two connections and verifies acquire/release hit the same connection.
**Priority:** P2. Not a firing blocker; wait until we have real cron run data before deciding whether to act.
```

**`progress.md`** — update:

- `## Current Phase` — replace with: `Phase 8.7 — cron service architecture fix shipping. Three-service Railway topology replacing dead [[cron]] blocks. See docs/plans/cron-services.md, docs/deployment-railway.md.`
- `## Recently Completed` — prepend a line: `**2026-04-21** — Discovered [[cron]] blocks in railway.toml were invalid Railway schema. Weekly pipeline had not run since the Sedgewick merge (2026-04-16). Three-service architecture designed, implemented across 5 commits on fix/cron-service-architecture.`
- `## Next 3 Actions` — collapse to: (1) provision the two cron services in Railway dashboard per docs/deployment-railway.md; (2) verify first weekly-crawl fires Monday 2026-04-27 15:00 UTC; (3) verify check-batches fires on next 30-min boundary after provisioning (manual trigger first if impatient).

**`plan.md`** — locate the phase that tracks infrastructure / operational state. Add or update a bullet:

```markdown
- [x] Three-service Railway topology: jcl-govcon-web (always-on) + jcl-govcon-weekly-crawl (Mon 15:00 UTC) + jcl-govcon-check-batches (every 30 min). See docs/deployment-railway.md.
```

## 6. Out of scope — do not touch

- Any file under `src/`. Routes, schema, and auth are already correct.
- Advisory-lock correctness (tracked as P2 TODO; see §5).
- Migration from curl-based cron to direct script invocation (would require refactoring route handlers into import-able functions and adding a node runtime to the cron Dockerfile; consider later).
- Tests. No code behavior change; no new test targets.
- `INGEST_SECRET` rotation (orthogonal; the reference-variable pattern makes future rotations a single-point update).

## 7. Execution — commit-by-commit

Each commit must independently pass `npx tsc --noEmit`, `npm run test:run`, `npm run lint`. No code under `src/` changes, so all three stay trivially green; run them anyway at each commit as a contract. If `/review` surfaces issues, address as additional commits before `/ship`; no slot pre-allocated.

### Commit 1 — `docs(plans): cron service architecture plan`

- Add `docs/plans/cron-services.md` (this file).
- **Gate:** plan file present at target path; plan file only change in this commit; npm test/tsc/lint green.

### Commit 2 — `feat(infra): cron dockerfile + per-service railway configs`

- Create `dockerfiles/cron.Dockerfile` (§2a).
- Create `railway.weekly-crawl.json` (§2b).
- Create `railway.check-batches.json` (§2c).
- **Gate:** `jq . railway.weekly-crawl.json` and `jq . railway.check-batches.json` exit 0. npm test/tsc/lint green.

### Commit 3 — `chore(infra): remove dead [[cron]] blocks from railway.toml`

- Edit `railway.toml` per §3. Remove the dead `[[cron]]` blocks and explanatory comment; add the new explanatory comment pointing to `docs/deployment-railway.md`.
- **Gate:** `railway.toml` still TOML-parseable. npm test/tsc/lint green.

### Commit 4 — `docs(infra): Railway three-service deployment doc + infra review checklist`

- Create `docs/deployment-railway.md` per §4 (topology w/ Mermaid, why shape + public-vs-private, provisioning, verification, postmortem pointing at the checklist).
- Create `docs/infra-review-checklist.md` per §4b.
- **Gate:** both files present; Mermaid block syntactically intact. npm test/tsc/lint green.

### Commit 5 — `chore: update trackers for cron architecture change`

- Edit `TODOS.md`, `progress.md`, `plan.md` per §5.
- **Gate:** npm test/tsc/lint green.

## 8. Post-merge checklist (Joe, in the Railway dashboard, in order)

Once the PR is merged to `main`:

1. **Create `jcl-govcon-weekly-crawl` service:**
   - New Service → Deploy from GitHub Repo → `jcl-govcon` (same repo).
   - Settings → Name → `jcl-govcon-weekly-crawl`.
   - Settings → Config-as-code file → `railway.weekly-crawl.json`.
   - Variables tab → `INGEST_SECRET` → Reference Variable → `jcl-govcon-web` → `INGEST_SECRET`.
   - Variables tab → `WEB_BASE_URL` → reference expression → `https://${{jcl-govcon-web.RAILWAY_PUBLIC_DOMAIN}}`. Resolves at start time; domain changes auto-propagate.
   - Deploy.
2. **Create `jcl-govcon-check-batches` service:** same steps, but Name → `jcl-govcon-check-batches` and Config-as-code → `railway.check-batches.json` and the same two reference variables.
3. **Manual smoke test of check-batches:** In the new service → Deployments → Trigger (manual run). Expect exit 0. Confirm web service logs show a `kind: check-batches` entry with `step: done, candidates: 0` (no in-flight batch today).
4. **Wait for the next Monday 15:00 UTC** (next: 2026-04-27 15:00 UTC). Confirm:
   - `jcl-govcon-weekly-crawl` service shows a new Deployment at that time, status Exit 0.
   - Web service deploy logs show `kind: weekly-crawl` entries.
   - `SELECT kind, status, created_at FROM crawl_runs ORDER BY created_at DESC LIMIT 3;` shows a new `kind='weekly'` row dated 2026-04-27.
5. **If Monday's fire fails:** rollback per §10.

## 9. Verification plan

**Code-level (pre-merge):**

- `npx tsc --noEmit` exit 0.
- `npm run test:run` 393/393 (no behavior change expected; if count changes, investigate before merging).
- `npm run lint` clean.
- `jq .` each JSON config exit 0.
- `railway.toml` parses as valid TOML.

**Infra-level (post-provisioning):**

- Manual run of `jcl-govcon-check-batches` from the Railway dashboard returns HTTP 200 (visible in the cron service's deploy logs via `-i`). Web service logs show the corresponding `kind: check-batches` JSON log line within seconds.
- Monday 2026-04-27 15:00 UTC: new `crawl_runs` row appears with `kind='weekly'`. `digest_sent_at` populates within 30 minutes (once the check-batches cron fires and imports).
- Telegram digest fires for that Monday run.

## 10. Rollback plan

- **If builds fail or Railway rejects configs:** revert commits 2-5 (keep Commit 1 — the plan doc is harmless). `git revert` rather than force-push. Services simply never come up; no data corruption possible.
- **If the cron services fire but the web service rejects them (auth failure, route error):** easier — check `INGEST_SECRET` reference variable is correctly pointing to `jcl-govcon-web`'s value, and `WEB_BASE_URL` resolves to the active public domain. No code revert needed.
- **If the new services work but we want to abandon the approach:** in the Railway dashboard, delete `jcl-govcon-weekly-crawl` and `jcl-govcon-check-batches`. Nothing in git needs reverting because the old `[[cron]]` blocks were dead anyway — deleting the new services returns us to the current broken state, not a working state. **There is no working pre-state** (the pipeline has been dark since 2026-04-16).

## Files touched (summary)

Infra / config (4 files: 3 new + 1 modified):

1. **NEW** `dockerfiles/cron.Dockerfile` — alpine+curl runner.
2. **NEW** `railway.weekly-crawl.json` — config-as-code for weekly-crawl service.
3. **NEW** `railway.check-batches.json` — config-as-code for check-batches service.
4. **MODIFIED** `railway.toml` — remove dead `[[cron]]` blocks, add explanatory comment.

Docs (3 new):

5. **NEW** `docs/plans/cron-services.md` — plan (this file).
6. **NEW** `docs/deployment-railway.md` — topology, provisioning, verification, postmortem.
7. **NEW** `docs/infra-review-checklist.md` — reusable checklist extracted from the postmortem.

Trackers (3 modified):

8. **MODIFIED** `TODOS.md` — add P2 for advisory-lock pinning.
9. **MODIFIED** `progress.md` — phase update + Recently Completed entry.
10. **MODIFIED** `plan.md` — infrastructure phase bullet.

Zero changes under `src/`. Zero schema changes. Zero test additions. Zero migrations.
