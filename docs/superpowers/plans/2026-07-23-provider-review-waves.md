# Provider Review Waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the P03 discovery substrate into a complete, auditable provider decision set for every capability required or recommended by the 40 initial packs, using four fixed five-domain research waves and isolated trial evidence only.

**Architecture:** P04 keeps the P02 catalog provider-neutral and uses P03's immutable snapshots, source configs, receipts, queue, evidence, review, governance, freshness, conflict, and owned-gap contracts as the durable decision graph. It adds capability-and-platform provider-selection manifests, a 147-capability coverage validator, structured provider semantic cases, and a research-only Claude trial harness. P04 proves static eligibility plus isolated evidence on the current trial platform; it records compatible selected/alternate candidates for every pack platform but deliberately leaves the three-OS release proof to P11. P05 consumes the selection/conflict inputs; P06/P08 own production lifecycle and user-facing setup, so P04 must not create user state, onboarding prompts, or persistent user/global installs.

**Tech Stack:** Node.js 22+, TypeScript 7.0.2, Vitest 4.1.10, Ajv 8.20.0, YAML 2.9.0, `tsx` 4.23.1, Git, and Claude Code 2.1.198+ (`claude plugin marketplace`, `claude plugin install`, `claude plugin eval`) on macOS/Linux/Windows test runners. P04 never uses `claude --plugin-dir` as an installation or semantic-evaluation path.

## Global Constraints

- Keep the GitHub repository private. Do not push, merge to `main`, publish a marketplace, or make any public release during P04.
- P04 starts only after the P02 and P03 PASS gates; retain P03's exact 15-source census and its immutable hashes. The private development baselines are not published.
- The exact review inventory is 20 domains, 281 categories, 147 capabilities, 40 packs, and 120 pack scenarios. All 147 capabilities are pack-referenced: 101 are required by at least one pack and 46 are recommended-only; optional-only count is zero. Fixed wave loads are W1 `33` (`26` required + `7` recommended-only), W2 `38` (`23 + 15`), W3 `40` (`32 + 8`), and W4 `36` (`20 + 16`).
- Use exactly these four ownership waves: W1 Research/Strategy/Writing/Marketing/Promotion; W2 Sales/Product/Project/Software/DevOps; W3 AI/Data/Design/Video/Documents; W4 Operations/Finance/Commerce/People/Legal.
- Research is capability-driven. Every capability required by an initial pack ends with exactly one capability-level `selected` eligible external provider or one approved `owned-gap`; every recommended capability receives explicit `selected`, `alternate`, `rejected`, or `owned-gap` disposition and may be non-default only when no eligible default is selected.
- Use at least three materially distinct candidates when three exist. When fewer exist, bind immutable `search-evidence` to the search record; a Tier C/D result is only discovery until the original source is independently reviewed.
- Never copy or vendor upstream implementation into this repository. Commit only closed reviewed manifests, source metadata, immutable snapshots/receipts, sanitized evidence artifacts, hashes, and tests.
- External providers can be at most `trusted`; `verified` remains repository-owned only. A failed, missing, stale, revoked, or unresolved hard gate makes an external provider ineligible regardless of discovery tier.
- Reproduce all 11 hard gates and all 15 weighted criteria already defined in `src/model/complete-v1.ts`. Scores are derived, never manually trusted: 40 outcome fit/depth, 20 security/transparency, 15 maintenance/updateability, 15 native installability, and 10 documentation/evaluation; `trusted` is 80-100, `community` is 65-79, and below 65 is `blocked`.
- Source identity is an immutable triad of a named `ResearchSourceConfig`, `ResearchCollectionReceipt`, and `ResearchSnapshot`. `ResearchSourceConfig.ownerWave` is immutable and one of `1`, `2`, `3`, or `4`; one canonical upstream repository has one source owner and one owner wave, even when later waves reuse it. A source config may be reused for later immutable review snapshots, but each snapshot and receipt is owned exactly once and no two source configs may name the same canonical repository. The owner wave is the lowest numbered fixed worklist that first names its source ID; a direct original discovery takes the wave that first records it.
- A candidate may be discovered from a P03 census snapshot or from an immutable review-source discovery snapshot. Do not turn either discovery record into a selection without a review-source triad at the reviewed commit and a candidate whose discovery source, original repository, path, and revision attest exactly.
- P04 trial execution is strictly disposable research. A useful candidate skill can be installed automatically only into fresh temporary `HOME`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PLUGIN_CACHE_DIR`, `TMPDIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` roots plus a fresh project directory. Every Claude marketplace/plugin operation uses `--scope local` inside that disposable project; the harness records install, semantic, and removal outcomes and deletes every disposable root before returning. It never promotes a trialled skill to the real project or user environment.
- Do not invoke `claude plugin marketplace add`, `claude plugin install`, `claude plugin uninstall`, or `claude plugin marketplace remove` against the real user/project configuration. P04 does not implement `/skillset-manager:setup`, state writes, update/resume, doctor, or removal workflows. Those belong to P05/P06/P08.
- No persistent real-project, project, or user/global installation is permitted without a later exact preview and final approval in the production lifecycle workflow. The P04 trial runner must reject a caller-provided home/config/project path and reject `user` and `project` scope before spawning Claude; it permits `local` only inside the generated temporary project and deletes the local settings with that project.
- P04 records two distinct platform facts. `SourceReviewManifest.compatibility.platforms` and `ProviderManifest.platforms` are static declared compatibility claims that must exactly agree. Each `ProviderTrialReceipt.platform` is one observed isolated run. A P04 capability/platform selection is valid only when its one preferred provider and every eligible fallback declare that platform, but a non-current platform is `releaseEvidence: "pending-p11"` until P11 supplies its own isolated install/semantic/remove trial.
- Every complete-v1 pack declares `darwin`, `linux`, and `win32`; P04 therefore proves a three-platform candidate matrix, not a three-platform release. On the current platform it requires passed trial evidence for every cell's `preferredProviderId`, whether that provider's cell role is `selected` or `alternate`. Darwin evidence never proves Linux/Windows. P11 must convert every `pending-p11` cell needed by the final resolver into three-OS release evidence before any pack becomes stable.
- Keep `ReviewEvidence.platforms` as the exact static review compatibility set for P03 invariants. Add `trialPlatform?: Platform` only to `install-smoke`, `semantic-smoke`, and lifecycle trial evidence; its receipt must name that single platform and it must be a member of the static set. This avoids falsely treating a one-platform receipt as a three-platform ReviewEvidence declaration.
- Keep raw web-search responses, auth material, prompt transcripts, tokens, absolute temporary paths, and unsanitized logs untracked. Semantic workflows may exist only in the ignored `research/private/semantic-fixtures/` directory during a trial; committed semantic cases retain only fixture/prompt SHA-256 values and structured assertions. Evidence artifacts are closed, non-secret JSON records below `research/evidence/artifacts/` and must match their committed SHA-256.
- Every implementation task follows red-green-refactor TDD, ends with focused verification and a DCO-signed commit. Do not use paid xAI APIs, Hermes `xai-oauth`, or xAI-backed plugins.

## Starting Point And P04 Boundary

The committed P03 graph already exposes these important interfaces:

```ts
// src/research/repository.ts
export interface ResearchRepository {
  census: ResearchCensus;
  reviewSourceIndex: ReviewSourceIndex;
  context: ResearchEvaluationContext;
  sourceConfigs: ResearchSourceConfig[];
  collectionReceipts: ResearchCollectionReceipt[];
  snapshots: ResearchSnapshot[];
  evidence: ResearchEvidence[];
  queue: ResearchQueue;
  providers: ProviderManifest[];
  sourceReviews: SourceReviewManifest[];
  conflicts: ConflictGroupManifest[];
  ownedGapDecisions: OwnedGapDecision[];
}

// src/research/governance.ts
export function evaluateResearchGovernance(
  input: ResearchGovernanceInput,
  options?: GovernanceEvaluationOptions
): GovernanceDecision;

