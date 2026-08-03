# Complete v1 Catalog Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned, testable complete-v1 data contracts without changing the current foundation runtime or weakening its validation.

**Architecture:** Complete-v1 types live beside the legacy foundation types until P02 supplies the full production dataset and switches the repository loader atomically. JSON Schema draft 2020-12 validators reject unknown fields and expose sorted field-path errors. Exact domain and pack ID constants prevent later plans from silently shrinking or renaming the approved catalog.

**Tech Stack:** Node.js 22+, TypeScript 7.0.2, Ajv 8.20.0, YAML 2.9.0, Vitest 4.1.10, JSON Schema draft 2020-12.

## Global Constraints

- Preserve exactly 20 domain IDs and 40 initial pack IDs.
- Category, capability, provider, review, conflict, recommendation, lifecycle, and release IDs use lowercase kebab-case.
- All object schemas use `additionalProperties: false` and all required strings are non-empty.
- Manifest versions use semantic version strings; dates use `YYYY-MM-DD`; timestamps use UTC RFC 3339.
- External providers can be `trusted`, `community`, or `blocked`, never `verified`.
- A model recommendation contains catalog IDs and evidence only; it never contains commands, paths, source identities, or approvals.
- Lifecycle state contains no secret, raw probe, raw command output, raw model output, token, cookie, or unrestricted user path.
- Existing schema-version-1 manifests, generation, and all 197 foundation tests remain green throughout P01.
- P01 does not create production taxonomy, provider decisions, generated v2 output, or lifecycle behavior; those changes begin only after these contracts are reviewed.
- Every commit uses `git commit -s` and leaves `npm run check` green.

---

## File Structure

```text
src/model/complete-v1.ts                 complete-v1 constants and data types
src/contracts/complete-v1.ts             compiled validators and sorted error formatting
schemas/v2/catalog.schema.json            canonical catalog and replacement edges
schemas/v2/category-collection.schema.json per-domain category collection
schemas/v2/capability-collection.schema.json per-domain provider-neutral capabilities
schemas/v2/pack.schema.json               complete outcome-pack contract
schemas/v2/provider.schema.json           owned/native/pinned provider union
schemas/v2/source-review.schema.json      security, license, score, and decision evidence
schemas/v2/conflict-group.schema.json     mutually exclusive/redundant/composable providers
schemas/v2/research-snapshot.schema.json  reproducible discovery observation
schemas/v2/recommendation-result.schema.json bounded model recommendation
schemas/v2/lifecycle-state.schema.json    approved state, ownership, receipts, and resume
schemas/v2/release-manifest.schema.json   sanitized evidence digests and release gates
tests/unit/complete-v1-types.test.ts       exact ID and compile-time contract tests
tests/unit/complete-v1-contracts.test.ts   JSON Schema acceptance and rejection tests
tests/fixtures/contracts/v2/               minimal valid and targeted invalid documents
```

### Task 1: Freeze the Approved Domain and Pack IDs

**Files:**
- Create: `src/model/complete-v1.ts`
- Create: `tests/unit/complete-v1-types.test.ts`

**Interfaces:**
- Produces: `COMPLETE_V1_DOMAIN_IDS: readonly DomainId[]`
- Produces: `COMPLETE_V1_PACK_IDS: readonly PackId[]`
- Produces: `DomainId`, `PackId`, `Platform`, `InstallLevel`, `ScenarioType`, and `CatalogContract`

- [ ] **Step 1: Write the failing exact-set tests**

