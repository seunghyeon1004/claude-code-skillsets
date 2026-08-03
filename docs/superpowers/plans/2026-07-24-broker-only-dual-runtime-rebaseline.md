# Broker-Only Dual-Runtime Rebaseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` and execute each task as one reviewed,
> compiling unit. Do not split an atomic task into intermediate commits.

**Goal:** Replace the owned-gap, Claude-only, and foundation-purpose-provider
foundation with an external-only Claude Code and Codex broker contract while
preserving exactly 20 domains, 281 categories, 147 capabilities, 40 packs, and 120
pack scenarios.

**Architecture:** Preserve the immutable P03 discovery census byte-for-byte. Make
provider eligibility and evidence specific to one runtime and one operating system,
remove every owned-purpose fallback, and derive pack availability from eligible
external providers. Repository-local skills may implement only broker behavior and
must never satisfy a purpose capability or pack outcome. Live market research and
real installation remain later phases.

**Tech Stack:** Node.js 22+, npm, TypeScript 7.0.2, Vitest 4.1.10, Ajv
8.20.0, YAML 2.9.0, semver 7.8.5, Claude Code 2.1.198+, Codex CLI
0.145.0+, Git, Bash, and GitHub CLI.

## Global Constraints

- Keep the GitHub repository PRIVATE. Do not push, merge to `main`, publish a
  marketplace, make a public release, or alter real Claude Code/Codex user state.
- The approved source of truth is
  `docs/superpowers/specs/2026-07-24-broker-only-skill-registry-design.md`.
  Its private development baseline is not published.
- Preserve exactly `20/281/147/40/120` catalog counts and all existing domain,
  category, capability, pack, and scenario identities.
- Preserve every protected P03 file and Git blob authenticated by the sole annotated
  `public-history/root-vN` governance tag. The public root determines the selector
  tree, path count, and digest dynamically; private baseline IDs are not published.
- The repository owns only broker machinery and thin routing profiles. It must not
  define, generate, embed, copy, fork, or install a repository-owned
  purpose-specific skill.
- External provider code stays at its original upstream source. A provider contract
  pins an unchanged original native plugin or Agent Skill revision and its selected
  artifact digests.
- Supported runtimes are exactly `claude-code` and `codex`; supported platforms are
  exactly `darwin`, `linux`, and `win32`.
- Runtime and platform evidence never transfer. Observed evidence names exactly one
  runtime and one platform; only enumerated static evidence may be target-neutral.
- External providers can be at most `trusted`; `verified` is reserved for
  repository-owned broker release artifacts.
- There is no daily discovery job. Later research supports one weekly batch, manual
  refresh, optional pre-plan candidate discovery, and immediate known-risk
  revocation.
- Every future real install or update requires one exact preview and final user
  approval. Research trials use disposable state only.
- Every task uses TDD, runs focused tests and `npm run check`, ends in a DCO-signed
  commit, and leaves a compiling worktree.

## Entry Evidence

- Branch: `feature/complete-v1` in `.worktrees/complete-v1`.
- Approved design: private development baseline not published.
- P02 PASS.
- P03 exit: 15 sources and 658 tests; private development history not published.
- Rejected old P04 attempt was independently reviewed at
  `Critical 0 / Important 3 / Minor 1` before the user replaced its premise.
- Controller baseline before this rebaseline: 36 test files and 666 tests pass.
- Production providers, reviews, conflicts, selections, and owned gaps contain no
  records; only construction sentinels exist.

## Frozen Contracts

```ts
export const SUPPORTED_RUNTIMES = ["claude-code", "codex"] as const;
export type RuntimeId = typeof SUPPORTED_RUNTIMES[number];

export const SUPPORTED_PLATFORMS = ["darwin", "linux", "win32"] as const;
export type Platform = typeof SUPPORTED_PLATFORMS[number];

export interface RuntimeTarget {
  runtime: RuntimeId;
  platform: Platform;
}

export type TargetDisposition =
  | "selected"
  | "alternate"
  | "rejected"
  | "unavailable";

export type TargetReleaseEvidence = "trialed-p04" | "not-applicable";
export type PackAvailability =
  | "available"
  | "available-with-gaps"
  | "unavailable"
  | "action-required";
export type AssuranceProfile = "standard" | "high-impact";

export interface ProviderTargetSelection extends RuntimeTarget {
  disposition: TargetDisposition;
  preferredProviderId?: string;
  eligibleAlternateProviderIds: string[];
  terminalReviewIds: string[];
  decisionReasons: string[];
  releaseEvidence: TargetReleaseEvidence;
}

export interface ProviderSelectionManifest {
  schemaVersion: 2;
  id: string;
  capabilityId: string;
  searchRecordId: string;
  targets: ProviderTargetSelection[];
}

export interface CapabilityTargetSearch extends RuntimeTarget {
  candidateIds: string[];
  evidenceIds: string[];
}

export interface CapabilitySearchRecord {
  id: string;
  capabilityId: string;
  targets: CapabilityTargetSearch[];
}
```

Every selection and capability search contains these six cells in exactly this
order:

```ts
const TARGETS = [
  ["claude-code", "darwin"],
  ["claude-code", "linux"],
  ["claude-code", "win32"],
  ["codex", "darwin"],
  ["codex", "linux"],
  ["codex", "win32"]
] as const;
```

`pending-p11` is deliberately absent. P04B does not commit a selection manifest
until all six cells have terminal evidence. P04A must therefore provide disposable
trial adapters on all three operating systems. An untrialed cell cannot be encoded
as eligible or released as a partial selection.

---

### Task 1: Atomically Cut Over to External-Only Target Contracts

**Files:**
- Delete: `schemas/v2/owned-gap-decision.schema.json`
- Delete: `manifests/owned-gaps/.gitkeep`
- Modify: `src/model/complete-v1.ts`
- Modify: `schemas/v2/provider.schema.json`
- Modify: `schemas/v2/provider-selection.schema.json`
- Modify: `schemas/v2/source-review.schema.json`
- Modify: `schemas/v2/research-evidence.schema.json`
- Modify: `schemas/v2/research-queue.schema.json`
- Modify: `schemas/v2/conflict-group.schema.json`
- Create: `schemas/v2/review-source-extension-index.schema.json`
- Create: `research/review-source-extensions.json`
- Create: `research/current-evaluation-context.json`
- Create: `scripts/research/assert-extension-append-only.ts`
- Modify: `package.json`
- Modify: `src/contracts/complete-v1.ts`
- Modify: `src/research/repository.ts`
- Modify: `src/research/governance.ts`
- Modify: `src/research/queue.ts`
- Modify: `src/research/graph.ts`
- Modify: `src/research/reports.ts`
- Modify: `src/research/coverage.ts`
- Modify: `src/research/freshness.ts`
- Modify: `tests/unit/complete-v1-types.test.ts`
- Modify: `tests/unit/complete-v1-contracts.test.ts`
- Modify: `tests/fixtures/contracts/v2/provider.valid.yaml`
- Modify: `tests/unit/research-repository.test.ts`
- Modify: `tests/unit/research-governance.test.ts`
- Modify: `tests/unit/research-queue.test.ts`
- Modify: `tests/unit/research-graph.test.ts`
- Modify: `tests/unit/research-reports.test.ts`
- Replace: `tests/unit/research-coverage.test.ts`
- Modify: `tests/unit/research-freshness.test.ts`
- Modify: `tests/integration/research-governance.test.ts`
- Preserve: `tests/fixtures/research/p04-capability-universe.json`
- Preserve: `tests/fixtures/research/p04-wave-coverage.json`

