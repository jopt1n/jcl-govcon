# Plan: CHOSEN tier — user-driven promotion above AI's GOOD

## Context

The AI classifier is tuned for recall over precision (see `feedback_classification_recall.md` in memory). Most of the 370+ GOOD contracts aren't actually ideal — they're candidates worth reviewing. The user wants a user-driven tier _above_ AI's GOOD: promote the genuine best to **Chosen** (gold), surface them on their own `/chosen` page. Immediate use case: triage the 259 unreviewed GOOD contracts sitting on `/inbox` faster, elevating the worth-pursuing ones instead of just marking them reviewed.

**Architectural decision:** Add a `promoted` boolean (+ `promotedAt` timestamp) rather than extending the classification enum. Preserves the AI's original classification (needed for recall-analytics loop), matches existing orthogonal-flag patterns (`userOverride`, `reviewedAt`), avoids a Postgres enum ALTER and the 38+ hardcoded classification call-sites, and makes demote a trivial flag flip.

**Terminology lockdown:** The concept has exactly one name — **Chosen**. Button states are `★ Promote` (when `promoted === false`) and `★ Demote` (when `promoted === true`). Header pill: `CHOSEN ★`. Nav: `Chosen`. Page heading: `Chosen`. No "Great" anywhere in UI copy.

## User-confirmed UX decisions

- `★ Promote` button on contract detail (all classifications including DISCARD — promoting a DISCARD signals "AI was wrong") AND inline on `/inbox` cards (promote from triage surface).
- Promoted contracts stay visible in the main Kanban GOOD column with a gold border accent. `/chosen` is a filtered view, not a physical move. Demote is just flipping the flag.
- `/chosen` paginates with a "Load more" button (50/page).
- **No new `/counts` endpoint.** Sidebar uses `Promise.all` of two existing-shape `/api/contracts?...&limit=1` calls — keeps existing pattern, one badge can stay fresh if the other fails.
- **Concurrency policy: accept the race for v1.** Single-user app; multi-tab promote/demote conflicts are rare. Add code comment acknowledging the assumption. Audit log will reveal if it bites in practice; harden then.
- **Real `audit_log` table** (not a console.log) for promote/demote actions. Substrate for Phase 9 status transitions later.
- **Audit log preserves history** when contracts are deleted: FK uses `onDelete: 'set null'`, not cascade.
- **PATCH UPDATE + audit insert wrapped in a transaction** — atomic; either both persist or both fail.
- **Sidebar uses `Promise.allSettled`** so one badge can stay fresh if the other endpoint fails.
- **Inbox extracts `removeFromInbox(id, classification, body)` helper** — shared by `markReviewed` and the new `★ Promote` button. DRY non-negotiable.
- **No E2E tests in this PR** — Playwright is a dep but no config/dir exists. Setting up E2E infrastructure is a platform concern that deserves its own plan + eng review. Manual verification in §8 covers the user flows. Captured as P2 TODO in TODOS.md (added in Commit 1).

---

## 1. Data model

### 1a. `contracts` table additions

**File:** `src/lib/db/schema.ts` — between `reviewedAt` (~line 102) and `statusChangedAt`.

```ts
promoted: boolean("promoted").notNull().default(false),
promotedAt: timestamp("promoted_at", { withTimezone: true }),
```

Add index in the `(table) => ({ ... })` block:

```ts
promotedIdx: index("contracts_promoted_idx")
  .on(table.promotedAt)
  .where(sql`${table.promoted} = true`),
```

**Partial-index fallback criterion:** if `npx drizzle-kit push` errors on the partial-index syntax OR the generated DDL emits `CREATE INDEX` without the `WHERE` clause (silently dropping the partial), fall back to: `index("contracts_promoted_idx").on(table.promoted, table.promotedAt)`. Verify with `\d+ contracts` in psql after push.

### 1b. New `audit_log` table

**File:** `src/lib/db/schema.ts` — append after `crawlRuns`.

```ts
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable + onDelete: 'set null' so audit history survives contract deletion.
    // The whole point of an audit log is to answer "what did I do?" even when
    // the source row is gone. The orphaned audit row's action + created_at stay
    // queryable as a forensic record.
    contractId: uuid("contract_id").references(() => contracts.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(), // "promote" | "demote" | (future: status transitions)
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
```

