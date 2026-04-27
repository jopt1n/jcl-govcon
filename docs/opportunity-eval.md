# Opportunity Evaluation

Working note for contract triage. This is not the product roadmap and not an operational handoff. The goal is to force a more concrete question than "is this software?" or "could I do this?":

`If awarded, what would I actually have to do in the first 2 days, first 2 weeks, and first 2 months?`

## Evaluation lens

For each opportunity, answer these before promoting it:

1. What is the buyer actually buying?
2. Is the real deliverable:
   - a custom build
   - a configured COTS product
   - a reseller / distribution arrangement
   - a services vehicle that may never generate work
   - an RFI / pitch that does not yet buy delivery
3. What must exist on day 1 after award?
   - vendor quote
   - implementation plan
   - shipping / fulfillment path
   - access approvals
   - staffing or subcontractors
   - cybersecurity / hosting package
4. What cash would JCL have to front?
5. Can this be white-labeled, resold, or partnered, or does JCL need to build the real thing itself?
6. What hidden burden matters more than the headline?
   - QA / UAT
   - training
   - ongoing support
   - regulated environment experience
   - inventory / returns
   - site access / installation

## Worked evaluations

### 1. U.S. Senate Web Dev 4

- Contract ID: `823a4486-c2a9-4c4a-b2c4-f8a430ebcba4`
- Solicitation: `2026-R-038`
- What they are actually buying:
  - A spot on a multiple-award IDIQ vehicle for Senate website work, not one standalone brochure site.
  - Typical task orders appear to include design, development, content migration, training, maintenance, and end-user support on top of a Senate-provided WordPress base build.
- What JCL would actually deliver if it won a task order:
  - Project plan, requirements questionnaire, wireframes / design comps.
  - Configured Senate-hosted WordPress site using approved plugins and Senate guides.
  - Migrated content, forms, analytics setup, accessibility remediation, test artifacts, launch support, and ongoing support reports.
- Day 0-2 after task-order award:
  - Read the office-specific TOPR and Senate guides.
  - Inventory source content and constituent-service flows.
  - Identify only approved WordPress plugins / modules; reject any Webflow-style approach.
- Week 1:
  - Discovery with the office.
  - Content map, nav structure, form inventory, accessibility plan.
  - Mockups and project schedule for approval.
- Weeks 2-6:
  - Build inside the SAA WordPress base build.
  - Configure pages, forms, analytics, roles, and migration scripts/process.
  - Run defect review, unit/integration/system testing, and readiness review.
- Launch / post-launch:
  - Production testing, go-live support, 14-day monitoring, then monthly support and reporting.
- What this is not:
  - Not a Webflow site.
  - Not a greenfield app stack.
  - Not "just build a WordPress theme and walk away."
- White-label / partner angle:
  - Possible only as WordPress implementation capacity.
  - Stronger as a teamed effort with past performance and cleared process maturity.
- Cash exposure:
  - Low hardware cash exposure; high time/process exposure.
- Real risk:
  - No guaranteed task orders under the IDIQ.
  - Winning the vehicle likely depends more on past performance, process rigor, and key personnel than raw build skill.
- Recommendation:
  - `Stretch but possible`
  - Better as a teamed/subcontract role than a pure solo prime play.
- Sources:
  - Gov summary with attachment descriptions: <https://console.sweetspotgov.com/federal-contracts/9e383124-bb65-5006-a12d-94d0eb611172>
  - Public summary: <https://bidbanana.thebidlab.com/bid/MxUxRpmcfRrFeZ5aEgXi>

### 2. Opentron Liquid Handling Robot

- Contract ID: `84fef5f3-33c9-4d1d-81b3-7842e51a8936`
- Solicitation: `MV477020`
- What they are actually buying:
  - A specific lab automation BOM, not a general "automation solution."
  - One Opentrons Flex robot, multiple pipettes/modules/blocks/adapters, consumable tip racks, plus on-site installation support and on-site protocol development.
- What JCL would actually deliver:
  - Authenticated sourcing of the exact parts.
  - Delivery coordination to Brookhaven.
  - On-site install visit and protocol-development support, likely via OEM or a qualified lab-automation partner.
- Day 0-2 after award:
  - Lock the exact BOM and confirm you can source it from Opentrons or an authorized channel.
  - Confirm who is doing the installation and who is doing the protocol-development day.
  - Validate payment terms so JCL does not front a large equipment order blindly.
- Week 1:
  - Place the hardware order.
  - Coordinate shipping, insurance, site access, badging, and customer acceptance details.
- Week 2-3:
  - Track shipment, prep install checklist, gather customer use-case details for protocol work.
- On-site delivery window:
  - Travel to Upton or have the OEM/partner do it.
  - Unbox, install, verify modules, basic calibration/bring-up, document handoff.
  - Conduct protocol-development session against the lab's workflow.
- What this is not:
  - Not just buying one base machine.
  - Not a no-touch drop-ship if the on-site service line items are real performance obligations.
- White-label / partner angle:
  - Strong partner dependency.
  - Best done as reseller + OEM service pass-through, not as a JCL-only performance promise.
