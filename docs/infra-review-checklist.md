# Infra review checklist

Reusable checklist for any PR that changes a platform config — Railway (`railway.toml`, `railway.*.json`), Vercel (`vercel.json`, `vercel.ts`), Dockerfiles wired into a hosted service, GitHub Actions workflows, cron definitions, service networking, or similar.

Extracted from the Sedgewick `[[cron]]` postmortem (see `docs/deployment-railway.md` §5). The specific failure mode: a PR shipped with invalid Railway schema that parsed cleanly and was silently ignored. The pipeline appeared to be wired up and was not. This checklist exists so "it parses" never again gets confused for "it works".

## Before merge

### (a) Config schema validated against current platform docs

- The PR description links to the exact platform-docs page used to validate the config.
- Validation source is the live docs, not LLM memory or older examples from Stack Overflow / blog posts.
- Platforms deprecate and re-shape config schemas. If the docs page has a "last updated" or version indicator, note it.
- For multi-file configs (e.g. Railway config-as-code + repo-level `railway.toml`), validate each separately — schemas can differ between file types on the same platform.

### (b) Dashboard screenshot confirming the config registered as expected

- "Registered" beats "parsed". A config file can parse as valid syntax without actually wiring anything up. That is exactly what `[[cron]]` did: valid TOML, silently dropped by Railway.
- The screenshot shows the target platform's own UI surfacing the config effect — e.g. Railway → Settings → Cron Schedule displaying the expected expression, or Vercel → Deployments showing the expected region.
- If the platform has no visible surface for the setting (rare), call that out explicitly and document how you confirmed registration some other way (API response, deploy log signal, etc.).

### (c) End-to-end verification that the config does what it claims

- The PR is not complete until the config has been observed producing its intended effect at least once.
- For scheduled work (crons, webhooks, polling), wait for one scheduled fire OR use the platform's manual-trigger affordance — don't merge on "it should fire Monday".
- For request routing (rewrites, redirects, middleware), hit the actual route from a real browser or curl and verify the rewritten response.
- For env vars and secrets, confirm the consuming code can read the value — a referenced variable that resolves to an empty string is indistinguishable from one that doesn't exist until you actually run the code.

### (d) Rollback plan names a working pre-state, OR explicitly flags none exists

- "Rollback" is meaningful only when there is a prior working state to return to. Some fixes don't have one — for example, the Sedgewick cron work never had a working pre-state, so reverting it would restore "silently broken" not "working".
- The rollback section of the PR description either names the SHA (or dashboard state) of the working prior deploy, or it explicitly writes "There is no working pre-state" and explains why.
- This prevents the rollback plan from becoming false comfort — a reader who assumes "we can always revert" when in fact there is nothing to revert to will defer serious due-diligence until after they're already in trouble.

### (e) Memory / handoff documents asserting current infrastructure state have been re-verified against live systems, not assumed from prior-session notes

- Handoff docs, `MEMORY.md` entries, and prior-session summaries are point-in-time observations. They decay quickly in infrastructure contexts where something that was "operational as of last Tuesday" may have been silently broken since.
- Before acting on any claim like "cron active", "X is deployed", "service Y is healthy", re-verify it against the live system — query the DB, hit the endpoint, check the dashboard. The authoritative source for current state is the current system, not what a doc said days ago.
- The Sedgewick incident is a direct case: `MEMORY.md` said "Cron active: weekly-crawl Mon 15:00 UTC" while no cron had actually fired since the initial manual curl. A reader who trusted the memory could have spent days building on top of a broken foundation. Explicit re-verification would have surfaced the break in seconds.

## Applying the checklist

All five boxes matter, but they fail in characteristic orders. If (a) is skipped, the config is probably wrong. If (b) is skipped, the config is probably wrong and the reviewer won't notice. If (c) is skipped, the config looks right but may not behave right. If (d) is skipped, the response plan when things break is worse than it needed to be. If (e) is skipped, the entire PR may be aimed at the wrong problem.

The checklist is cheap. The Sedgewick recovery cost roughly half a session — discovery, plan, implementation, and provisioning — for a failure mode that any one of the five bullets above would have caught at PR review.