Generic enough that Phase 9 status-transition tracking can write to the same table without a schema change. v1 only writes `"promote"` and `"demote"` actions.

Apply both with a single `npx drizzle-kit push`.

---

## 2. API surface

### 2a. `PATCH /api/contracts/[id]` — promoted field + audit insert

**File:** `src/app/api/contracts/[id]/route.ts`.

**Existing pattern context:** the handler uses an `updates: Record<string, unknown>` accumulator and does a single `.update().set(updates).returning()` at the end. It conditionally SELECTs first _only_ when `body.status` is present. For the `promoted` path there is no SELECT — the COALESCE pattern below is idempotent in a single round-trip.

**Concurrency policy (documented assumption):** No CAS, no SERIALIZABLE transaction wrapping promoted writes. This is intentional for v1: single-user app, concurrent promote/demote conflicts are rare. The `audit_log` table will reveal if multi-tab races become a problem in practice; revisit then.

Validate the body and assemble updates as today (after the `userOverride` block, ~line 107):

```ts
if (body.promoted !== undefined) {
  if (typeof body.promoted !== "boolean") {
    return NextResponse.json({ error: "Invalid promoted" }, { status: 400 });
  }
  const setPromoted = body.promoted;
  updates.promoted = setPromoted;
  updates.promotedAt = setPromoted ? new Date() : null;
  if (setPromoted) {
    // Promote implies reviewed, but never clobber an existing reviewedAt.
    // Demote does not touch reviewedAt.
    updates.reviewedAt = sql`COALESCE(${contracts.reviewedAt}, now())`;
  }
  // NOTE: no CAS / no SERIALIZABLE wrapping at the row level — single-user
  // assumption (v1). Concurrent promote=true / promote=false is last-write-wins;
  // audit_log reveals if this bites. Tighten with WHERE-clause CAS if it does.
}
```

**Replace the existing single `.update().set(updates).returning()` call (~line 149) with a transaction** when `body.promoted !== undefined`, so the UPDATE and the audit insert are atomic — either both persist or both fail. Drizzle's `db.transaction(async tx => { ... })` API handles this cleanly:

```ts
let updated;
if (body.promoted !== undefined) {
  // Transaction: UPDATE + audit insert atomic.
  updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contracts)
      .set(updates)
      .where(eq(contracts.id, params.id))
      .returning();
    if (row) {
      await tx.insert(auditLog).values({
        contractId: params.id,
        action: body.promoted ? "promote" : "demote",
      });
    }
    return row;
  });
} else {
  // No audit row needed; existing single-statement path.
  [updated] = await db
    .update(contracts)
    .set(updates)
    .where(eq(contracts.id, params.id))
    .returning();
}
```

Imports needed: `sql` from `drizzle-orm`, `auditLog` from `@/lib/db/schema`.

### 2b. `GET /api/contracts` — promoted filter

**File:** `src/app/api/contracts/route.ts`

- Add `promoted` + `promotedAt` to the select projection.
- Parse `?promoted=true|false` query param. **Reject any other value with 400 "Invalid promoted"** — no silent filter-drop. Add `conditions.push(eq(contracts.promoted, ...))` only for valid values.
- When `promoted=true`, sort by `desc(contracts.promotedAt)` (special-case like `isDeadlines`). Combine with `limit` and `page` for "Load more" pagination support.

### 2c. ~~`GET /api/contracts/counts`~~ — REMOVED FROM SCOPE

Outside voice review (verified) showed the existing sidebar polls only ONE endpoint, not two. A new `/counts` endpoint would add net +0 polls today and a new failure mode (one endpoint = both badges fail together). Sidebar will use `Promise.all` of two existing-shape calls instead (see §5). No new API route, no new tests for it.

---

## 3. UI treatment

### 3a. Gold CSS token

**File:** `src/app/globals.css`. Add to both `:root` and `.dark` blocks after `--urgent`:

```css
--chosen: #eab308; /* Tailwind yellow-500 */
--chosen-bg: #fef3c7; /* light-mode soft gold wash */
```

Dark mode override: `--chosen-bg: rgba(234, 179, 8, 0.08);`

**Visual verification required post-implementation:** dark-mode `--chosen-bg` at 0.08 opacity may be too subtle against the dark surface. Verify the CHOSEN pill is legible. If not, raise to 0.12-0.15 or use a solid darker yellow.

### 3b. Promote button — contract detail