```ts
import { describe, expect, it } from "vitest";
import {
  COMPLETE_V1_DOMAIN_IDS,
  COMPLETE_V1_PACK_IDS
} from "../../src/model/complete-v1.js";

describe("complete-v1 identity contract", () => {
  it("freezes the approved 20 domains", () => {
    expect(COMPLETE_V1_DOMAIN_IDS).toHaveLength(20);
    expect(new Set(COMPLETE_V1_DOMAIN_IDS).size).toBe(20);
    expect(COMPLETE_V1_DOMAIN_IDS).toEqual([
      "research-and-intelligence", "strategy-and-decision", "writing-and-publishing",
      "marketing-and-growth", "promotion-and-distribution", "sales-and-customer",
      "product-management", "project-management", "software-engineering",
      "devops-and-security", "ai-agents-and-automation", "data-and-analytics",
      "design-and-brand", "video-and-audio", "documents-and-knowledge",
      "business-operations", "finance-and-accounting", "commerce",
      "people-and-training", "legal-risk-and-compliance"
    ]);
  });

  it("freezes the approved 40 initial packs", () => {
    expect(COMPLETE_V1_PACK_IDS).toHaveLength(40);
    expect(new Set(COMPLETE_V1_PACK_IDS).size).toBe(40);
    expect(COMPLETE_V1_PACK_IDS).toContain("repository-to-implementation-plan");
    expect(COMPLETE_V1_PACK_IDS).toContain("regulation-to-compliance-checklist");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npm test -- tests/unit/complete-v1-types.test.ts`

Expected: FAIL because `src/model/complete-v1.ts` does not exist.

- [ ] **Step 3: Add the exact constants and common types**

```ts
export const COMPLETE_V1_DOMAIN_IDS = [
  "research-and-intelligence",
  "strategy-and-decision",
  "writing-and-publishing",
  "marketing-and-growth",
  "promotion-and-distribution",
  "sales-and-customer",
  "product-management",
  "project-management",
  "software-engineering",
  "devops-and-security",
  "ai-agents-and-automation",
  "data-and-analytics",
  "design-and-brand",
  "video-and-audio",
  "documents-and-knowledge",
  "business-operations",
  "finance-and-accounting",
  "commerce",
  "people-and-training",
  "legal-risk-and-compliance"
] as const;

export type DomainId = typeof COMPLETE_V1_DOMAIN_IDS[number];
export type Platform = "darwin" | "linux" | "win32";
export type InstallLevel = "essential" | "recommended" | "domain-full" | "advanced" | "full-catalog";
export type ScenarioType = "normal" | "boundary" | "refusal";

export const COMPLETE_V1_PACK_IDS = [
  "question-to-cited-research-brief",
  "competitor-landscape-to-opportunity-map",
  "customer-interviews-to-insights",
  "evidence-to-strategic-decision",
  "idea-to-edited-article",
  "source-to-multilingual-publication",
  "product-to-positioning-and-offer",
  "keyword-to-ranked-content",
  "launch-plan-to-multichannel-campaign",
  "long-form-to-social-distribution",
  "account-research-to-personalized-outreach",
  "discovery-call-to-proposal",
  "customer-problem-to-validated-prd",
  "prd-to-prioritized-roadmap",
  "project-brief-to-execution-board",
  "repository-to-implementation-plan",
  "spec-to-tested-feature",
  "bug-report-to-verified-fix",
  "service-to-ci-cd-deployment",
  "incident-alert-to-postmortem",
  "application-to-security-review",
  "use-case-to-agent-design",
  "prototype-to-evaluated-agent",
  "raw-data-to-validated-dataset",
  "business-question-to-dashboard",
  "brief-to-accessible-interface",
  "brand-strategy-to-visual-system",
  "topic-to-recording-ready-script",
  "raw-footage-to-published-video",
  "long-video-to-multiplatform-clips",
  "meeting-to-decisions-and-actions",
  "source-files-to-polished-document",
  "manual-process-to-maintained-sop",
  "repetitive-work-to-approved-automation",
  "transactions-to-management-report",
  "product-idea-to-store-listing",
  "role-need-to-interview-scorecard",
  "expertise-to-training-program",
  "contract-to-risk-and-revision-brief",
  "regulation-to-compliance-checklist"
] as const;
```

Define:

```ts
export type PackId = typeof COMPLETE_V1_PACK_IDS[number];

export interface ReplacementEdge {
  replacementPackId: string;
  replacesPackIds: PackId[];
  decisionRef: string;
  reviewer: string;
}

export interface CatalogContract {
  schemaVersion: 2;
  releaseTarget: "complete-private-v1";
  domainIds: DomainId[];
  categoryIds: string[];
  initialPackIds: PackId[];
  replacements: ReplacementEdge[];
}
```