// src/research/graph.ts
export function validateResearchGraph(
  repository: ResearchRepository,
  catalog: ResearchGraphCatalog
): ResearchRepository;
```

P04 extends the research contracts and graph only where needed to represent a complete provider decision set and to verify trial artifact content. It does not change the 20 domains, categories, provider-neutral capabilities, 40 draft packs, installed manager data, generated public artifacts, or production lifecycle state. A provider may cover several capabilities, but each capability/platform has its own role. One provider has one upstream repository owner and one review lineage per immutable revision; its source-review `decision` is the maximum role across its portfolio, not a substitute for per-capability selection.

Task 1 appends `providerSelections: ProviderSelectionManifest[]` to `ResearchRepository`; Task 3 appends `semanticCases: ProviderSemanticCase[]`. Their absence remains valid for the P03 base graph, while the P04 gate requires the complete closed data set.

## Fixed P04 Review Universe

The following pack matrix is the complete P04 universe: exactly 147 capabilities, 101 required by one or more packs and 46 recommended-only. `R` capabilities require either eligible selected external coverage or an approved owned gap. `K` capabilities require a capability-level selected/alternate/rejected/gap disposition but do not force default installation. The implementation derives this matrix from `CompletePackManifest` and rejects a checked-in data set that differs from it; the table is included so reviewers can audit the research scope without reverse-engineering YAML.

| Wave | Pack | R capability IDs | K capability IDs |
| --- | --- | --- | --- |
| 1 | `question-to-cited-research-brief` | `source-discovery-and-web-research`, `verify-sources-and-claims`, `synthesize-cited-evidence` | `academic-evidence-research`, `patent-landscape-research` |
| 1 | `competitor-landscape-to-opportunity-map` | `analyze-markets-competitors-and-trends`, `verify-sources-and-claims`, `synthesize-cited-evidence` | `source-discovery-and-web-research` |
| 1 | `customer-interviews-to-insights` | `analyze-customer-research`, `verify-sources-and-claims`, `synthesize-cited-evidence` | `source-discovery-and-web-research` |
| 1 | `evidence-to-strategic-decision` | `frame-strategic-problems-and-opportunities`, `define-strategic-goals-and-metrics`, `model-strategic-scenarios-and-risks`, `govern-strategic-decisions` | `design-business-and-execution-strategy` |
| 1 | `idea-to-edited-article` | `develop-content-ideas-and-outlines`, `draft-long-form-editorial-content`, `edit-verify-and-proofread-content` | `craft-conversion-copy` |
| 1 | `source-to-multilingual-publication` | `produce-technical-and-business-writing`, `edit-verify-and-proofread-content`, `translate-and-localize-content`, `publish-content-to-cms` | none |
| 1 | `product-to-positioning-and-offer` | `define-ideal-customers-and-personas`, `create-market-positioning-and-messaging`, `design-and-price-marketing-offers` | `retain-customers-and-measure-growth` |
| 1 | `keyword-to-ranked-content` | `plan-content-and-search-growth`, `design-and-optimize-conversion-funnels` | `operate-email-and-lifecycle-marketing`, `execute-paid-acquisition` |
| 1 | `launch-plan-to-multichannel-campaign` | `plan-launch-promotion`, `secure-earned-media-coverage`, `coordinate-influencer-and-community-promotion`, `conduct-targeted-outreach`, `operate-and-optimize-campaigns` | `adapt-repurpose-and-distribute-content` |
| 1 | `long-form-to-social-distribution` | `adapt-repurpose-and-distribute-content` | `operate-and-optimize-campaigns` |
| 2 | `account-research-to-personalized-outreach` | `research-accounts-and-discover-leads`, `qualify-opportunities-through-discovery` | `maintain-customer-relationship-records` |
| 2 | `discovery-call-to-proposal` | `create-proposals-and-rfp-responses`, `demonstrate-and-negotiate-solutions`, `onboard-and-support-customers` | `monitor-renew-and-expand-accounts`, `capture-voice-of-customer` |
| 2 | `customer-problem-to-validated-prd` | `discover-customer-problems-and-needs`, `define-product-principles-and-requirements` | `validate-products-with-prototypes-and-experiments` |
| 2 | `prd-to-prioritized-roadmap` | `shape-and-prioritize-product-scope`, `build-evidence-based-product-roadmaps` | `measure-products-and-assess-launch-readiness` |
| 2 | `project-brief-to-execution-board` | `define-and-decompose-project-work`, `estimate-and-schedule-project-work`, `coordinate-project-dependencies-and-resources`, `facilitate-meetings-and-record-decisions` | `report-project-status-to-stakeholders`, `control-project-change-and-risk`, `run-project-retrospectives` |
| 2 | `repository-to-implementation-plan` | `analyze-repository-context`, `turn-requirements-into-specifications` | `design-software-architecture` |
| 2 | `spec-to-tested-feature` | `implement-accessible-web-interfaces`, `implement-backend-services-and-apis`, `test-and-debug-software` | `implement-mobile-applications`, `design-and-evolve-databases` |
| 2 | `bug-report-to-verified-fix` | `test-and-debug-software`, `review-refactor-and-optimize-software` | `document-and-prepare-software-releases` |
| 2 | `service-to-ci-cd-deployment` | `provision-reproducible-development-environments`, `package-and-provision-cloud-infrastructure` | `automate-safe-software-delivery` |
| 2 | `incident-alert-to-postmortem` | `observe-and-operate-reliable-services` | `respond-to-security-incidents-and-recover` |
| 2 | `application-to-security-review` | `protect-secrets-and-software-dependencies` | `assess-application-threats-and-security` |
| 3 | `use-case-to-agent-design` | `assess-ai-use-cases-and-models`, `design-prompts-and-grounding-context`, `connect-models-to-tools-and-mcp`, `design-single-and-multi-agent-systems` | `optimize-ai-cost-and-latency` |
| 3 | `prototype-to-evaluated-agent` | `build-retrieval-augmented-generation`, `implement-stateful-agent-memory`, `evaluate-guard-and-monitor-ai-systems` | `connect-models-to-tools-and-mcp`, `design-single-and-multi-agent-systems`, `optimize-ai-cost-and-latency` |
| 3 | `raw-data-to-validated-dataset` | `build-data-collection-and-transformation-pipelines`, `validate-and-clean-data`, `query-and-explore-data` | `produce-governed-analytical-reports` |
| 3 | `business-question-to-dashboard` | `query-and-explore-data`, `apply-statistics-and-experimental-analysis`, `define-kpis-and-forecast-outcomes`, `segment-and-compare-populations`, `visualize-data-and-build-dashboards` | `produce-governed-analytical-reports` |
| 3 | `brief-to-accessible-interface` | `translate-briefs-and-research-into-ux-structure`, `map-and-prototype-user-experiences`, `design-accessible-user-interfaces` | `build-design-systems-and-developer-handoffs`, `design-responsive-web-experiences` |
| 3 | `brand-strategy-to-visual-system` | `define-brands-and-visual-identities`, `produce-brand-aligned-creative` | `design-accessible-user-interfaces`, `build-design-systems-and-developer-handoffs` |
| 3 | `topic-to-recording-ready-script` | `research-and-develop-media-concepts`, `write-and-visualize-video-narratives` | `plan-and-prepare-recording` |
| 3 | `raw-footage-to-published-video` | `assemble-and-refine-video-edits`, `produce-accessible-captions`, `clean-and-mix-audio`, `source-and-integrate-music-and-effects` | `create-motion-graphics-and-thumbnails`, `repurpose-and-deliver-quality-controlled-media` |
| 3 | `long-video-to-multiplatform-clips` | `assemble-and-refine-video-edits`, `produce-accessible-captions`, `repurpose-and-deliver-quality-controlled-media` | `create-motion-graphics-and-thumbnails`, `clean-and-mix-audio`, `source-and-integrate-music-and-effects` |
| 3 | `meeting-to-decisions-and-actions` | `capture-meeting-records-and-notes`, `build-and-search-knowledge-bases` | `document-standard-operating-procedures`, `author-documents-from-reusable-templates` |
| 3 | `source-files-to-polished-document` | `author-documents-from-reusable-templates`, `build-data-rich-spreadsheets`, `create-presentations`, `convert-extract-and-process-pdfs` | `build-and-search-knowledge-bases`, `document-standard-operating-procedures`, `classify-and-archive-records` |
| 4 | `manual-process-to-maintained-sop` | `map-and-standardize-operational-processes`, `design-and-coordinate-operational-handoffs`, `run-and-assure-service-operations` | `manage-procurement-vendors-and-resources`, `coordinate-emergency-operations` |
| 4 | `repetitive-work-to-approved-automation` | `automate-repetitive-operational-work`, `measure-and-improve-operations` | none |
| 4 | `transactions-to-management-report` | `process-receipts-invoices-and-collections`, `assist-bookkeeping-and-statement-preparation`, `forecast-and-report-financial-performance` | `plan-budgets-and-cash-flow`, `analyze-costs-unit-economics-and-profitability`, `prepare-fundraising-financials`, `assist-with-tax-preparation` |
| 4 | `product-idea-to-store-listing` | `research-and-plan-commerce-products`, `manage-product-catalogs-and-listings`, `optimize-pricing-and-merchandising` | `operate-stores-and-marketplaces`, `manage-inventory-orders-and-fulfillment`, `manage-post-purchase-returns-and-reviews`, `run-promotions-and-analyze-revenue` |
| 4 | `role-need-to-interview-scorecard` | `plan-workforce-and-roles`, `create-job-descriptions-and-manage-candidates`, `structure-interviews-and-hiring-evaluations` | `draft-organizational-people-policies` |
| 4 | `expertise-to-training-program` | `design-learning-programs-and-assessments` | `onboard-and-develop-employees`, `support-performance-and-feedback-cycles` |
| 4 | `contract-to-risk-and-revision-brief` | `assist-with-legal-research`, `assist-with-contract-drafting-and-review` | `assess-privacy-and-intellectual-property-risk`, `maintain-risk-registers-and-audit-evidence` |
| 4 | `regulation-to-compliance-checklist` | `maintain-legal-and-compliance-policies`, `map-regulations-to-compliance-checklists`, `maintain-risk-registers-and-audit-evidence` | `coordinate-compliance-incident-response`, `govern-records-retention-and-deletion` |

## Target File Structure

```text
src/model/complete-v1.ts                         P04 provider selection, source owner-wave, and trial receipt types
schemas/v2/provider-selection.schema.json         closed per-capability provider disposition contract
schemas/v2/research-source-config.schema.json     immutable canonical upstream owner-wave contract
schemas/v2/provider-trial-receipt.schema.json     closed sanitized isolated-trial artifact contract
schemas/v2/provider-trial-approval.schema.json    closed, non-secret one-trial approval contract
src/contracts/complete-v1.ts                      Ajv validator exports for the new receipt
src/research/coverage.ts                          pack-derived coverage and P04 exit validator
src/research/trial.ts                             disposable local-marketplace trial orchestration, auth isolation, and sanitization
src/research/trial-artifact.ts                    trial artifact parsing and evidence-kind binding
src/research/provider-semantic-grader.ts          deterministic structured semantic-result grading
src/research/graph.ts                             source-owner uniqueness and P04 graph gate
src/research/repository.ts                        typed loading/verification of trial artifacts
scripts/research/collect-github-tree.ts           explicit unique review snapshot IDs
scripts/research/run-provider-trial.ts            CLI wrapper around the disposable trial runner
scripts/research/validate-provider-waves.ts       deterministic P04 gate and coverage report CLI
research/review-queue.json                        all capability search records and dispositions
research/review-source-index.json                 census plus review source triads
research/sources/                                 one named source-config JSON per canonical upstream repository
research/receipts/                                one named immutable collection-receipt JSON per review triad
research/snapshots/                               one named immutable discovery or reviewed-source snapshot JSON per triad
research/evidence/                                named closed search/review evidence metadata
research/evidence/artifacts/                      named SHA-bound sanitized search/static/trial receipts
research/semantic-cases/                          committed digest-only semantic-case manifests
research/trial-approvals/                         committed non-secret trial-approval receipts
research/private/claude-subscription-auth.json    ignored local Claude credential fixture, never committed
manifests/complete-v1-providers/                  named reviewed selected and alternate provider YAML manifests
manifests/provider-selections/                    one named disposition YAML manifest per capability
manifests/source-reviews/                         named immutable source-review decisions
manifests/conflicts/                              named true provider-overlap conflict manifests
manifests/owned-gaps/                             named approved required-capability gaps
tests/unit/research-coverage.test.ts              complete P02 matrix and disposition rejection tests
tests/unit/research-trial.test.ts                 no-global-state, command, cleanup, and receipt tests
tests/unit/research-trial-artifact.test.ts        receipt schema/evidence-binding tests
tests/unit/research-graph.test.ts                 source ownership, P04 coverage, and triad tests
tests/unit/research-repository.test.ts            artifact content/hash/repository loading tests
tests/integration/provider-review-waves.test.ts   all four committed wave data and governance checks
tests/e2e/provider-review-clean-copy.sh           clean checkout review-gate/Claude isolation proof
docs/superpowers/plans/2026-07-23-provider-review-waves.md
docs/superpowers/plans/2026-07-23-complete-v1-master-roadmap.md
```

## Task 1: Freeze the P04 Capability Universe and Disposition Contract

**Files:** modify `src/model/complete-v1.ts`, `src/contracts/complete-v1.ts`, `src/research/repository.ts`, `tests/unit/complete-v1-contracts.test.ts`, and `tests/unit/research-queue.test.ts`; create `schemas/v2/provider-selection.schema.json`, `src/research/coverage.ts`, `tests/unit/research-coverage.test.ts`, `tests/fixtures/research/p04-capability-universe.json`, `tests/fixtures/research/p04-wave-coverage.json`, and `manifests/provider-selections/.gitkeep`.

**Interfaces:**

```ts
export type ProviderSelectionDisposition = "selected" | "alternate" | "rejected" | "owned-gap";

