# Claude Code Skillsets Complete Private v1 Expansion Design

Date: 2026-07-23
Status: approved for implementation
Extends: `2026-07-22-claude-code-skillsets-design.md`

> Current status: this document records the earlier Outcome Pack design. All 40
> catalog packs remain `draft` and are not active install units. The current v1
> runtime installs only an authenticated decision plan's primary and optional
> complement.

## 1. Purpose

The current repository proves the manifest, generation, trust, consent, recovery,
and semantic-evaluation foundation. It is not the complete catalog promised by the
original design. The current runtime has one domain, one outcome pack, eight shared
workflow skills, and two manager skills. It has no domain-owned skill library.

This expansion completes the private v1 without reducing the original scope:

- all 20 approved work domains;
- a detailed category taxonomy hidden from the default onboarding flow;
- all 40 representative outcome packs from the original design;
- current market research and auditable external-source selection;
- upstream installation without copying external code into this repository;
- domain-owned skills only where selected external sources leave a real gap;
- adaptive, consent-based setup that normally asks for a goal and domain confirmation,
  not a long sequence of category and skill questions;
- install, update, resume, doctor, and remove lifecycles;
- Korean and English discovery documentation;
- deterministic, semantic, clean-install, and lifecycle evidence before private v1 is
  considered complete.

Making the GitHub repository public is explicitly outside this design. The repository
stays private until the user separately approves publication.

## 2. Product Principles

1. Categories are detailed for discovery and routing; users install outcome packs.
2. The default flow exposes at most a recommendation and the 20 domains for correction.
3. Detection helps choose compatible candidates. Detection never grants install consent.
4. The model may recommend catalog IDs but may not invent commands or source identities.
5. Every executed command comes from a validated, immutable manifest-derived plan.
6. External code stays upstream. This repository records references, reviews, and pins.
7. Official listing is provenance evidence, not a security exemption.
8. A broad catalog does not justify broad default installation.
9. Stable means the outcome can be completed and tested, not merely that a category name
   exists.
10. Shared dependencies are installed once and removed only when no installed pack owns
    them.

## 3. User Experience

### 3.1 Recommended first run

The primary entry point remains `/skillset-manager:setup`.

1. Use the user's current request and conversation to summarize the intended result.
2. If no usable result is present, ask one open question: what should Claude help finish?
3. Return one to three recommended domains and the smallest useful pack set.
4. Ask one confirmation question. The user may accept or replace the domains from the
   20-domain list.
5. Show the exact bounded environment probes and request current consent.
6. Combine intent, confirmed domains, platform, installed plugins, marketplaces, and
   available executables.
7. Resolve the minimum compatible pack and plugin closure for the chosen install level.
8. Show domains, packs, plugins, sources, trust, permissions, conflicts, versions,
   registration operations, install operations, state writes, and verification commands.
9. Ask for final approval of that exact preview.
10. Execute sequentially, record atomic receipts, resume safely after failure, and run
    doctor.

The default flow does not ask the user to choose categories, packs, marketplaces, or
individual skills. Those decisions are derived and disclosed.

### 3.2 Install levels

- `essential`: shared core plus the minimum stable pack closure that completes the stated
  outcome. External enhancements are omitted unless the pack cannot work without them.
- `recommended`: the inferred stable pack set plus the selected trusted enhancements.
  This is the default.
- `domain-full`: every stable pack in the confirmed domains plus their recommended
  dependencies. Beta packs require separate acknowledgement.
- `advanced`: exposes category, pack, provider, and individual optional-plugin controls.
- `full-catalog`: installs every stable domain and recommended dependency. It is hidden
  behind an advanced warning and a separate explicit confirmation.

When a recommended plan exceeds 12 plugins or three new marketplaces, setup labels it a
large plan and offers Essential without changing the user's selection automatically.

### 3.3 Recommendation rules

The model produces a structured recommendation containing only:

- normalized goal summary;
- requested inputs and outputs;
- one to three domain IDs;
- candidate pack IDs;
- short evidence copied or derived from the user's request;
- unresolved questions that would change the pack choice.

The deterministic resolver then:

1. rejects unknown IDs;
2. rejects packs outside confirmed domains unless they are declared cross-domain
   dependencies;
3. filters unsupported platforms, Claude versions, tools, trust, and licenses;
4. prefers already installed compatible providers;
5. applies declared provider priorities and conflict groups;
6. selects the smallest closure covering the requested outcome;
7. adds Recommended enhancements only after the required closure is complete;
8. returns no executable plan when a required capability has no eligible provider.