- [ ] **Step 4: Add compile-time examples for valid and invalid unions**

Use `satisfies CatalogContract` for one valid value. Add `// @ts-expect-error` cases for
`domainIds: ["unknown"]`, `schemaVersion: 1`, and `releaseTarget: "public"`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/complete-v1-types.test.ts`

Expected: two passing runtime tests, accepted `@ts-expect-error` assertions, and zero
TypeScript errors.

```bash
git add src/model/complete-v1.ts tests/unit/complete-v1-types.test.ts
git commit -s -m "feat: freeze complete v1 catalog identities"
```

### Task 2: Define Taxonomy, Pack, Provider, and Conflict Types

**Files:**
- Modify: `src/model/complete-v1.ts`
- Modify: `tests/unit/complete-v1-types.test.ts`
- Create: `schemas/v2/catalog.schema.json`
- Create: `schemas/v2/category-collection.schema.json`
- Create: `schemas/v2/capability-collection.schema.json`
- Create: `schemas/v2/pack.schema.json`
- Create: `schemas/v2/provider.schema.json`
- Create: `schemas/v2/conflict-group.schema.json`

**Interfaces:**
- Produces: `CategoryCollectionManifest`, `CapabilityCollectionManifest`, `CompletePackManifest`, `ProviderManifest`, and `ConflictGroupManifest`
- Consumes: `LocalizedText`, `PermissionDeclaration`, `ReleaseStatus`, and `TrustTier` from `src/model/manifest.ts`

- [ ] **Step 1: Add failing type-shape tests**

Create representative values and assert their IDs:

```ts
const categoryCollection: CategoryCollectionManifest = {
  schemaVersion: 2,
  domainId: "software-engineering",
  categories: [{
    id: "repository-context",
    name: { ko: "저장소 맥락", en: "Repository context" },
    description: { ko: "현재 저장소 증거를 수집한다.", en: "Collect current repository evidence." },
    status: "draft"
  }]
};

const pack: CompletePackManifest = {
  schemaVersion: 2,
  id: "repository-to-implementation-plan",
  domainId: "software-engineering",
  categoryIds: ["repository-context"],
  outcome: { ko: "검증 가능한 구현 계획", en: "A verifiable implementation plan" },
  inputs: ["repository", "requested-change"],
  outputs: ["implementation-plan"],
  completionCriteria: ["Every requested change maps to an exact file and verification step."],
  runtimeBundle: "software-engineering",
  ownedSkillIds: [],
  requiredCapabilityIds: ["repository-context-analysis"],
  recommendedCapabilityIds: [],
  optionalCapabilityIds: [],
  platforms: ["darwin", "linux", "win32"],
  trustRequirement: "trusted",
  scenarios: [
    { id: "repository-plan-normal", type: "normal", path: "tests/evaluations/packs/repository-plan-normal.yaml" },
    { id: "repository-plan-boundary", type: "boundary", path: "tests/evaluations/packs/repository-plan-boundary.yaml" },
    { id: "repository-plan-refusal", type: "refusal", path: "tests/evaluations/packs/repository-plan-refusal.yaml" }
  ],
  replacesPackIds: [],
  version: "1.0.0",
  status: "draft"
};
```

Run: `npm test -- tests/unit/complete-v1-types.test.ts`

Expected: FAIL because the new exported interfaces are absent.

- [ ] **Step 2: Add provider-neutral taxonomy and complete pack interfaces**

```ts
export interface CategoryManifest {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  status: ReleaseStatus;
}

export interface CategoryCollectionManifest {
  schemaVersion: 2;
  domainId: DomainId;
  categories: CategoryManifest[];
}

export interface CapabilityManifest {
  id: string;
  ownerDomainId: DomainId;
  categoryIds: string[];
  outcome: LocalizedText;
  status: ReleaseStatus;
}

export interface CapabilityCollectionManifest {
  schemaVersion: 2;
  domainId: DomainId;
  capabilities: CapabilityManifest[];
}