export interface ProviderPlatformRole {
  platform: Platform;
  preferredProviderId?: string;
  preferredRole?: "selected" | "alternate";
  eligibleAlternateProviderIds: string[];
  releaseEvidence: "trialed-p04" | "pending-p11";
}

export interface ProviderSelectionManifest {
  schemaVersion: 2;
  id: string;
  capabilityId: string;
  searchRecordId: string;
  disposition: ProviderSelectionDisposition;
  selectedProviderId?: string;
  alternateProviderIds: string[];
  terminalReviewIds: string[];
  ownedGapDecisionId?: string;
  decisionReasons: string[];
  platformRoles: ProviderPlatformRole[];
}

export interface CapabilityCoverage {
  capabilityId: string;
  requiredByPackIds: PackId[];
  recommendedByPackIds: PackId[];
}

export function buildCapabilityCoverage(
  completeV1: CompleteV1Repository
): ReadonlyMap<string, CapabilityCoverage>;

export function validateP04CapabilityCoverage(
  repository: ResearchRepository,
  completeV1: CompleteV1Repository
): readonly CapabilityCoverage[];
```

- [ ] Write red tests that build the fixture directly from the 40 P02 pack manifests and reject: an omitted required capability; a fixture count other than `147` total / `101` required / `46` recommended-only; a duplicate or unknown search record; no provider-selection manifest; duplicate selection capability; a required `alternate` or `rejected` selection; a `selected` selection without exactly one selected eligible provider; a mismatched provider capability; a missing approved owned gap; duplicate alternate IDs; a selected provider duplicated in alternates; and a recommended-only capability with no disposition.
- [ ] Write `tests/fixtures/research/p04-capability-universe.json` as 147 sorted records containing `capabilityId`, `requiredByPackIds`, and `recommendedByPackIds`; write `tests/fixtures/research/p04-wave-coverage.json` as fixed counts W1 `33/26/7`, W2 `38/23/15`, W3 `40/32/8`, W4 `36/20/16`. Expected data must be independent of `research/review-queue.json` and `manifests/provider-selections`; tests compare it to `buildCapabilityCoverage()` so a pack edit cannot silently shrink P04 scope.
- [ ] Add red platform-role tests. Every selection must contain exactly one sorted role for `darwin`, `linux`, and `win32`. Every non-gap cell has exactly one `preferredProviderId`, exactly one `preferredRole` of `selected` or `alternate`, and sorted distinct `eligibleAlternateProviderIds` that exclude the preferred provider; every named provider declares that platform. Only an `owned-gap` cell has no preferred provider/role and an empty alternate list. Reject a missing or duplicated preferred provider, a preferred provider duplicated in alternates, an external provider named for an undeclared platform, a `trialed-p04` preferred role without matching current-platform install/semantic/remove receipts and every bound structured grade, a non-current `trialed-p04` role, and any pack capability/platform closure without a preferred provider.
- [ ] Implement `ProviderSelectionManifest` and its closed schema/loader. Keep P03 construction data valid with an empty tracked `manifests/provider-selections/.gitkeep`; P04 validation requires exactly one manifest for each of the 147 fixture capability IDs and rejects a selection whose `searchRecordId` is not the exact one-capability queue record.
- [ ] Implement `buildCapabilityCoverage()` by iterating the validated complete-v1 packs in code-point order, collecting exact `requiredCapabilityIds` and `recommendedCapabilityIds`, and sorting every emitted ID. `validateP04CapabilityCoverage()` must require exactly one search record and one provider selection for every fixture capability and neither record outside it.
- [ ] Define selection semantics in code, not comments: `selected` selects exactly one stable governance-eligible external provider and may list eligible alternates; `owned-gap` binds exactly one approved `OwnedGapDecision` and no selected external provider; `alternate` is allowed only for recommended-only capabilities and names one or more governance-eligible alternates but no selected provider; `rejected` is allowed only for recommended-only capabilities and names terminal held/rejected reviews plus their search evidence. Required capabilities allow only `selected` and `owned-gap`. A non-gap platform cell always selects one operational `preferredProviderId`; `preferredRole` states whether it realizes the manifest's selected route or an eligible alternate route for that platform. The preferred provider must be governance-eligible, and every other provider in `eligibleAlternateProviderIds` is an eligible non-preferred fallback. For every external preferred role, `platformRoles` uses `trialed-p04` only for the actual receipt platform and otherwise `pending-p11`; P11 owns the transition to release evidence.
- [ ] Run `npm test -- tests/unit/complete-v1-contracts.test.ts tests/unit/research-queue.test.ts tests/unit/research-coverage.test.ts` and then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: define provider review coverage decisions"`.

## Task 2: Make Immutable Review Sources Reusable Without Duplicating Upstream Ownership

**Files:** modify `src/model/complete-v1.ts`, `schemas/v2/research-source-config.schema.json`, `src/research/graph.ts`, `src/research/queue.ts`, `src/research/repository.ts`, `src/research/source-binding.ts`, `scripts/research/collect-github-tree.ts`, every named JSON record in `research/sources/`, `tests/unit/research-graph.test.ts`, `tests/unit/research-queue.test.ts`, `tests/unit/research-repository.test.ts`, and `tests/unit/research-collector.test.ts`; modify `package.json` only to expose the collector command if it is not already reachable through `npm run research:collect`.

**Interfaces:**

```ts
export interface ReviewSourceTriad {
  sourceId: string;
  receiptId: string;
  snapshotId: string;
}

export interface ResearchSourceConfig {
  schemaVersion: 2;
  sourceId: string;
  repository: string;
  ownerWave: 1 | 2 | 3 | 4;
  queryUrls: string[];
  reportedCountClaims: Array<{ kind: SnapshotEntryKind; count: number; sourceUrl: string }>;
  markdownIndexPaths: string[];
}

// P04 fields appended to the existing SourceReviewManifest contract.
export interface ReviewedStaticProviderIdentity {
  reviewedMarketplaceEntrySha256: string;
  reviewedArtifactSha256: string;
}

export interface CollectorArguments {
  config: string;
  observedAt: string;
  snapshotId: string;
  output: string;
  receipt: string;
}

export function canonicalRepositoryIdentity(repository: string): string;
```