Low-confidence or materially ambiguous intent never triggers silent broadening. Setup
shows the candidate domains and asks the user to choose.

### 3.4 Domain correction view

The 20 domains are shown as a numbered, localized list. Multi-select is supported. The
view includes one short outcome-oriented line per domain, not its internal category tree.
The category tree is available only in Advanced and generated documentation.

## 4. Information Architecture

### 4.1 Entity hierarchy

- `Domain`: user-visible top-level work area and domain-full install boundary.
- `Category`: detailed discovery and intent-routing label; not a default install unit.
- `Capability`: a reusable atomic ability that can have multiple providers.
- `Outcome Pack`: the logical install unit that completes one observable result.
- `Provider`: an owned plugin/skill or reviewed upstream plugin/skill bundle.
- `Source Review`: immutable evidence and decision for one reviewed upstream revision.
- `Conflict Group`: mutually exclusive or overlapping providers with an ordered default.
- `Install Profile`: a resolved Essential, Recommended, Domain Full, Advanced, or Full
  Catalog selection.

### 4.2 Coverage invariants

- `manifests/catalog.yaml` is the versioned canonical catalog contract. It contains the
  ordered set of 20 domain IDs, all approved category IDs, the 40 initial pack IDs, and any
  approved replacement edges;
- category manifests use stable IDs and declare one owning domain;
- capability manifests declare the category IDs they cover, and pack manifests declare
  required and recommended capability IDs;
- exactly 20 stable domain IDs exist;
- every category belongs to exactly one owning domain;
- every category is reachable from at least one stable pack through a required or
  recommended stable capability; an optional-only edge does not satisfy coverage;
- every stable pack declares observable inputs, outputs, completion criteria, and at
  least one normal and one boundary scenario;
- every required capability has at least one eligible stable provider;
- every provider has a license decision, source identity, reviewed revision, trust tier,
  permissions, install strategy, update policy, and semantic evidence;
- every cross-domain capability has one owner and references that owner instead of being
  copied;
- no draft or blocked entity enters generated public runtime indexes.

## 5. Complete Domain and Pack Coverage

The category lists below are minimum v1 coverage. Research may split a category further,
but it may not delete or merge away an approved capability without written design review.

### 5.1 Research and Intelligence

Categories: source discovery, web research, academic research, patent research, market
research, competitive intelligence, customer research, interview analysis, trend
detection, fact checking, source evaluation, evidence synthesis.

Initial packs:

- `question-to-cited-research-brief`
- `competitor-landscape-to-opportunity-map`
- `customer-interviews-to-insights`

### 5.2 Strategy and Decision

Categories: problem framing, goals and metrics, opportunity assessment, business models,
scenario planning, prioritization, decision records, execution strategy, risk analysis,
strategy review.

Initial pack:

- `evidence-to-strategic-decision`

### 5.3 Writing and Publishing

Categories: ideation, outlining, long-form writing, blogs, newsletters, technical writing,
business writing, copywriting, editing, proofreading, citation verification, translation,
localization, CMS publishing.

Initial packs:

- `idea-to-edited-article`
- `source-to-multilingual-publication`

### 5.4 Marketing and Growth

Categories: ICP, personas, positioning, messaging, offers, pricing, content strategy, SEO,
email, lifecycle, funnels, CRO, paid acquisition, retention, measurement.

Initial packs:

- `product-to-positioning-and-offer`
- `keyword-to-ranked-content`

### 5.5 Promotion and Distribution

Categories: launch promotion, social distribution, channel adaptation, content
repurposing, PR, media pitching, influencer work, community, outreach, campaign
operations, performance feedback.

Initial packs:

- `launch-plan-to-multichannel-campaign`
- `long-form-to-social-distribution`

### 5.6 Sales and Customer

Categories: account research, lead discovery, qualification, discovery, proposals, RFPs,
demos, CRM, negotiation, onboarding, support, customer health, renewal, expansion, VOC.

Initial packs:

- `account-research-to-personalized-outreach`
- `discovery-call-to-proposal`

### 5.7 Product Management

Categories: problem discovery, user needs, product principles, PRDs, user stories, scope,
prioritization, roadmaps, prototype validation, experiments, product metrics, launch
readiness.

Initial packs:

- `customer-problem-to-validated-prd`
- `prd-to-prioritized-roadmap`

### 5.8 Project Management

Categories: project definition, work breakdown, estimation, schedules, dependencies,
resources, meetings, status reporting, decisions, change, risk, stakeholder communication,
retrospectives.

Initial pack:

- `project-brief-to-execution-board`

### 5.9 Software Engineering