export interface ScenarioReference {
  id: string;
  type: ScenarioType;
  path: string;
}

export interface CompletePackManifest {
  schemaVersion: 2;
  id: string;
  domainId: DomainId;
  categoryIds: string[];
  outcome: LocalizedText;
  inputs: string[];
  outputs: string[];
  completionCriteria: string[];
  runtimeBundle: string;
  ownedSkillIds: string[];
  requiredCapabilityIds: string[];
  recommendedCapabilityIds: string[];
  optionalCapabilityIds: string[];
  platforms: Platform[];
  trustRequirement: Exclude<TrustTier, "blocked">;
  scenarios: ScenarioReference[];
  replacesPackIds: PackId[];
  version: string;
  status: ReleaseStatus;
}
```

- [ ] **Step 3: Add the discriminated provider and conflict contracts**

```ts
interface ProviderBase {
  schemaVersion: 2;
  id: string;
  capabilityIds: string[];
  sourceReviewId: string;
  permissions: PermissionDeclaration;
  platforms: Platform[];
  version: string;
  status: ReleaseStatus;
}

export interface OwnedProvider extends ProviderBase {
  installStrategy: "owned";
  pluginId: string;
  trustTier: "verified";
}

export interface NativeMarketplaceProvider extends ProviderBase {
  installStrategy: "native-marketplace-plugin";
  marketplaceId: string;
  marketplaceSource: string;
  pluginId: string;
  artifactCommit: string;
  attestationUrl: string;
  trustTier: "trusted" | "community" | "blocked";
}

export interface PinnedGitSubdirProvider extends ProviderBase {
  installStrategy: "pinned-git-subdir";
  repositoryUrl: string;
  subdirectory: string;
  ref: string;
  commitSha: string;
  skillPaths: string[];
  trustTier: "trusted" | "community" | "blocked";
}

export type ProviderManifest = OwnedProvider | NativeMarketplaceProvider | PinnedGitSubdirProvider;

export interface ConflictGroupManifest {
  schemaVersion: 2;
  id: string;
  mode: "mutually-exclusive" | "redundant" | "composable";
  providerIds: string[];
  preferredProviderId: string;
  rationale: LocalizedText;
}
```

- [ ] **Step 4: Add strict JSON Schemas**

Use `$schema: "https://json-schema.org/draft/2020-12/schema"`. Reuse `$defs` within each
file rather than remote `$ref` values. Enforce:

- kebab-case IDs with `^[a-z0-9]+(?:-[a-z0-9]+)*$`;
- unique non-empty arrays for owning and required relations;
- `minItems: 3` plus one `normal`, one `boundary`, and one `refusal` scenario in the pack
  contract;
- SHA-1 commit identities as exactly 40 lowercase hexadecimal characters;
- HTTPS URLs for repository and attestation fields;
- `owned` implies `verified`, while both external strategies exclude `verified`;
- native marketplace providers require `artifactCommit` and `attestationUrl`;
- pinned providers require `repositoryUrl`, `subdirectory`, `ref`, `commitSha`, and an
  explicit non-empty `skillPaths` allowlist.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/complete-v1-types.test.ts`

Expected: all complete-v1 type tests pass and the foundation suite remains type-correct.

```bash
git add src/model/complete-v1.ts schemas/v2 tests/unit/complete-v1-types.test.ts
git commit -s -m "feat: define complete catalog entity contracts"
```

### Task 3: Define Research, Recommendation, Lifecycle, and Release Contracts

**Files:**
- Modify: `src/model/complete-v1.ts`
- Modify: `tests/unit/complete-v1-types.test.ts`
- Create: `schemas/v2/source-review.schema.json`
- Create: `schemas/v2/research-snapshot.schema.json`
- Create: `schemas/v2/recommendation-result.schema.json`
- Create: `schemas/v2/lifecycle-state.schema.json`
- Create: `schemas/v2/release-manifest.schema.json`

**Interfaces:**
- Produces: `ResearchSnapshot`, `SourceReviewManifest`, `StructuredRecommendation`, `LifecycleState`, and `ReleaseManifest`

- [ ] **Step 1: Add failing representative-value tests**

