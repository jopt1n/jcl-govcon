# ADR-001: SAM.gov 4-Phase Pipeline Architecture

## Status: Accepted

## Context
Need to ingest ~18K active solicitations from SAM.gov and classify them. Direct API calls to Gemini for every contract would cost ~$50-100 and waste budget on irrelevant contracts (construction, manufacturing, etc.).

## Decision
4-phase pipeline that progressively filters:
1. **Metadata-only crawl** — Bulk ingest from SAM.gov API (free, 1K calls/day limit)
2. **Metadata classification** — Gemini triage using only structured fields (title, NAICS, PSC, agency, set-aside). Discards ~80-90%.
3. **Selective description fetch** — Only fetch full descriptions for GOOD/MAYBE contracts (~500-2K vs 18K)
4. **Re-classification** — Re-classify GOOD/MAYBE with full metadata + description text

## Alternatives Considered
- **Web scraping SAM.gov**: Fragile, TOS violations, slower than API
- **Classify everything with descriptions**: ~$50-100 Gemini cost, 18K description fetches
- **NAICS code filtering only**: Too coarse, misses relevant contracts with unexpected codes

## Consequences
- 90% reduction in Gemini API costs (~$5-15 vs $50-100)
- 90% reduction in SAM.gov description fetches
- More complex pipeline (4 steps vs 1), but each step is independently triggerable
- Daily pipeline runs all 4 steps in sequence for small volumes (~1,500/day)
