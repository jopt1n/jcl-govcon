# ADR-004: Contract Classification Criteria

## Status: Accepted

## Context
Need to automatically categorize ~18K government contracts into actionable buckets for a solo operator focused on software/IT/AI/cloud work.

## Decision
Three-tier classification (GOOD / MAYBE / DISCARD) with PENDING as initial state:

**GOOD** — Remote-deliverable software/IT work:
- Software development, AI/ML, cloud, DevOps, CRM, automation, consulting
- Small business set-asides (SBA, 8(a), HUBZone)
- Relevant NAICS codes (541511, 541512, 541519)

**MAYBE** — Needs human review:
- Larger scope that may need teaming partners
- Ambiguous metadata (could be relevant with full description)
- Conservative default: "when in doubt, classify as MAYBE"

**DISCARD** — Not viable:
- Construction, manufacturing, facilities, janitorial
- Hardware procurement, on-site-only work
- Security clearance required
- Construction NAICS (236xxx, 237xxx, 238xxx)

## Pipeline Status (for GOOD contracts)
IDENTIFIED → PURSUING → BID_SUBMITTED → WON → LOST

## Consequences
- Conservative approach means more manual review (MAYBE) but fewer missed opportunities
- Metadata-only triage handles ~80-90% as DISCARD without expensive description fetches