Categories: repository context, requirements, specifications, architecture, frontend,
backend, mobile, APIs, databases, testing, debugging, review, refactoring, performance,
accessibility, documentation, release readiness.

Initial packs:

- `repository-to-implementation-plan`
- `spec-to-tested-feature`
- `bug-report-to-verified-fix`

### 5.10 DevOps and Security

Categories: development environments, CI/CD, containers, IaC, cloud, deployment,
rollback, observability, SRE, incident response, secrets, dependency security,
application security, threat modeling, recovery.

Initial packs:

- `service-to-ci-cd-deployment`
- `incident-alert-to-postmortem`
- `application-to-security-review`

### 5.11 AI, Agents, and Automation

Categories: use-case fit, model selection, prompting, context, RAG, MCP, tool calls,
single agents, multi-agent systems, memory, evaluation, guardrails, cost, latency,
monitoring.

Initial packs:

- `use-case-to-agent-design`
- `prototype-to-evaluated-agent`

### 5.12 Data and Analytics

Categories: collection, quality, cleaning, transformation, SQL, exploratory analysis,
statistics, experiments, KPIs, forecasting, segmentation, visualization, dashboards,
reporting, governance.

Initial packs:

- `raw-data-to-validated-dataset`
- `business-question-to-dashboard`

### 5.13 Design and Brand

Categories: briefs, UX research application, information architecture, user flows,
wireframes, UI, design systems, prototypes, web design, brand, visual identity, creative,
accessibility, developer handoff.

Initial packs:

- `brief-to-accessible-interface`
- `brand-strategy-to-visual-system`

### 5.14 Video and Audio

Categories: research, concepts, scripts, storyboards, shot lists, recording preparation,
rough cuts, fine editing, motion graphics, captions, voice cleanup, mixing, music, sound
effects, thumbnails, repurposing, quality control, export.

Initial packs:

- `topic-to-recording-ready-script`
- `raw-footage-to-published-video`
- `long-video-to-multiplatform-clips`

### 5.15 Documents and Knowledge

Categories: documents, spreadsheets, presentations, PDFs, templates, conversion, OCR,
tables, charts, meeting records, notes, knowledge bases, search, SOP documentation,
classification, archiving.

Initial packs:

- `meeting-to-decisions-and-actions`
- `source-files-to-polished-document`

### 5.16 Business Operations

Categories: processes, SOPs, repetitive-work automation, handoffs, service operations,
quality, procurement, vendors, resources, operational metrics, issues, changes,
emergency response.

Initial packs:

- `manual-process-to-maintained-sop`
- `repetitive-work-to-approved-automation`

### 5.17 Finance and Accounting

Categories: budgets, cash flow, costs, receipts, invoicing, collections, bookkeeping
assistance, financial statements, forecasts, unit economics, profitability, fundraising,
tax preparation, management reporting.

Initial pack:

- `transactions-to-management-report`

### 5.18 Commerce

Categories: product research, product planning, catalogs, listings, pricing,
merchandising, stores, marketplaces, inventory, orders, shipping, returns, promotions,
reviews, revenue analysis.

Initial pack:

- `product-idea-to-store-listing`

### 5.19 People and Training

Categories: workforce planning, roles, job descriptions, candidates, interviews, hiring
evaluation, onboarding, performance, feedback, careers, organizational policy, curricula,
learning materials, assessment.

Initial packs:

- `role-need-to-interview-scorecard`
- `expertise-to-training-program`

### 5.20 Legal, Risk, and Compliance

Categories: legal research assistance, contract drafting assistance, contract review
assistance, policies, privacy, intellectual property, regulatory mapping, compliance
checklists, risk registers, audit evidence, incident response, retention, deletion.

Initial packs:

- `contract-to-risk-and-revision-brief`
- `regulation-to-compliance-checklist`

Legal, finance, security, HR, and other high-impact packs must state that they assist a
qualified human and may not make unsupported professional determinations.

## 6. Packaging Model

### 6.1 Owned plugins

- `shared-core`: cross-domain workflow foundations only;
- `skillset-manager`: setup, update, doctor, removal, export, import, and source-audit
  workflows;
- 20 domain meta plugins: domain routing, pack orchestration, and owned gap skills.

Outcome packs remain first-class manifests and install profiles. A pack does not become a
separate plugin by default. Separate plugins are reserved for independently versioned,
large, or high-risk runtime components. This keeps the user-facing plugin list manageable
without weakening pack isolation in the manifest graph.