**File:** `src/components/contract-detail.tsx`

- Extend `Contract` interface (~line 49): `promoted: boolean; promotedAt: string | null;`
- Classification row block (~line 461): gold toggle button next to the GOOD/MAYBE/DISCARD button group.
  - **Renders for ALL classifications including DISCARD** (per user-confirmed UX). Promoting a DISCARD is the user signaling "AI was wrong"; the original classification stays so the override is visible.
  - `promoted === false` → `★ Promote` with gold border/text.
  - `promoted === true` → filled gold bg, `★ Demote`, flips on click.
  - Uses existing `updateField` helper to PATCH `{ promoted: true|false }`.
- Header (~line 337): when `promoted`, append a gold pill next to the classification badge: `CHOSEN ★` with `bg-[var(--chosen-bg)] text-[var(--chosen)]`.
- Outer container: when `promoted`, add `border-t-2 border-[var(--chosen)]` top accent.

### 3c. Promote button — /inbox cards

**File:** `src/app/inbox/page.tsx`.

Each card currently has "Mark reviewed." Add a sibling gold `★ Promote` button.

- Icon + label, gold styling matching the `--chosen` token.
- **Extract a `removeFromInbox(id, classification, body)` private helper in `inbox/page.tsx`** that handles: set marking state, optimistic remove from local groups, PATCH with caller's body, error revert via `fetchGroup`, clear marking. Both `markReviewed` and the new `promote` callback call it with their own PATCH body (`{reviewedAt: true}` vs `{promoted: true}`). DRY win, no new file.
- `onClick` calls `removeFromInbox(c.id, classification, { promoted: true })`. The COALESCE on `reviewedAt` in §2a means this single PATCH also triages the contract — no separate "mark reviewed" needed.
- Button is hidden when `contract.promoted === true` as a defensive check. **Code comment:** the promote-implies-reviewed COALESCE in §2a should make this unreachable in /inbox practice. Keep the guard for stale-render safety; do not delete.

**Multi-tab staleness note:** if the user promotes a contract in tab A and tab B has /inbox already loaded, tab B will show a ghost card until manual refresh or page-load. Pre-existing behavior with `markReviewed`; not a regression.

### 3d. Kanban card styling

**File:** `src/components/kanban/card.tsx`

- Extend `ContractCard` interface: `promoted?: boolean;`
- When `promoted === true`:
  - Override left border: `border-l-[var(--chosen)]` at 4px width (wins over the green GOOD stripe).
  - Add `<Star className="w-3 h-3 fill-[var(--chosen)] text-[var(--chosen)]" />` next to the title.
- `classificationBadge` map unchanged — promoted is an overlay, not a classification.

**Kanban column** (`src/components/kanban/column.tsx`): no change. Promoted cards stay in their home column with the gold accent.

### 3e. (removed — merged into §2a via COALESCE)

### 3f. Analytics dashboard tile — REMOVED FROM SCOPE

Per `frontend-spec.md`, the `analytics-dashboard.tsx` _component_ is slated for removal in the upcoming frontend redesign. **Do not modify the component.** The `/api/analytics` route file is not touched in this PR (still exists, still served, just no new aggregate added). If the new frontend later needs a promoted aggregate, it can be added then.

---

## 4. New `/chosen` page

**New file:** `src/app/chosen/page.tsx`. Clone of `src/app/inbox/page.tsx`, simplified.

- Client component. Initial fetch: `GET /api/contracts?promoted=true&includeUnreviewed=true&limit=50&page=1`.
- "Load more" button at the bottom triggers next page fetch (mirrors Kanban column pattern). Increments page, appends results.
- Single flat list (no grouping), sorted server-side by `promotedAt DESC`.
- Each card: reuse `KanbanCard` with `showClassification={true}` so AI's original GOOD/MAYBE/DISCARD still shows (useful "AI said X, I overrode" signal). Gold left-border automatic via §3d.
- Each card has a Demote button beneath it (same pattern as Mark reviewed). PATCHes `{ promoted: false }` and optimistically removes.
- Header: `<h1><Star /> Chosen</h1>` + subtitle "Contracts you've personally elevated."
- Empty state: star icon + "Nothing here yet" + "Open a contract and click Promote to add it."
- **Error state:** mirror /inbox pattern — render an error banner with retry button on fetch failure. Do not silently render empty state on error.
- Count in header: "N chosen • M with deadlines in <7d" (client-side from the fetched list).

