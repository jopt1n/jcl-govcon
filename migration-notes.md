# Migration Notes: Unified Pipeline + Frontend Redesign

## Pipeline Changes

### Before (3 stages):
```
17,824 contracts → Stage 1 (metadata only) → Stage 2 (full + docs) → Stage 3 (action plan)
Three prompt functions, multiple classification rounds, separate action plan generation.
```

### After (1 stage):
```
Contracts → Code pre-filter → Unified prompt (full metadata + description + all docs)
One prompt function, one pass, classification + action plan together.
```

### Prompt file:
- DELETE: buildMetadataClassificationPrompt()
- DELETE: buildClassificationPrompt()
- DELETE: buildActionPlanPrompt()
- ADD: buildUnifiedClassificationPrompt() (see unified-prompts.ts)

### Code pre-filter (BEFORE sending to xAI):
Still worth filtering in code to save tokens. These are free checks:
- Expired response deadlines → skip
- Restricted set-asides by code (8A, SDVOSB, HZ, WOSB, EDWOSB) → skip

NOTE: Do NOT pre-filter by NAICS code anymore. The old approach discarded
entire NAICS categories (construction, manufacturing) but under the new
feasibility-based approach, some contracts in those categories may be
simple enough for one person (e.g., POS installation, equipment procurement).
Let the LLM make the call.

### API routes to clean up:
- /api/classify/metadata — OBSOLETE (metadata-only classification removed)
- /api/reclassify — OBSOLETE (separate reclassification removed)
- /api/fetch-descriptions — REVIEW (may still be needed for contracts without descriptions)
- /api/pipeline — UPDATE to trigger unified prompt instead of multi-stage
- /api/contracts/[id] POST — UPDATE action plan generation to use unified prompt

---

## Database Changes

### Action Plan Schema (stored as JSON string in actionPlan column)

Old fields → New fields mapping:

| Old Field | New Field | Change |
|-----------|-----------|--------|
| description | description | Unchanged |
| deadline | deadline | Unchanged |
| verdict | — | REMOVED |
| ballparkBid | bidRange | RENAMED |
| deliverables | — | REMOVED (folded into implementationSummary) |
| techStack | — | REMOVED |
| implementationSteps | — | REMOVED |
| estimatedEffort | estimatedEffort | Unchanged |
| compliance | compliance | Unchanged |
| risks | risks | Unchanged |
| — | implementationSummary | NEW: string[] (3-5 bullet points) |
| — | contractType | NEW: string | null |
| — | periodOfPerformance | NEW: string | null |
| — | numberOfAwards | NEW: string | null |
| — | naicsSizeStandard | NEW: string | null |
| — | placeOfPerformance | NEW: string | null |
| — | keyDates | NEW: Array<{date, description}> | null |
| — | travelRequirements | NEW: {required: boolean, details: string} |
| — | positiveSignals | NEW: string[] |
| — | lowBarrierEntry | NEW: boolean |

### New column:
- contactEmail (text, nullable) — scraped from SAM.gov page during ingestion, NOT extracted by LLM

### Columns to update on unified runs:
- classificationRound → set to 4 (or new value) to distinguish unified runs
- classifiedFromMetadata → always false for unified prompt
- documentsAnalyzed → always true for unified prompt

### Enum changes:
- classificationEnum: Consider whether PENDING is still needed. With the unified prompt,
  contracts go straight from ingestion to classified. PENDING might only exist briefly
  during the classification batch job. Keep it for now but it won't appear in the UI kanban.

---

## New Task: Scrape Contracting Officer Email

During SAM.gov ingestion (not during LLM classification), scrape the contracting
officer contact email from the SAM.gov page HTML and store in new contactEmail column.

This is a Playwright/scraping task, not an AI task. Add to the existing crawl pipeline.

---

## TypeScript Interface Updates

### Old ActionPlan interface:
```typescript
interface ActionPlan {
  description: string;
  deadline: string;
  verdict: { recommendation: string; confidence: number; reasoning: string };
  ballparkBid: string;
  deliverables: string[];
  techStack: { frontend: string[]; backend: string[]; database: string[]; auth: string[]; storage: string[]; ai: string[]; monitoring: string[]; cicd: string[] };
  implementationSteps: string[];
  estimatedEffort: string;
  compliance: string[];
  risks: string[];
}
```

### New ActionPlan interface:
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
  travelRequirements: { required: boolean; details: string };
  compliance: string[];
  risks: string[];
  positiveSignals: string[];
  lowBarrierEntry: boolean;
}
```

### Parsing note:
The actionPlan column stores a JSON string. Any code that parses it
(JSON.parse(contract.actionPlan)) needs to handle both old and new schemas
during the transition. The simplest approach: re-run all contracts through
the unified prompt and overwrite all action plans. Since this is "the last
time" running classification, old schema compatibility isn't needed long-term.

---

## Batch Execution Plan

Recommended order for running the final unified classification:

1. Add contactEmail column to DB
2. Update scraper to extract contact emails during crawl
3. Replace prompts.ts with unified-prompts.ts
4. Update batch-classify.ts to use buildUnifiedClassificationPrompt()
5. Update /api/pipeline and /api/contracts/[id] POST to use unified prompt
6. Run code pre-filter (expired deadlines + restricted set-asides only)
7. Run unified prompt on all remaining contracts via xAI Batch API (50% discount)
8. Verify results, spot-check classifications
9. Deploy frontend redesign
10. Clean up obsolete API routes and components