Selecting a pack installs its owning domain meta plugin, shared dependencies, and the
resolved external providers. Owned gap skills live in the owning domain meta plugin;
reviewed upstream plugins remain separately installed upstream plugins. Pack ownership and
reference counts are recorded independently from plugin packaging, so installing or
removing one pack does not silently install or remove unrelated packs from the same domain.

Each pack manifest declares `runtimeBundle`, `ownedSkillIds`, `requiredCapabilities`, and
`recommendedCapabilities`. Installing the first pack for a domain installs the domain meta
plugin; installing another pack in that domain reuses it. The domain plugin exposes its
namespaced orchestration and owned skills, but the manager routes only through packs marked
active in state and installs no unrelated external provider. Removing the last active pack
in the domain may uninstall the domain plugin after preview; otherwise its reference count
keeps it installed.

The existing `repository-to-implementation-plan` pack ID is preserved. Migration from the
0.1 foundation state preserves `shared-core` and `skillset-manager`, maps the existing pack
selection to the new manifest without duplication, and proposes the new
`software-engineering` domain meta plugin in a fresh approved plan. No current managed
component is silently removed or reclassified.

### 6.2 External install strategies

`native-marketplace-plugin`:

- register the exact upstream marketplace source;
- require the marketplace entry to resolve the plugin version to an immutable reviewed
  artifact or a documented version-to-commit attestation;
- verify marketplace ID, source, resolved version, and reviewed commit before installation;
- install the exact upstream plugin ID;
- verify installed version, source, and artifact identity after installation;
- treat a moving marketplace entry without immutable artifact proof as discovery-only and
  install the reviewed subset through `pinned-git-subdir` instead.

`pinned-git-subdir`:

- publish a marketplace entry whose source is the upstream Git URL, subdirectory,
  reviewed ref, and immutable commit SHA;
- declare only the reviewed skill paths;
- use `strict: false` only with an explicit skills allowlist;
- preserve upstream homepage, author, and license notices;
- never vendor upstream files into this repository.

`owned`:

- use a repository-local plugin only when no eligible external provider satisfies the
  capability;
- document the rejected alternatives and gap;
- apply Apache-2.0 and the full owned-skill evaluation contract.

Manual copying, `curl | sh`, unmanaged global skill copying, and unpinned branch-only
sources are not eligible for Recommended or Domain Full.

## 7. Market Research and Source Governance

### 7.1 Discovery tiers

- Tier A: Anthropic-owned content and vendor-owned first-party integration or skill
  repositories.
- Tier B: actively maintained original-author specialist marketplaces and skill libraries.
- Tier C: large aggregators used only to discover original sources.
- Tier D: individual or early community repositories requiring full manual review.

An entry in Anthropic's official directory inherits neither Anthropic ownership nor Tier A;
the original provider is classified separately. Tier changes discovery priority only. It
does not bypass the hard gates.

### 7.2 Hard gates

A provider is ineligible when any of these are unresolved:

- no identifiable original repository;
- no usable license decision for the selected paths;
- mutable source without a reviewed commit SHA;
- marketplace name/source conflict;
- hidden bootstrap, remote script execution, or undeclared binary installation;
- hooks, MCP servers, commands, or scripts whose permissions cannot be bounded;
- secrets requested outside a documented integration flow;
- incompatible Claude Code or platform requirements;
- duplicate or generated content with no demonstrated outcome value;
- missing removal or update strategy;
- failed semantic or install smoke test.

### 7.3 Scoring

Eligible providers receive a reproducible score:

- outcome fit and domain depth: 40;
- security, permissions, and install transparency: 20;
- maintenance, versioning, and updateability: 15;
- native Claude Code installability: 15;
- documentation, examples, and evaluation evidence: 10.

Decision bands:

- 80-100: `trusted`;
- 65-79: `community`, never default-installed without acknowledgement;
- below 65: rejected.

Stars and download counts are discovery signals only and never add trust points.

The score never grants `verified`. In private v1, `verified` is reserved for repository-owned
providers whose exact release artifact passes the owned-plugin release pipeline. Eligible
external providers can be at most `trusted`, including Anthropic-listed and original-author
marketplace plugins. `blocked` applies to any provider that fails a hard gate, scores below
65, or is explicitly revoked. A pack's minimum trust requirement is evaluated against this
four-level runtime scale: `verified`, `trusted`, `community`, and `blocked`.

The satisfaction order is `verified > trusted > community > blocked`: `verified` satisfies
`verified`, `trusted`, or `community`; `trusted` satisfies `trusted` or `community`;
`community` satisfies only `community`; and `blocked` satisfies nothing. Selecting a
community provider requires acknowledgement bound to that provider ID, exact reviewed
revision, permissions, and current plan fingerprint. A previous or blanket acknowledgement
does not apply.

