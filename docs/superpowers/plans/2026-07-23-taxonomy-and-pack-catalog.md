# Complete v1 Taxonomy and Pack Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use a fresh implementer and independent reviewer for each task. Do not start P03/P04 provider research from this plan.

**Goal:** Make the approved 20-domain taxonomy, detailed categories, provider-neutral capabilities, and all 40 initial outcome packs a canonical, machine-verifiable draft catalog while preserving the working foundation runtime until one atomic loader switch.

**Architecture:** Version-2 YAML under `manifests/` becomes the only complete-v1 source of truth. A side-by-side `CompleteV1Repository` loader consumes the exact P01 validators, then a pure graph validator proves identity, ownership, reachability, scenario, replacement, runtime-bundle, and migration invariants. All new entities remain `draft`, so the current v1 generator stays byte-identical until the final task switches repository loading atomically and deliberately filters draft v2 data from foundation publication.

**Tech Stack:** Node.js 22+, TypeScript 7.0.2, Ajv 8.20.0, YAML 2.9.0, Vitest 4.1.10, JSON Schema draft 2020-12.

## Fixed Scope

- Consume `COMPLETE_V1_DOMAIN_IDS`, `COMPLETE_V1_PACK_IDS`, all taxonomy types, and all public validators from P01.
- Preserve the exact order of the 20 domains and 40 initial pack IDs. Renames or omissions are failures.
- Create exactly one category collection and one capability collection per domain.
- A category has exactly one owning domain. A capability is declared once by its owner and may reference only categories owned by that same domain.
- Every category must be reachable from a pack through a required or recommended capability. Optional-only reachability does not count.
- Every pack must have at least one normal, one boundary, and one refusal scenario reference, matching the closed P01 pack schema. High-impact packs make the refusal case domain-specific rather than relying on a generic refusal fixture.
- Every new pack stays `draft`; P02 does not select, install, copy, or promote external providers.
- A pack is a logical activation unit, not a plugin. `runtimeBundle` identifies its future domain meta plugin; `ownedSkillIds` remains empty unless a later reviewed owned-gap decision supplies an ID.
- Replacement approval is objective: the edge names superseded IDs and proves category, capability, platform/trust, and evaluation coverage is equal or stronger.
- Preserve `shared-core`, `skillset-manager`, and the existing `repository-to-implementation-plan` selection. No current managed component is silently removed, duplicated, or reclassified.
- Every task starts with a red test, ends with focused tests plus `npm run check`, and uses a DCO-signed commit.

## Canonical Domain, Category, and Pack Matrix

The category text below is canonicalized to lowercase kebab-case in the listed order. These lists are minimum v1 coverage and may only be extended through an explicit reviewed catalog change.