Test that a source review score is expressed only through the five approved components and
that recommendation values have at most three domains. Test a lifecycle state containing
one approved operation, one receipt, and one plugin ownership record. Test a release
manifest containing the three required platform rows.

Run: `npm test -- tests/unit/complete-v1-types.test.ts`

Expected: FAIL because the research, recommendation, lifecycle, and release interfaces do
not exist.

- [ ] **Step 2: Add research and scoring interfaces**

```ts
export type DiscoveryTier = "A" | "B" | "C" | "D";
export type ReviewDecision = "selected" | "alternate" | "held" | "rejected";

export interface ResearchSnapshot {
  schemaVersion: 2;
  id: string;
  sourceUrl: string;
  queryUrls: string[];
  observedAt: string;
  inspectedRef: string;
  inspectedCommit: string;
  inspectedPaths: string[];
  collectionMethod: string;
  toolVersion: string;
  reportedCount: number;
  independentlyCountedTotal: number;
  contentSha256: string;
}

export interface ScoreBreakdown {
  outcomeFitAndDepth: number;
  securityAndTransparency: number;
  maintenanceAndUpdateability: number;
  nativeInstallability: number;
  documentationAndEvaluation: number;
}

export interface HardGateResult {
  id: string;
  passed: boolean;
  evidenceRefs: string[];
}

export interface SourceReviewManifest {
  schemaVersion: 2;
  id: string;
  providerId: string;
  snapshotIds: string[];
  discoveryTier: DiscoveryTier;
  originalRepository: string;
  selectedPaths: string[];
  reviewedCommit: string;
  observedVersion: string;
  licenseConclusion: string;
  lastMeaningfulChange: string;
  surfaces: string[];
  permissions: PermissionDeclaration;
  capabilityIds: string[];
  hardGates: HardGateResult[];
  score: ScoreBreakdown;
  decision: ReviewDecision;
  decisionReasons: string[];
  updatePolicy: string;
  nextReviewDate: string;
}
```

The schema limits score components to 40, 20, 15, 15, and 10 respectively and forbids an
explicit total field, so tooling must reproduce the sum.

- [ ] **Step 3: Add bounded recommendation and lifecycle interfaces**

```ts
declare const sanitizedGoalSummaryBrand: unique symbol;

export type SanitizedGoalSummary = string & {
  readonly [sanitizedGoalSummaryBrand]: "SanitizedGoalSummary";
};

export interface GoalSummaryProjection {
  kind: "allowlisted-summary-v1";
  sanitizerVersion: string;
  sourceSha256: string;
}

export interface StructuredRecommendation {
  schemaVersion: 2;
  goalSummary: SanitizedGoalSummary;
  goalSummaryProjection: GoalSummaryProjection;
  inputs: string[];
  outputs: string[];
  domainIds: DomainId[];
  packIds: PackId[];
  evidence: string[];
  unresolvedQuestions: string[];
}

export type OperationKind =
  | "probe" | "marketplace-add" | "verify-marketplace" | "install"
  | "verify-provider" | "state-write" | "update" | "uninstall" | "marketplace-remove";

export interface ApprovedOperation {
  id: string;
  kind: OperationKind;
  platform: Platform;
  providerId?: string;
  commandId: string;
  approvedPlanFingerprint: string;
}

export interface OperationReceipt {
  operationId: string;
  status: "succeeded" | "failed" | "skipped";
  resultCode: string;
}

export interface OwnershipRecord {
  pluginId: string;
  packIds: PackId[];
  managed: boolean;
}

export interface LifecycleState {
  schemaVersion: 2;
  catalogFingerprint: string;
  goalSummarySha256: string;
  domainIds: DomainId[];
  level: InstallLevel;
  packIds: PackId[];
  providerIds: string[];
  marketplaceIdentities: { id: string; source: string }[];
  platform: Platform;
  claudeVersion: string;
  approvedPlanFingerprint: string;
  operations: ApprovedOperation[];
  receipts: OperationReceipt[];
  ownership: OwnershipRecord[];
  resumeCursor?: string;
}
```

