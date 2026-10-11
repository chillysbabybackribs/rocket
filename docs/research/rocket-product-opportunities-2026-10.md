# Product opportunities for Rocket

Research date: October 11, 2026.

## Recommendation

Test a product that owns one recurring business task and presents completed work for review. The strongest candidate from this research is a supplier order follow-up and exception desk for small manufacturers or distributors that coordinate orders across accounting software, spreadsheets, email and supplier portals. The second candidate is a Salesforce consultant workbench that turns a reported problem into a reproduced failure, a proposed correction and verified evidence.

These are candidates for customer discovery, not validated businesses. The public evidence establishes real tasks and substantial competition. It does not establish willingness to pay for Rocket, the size of an underserved segment, or a reliable implementation cost. Access to actual customers should decide which candidate goes first.

The user's concern about asking customers to design their own software is well founded as a product risk. A stronger starting experience is: “Here are the orders that need attention, the evidence, and the actions I prepared.” Customers should supply goals, constraints and business judgments. Rocket should supply a predefined workflow, sensible defaults and evidence-backed proposals.

## What the evidence changes

### General Salesforce assistance is already contested

Salesforce markets Agentforce Coworker for search, analysis and triggering workflows across Salesforce and other surfaces. Its setup documentation specifies edition, licensing, permission and activated Data Cloud or Data 360 prerequisites. This creates a possible adoption or packaging opportunity, but does not establish a permanent capability gap. [Coworker product description](https://www.salesforce.com/agentforce/coworker/) and [setup requirements](https://developer.salesforce.com/docs/data/agentforce-coworker/guide/agentforce-coworker-turn-on-infrastructure.html).

Salesforce also documents Setup with Agentforce for access troubleshooting, org health, flow explanation, formula assistance and custom object creation. A product positioned as “ask AI about your Salesforce setup” would overlap directly. [Salesforce admin use cases](https://admin.salesforce.com/blog/2026/5-use-cases-to-get-started-with-setup-with-agentforce).

Gong supports editing imported CRM fields and syncing them back, as well as exporting captured activities. Its September 2026 release notes describe creating agents from natural-language requests and using uploaded context. Meeting-to-CRM assistance and conversational workflow creation are therefore existing competitive offerings. [Gong CRM integration](https://help.gong.io/docs/crm-integrations) and [release notes](https://help.gong.io/docs/our-monthly-updates).

Lindy advertises scheduled work, reusable skills, integrations and browser operation. A general agent working across apps is also a crowded positioning. These are vendor capability claims, not hands-on comparative test results. [Lindy product page](https://www.lindy.ai/).

### Discovery and migration are already products

Attio offers an Import2 migration service at no additional charge through its supported paid plans. Its documented workflow includes field mappings, sample migration and full migration. The Salesforce-specific section supports Contacts, Accounts, Leads and Opportunities and explicitly excludes Cases. The implication is a potential opportunity around completeness and business behavior, rather than basic record copying. That one limitation does not prove a commercially attractive market by itself. [Attio migration documentation](https://attio.com/help/reference/imports-exports/migrate-data-from-another-crm).

Elements.cloud offers configuration mining, data-model diagrams, process documentation and dependency analysis; its ISV page targets consultant delivery as well. Its configuration-mining page labels order-of-execution diagrams “Coming soon,” so those should not be treated as verified shipped functionality. [Configuration mining](https://elements.cloud/salesforce-configuration-mining/) and [consultant and ISV offering](https://elements.cloud/salesforce-isv/).

Gearset documents scheduled and on-demand Salesforce UI test jobs. Rocket should not claim novelty merely because it can run a browser test. [Gearset testing documentation](https://docs.gearset.com/en/articles/13489850-running-your-first-test-job-with-automated-testing).

### Concrete operational problems are a better discovery starting point

One small-business operator describes entering orders into Sage, creating supplier purchase orders, and reentering order numbers and dates in a spreadsheet. They specifically want overdue supplier alerts, easier order-status answers and purchase-order generation. This is an anonymous, self-selected report: useful for interview questions, not proof of market prevalence or willingness to pay. [Operator's account](https://www.reddit.com/r/smallbusinessuk/comments/1sy2oyr/erp_software_advice_for_a_madetoorder_small/).

A Salesforce administrator describes inheriting undocumented automation and breaking other behavior when disabling components. Responses include both consultant practices and ordinary AI-assisted metadata analysis. This supports investigating diagnosis and verification while also highlighting a low-cost substitute. The identities and claims are unverified. [Administrator discussion](https://www.reddit.com/r/salesforce/comments/1r11m0l/inherited_an_org_with_zero_documentation_buried/).

Salesforce's 2026 sales-statistics article reports that reps spend 60% of their time on non-selling tasks and that 74% of sales teams using AI prioritize data hygiene. This is vendor-published survey evidence for broad pain, not a measure of time Rocket could save or a causal finding. [Salesforce sales research](https://www.salesforce.com/sales/state-of-sales/sales-statistics/).

### Operational automation has incumbents too

Conexiom's Workbench already manages failed document processing, data conflicts, manual review and recommendations to prevent recurring problems. Its ADI case study reports 1,700 orders processed daily after automating order entry. This is a vendor-published customer story at a much larger scale than our proposed initial customer; it supports the existence of an established spending category, not expected Rocket results. [Workbench documentation](https://help.conexiom.com/knowledge-base/workbench--getting-started) and [ADI case study](https://conexiom.com/case-studies/adi-global-distribution-helps-improve-sales-effectiveness-with-conexiom).

MaintainX already has purchase-order approval, receipt and inventory workflows. A basic purchase-order tracker would need to compete with existing operational software. [MaintainX purchase orders](https://help.getmaintainx.com/about-purchase-orders).

Microsoft Power Automate task mining records desktop activity, identifies process variations and recommends automation. “Watch my work and discover what to automate” is an established approach, rather than an unexplored invention. [Microsoft task mining](https://learn.microsoft.com/en-us/power-automate/task-mining-overview).

One cautionary example is Dooly: its own site announces a June 30, 2025 shutdown and a decision to focus on other product areas. This does not establish why the economics failed or whether CRM assistance is unviable; it does warn against treating an attractive workflow demonstration as proof of a durable business. [Dooly announcement](https://www.dooly.ai/).

## Opportunity comparison

Priority below is a qualitative judgment for what to investigate first. It is not a market-size estimate or a score derived from customer interviews.

| Candidate | Proposed buyer and recurring outcome | User design burden | Main challenge | Priority |
|---|---|---|---|---|
| Supplier order exception desk | Operations manager; identify delays and reconcile supplier updates | Low after bounded setup | Existing order tools; connector cost and accurate matching | First customer discovery candidate |
| Salesforce issue resolution workbench | Boutique consultancy; diagnose a ticket and deliver tested changes | Low for business user, moderate for consultant | Salesforce, Elements, Gearset and general coding agents | Strong alternate if consultant access is better |
| Contract and CRM reconciliation | Revenue operations; identify mismatched amounts, dates and obligations | Low with explicit policies | Source authority, extraction quality, competition from revenue tools | Adjacent experiment, needs deeper market research |
| Migration assessment and rehearsal | Consultant or company already considering a move; reveal losses and migration effort | Moderate | Project-based demand and destination-specific behavior | Useful paid service hypothesis |
| CRM onboarding guide | Team lead; help new staff perform company-specific tasks | Moderate because company policy must be learned | Native assistance and difficulty sustaining recurring value | Feature within a stronger product |
| General CRM update assistant | Sales manager; keep records current after meetings | Low | Direct Salesforce, Gong and general-agent competition | Weak standalone starting position |
| Generic workflow discovery agent | Business owner; find and automate repetitive work | High ambiguity despite automatic discovery | Task mining incumbents and consulting-heavy onboarding | Too broad initially |
| Custom CRM generation and migration | Business owner; replace existing system | High implementation and acceptance burden | Full system ownership, continuity and support costs | Defer until a repeatable segment is understood |

## Candidate one Supplier order exception desk

### What the customer buys

“Know which supplier orders threaten a customer commitment, and have the next action ready.”

Proposed initial segment: a small made-to-order manufacturer or distributor with an operations coordinator maintaining a supplier spreadsheet alongside an accounting or CRM system. Narrow the first pilot further to one supported system combination and one class of orders. The researched Sage example is a problem lead, not a commitment to support Sage desktop integration in the first release.

The agent compares authorized order data, supplier acknowledgments and delivery updates. It produces a queue of late orders, missing confirmations, quantity discrepancies and conflicting dates. Each item includes the source evidence, business impact and proposed action. It can prepare a supplier follow-up and a system update; sending or committing follows the customer's chosen authorization rules.

### Example experience

An illustrative queue item says: “Supplier acknowledgement gives November 18; the customer installation is November 15. These two records refer to the same purchase order. I prepared a supplier escalation and flagged the installation coordinator. Confirm the recipient and proposed action.”

The agent supplies the analysis and draft. The user decides whether an expedited shipment is worth its cost or whether the customer date can change. Those are business judgments that cannot reliably be inferred from screen layouts.

The first usable screen would contain a work queue, evidence preview and proposed actions. Chat remains available for questions. Interactive examples help approve one policy such as “flag unconfirmed orders after two business days”; they do not require customers to design forms and databases.

### Competitive hypothesis

The potential opening is a narrow group poorly served by its current combination of tools, where adopting a large replacement system is undesirable and configuring general automation costs too much. This opening is unverified. Conexiom already handles exceptions, and existing inventory or ERP products may solve the problem better. Reject the idea for a segment if a modest configuration change in its existing software delivers the same outcome.

### First product boundary

Start with detection and reviewed follow-up preparation. Exclude inventory valuation, accounting, payments, autonomous purchasing, production planning and full CRM replacement. Support partial deliveries, duplicate documents, revised dates and ambiguous order IDs in the evaluation set. Prefer structured connections when available; use browser interaction for explicitly supported gaps, with read-back verification.

A setup fee plus a recurring team or processed-case subscription is a pricing hypothesis. Price discovery must follow measured workload and savings. Illustratively, 300 monthly cases saving 8 minutes each would save 40 hours; at an assumed $35 loaded hourly cost, that is $1,400 of gross monthly time value before review, integration and operating costs. These are scenario assumptions, not research findings or recommended prices.

## Candidate two Salesforce issue resolution workbench

### What the customer buys

“Turn this customer complaint into a reproducible issue, a reviewed fix and evidence that it works.”

Target a consultancy managing several customer orgs. A consultant can interpret ambiguous requirements and already has a delivery relationship; Rocket can reduce investigation and evidence-collection work.

Example input: “Our reps cannot close some deals, and fixing one rule broke a notification.” Rocket inspects authorized metadata and records, identifies candidate causes with evidence, proposes a sandbox reproduction, and produces a bounded change and regression checks. The consultant reviews business effects and the deployment decision.

The product must offer more than generated documentation. Its proposed value is a complete case record: symptom, reproducer, dependency evidence, proposed correction, tests and handover. Native Setup assistance, existing specialist products and ordinary coding agents are direct substitutes to test against.

Potential commercial structure is a consultant or agency subscription plus setup for supported environments. Interview firms about whether faster delivery improves margins or reduces billable revenue; do not assume both. Kill the idea if their existing tools already deliver equivalent evidence at comparable effort or if each case requires extensive expert intervention.

## Candidate three Migration assessment before CRM replacement

Offer a fixed-scope assessment to a customer already considering a move. Inventory the supported objects, relationships, reports and behaviors; map them to a specific destination; perform a sample migration; and demonstrate what would be lost or need rebuilding.

This has a clearer deliverable than promising an automatically generated CRM for any business. Attio's documented Salesforce Case exclusion gives a concrete example of why source-to-destination coverage matters. The product still needs destination-specific expertise and independent verification; a visual replica does not establish functional equivalence.

Treat this initially as a service enabled by software. Recurring revenue might come from consultancies repeating migrations, not the end customer doing the same migration every month. Building a shared vertical CRM becomes more credible only if multiple assessments reveal the same required workflows and customers actually choose to switch.

## How Rocket could reduce the user's design burden

1. Start with a role and an outcome, such as an operations coordinator managing late orders. Ship the initial workflow rather than a blank prompt.
2. Inspect only authorized data and examples. Establish actual sources, identifiers and update authority.
3. Propose a process based on the evidence and a maintained domain template. Distinguish observed behavior from inferred policy.
4. Ask focused business questions: which promised date matters, who may approve an exception, which system is authoritative when values conflict.
5. Rehearse with historical cases and show proposed actions. The customer corrects decisions, not application architecture.
6. Run within approved boundaries, verify changes and route uncertainty to a human. Store corrected policies explicitly rather than relying on conversation memory alone.

Configuration shows what a system can do. Historical activity shows some of what people did. Neither proves what the business ought to do. A useful agent reduces the number and difficulty of questions without pretending to eliminate judgment.

## What we have actually demonstrated

Rocket created and read back a 20-record fictional Salesforce fixture. A fresh chat then produced the correct pipeline and lead assessment in a displayed 2 minutes 12 seconds. The saved evaluation records answer accuracy as passed and the no-write invariant as not independently audited. [Local test record](../salesforce-lab/run-t1-001.json).

That is evidence for supervised interaction and record interpretation in a small controlled org. It is not evidence for unattended operation, messy document extraction, role-sensitive access, high-volume processing, recurring monitoring, migration completeness or commercial demand.

Rocket's existing browser, chat and artifact workflow can support an exploratory workbench. A product would still need durable job state, supported connectors, duplicate prevention, evidence retention, permissions, reliable scheduling and measured recovery. The UI and choice of model alone would be easy to imitate.

## Validation before a substantial build

Recruit six operations managers in one segment and four Salesforce consultants. These are proposed research targets; nobody has been contacted. Ask each to demonstrate the last real incident, the artifacts involved, how often it happens, who handles it, and what they already tried. Obtain permission before inspecting company material. Avoid leading with an AI demo or asking whether the idea sounds useful.

For operations, collect de-identified examples of late acknowledgments, date changes, partial delivery and mistaken matches. For consultants, collect resolved tickets with expected causes and accepted fixes. Compare against their existing workflow and the relevant incumbent, not only against unaided manual work.

Proposed continuation gates:

- At least three prospects independently describe the same recurring task and can provide examples and a buyer.
- At least two agree to a paid, bounded pilot or another concrete purchasing step. Compliments do not meet this gate.
- Across at least 30 held-out cases, measure correct action proposals, missed important exceptions, wrong-record matches, interventions and elapsed time. Require zero unauthorized external actions; one small test set is not sufficient to establish production safety.
- Demonstrate a meaningful reduction in human handling time after including review and correction. Use a provisional 50% reduction target, chosen for the experiment rather than presented as an industry benchmark.
- Show that the second customer reuses the core workflow. Record bespoke setup hours, support time and model/tool costs. Stop expanding if these consume the likely subscription value.

If the business pain is infrequent, the underlying data cannot be accessed economically, an incumbent already solves it easily, or buyers will not sponsor a pilot, change segment or stop. Do not respond by making the agent broader.

## Decision

Prioritize the supplier order exception desk for customer discovery, with the consultant issue-resolution workbench as the alternate depending on access to buyers. Keep Salesforce as one possible connected system rather than a prerequisite for the product.

Postpone custom CRM generation. Its discovery and preview mechanics may become valuable later, but the immediate research objective is to find a repeated, valuable job for which Rocket can deliver a finished result with little customer instruction.