- [ ] Write red graph/queue tests for: two `ResearchSourceConfig` records that canonicalize to the same GitHub repository; a review triad that reuses an existing source config but has a distinct snapshot and receipt; reuse of a review snapshot or receipt; a source with no immutable `ownerWave`; a candidate attributed to a source outside its owner-wave without a reference to the owner source; a candidate/review/evidence source path not attested by the reusable triad; a direct P04 discovery snapshot not listed in the P03 census but owned by `review-source-index`; and a duplicate original repository represented by different source IDs.
- [ ] Add required `ownerWave` to every source config. Assign each of the 15 P03 census source configs to its one P04 source-owner wave in a committed exact fixture; later waves may reference a source owned by an earlier wave but may not create a second config for the same canonical repository. A newly discovered original repository receives the wave that first owns its review and cannot later change owner wave.
- [ ] Change source ownership precisely. A config has one canonical upstream repository owner and may participate in its census triad plus later review triads. A snapshot and receipt have exactly one triad owner. Preserve the P03 invariant that every source config, receipt, and snapshot is owned and that all P03 census values/hashes reproduce exactly; do not loosen source/path/revision attestation.
- [ ] Append `reviewedMarketplaceEntrySha256` and `reviewedArtifactSha256` to every P04 external `SourceReviewManifest` and its closed schema. They are authoritative SHA-256 values for the exact rendered marketplace entry and reviewed artifact at `reviewedCommit`; P04 rejects missing, malformed, or changed values before provider selection. P03 remains valid because its pre-P04 source-review data set is empty; the P04 loader/gate, not the P03 base graph, makes these fields required.
- [ ] Write red source-review tests rejecting a missing reviewed marketplace-entry/artifact digest, a digest that does not match the reviewed snapshot/tree bytes, a receipt whose installed identity differs from either digest, and a native relative source treated as immutable. Add green fixtures for an immutable remote artifact and a pinned Git-subdirectory artifact.
- [ ] Change candidate discovery validation from `discoverySnapshotId in census.snapshotIds` to `discoverySnapshotId in census.snapshotIds or reviewSourceIndex.triads`. Direct P04 discovery must still bind its entry to the candidate's repository/path and a source triad, while an aggregator discovery must still prove its original-repository follow-through; unknown or orphan review snapshots remain fatal.
- [ ] Extend the collector with required `--snapshot-id` input, validated as a kebab-case immutable ID. Preserve the existing `--config`, `--observed-at`, `--output`, and `--receipt` safety rules and atomic non-overwrite publication. The new ID lets a P04 review collect a distinct current snapshot from a P03 discovery config without fabricating a second source owner.
- [ ] Add collector tests for a P03-compatible census snapshot ID, a second review snapshot from the same source config, mismatched basename/snapshot ID, overwritten outputs, traversal, symlinked parents, and a review triad that is not reachable from its candidate/review/evidence.
- [ ] Run `npm test -- tests/unit/research-collector.test.ts tests/unit/research-repository.test.ts tests/unit/research-graph.test.ts` and then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: preserve unique upstream review sources"`.

## Task 3: Define and Validate Sanitized Isolated Trial Receipts

**Files:** modify `src/model/complete-v1.ts`, `src/contracts/complete-v1.ts`, `src/research/repository.ts`, `schemas/v2/research-evidence.schema.json`, and `.gitignore`; create `schemas/v2/provider-trial-receipt.schema.json`, `schemas/v2/provider-semantic-case.schema.json`, `schemas/v2/provider-trial-approval.schema.json`, `src/research/trial-artifact.ts`, `tests/unit/research-trial-artifact.test.ts`, `tests/fixtures/research/trials/valid-receipt.json`, `tests/fixtures/research/semantic-cases/valid-case.json`, `tests/fixtures/research/trial-approvals/valid-approval.json`, `research/semantic-cases/.gitkeep`, and `research/trial-approvals/.gitkeep`.

**Interfaces:**

```ts
export type TrialStrategy = "native-marketplace-plugin" | "pinned-git-subdir";
export type TrialStage = "install" | "semantic" | "remove";

export interface TrialCommandReceipt {
  sequence: number;
  argv: string[];
  exitCode: number;
  stdoutSha256: string;
  stderrSha256: string;
  resultSha256?: string;
}

export interface TrialStageReceipt {
  stage: TrialStage;
  commands: TrialCommandReceipt[];
  result: "passed" | "failed" | "skipped";
}

export interface InstalledProviderIdentity {
  pluginId: string;
  marketplaceId: string;
  marketplaceSource: string;
  version: string;
  reviewedCommit: string;
  marketplaceEntrySha256: string;
  artifactSha256: string;
}

export interface ProviderTrialReceipt {
  schemaVersion: 2;
  id: string;
  providerId: string;
  reviewId: string;
  strategy: TrialStrategy;
  platform: Platform;
  scope: "local";
  claudeVersion: string;
  reviewedCommit: string;
  selectedPaths: string[];
  approvalReceiptId: string;
  observedAt: string;
  stages: [TrialStageReceipt, TrialStageReceipt, TrialStageReceipt];
  before: { marketplaceInventorySha256: string; pluginInventorySha256: string };
  installedIdentity: InstalledProviderIdentity | null;
  semanticGrades: ProviderSemanticGradeReceipt[];
  after: {
    marketplaceInventorySha256: string;
    pluginInventorySha256: string;
    temporaryMarketplaceAbsent: boolean;
    temporaryPluginAbsent: boolean;
    inventoriesEqualToBefore: boolean;
  };
  cleanup: {
    projectRemoved: boolean; homeRemoved: boolean; configRemoved: boolean;
    pluginCacheRemoved: boolean; temporaryRootRemoved: boolean;
    xdgConfigRemoved: boolean; xdgCacheRemoved: boolean; xdgDataRemoved: boolean; xdgStateRemoved: boolean;
  };
}

export type ProviderTrialOperation =
  | "auth-status"
  | "plugin-validate"
  | "marketplace-list"
  | "marketplace-add"
  | "plugin-install"
  | "plugin-list"
  | "plugin-eval"
  | "plugin-uninstall"
  | "marketplace-remove";

export interface ProviderTrialApprovalReceipt {
  schemaVersion: 2;
  id: string;
  providerId: string;
  reviewId: string;
  reviewedCommit: string;
  semanticCaseIds: string[];
  platform: Platform;
  approvedAt: string;
  expiresAt: string;
  approvedBy: string;
  allowedOperations: ProviderTrialOperation[];
  credentialSourceClass: "fixed-ignored-local-file";
  providerCredentials: "absent";
}

export interface SemanticAssertionSpec {
  id: string;
  target: "response.text" | "response.json" | "tool.calls";
  predicate: "contains" | "equals" | "absent";
  expectedSha256: string;
}

export interface ProviderSemanticCase {
  schemaVersion: 2;
  id: string;
  providerId: string;
  reviewId: string;
  capabilityId: string;
  platform: Platform;
  fixtureSha256: string;
  promptSha256: string;
  requiredAssertions: SemanticAssertionSpec[];
  forbiddenAssertions: SemanticAssertionSpec[];
  graderVersion: "provider-semantic-grader-v1";
  threshold: number;
}

export interface ProviderSemanticGradeReceipt {
  caseId: string;
  pluginEvalResultSha256: string;
  structuredGradeSha256: string;
  score: number;
  passed: boolean;
}

export function validateProviderTrialEvidenceArtifact(
  evidence: ReviewEvidence,
  bytes: Buffer
): ProviderTrialReceipt | undefined;
```

- [ ] Write red schema/loader tests rejecting absolute paths, raw prompt text, a semantic argv token other than the literal `<prompt:sha256>`, tokens, control characters, `user`/`project` scopes, a non-local marketplace command, a shell string instead of ordered argv, duplicate/non-contiguous command sequences, a missing install/semantic/remove stage, a failed stage referenced as passed evidence, mismatched provider/review/commit/paths/platform, a missing/mismatched approval receipt ID, an expired approval, incomplete allowed operations, version/commit/digest mismatch after install, a semantic case with free-form assertion strings, a semantic grade with absent case/result/grade digest, missing before/after inventory hashes, false or absent post-remove marketplace/plugin absence and inventory-equality fields, or incomplete cleanup flags.
- [ ] Define closed receipt, semantic-case, and approval schemas with only the interfaces above. `argv` requires `--scope local` for every plugin/marketplace mutation and rejects `--scope user`, `--scope project`, `--allow-dangerously-skip-permissions`, `--dangerously-skip-permissions`, absolute paths, `~`, `..`, NUL, secret assignments, and raw output. Store only SHA-256 values for command stdout/stderr/result, inventories, fixtures, prompts, marketplace entry, artifact, plugin-eval result, and structured grade. The semantic command stores `<prompt:sha256>` exactly, never a prompt body. Each required/forbidden assertion has a unique stable ID, closed target/predicate enum, and expected-value SHA-256; a semantic receipt has exactly one grade per bound case and that grade records the case ID, plugin-eval JSON digest, grader JSON digest, score, and pass/fail result. The approval schema is non-secret, has no path/token/config field, and requires one sorted closed operation set equal to the nine operations above, an RFC3339 validity interval with `approvedAt < expiresAt`, fixed credential-source class, and `providerCredentials: "absent"`.
- [ ] Extend `ReviewEvidence` with `trialPlatform?: Platform` and `semanticCaseId?: string`. Keep its existing `platforms` exact to `SourceReviewManifest.compatibility.platforms`; require `trialPlatform` for trial-backed install/semantic/lifecycle evidence and reject it for static evidence. This is the P03-compatible split between declared compatibility and one-platform run proof.
- [ ] Implement `validateProviderTrialEvidenceArtifact()`. For `install-smoke`, require a passed install stage, ordered inventories, and matching immutable installed identity including plugin ID, marketplace ID/source, version, reviewed commit, marketplace-entry digest, and artifact digest; compare both digests directly to the P04 source review's authoritative reviewed digests. For `semantic-smoke`, require a bound case, matching capability/platform, a passed semantic stage, one matching structured grade with plugin-eval and grader result digests, all required assertions satisfied, no forbidden assertion violated, and threshold satisfaction. For lifecycle evidence, require a passed remove stage, parsed post-removal marketplace/plugin inventories that prove the temporary marketplace and plugin are absent, exact expected before/after inventory state, and every cleanup flag true. Do not parse arbitrary evidence kinds as trial data.
- [ ] Integrate semantic cases, trial approvals, and artifact parsing into `loadResearchRepository()` after SHA-256 verification. Resolve the receipt's `approvalReceiptId`, reject an approval whose provider/review/commit/case-set/platform/validity interval differs from the trial, and reject malformed but hash-valid data before `validateResearchGraph()` exposes provider data. Track `research/semantic-cases/.gitkeep` and `research/trial-approvals/.gitkeep`; add both `research/private/claude-subscription-auth.json` and `research/private/semantic-fixtures/` to `.gitignore` so the empty committed roots remain visible but no credential or raw semantic fixture can be committed.
- [ ] Run `npm test -- tests/unit/research-trial-artifact.test.ts tests/unit/research-repository.test.ts tests/unit/research-governance.test.ts` and then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: validate isolated provider trial receipts"`.