The recommendation schema uses `maxItems: 3` and `uniqueItems: true` for `domainIds`. The
lifecycle schema uses an allowlist of the fields above and rejects every unknown property.

- [ ] **Step 4: Add the release evidence contract**

```ts
export interface ReleaseEvidenceRow {
  id: string;
  platform: Platform | "cross-platform";
  status: "proven" | "missing" | "contradicted";
  artifactSha256?: string;
  workflowRunId?: string;
}

export interface ReleaseManifest {
  schemaVersion: 2;
  candidateCommit: string;
  catalogFingerprint: string;
  repositoryVisibility: "PRIVATE";
  evidence: ReleaseEvidenceRow[];
  criticalFindings: number;
  importantFindings: number;
}
```

Require the candidate commit and artifact digest fields, when present, to be lowercase
40-character SHA-1 and 64-character SHA-256 strings respectively. The schema accepts only
`PRIVATE` and non-negative integer finding counts.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/complete-v1-types.test.ts`

Expected: all representative values type-check and all exact ID tests pass.

```bash
git add src/model/complete-v1.ts schemas/v2 tests/unit/complete-v1-types.test.ts
git commit -s -m "feat: define complete v1 evidence contracts"
```

### Task 4: Compile Strict Validators with Actionable Errors

**Files:**
- Create: `src/contracts/complete-v1.ts`
- Create: `tests/unit/complete-v1-contracts.test.ts`
- Create: `tests/fixtures/contracts/v2/catalog.valid.yaml`
- Create: `tests/fixtures/contracts/v2/provider.valid.yaml`
- Create: `tests/fixtures/contracts/v2/recommendation.valid.json`
- Create: `tests/fixtures/contracts/v2/lifecycle-state.valid.json`
- Create: `tests/fixtures/contracts/v2/release-manifest.valid.json`

**Interfaces:**
- Produces: `validateCatalogContract(value: unknown): CatalogContract`
- Produces: `validateCategoryCollection(value: unknown): CategoryCollectionManifest`
- Produces: `validateCapabilityCollection(value: unknown): CapabilityCollectionManifest`
- Produces: `validateCompletePack(value: unknown): CompletePackManifest`
- Produces: `validateProvider(value: unknown): ProviderManifest`
- Produces: `validateSourceReview(value: unknown): SourceReviewManifest`
- Produces: `validateConflictGroup(value: unknown): ConflictGroupManifest`
- Produces: `validateResearchSnapshot(value: unknown): ResearchSnapshot`
- Produces: `validateStructuredRecommendation(value: unknown): StructuredRecommendation`
- Produces: `validateLifecycleState(value: unknown): LifecycleState`
- Produces: `validateReleaseManifest(value: unknown): ReleaseManifest`

- [ ] **Step 1: Write failing validator behavior tests**

```ts
import { describe, expect, it } from "vitest";
import {
  validateProvider,
  validateStructuredRecommendation
} from "../../src/contracts/complete-v1.js";