**Atomic boundary:** This task replaces canonical provider, review, queue, graph,
coverage, report, and repository contracts in one commit. There is no transitional
`OwnedProvider | ExternalProvider` union and no intermediate commit that changes a
producer while leaving an `installStrategy` or top-level `platforms` consumer.

- [ ] **Step 1: Write the failing closed-contract and target-isolation tests**

Test removal of `OwnedProvider`, `OwnedGapDecision`, `installStrategy`,
`ownedGapDecisionId(s)`, `ownedGapDecisions`, `platformRoles`, and global selection
dispositions. Test one and two sorted runtime contracts, all six ordered selection
and search cells, and every positive and negative disposition branch.

Replace global conflict preference with target-specific conflict facts:

```ts
export interface ConflictGroupManifest extends RuntimeTarget {
  schemaVersion: 2;
  id: string;
  capabilityId: string;
  mode: "mutually-exclusive" | "redundant" | "composable";
  providerIds: string[];
  rationale: LocalizedText;
}
```

`preferredProviderId` is removed. A conflict record applies to exactly one
capability/runtime/platform; preferred and alternate roles are decided only by the
matching selection cell. Test that a Claude conflict cannot constrain Codex and
that a conflict for capability A cannot influence capability B.

Use these provider identities:

```ts
export interface ReviewedArtifact {
  path: string;
  sha256: string;
}

export interface NativePluginRuntimeContract {
  runtime: RuntimeId;
  packaging: "native-plugin";
  runtimeVersionRange: string;
  platforms: Platform[];
  marketplaceId: string;
  marketplaceSource: string;
  pluginId: string;
  reviewedCommit: string;
  artifacts: ReviewedArtifact[];
}

export interface AgentSkillRuntimeContract {
  runtime: RuntimeId;
  packaging: "agent-skill";
  runtimeVersionRange: string;
  platforms: Platform[];
  repositoryUrl: string;
  subdirectory: string;
  ref: string;
  reviewedCommit: string;
  artifacts: ReviewedArtifact[];
}

export type ProviderRuntimeContract =
  | NativePluginRuntimeContract
  | AgentSkillRuntimeContract;

export interface ProviderManifest {
  schemaVersion: 2;
  id: string;
  capabilityIds: string[];
  sourceReviewId: string;
  permissions: PermissionDeclaration;
  version: string;
  status: ReleaseStatus;
  trustTier: "trusted" | "community" | "blocked";
  runtimeContracts: ProviderRuntimeContract[];
}
```

All sets are code-point sorted and unique. `runtimeContracts` contains one or two
distinct runtime entries in `SUPPORTED_RUNTIMES` order. `platforms`, capabilities,
and artifacts are non-empty. Every schema object, including nested objects, has
`additionalProperties: false`. Each artifact path is inside the pinned selected
subtree and each SHA-256 is 64 lowercase hex characters.

Command-bearing identity fields use closed safe grammars. Marketplace/plugin IDs
match `^[a-z0-9][a-z0-9._-]*$`. Repository and marketplace sources normalize to a
credential-free canonical HTTPS repository URL with no query, fragment, port, dot
segment, or trailing slash. Subdirectories and artifact paths are normalized
relative POSIX paths with no empty, `.`, `..`, backslash, control, or absolute
segment. `runtimeVersionRange` passes `semver.validRange()` and cannot be empty or a
wildcard-only range. `reviewedCommit` is exactly 40 lowercase hex characters; `ref`
is provenance only, and every install/update adapter must address the reviewed
commit and verified artifacts rather than resolving a mutable ref at execution.
Add negative tests for shell metacharacters, option-like IDs, credentials,
non-HTTPS URLs, encoded traversal, noncanonical paths, invalid/wildcard version
ranges, uppercase/short SHAs, and a ref/commit mismatch against immutable evidence.

Use an exact evidence scope, never a platform array:

```ts
export type EvidenceScope =
  | { runtime: null; platform: null; capabilityId: null }
  | { runtime: RuntimeId; platform: Platform; capabilityId: null }
  | { runtime: RuntimeId; platform: Platform; capabilityId: string };

export type StaticEvidenceKind =
  | "source-identity" | "marketplace-identity" | "license"
  | "surface-inventory" | "permissions" | "secret-flow"
  | "maintenance" | "documentation";

export type TargetEvidenceKind =
  | "compatibility" | "install-smoke" | "update-smoke"
  | "remove-smoke" | "doctor-smoke" | "lifecycle";

export type CapabilityTargetEvidenceKind =
  | "outcome-evaluation" | "semantic-smoke" | "high-impact-review";
```

Only `StaticEvidenceKind` accepts the all-null scope. `TargetEvidenceKind` names one
concrete target and requires `capabilityId:null` because install/lifecycle evidence
is provider-revision-wide. `CapabilityTargetEvidenceKind` names one concrete target
and one capability ID because outcome, semantic, and high-impact evidence cannot
transfer between capabilities. `SourceReviewManifest.compatibility` is a sorted
array of `{runtime, runtimeVersionRange, platforms}` records.

`SearchEvidence` also names exactly one `RuntimeTarget`. Each
`CapabilityTargetSearch` may reference only discovery candidates and passed search
evidence for its own target. A Claude-only candidate may appear in Claude cells and
be absent from Codex cells; it never prevents an honest Codex `unavailable` result.

Keep frozen `research/review-source-index.json` unchanged and add this mutable,
initially empty ownership extension:

```ts
export interface ReviewSourceExtensionIndex {
  schemaVersion: 2;
  triads: ReviewSourceTriad[];
}
```

`research/review-source-extensions.json` begins as
`{"schemaVersion":2,"triads":[]}`. The loader and graph validate the union of the
frozen census, frozen review-source index, and mutable extension triads. IDs are
sorted, unique across all three owners, immutable after insertion, and every
extension triad must be reachable from a target search, review, or evidence record.
P04B may add new source/receipt/snapshot files only together with one exact extension
triad; it cannot modify a P03 path or leave an unowned file.