## Task 4: Build the Disposable Claude Provider Trial Harness

**Files:** create `src/research/trial.ts`, `src/research/provider-semantic-grader.ts`, `scripts/research/run-provider-trial.ts`, `tests/unit/research-trial.test.ts`, and `tests/unit/research-provider-semantic-grader.test.ts`; modify `package.json` to add `research:trial`.

**Interfaces:**

```ts
export type TrialAuthMode = "approved-ephemeral-claude-subscription-fixture";

export interface ProviderTrialAuthPolicy {
  mode: TrialAuthMode;
  credentialSourceClass: "fixed-ignored-local-file";
  providerCredentials: "absent";
}

export interface RawSemanticFixture {
  caseId: string;
  capabilityId: string;
  prompt: string;
  requiredAssertions: Array<SemanticAssertionSpec & { expectedValue: string }>;
  forbiddenAssertions: Array<SemanticAssertionSpec & { expectedValue: string }>;
}

export interface ProviderTrialPlan {
  provider: Exclude<ProviderManifest, { installStrategy: "owned" }>;
  review: SourceReviewManifest;
  semanticCases: readonly ProviderSemanticCase[];
  rawSemanticFixtures: readonly RawSemanticFixture[];
  approval: ProviderTrialApprovalReceipt;
  auth: ProviderTrialAuthPolicy;
  observedAt: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  argv: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Promise<CommandResult>;

export function runDisposableProviderTrial(
  plan: ProviderTrialPlan,
  runner?: CommandRunner
): Promise<ProviderTrialReceipt>;

export interface ProviderSemanticGrade {
  caseId: string;
  passed: boolean;
  satisfiedAssertionIds: string[];
  violatedForbiddenAssertionIds: string[];
  score: number;
}

export function gradeProviderSemanticResult(
  semanticCase: ProviderSemanticCase,
  rawFixture: RawSemanticFixture,
  pluginEvalJson: unknown
): ProviderSemanticGrade;
```

- [ ] First write red unit tests with an injected `CommandRunner`, never the real CLI. Use the fixed `p04-fixture-pinned-provider` fixture to assert the complete ordered command receipt: `claude auth status --json`, `claude plugin validate p04-pinned-marketplace`, before-install `claude plugin marketplace list --json`, before-install `claude plugin list --json`, `claude plugin marketplace add --scope local p04-pinned-marketplace`, `claude plugin install --scope local p04-fixture-pinned-provider@p04-pinned-marketplace`, after-install `claude plugin list --json`, one `claude plugin eval` invocation, `claude plugin uninstall --scope local --yes p04-fixture-pinned-provider@p04-pinned-marketplace`, `claude plugin marketplace remove --scope local p04-pinned-marketplace`, after-remove `claude plugin marketplace list --json`, and after-remove `claude plugin list --json`. Parse all four inventory JSON documents in the test; prove the named temporary marketplace/plugin are absent after removal and that the remaining post-remove inventories exactly equal the normalized before-install inventories. Assert contiguous `sequence` values, an argv receipt for every command, and cleanup after unauthenticated status, validation failure, install failure, semantic failure, malformed inventory, and success.
- [ ] Implement `runDisposableProviderTrial()` with independent `mkdtemp()` roots for the fresh project, home, Claude config, plugin cache, temporary files, and all four XDG roots. It accepts no caller path for any root and never mutates `process.env`. Every child receives only this exact environment key set: `PATH` set to the platform's fixed trusted binary directories, `HOME`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PLUGIN_CACHE_DIR`, `TMPDIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `LANG=C`, `LC_ALL=C`, `NO_COLOR=1`, and `TERM=dumb`. Construct it from an empty object, never by spreading inherited environment variables; reject inherited credential names including `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`, and every variable ending in `_TOKEN`, `_KEY`, or `_SECRET`.
- [ ] Separate Claude subscription authentication from provider authentication. Before reading any credential, the runner resolves the committed `ProviderTrialApprovalReceipt` by ID and requires exact provider ID, review ID, reviewed commit, sorted semantic-case ID set, observed platform, unexpired RFC3339 interval, `providerCredentials: "absent"`, fixed credential-source class, and the complete nine-operation allowlist. It reads Claude subscription material only from the one fixed ignored regular file `research/private/claude-subscription-auth.json`; reject a missing file, symlink, non-regular file, mode other than `0600`, or approval mismatch. Copy it once with exclusive-create mode and `0600` into the temporary `HOME/.claude.json`, never into a child environment and never from the real home or a caller-supplied path. Run `claude auth status --json` in the isolated environment and parse confirmed authenticated subscription status before marketplace validation/install. Never copy provider credentials: no provider token/cookie/key may appear in the child environment or fixture, and a provider needing a service login, provider API key, OAuth token, or real customer data is held rather than trialled. Exclude fixture path/name/bytes/digest from receipts; unlink the temporary `HOME/.claude.json` and delete all isolated roots in `finally`.
- [ ] Add a pre-install `classifyProviderExecutableSurface()` gate. A local subscription trial accepts only a reviewed declarative skill/command/agent surface with empty command permission grants. It holds any selected path containing hooks, MCP servers, scripts, binaries, package install hooks, remote bootstrap instructions, an undeclared executable, or a provider-auth fixture requirement. The runner invokes only the trusted `claude` executable with argv and `shell: false`; it never invokes provider-owned executables, a shell, `git`, `npm`, or `claude --plugin-dir`.
- [ ] Normalize every reviewed install source before rendering a disposable local marketplace. A marketplace entry whose source is relative, local, or path-based is never `native-marketplace-plugin`: reclassify it as `pinned-git-subdir` using the upstream marketplace repository, exact reviewed commit, and plugin subdirectory. `native-marketplace-plugin` is permitted only for an immutable remote artifact with an independently reviewed artifact identity and no relative source. Render both normalized strategies into the fixed local marketplace, then run `claude plugin validate p04-pinned-marketplace` before adding it. The renderer rejects a changed Git URL, ref, commit SHA, subdirectory, plugin name, reviewed marketplace-entry/artifact digest, or selected skill-path allowlist. The generated entry is the only input to `claude plugin marketplace add`; a direct clone, a local checkout install, default skill scanning, and `claude --plugin-dir` are prohibited.

  ```json
  {
    "name": "p04-pinned-marketplace",
    "owner": { "name": "p04-research" },
    "plugins": [
      {
        "name": "p04-fixture-pinned-provider",
        "source": {
          "source": "git-subdir",
          "url": "https://github.com/p04-fixtures/pinned-provider.git",
          "path": "plugins/reviewed",
          "ref": "v1.2.3",
          "sha": "0123456789abcdef0123456789abcdef01234567"
        },
        "strict": false,
        "skills": ["./skills/reviewed"]
      }
    ]
  }
  ```

- [ ] Make selected skill path rendering closed and testable. Stored `selectedPaths` are repository-relative. For the fixture source path `plugins/reviewed`, the reviewed selected repository path is exactly `plugins/reviewed/skills/reviewed/SKILL.md`; strip the `plugins/reviewed/` prefix, convert the `SKILL.md` file to its containing directory, and render the unique canonical plugin-root-relative directory `./skills/reviewed`. Accept only a selected repository path that is either an exact reviewed `SKILL.md` file or a reviewed skill directory containing exactly that file, and only when it is strictly underneath the provider subdirectory. Reject a root escape, a subdirectory prefix mismatch, a missing `SKILL.md`, duplicate rendered directory, an absolute path, or an implicit/default scan. On every real provider, substitute only the corresponding reviewed `repository`, immutable `commitSha` into source field `sha`, `ref`, `subdirectory` into source field `path`, plugin name, and this sorted rendered directory allowlist; `strict: false` is permitted only because the entry declares that exact allowlist. Before the first real trial, make red path-normalization tests from the fixture above, then run `claude plugin validate p04-pinned-marketplace`; the green test proves Claude Code accepts the generated marketplace grammar rather than trusting an in-process fixture.
- [ ] After installation, parse the isolated `claude plugin list --json` inventory and the isolated Claude installed-plugin metadata to construct `InstalledProviderIdentity`. It must contain the installed plugin ID, marketplace ID/source, resolved version, reviewed commit, SHA-256 of the exact rendered marketplace entry, and SHA-256 of the installed reviewed artifact. Compare the two identity digests directly to `SourceReviewManifest.reviewedMarketplaceEntrySha256` and `SourceReviewManifest.reviewedArtifactSha256`; fail before semantic evaluation if any parsed identity differs from the source review or if an expected metadata field is absent. Store digests and logical names only, never a cache path or raw inventory.
- [ ] Create one temporary plugin-eval case for every `ProviderSemanticCase`, bound to exactly one `providerId`, `reviewId`, `capabilityId`, and observed platform. Verify the ignored raw fixture's prompt, fixture, and structured assertion-value digests before creating the temporary case. For the fixed fixture, invoke exactly `claude plugin eval --json --no-scaffold --runs 1 --threshold 1 --output-dir .p04-eval-output --case evals/p04-fixture-capability p04-fixture-pinned-provider@p04-pinned-marketplace`; do not pass `--allow-tools`, which grants no operator-approved external tools. Run returned JSON through `gradeProviderSemanticResult()` and require every required assertion ID, no forbidden assertion ID, and `score >= threshold`; an exit code of zero by itself is never a pass. Multi-capability providers require a distinct bound case, plugin-eval result digest, and structured-grade digest for each covered capability, not one generic semantic receipt.
- [ ] Sanitize every command before receipt creation: replace the generated marketplace directory with its logical marketplace ID, replace the generated eval directory with `.p04-eval-output`, and replace the raw prompt with the literal `<prompt:sha256>`. Hash stdout, stderr, parsed inventories, marketplace entry, installed artifact, evaluator JSON, and structured grade; never retain their bodies. `try/finally` runs removals and deletes project, home, config, cache, temporary, and XDG roots even after a failure, then records before/after inventory hashes, parsed absence/equality results, and all cleanup booleans.
- [ ] The harness rejects non-stable providers, provider/review/case identity mismatch, unresolved hard gates, unreviewed native artifact revisions, unsafe selected paths, unsupported strategy, any non-current platform claim, a missing/changed fixture digest, an external scope, or any receipt mismatch. It emits one receipt for one observed platform and never turns a Darwin receipt into Linux or Windows evidence.
- [ ] Add `scripts/research/run-provider-trial.ts` with closed flags `--provider-id`, `--review-id`, repeatable `--semantic-case-id`, `--approval-receipt-id`, `--observed-at`, and `--output`. It resolves exactly one atomic provider/review pair, one-or-more sorted committed semantic cases, and one committed approval record; it requires the approval's case set to be exactly the supplied case set. It loads matching ignored raw semantic fixtures by case ID and reads the only permitted Claude subscription fixture from `research/private/claude-subscription-auth.json`. It refuses all path/root/auth/scope/provider-credential flags, refuses an existing output, validates the receipt, and writes exactly one `0600` JSON artifact below `research/evidence/artifacts/`. It must never write under the real home or the working checkout outside that requested artifact.
- [ ] Run `npm test -- tests/unit/research-trial.test.ts tests/unit/research-provider-semantic-grader.test.ts tests/unit/research-trial-artifact.test.ts` and then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: run disposable provider install trials"`.