### 7.4 Required review record

Every reviewed candidate records:

- source ID, original repository, marketplace identity, and selected paths;
- discovery tier and discovery source;
- reviewed commit SHA and observed upstream version;
- SPDX or written license conclusion and affected paths;
- last meaningful change and maintenance assessment;
- full plugin surface: skills, commands, agents, hooks, MCP, scripts, binaries;
- requested filesystem, command, network, secret, and external-data access;
- capability coverage and linked domain/category/pack IDs;
- semantic and installation evidence;
- score breakdown;
- selected, alternate, held, or rejected decision with reasons;
- compatible update policy and next review date.

Review records are repository data. Generated reports summarize them but do not replace
them.

### 7.5 Research procedure and completion rule

Research is capability-driven rather than repository-driven. For every capability required
by an initial pack, the maintainer:

1. searches the mapped Tier A and Tier B sources and relevant native marketplaces;
2. records search terms, discovery source, observation date, candidate repository, and
   candidate path in the review queue;
3. follows aggregator results back to the original repository before evaluation;
4. reviews at least three materially distinct candidates when three exist, or records the
   evidence that fewer were found;
5. evaluates the full selected plugin surface, not only its `SKILL.md` description;
6. selects the highest-scoring eligible provider that fits the pack, records eligible
   alternates, and records why close alternatives were held or rejected;
7. creates an owned gap skill only after the search record demonstrates that no eligible
   external provider covers the capability.

A capability's market review is complete only when it has a selected eligible provider or
an approved owned-gap decision, its required review record is complete, and its selected
revision passes install and semantic smoke tests. Every selected external provider is
rechecked against upstream within 30 days of the private RC. The RC records the observation
date and upstream head separately from the immutable reviewed revision; upstream drift does
not silently change the selected revision.

Every discovery run also writes an immutable `research/snapshots/<date>-<source>.json`
record containing the canonical source and query URLs, UTC observation time, inspected ref
and commit SHA, inspected tree or marketplace paths, collection method and tool version,
reported and independently counted result totals, and a SHA-256 content hash. Review queue
and source-review records reference snapshot IDs. Generated census tables must reproduce
from these checked-in snapshots; prose counts are not the source of truth.

### 7.6 Initial discovery census

The following sources were observed on 2026-07-23 and seed the review queue. Counts are
discovery-scale indicators from repository trees or marketplace manifests, not quality
claims.

