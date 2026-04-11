# GovContractFilter — Frontend Redesign Spec

This is the complete specification for the frontend redesign. Hand this to Claude Code as-is.

---

## Design Philosophy

Clean, professional, information-dense. Think Linear, Notion, Vercel dashboard.
Light mode default with dark mode toggle. No wasted space.

---

## App Structure

The app has exactly TWO views plus a settings modal:

1. **Main page (/)** — Kanban board with stats and search/filter
2. **Detail page (/contracts/[id])** — Full contract analysis
3. **Settings modal** — Opens from gear icon in top-right
4. **DISCARD archive page (/discards)** — Full list of discarded contracts (linked from "see more" on kanban)

### What to REMOVE:
- Sidebar navigation (sidebar.tsx) — KILL ENTIRELY
- Analytics page (/analytics, analytics-dashboard.tsx) — REMOVE
- Import page (/import, csv-import.tsx) — REMOVE
- Viewer page (/viewer) — REMOVE (viewer is inline in detail page)
- crawl-status.tsx — REMOVE or collapse into settings modal
- classify-control.tsx — REMOVE (unified prompt handles this)
- dashboard-stats.tsx — REPLACE with compact stats strip (see below)

---

## Color Scheme

### Theme: Clean Professional (Linear/Notion/Vercel inspired)

Replace the current CSS variable system with a cleaner palette.

**Light mode (default):**
- --surface: #ffffff
- --surface-alt: #f9fafb
- --surface-raised: #ffffff (with subtle shadow)
- --text-primary: #111827
- --text-secondary: #4b5563
- --text-muted: #9ca3af
- --border: #e5e7eb
- --border-subtle: #f3f4f6
- --accent: #2563eb (blue-600)
- --accent-hover: #1d4ed8

**Dark mode:**
- --surface: #0f1117
- --surface-alt: #1a1d27
- --surface-raised: #1e2130
- --text-primary: #f3f4f6
- --text-secondary: #9ca3af
- --text-muted: #6b7280
- --border: #2d3140
- --border-subtle: #1e2130
- --accent: #3b82f6 (blue-500)
- --accent-hover: #60a5fa

**Classification colors:**
- --good: #10b981 (emerald-500)
- --good-bg: #ecfdf5 (light) / #064e3b20 (dark)
- --maybe: #f59e0b (amber-500)
- --maybe-bg: #fffbeb (light) / #78350f20 (dark)
- --discard: #6b7280 (gray-500)
- --discard-bg: #f9fafb (light) / #1f293720 (dark)

**Badge colors by category:**
- Positive signals (green): bg #ecfdf5, text #065f46, border #a7f3d0
- Contract type (blue): bg #eff6ff, text #1e40af, border #bfdbfe
- Urgency (red/amber): URGENT: bg #fef2f2 text #991b1b, SOON: bg #fffbeb text #92400e

Dark mode badge variants:
- Positive signals: bg #064e3b40, text #6ee7b7, border #064e3b
- Contract type: bg #1e3a5f40, text #93c5fd, border #1e3a5f
- Urgency: URGENT: bg #7f1d1d40 text #fca5a5, SOON: bg #78350f40 text #fcd34d

**Light/dark toggle:** Sun/moon icon in top-right next to gear icon. Default: light. Persists to localStorage. Reads prefers-color-scheme on first visit.

---

## Top Bar (replaces sidebar)

Full-width bar at the very top of every page. Height: 48px. Background: --surface with bottom border.

Contents (left to right):
- **Logo/title**: "GovContractFilter" or "GCF" — left-aligned, font-semibold
- **Spacer** (flex-grow)
- **Theme toggle**: Sun/moon icon button
- **Settings gear**: Opens settings modal overlay

No other navigation needed. The main page IS the dashboard.

---

## Main Page (/)

### Layout (top to bottom):

#### 1. Stats Strip
Compact horizontal bar below the top bar. Three small stat cards side by side:
- **GOOD** count — emerald accent, number + "Good" label
- **MAYBE** count — amber accent, number + "Maybe" label  
- **DISCARD** count — gray accent, number + "Discard" label

Style: Small, inline, not the big 4-card grid that exists now. Think: pill-shaped counters or a single-line summary. Should take minimal vertical space.

#### 2. Search & Filter Bar
Full-width bar below stats. Contains:
- Search input (searches title, agency, summary) — takes most of the width
- Filter controls inline: Agency dropdown, Notice Type dropdown, Set-Aside dropdown
- Clear filters button
- All in one clean row, no collapsible panel needed

#### 3. Kanban Board
Three columns: **GOOD**, **MAYBE**, **DISCARD**

Column sizing:
- GOOD and MAYBE: Equal width, take the majority of horizontal space
- DISCARD: Narrower column on the right

Column headers:
- Colored dot (classification color) + uppercase title + count badge
- Same as current but using new color scheme

**GOOD & MAYBE columns:**
- Load 50 contracts per page
- "Load more" button at bottom when more exist
- Cards are draggable between columns (drag sets userOverride: true)