describe("complete-v1 contracts", () => {
  it("rejects verified trust on an external provider", () => {
    expect(() => validateProvider({
      schemaVersion: 2,
      id: "external-provider",
      installStrategy: "pinned-git-subdir",
      trustTier: "verified"
    })).toThrow(/trustTier/);
  });

  it("rejects a fourth recommended domain", () => {
    expect(() => validateStructuredRecommendation({
      schemaVersion: 2,
      goalSummary: "Launch, sell, analyze, and automate a product",
      inputs: [], outputs: [], evidence: [], unresolvedQuestions: [], packIds: [],
      domainIds: [
        "marketing-and-growth", "promotion-and-distribution",
        "sales-and-customer", "data-and-analytics"
      ]
    })).toThrow(/domainIds/);
  });
});
```

Run: `npm test -- tests/unit/complete-v1-contracts.test.ts`

Expected: FAIL because the validator module does not exist.

- [ ] **Step 2: Compile every schema once**

Use one `Ajv2020({ allErrors: true, strict: true })` instance and `createRequire` to load
the eleven schema files. Implement one private helper:

```ts
function validateContract<T>(
  kind: string,
  validator: ValidateFunction<T>,
  value: unknown
): T {
  if (validator(value)) return value;
  const errors = (validator.errors ?? [])
    .slice()
    .sort((a, b) => errorPath(a).localeCompare(errorPath(b)))
    .map(formatError);
  throw new Error(`Invalid complete-v1 ${kind}:\n${errors.join("\n")}`);
}
```

Use the same missing-property and additional-property path rules as
`src/manifest/load.ts`, but keep the v2 validators in the new module so P01 does not alter
the production loader.

- [ ] **Step 3: Add valid fixtures and targeted rejection coverage**

The valid fixtures contain only non-secret synthetic values. Add rejection cases for:

- every unknown property;
- duplicate IDs in arrays where uniqueness is required;
- unknown domain IDs and approved-pack references in every schema that uses the closed
  20-domain or 40-pack sets, including nested lifecycle ownership;
- non-kebab IDs and non-semver versions;
- non-HTTPS and malformed bare-authority source URLs;
- invalid SHA lengths;
- missing pinned skill allowlists;
- native providers without artifact attestation and provider objects with extra fields;
- external `verified` and owned non-`verified` trust;
- recommendation commands, source fields, four domains, and unknown domain IDs;
- lifecycle deprecated `goalSummary`/projection fields, `rawOutput`, `token`, `cookie`,
  `workspacePath`, unknown ownership packs, and mixed-platform operation fields;
- impossible calendar dates, non-UTC timestamps, and invalid leap days;
- release visibility other than `PRIVATE` and negative finding counts.

- [ ] **Step 4: Verify focused and full suites**

Run: `npm test -- tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts`

Expected: both files pass with no skipped cases.

Run: `npm run check`

Expected: TypeScript, all 197 foundation tests plus the new contract tests, manifest
validation, and generated equality pass.

- [ ] **Step 5: Commit**

```bash
git add src/contracts/complete-v1.ts schemas/v2 tests/unit/complete-v1-contracts.test.ts tests/fixtures/contracts/v2
git commit -s -m "feat: validate complete v1 contracts"
```

### Task 5: Prove P01 Is Additive and Hand Off P02

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-complete-v1-master-roadmap.md`
- Create: `docs/superpowers/plans/2026-07-23-taxonomy-and-pack-catalog.md`

**Interfaces:**
- Consumes: every exported P01 type and validator
- Produces: a reviewed P02 plan that names the production loader migration, all 20 category collections, capability ownership rules, and the four exact pack waves

- [ ] **Step 1: Run the additive-change audit**

Run:

```bash
git diff <private-development-baseline-not-published> -- src/manifest src/generate src/installer plugins manifests generated
```

Expected: no production runtime, installed plugin, current manifest, or generated artifact
has changed during P01.

- [ ] **Step 2: Run clean-copy validation**

Run: `bash tests/e2e/clean-copy.sh`

Expected: the detached clean copy passes `npm run check` and validates the marketplace,
`shared-core`, and `skillset-manager` plugins.

- [ ] **Step 3: Request an independent P01 contract review**

The reviewer checks exact 20/40 identities, schema strictness, external trust exclusion,
recommendation command exclusion, lifecycle sensitive-field exclusion, and foundation
compatibility. Block P02 on any Critical or Important finding.

- [ ] **Step 4: Write and self-review the P02 plan**

The P02 plan consumes the exact P01 exports and must include red/green tests for canonical
catalog loading, all 20 category collections, all 40 draft packs, capability reachability,
scenario references, replacement equivalence, and the atomic production-loader switch.

- [ ] **Step 5: Record the P01 evidence and commit the reviewed P02 plan**

Update the P01 row in the master roadmap with the implementation commit, test count,
clean-copy result, and independent-review result. Commit the roadmap and P02 plan with DCO
sign-off before P02 implementation begins.

```bash
git add docs/superpowers/plans/2026-07-23-complete-v1-master-roadmap.md docs/superpowers/plans/2026-07-23-taxonomy-and-pack-catalog.md
git commit -s -m "docs: plan complete v1 taxonomy implementation"
```