| Wave | Domain ID | Ordered category IDs | Initial pack IDs |
| --- | --- | --- | --- |
| 1 | `research-and-intelligence` | `source-discovery`, `web-research`, `academic-research`, `patent-research`, `market-research`, `competitive-intelligence`, `customer-research`, `interview-analysis`, `trend-detection`, `fact-checking`, `source-evaluation`, `evidence-synthesis` | `question-to-cited-research-brief`, `competitor-landscape-to-opportunity-map`, `customer-interviews-to-insights` |
| 1 | `strategy-and-decision` | `problem-framing`, `goals-and-metrics`, `opportunity-assessment`, `business-models`, `scenario-planning`, `strategy-prioritization`, `decision-records`, `execution-strategy`, `risk-analysis`, `strategy-review` | `evidence-to-strategic-decision` |
| 1 | `writing-and-publishing` | `ideation`, `outlining`, `long-form-writing`, `blogs`, `newsletters`, `technical-writing`, `business-writing`, `copywriting`, `editing`, `proofreading`, `citation-verification`, `translation`, `localization`, `cms-publishing` | `idea-to-edited-article`, `source-to-multilingual-publication` |
| 1 | `marketing-and-growth` | `icp`, `personas`, `positioning`, `messaging`, `offers`, `offer-pricing`, `content-strategy`, `seo`, `email`, `lifecycle`, `funnels`, `cro`, `paid-acquisition`, `customer-retention`, `measurement` | `product-to-positioning-and-offer`, `keyword-to-ranked-content` |
| 1 | `promotion-and-distribution` | `launch-promotion`, `social-distribution`, `channel-adaptation`, `content-repurposing`, `pr`, `media-pitching`, `influencer-work`, `community`, `outreach`, `campaign-operations`, `performance-feedback` | `launch-plan-to-multichannel-campaign`, `long-form-to-social-distribution` |
| 2 | `sales-and-customer` | `account-research`, `lead-discovery`, `qualification`, `discovery`, `proposals`, `rfps`, `demos`, `crm`, `negotiation`, `customer-onboarding`, `support`, `customer-health`, `renewal`, `expansion`, `voc` | `account-research-to-personalized-outreach`, `discovery-call-to-proposal` |
| 2 | `product-management` | `problem-discovery`, `user-needs`, `product-principles`, `prds`, `user-stories`, `scope`, `product-prioritization`, `roadmaps`, `prototype-validation`, `product-experiments`, `product-metrics`, `launch-readiness` | `customer-problem-to-validated-prd`, `prd-to-prioritized-roadmap` |
| 2 | `project-management` | `project-definition`, `work-breakdown`, `estimation`, `schedules`, `dependencies`, `project-resources`, `meetings`, `status-reporting`, `decisions`, `change`, `risk`, `stakeholder-communication`, `retrospectives` | `project-brief-to-execution-board` |
| 2 | `software-engineering` | `repository-context`, `requirements`, `specifications`, `architecture`, `frontend`, `backend`, `mobile`, `apis`, `databases`, `testing`, `debugging`, `review`, `refactoring`, `software-performance`, `software-accessibility`, `documentation`, `release-readiness` | `repository-to-implementation-plan`, `spec-to-tested-feature`, `bug-report-to-verified-fix` |
| 2 | `devops-and-security` | `development-environments`, `ci-cd`, `containers`, `iac`, `cloud`, `deployment`, `rollback`, `observability`, `sre`, `security-incident-response`, `secrets`, `dependency-security`, `application-security`, `threat-modeling`, `recovery` | `service-to-ci-cd-deployment`, `incident-alert-to-postmortem`, `application-to-security-review` |
| 3 | `ai-agents-and-automation` | `use-case-fit`, `model-selection`, `prompting`, `context`, `rag`, `mcp`, `tool-calls`, `single-agents`, `multi-agent-systems`, `memory`, `evaluation`, `guardrails`, `cost`, `latency`, `monitoring` | `use-case-to-agent-design`, `prototype-to-evaluated-agent` |
| 3 | `data-and-analytics` | `collection`, `quality`, `cleaning`, `transformation`, `sql`, `exploratory-analysis`, `statistics`, `data-experiments`, `kpis`, `forecasting`, `segmentation`, `visualization`, `dashboards`, `reporting`, `governance` | `raw-data-to-validated-dataset`, `business-question-to-dashboard` |
| 3 | `design-and-brand` | `briefs`, `ux-research-application`, `information-architecture`, `user-flows`, `wireframes`, `ui`, `design-systems`, `prototypes`, `web-design`, `brand`, `visual-identity`, `creative`, `design-accessibility`, `developer-handoff` | `brief-to-accessible-interface`, `brand-strategy-to-visual-system` |
| 3 | `video-and-audio` | `video-research`, `concepts`, `scripts`, `storyboards`, `shot-lists`, `recording-preparation`, `rough-cuts`, `fine-editing`, `motion-graphics`, `captions`, `voice-cleanup`, `mixing`, `music`, `sound-effects`, `thumbnails`, `repurposing`, `quality-control`, `export` | `topic-to-recording-ready-script`, `raw-footage-to-published-video`, `long-video-to-multiplatform-clips` |
| 3 | `documents-and-knowledge` | `documents`, `spreadsheets`, `presentations`, `pdfs`, `templates`, `conversion`, `ocr`, `tables`, `charts`, `meeting-records`, `notes`, `knowledge-bases`, `search`, `sop-documentation`, `classification`, `archiving` | `meeting-to-decisions-and-actions`, `source-files-to-polished-document` |
| 4 | `business-operations` | `processes`, `sops`, `repetitive-work-automation`, `handoffs`, `service-operations`, `operations-quality`, `procurement`, `vendors`, `operations-resources`, `operational-metrics`, `issues`, `changes`, `emergency-response` | `manual-process-to-maintained-sop`, `repetitive-work-to-approved-automation` |
| 4 | `finance-and-accounting` | `budgets`, `cash-flow`, `costs`, `receipts`, `invoicing`, `collections`, `bookkeeping-assistance`, `financial-statements`, `forecasts`, `unit-economics`, `profitability`, `fundraising`, `tax-preparation`, `management-reporting` | `transactions-to-management-report` |
| 4 | `commerce` | `product-research`, `product-planning`, `catalogs`, `listings`, `commerce-pricing`, `merchandising`, `stores`, `marketplaces`, `inventory`, `orders`, `shipping`, `returns`, `promotions`, `reviews`, `revenue-analysis` | `product-idea-to-store-listing` |
| 4 | `people-and-training` | `workforce-planning`, `roles`, `job-descriptions`, `candidates`, `interviews`, `hiring-evaluation`, `employee-onboarding`, `people-performance`, `feedback`, `careers`, `organizational-policy`, `curricula`, `learning-materials`, `assessment` | `role-need-to-interview-scorecard`, `expertise-to-training-program` |
| 4 | `legal-risk-and-compliance` | `legal-research-assistance`, `contract-drafting-assistance`, `contract-review-assistance`, `policies`, `privacy`, `intellectual-property`, `regulatory-mapping`, `compliance-checklists`, `risk-registers`, `audit-evidence`, `compliance-incident-response`, `records-retention`, `deletion` | `contract-to-risk-and-revision-brief`, `regulation-to-compliance-checklist` |