Current-state validation is insufficient for append-only history, so add
`npm run verify:research-append-only -- --base "$BASE_SHA"`, where `BASE_SHA` is the
exact prior approved registry commit. The checker
loads the extension index at the named prior approved Git commit and the current
tree, requires every prior triad to remain byte-for-byte identical, permits only new
unique triads, and compares the Git blob identity of every previously owned source,
receipt, and snapshot path. Deletion, rename, ID reassignment, content replacement,
or a base that is not an ancestor fails. The same additions-only rule covers every
prior `research/evidence/*.json` record and every literal artifact path referenced
under `research/evidence/artifacts/`: evidence IDs, record blobs, artifact paths,
and artifact blobs cannot be deleted, renamed, reassigned, or rewritten. It also
requires all prior observations in `current-evaluation-context.json` to remain
identical and permits only later observations plus monotonic clock fields. Queue,
providers, selections, and current recommendations may evolve, but issued evidence
does not.

R01 unit tests cover empty-to-add success, second addition success, and triad,
evidence-record, artifact, observation, deletion, rewrite, and base-not-ancestor
failures. P04B accepts only an annotated `registry-approved/*` tag whose tag-object
ID equals the separately supplied protected CI/operator input
`APPROVED_REGISTRY_TAG_OBJECT`; lightweight, missing, moved/mismatched, or
non-ancestor tags fail. R01 creates `registry-approved/r01` only after final review.
P04B cannot choose a convenient newer ancestor as its base.

Approval tags form an append-only chain, not one permanent R01 base. Each reviewed
P04B batch creates a new unique annotated tag
`registry-approved/research-NNNN`; its annotation records the monotonic sequence,
the immediately previous approved tag name and tag-object ID, and the reviewed batch
HEAD. Existing tags are never moved or deleted. The checker requires the protected
input to equal the latest chain tag object, validates the annotation link and target
ancestry, and permits only the next sequence. After batch review and tag validation,
an authorized operator atomically replaces the protected input with the new tag
object. The next weekly/manual run must use that immediate predecessor, so evidence
introduced by the prior batch becomes immutable. Failed or unreviewed batches never
advance the chain. Add tests for skipped/reused sequence, stale R01 base, forked
predecessor, moved tag, wrong tag object, and successful consecutive batches.

Likewise, preserve `research/evaluation-context.json` as `baselineContext` and add
`research/current-evaluation-context.json` as the mutable `context` used by
freshness and governance. At R01 creation the current file is semantically identical
to the P03 baseline. The loader requires its `asOf` not to precede the baseline,
validates every observation against the union-owned snapshots, and rejects removal
or mutation of a baseline observation. P04B advances only the current context and
adds observations; it never rewrites the protected baseline file.

Test this target-aware interface:

```ts
export interface ProviderTargetEligibility {
  providerId: string;
  capabilityId: string;
  target: RuntimeTarget;
  eligible: boolean;
  assuranceProfiles: AssuranceProfile[];
  evidenceIds: string[];
  reasonCodes: string[];
}

export interface ProviderCapabilityTargetReview extends RuntimeTarget {
  capabilityId: string;
  decision: "eligible" | "rejected" | "revoked";
  assuranceProfiles: AssuranceProfile[];
  hardGates: HardGateResult[];
  evidenceIds: string[];
  scoreCriteria: ScoreCriterionResult[];
  score: ScoreBreakdown;
  decisionReasons: string[];
}

export function evaluateProviderTargetEligibility(input: {
  provider: ProviderManifest;
  review: SourceReviewManifest;
  evidence: readonly ResearchEvidence[];
  capabilityId: string;
  target: RuntimeTarget;
}): ProviderTargetEligibility;
```

Eligibility requires matching provider/review runtime versions, claimed platform,
immutable commit and artifact identity, all target-observed install, semantic,
update, remove, doctor, lifecycle, and compatibility evidence, and all shared static
gates. One target's evidence cannot satisfy another.

Replace the old global `SourceReviewManifest.decision`, `revoked`, and
target-sensitive gate result with a code-point-sorted
`capabilityTargetReviews: ProviderCapabilityTargetReview[]`. Reviews exist only for
the provider's declared capabilities and matching candidate target-search cells. A
provider can therefore be eligible for capability A on Claude Code/Darwin, rejected
for capability B on the same target, and rejected on Codex/Darwin without any result
overwriting or proving another. Remove provider-wide
`SourceReviewManifest.scoreCriteria` and `score`: every score criterion, score
component, hard gate, assurance profile, and decision is computed and stored on the
matching capability-target review. Static evidence may be referenced by several
reviews, but a score or passing outcome is never copied between capabilities or
targets. Reports aggregate explicit capability-target scores only and tests prove
that strong capability A results cannot promote capability B.

`standard` assurance requires distinct passed `semantic-smoke` records classified
normal and boundary plus a separate passed `outcome-evaluation` normal record for
the exact capability and target, in addition to every provider/target gate.
`high-impact` requires that standard base, at least one distinct passed
`semantic-smoke` refusal record, and a passing target-specific
`high-impact-review` for that same capability with an independent reviewer and
explicit approval. A capability-target review declares sorted
`assuranceProfiles`; it may claim a profile only when those machine-checked evidence
requirements pass. Both profiles still require provider `trustTier: "trusted"`
before selection. Negative tests prove one happy-path result cannot satisfy both
normal and boundary and that standard cannot be inferred from unclassified legacy
smoke evidence, outcome-only evidence, or the wrong evidence kind for a case class.

Make `high-impact-review` a closed structured `ResearchEvidence` variant rather than
trusting arbitrary artifact prose:

```ts
export interface CapabilityResultEvidence extends ReviewEvidenceBase {
  kind: "outcome-evaluation" | "semantic-smoke";
  scope: { runtime: RuntimeId; platform: Platform; capabilityId: string };
  reviewedCommit: string;
  caseId: string;
  caseClass: "normal" | "boundary" | "refusal";
  outcome: "passed" | "failed";
}

export interface HighImpactReviewEvidence extends ReviewEvidenceBase {
  kind: "high-impact-review";
  scope: { runtime: RuntimeId; platform: Platform; capabilityId: string };
  reviewedCommit: string;
  reviewedArtifactSha256s: string[];
  reviewerId: string;
  collectorId: string;
  upstreamAuthorIds: string[];
  independenceAttestation: string;
  normalResultEvidenceIds: string[];
  boundaryResultEvidenceIds: string[];
  refusalResultEvidenceIds: string[];
  decision: "approved";
}
```