- Cash exposure:
  - Likely high five-figure equipment exposure plus travel/services if terms are bad.
- Real risk:
  - If Brookhaven expects true protocol-development competence, this is not a generic IT install.
- Recommendation:
  - `Archive unless partnered`
- Sources:
  - Public draft-PO summary: <https://govtribe.com/opportunity/federal-contract-opportunity/opentron-liquid-handling-robot-mv477020>
  - Product page / service framing: <https://opentrons.com/products/opentrons-flex-robot?sku=999-00191%2C+999-00186%2C+999-00186>
  - Opentrons pipette system description: <https://docs.opentrons.com/flex/system-description/pipettes/>

### 3. Lease of Postage Meter & Mailing System

- Contract ID: `1f7b079a-5905-4c1c-b970-e99feee1f655`
- Solicitation: `W91ZRU26QA012`
- What they are actually buying:
  - A turnkey mailroom equipment lease with web reporting, support, supplies, training, and ongoing service.
  - This is a managed equipment/service lane, not a software build.
- What JCL would actually deliver:
  - A postage meter system and scale meeting specs.
  - Installation, user training, monthly reporting, support/repair, supply replenishment, and possible relocation support over the contract life.
- Day 0-2 after award:
  - Lock the OEM/reseller relationship.
  - Confirm Alaska service coverage and warranty/service model.
  - Confirm the DoD Certificate of Networthiness path if networked reporting touches their environment.
- Week 1:
  - Order/finance the unit.
  - Build the implementation plan for Anchorage delivery and install.
  - Coordinate training, reporting setup, and postage funding/download workflows.
- Go-live week:
  - Deliver/install.
  - Train users.
  - Verify reporting and postage-download process.
- Ongoing monthly/quarterly:
  - Consumables.
  - Break/fix.
  - Rate updates.
  - Service calls.
  - Device relocation if requested.
- What this is not:
  - Not a custom app.
  - Not attractive unless JCL is really willing to become a Pitney/Quadient-style reseller/service coordinator.
- White-label / partner angle:
  - Yes, but almost entirely dependent on an OEM/service network.
- Cash exposure:
  - Moderate if lease financing/OEM terms are good; ugly if not.
- Real risk:
  - Commodity pricing plus service-coverage obligations.
  - Public summaries conflict on set-aside status, which is a bad sign until the actual solicitation package is verified.
- Recommendation:
  - `Commodity reseller trap`
- Sources:
  - Public SOW-style summary: <https://www.mysetaside.com/contract-search/lease-of-postage-meter-mailing-system/w91zru26qa012>
  - Public attachment summary: <https://govtribe.com/opportunity/federal-contract-opportunity/lease-of-postage-meter-mailing-system-w91zru26qa012>

### 4. DARPA ERIS

- Contract ID: `00ed9a29-3243-42ef-956e-98db80afdf33`
- Solicitation: `DARPA-PS-25-05`
- What they are actually buying:
  - Not a deliverable today.
  - They are buying a pipeline of 7-minute innovation pitches that can later become rapid-procurement opportunities.
- What JCL would actually deliver now:
  - A concrete DARPA-relevant idea, a short video pitch, optional slides, and the submission package.
- Day 0-2:
  - Pick one sharp problem/solution pair with real novelty.
  - Decide whether there is enough substance to demo rather than just narrate.
- Week 1:
  - Build a proof-of-concept or visual demo.
  - Script the video around mission problem, technical novelty, why now, and why JCL can execute.
- Week 2:
  - Record/edit the 7-minute pitch.
  - Submit through ERIS with supporting material.
- After submission:
  - Wait for assessment.
  - If it is deemed awardable, business development starts; actual prototype scope comes later.
- What this is not:
  - Not immediate revenue.
  - Not a normal software delivery engagement.
- White-label / partner angle:
  - No.
- Cash exposure:
  - Low.
- Real risk:
  - Easy to spend time on a cool idea with no contracting path unless the concept is genuinely differentiated.
- Recommendation:
  - `Pursue only if you already have a strong thesis or prototype`
  - Otherwise archive and focus on closer-in opportunities.
- Sources:
  - ERIS Marketplace overview: <https://www.darpaconnect.us/eris>
  - DARPAConnect webinar summary: <https://learning.theari.us/products/darpa-eris-webinar-advancing-disruptive-research-at-transformational-velocity-march-17-2025>
  - Public solicitation summary: <https://www.federalcompass.com/rfp-opportunity-detail/DARPA-PS-25-05>

### 5. Hanford Integrated Waste Management Software Solution

- Contract ID: `ce03a5b9-0441-40bb-806c-4006f7d4e1bc`
- Solicitation: `385993`
- Important correction:
  - The local app record says `Sources Sought`, but the official Hanford document is an actual solicitation for proposals for a firm-fixed-price subcontract due `May 7, 2026`.
- What they are actually buying:
  - A mature integrated waste-management software solution, not a lightweight dashboard project.
  - The official solicitation requires a `COTS application` with out-of-the-box functionality and experience in DOE/NRC-regulated environments.
