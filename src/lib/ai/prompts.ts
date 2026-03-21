/**
 * Classification prompt for Gemini 2.5 Flash.
 * Evaluates government contracts against JCL Solutions' capabilities.
 */

const JCL_CAPABILITY_PROFILE = `
## Company Profile: JCL Solutions LLC

**Model:** Solo operator with AI-augmented development (Claude Code, Cursor, etc.)
**Set-asides:** Small business
**Delivery:** Remote-first, software-deliverable work
**Clearance:** None

### Can Do
Any work that is deliverable remotely by building software. This includes custom software development, web/mobile apps, APIs, AI/ML, cloud architecture, DevOps, automation, data analytics, cybersecurity tools, IT modernization, CRM/ERP systems, chatbots, dashboards, and IT consulting.

### Cannot Do
Anything requiring physical presence, physical labor, hardware, or non-software deliverables. This includes construction, facilities maintenance, janitorial, manufacturing, hardware engineering, drone/vehicle/weapons systems, physical R&D, lab work, medical/clinical services, logistics/warehousing, transportation, security guard services, staffing, telecommunications cabling/wiring, and scientific research equipment.

### Classification Rules
**GOOD** — Strong match. Title or description explicitly mentions software, application, web, API, database, cloud, AI, machine learning, data analytics, cybersecurity, IT modernization, automation, or consulting AND is remote-deliverable. Realistically achievable by a skilled solo developer with AI tools.

**MAYBE** — Partial match. Interesting opportunity that partially aligns but may need teaming, has larger scope, or requires further review. Examples: larger IT modernization programs (could subcontract), mixed physical/digital projects, staff augmentation, training development with tech components.

**DISCARD** — Poor match. Construction, physical infrastructure, manufacturing, hardware-only, requires security clearance, on-site fieldwork, drone/vehicle/weapons systems, physical R&D, lab work, medical/clinical services, logistics/warehousing, janitorial, facilities management, or any work that fundamentally cannot be delivered remotely by a solo software developer. Also DISCARD contracts with restrictive set-asides (8(a), SDVOSB, HUBZone, WOSB, EDWOSB, Veteran-owned, Native American-owned) — these should be filtered before AI classification, but if they reach the classifier, DISCARD them. Also DISCARD sole-source awards — contracts where the description states a specific vendor has already been selected, includes language like 'sole source', 'only known responsible source', 'not a request for competitive quotes', 'intent to award to [specific company]', 'is the only source', or names a specific incumbent contractor who has been pre-selected. These are not open competitions and JCL cannot bid on them. Also DISCARD contracts where the response deadline has already passed. If the Response Deadline is before today's date, mark as DISCARD with reasoning that the opportunity has closed. Still provide clear reasoning for why it doesn't fit.
`.trim();

interface ClassificationPromptInput {
  title: string;
  agency: string | null;
  naicsCode: string | null;
  pscCode: string | null;
  noticeType: string | null;
  setAsideType: string | null;
  awardCeiling: string | null;
  responseDeadline: string | null;
  descriptionText: string | null;
  documentTexts: string[];
}

/**
 * Build the full classification prompt for a single contract.
 * Documents are passed as separate content parts (inline data), not in the text prompt.
 */