## Task 5: Wire P04 Coverage, Governance, Trials, and Conflict Semantics into One Gate

**Files:** modify `src/research/graph.ts`, `src/research/governance.ts`, `src/research/repository.ts`, `src/cli.ts`, `package.json`, `tests/unit/research-graph.test.ts`, and `tests/integration/research-governance.test.ts`; create `scripts/research/validate-provider-waves.ts` and `tests/integration/provider-review-waves.test.ts`.

**Interfaces:**

```ts
export interface ProviderWaveValidation {
  coverage: readonly CapabilityCoverage[];
  selections: readonly ProviderSelectionManifest[];
  selectedProviderIds: readonly string[];
  alternateProviderIds: readonly string[];
  ownedGapIds: readonly string[];
}

export function validateP04ProviderWaves(
  repository: ResearchRepository,
  catalog: ResearchGraphCatalog,
  options?: { throughWave?: 1 | 2 | 3 | 4 }
): ProviderWaveValidation;

export function validateP09OwnedGapRealization(
  repository: ResearchRepository,
  catalog: ResearchGraphCatalog
): void;
```

- [ ] Write red integration tests that begin with the valid P03 production repository and fail P04 validation because coverage is intentionally absent. Build synthetic full-coverage fixtures that green without network access, then separately prove a one-wave green result by invoking the real `validateP04ProviderWaves(repository, catalog, { throughWave: 1 })` entry point. The integration suite must call that production validator directly.
- [ ] Implement `validateP04ProviderWaves()` as an explicit P04-only gate layered after `validateResearchGraph()`. The default is `throughWave: 4`; a partial value validates exactly the completed prefix of immutable worklists and rejects an omitted earlier wave, a future-wave disposition, or a capability outside the prefix. It calls `validateP04CapabilityCoverage()` for that prefix, recomputes every external provider's governance decision in strict evidence mode, and verifies every non-gap platform cell's preferred provider is eligible/trusted. A community provider can appear only as an explicitly labelled eligible fallback, never as a preferred provider.
- [ ] Separate base-graph and phase gates. `validateResearchGraph()` continues to validate P03 repositories with no selections, and permits a P04 `owned-gap` that is bound to exactly one approved `OwnedGapDecision` even though no repository-owned provider exists yet. It requires that gap's terminal reviews and selection linkage but never requires an owned provider. `validateP04ProviderWaves()` makes every required gap selection-bound. Only `validateP09OwnedGapRealization()` requires exactly one repository-owned provider/output for each selected gap and rejects orphaned owned providers. Add both negative and green tests so P04 cannot accidentally demand P09 implementation and P09 cannot silently accept an unimplemented gap.
- [ ] Derive each `SourceReviewManifest.decision` from the provider's full selection portfolio, not from one capability. Build a deterministic role set from all `preferredRole` values and all fallback lists: `selected` when the provider is preferred with role `selected` for any capability/platform, otherwise `alternate` when it is preferred with role `alternate` or an eligible fallback anywhere, otherwise its only terminal held/rejected role. Reject a source review whose decision is lower or higher than this maximum. A provider preferred-selected for capability A and preferred-alternate for capability B therefore has one `selected` source review and both per-capability roles remain visible only in selection manifests.
- [ ] Require all candidate, source review, evidence, provider, capability-level selection, fallback, conflict, and owned-gap records to be reachable from a complete P02 capability disposition. A source review with portfolio `selected` must have at least one exact preferred role `selected`; an alternate-only review cannot be orphaned; and a conflict exists only for a real same-capability overlap whose preferred provider is selected for that platform cell. Provider-wide membership never chooses a capability by itself. Terminal held/rejected reviews must appear only in a related `rejected` or `owned-gap` manifest.
- [ ] Validate platform semantics without conflating declaration and proof. `provider.platforms` and `review.compatibility.platforms` remain the same sorted static set. Every non-gap capability/platform cell must name exactly one preferred provider and role, plus zero-or-more eligible non-preferred fallbacks, all declaring the role platform. On the current platform, the preferred provider requires one passed matching install, semantic, and remove receipt for the reviewed commit/path and one structured grade per bound semantic case whether `preferredRole` is `selected` or `alternate` and whether the capability's global disposition is `selected` or `alternate`. A non-current role remains `pending-p11`; its P04 candidate evidence never becomes a release claim. Reject a trial receipt for an undeclared platform, a claimed `trialed-p04` platform other than the local observed platform, missing remove evidence, stale digest, missing approval/digest match, or a receipt whose provider/review/commit/path/case differs.
- [ ] Add `npm run research:check-p04` for `tsx scripts/research/validate-provider-waves.ts`. The command has one real partial form, `npm run research:check-p04 -- --through-wave=1`, and analogous values `2`, `3`, and `4`; no test-only mode exists. With no argument it is exactly `--through-wave=4`. It loads the atomic repository, takes platform constants from `src/manifest/repository.ts`, emits a deterministic JSON summary only after all applicable validation passes, and returns nonzero before stdout on error. `npm run validate` remains P03-compatible until P12 raises the production release gate.
- [ ] Add graph tests for duplicate canonical source repository, immutable source owner-wave mutation, direct review-source discovery, phase-safe owned gaps, P09-only owned realization, missing current-platform preferred-provider trial for either preferred role, failed structured semantic grade, stale receipt hash, installed-vs-reviewed digest mismatch, Darwin evidence advertised as Linux/Windows release proof, portfolio-max source review decisions, multi-capability provider consistency, invalid conflict/preference, required-rejected selection, recommended-without-selection, fallback orphaning, and an owned gap that leaves a required capability unresolved.
- [ ] Run `npm test -- tests/unit/research-coverage.test.ts tests/unit/research-trial-artifact.test.ts tests/unit/research-trial.test.ts tests/unit/research-graph.test.ts tests/integration/provider-review-waves.test.ts` and then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: validate complete provider review waves"`.

## Task 6: Add Deterministic Wave Worklists and Candidate Capture

**Files:** create `research/worklists/wave-1.json`, `research/worklists/wave-2.json`, `research/worklists/wave-3.json`, `research/worklists/wave-4.json`, `scripts/research/render-worklist.ts`, `tests/unit/research-worklist.test.ts`, `tests/fixtures/research/p04-wave-ownership.json`, and `tests/fixtures/research/p04-capability-routing.json`; modify `src/research/coverage.ts` and `package.json`.

**Interfaces:**

```ts
export interface WaveWorklistEntry {
  capabilityId: string;
  searchTerms: [string, string, string];
  initialSourceIds: string[];
}

export interface WaveWorklist {
  schemaVersion: 2;
  wave: 1 | 2 | 3 | 4;
  domainIds: DomainId[];
  entries: WaveWorklistEntry[];
}

export function validateWaveWorklists(
  worklists: readonly WaveWorklist[],
  completeV1: CompleteV1Repository
): readonly WaveWorklist[];
```