The schema and semantic loader require non-empty sorted unique result references,
bind every result to the same provider/review/commit/capability/target and a passed
`semantic-smoke` `CapabilityResultEvidence`, require each list to reference only its
declared `caseClass`, require the three lists to be pairwise disjoint, match the
runtime-contract artifact digest set exactly, and require `reviewerId` to differ
from `collectorId` and every upstream author. The evidence artifact hash is still
verified, but the structured records are the enforceable decision. Add negative
tests for arbitrary text, missing/misclassified case classes, reused IDs across
lists, wrong-kind-only evidence, cross-capability/target/commit references, digest
drift, self-review, and non-approved decisions.

Disposition rules are mutually exclusive:

- `selected`: an eligible preferred external provider, optional eligible
  alternates, and `trialed-p04` for this exact target.
- `alternate`: recommended-only, an eligible non-default preferred provider,
  optional eligible alternates, and `trialed-p04` for this exact target.
- `rejected`: zero provider IDs, one or more exact terminal reviews bound to the
  matching capability-search target, every candidate in that target cell containing
  a `rejected` or `revoked` review for the same capability and target, no eligible
  candidate, passed target search evidence, and `not-applicable`. Decision reasons
  and terminal review references preserve which candidates were rejected versus
  revoked.
- `unavailable`: zero provider IDs, zero terminal reviews, zero candidates in the
  matching capability-search target cell, passed immutable target-specific
  no-candidate search evidence, and
  `not-applicable`.

Add tests proving an untrialed route cannot be `selected`/`alternate`, cannot use a
`pending-p11` value, and cannot contribute pack availability later. Add revoked-only
and mixed rejected/revoked target-cell tests and prove neither can be silently
reclassified as no-candidate `unavailable`; an installed revoked binding also feeds
Task 3 `action-required` diagnostics.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts tests/unit/research-repository.test.ts tests/unit/research-governance.test.ts tests/unit/research-queue.test.ts tests/unit/research-graph.test.ts tests/unit/research-reports.test.ts tests/unit/research-coverage.test.ts tests/unit/research-freshness.test.ts tests/integration/research-governance.test.ts
```

Expected: FAIL on old owned/global/runtime-transferable contracts.

- [ ] **Step 3: Implement the one-pass migration**

Remove all owned branches, loaders, schemas, directories, indexes, report sections,
and helpers. The final `ResearchRepository` has census, review-source index,
evaluation context, source configs, receipts, snapshots, evidence, queue, providers,
source reviews, conflicts, and optional provider selections only. Production's empty
future collections remain valid.

`validateP04CapabilityCoverage()` retains all 147 capabilities, 101 required and 46
recommended-only, and wave counts `33/26/7`, `38/23/15`, `40/32/8`, and
`36/20/16`. It requires one six-cell search and one six-cell selection per
capability, joins cells by exact target, and allows honest required-target
unavailability.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts tests/unit/research-repository.test.ts tests/unit/research-governance.test.ts tests/unit/research-queue.test.ts tests/unit/research-graph.test.ts tests/unit/research-reports.test.ts tests/unit/research-coverage.test.ts tests/unit/research-freshness.test.ts tests/integration/research-census.test.ts tests/integration/research-governance.test.ts
npm run check
git diff --check
git add src/model/complete-v1.ts src/contracts/complete-v1.ts src/research/repository.ts src/research/governance.ts src/research/queue.ts src/research/graph.ts src/research/reports.ts src/research/coverage.ts src/research/freshness.ts schemas/v2/provider.schema.json schemas/v2/provider-selection.schema.json schemas/v2/source-review.schema.json schemas/v2/research-evidence.schema.json schemas/v2/research-queue.schema.json schemas/v2/conflict-group.schema.json schemas/v2/review-source-extension-index.schema.json research/review-source-extensions.json research/current-evaluation-context.json scripts/research/assert-extension-append-only.ts package.json tests/fixtures/contracts/v2/provider.valid.yaml tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts tests/unit/research-repository.test.ts tests/unit/research-governance.test.ts tests/unit/research-queue.test.ts tests/unit/research-graph.test.ts tests/unit/research-reports.test.ts tests/unit/research-coverage.test.ts tests/unit/research-freshness.test.ts tests/integration/research-governance.test.ts
git add -u schemas/v2/owned-gap-decision.schema.json manifests/owned-gaps/.gitkeep
git commit -s -m "refactor: make provider research external-only"
```

---

### Task 2: Migrate Packs and Preserve High-Impact Safety

**Files:**
- Modify: `src/model/complete-v1.ts`
- Modify: `schemas/v2/pack.schema.json`
- Modify: `src/catalog/validate-graph.ts`
- Modify: `src/catalog/replacement-equivalence.ts`
- Modify: `src/manifest/complete-v1-repository.ts`
- Modify: `src/manifest/repository.ts`
- Modify: all 40 tracked `manifests/complete-v1-packs/*.yaml`
- Modify: complete-v1 repository fixtures
- Modify: `tests/unit/complete-v1-types.test.ts`
- Modify: `tests/unit/complete-v1-contracts.test.ts`
- Modify: `tests/unit/complete-v1-graph.test.ts`
- Modify: `tests/unit/complete-v1-repository.test.ts`
- Modify: `tests/unit/replacement-equivalence.test.ts`
- Modify: `tests/unit/research-governance.test.ts`
- Modify: `tests/unit/research-graph.test.ts`
- Modify: `tests/unit/research-reports.test.ts`
- Modify: `tests/integration/complete-v1-catalog.test.ts`
- Modify: `tests/integration/generation.test.ts`

**Exact sets:** The 40-pack path list has SHA-256
`1c6e61f25ec1b09b772d28d1e02118e25f278672cd6ff38ffc5df776ea36f304`.

- [ ] **Step 1: Write failing pack-migration tests**

Use this pack contract:

```ts
export interface CompletePackManifest {
  schemaVersion: 2;
  id: string;
  domainId: DomainId;
  categoryIds: string[];
  outcome: LocalizedText;
  inputs: string[];
  outputs: string[];
  completionCriteria: string[];
  routingProfileId: DomainId;
  requiredCapabilityIds: string[];
  recommendedCapabilityIds: string[];
  optionalCapabilityIds: string[];
  platforms: Platform[];
  minimumProviderTrust: "trusted";
  assuranceProfile: AssuranceProfile;
  scenarios: ScenarioReference[];
  replacesPackIds: PackId[];
  version: string;
  status: ReleaseStatus;
}
```

All 40 packs use `routingProfileId === domainId`, have no `runtimeBundle`,
`ownedSkillIds`, or old `trustRequirement`, and retain all other content exactly.
The exact former 18 `verified` packs become `high-impact`:

```text
application-to-security-review
bug-report-to-verified-fix
contract-to-risk-and-revision-brief
customer-problem-to-validated-prd
evidence-to-strategic-decision
incident-alert-to-postmortem
prd-to-prioritized-roadmap
prototype-to-evaluated-agent
raw-data-to-validated-dataset
raw-footage-to-published-video
regulation-to-compliance-checklist
repetitive-work-to-approved-automation
repository-to-implementation-plan
role-need-to-interview-scorecard
service-to-ci-cd-deployment
spec-to-tested-feature
transactions-to-management-report
use-case-to-agent-design
```