---

## 5. Sidebar nav

**File:** `src/components/sidebar.tsx`

1. Import `Star` from lucide-react.
2. Insert nav item between Inbox and Pipeline:
   ```ts
   { href: "/chosen", label: "Chosen", icon: Star, badgeKey: "chosen", badgeColor: "var(--chosen)" },
   ```
3. Extend `NavItem.badgeKey` union to include `"chosen"`.
4. **Replace `useUnreadCount` with `useNavCounts` (in-place edit, hook is internal to sidebar.tsx).** New hook returns `{ inbox, chosen }` from a single useEffect using `Promise.allSettled` so each badge updates independently — one rejected promise does NOT block the other badge from refreshing:
   ```ts
   const settled = await Promise.allSettled([
     fetch("/api/contracts?unreviewed=true&limit=1&page=1", {
       signal: AbortSignal.timeout(10_000),
     }),
     fetch("/api/contracts?promoted=true&limit=1&page=1", {
       signal: AbortSignal.timeout(10_000),
     }),
   ]);
   if (settled[0].status === "fulfilled" && settled[0].value.ok) {
     const json = await settled[0].value.json();
     if (!cancelled) setInbox(json.pagination?.total ?? 0);
   }
   if (settled[1].status === "fulfilled" && settled[1].value.ok) {
     const json = await settled[1].value.json();
     if (!cancelled) setChosen(json.pagination?.total ?? 0);
   }
   // No setCount on rejected → last-known value persists (existing pattern).
   ```
5. Same 30s poll interval as the existing hook.
6. Add optional `badgeColor` prop to `NavItem` so the Chosen badge renders in gold; Inbox keeps its default accent.

---

## 6. Out of scope — do not touch

- **AI prompts** (`src/lib/ai/prompts.ts`, classifier variants).
- **Weekly digest.**
- **Reclassify skip-list.**
- **CSV export.**
- **Drag-to-promote** on Kanban — separate PR.
- **`/pipeline` page.**
- **SAM.gov mappers, crawl, batch classifier.**
- **`analytics-dashboard.tsx` component AND `/api/analytics` route file** — neither is modified.
- **CAS / SERIALIZABLE transaction on promote PATCH** — accepted v1 risk, revisit if audit log shows races.
- **Audit-log read UI** — table is written-only in v1; no admin viewer.

---

## 7. Execution — commit-by-commit

Each commit must independently pass `npx tsc --noEmit` AND `npm run test:run` before the next commit starts. Do not batch failures. Run `/review` after commits 2, 3, and 5. Suite green is the gate — exact test count is not gated.

**Deploy-coupling note:** The 5 commits should land together in one PR / one deploy. Commits 1-3 alone leave the API exposing `?promoted=` filter and PATCH `promoted` body with no UI surfaces — partial deployment risk. Solo developer doing all 5 commits in one session: low risk. CI/CD: ship as one merge.

### Commit 1 — `feat(chosen): schema + index + audit_log + plan doc + e2e TODO`

- `src/lib/db/schema.ts`: add `promoted` + `promotedAt` columns (§1a) + partial index. Add `auditLog` table (§1b, with `onDelete: "set null"` on `contractId`) + index.
- `npx drizzle-kit push`. Verify both new objects via `\d+ contracts` and `\d+ audit_log`.
- Copy this plan to `docs/plans/chosen-tier.md` (mkdir `docs/plans/` if needed).
- **Append a P2 entry to `TODOS.md`** capturing the E2E infrastructure follow-up (verbatim from the eng review decision):

  ```markdown
  ## P2: E2E test infrastructure (Playwright)

  Playwright is installed as a dep but not wired up. No config, no e2e/ dir, no CI integration. Three CHOSEN-tier flows currently rely on manual verification (§8 of `docs/plans/chosen-tier.md`):

  - /inbox → ★ Promote → navigate to /chosen → card appears with gold border
  - Promote a DISCARD-classified contract → /chosen shows DISCARD badge + gold border (cross-classification)
  - Detail page → ★ Demote → main Kanban GOOD column → green border restored

  Setup scope for a separate PR:

  - playwright.config.ts with a dev-server lifecycle
  - e2e/ directory + first three tests above
  - Test database strategy (separate schema vs. transactional rollback)
  - npm script: test:e2e
  - CI integration decision (every PR vs. nightly vs. pre-merge gate)

  Value extends beyond JCL GovCon — sibling projects (CantMissCalls, EtsySeller) would benefit from the same infrastructure.
  ```

  If the existing `TODOS.md` has a `## P2` section already, insert this entry within it; otherwise create a new `## P2` heading. Match the existing `### Title` + bold-key block style.