- [ ] Write the literal, sorted `tests/fixtures/research/p04-capability-routing.json` before implementation. It contains exactly 147 objects with `wave`, `domainId`, `capabilityId`, the three exact search-term strings, and exact allowed `initialSourceIds`; it is not generated from the worklist or queue. Tests compare every checked-in worklist object byte-for-byte after canonical JSON normalization to this fixture and fail an omitted, extra, duplicated, reordered, or retargeted capability. `research/worklists` contains no provider selection, provider ID, marketplace command, or trial result.
- [ ] Write failing tests asserting exact wave ownership and loads: W1 exactly 33 capabilities (26 required, 7 recommended-only), W2 38 (23, 15), W3 40 (32, 8), W4 36 (20, 16); no duplicate domain/capability; exactly five domains in every wave; all 147 P04-universe capabilities present exactly once; all search-term tuples are nonempty/distinct; and all source IDs match the fixed map below. Each literal fixture record writes three fully expanded queries: a skill query for its capability, a plugin query for its domain plus capability, and a GitHub query for its capability. Store no query template and generate no query during validation.
- [ ] Commit the fixed worklists. Wave 1 domains are `research-and-intelligence`, `strategy-and-decision`, `writing-and-publishing`, `marketing-and-growth`, and `promotion-and-distribution`; Wave 2 is `sales-and-customer`, `product-management`, `project-management`, `software-engineering`, and `devops-and-security`; Wave 3 is `ai-agents-and-automation`, `data-and-analytics`, `design-and-brand`, `video-and-audio`, and `documents-and-knowledge`; Wave 4 is `business-operations`, `finance-and-accounting`, `commerce`, `people-and-training`, and `legal-risk-and-compliance`.
- [ ] Use this exact initial-source routing map when writing the 147 entries. A direct original discovery may add a new source config only after recording the listed discovery source, query, source URL, result path, observed time, and a new original-source triad; it never replaces a listed source ID. Tier C IDs `composio-awesome-claude-skills` and `jeremylongshore-plugins-plus-skills` are discovery-only and force `provenance: "aggregator-follow-through"` plus that original-source triad before review.

  | Domain | Exact `initialSourceIds` |
  | --- | --- |
  | Research | `anthropic-plugins-official`, `k-dense-scientific-agent-skills`, `alirezarezvani-claude-skills`, `huggingface-skills` |
  | Strategy | `deanpeters-product-manager-skills`, `wshobson-agents`, `alirezarezvani-claude-skills` |
  | Writing | `anthropic-skills`, `daymade-claude-code-skills`, `coreyhaines31-marketingskills`, `composio-awesome-claude-skills` |
  | Marketing | `coreyhaines31-marketingskills`, `alirezarezvani-claude-skills`, `wshobson-agents` |
  | Promotion | `coreyhaines31-marketingskills`, `chengfeng-videocut-skills`, `composio-awesome-claude-skills` |
  | Sales | `wshobson-agents`, `alirezarezvani-claude-skills`, `composio-awesome-claude-skills` |
  | Product | `deanpeters-product-manager-skills`, `wshobson-agents`, `alirezarezvani-claude-skills` |
  | Project | `obra-superpowers`, `wshobson-agents`, `daymade-claude-code-skills` |
  | Software | `anthropic-plugins-official`, `obra-superpowers`, `wshobson-agents`, `daymade-claude-code-skills` |
  | DevOps | `anthropic-plugins-official`, `wshobson-agents`, `composio-awesome-claude-skills` |
  | AI | `anthropic-plugins-official`, `huggingface-skills`, `k-dense-scientific-agent-skills`, `wshobson-agents` |
  | Data | `anthropic-skills`, `k-dense-scientific-agent-skills`, `wshobson-agents`, `composio-awesome-claude-skills` |
  | Design | `anthropic-skills`, `daymade-claude-code-skills`, `composio-awesome-claude-skills` |
  | Video | `chengfeng-videocut-skills`, `daymade-claude-code-skills`, `composio-awesome-claude-skills` |
  | Documents | `anthropic-skills`, `daymade-claude-code-skills`, `kepano-obsidian-skills`, `composio-awesome-claude-skills` |
  | Operations | `alirezarezvani-claude-skills`, `wshobson-agents`, `daymade-claude-code-skills` |
  | Finance | `deanpeters-product-manager-skills`, `alirezarezvani-claude-skills`, `composio-awesome-claude-skills` |
  | Commerce | `nexscope-ecommerce-skills`, `composio-awesome-claude-skills` |
  | People | `deanpeters-product-manager-skills`, `wshobson-agents`, `composio-awesome-claude-skills` |
  | Legal | `anthropic-plugins-official`, `composio-awesome-claude-skills`, `jeremylongshore-plugins-plus-skills` |

- [ ] Implement `npm run research:worklist -- --wave=1` to emit the exact sorted JSON array from the committed wave file. It must reject bare/multiple/out-of-range wave values, query no network, mutate no manifest, and produce byte-identical output on repeat. It must validate the routing fixture before printing.
- [ ] Run `npm test -- tests/unit/research-worklist.test.ts tests/unit/research-coverage.test.ts` and then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: define provider review worklists"`.

## Fixed Wave Execution

Each wave follows the same controlled sequence; no wave may select a provider merely because it is listed in a marketplace or a discovery census. P04 data is committed wave-by-wave so each five-domain decision set can receive an independent review before the next wave begins. Live discovery is allowed only through immutable snapshots/receipts and the disposable trial harness built above.

**Shared Files For Tasks 7-10:** Every wave modifies `research/review-queue.json`, `research/review-source-index.json`, and `research/evaluation-context.json`; adds only wave-owned named records in `research/sources/`, `research/receipts/`, `research/snapshots/`, `research/evidence/`, `research/evidence/artifacts/`, `research/semantic-cases/`, and `research/trial-approvals/`; adds only named records in `manifests/complete-v1-providers/`, `manifests/provider-selections/`, `manifests/source-reviews/`, `manifests/conflicts/`, and `manifests/owned-gaps/`; and modifies `tests/integration/provider-review-waves.test.ts`. This complete file scope applies to Task 7, Task 8, Task 9, and Task 10; no task uses a path inherited by implication.

For every worklist capability, perform these exact actions before committing the wave:

1. Run the worklist command with that wave's fixed numeric ID and create or update exactly one `CapabilitySearchRecord` plus exactly one selection manifest named from the record's literal capability ID, with candidate IDs, immutable search evidence, a selected/alternate/rejected/owned-gap disposition, reason strings, and sorted alternate IDs.
2. Search its mapped Tier A and B sources and relevant native marketplace entries. Capture query URLs and result/path observations as `search-evidence`; follow any Tier C/D aggregator candidate to the original repository before evaluating it.
3. Record at least three materially distinct candidates when available. If fewer are found, record only an immutable `fewerThanThreeEvidenceIds` artifact that names each query, source URL, snapshot ID, observation time, and negative result; do not use prose alone.
4. For every candidate that advances, use or add exactly one canonical source config, collect a fresh immutable review snapshot and receipt at the reviewed commit, add the review triad, and create a queue candidate whose repository, path, discovery entry, source URL, provenance, tier, and observed time attest against the discovery and review snapshots.
5. Review the complete selected plugin surface and selected paths. Record all skills, commands, agents, hooks, MCP servers, scripts, binaries, permissions, secret flows, platform/Claude compatibility, license conclusion, update/removal strategy, maintenance date, linked P02 domain/category/capability/pack IDs, all 11 hard gates, all 15 score criteria, and every evidence artifact.
6. Use `npm run research:trial` only through the closed flags `--provider-id`, `--review-id`, repeatable `--semantic-case-id`, `--approval-receipt-id`, `--observed-at`, and `--output`, after static source/license/surface review yields a bounded candidate and a matching committed Claude subscription-fixture approval exists. The loader resolves provider/review/cases/approval solely against committed IDs, requires the approval's full case set and platform/commit/operation set to match, requires an RFC3339 UTC observation time, and allows an output only under `research/evidence/artifacts/`; it accepts no free-text prompt, path, scope, root, or auth argument. Bind its sanitized receipt and each bound structured grade to `install-smoke`, `semantic-smoke`, and lifecycle evidence. A trial failure is recorded as failed evidence and makes the candidate held or rejected; it may never be selected.
7. Choose the highest-scoring eligible provider per capability, even when one provider spans multiple capabilities. Record eligible alternates and a conflict group only where the same capability overlaps. If no eligible external provider exists for a required capability, create an approved `OwnedGapDecision` listing all terminal non-eligible reviews; P09, not P04, later writes the owned skill. For a recommended-only capability, record explicit `alternate` or `rejected` rather than fabricating a gap skill; use `owned-gap` only when an approved owned implementation is intentionally required later.

### Task 7: Review Wave 1

- [ ] First write failing integration assertions for the exact Wave 1 domains and all Wave 1 rows in the fixed matrix: required capabilities must resolve to `selected` or `owned-gap`; recommended-only capabilities must resolve to `selected`, `alternate`, `rejected`, or `owned-gap`; no Wave 2-4 capability can be asserted complete yet.
- [ ] Complete the controlled seven-step research sequence for Research/Strategy/Writing/Marketing/Promotion. Use the design's source families: Anthropic, K-Dense, alirezarezvani, and Hugging Face for research; Product-Manager-Skills, wshobson, and alirezarezvani for strategy; Anthropic Skills, daymade, marketingskills, and original Composio discoveries for writing; marketingskills, alirezarezvani, and wshobson for marketing; and marketingskills, video sources, and original PR/media providers for promotion.
- [ ] Run the real prefix gate `npm run research:check-p04 -- --through-wave=1`, then `npm test -- tests/integration/provider-review-waves.test.ts tests/unit/research-graph.test.ts`, and `npm run check`. The unqualified full command remains red until all four waves finish; partial validation is the same production command with a bounded wave argument.
- [ ] Request an independent review of the Wave 1 commit range. Resolve all Critical and Important findings before the next wave.
- [ ] Commit with `git commit -s -m "feat: review provider wave one"`.

### Task 8: Review Wave 2

- [ ] Add red cumulative tests for every Wave 2 matrix row while preserving Wave 1 records byte-for-byte except a reviewed superseding record with an explicit `supersedesReviewId`.
- [ ] Complete the seven-step research sequence for Sales/Product/Project/Software/DevOps. Audit wshobson, alirezarezvani, official CRM integrations, Product-Manager-Skills, Superpowers, Anthropic official, Vercel/original providers, daymade, and maintained delivery/operations sources; retain no aggregator implementation as an original source.
- [ ] Reject default selection for any provider that asks for unbounded shell/filesystem/network access, unbounded secret flow, undeclared bootstrap, remote script execution, unsupported platform, or no removal/update strategy. Security-sensitive and deployment providers require explicit adversarial semantic smoke prompts and no real production credentials.
- [ ] Run the real cumulative prefix gate `npm run research:check-p04 -- --through-wave=2`, focused tests, `npm run check`, and a fresh isolated trial for every new current-platform preferred provider, whether its platform role is `selected` or `alternate`. Record the other declared platform roles as `pending-p11`, not as tested release proof. Review and fix Critical/Important findings before proceeding.
- [ ] Commit with `git commit -s -m "feat: review provider wave two"`.

