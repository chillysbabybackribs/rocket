# Salesforce session reconnaissance

Inspected October 11, 2026, using the logged-in Salesforce session. This is a **Starter Edition** organization named **blackdogatlanta**, with **30 trial days remaining** displayed. Its customer lists are empty in the views inspected, and its advanced marketing, store, and connector workflows are largely at their setup entry points.

The core structure is a customer database shared by sales and service, with configurable fields, stages, list views, and automation around it. Opening forms and reading their metadata established the configuration below. No business records were created, edited, converted, or deleted; no emails were sent or features activated. Salesforce may still record ordinary navigation and recently viewed activity.

## Organization and access

[Company Information](https://energy-nosoftware-1526.my.salesforce-setup.com/lightning/setup/CompanyProfileInfo/home) identifies the organization as Starter Edition on instance USA1052. Its defaults are English, United States locale, USD, a January fiscal-year start, and America/Los_Angeles time. The organization timezone differs from this computer's America/New_York timezone. The page showed 612 KB used data space and 0 B used file space.

Advanced Setup is reachable from Quick Settings. That establishes access to the administration interface, but does not establish that this user can perform every administrative action. No full permission audit was performed.

## How the customer records connect

| Record | Purpose | Relationships visible in this org's forms |
| --- | --- | --- |
| Lead | A prospective customer before qualification | Holds a person's name, company, contact information, source, rating, and status together |
| Account | A company or organization | Can reference a Parent Account; has billing and shipping addresses |
| Contact | A person at a company | Account Name is required in the displayed form; Reports To links another contact |
| Opportunity | A potential deal | References an account; tracks amount, close date, stage, probability, forecast category, and next step |
| Case | A customer question or issue | References a contact and account; tracks origin, status, priority, subject, and description |

The standard qualification workflow converts a Lead into an Account and Contact, with an optional Opportunity. Existing accounts and contacts can be selected during conversion. This relationship is documented by Salesforce; conversion was not executed in this empty session. [Salesforce lead workflow](https://trailhead.salesforce.com/content/learn/modules/prospect-tracking-with-salesforce-leads-quick-look/track-prospects-with-salesforce-leads).

For example, a prospect at a company starts as a Lead. Once qualified, the company becomes or matches an Account, the person becomes or matches a Contact, and a proposed purchase can become an Opportunity. A later support issue belongs in a Case linked to the customer. The company, person, sale, and support issue remain distinct records.

## Sales configuration

The [Sales app](https://energy-nosoftware-1526.lightning.force.com/lightning/app/06mfn000004nCPIAA2) exposes Leads, Contacts, Accounts, Opportunities, Products, and Price Books in its primary navigation. Products and Price Books were identified in navigation; their record workflows were not exercised.

The inspected New Lead form requires Last Name and Company. It also exposes title, website, description, phone, email, address, employee count, annual revenue, lead source, industry, and rating. Ratings are Hot, Warm, and Cold.

Lead status metadata contains New, Contacted, Nurturing, Qualified, and Unqualified. New is the default; Qualified is specifically marked as a converted status. These are configured choices, not proof that transitions are enforced in that order.

The [Opportunity form](https://energy-nosoftware-1526.lightning.force.com/lightning/o/Opportunity/home) exposes Opportunity Name, Account Name, Close Date, Amount, Description, Stage, Probability, Forecast Category, and Next Step. Opportunity Name and Close Date are visibly marked required.

| Opportunity stage | Default probability | Forecast category | Closed |
| --- | --- | --- | --- |
| Qualify | 10% | Pipeline | No |
| Meet & Present | 25% | Pipeline | No |
| Propose | 50% | Pipeline | No |
| Negotiate | 75% | Pipeline | No |
| Closed Won | 100% | Closed | Yes, won |
| Closed Lost | 0% | Omitted | Yes, lost |

These values came from the org's form metadata response. They describe configured defaults; probability recalculation and save behavior were not tested. Forecast Category Name metadata also offers Best Case and Commit in addition to Omitted, Pipeline, and Closed.

## Service configuration

The [Service app](https://energy-nosoftware-1526.lightning.force.com/lightning/app/06mfn000004nCPJAA2) exposes Cases, Contacts, Accounts, Quick Text, Messaging Sessions, and Analytics. Its Cases list offers New, Change Owner, Merge Cases, and Printable View.

The New Case form links a Contact and Account and includes Subject, Description, Status, Case Origin, Priority, and a “Send notification email to contact” checkbox.

| Field | Configured choices | Default |
| --- | --- | --- |
| Status | New, Working, Waiting on Customer, Escalated, Closed | New |
| Origin | Email, Phone, Web | No default in returned picklist metadata |
| Priority | High, Medium, Low | Medium |

Only Closed is marked closed in the status metadata. An Email origin choice does not itself prove that inbound email routing has been configured.

## Current data and feature readiness

| Surface inspected | Observed state | Interpretation |
| --- | --- | --- |
| All Accounts | 0 items | No accounts visible in this all-records view |
| All Contacts | 0 items | No contacts visible in this all-records view |
| All Opportunities | 0 items | No opportunities visible in this all-records view |
| All Open Leads | 0 items | No matching open leads; does not establish absence of converted leads |
| All Open Cases | 0 items, with closed/date filters | No cases matching that view; not an all-case count |
| Flows, Recently Viewed | 0 items | No recently viewed flows; does not prove the org has no flows |
| Integrations, All Connections | 0 items | No connections listed in this connector surface |
| Commerce | “You don't have any stores yet!” | Store creation is still required |
| Marketing | “Activate Marketing” | Additional marketing tools await activation |

The [Marketing overview](https://energy-nosoftware-1526.lightning.force.com/lightning/n/standard-MarketingAppOverview) says Sales List Emails are already available and advertises activation of campaigns, landing pages with forms, audience building, and analytics. Those features were not activated, and email delivery was not tested.

The [Commerce page](https://energy-nosoftware-1526.lightning.force.com/lightning/n/standard-CommerceStores) offers Create Store. No checkout, payment provider, order, or published storefront was verified.

The [Automation app](https://energy-nosoftware-1526.lightning.force.com/lightning/app/06mfn000004nCPaAAM) provides Home, Flows, Integrations, Monitor, and Action Hub. Its [Integrations page](https://energy-nosoftware-1526.lightning.force.com/lightning/n/standard-Connection) offers New Connection and a connector catalog including Salesforce, NetSuite, QuickBooks, Jira, Asana, Zendesk, HubSpot, Marketo, and OpenAI. Catalog presence does not establish an active connection or subscription entitlement.

## How the interface and configuration work

The left rail selects an app area; the horizontal navigation selects an object or workspace within that area. Accounts and Contacts appear in multiple apps and lead to the same object routes. Each object list combines a selected list view, filters, search, columns, sorting, and actions. An empty filtered view therefore cannot be treated as an empty database.

New opens a modal record form with Cancel, Save, and Save & New. Quick Settings offers custom Fields, Sales Stages, Users, Business Details, Fiscal Year, Email Settings, and Advanced Setup. These controls explain how the standard CRM is adapted to a business without replacing the underlying record types.

The browser traffic observed uses Salesforce Lightning's Aura endpoint for both data and metadata. List screens request list configuration and rows separately. New forms request object information, creation defaults, picklist values, lookup metadata, and available actions. Picklist metadata references UI API v68.0 paths. This is evidence of metadata-driven forms: labels, choices, relationships, and stage defaults are supplied by the org.

Read operations themselves frequently use POST requests to `/aura`; HTTP method alone does not distinguish a read from a business mutation here. This inspection read responses generated by normal navigation and form opening. It did not extract session credentials, replay mutation requests, or verify standalone REST API authentication and permissions.

## What remains unverified

This reconnaissance maps the available surfaces and their actual configuration. An exact behavioral specification still requires a controlled sample workflow: save a lead, convert it, inspect resulting record pages and related lists, move a deal through stages, and open and close a linked case. That would reveal save-time validation, duplicate handling, field mappings, activity behavior, and any automation that executes.

Custom automation, complete permission assignments, API entitlements, integrations outside the inspected connector page, reporting, messaging, payments, and email delivery remain unverified. The next useful experiment is one clearly labeled sample customer journey with explicit agreement on test records and cleanup; no such experiment was performed during this read-only inspection.