- Update schema mocks in all affected test files so `tsc` + existing tests stay green:
  - `src/__tests__/api/contracts/id.test.ts`
  - `src/__tests__/api/contracts/route.test.ts`
  - `src/__tests__/api/cron/weekly-crawl.test.ts`
  - `src/__tests__/api/contracts/import.test.ts` (if exists)
  - `src/__tests__/lib/email/digest.test.ts`
  - `src/__tests__/lib/ai/reclassify-with-description.test.ts`
- No behavior changes. Gate: `npx tsc --noEmit` + `npm run test:run` green.

### Commit 2 — `feat(chosen): api`

- `src/app/api/contracts/[id]/route.ts` — PATCH `promoted` field with COALESCE promote-implies-reviewed (§2a). When `body.promoted !== undefined`, wrap the UPDATE + audit_log insert in `db.transaction(async tx => …)` so they're atomic. Import `sql` from `drizzle-orm` and `auditLog` from schema.
- `src/app/api/contracts/route.ts` — `?promoted=true|false` query param + 400 rejection for invalid values + projection + `desc(promotedAt)` sort when `promoted=true` + `limit`/`page` support for pagination.
- **Tests:**
  - PATCH `promoted: true` sets `promoted` + `promotedAt`.
  - PATCH `promoted: false` clears `promotedAt`.
  - PATCH `promoted: true` on unreviewed contract sets `reviewedAt` to `now()`.
  - PATCH `promoted: true` on already-reviewed contract preserves the original `reviewedAt` timestamp (COALESCE).
  - PATCH `promoted: false` does NOT touch `reviewedAt`.
  - PATCH `promoted: "string"` returns 400.
  - PATCH `promoted: true` writes an `audit_log` row with `action="promote"`, correct `contractId`.
  - PATCH `promoted: false` writes an `audit_log` row with `action="demote"`.
  - PATCH on nonexistent contract does NOT write to audit_log (transaction rolls back when UPDATE returns nothing).
  - **Atomic transaction test:** mock `db.insert(auditLog)` to throw; verify the contract's `promoted` field is NOT updated (transaction rolls back). Critical for the audit-log integrity guarantee.
  - `?promoted=true` filter returns only promoted contracts.
  - `?promoted=invalid` returns 400 with "Invalid promoted" error.
  - Branch where `body.promoted === undefined` (e.g., a notes-only PATCH) skips the transaction wrapper and uses the existing single-statement path. Verify no audit_log rows are written.
- Gate: `npx tsc --noEmit` + `npm run test:run` green, then `/review`.

### Commit 3 — `feat(chosen): styling + detail page`

- `src/app/globals.css` — gold CSS tokens for light + dark.
- `src/components/kanban/card.tsx` — `promoted?: boolean` prop, gold left-border override + star icon when `promoted=true`.
- `src/components/contract-detail.tsx` — `★ Promote` / `★ Demote` toggle button (renders for all classifications including DISCARD), `CHOSEN ★` header pill, top gold accent border on the outer container.
- **Tests:**
  - Kanban card renders gold left-border + star icon when `promoted=true`.
  - Contract detail renders `★ Promote` when `promoted=false` and `★ Demote` when `promoted=true`.
  - Contract detail shows `★ Promote` button on a DISCARD-classified contract.
  - Clicking the toggle PATCHes with correct `promoted` value.
  - `CHOSEN ★` pill appears/disappears based on `promoted` state.
- Gate: `npx tsc --noEmit` + `npm run test:run` green, then `/review`.

### Commit 4 — `feat(chosen): inbox triage`

- `src/app/inbox/page.tsx`:
  - Extract `removeFromInbox(id, classification, body)` private helper (set marking → optimistic remove from local groups → PATCH → error revert via `fetchGroup` → clear marking).
  - Refactor existing `markReviewed` to call `removeFromInbox(id, classification, { reviewedAt: true })`.
  - Add `promote(id, classification)` callback that calls `removeFromInbox(id, classification, { promoted: true })`.
  - Inline gold `★ Promote` button on each card. Hidden when `c.promoted === true` (defensive guard).