The other 22 are `standard`. High-impact eligibility later requires target evidence
with `high-impact` assurance and an extra explicit approval in the real preview.

Test that the same pack ID remains one of the 40 complete-v1 packs but its complete
contract contains no local-provider field. The legacy foundation projection is
removed atomically in Task 5 rather than partially in this task.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts tests/unit/complete-v1-graph.test.ts tests/unit/complete-v1-repository.test.ts tests/unit/replacement-equivalence.test.ts tests/unit/research-governance.test.ts tests/unit/research-graph.test.ts tests/unit/research-reports.test.ts tests/integration/complete-v1-catalog.test.ts tests/integration/generation.test.ts
```

- [ ] **Step 3: Perform the atomic complete-pack migration**

Mechanically edit exactly the 40 tracked manifests. Remove the legacy foundation
fields from complete-v1 consumers and fixtures. Preserve the current foundation
projection unchanged until Task 5 removes it and switches generation in one commit.

- [ ] **Step 4: Verify and commit**

```bash
test "$(git ls-files 'manifests/complete-v1-packs/*.yaml' | wc -l | tr -d ' ')" = 40
test "$(git ls-files 'manifests/complete-v1-packs/*.yaml' | LC_ALL=C sort | shasum -a 256 | awk '{print $1}')" = 1c6e61f25ec1b09b772d28d1e02118e25f278672cd6ff38ffc5df776ea36f304
npm test -- tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts tests/unit/complete-v1-graph.test.ts tests/unit/complete-v1-repository.test.ts tests/unit/replacement-equivalence.test.ts tests/unit/research-governance.test.ts tests/unit/research-graph.test.ts tests/unit/research-reports.test.ts tests/integration/complete-v1-catalog.test.ts tests/integration/generation.test.ts
npm run check
git diff --check
git add src/model/complete-v1.ts schemas/v2/pack.schema.json src/catalog/validate-graph.ts src/catalog/replacement-equivalence.ts src/manifest/complete-v1-repository.ts src/manifest/repository.ts manifests/complete-v1-packs tests/fixtures/complete-v1-repository tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts tests/unit/complete-v1-graph.test.ts tests/unit/complete-v1-repository.test.ts tests/unit/replacement-equivalence.test.ts tests/unit/research-governance.test.ts tests/unit/research-graph.test.ts tests/unit/research-reports.test.ts tests/integration/complete-v1-catalog.test.ts tests/integration/generation.test.ts
git commit -s -m "refactor: make complete packs broker routes"
```

---

### Task 3: Derive Trust- and Evidence-Aware Pack Availability

**Files:**
- Create: `src/catalog/availability.ts`
- Create: `tests/unit/pack-availability.test.ts`
- Modify: `src/model/complete-v1.ts`
- Modify: `tests/integration/complete-v1-catalog.test.ts`

- [ ] **Step 1: Write the failing decision table**

```ts
export type ProviderIneligibilityReason =
  | "revoked" | "deleted" | "license-changed" | "incompatible-update";

export interface InstalledCapabilityProvider {
  capabilityId: string;
  providerId: string;
}

export interface InstalledProviderFailure extends RuntimeTarget {
  providerId: string;
  reason: ProviderIneligibilityReason;
}

export interface InstalledTargetHealth {
  bindings: InstalledCapabilityProvider[];
  failures: InstalledProviderFailure[];
}

export interface ResolvedCapabilityProvider {
  capabilityId: string;
  providerId: string;
  role: "selected" | "alternate";
}

export interface ActionRequiredIssue {
  capabilityId: string;
  providerId: string;
  reason: ProviderIneligibilityReason;
}

export interface PackAvailabilityResult extends RuntimeTarget {
  packId: PackId;
  availability: PackAvailability;
  resolvedProviders: ResolvedCapabilityProvider[];
  missingRequiredCapabilityIds: string[];
  missingRecommendedCapabilityIds: string[];
  actionRequiredIssues: ActionRequiredIssue[];
}

export function derivePackAvailability(input: {
  pack: CompletePackManifest;
  selections: readonly ProviderSelectionManifest[];
  providers: readonly ProviderManifest[];
  eligibility: readonly ProviderTargetEligibility[];
  target: RuntimeTarget;
  installed: InstalledTargetHealth | null;
}): PackAvailabilityResult;
```

Cover these results:

```text
required selected + recommended selected = available
required selected + recommended eligible alternate = available
required selected + recommended rejected/unavailable = available-with-gaps
required alternate/rejected/unavailable = unavailable
selected provider with only community trust = unavailable
high-impact pack with only standard assurance = unavailable
any installed preferred or user-chosen alternate binding that becomes
  revoked/deleted/license-changed/incompatible-update = action-required
```

For each capability, zero or one installed binding may exist. A healthy installed
binding to the matching cell's preferred provider resolves with role `selected`; a
healthy binding to an `eligibleAlternateProviderIds` member resolves with role
`alternate` and continues satisfying required or recommended coverage without
silently switching back to the preferred provider. With no installed binding, the
preferred route is used. Duplicate capability bindings, an unlisted provider,
wrong-target eligibility, or an ineligible binding without a matching declared
failure make the health input invalid. A listed preferred or alternate binding with
a declared target failure yields the exact `action-required` issue.

Also reject missing/duplicate selection, provider, or eligibility records; target
mismatches; selected routes whose `releaseEvidence` is not `trialed-p04`; unsorted
outputs; and installed failures unrelated to a capability in the pack. Result arrays
are code-point sorted by capability ID, then provider ID, role/reason where present,
and contain no duplicates. Missing and action-required diagnostics remain visible
even when precedence chooses a single top-level availability state.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/pack-availability.test.ts
```

- [ ] **Step 3: Implement the pure derivation**