Wave totals are fixed at 10, 11, 11, and 8 packs. The IDs in this table already resolve source-label collisions and are the exact globally unique category IDs. The committed red exact-set fixture must equal this table and prevents silent renaming.

## Target File Structure

```text
manifests/catalog.yaml                           complete-v1 canonical identity contract
manifests/complete-v1-domains/*.yaml             20 isolated domain manifests
manifests/categories/*.yaml                      20 category collections
manifests/capabilities/*.yaml                    20 capability collections
manifests/complete-v1-packs/*.yaml                40 v2 pack manifests
manifests/migrations/foundation-0.1-to-v2.yaml   explicit selection/bundle migration
tests/fixtures/catalog/v2/expected-identities.json
tests/fixtures/catalog/v2/expected-coverage.json
tests/fixtures/catalog/v2/foundation-state.json
tests/evaluations/packs/<pack-id>/{normal,boundary,refusal}.yaml
src/manifest/complete-v1-repository.ts
src/catalog/validate-graph.ts
src/catalog/replacement-equivalence.ts
src/catalog/foundation-migration.ts
tests/unit/complete-v1-repository.test.ts
tests/unit/complete-v1-graph.test.ts
tests/unit/replacement-equivalence.test.ts
tests/unit/foundation-migration.test.ts
tests/integration/complete-v1-catalog.test.ts
```

## Task 1: Close P01 Contract Gaps Needed by P02

**Files:** modify `src/model/complete-v1.ts`, `schemas/v2/catalog.schema.json`, `schemas/v2/pack.schema.json`, `src/contracts/complete-v1.ts`, and their P01 tests/fixtures.

- [ ] Add a red test requiring `CatalogContract.capabilityIds` and a closed `ReplacementEdge` with `requiredCategoryIds`, `requiredCapabilityIds`, `requiredPlatforms`, `minimumTrust`, and `evaluationRefs`.
- [ ] Add a red test rejecting the same capability ID across required/recommended/optional lists and rejecting duplicate replacement proof IDs. Cross-field runtime-bundle ownership remains a Task 11 graph rule.
- [ ] Implement the smallest closed schema/type changes. Keep recommendation, provider, lifecycle, and release contracts unchanged.
- [ ] Run `npm test -- tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: define catalog equivalence contracts"`.