- What JCL would actually have to deliver:
  - A cloud SaaS/PaaS or similar product with:
    - request management & workflow automation
    - container & inventory management
    - waste characterization & handling
    - inspection & corrective action management
    - system integration & interoperability
    - security / access / clearance
    - regulatory reporting & recordkeeping
    - transportation & emergency response
    - training
  - Security review, configuration, integration testing, UAT, go-live readiness, and post-go-live validation.
- Day 0-2 after award:
  - Finalize the actual software platform.
  - Confirm cybersecurity posture, hosting, and compliance package.
  - Confirm implementation team and regulated-environment references.
- Week 1:
  - Detailed discovery against Hanford waste processes.
  - Gap analysis between customer workflow and your product.
  - Security architecture and interface inventory.
- Weeks 2-6:
  - Configure workflows, data model, roles, reporting, and inventory/container logic.
  - Build/verify integrations.
  - Prepare cybersecurity review artifacts before DOE network connection.
- Weeks 6-10:
  - Integration test exit review.
  - UAT planning and approval.
  - UAT execution and defect closure.
- Go-live:
  - Configuration freeze.
  - Go-live readiness review.
  - Production migration and training.
  - 30-60 day post-go-live performance review.
- What this is not:
  - Not a solo custom-web-app sprint.
  - Not likely greenfield code from scratch.
  - Not a fit unless JCL is fronting a real existing waste/EHS platform or acting as a serious implementation partner.
- White-label / partner angle:
  - Yes, but only if JCL teams with an actual COTS waste-management/EHS vendor.
- Cash exposure:
  - Moderate/high depending on licensing, partner terms, and implementation staffing.
- Real risk:
  - Official requirements include 3+ years in DOE/NRC-regulated environments, COTS out-of-the-box capability, FedRAMP status for cloud-hosted solutions, and NIST 800-53 Moderate experience.
- Recommendation:
  - `Archive unless partnered with a real COTS platform vendor`
- Sources:
  - Official Hanford solicitation PDF: <https://www.hanford.gov/tocpmm/files.cfm/385993_Solicitation-H2C.pdf>
  - Public summary mirror: <https://bidbanana.thebidlab.com/bid/khqOUTjCqsor31OlgVPw>

### 6. NGA Police Boots

- Contract ID: `a196588a-23bb-4da2-b71c-9817537b01c5`
- Solicitation: `Sources03262026`
- What they are actually buying right now:
  - An RFI response about police duty boots, not a purchase order yet.
  - They want market feedback on boots that meet a statement of need for NGA police officers in St. Louis, MO and Springfield, VA.
- Is there one exact shoe?
  - No exact brand/model is specified in the public material.
  - The requirement reads like salient characteristics plus a request for a range of options suitable for different climates and use cases.
- How many shoes/pairs?
  - Quantity is not specified in the public material.
  - That means you cannot responsibly price this yet.
  - If it becomes a real buy, assume the real burden is not "one boot SKU," but size coverage, replenishment, and exchanges across two locations.
- What JCL would actually deliver if it turned into a buy:
  - A catalog-backed footwear supply program, likely with multiple approved SKUs.
  - Size availability across women's `4-11` and men's `6-15`.
  - Shipping to two sites and likely exchange/return handling for fit issues.
- Day 0-2 for the current RFI:
  - Pick a manufacturer/distributor.
  - Map specific boot models to the salient requirements.
  - Confirm size ranges, lead times, and drop-ship or stocking model.
- Week 1 for the current RFI:
  - Submit vendor/admin info, past performance, and recommended acquisition structure.
  - Present 2-4 proposed models rather than one "magic boot."
- If it becomes a real award later:
  - Build a size matrix.
  - Set unit pricing and exchange policy.
  - Decide whether you are stocking inventory or passing orders through a distributor.
- What this is not:
  - Not enough information yet to know spend or quantity.
  - Not a custom product.
- White-label / partner angle:
  - Strong distributor/manufacturer dependency.
- Cash exposure:
  - Unknown quantity means cash exposure is unknown.
  - Could be manageable if drop-shipped; ugly if JCL stocks inventory or handles returns itself.
- Real risk:
  - Quantity unknown.
  - No specific SKU.
  - Procurement likely favors established uniform/footwear distributors.
- Recommendation:
  - `Archive unless you already have a footwear distribution partner`
- Sources:
  - Public RFI summary and document descriptions: <https://govtribe.com/opportunity/federal-contract-opportunity/nga-police-boots-sources03262026>
  - Public summary mirror: <https://bidbanana.thebidlab.com/bid/EGoKFaKWhzQX6Pp5cc4x>

## Bottom line

The most useful distinction is not `software vs hardware`; it is:

- `Vehicle / pitch / positioning play`
- `True build-from-scratch software project`
- `Configured COTS implementation`
- `Commodity reseller / distribution contract`

For the contracts above:

- Senate Web Dev 4: `stretch but possible`
- Opentrons: `archive unless partnered`
- Postage meter: `commodity reseller trap`
- DARPA ERIS: `pursue only with a real thesis/prototype`
- Hanford waste software: `archive unless partnered with mature COTS`
- NGA police boots: `archive unless distributor-backed`