export function buildClassificationPrompt(input: ClassificationPromptInput): string {
  const metadata = [
    `Title: ${input.title}`,
    input.agency ? `Agency: ${input.agency}` : null,
    input.naicsCode ? `NAICS Code: ${input.naicsCode}` : null,
    input.pscCode ? `PSC Code: ${input.pscCode}` : null,
    input.noticeType ? `Notice Type: ${input.noticeType}` : null,
    input.setAsideType ? `Set-Aside: ${input.setAsideType}` : null,
    input.awardCeiling ? `Award Ceiling: $${input.awardCeiling}` : null,
    input.responseDeadline ? `Response Deadline: ${input.responseDeadline}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const descriptionSection = input.descriptionText
    ? `\n## Contract Description\n${input.descriptionText.slice(0, 15000)}`
    : "";

  const docsSection =
    input.documentTexts.length > 0
      ? `\n## Attached Document Content\n${input.documentTexts.map((t, i) => `--- Document ${i + 1} ---\n${t.slice(0, 10000)}`).join("\n\n")}`
      : "";

  return `You are a government contract classifier for JCL Solutions LLC.

${JCL_CAPABILITY_PROFILE}

## Contract to Classify

${metadata}
${descriptionSection}
${docsSection}

## Instructions

Analyze this government contract opportunity and classify it as GOOD, MAYBE, or DISCARD based on JCL Solutions' capabilities described above.

Your reasoning MUST always be populated with a clear, specific explanation (2-4 sentences) of why this contract received its classification. Reference specific aspects of the contract (scope, requirements, delivery model) and how they align or don't align with JCL's capabilities.

Respond with valid JSON only:
{
  "classification": "GOOD" | "MAYBE" | "DISCARD",
  "reasoning": "Your detailed reasoning here...",
  "summary": "1 plain English sentence describing what this contract is actually asking for"
}`;
}

// ── Metadata-Only Classification ──────────────────────────────────────────

export interface MetadataClassificationInput {
  title: string;
  naicsCode: string | null;
  pscCode: string | null;
  agency: string | null;
  orgPathName: string | null;
  noticeType: string | null;
  setAsideType: string | null;
  setAsideCode: string | null;
  popState: string | null;
  awardCeiling: string | null;
}

/**
 * Build a conservative triage prompt using ONLY contract metadata.
 * No description text, no documents — just structured fields.
 * Goal: quickly discard the ~80-90% of clearly irrelevant contracts.
 */
export function buildMetadataClassificationPrompt(input: MetadataClassificationInput): string {
  const metadata = [
    `Title: ${input.title}`,
    input.naicsCode ? `NAICS Code: ${input.naicsCode}` : null,
    input.pscCode ? `PSC Code: ${input.pscCode}` : null,
    input.agency ? `Agency: ${input.agency}` : null,
    input.orgPathName ? `Organization: ${input.orgPathName}` : null,
    input.noticeType ? `Notice Type: ${input.noticeType}` : null,
    input.setAsideType ? `Set-Aside: ${input.setAsideType}` : null,
    input.setAsideCode ? `Set-Aside Code: ${input.setAsideCode}` : null,
    input.popState ? `Place of Performance: ${input.popState}` : null,
    input.awardCeiling ? `Award Ceiling: $${input.awardCeiling}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a government contract triage classifier for JCL Solutions LLC, a solo AI-augmented software development firm.

## Classification Mode: METADATA-ONLY TRIAGE

You are classifying contracts using ONLY metadata fields (title, NAICS, PSC, agency, set-aside). You do NOT have the full description or attached documents. Your job is conservative triage:
- DISCARD contracts that are CLEARLY irrelevant based on metadata alone
- Mark anything ambiguous as MAYBE for later full review
- Only mark GOOD if metadata strongly signals a software/IT/AI opportunity

## Company Capabilities
- **Can do:** Any work that is deliverable remotely by building software. This includes custom software development, web/mobile apps, APIs, AI/ML, cloud architecture, DevOps, automation, data analytics, cybersecurity tools, IT modernization, CRM/ERP systems, chatbots, dashboards, and IT consulting.
- **Cannot do:** Anything requiring physical presence, physical labor, hardware, or non-software deliverables. This includes construction, facilities maintenance, janitorial, manufacturing, hardware engineering, drone/vehicle/weapons systems, physical R&D, lab work, medical/clinical services, logistics/warehousing, transportation, security guard services, staffing, telecommunications cabling/wiring, and scientific research equipment.
- Solo operator, small business, remote only. No security clearance.

## NAICS Code Hints
- **Likely relevant:** 541511 (Custom Software), 541512 (Computer Systems Design), 541519 (Other IT Services), 518210 (Data Processing/Hosting), 541611 (Management Consulting), 541715 (R&D Physical/Bio — sometimes AI)
- **Likely irrelevant:** 236xxx (Construction), 237xxx (Heavy/Civil Engineering), 238xxx (Specialty Trade), 561xxx (Facilities/Janitorial), 336xxx (Manufacturing), 622xxx (Healthcare Facilities), 541330 (Engineering Services — usually physical/mechanical, not software), 541713 (R&D — physical sciences), 541714 (R&D — physical sciences), 488xxx (Transportation support), 811xxx (Repair/Maintenance)

## Set-Aside Boost
Small business set-asides (SBA, SBP, 8A, 8AN) are a positive signal — JCL qualifies for these.

## Contract Metadata

${metadata}

## Classification Rules (Conservative)
- **GOOD** — Title or metadata explicitly mentions software, application, web, API, database, cloud, AI, machine learning, data analytics, cybersecurity, IT modernization, automation, or consulting AND is remote-deliverable
- **MAYBE** — Ambiguous from metadata alone, could be relevant, needs full description review
- **DISCARD** — Clearly construction, manufacturing, facilities, janitorial, heavy equipment, medical supplies, drone/vehicle/weapons systems, physical R&D, lab work, logistics/warehousing, transportation, repair/maintenance, staffing, or other non-IT physical work. Also DISCARD contracts with restrictive set-asides (8(a), SDVOSB, HUBZone, WOSB, EDWOSB, Veteran-owned, Native American-owned) — these should be filtered before AI classification, but if they reach the classifier, DISCARD them

If the contract has very little information to judge (missing description, vague title, unclear scope), classify as MAYBE with reasoning that notes insufficient information for confident classification.

When in doubt, classify as MAYBE. It's better to review a false positive than miss a real opportunity.

Respond with valid JSON only:
{
  "classification": "GOOD" | "MAYBE" | "DISCARD",
  "reasoning": "1-2 sentences explaining the classification decision",
  "summary": "1 plain English sentence describing what this contract is actually asking for"
}`;
}

export { JCL_CAPABILITY_PROFILE };
export type { ClassificationPromptInput };