## Task 2: Add the Side-by-Side Complete-v1 Repository Loader

**Files:** create `manifests/catalog.yaml`, `tests/fixtures/catalog/v2/expected-identities.json`, `tests/fixtures/catalog/v2/expected-coverage.json`, `src/manifest/complete-v1-repository.ts`, `src/catalog/validate-graph.ts`, `tests/unit/complete-v1-repository.test.ts`, `tests/unit/complete-v1-graph.test.ts`, `tests/integration/complete-v1-catalog.test.ts`, and minimal loader fixtures.

- [ ] Write failing tests for deterministic directory order, YAML parse failures with repository-relative paths, schema failures, missing directories, duplicate collection domain IDs, and duplicate manifest IDs.
- [ ] Commit the complete canonical identity contract before wave data: exact ordered 20 domain IDs, the 281 category IDs in this plan, a reviewed exact provider-neutral capability-ID set with category coverage mapping, exact ordered 40 pack IDs, and zero initial replacements. The two JSON fixtures independently repeat the expected identity and coverage sets so tests do not derive expected values from the file under test.
- [ ] Define `CompleteV1Repository` with `catalog`, legacy-compatible isolated `domains`, `categoryCollections`, `capabilityCollections`, and v2 `packs`. Read the catalog from `manifests/catalog.yaml`, domains only from `manifests/complete-v1-domains`, category/capability collections from their new directories, and v2 packs only from `manifests/complete-v1-packs`. Validate all v2 documents with P01 public validators and isolated domains with the existing closed domain validator.
- [ ] Create the graph validator and integration suite now, before taxonomy waves use them. The initial red/green implementation checks exact catalog-to-loaded identity equality, collection ownership, duplicate IDs, and unknown references; later tasks extend the same files with reachability, scenarios, bundles, replacements, and migration rules.
- [ ] Keep `loadManifestRepository()` unchanged. All loader/graph tests before Task 12 use synthetic complete fixture roots or explicit wave-slice repositories, so the deliberately incomplete production v2 directories do not masquerade as a valid full graph. Prove the new loader does not read providers, reviews, conflicts, runtime state, or generated output.
- [ ] Run `npm test -- tests/unit/complete-v1-repository.test.ts tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: load complete v1 catalog manifests"`.

## Tasks 3-6: Materialize the Four Category and Capability Waves

Each task creates five isolated legacy-compatible `manifests/complete-v1-domains/<domain-id>.yaml` files, five matching category collections, and five capability collections conforming to the exact identity/coverage fixtures from Task 2. The existing `manifests/domains/software-engineering.yaml` file stays byte-identical throughout P02; its complete category set comes from the isolated v2 collection rather than its legacy `categories` field. Use the matrix above as the ordered source. A capability ID is provider-neutral and outcome-oriented; declare it once in its owning domain. Do not create one mechanical capability per category when a single observable capability legitimately covers several related categories.

### Task 3: Wave 1 Taxonomy

- [ ] Red-test the exact wave-1 domain/category IDs and unique ownership.
- [ ] Add Research and Intelligence; Strategy and Decision; Writing and Publishing; Marketing and Growth; Promotion and Distribution.
- [ ] Prove every wave-1 category is covered by at least one declared wave-1 capability.
- [ ] Run `npm test -- tests/unit/complete-v1-repository.test.ts tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: add complete v1 taxonomy wave one"`.

### Task 4: Wave 2 Taxonomy

- [ ] Repeat the red/green contract for Sales and Customer; Product Management; Project Management; Software Engineering; DevOps and Security.
- [ ] Reuse cross-domain capabilities by owner reference; do not duplicate them.
- [ ] Run `npm test -- tests/unit/complete-v1-repository.test.ts tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: add complete v1 taxonomy wave two"`.

### Task 5: Wave 3 Taxonomy

