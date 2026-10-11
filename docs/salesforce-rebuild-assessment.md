# Rebuilding Salesforce with REA: size and difficulty

Assessed 2026-10-11. REA checked at `morluto/rea` v6.4.0 (commit `13e03e9`, checkout in
`/tmp/review-rea/src`).

## Short answer

REA isn't the right tool for this, and pointing it at a Salesforce org breaks Salesforce's terms.
A Salesforce-style CRM can still be built. The way to do it is a clean-room build from Salesforce's
public documentation and the parts it has open-sourced, on top of an existing open-source CRM.

| What you rebuild | Size | Realistic? |
| --- | --- | --- |
| Sales Cloud core: accounts, contacts, leads, opportunities, activities, list views, record pages, basic reports | Months for one person with agents, starting from an open-source CRM | Yes |
| The platform: custom objects and fields, formula fields, validation rules, page layouts, a flow builder, a sharing model, a SOQL-like query API, reports and dashboards | One to two years for a small team | Hard, but bounded |
| The whole product: an Apex-like language and runtime with governor limits, a multitenant kernel at scale, packaging and a marketplace, Service, Marketing and Commerce clouds, Data Cloud, Agentforce, Slack, Tableau, MuleSoft | Thousands of engineer-years | No |

## What REA is

"Reverse Engineer Anything" is an MCP server and CLI for coding agents. It has 77.7k GitHub stars,
was created in April 2026 and was updated today. It inspects things that ship to your machine:

- native binaries, through Hopper, Ghidra or IDA
- JavaScript and Electron apps, ASARs, .NET assemblies, APKs and firmware
- websites over CDP: DOM, scripts, network, screenshots (`inspect_web_page`, `observe_web_session`)
- bundles and source maps: `analyze_web_bundle`, `export_web_scripts`, and `recover_javascript_sources` through Wakaru
- HAR and mitmproxy captures

Its showcases follow one feature at a time into client code: a DX-Ball sound-pan function, or
Notion's clipboard bridge through preload and IPC.

## Why REA has little to work with on Salesforce

1. **The product runs on the server.** Salesforce describes its platform as a multitenant,
   metadata-driven kernel over one shared database. Creating an object "does not create an actual
   table in a database or compile any code". The platform stores metadata and builds the app from
   it at runtime, using tables such as `MT_Objects`, `MT_Fields`, `MT_Data` with flex columns, and
   `MT_Indexes` ([Platform Multitenant Architecture](https://architect.salesforce.com/fundamentals/platform-multitenant-architecture)).
   None of that reaches the browser. REA would see the Lightning client and the network calls it
   makes, but not the query optimizer, sharing calculation, Apex runtime, flows or limits.
2. **The client pieces worth copying are already open.** Lightning Web Components is MIT-licensed
   ([LICENSE.md](https://raw.githubusercontent.com/salesforce/lwc/master/LICENSE.md)). Salesforce
   reportedly says the open-source engine is the same one the platform runs. That claim comes from
   a search summary of its LWC Open Source guide; I did not open the guide.
   The Lightning Design System's code is BSD-licensed, but its icons are CC BY-ND and the Salesforce
   Sans font is restricted. That split also comes from a search summary of the SLDS downloads page,
   which I did not open.
3. **The data model and APIs are documented.** The Object Reference lists about 1,700 standard
   objects (1,715 object pages were counted on
   [Standard Objects](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_list.htm)
   today). That number is also a fair measure of scope: Sales Cloud core uses a few dozen of them.

## The terms

The free Developer Edition is the only org you could practically use as a target. Its
[Main Services Agreement — Developer Services](https://www.salesforce.com/company/agreements/developer_edition),
last updated June 30, 2026, says:

- **Prohibited without written consent.** You may not access or use the Developer Services "for any
  other benchmarking or competitive purposes". Breaking this is a material breach.
- **§2.5(h).** You may not "modify, copy, or create derivative works based on … any part, feature,
  function or user interface".
- **§2.5(j).** "except to the extent permitted by applicable law, disassemble, reverse engineer, or
  decompile the Developer Services or access it to (1) build a product or service competitive with
  the Developer Services, (2) build a product or service using similar ideas, features, functions or
  graphics … (3) copy any ideas, features, functions or graphics".
- **§5.5 also says** Salesforce acknowledges "You may develop and make available products and
  services that are similar to or otherwise compete with Our products and services."

So building a competing CRM is allowed. Using a Salesforce org to study and copy it is not.
Running REA's CDP capture, bundle analysis or HAR inspection against an org is exactly that use.
I read only the developer agreement. Search results report similar wording in the customer MSA
and reseller terms, but I did not open those. This is a reading of the text, not legal advice.

## A legitimate route

1. **Start from an open-source CRM.** [Twenty](https://github.com/twentyhq/twenty) calls itself "the
   open alternative to Salesforce". It has 58k stars, and its objects, fields and views are
   defined as code. It is mostly AGPLv3, with some MIT packages and some enterprise-licensed files.
   EspoCRM (AGPL-3.0) is the other option, and this folder already holds Espo HAR captures.
2. **Write the spec from public docs only.** Use the Object Reference, the REST and UI API guides,
   and the SOQL, Flow and sharing documentation. These describe behaviour without involving a
   login.
3. **Build the platform layer in order of value:** metadata-driven custom objects, then formula and
   validation rules, then the sharing model, then a SOQL-like query, then flows, then reports.
   Leave out Apex, and offer TypeScript functions as the code extension instead, as Twenty does.
4. **Use REA where it is allowed:** on the open-source CRM you fork, on your own build, and on
   apps whose terms permit analysis.