| Source | Observed scope | Initial role |
| --- | --- | --- |
| [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) | 271 marketplace entries; 30 skill files and 39 plugin manifests in the observed tree | Tier A discovery and native providers |
| [`anthropics/skills`](https://github.com/anthropics/skills) | 18 skill files and three marketplace entries; mixed licensing | Tier A, path-level license review required |
| [`obra/superpowers`](https://github.com/obra/superpowers) | 14 development workflow skills | Tier B candidate and overlap reference |
| [`wshobson/agents`](https://github.com/wshobson/agents) | 95 marketplace entries and 180 skill files | Tier B candidate source |
| [`coreyhaines31/marketingskills`](https://github.com/coreyhaines31/marketingskills) | 47 marketing skills in one plugin | Tier B marketing candidate |
| [`deanpeters/Product-Manager-Skills`](https://github.com/deanpeters/Product-Manager-Skills) | 70 product-management skills or marketplace entries | Tier B candidate; license conclusion required |
| [`daymade/claude-code-skills`](https://github.com/daymade/claude-code-skills) | 58 marketplace entries and 90 skill files | Tier B candidate source |
| [`K-Dense-AI/scientific-agent-skills`](https://github.com/K-Dense-AI/scientific-agent-skills) | 149 research, science, data, and engineering skill files | Tier B git-subdir candidate |
| [`huggingface/skills`](https://github.com/huggingface/skills) | model and Hugging Face ecosystem skills | Tier A AI candidate |
| [`Agentchengfeng/chengfeng-videocut-skills`](https://github.com/Agentchengfeng/chengfeng-videocut-skills) | two video editing workflow skills | Tier B video candidate |
| [`nexscope-ai/eCommerce-Skills`](https://github.com/nexscope-ai/eCommerce-Skills) | broad commerce skill library | Tier B commerce candidate |
| [`kepano/obsidian-skills`](https://github.com/kepano/obsidian-skills) | Obsidian knowledge workflows | Tier B knowledge candidate |
| [`alirezarezvani/claude-skills`](https://github.com/alirezarezvani/claude-skills) | 88 marketplace entries and 798 skill files | Tier B candidate source |
| [`jeremylongshore/claude-code-plugins-plus-skills`](https://github.com/jeremylongshore/claude-code-plugins-plus-skills) | 470 primary marketplace entries and 5,602 skill files | Tier C discovery only by default |
| [`ComposioHQ/awesome-claude-skills`](https://github.com/ComposioHQ/awesome-claude-skills) | 864 skill files | Tier C discovery and original-source lookup |

No source in this table is selected merely by being listed.

### 7.7 Initial domain-to-source research map

| Domain | Initial source families to audit |
| --- | --- |
| Research | Anthropic, K-Dense, alirezarezvani, Hugging Face |
| Strategy | Product-Manager-Skills, wshobson, alirezarezvani |
| Writing | Anthropic Skills, daymade, marketingskills, original sources found through Composio |
| Marketing | marketingskills, alirezarezvani, wshobson |
| Promotion | marketingskills, video sources, original PR/media providers |
| Sales | wshobson, alirezarezvani, official CRM integrations |
| Product | Product-Manager-Skills, wshobson, alirezarezvani |
| Project | Superpowers, wshobson, maintained agile workflow providers |
| Software | Anthropic official, Superpowers, wshobson, Vercel, daymade |
| DevOps | Anthropic official, wshobson, maintained delivery and operations providers |
| AI | Anthropic official, Hugging Face, K-Dense, wshobson |
| Data | Anthropic Skills, K-Dense, wshobson, official data integrations |
| Design | Anthropic Skills, daymade, maintained web/design providers |
| Video | videocut, daymade media, maintained Remotion providers |
| Documents | Anthropic Skills, daymade docs, Obsidian, official Notion providers |
| Operations | alirezarezvani, wshobson, daymade productivity providers |
| Finance | spreadsheet providers, Product-Manager-Skills finance, alirezarezvani |
| Commerce | eCommerce-Skills, official commerce integrations, specialist providers |
| People | Product-Manager-Skills career, leadership, and HR specialist providers |
| Legal | compliance/governance providers, official security integrations, specialist sources |

## 8. Trust, Conflicts, and Provider Selection

Each capability declares one preferred provider and zero or more alternates. A conflict
group defines whether providers are mutually exclusive, redundant, or composable.

Selection order:

1. an already installed compatible trusted provider;
2. the pack's trusted preferred provider;
3. a trusted platform-specific alternate;
4. an acknowledged community provider;
5. no provider, which keeps the pack from stable resolution.

Setup never installs two mutually exclusive providers automatically. It explains the
choice and exposes alternatives in Advanced. Provider changes during update require a
new full preview and approval.

## 9. Install State and Lifecycle

### 9.1 State model

The atomic state file expands to record:

- schema and catalog fingerprints;
- SHA-256 of the normalized confirmed goal, domains, level, pack IDs, and provider choices;
- exact marketplace identities and reviewed source revisions;
- exact approved operations and receipts;
- installed-plugin ownership and reference counts by pack;
- platform and compatible Claude Code version;
- interrupted operation and safe resume cursor;
- no secrets, raw probes, raw model output, or unrestricted paths.

### 9.2 Idempotency and resume

- an identical successful operation is skipped;
- a compatible installed provider is reused;
- an interrupted plan resumes only when catalog fingerprint, source identity, platform,
  and prior approval still match;
- a changed operation invalidates approval and requires a new preview;
- partial success is preserved and failed dependents are skipped;
- independent approved operations may continue after a failure.

### 9.3 Update

`/skillset-manager:update`:

1. reads current state and catalog;
2. detects source, version, trust, and compatibility changes;
3. automatically discovers compatible Tier A/B candidate updates;
4. runs static and semantic update gates;
5. presents exact additions, removals, provider changes, commands, and rollback limits;
6. applies only after approval;
7. updates state atomically and runs doctor.

Automatic discovery does not mean silent installation. Community updates and provider
changes always require explicit acknowledgement.

### 9.4 Removal

`/skillset-manager:remove` supports pack, domain, and all-managed scopes. It computes
reverse dependencies and reference counts, preserves plugins still owned by another
installed pack, previews exact uninstall and marketplace-removal commands, and requires
final approval. It never removes an unmanaged plugin.

### 9.5 Doctor

Doctor verifies:

- marketplace name/source pairs;
- installed versions and reviewed revisions;
- required and optional tools;
- pack and capability closure;
- state receipts and shared dependency ownership;
- stale, missing, blocked, or unmanaged components;
- safe repair suggestions without executing repairs.

## 10. Cross-Platform Contract

Private v1 targets macOS, Linux, and Windows.

- catalog paths use logical user-home locations and generate platform-specific paths;
- Unix state operations use bounded `mkdir`, permissions, same-directory temporary files,
  and atomic rename;
- Windows state operations use bounded PowerShell commands, user-profile ACL assumptions
  validated by tests, same-directory temporary files, and atomic replacement. First writes
  use .NET `FileMode.CreateNew`, flush, and same-volume `File.Move`; replacements use
  `File.Replace` with a backup. Sharing violations receive three bounded retries, and a
  remaining failure preserves the prior state and reports the retained temporary file;
- executable detection uses `command -v --` on Unix and `Get-Command` on Windows;
- no plan mixes platform command families;
- unsupported provider platforms are filtered before preview;
- platform-specific commands are literal manifest-derived templates with token safety
  validation.

## 11. Repository Architecture

```text
manifests/
  catalog.yaml         canonical ordered IDs and approved replacement edges
  domains/             20 domain manifests
  categories/          detailed category manifests
  capabilities/        provider-neutral capability contracts
  packs/               40+ outcome-pack manifests
  external-sources/    installable upstream source contracts
  source-reviews/      immutable review decisions
  conflicts/           provider conflict and priority rules
  plugins/             owned plugin manifests

research/
  snapshots/           immutable discovery inputs, counts, and content hashes

plugins/
  shared-core/
  skillset-manager/
  domains/             20 domain meta plugins

src/
  recommend/           intent result validation and deterministic resolution
  research/            source snapshot, review, score, and update checks
  lifecycle/           install, resume, update, remove, ownership, and platform plans
  generate/            marketplace, indexes, reports, and localized docs

generated/
  install-index.json
  catalog.ko.md
  catalog.en.md
  source-audit.md
  trust-report.md
  coverage-report.md
```

New schemas cover categories, capabilities, source reviews, conflict groups, recommendation
results, platform operations, and lifecycle state. All generated artifacts remain sorted,
deterministic, and checked into the repository when they are user-facing release evidence.

## 12. Documentation Experience

Before public staging, the exact candidate SHA already contains this README first
viewport so the same-SHA release checks can evaluate the complete public surface:

1. project name and unofficial-project notice;
2. two install commands;
3. the Recommended setup command;
4. three short role examples showing goal-to-domain recommendation;
5. links to the 20-domain table, trust report, privacy, licenses, and removal.

The README does not force users through architecture documentation before installation.
Korean is the default README, and the English README is independently edited rather than
machine-translated. Domain pages show outcomes, packs, tools, providers, trust, examples,
and non-use cases. Pack pages show inputs, outputs, workflow, completion criteria,
permissions, providers, alternatives, and evaluation status.

## 13. Error Handling

- Unknown intent: ask one goal question; execute nothing.
- Ambiguous domains: show up to three candidates and the 20-domain correction list.
- Required tool absent: block the affected pack; do not substitute an undeclared tool.
- Optional tool absent: omit the optional provider and disclose reduced capability.
- Source drift or same-name conflict: block registration and installation.
- License or trust downgrade: remove the provider from new plans and flag installed drift.
- Provider conflict: choose no provider until the declared priority or user choice resolves
  it.
- Partial failure: persist receipts, skip dependents, continue independent operations,
  and offer resume.
- Update regression: keep the current compatible revision and report the failed candidate.
- Removal failure: preserve ownership records and never claim full removal.

## 14. Verification Strategy

### 14.1 Deterministic gates

- schema, identity, referential, cycle, semver, source-path, token-safety, and generated
  equality tests;
- exact 20-domain and complete initial-pack assertions;
- canonical catalog equality plus category-to-capability-to-pack reachability assertions;
- no orphan category, capability, pack, provider, review, or conflict-group assertions;
- source-review hard-gate and score reproduction tests;
- recommendation fixtures for all 20 domains and cross-domain ambiguity;
- provider priority, installed-provider reuse, conflict, and no-provider tests;
- Essential, Recommended, Domain Full, Advanced, and Full Catalog plan tests;
- Unix and Windows operation token and ordering tests;
- install, resume, update, removal, reference-count, and doctor tests;
- sanitizer projection and independent upload-verifier tests;
- Claude marketplace and owned-plugin validation.

### 14.2 Semantic gates

- every owned skill has at least three normal and two boundary cases;
- each initial outcome pack has end-to-end input/output and refusal cases;
- routing covers every domain, multi-domain goals, vague goals, adversarial user text,
  urgency, false prior approval, and prompt-injected catalog data;
- setup covers default Recommended, Essential, Domain Full, Advanced, Full Catalog,
  refusal, stale state, source conflict, provider conflict, and cross-platform previews;
- update, remove, and doctor receive equivalent normal and boundary suites;
- strict case-specific judge schemas and corrected `claude -p <prompt>` invocation remain
  mandatory.

### 14.3 Lifecycle E2E

CI uses macOS, Linux, and Windows jobs for deterministic generation and local-marketplace
install/update/remove smoke tests. A private manual semantic RC uses subscription-authenticated
Claude Code and uploads only allowlisted count/boolean/ID summaries. A clean-user test uses
the GitHub `main` marketplace and proves:

1. marketplace registration;
2. manager and dependency installation;
3. goal-to-domain recommendation;
4. consented detection;
5. preview and refusal;
6. approved install and doctor;
7. idempotent rerun;
8. compatible update;
9. pack/domain removal;
10. clean final state.

The required clean-user matrix is:

- macOS arm64: the complete subscription-authenticated flow above against private GitHub
  `main`;
- Linux x64 and Windows x64: clean-home private-GitHub marketplace registration, manager
  installation, manifest-derived preview fixture, approved plugin installation, doctor,
  idempotent update, domain removal, and clean final state;
- all rows: Claude Code version, platform, catalog fingerprint, source identities,
  operation IDs, pass/fail booleans, and counts are projected into an allowlisted receipt.

Each receipt has a SHA-256 digest and, when produced by CI, a GitHub artifact attestation.
Raw prompts, model responses, usernames, home paths, tokens, cookies, command output, and
environment values are rejected by the independent sanitizer verifier. The release manifest
references the exact receipt digests and workflow or manual-run identity.

## 15. Release Gates

The complete private v1 is achieved only when:

- all 20 domains and the complete detailed category taxonomy are present;
- all 40 initial packs are stable or have an explicitly approved replacement with equal
  coverage;
- every stable category and pack has eligible provider coverage;
- selected upstream providers have current review records and immutable source identity;
- every owned skill and lifecycle workflow passes its semantic suite;
- macOS, Linux, and Windows deterministic and lifecycle contracts pass;
- clean-copy generation and Claude plugin validation pass;
- the GitHub-main clean-user journey passes;
- Korean and English documentation matches generated runtime data;
- an independent whole-branch review reports zero Critical and zero Important findings;
- the verified changes are merged into private `main`;
- GitHub visibility remains PRIVATE.

A replacement is equal only when its manifest declares `replacesPackIds`, covers a superset
of every replaced pack's required category and capability IDs, preserves or strengthens
trust and platform support, and maps every replaced normal, boundary, and refusal case to a
passing equivalent evaluation. The canonical catalog records the approved edge, reviewer,
and decision reference; a renamed pack without this evidence does not satisfy the gate.

No smaller foundation, sample domain, draft taxonomy, green unit suite, or successful local
install is sufficient evidence for this goal.

## 16. Delivery Decomposition

The implementation remains one complete-v1 goal but is delivered through reviewable
phases:

1. schemas, coverage rules, resolver, lifecycle contracts, and research pipeline;
2. full taxonomy and 40 pack manifests;
3. market census, source reviews, provider selection, and conflict map;
4. shared manager UX and cross-platform lifecycle implementation;
5. domain meta plugins and owned gap skills in four five-domain waves;
6. generated marketplace, catalogs, trust, coverage, and bilingual documentation;
7. semantic corpus and three-platform lifecycle E2E;
8. private clean-candidate CI and whole-branch review, approved public staging,
   immediate branch protection, same-SHA private-credential RC, unauthenticated
   clean-user installation, and only then the release tag and announcement.

The operational order and rollback contract are defined in
`docs/release/github-free-staged-public.md`.

Each phase may use separate implementation plans and commits, but the repository is not
called complete until every release gate in Section 15 is proven.

## 17. Approved Decisions

- Keep the original 20 domains and complete scope.
- Keep categories detailed but hide them from default onboarding.
- Recommend one to three domains from the user's natural-language goal and require
  confirmation.
- Default to purpose-relevant Recommended installation.
- Provide Domain Full, Advanced, and guarded Full Catalog options.
- Use a federated provider model: native upstream marketplace first, pinned git-subdir
  subset second, owned gap skill last.
- Do not copy external code into this repository.
- Treat official sources as high-priority discovery, not automatic trust.
- Require final approval before any registration, install, update, or removal command.
- Support macOS, Linux, and Windows in complete private v1.
- Keep the GitHub repository private until a separate publication approval.