**DISCARD column:**
- Shows only 10 contracts
- "See all X,XXX discarded →" link at bottom
- Clicking opens /discards page (new) with full paginated list
- Cards are NOT draggable out of DISCARD (but GOOD/MAYBE cards can be dragged INTO DISCARD)

---

## Kanban Card (card.tsx)

### Badge System

Badges appear in a horizontal wrap row near the top of each card, below the title.

**Badge definitions:**

| Badge | Color Group | Condition | Label |
|-------|------------|-----------|-------|
| LOW BARRIER | Green (positive) | actionPlan.lowBarrierEntry === true | LOW BARRIER |
| SBA | Green (positive) | setAsideType contains "small business" or setAsideCode in [SBA, SBP] | SBA |
| AGILE | Green (positive) | actionPlan.positiveSignals includes agile-related text | AGILE |
| < SAT | Green (positive) | awardCeiling < 250000 | < SAT |
| FFP | Blue (contract type) | actionPlan.contractType contains "Fixed" or "FFP" | FFP |
| T&M | Blue (contract type) | actionPlan.contractType contains "Time" or "T&M" | T&M |
| IDIQ | Blue (contract type) | actionPlan.contractType contains "IDIQ" | IDIQ |
| BPA | Blue (contract type) | actionPlan.contractType contains "BPA" | BPA |
| URGENT | Red (urgency) | responseDeadline < 3 days from now | URGENT |
| SOON | Amber (urgency) | responseDeadline 3-7 days from now | SOON |

**Badge style:** Small pill-shaped, rounded-full, text-[10px] or text-xs, px-2 py-0.5, font-medium. Background + text color per category group.

**Tooltips:** Every badge has a tooltip on hover explaining what it means:
- LOW BARRIER: "This contract doesn't require specialized skills — anyone with basic resources can do it"
- SBA: "Small business set-aside — JCL qualifies, reduced competition"
- AGILE: "Agile/sprint-based delivery mentioned — favors small nimble teams"
- < SAT: "Under $250K Simplified Acquisition Threshold — easier procurement, often no past performance required"
- FFP/T&M/IDIQ/BPA: "Contract type: [full name]"
- URGENT: "Response deadline in less than 3 days"
- SOON: "Response deadline in 3-7 days"

### Card Layout (top to bottom):

1. **Title** — 2-line truncate, links to /contracts/[id]. Font-medium.
2. **Badges row** — Horizontal flex-wrap of applicable badges
3. **Agency** — Icon + truncated agency name. text-sm, --text-secondary
4. **Award ceiling + Deadline** — Side by side. Ceiling formatted $X.XM/$XXK. Deadline as "MMM d" with color coding (red < 3 days, amber < 7 days).
5. **Summary** — 2-line truncate of the AI summary (NOT reasoning). text-sm, --text-muted. Border-top separated.

### Card styling:
- bg-[var(--surface)], border border-[var(--border)], rounded-lg, p-3
- 3px left border in classification color
- Hover: subtle shadow elevation
- Dragging: ring-2 --accent, slight opacity reduction

**Change from current:** Show `summary` instead of `aiReasoning` on the card. Summary is more useful for scanning ("Build a cloud portal for document intake") vs reasoning ("This contract aligns with JCL's capabilities because...").

---

## Contract Detail Page (/contracts/[id])

### Overall Layout
- Max-width: 1400px, centered with padding
- 3-column layout using CSS grid or flex

### Header (full width, above columns)
- Back arrow link to /
- Title (large, font-semibold)
- Classification badge (color-coded, shows "(manual)" if userOverride)
- Badges row (same badges as kanban card, with hover tooltips)
- Metrics strip: 3 inline items — **Deadline** (with days remaining, color-coded) | **Bid Range** | **Estimated Effort**

### Three-Column Layout

#### Left Column (~250px, sticky top)

**Metadata Grid:**
Compact key-value pairs, section-title styling for headers.

| Field | Source |
|-------|--------|
| Agency | contract.agency |
| Solicitation # | contract.solicitationNumber |
| Notice Type | contract.noticeType |
| Set-Aside | contract.setAsideType |
| NAICS Code | contract.naicsCode (with human-readable name) |
| PSC Code | contract.pscCode (with human-readable name) |
| Award Ceiling | contract.awardCeiling (formatted) |
| Response Deadline | contract.responseDeadline (formatted + color) |
| Posted Date | contract.postedDate |
| Notice ID | contract.noticeId |
| Contract Type | actionPlan.contractType (or "—") |
| Period of Performance | actionPlan.periodOfPerformance (or "—") |
| Number of Awards | actionPlan.numberOfAwards (or "—") |
| NAICS Size Standard | actionPlan.naicsSizeStandard (or "—") |
| Place of Performance | actionPlan.placeOfPerformance (or metadata popState/City/Zip) |
| Travel | actionPlan.travelRequirements.details (or "None mentioned") |

**Positive Signals Section:**
Below the metadata grid. Heading: "Positive Signals" with a sparkle or star icon.
- Render each item from actionPlan.positiveSignals as a green-tinted row
- If empty, show "No positive signals detected"