- [ ] Repeat for AI, Agents, and Automation; Data and Analytics; Design and Brand; Video and Audio; Documents and Knowledge.
- [ ] Add collision tests for globally repeated source labels before choosing prefixed stable IDs.
- [ ] Run `npm test -- tests/unit/complete-v1-repository.test.ts tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: add complete v1 taxonomy wave three"`.

### Task 6: Wave 4 Taxonomy

- [ ] Repeat for Business Operations; Finance and Accounting; Commerce; People and Training; Legal, Risk, and Compliance.
- [ ] Mark human-review boundaries in localized outcomes for finance, HR, and legal capabilities without embedding executable policy.
- [ ] Assert the final category and capability sets equal the committed exact fixtures and contain no orphan or duplicate IDs.
- [ ] Run `npm test -- tests/unit/complete-v1-repository.test.ts tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: add complete v1 taxonomy wave four"`.

## Tasks 7-10: Materialize All 40 Draft Packs

For each wave, first add a failing exact pack-ID test. Every manifest declares localized outcome, non-empty inputs/outputs/completion criteria, owning domain, category IDs, required/recommended/optional capability IDs, `runtimeBundle: <domain-id>`, empty `ownedSkillIds`, all supported platforms, a minimum trust tier, semantic version, `draft` status, and committed scenario paths. Scenario files in P02 are structured specifications only; semantic execution belongs to P09/P11.

### Task 7: Pack Wave 1 (10)

- [ ] Add exactly the 10 packs owned by the first five matrix rows.
- [ ] Add normal, boundary, and refusal scenario specs for every pack; make research-claim and consequential-strategy refusals domain-specific.
- [ ] Assert all required/recommended capability references resolve and every wave-1 category is reachable.
- [ ] Run `npm test -- tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: add complete v1 pack wave one"`.

### Task 8: Pack Wave 2 (11)

- [ ] Add exactly the 11 packs owned by matrix rows 6-10, preserving `repository-to-implementation-plan`.
- [ ] Add normal, boundary, and refusal scenarios for every pack, with domain-specific refusal coverage for security-sensitive packs.
- [ ] Store the new v2 pack under `manifests/complete-v1-packs` and prove it does not duplicate or replace the existing v1 foundation manifest during the side-by-side stage.
- [ ] Run `npm test -- tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: add complete v1 pack wave two"`.

### Task 9: Pack Wave 3 (11)

- [ ] Add exactly the 11 packs owned by matrix rows 11-15.
- [ ] Add all three scenario classes for every pack, explicit accessibility completion criteria for interface/document/video outputs, and domain-specific refusals for unsafe autonomous-agent requests.
- [ ] Run `npm test -- tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: add complete v1 pack wave three"`.

### Task 10: Pack Wave 4 (8)

- [ ] Add exactly the 8 packs owned by matrix rows 16-20.
- [ ] Add all three scenario classes for every pack and qualified-human refusal scenarios for finance, hiring, contract, and regulatory outcomes.
- [ ] Assert exact cumulative wave counts `[10, 11, 11, 8]`, exact ordered equality with `COMPLETE_V1_PACK_IDS`, and no unapproved replacement.
- [ ] Run `npm test -- tests/unit/complete-v1-graph.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: add complete v1 pack wave four"`.

## Task 11: Prove the Complete Catalog Graph, Bundles, Replacements, and Migration

**Files:** extend `src/catalog/validate-graph.ts` and `tests/unit/complete-v1-graph.test.ts`; create `src/catalog/replacement-equivalence.ts`, `src/catalog/foundation-migration.ts`, their unit tests, `manifests/migrations/foundation-0.1-to-v2.yaml`, and fixtures.