- **Tests:**
  - `★ Promote` button renders on inbox cards.
  - Click PATCHes `{ promoted: true }`.
  - Card optimistically disappears from list on promote (single PATCH triages + promotes).
  - On PATCH failure, the card reappears via `fetchGroup` (revert path covers both promote and markReviewed since they share `removeFromInbox`).
  - Existing `markReviewed` tests still pass after the refactor (regression check).
- Gate: `npx tsc --noEmit` + `npm run test:run` green.

### Commit 5 — `feat(chosen): /chosen page + nav`

- `src/app/chosen/page.tsx` — new page cloning `/inbox` (flat list, server-sorted by `promotedAt DESC`, "Load more" pagination at 50/page, Demote button per card, empty state, error state with retry, header with count + deadline sub-count).
- `src/components/sidebar.tsx` — Chosen nav item with Star icon + gold badge. Replace `useUnreadCount` with `useNavCounts` doing `Promise.allSettled` of two `?...&limit=1` calls (per §5 — fulfilled-only branches update their respective badge, rejected promises leave the last-known value alone). `badgeColor` prop on `NavItem`.
- **Tests:**
  - `/chosen` page renders header.
  - Empty state renders when no promoted contracts.
  - Error state renders + retry button works on fetch failure.
  - Cards render sorted by `promotedAt DESC`.
  - "Load more" button fetches next page and appends.
  - Demote button PATCHes `{ promoted: false }` and optimistically removes the card.
  - `useNavCounts` returns both counts when both fetches succeed.
  - `useNavCounts` keeps the last-known value for one badge if the other fetch fails (independent try/catch isolation).
  - Sidebar badge count refreshes within poll interval after promote action.
- Gate: `npx tsc --noEmit` + `npm run test:run` green, then `/review`.

---

## 8. Final verification

From `/Users/joelaptin/jcl-govcon`:

```bash
npm run lint
npm run test:run    # suite green, exact count not gated
npx tsc --noEmit
npm run dev         # localhost:3001 smoke test
```

**Happy-path manual demo:**

