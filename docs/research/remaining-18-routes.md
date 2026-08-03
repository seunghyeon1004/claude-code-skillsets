# Remaining 18 Domain Routes

Status: research-only, not install eligibility. This report does not activate any
domain, candidate, or one of the 40 draft outcome packs.

## Scope and decision rule

- Source of truth: the pinned 272-entry
  [`claude-plugins-official` manifest](https://raw.githubusercontent.com/anthropics/claude-plugins-official/e3e378cbbb205673a5d7254ded32679cafa6179d/.claude-plugin/marketplace.json),
  commit `e3e378cbbb205673a5d7254ded32679cafa6179d`, SHA-256
  `64b111d8c1716c062a285ed63eade42f56e2e79ac95859a994d586f573a20e5e`.
- Scope: the 18 domain profiles other than `research-and-intelligence` and
  `software-engineering`. Every official description was searched; a route uses
  at most two plugins.
- `direct` means the pinned listing says the capability. `inferred` means the
  listed operation can reasonably support it but does not promise the complete
  capability. `unsupported` means the listing does not establish it. Inference
  never closes a broad-profile coverage gap by itself.
- Every official-listing-only candidate below retains these preview disclosures:
  `permissions=unknown`, `license=unknown`, `trust=unknown`,
  `dependencies=unknown`, `individualSafetyReview=not-complete`, and
  `reviewedVersionVerification=unavailable`. Under the current broker policy,
  those unknown sensitive fields are disclosed rather than automatically
  disqualifying; a known hold/block still wins. This report supplies capability
  research only, not compatibility, runtime, or install approval.
- A relative marketplace source such as `./external_plugins/asana` has no
  upstream SHA in the listing. Its evidence pin is therefore the marketplace
  commit plus JSON pointer, not an asserted upstream revision.

## Result

`currentBroadProfileImmediatelyClaimable: []`

None of the remaining 18 end-to-end profiles is fully supported by at most two
official listing descriptions. Several pairs are useful scoped products, but
calling them the current broad domain would overclaim. The smallest useful,
honest refinement for each domain is recorded below; applying one would still
require a manifest decision, generated evidence, compatibility attestation, and
normal approval gates.

## Machine-actionable route assessment

```yaml
schemaVersion: 1
marketplaceCommit: e3e378cbbb205673a5d7254ded32679cafa6179d
currentBroadProfileImmediatelyClaimable: []
profileRefinementRequired:
  - strategy-and-decision
  - writing-and-publishing
  - marketing-and-growth
  - promotion-and-distribution
  - sales-and-customer
  - product-management
  - project-management
  - devops-and-security
  - ai-agents-and-automation
  - data-and-analytics
  - design-and-brand
  - video-and-audio
  - documents-and-knowledge
  - business-operations
  - finance-and-accounting
  - commerce
  - people-and-training
  - legal-risk-and-compliance
externalSourceReviewRequiredToPreserveCurrentBroadProfile:
  - strategy-and-decision
  - writing-and-publishing
  - marketing-and-growth
  - promotion-and-distribution
  - sales-and-customer
  - product-management
  - project-management
  - devops-and-security
  - ai-agents-and-automation
  - data-and-analytics
  - design-and-brand
  - video-and-audio
  - documents-and-knowledge
  - business-operations
  - finance-and-accounting
  - commerce
  - people-and-training
  - legal-risk-and-compliance
domains:
  - id: strategy-and-decision
    officialRoute: [off-30, off-158]
    direct: []
    inferred: [problem-framing, decision-records, execution-strategy, risk-analysis, strategy-review]
    unsupported: [goals-and-metrics, opportunity-assessment, business-models, scenario-planning, strategy-prioritization]
    smallestHonestProfile: "Structures and visualizes startup cloud architecture, cost, security, and migration decisions in Miro."
    externalReview: ext-alirezarezvani

  - id: writing-and-publishing
    officialRoute: [off-213, off-157]
    direct: [technical-writing, cms-publishing]
    inferred: [long-form-writing, editing]
    unsupported: [ideation, outlining, blogs, newsletters, business-writing, copywriting, proofreading, citation-verification, translation, localization]
    smallestHonestProfile: "Authors and maintains structured Sanity content and Mintlify technical documentation."
    externalReview: ext-coreyhaines31

  - id: marketing-and-growth
    officialRoute: [off-185, off-260]
    direct: [measurement]
    inferred: []
    unsupported: [icp, personas, positioning, messaging, offers, offer-pricing, content-strategy, seo, email, lifecycle, funnels, cro, paid-acquisition, customer-retention]
    smallestHonestProfile: "Measures experiments and marketing performance across PostHog and connected business data sources."
    externalReview: ext-coreyhaines31

  - id: promotion-and-distribution
    officialRoute: [off-186, off-234]
    direct: [social-distribution, campaign-operations, performance-feedback]
    inferred: [launch-promotion, channel-adaptation, content-repurposing]
    unsupported: [pr, media-pitching, influencer-work, community, outreach]
    smallestHonestProfile: "Schedules and distributes social media and operates Spotify ad campaigns with reporting."
    externalReview: ext-coreyhaines31

  - id: sales-and-customer
    officialRoute: [off-14, off-161]
    direct: [lead-discovery, crm]
    inferred: [account-research, qualification, discovery]
    unsupported: [proposals, rfps, demos, negotiation, customer-onboarding, support, customer-health, renewal, expansion, voc]
    smallestHonestProfile: "Runs B2B prospecting, outreach sequences, CRM pipeline updates, deal briefings, and forecasts."
    externalReview: ext-alirezarezvani

  - id: product-management
    officialRoute: [off-13, off-138]
    direct: [problem-discovery, product-experiments]
    inferred: [user-needs, scope, product-prioritization, roadmaps, product-metrics, launch-readiness]
    unsupported: [product-principles, prds, user-stories, prototype-validation]
    smallestHonestProfile: "Connects Amplitude opportunity, experiment, and user insights to Linear issue and project tracking."
    externalReview: ext-alirezarezvani

  - id: project-management
    officialRoute: [off-17, off-20]
    direct: [status-reporting]
    inferred: [project-definition, work-breakdown, project-resources, decisions, change, stakeholder-communication]
    unsupported: [estimation, schedules, dependencies, meetings, risk, retrospectives]
    smallestHonestProfile: "Coordinates tasks, issues, assignments, sprints, project documents, and progress across Asana and Atlassian."
    externalReview: ext-alirezarezvani

  - id: devops-and-security
    officialRoute: [off-24, off-42]
    direct: [ci-cd, security-incident-response, application-security]
    inferred: [deployment]
    unsupported: [development-environments, containers, iac, cloud, rollback, observability, sre, secrets, dependency-security, threat-modeling, recovery]
    smallestHonestProfile: "Operates Buildkite pipeline, migration, and preflight workflows with AWS incident, UAT, vulnerability-scan, and penetration-test assistance."
    externalReview: ext-wshobson

  - id: ai-agents-and-automation
    officialRoute: [off-23, off-160]
    direct: [tool-calls, memory, evaluation, monitoring]
    inferred: [single-agents, guardrails]
    unsupported: [use-case-fit, model-selection, prompting, context, rag, mcp, multi-agent-systems, cost, latency]
    smallestHonestProfile: "Builds and operates AWS agents with tools, memory, policies, evaluation, tracing, and iterative validation."
    externalReview: ext-alirezarezvani

  - id: data-and-analytics
    officialRoute: [off-80, off-19]
    direct: [quality, transformation, sql, exploratory-analysis, governance]
    inferred: [collection, cleaning]
    unsupported: [statistics, data-experiments, kpis, forecasting, segmentation, visualization, dashboards, reporting]
    smallestHonestProfile: "Builds governed GCP data pipelines and dbt/Spark/BigQuery SQL workflows with catalog, lineage, glossary, and quality support."
    externalReview: ext-wshobson

  - id: design-and-brand
    officialRoute: [off-104, off-43]
    direct: [brand, creative, developer-handoff]
    inferred: [ui, design-systems, prototypes, web-design, visual-identity]
    unsupported: [briefs, ux-research-application, information-architecture, user-flows, wireframes, design-accessibility]
    smallestHonestProfile: "Creates, edits, reviews, resizes, and brand-checks Canva assets and translates existing Figma components and tokens into code."
    externalReview: ext-wshobson

  - id: video-and-audio
    officialRoute: [off-210, off-125]
    direct: [motion-graphics, captions, repurposing, export]
    inferred: [concepts, thumbnails]
    unsupported: [video-research, scripts, storyboards, shot-lists, recording-preparation, rough-cuts, fine-editing, voice-cleanup, mixing, music, sound-effects, quality-control]
    smallestHonestProfile: "Generates video, image, and audio assets and renders HTML/GSAP compositions with captions, voiceovers, and website-to-video capture."
    externalReview: ext-chengfeng

  - id: documents-and-knowledge
    officialRoute: [off-169, off-44]
    direct: [documents, spreadsheets, presentations, pdfs, templates, knowledge-bases, search]
    inferred: [conversion, tables, notes, sop-documentation, classification]
    unsupported: [ocr, charts, meeting-records, archiving]
    smallestHonestProfile: "Creates and searches Notion operational knowledge and generates templated DOCX, XLSX, PPTX, HTML, Markdown, and PDF outputs."
    externalReview: ext-anthropic-skills

  - id: business-operations
    officialRoute: [off-6, off-265]
    direct: [repetitive-work-automation]
    inferred: [processes, handoffs, operations-resources, operational-metrics, changes]
    unsupported: [sops, service-operations, operations-quality, procurement, vendors, issues, emergency-response]
    smallestHonestProfile: "Maintains shared operational records and human-agent views in Airtable and executes approved cross-app Zapier actions."
    externalReview: ext-alirezarezvani

  - id: finance-and-accounting
    officialRoute: [off-7, off-47]
    direct: [cash-flow, invoicing, management-reporting]
    inferred: [costs, profitability, fundraising]
    unsupported: [budgets, receipts, collections, bookkeeping-assistance, financial-statements, forecasts, unit-economics, tax-preparation]
    smallestHonestProfile: "Orchestrates Airwallex invoices, suppliers, and cash-position checks and prepares Carta investor performance, regulatory, and AGM reporting."
    externalReview: ext-alirezarezvani

  - id: commerce
    officialRoute: [off-226, off-260]
    direct: [stores, revenue-analysis]
    inferred: [catalogs, listings, inventory, orders]
    unsupported: [product-research, product-planning, commerce-pricing, merchandising, marketplaces, shipping, returns, promotions, reviews]
    smallestHonestProfile: "Supports Shopify development and CLI store management and queries connected ecommerce and revenue data."
    externalReview: ext-nexscope

  - id: people-and-training
    officialRoute: [off-135, off-6]
    direct: [learning-materials]
    inferred: [workforce-planning, roles, candidates, curricula]
    unsupported: [job-descriptions, interviews, hiring-evaluation, employee-onboarding, people-performance, feedback, careers, organizational-policy, assessment]
    smallestHonestProfile: "Builds personalized Coursera learning paths and maintains shared structured HR records in Airtable."
    externalReview: ext-alirezarezvani

  - id: legal-risk-and-compliance
    officialRoute: [off-137, off-255]
    direct: [contract-review-assistance]
    inferred: [compliance-checklists, risk-registers, audit-evidence]
    unsupported: [legal-research-assistance, contract-drafting-assistance, policies, privacy, intellectual-property, regulatory-mapping, compliance-incident-response, records-retention, deletion]
    smallestHonestProfile: "Triages document clauses and legal risks for attorney escalation and uses Vanta test-specific intelligence to remediate compliance failures."
    externalReview: ext-alirezarezvani
```

## Official listing evidence

Each excerpt below is exact text from the pinned marketplace entry. `pin` is the
entry's upstream SHA when present; `marketplace-only` means the relative source
is pinned only by the marketplace commit and pointer.

| Ref | Index / pointer | Pin | Exact listing excerpt |
|---|---:|---|---|
| `off-6` Airtable | 6 `/plugins/6` | `812ee67f1fd3d76fb45ff8df40afaa0448602ba8` | "database and operations layer for your agents — whether running product, marketing, sales, ops, HR"; "structured data with multiplayer visual surfaces"; "sync integrations" |
| `off-7` Airwallex AgentOS | 7 `/plugins/7` | `b0bd2c3d65da47e39db8c779501119376d91c431` | "set up invoices from a PO, onboard suppliers from invoices, and check current cash position across currencies" |
| `off-13` Amplitude | 13 `/plugins/13` | `05ce0a91cbf3188f1512e324bd9663cc0e23f34a` | "discover product opportunities, analyze charts, create dashboards, manage experiments, and understand users and accounts" |
| `off-14` Apollo | 14 `/plugins/14` | `2adde980e45f421b7e9383d92870455627936bce` | "Prospect, enrich leads, load outreach sequences, and query sales analytics" |
| `off-17` Asana | 17 `/plugins/17` | marketplace-only `./external_plugins/asana` | "Create and manage tasks, search projects, update assignments, track progress" |
| `off-19` Atlan | 19 `/plugins/19` | `86bb1ad27f80e189b328333d2271b360ae579f2b` | "Search, explore, govern, and manage your data assets"; "lineage traversal, glossary management, data quality rules" |
| `off-20` Atlassian | 20 `/plugins/20` | `f22e7075136a62baa7c10200a64884f83bf3ebe1` | "Search and create issues, access documentation, manage sprints" |
| `off-23` AWS Agents | 23 `/plugins/23` | `851e0346e51c10afc96f1fb1c167a8a55134df79` | "Build, deploy, and operate AI agents on AWS"; "connecting tools, memory, policies, evaluation, debugging, and production hardening" |
| `off-24` AWS Agents for DevSecOps | 24 `/plugins/24` | `08025af3d27a1eb7c18fe06bf451df8b110e9e0e` | "Investigate incidents, review code and execute UAT for release readiness, scan code for vulnerabilities, and run penetration tests" |
| `off-30` AWS Startup Advisor | 30 `/plugins/30` | `084d44e1dedab244c938a2eb37bd613a9643b223` | "Personalized architecture, cost, security, and migration guidance for startups"; "cost optimization" |
| `off-42` Buildkite | 42 `/plugins/42` | `5bbd53d496b9dd5cd7b3e0a2d8345daa333c3f4e` | "pipelines, migration, preflight, agent runtime, CLI, and API" |
| `off-43` Canva | 43 `/plugins/43` | `b56291ea0a36d0a941e1478b47959be5f1771dee` | "Create, edit, review, resize, and brand-check Canva designs" |
| `off-44` Carbone | 44 `/plugins/44` | `52cd97e4ff35490440c066822739e466fab47901` | "complete templating language reference"; "all output formats (DOCX, XLSX, PPTX, ODT, HTML, Markdown, PDF)" |
| `off-47` Carta Investors | 47 `/plugins/47` | `a6c97d0e25b6c559adb905dd4a6d11ce478aec86` | "querying investor data, performance benchmarks, regulatory reporting, AGM deck generation, brand extraction" |
| `off-80` Data Agent Kit | 80 `/plugins/80` | `b5d4964a1fa82ca2f67faa16ee808265aa3a0cb6` | "architect complex data pipelines, transform data with dbt, write Spark and BigQuery SQL notebooks, and orchestrate end-to-end workflows" |
| `off-104` Figma | 104 `/plugins/104` | `07316dd2920d61303ca0e52812b31f5f341e7b15` | "extract component information, read design tokens, and translate designs into code" |
| `off-125` HyperFrames | 125 `/plugins/125` | `c39f3cf924bb5109bfc0b36f3d7b99a4cb397322` | "Write HTML, render video"; "animations, captions, voiceovers, audio-reactive visuals, and website-to-video capture" |
| `off-135` Learn with Coursera | 135 `/plugins/135` | `ac28fd6ebf8584e3ee196159bd6d4514fa07de0f` | "delivers the right next step — a course, hands-on project, short video, or live roleplay — then maps a path forward" |
| `off-137` LegalZoom | 137 `/plugins/137` | `f9fd8a0ca6e1421bc1aacb113a109663a7a6f6d8` | "document review identifies critical risks and important clauses, advises when to engage an attorney" |
| `off-138` Linear | 138 `/plugins/138` | marketplace-only `./external_plugins/linear` | "Create issues, manage projects, update statuses, search across workspaces" |
| `off-157` Mintlify | 157 `/plugins/157` | `acd6d2e0128c4f235d55cfb8d8c91ecbdd5df8cc` | "Convert non-markdown files into properly formatted MDX pages, add and modify content"; "automate documentation updates" |
| `off-158` Miro | 158 `/plugins/158` | `85c2c7347542b3ce185eb1d2793f8d79ad485c63` | "read board context, create diagrams, and generate code" |
| `off-160` MLflow | 160 `/plugins/160` | `c33bb3d303a2c6113bbaed6dbfe756e88e80f1df` | "tracing, evaluating, and improving AI agents"; "instrument → trace → evaluate → iterate → validate" |
| `off-161` monday CRM | 161 `/plugins/161` | `fc64cf88c2fd9e3081f70fa8bbfb6d2bbee809a8` | "Build a pipeline"; "ranked deal briefing"; "forecast dashboard"; "turn meeting notes into deal updates" |
| `off-169` Notion | 169 `/plugins/169` | `9847f2aa1a15f25df35ed1fb7b4557dbb60cd651` | "Search pages, create and update documents, manage databases, and access your team's knowledge base" |
| `off-185` PostHog | 185 `/plugins/185` | `00579b8a86d9caecbda117b1b3999858f785c3dd` | "analytics, feature flags, experiments, error tracking, and insights" |
| `off-186` Postiz | 186 `/plugins/186` | `41c5a9dbd6b2776863e7c05c22e7a385c208321c` | "scheduling posts, managing integrations, uploading media, and tracking analytics across 28+ platforms" |
| `off-210` Runway API | 210 `/plugins/210` | `16353db3500ea5e346460755205991081567902a` | "Generate videos, images, and audio"; "batch ad campaigns, product videos, multishot stories, and creative iteration" |
| `off-213` Sanity | 213 `/plugins/213` | `af54474c21b00aee8e2fa2855b8ff6ef8a0cf41c` | "Query and author content"; "design schemas, and set up Visual Editing" |
| `off-226` Shopify AI Toolkit | 226 `/plugins/226` | `556811e94dd45c795abe5c0b1bf6b5a4b098149d` | "API schema access, GraphQL and Liquid code validation, Hydrogen storefronts, Polaris UI extensions, store management via CLI" |
| `off-234` Spotify Ads API | 234 `/plugins/234` | `1421ab69a67f8b0d48d96cdbe277a4a1a92b8d10` | "Create campaigns, ad sets, ads, pull reports, and handle OAuth" |
| `off-255` Vanta | 255 `/plugins/255` | `345d86b55faa649e955b7ea5569cf52d8425c2d5` | "test-specific remediation intelligence"; "fix compliance failures faster" |
| `off-260` Windsor.ai | 260 `/plugins/260` | `8a4fed5425bd43f6f57f4543d7acfc0593616846` | "Query marketing, sales, CRM, ecommerce, finance, and analytics data from Google Ads, Meta, HubSpot, Salesforce, Shopify, Stripe" |
| `off-265` Zapier | 265 `/plugins/265` | `217d65a980f9b75536babf89ba64bf03ad95beea` | "Connect 8,000+ apps"; "Discover, enable, and execute Zapier actions" |

## External sources requiring source review

These are discovery leads, not approved install candidates. The commit and
license observations are pinned so the review queue has a deterministic input.
The license does not bypass permission, dependency, hook/script/MCP, ownership,
maintenance, compatibility, and effectiveness review.

| Ref | Repository / commit | License at commit | Likely relevant paths to review | Domains |
|---|---|---|---|---|
| `ext-alirezarezvani` | [`alirezarezvani/claude-skills@aa8d778`](https://github.com/alirezarezvani/claude-skills/tree/aa8d778811a557a2c28ccadda4cf3d0bd028a4cc) | [MIT](https://github.com/alirezarezvani/claude-skills/blob/aa8d778811a557a2c28ccadda4cf3d0bd028a4cc/LICENSE) | `c-level-advisor/c-level-agents/skills/{brief,cross-eval,decide,execute}/SKILL.md`; `business-growth/skills/{contract-and-proposal-writer,customer-success-manager,revenue-operations,sales-engineer}/SKILL.md`; `product-team/skills/{product-discovery,product-manager-toolkit,product-strategist,roadmap-communicator}/SKILL.md`; `project-management/skills/{pm-skills,senior-pm,scrum-master,team-communications}/SKILL.md`; `engineering/skills/{agent-designer,agent-workflow-designer,mcp-server-builder,rag-architect,self-eval}/SKILL.md`; `business-operations/skills/{process-mapper,procurement-optimizer,vendor-management}/SKILL.md`; `finance/skills/{finance-skills,financial-analyst,saas-metrics-coach}/SKILL.md`; `c-level-advisor/skills/{chro-advisor,culture-architect,general-counsel-advisor}/SKILL.md`; `compliance-os/skills/{compliance-readiness,gdpr-audit-prep,iso27001-audit-prep,soc2-audit-prep}/SKILL.md` | strategy, sales, product, project, AI agents, business operations, finance, people, legal/compliance |
| `ext-coreyhaines31` | [`coreyhaines31/marketingskills@c21a984`](https://github.com/coreyhaines31/marketingskills/tree/c21a984a56da10fb6085e6334f6f60929220a4da) | [MIT](https://github.com/coreyhaines31/marketingskills/blob/c21a984a56da10fb6085e6334f6f60929220a4da/LICENSE) | `skills/{customer-research,product-marketing,offers,pricing,content-strategy,copywriting,copy-editing,seo-audit,emails,cro,ads,churn-prevention,analytics}/SKILL.md`; `skills/{launch,social,public-relations,influencer-marketing,community-marketing,cold-email,video}/SKILL.md` | writing, marketing, promotion |
| `ext-wshobson` | [`wshobson/agents@c4b82b0`](https://github.com/wshobson/agents/tree/c4b82b0ad771190355eb8e204b1329732a18449a) | [MIT](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/LICENSE) | `plugins/cicd-automation/skills/{deployment-pipeline-design,github-actions-templates,secrets-management}/SKILL.md`; `plugins/incident-response/skills/{incident-runbook-templates,on-call-handoff-patterns,postmortem-writing}/SKILL.md`; `plugins/security-scanning/skills/{attack-tree-construction,sast-configuration,security-requirement-extraction}/SKILL.md`; `plugins/data-engineering/skills/{data-quality-frameworks,dbt-transformation-patterns,spark-optimization}/SKILL.md`; `plugins/business-analytics/skills/{data-storytelling,kpi-dashboard-design}/SKILL.md`; `plugins/ui-design/skills/{accessibility-compliance,design-system-patterns,interaction-design,visual-design-foundations}/SKILL.md` | DevOps/security, data/analytics, design |
| `ext-chengfeng` | [`Agentchengfeng/chengfeng-videocut-skills@e2cc73d`](https://github.com/Agentchengfeng/chengfeng-videocut-skills/tree/e2cc73dce613c0701b3e02dc4a7c2f5f567ad7b3) | [Apache-2.0](https://github.com/Agentchengfeng/chengfeng-videocut-skills/blob/e2cc73dce613c0701b3e02dc4a7c2f5f567ad7b3/LICENSE) | `plugins/chengfeng-videocut/skills/{cut-talking-head,finish-talking-head}/SKILL.md` | video editing only; not the full video/audio profile |
| `ext-anthropic-skills` | [`anthropics/skills@1f630fd`](https://github.com/anthropics/skills/tree/1f630fdf9259cec4a14913127dfd7c3b69ef72eb) | mixed/path-level; no root license conclusion in the pinned census | `skills/{docx,pdf,pptx,xlsx}/SKILL.md` and each referenced `LICENSE.txt`/script surface | documents/knowledge |
| `ext-nexscope` | [`nexscope-ai/eCommerce-Skills@56f3288`](https://github.com/nexscope-ai/eCommerce-Skills/tree/56f3288dd1ba3ae7cae43d369115a915229e510b) | [MIT](https://github.com/nexscope-ai/eCommerce-Skills/blob/56f3288dd1ba3ae7cae43d369115a915229e510b/LICENSE) | `dropshipping-product-research/SKILL.md`; `competitive-pricing-strategy/SKILL.md`; `product-description-generator/SKILL.md`; `inventory-tracking-software/SKILL.md`; `ecommerce-{returns-management,shipping-rates}/SKILL.md`; `product-review-analysis/SKILL.md`; `shopify-{analytics-guide,inventory-management}/SKILL.md` | commerce |

`deanpeters/Product-Manager-Skills@99710188c134acf590a02c0e4ee1f431e60004cf`
was also inspected, but its pinned root license is
[CC BY-NC-SA 4.0](https://github.com/deanpeters/Product-Manager-Skills/blob/99710188c134acf590a02c0e4ee1f431e60004cf/LICENSE).
It is therefore not a default candidate for a marketplace that may be used
commercially; do not use it to bypass the product-route review above.

## Priorities and blockers

1. **Official scoped-route priority:** documents, sales, design, product,
   project, DevOps, AI agents, data, promotion, finance, operations, and legal
   have useful official pairs after the recorded profile refinement. They are
   not current-profile claims.
2. **External review priority:** review `coreyhaines31/marketingskills` for the
   writing/marketing/promotion cluster, `alirezarezvani/claude-skills` for the
   strategy/sales/product/project/AI/operations/finance/people/compliance
   cluster, `wshobson/agents` for DevOps/data/design, and
   `nexscope-ai/eCommerce-Skills` for commerce. Review only the listed paths and
   their transitive executable/configuration surface, not entire repositories by
   popularity.
3. **Persistent capability blockers:** full video post-production still lacks
   evidence for scripts through QC and audio finishing; broad legal lacks legal
   research, privacy/IP, and record lifecycle; people lacks hiring/performance
   and assessment; broad finance lacks bookkeeping/statements/tax; broad
   documents lacks OCR/meeting capture/archive. These require more primary-source
   discovery even after the named external reviews.
4. **UX implication:** a user may still choose one broad domain, but the broker
   must install only an evidence-complete scoped route and disclose omitted
   capabilities. It must not silently treat the 40 draft outcome packs or
   `inferred` rows as active coverage.