Eligibility, provider trust, and pack assurance are all required. `action-required`
has precedence for an installed binding used by any required, recommended, or
optional pack capability. Otherwise `unavailable` precedes
`available-with-gaps`, which precedes `available`. The function performs no I/O,
detection, recommendation, installation, or mutation.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/unit/pack-availability.test.ts tests/integration/complete-v1-catalog.test.ts
npm run check
git diff --check
git add src/catalog/availability.ts src/model/complete-v1.ts tests/unit/pack-availability.test.ts tests/integration/complete-v1-catalog.test.ts
git commit -s -m "feat: derive evidence-aware pack availability"
```

---

### Task 4: Pin P03 Evidence to the Approved Git Baseline

**Files:**
- Create: `scripts/research/assert-p03-immutable.ts`
- Create: `tests/unit/p03-immutability.test.ts`
- Modify: `package.json`

The protected set is the literal path set returned by `git ls-tree` from the commit
directly authenticated by the sole annotated `public-history/root-vN` governance tag,
under these baseline selectors:

```text
research/census-observed-at.txt
research/census.json
research/evaluation-context.json
research/review-source-index.json
research/sources/*.json
research/receipts/*.json
research/snapshots/*.json
```

The public root determines the current path count and tree digest. The selectors are
used only to discover the baseline literal path list; they are not directory-wide
immutability rules at later commits. `research/review-queue.json`, schemas, source
code, and empty future evidence roots are mutable. New P04B source, receipt, snapshot,
and evidence paths may be added, but none of the root-authenticated baseline paths may
be modified, deleted, renamed, or replaced.

- [ ] **Step 1: Write a failing tamper test**

The test invokes the checker against a clean copy, changes one protected byte,
requires a path/blob mismatch, restores it, and proves that changing a nonprotected
queue fixture or adding a new uniquely named receipt does not alter the protected
result.

- [ ] **Step 2: Implement baseline comparison**

The checker obtains the root-authenticated baseline entries with:

```bash
git ls-tree -r "${PUBLIC_ROOT_COMMIT:?authenticated public root commit required}" -- research/census-observed-at.txt research/census.json research/evaluation-context.json research/review-source-index.json research/sources research/receipts research/snapshots
```

It derives the path count and exact SHA-256 digest from the authenticated root's raw
`ls-tree` output,
then hashes the current protected working-tree files with Git blob semantics and
compares every baseline mode, object ID, and literal path to that baseline. It does
not count or reject additional future files. A rewritten self-consistent P03 receipt
cannot pass.

- [ ] **Step 3: Verify and commit**

```bash
npm test -- tests/unit/p03-immutability.test.ts tests/integration/research-census.test.ts
npm run check
npm run verify:p03-immutable
git diff --check
git add scripts/research/assert-p03-immutable.ts tests/unit/p03-immutability.test.ts package.json
git commit -s -m "test: pin p03 immutable research evidence"
```

---

### Task 5: Prove Atomic Loading, Generation, and Broker-Only Output

**Files:**
- Delete: `src/catalog/foundation-migration.ts`
- Delete: `manifests/migrations/foundation-0.1-to-v2.yaml`
- Delete: `manifests/packs/repository-to-implementation-plan.yaml`
- Delete: `tests/evaluations/repository-to-implementation-plan.yaml`
- Delete: `tests/fixtures/foundation-migration/contract.valid.yaml`
- Delete: `tests/fixtures/foundation-migration/legacy-state.json`
- Delete: `tests/unit/foundation-migration.test.ts`
- Modify: `src/research/repository.ts`
- Modify: `src/manifest/repository.ts`
- Modify: `src/manifest/complete-v1-repository.ts`
- Modify: `src/generate/all.ts`
- Modify: `src/generate/catalog.ts`
- Modify: `src/generate/marketplace.ts`
- Modify: `src/cli.ts`
- Modify: `src/model/install-index.ts`
- Modify: `src/policy/publication.ts`
- Modify: `package.json`
- Create: `scripts/verify-broker-only.ts`
- Modify: `tests/unit/manifest-loader.test.ts`
- Modify: `tests/unit/install-planner.test.ts`
- Modify: `tests/unit/dependency-graph.test.ts`
- Modify: `tests/unit/research-repository.test.ts`
- Modify: `tests/integration/generation.test.ts`
- Modify: `tests/integration/manager-generation.test.ts`
- Modify: `tests/integration/setup-skill.test.ts`
- Modify: `tests/integration/doctor-skill.test.ts`
- Modify: `tests/evaluations/skillset-manager/doctor/01-normal-primary.yaml`
- Modify: `tests/evaluations/skillset-manager/doctor/03-normal-minimal.yaml`
- Modify: `tests/evaluations/skillset-manager/doctor/04-boundary-loophole.yaml`
- Modify: `tests/evaluations/skillset-manager/doctor/05-boundary-pressure.yaml`
- Modify: affected files under `tests/fixtures/setup-evaluations/`
- Modify: affected files under `tests/fixtures/doctor-evaluations/`
- Modify: `tests/e2e/clean-copy.sh`
- Modify: `.claude-plugin/marketplace.json` only through `npm run generate`
- Modify generated files only through `npm run generate`

The repository-local skill allowlist is exactly these ten broker skills:

```text
plugins/shared-core/skills/evidence-provenance/SKILL.md
plugins/shared-core/skills/handoff-continuity/SKILL.md
plugins/shared-core/skills/intent-to-brief/SKILL.md
plugins/shared-core/skills/plan-and-checkpoints/SKILL.md
plugins/shared-core/skills/quality-verification/SKILL.md
plugins/shared-core/skills/risk-privacy-permissions/SKILL.md
plugins/shared-core/skills/workflow-router/SKILL.md
plugins/shared-core/skills/workspace-context/SKILL.md
plugins/skillset-manager/skills/doctor/SKILL.md
plugins/skillset-manager/skills/setup/SKILL.md
```

They may support broker setup, routing, consent, safety, verification, and
continuity only. No local plugin or skill may satisfy a catalog capability, pack
input/output, or pack outcome. Adding another local skill fails the invariant test.

- [ ] **Step 1: Write failing output and clean-copy tests**

Load the production repository with empty provider/selection roots, no owned root,
the exact P03 baseline, all 40 packs, and no legacy local purpose pack. Generate
twice after shuffling every loaded collection and require byte-identical output.

At R01 exit the empty provider/selection roots produce exactly zero availability
records and zero activatable purpose-pack profiles. The catalog may expose all 40
pack definitions as non-release `research-pending` metadata, but setup cannot
recommend or activate them and must not label them `unavailable`: that terminal
claim requires P04B target search evidence. A partially populated selection root is
invalid and fails loading/generation rather than producing partial availability.

Before RED, capture the exact consumer inventory with:

```bash
rg -l 'FoundationMigration|foundationMigration|repository\.foundation|loadFoundation|repository-to-implementation-plan|shared-core' src tests manifests generated plugins/skillset-manager/data
```

Classify every result in the task report as deleted legacy purpose linkage,
preserved complete-v1 identity/scenario, preserved broker-only skill, or updated
test/fixture. An unclassified current match blocks the commit.

`scripts/verify-broker-only.ts` parses YAML/JSON/schema/generated data and fails on
owned fields, owned strategies, `pending-p11`, local provider linkage, local plugin
fulfillment of a pack capability/outcome, or a repository path used as an external
provider source. It also checks the exact ten-skill broker allowlist.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/research-repository.test.ts tests/unit/manifest-loader.test.ts tests/unit/install-planner.test.ts tests/unit/dependency-graph.test.ts tests/integration/generation.test.ts tests/integration/manager-generation.test.ts tests/integration/setup-skill.test.ts tests/integration/doctor-skill.test.ts
```

- [ ] **Step 3: Complete the atomic loader and generator**

`npm run validate` remains P03-compatible. `npm run generate` consumes routing
profiles, assurance profiles, and external-only provider contracts without
synthesizing a provider. Before P04B, it emits no availability records and no
activatable purpose profiles; only the broker manager/core can be installed.
Provider registry pages remain P10 because P04B has not produced selections.

Delete the old foundation migration and purpose pack atomically with the projection
switch. The complete-v1 `repository-to-implementation-plan` ID and its three pack
scenarios remain. `shared-core` and `skillset-manager` remain only as broker
artifacts; generated output may install the broker manager/core but cannot cite
either as a provider for a pack capability or outcome. Update setup and doctor
fixtures to distinguish broker installation from purpose-provider installation.

Extend clean-copy validation to run `npm ci`, `npm run check`,
`npm run verify:p03-immutable`, append-only research verification against the Task 1
commit, `npm run verify:broker-only`, deterministic generation, and current Claude
plugin syntax validation from a no-hardlinks clone. Do not perform a real Claude or
Codex marketplace/plugin operation.

- [ ] **Step 4: Verify and commit**

`check:generated` compares the working tree with the index, so stage only the four
deterministically generated roots before `npm run check`. Do not stage source/test
changes until the checks pass.

```bash
npm run generate
git add .claude-plugin/marketplace.json generated plugins/skillset-manager/data
npm run check
npm run verify:p03-immutable
task1_sha="${PRIVATE_DEVELOPMENT_TASK1_COMMIT:?private development baseline not published}"
test "$(printf '%s\n' "$task1_sha" | awk 'NF { n++ } END { print n + 0 }')" = 1
npm run verify:research-append-only -- --base "$task1_sha"
npm run verify:broker-only
git diff --check
git add src/research/repository.ts src/manifest/repository.ts src/manifest/complete-v1-repository.ts src/generate/all.ts src/cli.ts scripts/verify-broker-only.ts tests/unit/research-repository.test.ts tests/integration/generation.test.ts tests/e2e/clean-copy.sh package.json
git add src/generate/catalog.ts src/generate/marketplace.ts src/model/install-index.ts src/policy/publication.ts tests/unit/manifest-loader.test.ts tests/unit/install-planner.test.ts tests/unit/dependency-graph.test.ts tests/integration/manager-generation.test.ts tests/integration/setup-skill.test.ts tests/integration/doctor-skill.test.ts tests/evaluations/skillset-manager/doctor/01-normal-primary.yaml tests/evaluations/skillset-manager/doctor/03-normal-minimal.yaml tests/evaluations/skillset-manager/doctor/04-boundary-loophole.yaml tests/evaluations/skillset-manager/doctor/05-boundary-pressure.yaml tests/fixtures/setup-evaluations tests/fixtures/doctor-evaluations
git add -u src/catalog/foundation-migration.ts manifests/migrations/foundation-0.1-to-v2.yaml manifests/packs/repository-to-implementation-plan.yaml tests/evaluations/repository-to-implementation-plan.yaml tests/fixtures/foundation-migration tests/unit/foundation-migration.test.ts
git diff --cached --check
git commit -s -m "refactor: generate broker-only catalog state"
bash tests/e2e/clean-copy.sh
git status --short
```

The no-hardlinks script validates committed `HEAD`, so it runs only after the Task
5 candidate commit. If it fails, repair the task in an additional DCO-signed commit,
rerun focused/full checks and clean-copy, and include the whole Task 5 range in task
review. Do not report Task 5 complete until the post-commit clean-copy passes and the
worktree is clean.

---

### Task 6: Rebaseline the Roadmap with Research Adapters Before Research

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-complete-v1-master-roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-23-catalog-contracts.md`
- Modify: `docs/superpowers/plans/2026-07-23-taxonomy-and-pack-catalog.md`
- Modify: `docs/superpowers/plans/2026-07-23-research-governance.md`
- Modify: `docs/superpowers/plans/2026-07-23-provider-review-waves.md`
- Create: `tests/unit/broker-roadmap.test.ts`
- Record progress only in local ignored working notes; do not add them to the public tree

- [ ] **Step 1: Write the failing active-roadmap contract test**

Require these exact future roles:

```text
R01  broker-only dual-runtime rebaseline
P04A isolated Claude Code/Codex research adapters and 2x3 fixture-conformance receipts
P04B weekly/manual provider research, candidate trial receipts, and six-target selections
P05  runtime-aware recommendation and availability resolver
P06  atomic broker lifecycle core
P07  approved real-user Claude Code/Codex and POSIX/Windows operation adapters
P08  setup, update, remove, doctor, export, and import workflows
P09  20 generated routing profiles and external-provider pack activation
P10  generated registry, reports, and bilingual documentation
P11  two-runtime by three-OS semantic and clean-user private RC
P12  independent review and private-main integration
```

Reject active owned-purpose/gap work, daily discovery, Claude-only evidence, local
pack fulfillment, fake all-pack availability, candidate evidence attributed to P04A,
P04B trials before P04A fixture-conformance receipts, or a research batch that does
not consume and advance the immediate protected approval-tag chain.

- [ ] **Step 2: Rewrite the dependency graph**

```text
P01 -> P02 -> P03 -> R01 -> P04A -> P04B
P02 + R01 + P04B -> P05 -> P06 -> P07
P05 + P06 + P07 -> P08
P04B + P05 + P08 -> P09
P02 + P04B + P08 + P09 -> P10
P07 + P08 + P09 + P10 -> P11 -> P12
```

P04A owns only disposable research-root creation, runtime-native install/update/
remove/doctor command rendering, cleanup, and sanitized adapter-conformance receipts
from controlled fixtures. It must pass `2 runtimes x 3 operating systems` and cannot
touch real user/project state. P04A does not create candidate/revision trial
evidence. P04B freezes and invokes those reviewed adapters for each real candidate,
revision, capability, runtime, and platform; P04B owns the resulting sanitized
install/semantic/update/remove/doctor receipts and links them to target evidence and
selections. It may not treat P04A fixture receipts as provider evidence or create ad
hoc runtime commands. P07 later reuses the same operation contract for approved
real-user lifecycle behavior and adds atomic state/recovery.

P09 owns only routing profiles and external-provider activation. P11 repeats
clean-user release evidence on every runtime and OS and revokes any cell that no
longer passes. Unavailable packs are honest release states, not release failures by
themselves.

Add supersession notices to P01-P03 historical plans without changing their PASS
hashes. Mark the old P04 plan non-executable; after R01, write and independently
review a new P04A plan first.

- [ ] **Step 3: Verify and commit**

```bash
npm test -- tests/unit/broker-roadmap.test.ts
npm run check
git diff --check
git add docs/superpowers/plans/2026-07-23-complete-v1-master-roadmap.md docs/superpowers/plans/2026-07-23-catalog-contracts.md docs/superpowers/plans/2026-07-23-taxonomy-and-pack-catalog.md docs/superpowers/plans/2026-07-23-research-governance.md docs/superpowers/plans/2026-07-23-provider-review-waves.md tests/unit/broker-roadmap.test.ts
git commit -s -m "docs: rebaseline complete v1 as a dual-runtime broker"
```

Record reviewed task ranges in the ignored ledger.

---

### Task 7: Create the R01 Candidate Exit Evidence

**Files:**
- Create: `docs/release/broker-rebaseline-evidence.md` as a sanitized public R01 summary
- Keep implementation progress only in local ignored working notes

- [ ] **Step 1: Run the clean controller gate**

```bash
npm run check
npm run verify:p03-immutable
task1_sha="${PRIVATE_DEVELOPMENT_TASK1_COMMIT:?private development baseline not published}"
test "$(printf '%s\n' "$task1_sha" | awk 'NF { n++ } END { print n + 0 }')" = 1
npm run verify:research-append-only -- --base "$task1_sha"
npm run verify:broker-only
bash tests/e2e/clean-copy.sh
git diff --check
git status --short
```

- [ ] **Step 2: Record reproducible evidence**

Record `20/281/147/40/120`, 49 P03 paths, the baseline/current tree digest, exact
runtime/platform sets, six-cell selection contract, test totals, deterministic
generation, broker-only verification, clean-copy result, and sanitized visibility:

```bash
gh repo view --json visibility,isPrivate
```

The report names the exact `research-pending` state: zero provider selections, zero
availability records, and zero activatable purpose-pack profiles. It does not claim
`unavailable` without target search evidence and does not claim that market research
or real dual-runtime lifecycle E2E has run.

- [ ] **Step 3: Commit the candidate evidence before review**

```bash
git add docs/release/broker-rebaseline-evidence.md
git commit -s -m "docs: record broker rebaseline candidate evidence"
```

---

### Task 8: Review the Complete Candidate and Finalize the Gate

**Files:**
- Modify: `docs/release/broker-rebaseline-evidence.md`
- Keep implementation progress only in local ignored working notes
- Modify only files required by accepted review repairs

- [ ] **Step 1: Review the complete candidate range**

Generate a review package from the private development baseline through the Task 7
commit. The baseline ID is not published. The independent
review covers external-only behavior, target evidence isolation, exact provider
identity, mutually exclusive terminal states, trust/assurance enforcement, local
purpose linkage absence, foundation removal, P03 Git-blob identity, deterministic
generation, and roadmap order. Exit requires `Critical 0 / Important 0`.

- [ ] **Step 2: Repair and re-review**

Resolve every Critical or Important finding in one reviewed repair wave. Rerun the
focused tests, stage only the explicit repair paths, and create a DCO-signed repair
commit before running clean-copy. Then run the full controller gate against that
committed repair HEAD. Append its commands and fresh results to the exit report and
commit the finalized report:

```bash
git diff --cached --check
git commit -s -m "fix: resolve broker rebaseline review"
npm run check
npm run verify:p03-immutable
task1_sha="${PRIVATE_DEVELOPMENT_TASK1_COMMIT:?private development baseline not published}"
test "$(printf '%s\n' "$task1_sha" | awk 'NF { n++ } END { print n + 0 }')" = 1
npm run verify:research-append-only -- --base "$task1_sha"
npm run verify:broker-only
bash tests/e2e/clean-copy.sh
git status --short
git add docs/release/broker-rebaseline-evidence.md
git commit -s -m "docs: finalize broker rebaseline evidence"
npm run check
npm run verify:p03-immutable
task1_sha="${PRIVATE_DEVELOPMENT_TASK1_COMMIT:?private development baseline not published}"
test "$(printf '%s\n' "$task1_sha" | awk 'NF { n++ } END { print n + 0 }')" = 1
npm run verify:research-append-only -- --base "$task1_sha"
npm run verify:broker-only
bash tests/e2e/clean-copy.sh
git status --short
```

Before the code block, stage each accepted repair path explicitly as named by the
review; do not use `git add -A` or broad source/test directories. If Step 1 is
already clean, omit the repair commit and run the full gate on the committed Task 7
HEAD before updating the report.

Generate a new package from the private development baseline through this final
commit and require a second
independent `Critical 0 / Important 0` verdict. If that review changes tracked
content, repeat the commit and whole-range review; the reviewed HEAD, not an earlier
candidate, is the R01 gate.

- [ ] **Step 3: Anchor the reviewed HEAD and record the next gate**

Only after the second independent review returns `Critical 0 / Important 0`, create
one annotated local approval tag pointing to that exact reviewed HEAD:

```bash
reviewed_head=$(git rev-parse HEAD)
git tag -a registry-approved/r01 "$reviewed_head" -m "R01 reviewed broker registry base"
test "$(git cat-file -t registry-approved/r01)" = tag
test "$(git rev-parse registry-approved/r01^{})" = "$reviewed_head"
approved_tag_object=$(git rev-parse registry-approved/r01)
```

Do not move, recreate, delete, or push the tag in R01. Record the reviewed HEAD, tag
object ID, test total, clean-copy result, visibility result, and review counts in the
ignored progress ledger. P04B automation must receive that exact tag object through
protected operator/CI input; before any remote automation, configure the remote to
deny approval-tag updates/deletions. A missing or pre-existing conflicting tag is a
hard stop, not an overwrite instruction.

The next executable work is a new, independently reviewed P04A disposable
research-adapter plan. Do not resume the superseded 2026-07-23 P04 plan.

## R01 Exit Criteria

- Provider, review, selection, queue, report, and repository contracts are
  external-only and target-specific.
- Selected/alternate cells already have exact runtime/platform trial evidence;
  pending evidence never creates availability.
- No executable contract, manifest, generator, local plugin linkage, or artifact
  lets repository-local code fulfill a purpose capability or pack outcome.
- The legacy foundation purpose pack is gone; the same ID remains only as one of 40
  external-provider outcome packs.
- All 40 packs preserve their identities and scenarios, use domain routing
  profiles, and retain the exact 18-pack high-impact safety set.
- Availability enforces external trust, assurance, and installed-provider failure
  reasons for preferred and user-chosen alternate providers.
- Every protected P03 file matches the Git blob authenticated by the annotated public
  root governance tag.
- P04A disposable Claude/Codex research adapters precede P04B research; P07 owns
  approved real-user operation adapters.
- Full checks, deterministic generation, parsed broker-only verification,
  no-hardlinks clean-copy validation, private visibility, and the final whole-range
  independent review pass with zero Critical and zero Important findings.
- No push, merge, publication, or real user/project plugin-state change occurs.