1. Open `/inbox` — pick a GOOD card → click inline `★ Promote`.
2. Expect: card optimistically disappears from /inbox (promote-implies-reviewed via COALESCE).
3. Sidebar: Chosen badge shows "1" in gold within 30s poll interval.
4. Navigate to `/chosen` — card appears with gold left-border, star icon, AI GOOD badge still visible.
5. Open `/` — promoted contract in GOOD column with gold border (still there, not teleported).
6. Open the contract detail — header pill reads `CHOSEN ★`, top gold accent visible, classification row has gold `★ Demote` button.
7. Click `★ Demote` from detail. Navigate to `/chosen` — empty state. Main Kanban GOOD column — card back to normal green border.
8. **Cross-classification check:** open a MAYBE contract from main Kanban → verify ★ Promote appears → promote → verify it lands on /chosen with the MAYBE badge still rendered. Repeat with a DISCARD contract.
9. **Promote → reload → still promoted:** verify DB persistence.
10. **Audit log check:** `psql -c "select * from audit_log order by created_at desc limit 10"` — confirm promote/demote actions are recorded with correct contract_id and action.
11. **Dark mode visual check:** toggle to dark mode. Verify `★ Promote` button, `CHOSEN ★` header pill, and gold left-border are all visible against the dark surface. If `--chosen-bg` at 0.08 opacity is too subtle for the pill, bump to 0.12-0.15.
12. **Mobile responsive check:** narrow browser to ≤375px. Verify inline `★ Promote` button on /inbox cards doesn't crowd the layout, and the gold accent on Kanban cards still reads.
13. **Sidebar fallback check:** disable network briefly while sidebar is rendered. Confirm badges keep their last-known values (don't reset to 0 or `null`).

**Rollback sequence (if needed post-deploy):**

1. **Revert code first** (`git revert` the 5 commits or specific ones). The schema columns + audit_log table stay in place with `promoted=false` default — zero user impact, no data loss.
2. Optional schema rollback (only if tables/columns are causing other issues): `ALTER TABLE contracts DROP COLUMN promoted, DROP COLUMN promoted_at; DROP TABLE audit_log;` and drop the indexes. **Do not run this with the new code still deployed.**

Then `/qa` focused on: cross-classification promotion (MAYBE → promoted, DISCARD → promoted), demote reversibility, /chosen empty/error states, sidebar badge accuracy after promote/demote cycle, dark mode gold tokens, mobile layout, audit log entries.

---

## Files touched (summary)

Source (7 files + 1 new):

1. `src/lib/db/schema.ts` — 2 columns + partial index on `contracts`, 1 new `audit_log` table + index
2. `src/app/globals.css` — gold CSS tokens
3. `src/app/api/contracts/[id]/route.ts` — PATCH `promoted` with COALESCE reviewedAt + transaction-wrapped audit_log insert
4. `src/app/api/contracts/route.ts` — `?promoted=` query param (with 400 on invalid) + select + sort + pagination
5. `src/components/contract-detail.tsx` — `★ Promote`/`★ Demote` button (all classifications) + `CHOSEN ★` pill + top border
6. `src/components/kanban/card.tsx` — gold border override + star icon
7. `src/app/inbox/page.tsx` — `removeFromInbox` helper extracted; markReviewed refactored to use it; new inline `★ Promote` button
8. `src/components/sidebar.tsx` — Chosen nav item + `useNavCounts` (Promise.allSettled, isolated badge updates) + `badgeColor` prop
9. **NEW:** `src/app/chosen/page.tsx` — /chosen page (~180 lines, /inbox clone with pagination + error state)

Repo docs (committed in Commit 1): 10. **NEW:** `docs/plans/chosen-tier.md` — this plan, copied from `~/.claude/plans/`. 11. **MODIFIED:** `TODOS.md` — appended P2 entry for E2E test infrastructure follow-up.

Tests: schema-mock updates in ~6 files + behavior tests committed alongside each feature commit. No Postgres migration file. No AI prompt change. No `analytics-dashboard.tsx` change. No `/api/analytics` route change. No new `/counts` endpoint.

---

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                             | Runs | Status              | Findings                                                                             |
| ------------- | --------------------- | ------------------------------- | ---- | ------------------- | ------------------------------------------------------------------------------------ |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy                | 1    | CLEAR (HOLD_SCOPE)  | 5 findings surfaced + 4 cross-model tensions resolved; 0 unresolved, 0 critical gaps |
| Codex Review  | `/codex review`       | Independent 2nd opinion         | 1    | issues_found        | 17 findings (Claude subagent — Codex CLI not installed); 4 tensions resolved         |
| Eng Review    | `/plan-eng-review`    | Architecture & tests (required) | 1    | CLEAR (FULL_REVIEW) | 5 findings (3 arch, 1 quality, 1 tests); all resolved; 0 critical gaps               |
| Design Review | `/plan-design-review` | UI/UX gaps                      | 0    | —                   | —                                                                                    |
| DX Review     | `/plan-devex-review`  | Developer experience gaps       | 0    | —                   | —                                                                                    |

- **CODEX:** Codex CLI not installed locally — Claude subagent ran the outside voice for the CEO review. Eng review did not re-run an outside voice (the same subagent on the same plan would just repeat itself). Fold into the existing Codex Review row above.
- **CROSS-MODEL:** Both reviews agreed plan was structurally sound. Cross-model disagreements all centered on optimization tradeoffs (premature counts endpoint, concurrency hardening, UI policy on DISCARD, audit storage). All resolved interactively.
- **ENG REVIEW DECISIONS LOCKED:**
  1. `audit_log.contractId` uses `onDelete: 'set null'` — preserves audit history when contracts are deleted.
  2. PATCH UPDATE + audit_log INSERT wrapped in `db.transaction(...)` — atomic; either both persist or both fail.
  3. `useNavCounts` uses `Promise.allSettled` — one badge can stay fresh if the other fetch fails.
  4. `removeFromInbox(id, classification, body)` helper extracted in `inbox/page.tsx` — DRY for `markReviewed` + new `★ Promote`.
  5. E2E tests deferred to a separate platform PR; verbatim P2 entry baked into Commit 1's `TODOS.md` edit.
- **UNRESOLVED:** 0
- **VERDICT:** CEO + ENG CLEARED — ready to implement. Per the task workflow: branch `feat/chosen-tier`, then commit-by-commit per §7 with `tsc --noEmit` + `test:run` per-commit gate, `/review` after commits 2/3/5, then `/qa` + `/ship`.