**SAM.gov Link:**
External link button to contract.samUrl

#### Center Column (flexible, main content)

**AI Reasoning:**
- Brain icon + "AI Analysis" heading
- Reasoning text (whitespace-pre-wrap)
- "Re-classify" button (triggers unified prompt via POST /api/pipeline)

**Contract Description:**
- Heading: "What This Contract Is"
- actionPlan.description (2-3 sentences)

**Full Description:**
- Heading: "Full Description"
- contract.descriptionText in scrollable container (max-height with overflow)

**Implementation Summary:**
- Heading: "Implementation Summary" with collapsible toggle (visible by default)
- Render actionPlan.implementationSummary as a bullet list
- Clean, readable bullets — not numbered

#### Right Column (~300px)

**Compliance Panel:**
- Blue-tinted panel with Shield icon
- Heading: "Compliance Requirements"
- Render actionPlan.compliance as bullet list
- If only "No specific compliance requirements detected", show muted

**Risks Panel:**
- Amber-tinted panel with AlertTriangle icon
- Heading: "Risks & Challenges"  
- Render actionPlan.risks as bullet list

**Key Dates Panel:**
- Panel with Calendar icon
- Heading: "Key Dates"
- Render actionPlan.keyDates as a list: date (formatted) + description
- If null, show "No additional dates found"

**Notes:**
- Heading: "Notes"
- Auto-saving textarea (1s debounce → PATCH /api/contracts/[id])

**Documents:**
- Heading: "Documents"
- List contract.resourceLinks with Eye (inline viewer) + Download buttons
- Document viewer opens as modal overlay (keep existing modal behavior)

**Actions:**
- Classification dropdown (updates → sets userOverride: true)
- Status dropdown (IDENTIFIED → PURSUING → BID_SUBMITTED → WON → LOST)
- "Re-classify" button (duplicate of the one in center column, or just one location)
- "Generate Action Plan" button if actionPlan is null

---

## DISCARD Archive Page (/discards)

New page linked from the kanban DISCARD column "see more" button.

### Layout:
- Top bar (same as everywhere)
- Back arrow link to /
- Heading: "Discarded Contracts" with total count
- Search bar (title/agency/summary search)
- Paginated table or card list (50 per page)

### Each row/card shows:
- Title (links to /contracts/[id])
- Agency
- Summary (1 line)
- DISCARD reasoning (2 lines, truncated)
- Response deadline

### Purpose:
Browse discarded contracts. User can click through to detail page and manually override classification if the AI was wrong.

---

## Settings Modal

Opens from gear icon in top-right. Modal overlay with backdrop blur.

### Contents:
- **Company Profile** section (display only — name, CAGE, UEI)
- **Theme** toggle (light/dark)
- **API Usage** display (xAI token usage if tracked)
- **Pipeline Controls** (if needed — trigger re-classification, etc.)
- Close button (X) and click-outside-to-close

---

## Responsive Behavior

- **Desktop (≥1024px):** Full 3-column detail page, 3-column kanban
- **Tablet (768-1023px):** 2-column kanban (GOOD + MAYBE, DISCARD collapsed), 2-column detail (left + center merged, right below)
- **Mobile (<768px):** Single column everything. Kanban becomes tabbed view (tab per classification). Detail page stacks all three columns vertically.

Top bar: Always visible. On mobile, compact with just logo + gear.

---

## Component Changes Summary

| Component | Action |
|-----------|--------|
| sidebar.tsx | DELETE |
| analytics-dashboard.tsx | DELETE |
| csv-import.tsx | DELETE |
| crawl-status.tsx | DELETE or move into settings modal |
| classify-control.tsx | DELETE |
| dashboard-stats.tsx | REPLACE with compact stats strip |
| kanban/board.tsx | UPDATE: 3 columns, no sidebar offset, new search bar, DISCARD limit |
| kanban/card.tsx | UPDATE: badge system, show summary instead of reasoning |
| kanban/column.tsx | UPDATE: DISCARD column behavior (10 limit + "see more") |
| contract-detail.tsx | REWRITE: 3-column layout, new sections, badge system |
| theme-toggle.tsx | MOVE to top bar |
| settings-form.tsx | MOVE to modal overlay |
| /app/analytics/ | DELETE route |
| /app/import/ | DELETE route |
| /app/viewer/ | DELETE route |
| /app/discards/ | NEW route — DISCARD archive page |

---

## Action Plan TypeScript Interface (replaces old ActionPlan)

```typescript
interface ActionPlan {
  description: string;
  implementationSummary: string[];
  deadline: string;
  bidRange: string;
  estimatedEffort: string;
  contractType: string | null;
  periodOfPerformance: string | null;
  numberOfAwards: string | null;
  naicsSizeStandard: string | null;
  placeOfPerformance: string | null;
  keyDates: Array<{ date: string; description: string }> | null;
  travelRequirements: {
    required: boolean;
    details: string;
  };
  compliance: string[];
  risks: string[];
  positiveSignals: string[];
  lowBarrierEntry: boolean;
}
```
