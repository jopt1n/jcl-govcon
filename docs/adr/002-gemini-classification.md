# ADR-002: Gemini 2.5 Flash for Classification

## Status: Accepted

## Context
Need AI to classify government contracts as GOOD/MAYBE/DISCARD based on JCL Solutions' capabilities (solo operator, software/IT/AI/cloud focus).

## Decision
Use Gemini 2.5 Flash via `@google/genai` SDK with structured JSON output. Two-tier classification:
- **Metadata-only triage**: Conservative, uses only structured fields. "When in doubt, MAYBE."
- **Full classification**: Uses metadata + description text for GOOD/MAYBE re-evaluation.

Sequential calls (50/chunk, 300ms between calls, 2s between chunks). No batch API (SDK doesn't support it).

## Cost
- Initial classification of ~7K contracts: ~$5-15
- Ongoing daily (~1,500 contracts): ~$5-10/month
- Self-hosted LLM only makes sense at millions of documents scale

## Alternatives Considered
- **GPT-4**: More expensive, similar quality for classification
- **Gemini batch API**: SDK doesn't support it; sequential at full price
- **Self-hosted LLM (Kimi K2.5 on Hetzner)**: Not cost-effective at current scale
- **Rule-based filtering**: Too many edge cases, poor accuracy