- [ ] Write red table tests for unknown category/capability/scenario IDs, wrong ownership, orphan categories/capabilities/packs, optional-only reachability, duplicate edges, cycles, missing scenario paths, wrong wave totals, runtime-bundle mismatch, undeclared owned skills, and invalid replacements.
- [ ] Implement a pure deterministic graph validator. Sort diagnostics by repository-relative manifest path and field path.
- [ ] Implement replacement equivalence as set containment: a replacement covers every superseded required category and capability, supports a platform superset, meets or exceeds trust, and references normal/boundary/refusal evidence for every evaluation class present on the superseded pack. Equality is computed, never accepted from a boolean assertion.
- [ ] Require bidirectional consistency: every catalog replacement edge equals the replacement pack's `replacesPackIds`, and every non-empty pack `replacesPackIds` has exactly one matching catalog edge with the same superseded set and proof obligations.
- [ ] Define bundle ownership as `runtimeBundle === domainId`; expose pack-to-bundle and bundle-to-active-pack indexes. Reference counts count active pack IDs, not installed provider rows. `ownedSkillIds` must be unique and namespaced to the owning domain.
- [ ] Add an explicit foundation migration fixture mapping the current `repository-to-implementation-plan` selection to the v2 pack ID, retaining `shared-core` and `skillset-manager`, proposing `software-engineering` only in a future approved operation, and never silently deleting the old state.
- [ ] Prove idempotence, first-pack bundle count `0 -> 1`, same-domain reuse, non-last removal retention, last-pack removal eligibility, and rollback to the untouched v1 state on migration validation failure.
- [ ] Run `npm test -- tests/unit/complete-v1-graph.test.ts tests/unit/replacement-equivalence.test.ts tests/unit/foundation-migration.test.ts tests/integration/complete-v1-catalog.test.ts`, then `npm run check` and `bash tests/e2e/clean-copy.sh`.
- [ ] Commit with `git commit -s -m "feat: validate complete v1 catalog graph"`.

## Task 12: Switch the Production Loader Atomically and Close P02

**Files:** modify `src/manifest/repository.ts`, `src/generate/all.ts`, `src/cli.ts`, relevant integration tests, this plan, and the master roadmap. Do not change installed manager behavior or publish v2 draft data.

- [x] Capture hashes of the five current generated artifacts and write a failing integration test for the intended atomic repository view.
- [x] Introduce one repository boundary that loads v1 foundation data plus the validated complete-v1 draft catalog. Validate the full v2 graph before returning either view; never partially return a subset after a v2 failure.
- [x] Keep foundation generation byte-identical by filtering all `draft` v2 domains/packs from marketplace and install-index publication. Do not hide validation failures through that filter.
- [x] Inject malformed v2 fixtures and prove `validate`/`generate` fail before any artifact write. Reuse the existing publication rollback tests for write-time failures.
- [x] Run `npm run check`, `bash tests/e2e/clean-copy.sh`, and `git diff --check`. Confirm exact 20 domains, exact category fixture, exact capability fixture, exact 40 packs, wave totals, no orphans, all scenario paths, and foundation output hashes.
- [x] Request an independent P02 spec review. Block P03/P04 on any Critical or Important finding and fix all findings before recording completion.
- [x] Update the P02 roadmap row with commit range, test count, clean-copy result, and review result.
- [x] Commit with `git commit -s -m "feat: activate complete v1 catalog validation"`.

## P02 Exit Evidence

P02 is complete only when all of the following are true:

- the canonical catalog equals the exact P01 domain/pack constants and committed category/capability fixtures;
- one category and capability collection exists for each of the 20 domains;
- all 40 initial packs exist in waves 10/11/11/8 and remain draft;
- every category, capability, pack, scenario, bundle, and replacement edge passes the deterministic graph validator;
- the foundation migration is explicit, idempotent, reversible before approval, and does not duplicate `repository-to-implementation-plan`;
- the production loader rejects any invalid v2 subset atomically while current generated artifacts remain byte-identical;
- full checks and clean-copy validation pass from the committed head;
- an independent reviewer reports zero Critical and zero Important findings.

P02 does not prove provider eligibility, onboarding resolution, lifecycle execution, domain-plugin implementation, semantic quality, cross-platform installation, or private-release readiness. Those gates remain in P03-P12.

**Completion record:** PASS; the private development baseline and commit range are not published. `npm run check`
passed 350/350 tests, committed clean-copy validation passed, all five foundation artifact
hashes remained byte-identical, and the independent exit review reported zero Critical and
zero Important findings.