### Task 9: Review Wave 3

- [ ] Add red cumulative tests for every Wave 3 matrix row, its recommendations, complete source triads, and trial receipts. Do not alter an earlier selected revision without a new review, new trial evidence, `supersedesReviewId`, and a reassessment of every linked capability.
- [ ] Complete the seven-step research sequence for AI/Data/Design/Video/Documents. Start from Anthropic official/Skills, Hugging Face, K-Dense, wshobson, daymade, maintained design providers, videocut/Remotion sources, Obsidian, and official Notion sources; record external services/MCP credentials as absent unless the provider documents a bounded, testable integration and the capability genuinely requires it.
- [ ] For image, media, and document providers, semantic smoke must use synthetic non-sensitive fixtures and verify only the declared workflow outcome, not quality claims unsupported by the receipt. A provider needing a paid vendor, login, or unbounded external access is held/rejected unless a bounded no-secret trial proves the selected paths safely.
- [ ] Run `npm run research:check-p04 -- --through-wave=3`, cumulative Wave 1-3 tests, `npm run check`, every new current-platform preferred-provider trial with every bound semantic case, and an independent Wave 3 review before proceeding. Non-current compatible selections remain `pending-p11`.
- [ ] Commit with `git commit -s -m "feat: review provider wave three"`.

### Task 10: Review Wave 4

- [ ] Add red full-universe tests for every Wave 4 matrix row and prove all 20 domains are represented exactly once by worklist ownership.
- [ ] Complete the seven-step research sequence for Operations/Finance/Commerce/People/Legal. Start from alirezarezvani, wshobson, daymade productivity providers, spreadsheet/original finance sources, eCommerce-Skills, official commerce integrations, Product-Manager-Skills people sources, official security/compliance integrations, and original specialist providers.
- [ ] Treat finance, tax, employment, hiring, contract, legal, and compliance providers as high-impact: record qualified-human boundaries in semantic prompts, prohibit professional conclusions, do not enter real records or credentials, and reject any provider whose selected surface cannot make that boundary explicit.
- [ ] Run `npm run research:check-p04 -- --through-wave=4`, `npm test -- tests/integration/provider-review-waves.test.ts tests/unit/research-coverage.test.ts tests/unit/research-graph.test.ts`, and `npm run check`; all four wave tests must now be green. Every current-platform preferred role, whether `selected` or `alternate`, must have current isolated install/semantic/remove evidence and a bound structured grade, while Linux/Windows or other non-current roles remain explicitly `pending-p11` until P11 trial evidence exists.
- [ ] Request an independent full P04 data/spec review. Resolve Critical and Important findings before P04 exit evidence is written.
- [ ] Commit with `git commit -s -m "feat: review provider wave four"`.

## Task 11: Add Deterministic Provider-Audit Reports and Freshness Inputs

**Files:** modify `src/research/reports.ts`, `src/research/freshness.ts`, `scripts/research/validate-provider-waves.ts`, `tests/unit/research-reports.test.ts`, `tests/unit/research-freshness.test.ts`, `tests/integration/provider-review-waves.test.ts`, and `research/evaluation-context.json`; create `tests/fixtures/research/expected/p04-provider-coverage.json` and `tests/fixtures/research/expected/p04-provider-audit.md`.

**Interfaces:**

```ts
export function generateProviderCoverageReport(
  repository: ResearchRepository,
  completeV1: CompleteV1Repository
): string;

export function generateProviderAuditReport(
  repository: ResearchRepository,
  completeV1: CompleteV1Repository
): string;
```

- [ ] Write red tests that shuffle every loaded collection and reproduce byte-identical coverage/audit reports. The coverage report must list all 147 capability IDs with required/recommended pack references, disposition, selected provider or owned-gap ID, alternates, score/trust, review commit, and every platform role. A current `trialed-p04` role prints its install/semantic/remove and case/grade digests; every non-current compatible role prints `pending-p11`, never a release digest. Do not emit raw commands or paths. The audit report must list source triad IDs and immutable `ownerWave`, license decisions, bounded permission summaries, conflict membership, terminal gap alternatives, and next review dates.
- [ ] Implement reports as pure sorted projections. They must fail rather than omit an unknown disposition, absent provider, missing review, missing applicable current-platform evidence, missing bound semantic grade, or unverified digest. They must not require a P11 receipt for an explicitly pending non-current platform. P10 may later publish user-facing artifacts; P04 writes only fixtures and test output, not README/generated release docs.
- [ ] Update `research/evaluation-context.json` only with exact `asOf`, `privateRcAt: null`, and empty or valid upstream observation records appropriate at P04 close. Do not claim RC freshness in P04; P11 later supplies 30-day RC rechecks.
- [ ] Run `npm test -- tests/unit/research-reports.test.ts tests/unit/research-freshness.test.ts tests/integration/provider-review-waves.test.ts` and then `npm run check`.
- [ ] Commit with `git commit -s -m "feat: report provider review coverage"`.

## Task 12: Prove P04 from a Clean Checkout and Record Exit Evidence

**Files:** create `tests/e2e/provider-review-clean-copy.sh` and a sanitized public release-evidence summary; modify `docs/superpowers/plans/2026-07-23-complete-v1-master-roadmap.md` and this plan only after all gates pass. Private implementation reports remain local and ignored.

- [ ] Write `tests/e2e/provider-review-clean-copy.sh` to clone the committed head into a fresh temporary directory, run `npm ci`, `npm run check`, `npm run research:check-p04`, and the existing three `claude plugin validate` commands. It must not invoke live provider trials, access a real Claude home, or mutate the source checkout.
- [ ] From the committed head, run `npm run check`, `npm run research:check-p04`, `bash tests/e2e/clean-copy.sh`, `bash tests/e2e/provider-review-clean-copy.sh`, and `git diff --check`. Re-run deterministic provider reports after two independently shuffled in-memory load orders and record their bytes/SHA-256 in the exit report.
- [ ] Independently verify all 147 P02 capabilities: each of the 101 required capabilities has exactly one global `selected` eligible provider or exactly one approved owned gap with terminal rejected/held alternatives; every non-gap current-platform cell has exactly one preferred eligible provider, with `preferredRole` equal to `selected` or `alternate`, and that preferred provider has passed static/install/semantic/remove evidence plus every bound semantic grade. Each of the 46 recommended-only capabilities has one explicit valid selected/alternate/rejected/gap disposition. Verify every non-current compatible provider role is `pending-p11`, not release eligible, every provider/review/evidence/selection/conflict/gap is reachable, each original upstream repository has one immutable source owner/owner wave, and no untracked raw evidence remains.
- [ ] Request a final independent P04 specification review of the exact implementation range. Block P05 on any Critical or Important finding; fix findings with focused tests and re-run the final review. Minor findings are fixed when they change coverage, safety, determinism, or future resolver inputs.
- [ ] Update the P04 roadmap row only with the actual commit range, test total, clean-copy result, coverage totals, report hashes, and reviewer outcome. The exit report must state that P04 did not perform a persistent/global install, a user-facing onboarding flow, a lifecycle state write, a push, merge, marketplace publication, or a public release.
- [ ] Commit the two plans and sanitized public release evidence with `git commit -s -m "docs: record p04 exit evidence"`; do not add private implementation reports.

## P04 Exit Evidence

P04 is complete only when all of the following are true:

- all 147 capabilities have exactly one capability-level provider-selection manifest and exact fixture/worklist membership: 101 required selections are `selected` or `owned-gap`; 46 recommended-only selections are `selected`, `alternate`, `rejected`, or `owned-gap`;
- every non-gap current-platform cell's preferred provider has immutable source/static/install/semantic/remove evidence with one passing structured grade for every bound capability case, regardless of whether `preferredRole` is `selected` or `alternate`; every non-current compatible role is explicitly `pending-p11`, is not release eligible, and remains P11's three-OS trial obligation; every owned-gap decision has complete terminal candidate evidence;
- all four five-domain worklists have exact loads W1 `33/26/7`, W2 `38/23/15`, W3 `40/32/8`, W4 `36/20/16`, are deterministic, and are free of cross-wave ownership drift;
- every selected/alternate provider has a full immutable review-source triad, exact P02 linkage, all hard gates and score criteria reproduced, bounded permissions/secret flow, update/removal strategy, and no copied upstream code;
- every current-platform `preferredProviderId` has an artifact-validated disposable `local`-scope install, structured `claude plugin eval` semantic trial, and remove trial whose parsed post-remove inventories prove the temporary plugin and marketplace absent and equal the normalized before state; it leaves no trial project/home/config/cache/temp/XDG root or ephemeral Claude auth fixture and never touches the real global/project Claude configuration; providers with executable surfaces or provider credentials are held for a stronger future runner;
- source configs are unique by canonical upstream repository with immutable owner waves, snapshots/receipts are unique triad-owned, direct review-source discovery is attested, and no aggregator result bypasses original-source review;
- conflicts, alternates, held/rejected candidates, and owned gaps are reachable, bidirectionally linked, and deterministic;
- `npm run check`, `npm run research:check-p04`, both clean-copy scripts, and `git diff --check` pass from the committed head;
- an independent full P04 review reports zero Critical and zero Important findings;
- the repository remains private and P04 has not pushed, merged, published, installed persistently, or implemented production onboarding/lifecycle behavior.

P04 does not prove recommendation resolution, consent UX, production install/update/remove/resume, platform adapters, domain plugins, owned-gap implementation, bilingual docs, semantic RC, or private-main integration. Those remain P05-P12.
