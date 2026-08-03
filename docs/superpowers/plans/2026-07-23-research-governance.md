# Complete v1 Research Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Entry Gate:** P02 PASS; atomic catalog loading, 20 domains, 281 categories, 147 capabilities, 40 draft packs, 120 closed scenarios, and the foundation migration are available. The private development baseline is not published.

**Goal:** Build the fail-closed, reproducible research substrate that P04 will use for capability-driven discovery and provider review, including immutable census snapshots, closed evidence and review contracts, deterministic gates and scores, freshness/drift evaluation, and atomic production validation.

**Architecture:** P03 owns a non-selecting 15-source discovery census and governance machinery. A census index owns immutable snapshots; separate queue, evidence, provider, review, conflict, and owned-gap collections remain empty in production until P04. A checked-in evaluation context supplies every UTC clock and upstream observation. The atomic loader validates census, hashes, evidence bindings, queue/review lineage, governance, and freshness before exposing foundation, catalog, or research views. P03 report functions are pure; P10 later publishes user-facing generated reports.

**Tech Stack:** Node.js 22+, TypeScript 7.0.2, Ajv 8.20.0, YAML 2.9.0, Vitest 4.1.10, Node `crypto`, Git CLI for public read-only tree collection, existing clean-copy and Claude plugin validators.

## Global Constraints

- Keep the GitHub repository private. Do not push, merge, publish, register, install, update, or remove plugins in P03.
- Do not copy external code. Commit only URLs, paths, immutable revisions, counts, closed metadata, sanitized evidence, and hashes.
- Do not use paid xAI API paths, Hermes `xai-oauth`, or xAI API-backed plugins.
- Tier A/B/C/D changes discovery priority only and never bypasses a hard gate.
- One failed, missing, duplicated, unknown, stale, or unresolved hard gate makes an external provider ineligible.
- Score weights are exactly 40/20/15/15/10. Components and subcriteria are integers. Stored totals and fractional points are invalid.
- Eligible external scores map exactly: 80-100 `trusted`, 65-79 `community`, below 65 `blocked`. Popularity contributes zero points.
- Score never grants `verified`. Owned providers remain ineligible until P09/P11 attach exact owned release evidence.
- Selected external providers require an upstream observation no more than 30 complete UTC days before private RC. Drift never mutates `reviewedCommit`.
- Three materially distinct candidates are required when three exist. Fewer-found evidence relaxes only the count, never review or ineligibility proof.
- P03 creates no real provider selection, conflict choice, owned-gap approval, or capability-coverage claim. P04 owns those decisions.
- All path sorting uses Unicode code-point order. All clocks come from checked-in context or explicit test inputs. No wall clock, locale, or network is consulted by validation/generation.
- Preserve all five foundation artifact bytes and installed manager behavior.

## Closed Vocabularies

```ts
export const HARD_GATE_IDS = [
  "bounded-permissions",
  "compatible-runtime-and-platforms",
  "documented-secret-flow",
  "immutable-reviewed-revision",
  "install-and-semantic-smoke",
  "lifecycle-strategy",
  "marketplace-identity-consistent",
  "original-repository-identified",
  "outcome-value-demonstrated",
  "selected-path-license-usable",
  "transparent-bootstrap-and-surfaces"
] as const;
export type HardGateId = typeof HARD_GATE_IDS[number];

export const SCORE_CRITERIA = {
  "fit-capability-coverage": 15,
  "fit-pack-outcome": 15,
  "fit-domain-depth": 10,
  "security-bounded-permissions": 8,
  "security-transparent-surfaces": 6,
  "security-secret-and-data-flow": 6,
  "maintenance-current": 5,
  "maintenance-versioned": 5,
  "maintenance-lifecycle": 5,
  "install-supported-strategy": 8,
  "install-verifiable-identity": 4,
  "install-platform-support": 3,
  "evidence-documentation": 4,
  "evidence-install-smoke": 3,
  "evidence-semantic-smoke": 3
} as const;

export const SCORE_COMPONENTS = {
  outcomeFitAndDepth: ["fit-capability-coverage", "fit-pack-outcome", "fit-domain-depth"],
  securityAndTransparency: ["security-bounded-permissions", "security-transparent-surfaces", "security-secret-and-data-flow"],
  maintenanceAndUpdateability: ["maintenance-current", "maintenance-versioned", "maintenance-lifecycle"],
  nativeInstallability: ["install-supported-strategy", "install-verifiable-identity", "install-platform-support"],
  documentationAndEvaluation: ["evidence-documentation", "evidence-install-smoke", "evidence-semantic-smoke"]
} as const;
```

Every score criterion is binary: a record earns its fixed points only when `passed: true` and all required evidence references resolve to the same review/revision/paths. The weights sum to 100 and deterministically reproduce the five component totals.

## Canonical Research Contracts

```ts
type SnapshotEntryKind =
  | "marketplace-entry"
  | "plugin-manifest"
  | "skill-file"
  | "repository-record";

interface ResearchSnapshotEntry {
  kind: SnapshotEntryKind;
  address: string;
  sourceUrl: string | null;
}

interface ResearchCountMetric {
  kind: SnapshotEntryKind;
  reportedCount: number | null;
  reportedCountSourceUrl: string | null;
  independentlyCountedTotal: number;
}

interface ResearchSnapshot {
  schemaVersion: 2;
  id: string;
  sourceUrl: string;
  queryUrls: string[];
  observedAt: string;
  inspectedRef: string;
  inspectedCommit: string;
  collectionMethod: "git-tree-and-marketplace-v1";
  toolVersion: string;
  entries: ResearchSnapshotEntry[];
  countMetrics: ResearchCountMetric[];
  contentSha256: string;
}

interface ResearchCensus {
  schemaVersion: 2;
  id: "initial-discovery-census-2026-07-23";
  purpose: "discovery-only";
  selectionAllowed: false;
  snapshotIds: string[];
}
```

`address` is a repository-relative POSIX file path, except a marketplace entry uses `<marketplace-path>#/plugins/<zero-based-index>` with RFC 6901 escaping. `repository-record` uses `.`. The snapshot hash preimage is compact UTF-8 JSON plus LF over canonical entries projected in fixed key order `{ "kind", "address", "sourceUrl" }`, sorted by kind/address/sourceUrl in code-point order. No legacy `inspectedPaths`, `reportedCount`, or root `independentlyCountedTotal` remains.

```ts
interface ResearchEvaluationContext {
  schemaVersion: 2;
  asOf: string;
  privateRcAt: string | null;
  upstreamObservations: Array<{
    providerId: string;
    snapshotId: string;
    observedAt: string;
    headCommit: string;
  }>;
}

interface ReviewEvidence {
  schemaVersion: 2;
  id: string;
  reviewId: string;
  providerId: string;
  snapshotId: string;
  reviewedCommit: string;
  selectedPaths: string[];
  platforms: Platform[];
  kind:
    | "source-identity" | "marketplace-identity" | "license"
    | "surface-inventory" | "permissions" | "secret-flow"
    | "compatibility" | "outcome-evaluation" | "lifecycle"
    | "install-smoke" | "semantic-smoke" | "maintenance"
    | "documentation";
  observedAt: string;
  artifactPath: string;
  artifactSha256: string;
  outcome: "passed" | "failed";
  summary: string;
}

interface SearchEvidence {
  schemaVersion: 2;
  id: string;
  kind: "search-evidence";
  searchRecordId: string;
  capabilityId: string;
  queryTerms: string[];
  sourceUrls: string[];
  snapshotIds: string[];
  observedAt: string;
  artifactPath: string;
  artifactSha256: string;
  outcome: "passed" | "failed";
  summary: string;
}

type ResearchEvidence = ReviewEvidence | SearchEvidence;
```

Evidence artifacts must be contained regular files under `research/evidence/artifacts/`; records reproduce their SHA-256. They contain sanitized review evidence only, never credentials or copied upstream code.

```ts
interface ResearchQueueCandidate {
  id: string;
  capabilityIds: string[];
  snapshotId: string;
  searchTerms: string[];
  discoverySourceUrl: string;
  observedAt: string;
  candidateRepository: string;
  candidatePath: string;
  originalRepository: string;
  discoveryTier: "A" | "B" | "C" | "D";
  provenance: "original" | "aggregator-follow-through";
  materiallyDistinctGroup: string;
}

interface CapabilitySearchRecord {
  id: string;
  capabilityId: string;
  candidateIds: string[];
  fewerThanThreeEvidenceIds: string[];
  ownedGapDecisionId?: string;
}

interface ResearchQueue {
  schemaVersion: 2;
  candidates: ResearchQueueCandidate[];
  capabilitySearch: CapabilitySearchRecord[];
}

interface SourceReviewManifest {
  schemaVersion: 2;
  id: string;
  providerId: string;
  candidateId: string;
  searchRecordIds: string[];
  snapshotIds: string[];
  supersedesReviewId?: string;
  discoveryTier: "A" | "B" | "C" | "D";
  originalRepository: string;
  selectedPaths: string[];
  reviewedCommit: string;
  reviewedAt: string;
  revoked: boolean;
  marketplaceIdentity: { id: string; source: string } | null;
  observedVersion: string | null;
  licenseConclusion: string;
  lastMeaningfulChange: string;
  surfaces: {
    skills: string[]; commands: string[]; agents: string[]; hooks: string[];
    mcpServers: string[]; scripts: string[]; binaries: string[];
  };
  permissions: PermissionDeclaration;
  secretFlows: Array<{ name: string; documentedIntegrationFlow: boolean }>;
  compatibility: { claudeVersionRange: string; platforms: Platform[] };
  linkedDomainIds: DomainId[];
  linkedCategoryIds: string[];
  linkedPackIds: PackId[];
  capabilityIds: string[];
  removalStrategy: string;
  hardGates: Array<{ id: HardGateId; passed: boolean; evidenceRefs: string[] }>;
  evidenceIds: string[];
  scoreCriteria: Array<{ id: keyof typeof SCORE_CRITERIA; evidenceRefs: string[] }>;
  score: ScoreBreakdown;
  decision: "selected" | "alternate" | "held" | "rejected";
  decisionReasons: string[];
  updatePolicy: string;
  nextReviewDate: string;
}

interface OwnedGapDecision {
  schemaVersion: 2;
  id: string;
  capabilityId: string;
  searchRecordId: string;
  terminalReviewIds: string[];
  decisionReasons: string[];
  approvedBy: string;
  approvedAt: string;
  status: "approved";
}
```

The owned-provider variant adds required `ownedGapDecisionIds: string[]`. A gap is valid only when every discovered candidate in its search record has a terminal, governance-ineligible `held` or `rejected` review. Fewer-than-three evidence may explain candidate count but cannot replace those reviews.

## Evidence-Kind Matrix

| Hard gate | Required passed evidence kind(s) |
| --- | --- |
| `original-repository-identified` | `source-identity` |
| `selected-path-license-usable` | `license` |
| `immutable-reviewed-revision` | `source-identity` |
| `marketplace-identity-consistent` | `marketplace-identity` for native marketplace; `source-identity` otherwise |
| `transparent-bootstrap-and-surfaces` | `surface-inventory` |
| `bounded-permissions` | `permissions` |
| `documented-secret-flow` | `secret-flow` |
| `compatible-runtime-and-platforms` | `compatibility` |
| `outcome-value-demonstrated` | `outcome-evaluation` |
| `lifecycle-strategy` | `lifecycle` |
| `install-and-semantic-smoke` | both `install-smoke` and `semantic-smoke` |

## Score-Criterion Matrix

The evaluator derives each binary criterion; `scoreCriteria` supplies evidence references but no pass boolean.

| Criterion | Executable pass condition | Required passed evidence |
| --- | --- | --- |
| `fit-capability-coverage` | provider, review, and linked P02 capabilities are exact-equal and non-empty | `outcome-evaluation` |
| `fit-pack-outcome` | every linked pack resolves and requires/recommends at least one reviewed capability | `outcome-evaluation` |
| `fit-domain-depth` | linked domains/categories resolve and own the reviewed capabilities | `outcome-evaluation` |
| `security-bounded-permissions` | provider/review permissions are exact-equal; no value is `*`, contains `..`, starts `/`, or starts `~`; commands contain neither shell control tokens ``; & | > < ` $ ( ) { }`` nor `sudo`; network entries are HTTPS origins or the literal `none`; filesystem and external-data entries are non-empty declarative phrases or the literal `none` | `permissions` |
| `security-transparent-surfaces` | all seven surface arrays are explicit and evidence-bound | `surface-inventory` |
| `security-secret-and-data-flow` | every secret flow is documented, including an explicit empty set | `secret-flow` |
| `maintenance-current` | parse `lastMeaningfulChangeT00:00:00Z`; it is not after `context.asOf` and is at most 548 complete UTC days before `context.asOf` | `maintenance` |
| `maintenance-versioned` | immutable commit resolves and `observedVersion` is non-null | `source-identity`, `maintenance` |
| `maintenance-lifecycle` | update and removal strategies are non-empty and evidence-bound | `lifecycle` |
| `install-supported-strategy` | external install strategy is native marketplace or pinned git subdir and smoke passed | `install-smoke` |
| `install-verifiable-identity` | provider source, marketplace/ref, commit, and selected paths equal review evidence | `source-identity`, plus `marketplace-identity` for native |
| `install-platform-support` | provider/review/evidence platforms are exact-equal and non-empty | `compatibility` |
| `evidence-documentation` | documentation artifact is passed and bound to the review | `documentation` |
| `evidence-install-smoke` | install smoke is passed for the same revision/paths/platforms | `install-smoke` |
| `evidence-semantic-smoke` | semantic smoke is passed for linked packs/capabilities | `semantic-smoke` |

## Initial Census Batches

All snapshots use `research/snapshots/2026-07-23-<source-id>.json`.

| Batch | Source ID | Repository |
| --- | --- | --- |
| A | `anthropic-plugins-official` | `https://github.com/anthropics/claude-plugins-official` |
| A | `anthropic-skills` | `https://github.com/anthropics/skills` |
| A | `obra-superpowers` | `https://github.com/obra/superpowers` |
| A | `wshobson-agents` | `https://github.com/wshobson/agents` |
| A | `coreyhaines31-marketingskills` | `https://github.com/coreyhaines31/marketingskills` |
| B | `deanpeters-product-manager-skills` | `https://github.com/deanpeters/Product-Manager-Skills` |
| B | `daymade-claude-code-skills` | `https://github.com/daymade/claude-code-skills` |
| B | `k-dense-scientific-agent-skills` | `https://github.com/K-Dense-AI/scientific-agent-skills` |
| B | `huggingface-skills` | `https://github.com/huggingface/skills` |
| B | `chengfeng-videocut-skills` | `https://github.com/Agentchengfeng/chengfeng-videocut-skills` |
| C | `nexscope-ecommerce-skills` | `https://github.com/nexscope-ai/eCommerce-Skills` |
| C | `kepano-obsidian-skills` | `https://github.com/kepano/obsidian-skills` |
| C | `alirezarezvani-claude-skills` | `https://github.com/alirezarezvani/claude-skills` |
| C | `jeremylongshore-plugins-plus-skills` | `https://github.com/jeremylongshore/claude-code-plugins-plus-skills` |
| C | `composio-awesome-claude-skills` | `https://github.com/ComposioHQ/awesome-claude-skills` |

```ts
export const INITIAL_CENSUS_SNAPSHOT_IDS = [
  "2026-07-23-anthropic-plugins-official",
  "2026-07-23-anthropic-skills",
  "2026-07-23-obra-superpowers",
  "2026-07-23-wshobson-agents",
  "2026-07-23-coreyhaines31-marketingskills",
  "2026-07-23-deanpeters-product-manager-skills",
  "2026-07-23-daymade-claude-code-skills",
  "2026-07-23-k-dense-scientific-agent-skills",
  "2026-07-23-huggingface-skills",
  "2026-07-23-chengfeng-videocut-skills",
  "2026-07-23-nexscope-ecommerce-skills",
  "2026-07-23-kepano-obsidian-skills",
  "2026-07-23-alirezarezvani-claude-skills",
  "2026-07-23-jeremylongshore-plugins-plus-skills",
  "2026-07-23-composio-awesome-claude-skills"
] as const;
```

Task 9 captures one real UTC instant at the start of live collection and writes it to `research/census-observed-at.txt` with one LF. Tasks 9-11 read that exact checked-in value; they never invent, backdate, or refresh a timestamp per source. A later retry must use a new dated census rather than silently changing these records.

```ts
interface ResearchSourceConfig {
  schemaVersion: 2;
  sourceId: string;
  repository: string;
  queryUrls: string[];
  reportedCountClaims: Array<{
    kind: SnapshotEntryKind;
    count: number;
    sourceUrl: string;
  }>;
  markdownIndexPaths: string[];
}

interface ResearchCollectionReceipt {
  schemaVersion: 2;
  id: string;
  sourceId: string;
  snapshotId: string;
  observedAt: string;
  inspectedCommit: string;
  collectorVersion: string;
  independentCounts: Array<{ kind: SnapshotEntryKind; count: number }>;
  snapshotContentSha256: string;
}
```

Marketplace `sourceUrl` is extracted only from a closed plugin source field containing an HTTPS original repository. Markdown original-source discovery is enabled only for config-listed index paths; each HTTPS GitHub link becomes a `repository-record` address `<path>#link/<zero-based-index>`. Other entries use `sourceUrl: null`.

The 15 source configs are exact. Each JSON file is the row projected in interface key order and ends with one LF. `reportedCountClaims` is deliberately empty because P03 records no mutable README marketing count as a trust input. Only the aggregator's checked-in README is link-indexed; the other repositories are direct sources.

| Source ID | `repository` and sole `queryUrls` entry | `reportedCountClaims` | `markdownIndexPaths` |
| --- | --- | --- | --- |
| `anthropic-plugins-official` | `https://github.com/anthropics/claude-plugins-official` | `[]` | `[]` |
| `anthropic-skills` | `https://github.com/anthropics/skills` | `[]` | `[]` |
| `obra-superpowers` | `https://github.com/obra/superpowers` | `[]` | `[]` |
| `wshobson-agents` | `https://github.com/wshobson/agents` | `[]` | `[]` |
| `coreyhaines31-marketingskills` | `https://github.com/coreyhaines31/marketingskills` | `[]` | `[]` |
| `deanpeters-product-manager-skills` | `https://github.com/deanpeters/Product-Manager-Skills` | `[]` | `[]` |
| `daymade-claude-code-skills` | `https://github.com/daymade/claude-code-skills` | `[]` | `[]` |
| `k-dense-scientific-agent-skills` | `https://github.com/K-Dense-AI/scientific-agent-skills` | `[]` | `[]` |
| `huggingface-skills` | `https://github.com/huggingface/skills` | `[]` | `[]` |
| `chengfeng-videocut-skills` | `https://github.com/Agentchengfeng/chengfeng-videocut-skills` | `[]` | `[]` |
| `nexscope-ecommerce-skills` | `https://github.com/nexscope-ai/eCommerce-Skills` | `[]` | `[]` |
| `kepano-obsidian-skills` | `https://github.com/kepano/obsidian-skills` | `[]` | `[]` |
| `alirezarezvani-claude-skills` | `https://github.com/alirezarezvani/claude-skills` | `[]` | `[]` |
| `jeremylongshore-plugins-plus-skills` | `https://github.com/jeremylongshore/claude-code-plugins-plus-skills` | `[]` | `[]` |
| `composio-awesome-claude-skills` | `https://github.com/ComposioHQ/awesome-claude-skills` | `[]` | `["README.md"]` |

---

### Task 1: Close Research Data Contracts

**Files:** modify `src/model/complete-v1.ts`, `src/contracts/complete-v1.ts`, `schemas/v2/research-snapshot.schema.json`, `schemas/v2/source-review.schema.json`, and `schemas/v2/provider.schema.json`; create `schemas/v2/research-census.schema.json`, `schemas/v2/research-context.schema.json`, `schemas/v2/research-evidence.schema.json`, `schemas/v2/research-queue.schema.json`, `schemas/v2/owned-gap-decision.schema.json`, `schemas/v2/research-source-config.schema.json`, and `schemas/v2/research-collection-receipt.schema.json`; modify `tests/unit/complete-v1-types.test.ts` and `tests/unit/complete-v1-contracts.test.ts`.

**Produces:** the exact interfaces above plus validators for all seven new schemas.

- [ ] Add RED contract tests using this minimum failure table:

```ts
it("rejects removed snapshot count fields", () => {
  expect(() => validateResearchSnapshot({ ...validSnapshot, reportedCount: 1 })).toThrow(/reportedCount/);
});
it("rejects an unknown hard gate", () => {
  expect(() => validateSourceReview({
    ...validReview,
    hardGates: [{ id: "popular", passed: true, evidenceRefs: ["evidence"] }]
  })).toThrow(/hardGates/);
});
it("rejects fractional score components", () => {
  expect(() => validateSourceReview({
    ...validReview,
    score: { ...validReview.score, outcomeFitAndDepth: 39.5 }
  })).toThrow(/outcomeFitAndDepth/);
});
it("rejects owned providers with upstream review fields or no gap", () => {
  expect(() => validateProvider({
    ...validOwnedProvider,
    sourceReviewId: "fabricated-upstream-review",
    ownedGapDecisionIds: []
  })).toThrow();
});
```

- [ ] Replace the snapshot shape exactly, extend review types exactly, and split provider bases: external providers require `sourceReviewId`; owned providers forbid it and require `ownedGapDecisionIds`. Compile all seven new closed schemas, require the exact hard-gate and score-criterion sets semantically, and reject unknown fields.

```ts
export const validateResearchCensus = (value: unknown): ResearchCensus =>
  validateContract("research census", validateResearchCensusSchema, value);
export const validateResearchContext = (value: unknown): ResearchEvaluationContext =>
  validateContract("research context", validateResearchContextSchema, value);
export const validateResearchEvidence = (value: unknown): ResearchEvidence =>
  validateContract("research evidence", validateResearchEvidenceSchema, value);
export const validateResearchQueue = (value: unknown): ResearchQueue =>
  validateContract("research queue", validateResearchQueueSchema, value);
export const validateOwnedGapDecision = (value: unknown): OwnedGapDecision =>
  validateContract("owned gap decision", validateOwnedGapDecisionSchema, value);
export const validateResearchSourceConfig = (value: unknown): ResearchSourceConfig =>
  validateContract("research source config", validateResearchSourceConfigSchema, value);
export const validateResearchCollectionReceipt = (value: unknown): ResearchCollectionReceipt =>
  validateContract("research collection receipt", validateResearchCollectionReceiptSchema, value);
```
- [ ] Run `npm test -- tests/unit/complete-v1-types.test.ts tests/unit/complete-v1-contracts.test.ts`; expect the new RED cases and all prior P01 cases to pass.
- [ ] Run `npm run check` and commit `git commit -s -m "feat: close research governance contracts"`.

### Task 2: Canonicalize and Verify Snapshots

**Files:** create `src/research/snapshot.ts`, `tests/unit/research-snapshot.test.ts`, and `tests/fixtures/research/snapshots/2026-07-23-example.json`.

**Produces:**

```ts
canonicalizeSnapshotEntries(entries: readonly ResearchSnapshotEntry[]): ResearchSnapshotEntry[];
snapshotContentBytes(entries: readonly ResearchSnapshotEntry[]): Buffer;
computeSnapshotContentSha256(entries: readonly ResearchSnapshotEntry[]): string;
verifyResearchSnapshot(snapshot: ResearchSnapshot): ResearchSnapshot;
compareCodePointStrings(left: string, right: string): number;
const SNAPSHOT_ENTRY_KINDS: readonly SnapshotEntryKind[] = [
  "marketplace-entry", "plugin-manifest", "repository-record", "skill-file"
];
```

- [ ] Add RED tests for shuffled object keys/entry order, duplicate kind-address pairs, invalid RFC 6901 addresses, missing/all-kind metrics, nullable reported counts without/with source URLs, wrong per-kind totals, wrong hash, and caller mutation.
- [ ] Project every entry into literal key order `kind,address,sourceUrl`, sort by code point, serialize compact JSON plus LF, and hash those bytes. Require exactly one metric per represented kind and `independentlyCountedTotal` equal to entry count for that kind. Require `reportedCount` and `reportedCountSourceUrl` both null or both non-null.

```ts
export function snapshotContentBytes(entries: readonly ResearchSnapshotEntry[]): Buffer {
  const projected = canonicalizeSnapshotEntries(entries).map(({ kind, address, sourceUrl }) =>
    ({ kind, address, sourceUrl }));
  return Buffer.from(`${JSON.stringify(projected)}\n`, "utf8");
}
```
- [ ] Run `npm test -- tests/unit/research-snapshot.test.ts`; expect all canonical variants to produce one fixture digest.
- [ ] Run `npm run check` and commit `git commit -s -m "feat: verify immutable research snapshots"`.

### Task 3: Build the Versioned Census Collector

**Files:** create `scripts/research/collect-github-tree.ts`, `src/research/classify.ts`, `tests/unit/research-classify.test.ts`, `tests/integration/research-collector.test.ts`, and the 15 exact `research/sources/<source-id>.json` files listed in the census table; add `research:collect` to `package.json`.

**Produces:** a read-only CLI:

```text
npm run research:collect -- --config research/sources/<source-id>.json --observed-at <RFC3339-UTC> --output <snapshot.json> --receipt <receipt.json>
```

```ts
interface GitTreeTransport {
  resolveHead(repository: string): Promise<{ ref: string; commit: string }>;
  listPaths(repository: string, commit: string): Promise<string[]>;
  readBlob(repository: string, commit: string, path: string): Promise<Buffer>;
  dispose(): Promise<void>;
}
collectResearchSource(input: {
  config: ResearchSourceConfig;
  snapshotId: string;
  observedAt: string;
  toolVersion: string;
  transport: GitTreeTransport;
}): Promise<{ snapshot: ResearchSnapshot; receipt: ResearchCollectionReceipt }>;
```

- [ ] RED-test a local bare Git fixture containing `SKILL.md`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`; inject a fixture `GitTreeTransport`, require exact file entries and marketplace addresses `...#/plugins/0`, and assert `dispose()` once on success and every failure. The production CLI alone constructs the HTTPS-only `GitCliTransport`.

```ts
const validConfig: ResearchSourceConfig = {
  schemaVersion: 2,
  sourceId: "fixture",
  repository: "https://github.com/example/fixture",
  queryUrls: ["https://github.com/example/fixture"],
  reportedCountClaims: [],
  markdownIndexPaths: []
};
const fixtureTransport: GitTreeTransport = {
  resolveHead: async () => ({ ref: "refs/heads/main", commit: "1".repeat(40) }),
  listPaths: async () => [".claude-plugin/marketplace.json", ".claude-plugin/plugin.json", "skills/example/SKILL.md"],
  readBlob: async (_repository, _commit, path) => Buffer.from(path.endsWith("marketplace.json")
    ? "{\"plugins\":[{\"source\":\"https://github.com/example/original\"}]}" : "{}", "utf8"),
  dispose: vi.fn(async () => undefined)
};
it("collects a closed tree at one immutable commit", async () => {
  const result = await collectResearchSource({ config: validConfig, snapshotId: "2026-07-23-fixture", observedAt: "2026-07-23T06:00:00Z", toolVersion: "0.1.0", transport: fixtureTransport });
  expect(result.snapshot.inspectedCommit).toBe("1".repeat(40));
  expect(result.snapshot.entries.map(({ kind, address }) => [kind, address])).toEqual([
    ["marketplace-entry", ".claude-plugin/marketplace.json#/plugins/0"],
    ["plugin-manifest", ".claude-plugin/plugin.json"],
    ["repository-record", "."],
    ["skill-file", "skills/example/SKILL.md"]
  ]);
  expect(result.receipt.independentCounts).toEqual(result.snapshot.countMetrics.map(({ kind, independentlyCountedTotal: count }) => ({ kind, count })));
});
function fixtureTransportFor(fault: "truncated-marketplace" | "duplicate-address" | "unresolved-commit"): GitTreeTransport {
  return {
    resolveHead: async () => ({ ref: "refs/heads/main", commit: fault === "unresolved-commit" ? "bad" : "1".repeat(40) }),
    listPaths: async () => fault === "duplicate-address"
      ? ["skills/example/SKILL.md", "skills/example/SKILL.md"]
      : [".claude-plugin/marketplace.json"],
    readBlob: async () => Buffer.from(fault === "truncated-marketplace" ? "{" : "{\"plugins\":[]}", "utf8"),
    dispose: vi.fn(async () => undefined)
  };
}
it.each([
  ["truncated-marketplace", /invalid marketplace JSON/],
  ["duplicate-address", /duplicate/],
  ["unresolved-commit", /unresolved commit/]
] as const)("fails closed: %s", async (fault, expected) => {
  const transport = fixtureTransportFor(fault);
  await expect(collectResearchSource({ config: validConfig, snapshotId: "2026-07-23-fixture", observedAt: "2026-07-23T06:00:00Z", toolVersion: "0.1.0", transport })).rejects.toThrow(expected);
  expect(transport.dispose).toHaveBeenCalledTimes(1);
});
```
- [ ] Resolve `HEAD` with `git ls-remote --symref`, fetch the exact commit into a temporary partial clone, enumerate with `git ls-tree -r --name-only <sha>`, read only marketplace manifests needed to count entries, and delete the temporary clone in `finally`.
- [ ] Classify basename `SKILL.md` as `skill-file`, path segment `.claude-plugin/plugin.json` as `plugin-manifest`, every marketplace `plugins[index]` as `marketplace-entry`, config-listed Markdown HTTPS GitHub links as indexed `repository-record` entries, and `.` as one repository record. Extract source URLs only by the rules above. Reject invalid/truncated marketplace JSON, duplicate addresses, unresolved SHA, unsafe output, and any non-HTTPS GitHub repository.

```ts
export function classifyTreePath(path: string): SnapshotEntryKind | undefined {
  if (path.split("/").at(-1) === "SKILL.md") return "skill-file";
  if (path.endsWith("/.claude-plugin/plugin.json") || path === ".claude-plugin/plugin.json") {
    return "plugin-manifest";
  }
  return undefined;
}

export function classifyTree(
  paths: readonly string[],
  marketplaceDocuments: ReadonlyMap<string, unknown>,
  markdownDocuments: ReadonlyMap<string, string>,
  config: ResearchSourceConfig
): ResearchSnapshotEntry[] {
  const entries: ResearchSnapshotEntry[] = [{ kind: "repository-record", address: ".", sourceUrl: config.repository }];
  for (const path of [...paths].sort(compareCodePointStrings)) {
    const kind = classifyTreePath(path);
    if (kind !== undefined) entries.push({ kind, address: path, sourceUrl: null });
    if (path.endsWith("/.claude-plugin/marketplace.json") || path === ".claude-plugin/marketplace.json") {
      const document = parseClosedMarketplace(marketplaceDocuments.get(path), path);
      document.plugins.forEach((plugin, index) => entries.push({
        kind: "marketplace-entry",
        address: `${path}#/plugins/${index}`,
        sourceUrl: originalHttpsGitHubSource(plugin.source)
      }));
    }
  }
  for (const path of config.markdownIndexPaths) {
    extractHttpsGitHubLinks(markdownDocuments.get(path) ?? "").forEach((sourceUrl, index) => entries.push({
      kind: "repository-record", address: `${path}#link/${index}`, sourceUrl
    }));
  }
  return canonicalizeSnapshotEntries(entries);
}

interface ClosedMarketplace { plugins: Array<{ source: unknown }> }
function parseClosedMarketplace(value: unknown, path: string): ClosedMarketplace {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path}: marketplace must be an object`);
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.plugins)) throw new Error(`${path}:/plugins must be an array`);
  return { plugins: record.plugins.map((plugin, index) => {
    if (typeof plugin !== "object" || plugin === null || Array.isArray(plugin) || !("source" in plugin)) {
      throw new Error(`${path}:/plugins/${index}/source is required`);
    }
    return { source: (plugin as Record<string, unknown>).source };
  }) };
}

function originalHttpsGitHubSource(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u.test(value)
    ? value.replace(/\.git$/u, "") : null;
}

function extractHttpsGitHubLinks(markdown: string): string[] {
  return [...markdown.matchAll(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gu)]
    .map(([url]) => url.replace(/[),.;]+$/u, "")).filter((url, index, all) => all.indexOf(url) === index);
}

export function independentCounts(entries: readonly ResearchSnapshotEntry[], config: ResearchSourceConfig): ResearchCountMetric[] {
  const claimByKind = new Map(config.reportedCountClaims.map((claim) => [claim.kind, claim]));
  return SNAPSHOT_ENTRY_KINDS.filter((kind) => entries.some((entry) => entry.kind === kind)).map((kind) => {
    const claim = claimByKind.get(kind);
    return {
      kind,
      reportedCount: claim?.count ?? null,
      reportedCountSourceUrl: claim?.sourceUrl ?? null,
      independentlyCountedTotal: entries.filter((entry) => entry.kind === kind).length
    };
  });
}

export async function collectResearchSource(input: {
  config: ResearchSourceConfig;
  snapshotId: string;
  observedAt: string;
  toolVersion: string;
  transport: GitTreeTransport;
}): Promise<{ snapshot: ResearchSnapshot; receipt: ResearchCollectionReceipt }> {
  try {
    const { ref, commit } = await input.transport.resolveHead(input.config.repository);
    if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error(`${input.config.sourceId}: unresolved commit`);
    const paths = await input.transport.listPaths(input.config.repository, commit);
    const marketplaceDocuments = new Map<string, unknown>();
    const markdownDocuments = new Map<string, string>();
    for (const path of paths.filter((candidate) => candidate.endsWith("/.claude-plugin/marketplace.json") || candidate === ".claude-plugin/marketplace.json")) {
      try {
        marketplaceDocuments.set(path, JSON.parse((await input.transport.readBlob(input.config.repository, commit, path)).toString("utf8")));
      } catch (error) {
        throw new Error(`${path}: invalid marketplace JSON`, { cause: error });
      }
    }
    for (const path of input.config.markdownIndexPaths) {
      if (!paths.includes(path)) throw new Error(`${input.config.sourceId}: missing configured Markdown index ${path}`);
      markdownDocuments.set(path, (await input.transport.readBlob(input.config.repository, commit, path)).toString("utf8"));
    }
    const entries = classifyTree(paths, marketplaceDocuments, markdownDocuments, input.config);
    const countMetrics = independentCounts(entries, input.config);
    const snapshot: ResearchSnapshot = {
      schemaVersion: 2,
      id: input.snapshotId,
      sourceUrl: input.config.repository,
      queryUrls: input.config.queryUrls,
      observedAt: input.observedAt,
      inspectedRef: ref,
      inspectedCommit: commit,
      collectionMethod: "git-tree-and-marketplace-v1",
      toolVersion: input.toolVersion,
      entries,
      countMetrics,
      contentSha256: computeSnapshotContentSha256(entries)
    };
    verifyResearchSnapshot(snapshot);
    const receipt: ResearchCollectionReceipt = {
      schemaVersion: 2,
      id: snapshot.id,
      sourceId: input.config.sourceId,
      snapshotId: snapshot.id,
      observedAt: input.observedAt,
      inspectedCommit: commit,
      collectorVersion: input.toolVersion,
      independentCounts: independentCounts(entries, input.config).map(({ kind, independentlyCountedTotal: count }) => ({ kind, count })),
      snapshotContentSha256: snapshot.contentSha256
    };
    return { snapshot, receipt };
  } finally {
    await input.transport.dispose();
  }
}
```
- [ ] Implement `main(args)` as: parse the five required flags and reject extras; validate the config; derive `snapshotId` from the output basename without `.json` and require it equal `2026-07-23-${config.sourceId}`; reject pre-existing output or receipt paths; resolve symbolic HEAD and exact SHA; create `mkdtemp`; `git init`, `git remote add`, `git fetch --depth=1 --filter=blob:none origin <sha>`, and `git checkout --detach <sha>` using `spawn(..., { shell: false })`; enumerate tree paths; read only listed marketplace/Markdown blobs with `git show <sha>:<path>`; call `classifyTree`; compute metrics, hash, snapshot, and receipt; write both to sibling temporary files using `open(..., "wx", 0o600)`, `fsync`, close, then rename snapshot and receipt. Before either rename, call `verifyResearchSnapshot(snapshot)` and independently call `independentCounts(entries, config)` again for the receipt. On any failure remove temporary files and either newly-renamed file; remove the clone in `finally`. Because existing targets are rejected, rollback leaves both target paths absent and never changes prior evidence.
- [ ] Set `collectionMethod` to `git-tree-and-marketplace-v1` and `toolVersion` to the package version. Use config query URLs and cited count claims. Write only the closed sanitized receipt; never commit clones or raw trees.
- [ ] Run `npm test -- tests/unit/research-classify.test.ts tests/integration/research-collector.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: collect reproducible github census snapshots"`.

### Task 4: Load Research Data and Verify Evidence Artifacts

**Files:** create `src/research/repository.ts`, `tests/unit/research-repository.test.ts`, `research/census.json`, `research/evaluation-context.json`, `research/review-queue.json`, and `.gitkeep` files under `research/snapshots`, `research/receipts`, `research/evidence`, `research/evidence/artifacts`, `manifests/complete-v1-providers`, `manifests/source-reviews`, `manifests/conflicts`, and `manifests/owned-gaps`.

**Produces:**

```ts
interface ResearchRepository {
  census: ResearchCensus;
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
loadResearchRepository(root: string): Promise<ResearchRepository>;
```

`manifests/complete-v1-providers` is the isolated v2 provider-decision root. Legacy `manifests/external-sources` remains the unchanged foundation projection until P10.

Task 4 commits these exact construction-state roots (one LF each):

```json
{"schemaVersion":2,"id":"initial-discovery-census-2026-07-23","purpose":"discovery-only","selectionAllowed":false,"snapshotIds":[]}
{"schemaVersion":2,"asOf":"2026-07-23T05:39:45Z","privateRcAt":null,"upstreamObservations":[]}
{"schemaVersion":2,"candidates":[],"capabilitySearch":[]}
```

- [ ] RED-test missing exact files/roots, malformed records, duplicate IDs, nested data, symlinks, wrong extensions, unowned snapshots, review/search evidence path escape or symlink, tampered review/search artifact digest, locale ordering, and absolute checkout paths in outer errors.
- [ ] Load only direct `.json` source configs/snapshots/receipts/evidence and direct `.yaml` v2 manifests. In each otherwise-empty tracked root, permit exactly one zero-byte regular non-symlink `.gitkeep`; ignore it during data loading and reject it once any sibling data record exists. Exempt only evidence artifacts referenced by records; reject every unreferenced nested regular artifact other than the same construction-state `.gitkeep`. Verify containment, regular-file identity, and SHA-256 before return.

```ts
async function verifyEvidenceArtifact(root: string, evidence: ResearchEvidence): Promise<void> {
  const artifactsRoot = await realpath(join(root, "research/evidence/artifacts"));
  const candidate = join(root, evidence.artifactPath);
  const containedArtifactPath = await realpath(candidate);
  const relativePath = relative(artifactsRoot, containedArtifactPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${evidence.artifactPath}: evidence artifact escapes research/evidence/artifacts`);
  }
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${evidence.artifactPath}: evidence artifact must be a regular non-symlink file`);
  }
  const actual = createHash("sha256").update(await readFile(containedArtifactPath)).digest("hex");
  if (actual !== evidence.artifactSha256) {
    throw new Error(`${evidence.artifactPath}: evidence artifact SHA-256 mismatch`);
  }
}
```
- [ ] Commit an empty queue and empty provider/review/conflict/gap collections. Commit a census with an empty `snapshotIds` list only until Tasks 9-12 populate it; the validator must distinguish this construction state from P03 exit.
- [ ] Run `npm test -- tests/unit/research-repository.test.ts tests/unit/research-snapshot.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: load research governance records"`.

### Task 5: Validate Candidate Search, Review Lineage, and Owned Gaps

**Files:** create `src/research/queue.ts` and `tests/unit/research-queue.test.ts`.

**Produces:**

```ts
validateResearchQueueGraph(repository: ResearchRepository, capabilityIds: ReadonlySet<string>): ResearchQueue;
candidateCoverageFor(repository: ResearchRepository, capabilityId: string): readonly ResearchQueueCandidate[];
```

- [ ] RED-test unknown capabilities/snapshots, orphan candidates, non-bidirectional search membership, duplicate materially-distinct groups, aggregator rows without original-source follow-through, fewer-than-three prose instead of passed `search-evidence` IDs, reviews not linked to candidate/search, review forks/cycles/cross-provider lineage, and gap terminal review omission.
- [ ] Require three distinct groups or passed structured fewer-found evidence. Require every discovered candidate to have one terminal `held`/`rejected` review before a gap. Require gap/search/provider references to be exact and bidirectional. Task 8 adds the governance-ineligible requirement after Task 6 exists.

```ts
const distinctGroups = new Set(candidates.map(({ materiallyDistinctGroup }) => materiallyDistinctGroup));
if (distinctGroups.size < 3 && passedSearchEvidence.length === 0) {
  throw new Error(`${search.id}: fewer than three candidates requires passed search evidence`);
}
```
- [ ] Return sorted structured clones and throw deterministic repository-relative diagnostics.
- [ ] Run `npm test -- tests/unit/research-queue.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: validate capability research queues"`.

### Task 6: Reproduce Hard Gates, Scores, Status, and Trust

**Files:** create `src/research/governance.ts` and `tests/unit/research-governance.test.ts`.

**Produces:**

```ts
interface GovernanceDecision {
  eligible: boolean;
  trustTier: "trusted" | "community" | "blocked";
  scoreTotal: number;
  failedGateIds: HardGateId[];
  reasons: string[];
  requiresAcknowledgement: boolean;
}
evaluateResearchGovernance(input:
  | { provider: NativeMarketplaceProvider | PinnedGitSubdirProvider;
      review: SourceReviewManifest; snapshots: readonly ResearchSnapshot[];
      evidence: readonly ReviewEvidence[]; completeV1: CompleteV1Repository;
      context: ResearchEvaluationContext; }
  | { provider: OwnedProvider; ownedGapDecisions: readonly OwnedGapDecision[];
      completeV1: CompleteV1Repository; context: ResearchEvaluationContext; }
): GovernanceDecision;
```

- [ ] RED-test all 11 missing/false/duplicate gates; wrong evidence kind; evidence bound to another review, commit, path, snapshot, or platform; one-smoke-only; revoked review; missing/unknown/duplicate score criteria; failed criterion evidence; totals 64/65/79/80/100; declared trust mismatch; draft/deprecated/blocked status; and owned release pending without any fabricated review.
- [ ] Enforce both matrices, exact review/revision/path equality, both smoke kinds, linked P02 domain/category/capability/pack ownership, and each criterion's field predicate. Derive criterion passes from fields plus passed evidence, then recompute all five components and total; require the stored component fields to equal those derived values and never accept a stored total. Only `stable` external providers can be eligible. `beta`, `draft`, `deprecated`, `blocked`, rejected/held reviews, and owned providers remain ineligible in P03.

```ts
const exactStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

function permissionsAreBounded(value: PermissionDeclaration): boolean {
  const fields = [value.filesystem, value.commands, value.network, value.externalData];
  if (fields.some((items) => items.some((item) =>
    item === "*" || item.includes("..") || item.startsWith("/") || item.startsWith("~")))) return false;
  if (value.commands.some((command) => /[;&|><`$(){}]/u.test(command) || /(^|\s)sudo(\s|$)/u.test(command))) return false;
  if (value.network.some((entry) => entry !== "none" && !/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?$/u.test(entry))) return false;
  return fields.every((items) => items.every((item) => item.trim() === item && item.length > 0));
}

function completeUtcDays(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function bindPassedEvidence(input: {
  provider: NativeMarketplaceProvider | PinnedGitSubdirProvider;
  review: SourceReviewManifest;
  evidence: readonly ReviewEvidence[];
}): ReviewEvidence[] {
  const byId = new Map(input.evidence.map((item) => [item.id, item]));
  return input.review.evidenceIds.map((id) => {
    const item = byId.get(id);
    if (item === undefined || item.outcome !== "passed" || item.reviewId !== input.review.id ||
        item.providerId !== input.provider.id || item.reviewedCommit !== input.review.reviewedCommit ||
        !input.review.snapshotIds.includes(item.snapshotId) ||
        !exactStrings(item.selectedPaths, input.review.selectedPaths) ||
        !exactStrings(item.platforms, input.review.compatibility.platforms)) {
      throw new Error(`${input.review.id}: evidence ${id} is missing, failed, or not exactly bound`);
    }
    return item;
  });
}

function hardGatePasses(
  id: HardGateId,
  input: Extract<Parameters<typeof evaluateResearchGovernance>[0], { review: SourceReviewManifest }>,
  passedKinds: ReadonlySet<ReviewEvidence["kind"]>
): boolean {
  const { provider, review } = input;
  const has = (...kinds: ReviewEvidence["kind"][]): boolean => kinds.every((kind) => passedKinds.has(kind));
  switch (id) {
    case "original-repository-identified": return /^https:\/\/github\.com\//u.test(review.originalRepository) && has("source-identity");
    case "selected-path-license-usable": return !/^(unknown|missing|incompatible)$/iu.test(review.licenseConclusion.trim()) && has("license");
    case "immutable-reviewed-revision": return input.snapshots.some(({ inspectedCommit }) => inspectedCommit === review.reviewedCommit) && has("source-identity");
    case "marketplace-identity-consistent": return provider.installStrategy === "native-marketplace-plugin"
      ? review.marketplaceIdentity?.id === provider.marketplaceId && review.marketplaceIdentity.source === provider.marketplaceSource && has("marketplace-identity")
      : review.marketplaceIdentity === null && provider.repositoryUrl === review.originalRepository && has("source-identity");
    case "transparent-bootstrap-and-surfaces": return Object.keys(review.surfaces).sort(compareCodePointStrings).join(",") === "agents,binaries,commands,hooks,mcpServers,scripts,skills" && has("surface-inventory");
    case "bounded-permissions": return JSON.stringify(provider.permissions) === JSON.stringify(review.permissions) && permissionsAreBounded(review.permissions) && has("permissions");
    case "documented-secret-flow": return review.secretFlows.every(({ documentedIntegrationFlow }) => documentedIntegrationFlow) && has("secret-flow");
    case "compatible-runtime-and-platforms": return review.compatibility.claudeVersionRange.trim().length > 0 && exactStrings(provider.platforms, review.compatibility.platforms) && has("compatibility");
    case "outcome-value-demonstrated": return review.capabilityIds.length > 0 && review.linkedPackIds.length > 0 && has("outcome-evaluation");
    case "lifecycle-strategy": return review.updatePolicy.trim().length > 0 && review.removalStrategy.trim().length > 0 && has("lifecycle");
    case "install-and-semantic-smoke": return has("install-smoke", "semantic-smoke");
  }
}

function criterionPasses(
  criterion: SourceReviewManifest["scoreCriteria"][number],
  input: Extract<Parameters<typeof evaluateResearchGovernance>[0], { review: SourceReviewManifest }>,
  passedKinds: ReadonlySet<ReviewEvidence["kind"]>
): boolean {
  const { provider, review, completeV1, context } = input;
  const capabilities = completeV1.capabilityCollections.flatMap(({ capabilities }) => capabilities);
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const packById = new Map(completeV1.packs.map((pack) => [pack.id, pack]));
  const reviewedCapabilities = review.capabilityIds.map((id) => capabilityById.get(id));
  const evidencePassed = (...kinds: ReviewEvidence["kind"][]): boolean => kinds.every((kind) => passedKinds.has(kind));
  switch (criterion.id) {
    case "fit-capability-coverage":
      return review.capabilityIds.length > 0 && exactStrings(provider.capabilityIds, review.capabilityIds) && evidencePassed("outcome-evaluation");
    case "fit-pack-outcome":
      return review.linkedPackIds.length > 0 && review.linkedPackIds.every((id) => {
        const pack = packById.get(id);
        return pack !== undefined && [...pack.requiredCapabilityIds, ...pack.recommendedCapabilityIds]
          .some((capabilityId) => review.capabilityIds.includes(capabilityId));
      }) && evidencePassed("outcome-evaluation");
    case "fit-domain-depth": {
      if (reviewedCapabilities.some((capability) => capability === undefined)) return false;
      const domains = [...new Set(reviewedCapabilities.map((capability) => capability!.ownerDomainId))].sort(compareCodePointStrings);
      const categories = [...new Set(reviewedCapabilities.flatMap((capability) => capability!.categoryIds))].sort(compareCodePointStrings);
      return exactStrings(review.linkedDomainIds, domains) && exactStrings(review.linkedCategoryIds, categories) && evidencePassed("outcome-evaluation");
    }
    case "security-bounded-permissions":
      return JSON.stringify(provider.permissions) === JSON.stringify(review.permissions) && permissionsAreBounded(review.permissions) && evidencePassed("permissions");
    case "security-transparent-surfaces":
      return Object.keys(review.surfaces).sort(compareCodePointStrings).join(",") === "agents,binaries,commands,hooks,mcpServers,scripts,skills" && evidencePassed("surface-inventory");
    case "security-secret-and-data-flow":
      return review.secretFlows.every(({ documentedIntegrationFlow }) => documentedIntegrationFlow) && evidencePassed("secret-flow");
    case "maintenance-current": {
      const changeAt = `${review.lastMeaningfulChange}T00:00:00Z`;
      const age = completeUtcDays(changeAt, context.asOf);
      return age >= 0 && age <= 548 && evidencePassed("maintenance");
    }
    case "maintenance-versioned":
      return review.observedVersion !== null && input.snapshots.some(({ inspectedCommit }) => inspectedCommit === review.reviewedCommit) && evidencePassed("source-identity", "maintenance");
    case "maintenance-lifecycle":
      return review.updatePolicy.trim().length > 0 && review.removalStrategy.trim().length > 0 && evidencePassed("lifecycle");
    case "install-supported-strategy":
      return (provider.installStrategy === "native-marketplace-plugin" || provider.installStrategy === "pinned-git-subdir") && evidencePassed("install-smoke");
    case "install-verifiable-identity":
      return provider.installStrategy === "native-marketplace-plugin"
        ? provider.artifactCommit === review.reviewedCommit && review.marketplaceIdentity !== null &&
          provider.marketplaceId === review.marketplaceIdentity.id && provider.marketplaceSource === review.marketplaceIdentity.source &&
          evidencePassed("source-identity", "marketplace-identity")
        : provider.repositoryUrl === review.originalRepository && provider.commitSha === review.reviewedCommit &&
          exactStrings(provider.skillPaths, review.selectedPaths) &&
          provider.skillPaths.every((path) => path === provider.subdirectory || path.startsWith(`${provider.subdirectory}/`)) &&
          evidencePassed("source-identity");
    case "install-platform-support":
      return provider.platforms.length > 0 && exactStrings(provider.platforms, review.compatibility.platforms) && evidencePassed("compatibility");
    case "evidence-documentation": return evidencePassed("documentation");
    case "evidence-install-smoke": return evidencePassed("install-smoke");
    case "evidence-semantic-smoke": return evidencePassed("semantic-smoke");
  }
}

const boundPassedEvidence = bindPassedEvidence(input);
const boundById = new Map(boundPassedEvidence.map((item) => [item.id, item]));
const referencedIds = new Set<string>();
for (const gate of review.hardGates) {
  const gateEvidence = gate.evidenceRefs.map((id) => {
    referencedIds.add(id);
    const item = boundById.get(id);
    if (item === undefined) throw new Error(`${review.id}: hard gate ${gate.id} references unbound evidence ${id}`);
    return item;
  });
  if (gate.passed !== hardGatePasses(gate.id, input, new Set(gateEvidence.map(({ kind }) => kind)))) {
    throw new Error(`${review.id}: hard gate ${gate.id} does not reproduce from bound evidence and fields`);
  }
}
const scoreTotal = review.scoreCriteria.reduce((total, criterion) => {
  const criterionEvidence = criterion.evidenceRefs.map((id) => {
    referencedIds.add(id);
    const item = boundById.get(id);
    if (item === undefined) throw new Error(`${review.id}: score criterion ${criterion.id} references unbound evidence ${id}`);
    return item;
  });
  return total + (criterionPasses(criterion, input, new Set(criterionEvidence.map(({ kind }) => kind))) ? SCORE_CRITERIA[criterion.id] : 0);
}, 0);
if (!exactStrings([...referencedIds].sort(compareCodePointStrings), [...review.evidenceIds].sort(compareCodePointStrings))) {
  throw new Error(`${review.id}: evidenceIds must exactly own all gate and score evidence references`);
}
const computedTrust = scoreTotal >= 80 ? "trusted" : scoreTotal >= 65 ? "community" : "blocked";
```
- [ ] Use the block above so each gate and criterion is evaluated only from its own references. Recompute component totals from `SCORE_COMPONENTS`, exact-compare all five stored integer fields, and reject a review-level evidence ID not owned by at least one gate or criterion.
- [ ] Map eligible external bands exactly; community sets acknowledgement. Reject external `verified` and score-derived owned `verified`.
- [ ] Run `npm test -- tests/unit/research-governance.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: reproduce provider trust decisions"`.

### Task 7: Evaluate Freshness and Timestamped Upstream Drift

**Files:** create `src/research/freshness.ts` and `tests/unit/research-freshness.test.ts`.

**Produces:**

```ts
type FreshnessIssue = "review-overdue" | "rc-recheck-required" | "upstream-drift";
interface FreshnessInput {
  provider: NativeMarketplaceProvider | PinnedGitSubdirProvider;
  review: SourceReviewManifest;
  snapshots: readonly ResearchSnapshot[];
  context: ResearchEvaluationContext;
  observationScopes: ReadonlyArray<{ providerId: string; snapshotIds: readonly string[] }>;
}
interface FreshnessResult { issues: FreshnessIssue[]; reviewedCommit: string; observedHead: string | null }
validateObservationContext(input: {
  snapshots: readonly ResearchSnapshot[];
  context: ResearchEvaluationContext;
  observationScopes: ReadonlyArray<{ providerId: string; snapshotIds: readonly string[] }>;
}): ReadonlyMap<string, ReadonlySet<string>>;
evaluateReviewFreshness(input: FreshnessInput): FreshnessResult;
```

- [ ] RED-test exact 00:00Z due boundary, leap dates, invalid context clocks, simultaneous overdue+drift, 29/30/31 complete UTC days, compile-time rejection of owned providers, unknown observation provider, wrong owning-review snapshot, unknown snapshot, future observation (including one outside the current provider), duplicate observation scope, and a head change that attempts to rewrite the review.
- [ ] Return sorted issue flags. Treat `asOf >= nextReviewDateT00:00:00Z` as overdue. For selected external providers with non-null RC, require newest matching observation within 30 complete UTC days. Compare timestamped `headCommit` to immutable `reviewedCommit` and never mutate inputs.

```ts
const sameStringSet = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...left].sort(compareCodePointStrings);
  const b = [...right].sort(compareCodePointStrings);
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

export function validateObservationContext(input: {
  snapshots: readonly ResearchSnapshot[];
  context: ResearchEvaluationContext;
  observationScopes: ReadonlyArray<{ providerId: string; snapshotIds: readonly string[] }>;
}): ReadonlyMap<string, ReadonlySet<string>> {
  const { snapshots, context } = input;
  const asOf = Date.parse(context.asOf);
  const privateRcAt = context.privateRcAt === null ? null : Date.parse(context.privateRcAt);
  if (!Number.isFinite(asOf) || (privateRcAt !== null && (!Number.isFinite(privateRcAt) || privateRcAt > asOf))) {
    throw new Error("research/evaluation-context.json: invalid or future private RC clock");
  }
  const snapshotIds = new Set(snapshots.map(({ id }) => id));
  const scopes = new Map<string, ReadonlySet<string>>();
  for (const scope of input.observationScopes) {
    if (scopes.has(scope.providerId)) throw new Error(`${scope.providerId}: duplicate observation scope`);
    if (scope.snapshotIds.some((snapshotId) => !snapshotIds.has(snapshotId))) {
      throw new Error(`${scope.providerId}: observation scope references unknown snapshot`);
    }
    scopes.set(scope.providerId, new Set(scope.snapshotIds));
  }
  for (const item of context.upstreamObservations) {
    const ownerSnapshots = scopes.get(item.providerId);
    if (ownerSnapshots === undefined || !snapshotIds.has(item.snapshotId) || !ownerSnapshots.has(item.snapshotId) ||
        !Number.isFinite(Date.parse(item.observedAt)) || Date.parse(item.observedAt) > asOf) {
      throw new Error(`${item.providerId}: upstream observation has unknown provider, wrong snapshot, or future clock`);
    }
  }
  return scopes;
}

export function evaluateReviewFreshness(input: FreshnessInput): FreshnessResult {
  const { provider, review, context } = input;
  const asOf = Date.parse(context.asOf);
  const privateRcAt = context.privateRcAt === null ? null : Date.parse(context.privateRcAt);
  const scopes = validateObservationContext(input);
  if (!sameStringSet([...(scopes.get(provider.id) ?? new Set<string>())], review.snapshotIds)) {
    throw new Error(`${provider.id}: observation scope does not equal current review snapshots`);
  }
  const observations = context.upstreamObservations.filter((item) => item.providerId === provider.id);
  const observation = [...observations].sort((left, right) =>
    Date.parse(right.observedAt) - Date.parse(left.observedAt) || compareCodePointStrings(left.snapshotId, right.snapshotId))[0];
  const issues: FreshnessIssue[] = [];
  if (asOf >= Date.parse(`${review.nextReviewDate}T00:00:00Z`)) issues.push("review-overdue");
  if (review.decision === "selected" && privateRcAt !== null &&
      (observation === undefined || Date.parse(observation.observedAt) > privateRcAt ||
       privateRcAt - Date.parse(observation.observedAt) > 30 * 86_400_000)) issues.push("rc-recheck-required");
  if (observation !== undefined && observation.headCommit !== review.reviewedCommit) issues.push("upstream-drift");
  return {
    issues: issues.sort(compareCodePointStrings),
    reviewedCommit: review.reviewedCommit,
    observedHead: observation?.headCommit ?? null
  };
}
```
- [ ] Run `npm test -- tests/unit/research-freshness.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: evaluate research freshness and drift"`.

### Task 8: Validate the Full Research Graph

**Files:** create `src/research/graph.ts` and `tests/unit/research-graph.test.ts`.

**Produces:**

```ts
interface ResearchGraphCatalog {
  completeV1: CompleteV1Repository;
  platforms: ReadonlySet<Platform>;
  expectedCensusSnapshotIds: readonly string[];
}
validateResearchGraph(repository: ResearchRepository, catalog: ResearchGraphCatalog): ResearchRepository;
```

- [ ] RED-test wrong/empty expected census IDs, unowned snapshots/configs/receipts, orphan evidence/reviews/providers/conflicts/gaps, provider-review mismatch, terminal review mismatch, capability/platform/domain/category/pack mismatch, pinned/native commit mismatch, native marketplace ID/source mismatch, pinned selected-path/subdirectory/skill allowlist mismatch, invalid conflict preference, an owned gap that ignores an eligible candidate, governance failure, every freshness issue, and an unknown/future observation when external providers are empty or owned-only.
- [ ] Invoke Tasks 5-7. Require exact ordered census equality with `expectedCensusSnapshotIds`, one matching config/receipt per snapshot, and receipt commit/count/hash equality. Require provider/review/evidence source, revision, selected-path, platform, permission, and P02 identity/ownership equality. Queue snapshots may reference the census set.

```ts
function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueById<T extends { id: string }>(kind: string, values: readonly T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) throw new Error(`${kind}: duplicate id ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

export function validateResearchGraph(repository: ResearchRepository, catalog: ResearchGraphCatalog): ResearchRepository {
  if (!arraysEqual(repository.census.snapshotIds, [...catalog.expectedCensusSnapshotIds])) {
    throw new Error("research/census.json:/snapshotIds must equal the complete P03 census order");
  }
  const snapshots = uniqueById("research/snapshots", repository.snapshots);
  const configs = uniqueById("research/sources", repository.sourceConfigs.map((config) => ({ ...config, id: config.sourceId })));
  const receipts = uniqueById("research/receipts", repository.collectionReceipts);
  for (const snapshotId of repository.census.snapshotIds) {
    const snapshot = snapshots.get(snapshotId);
    const receipt = receipts.get(snapshotId);
    if (snapshot === undefined || receipt === undefined) throw new Error(`${snapshotId}: census member lacks snapshot or receipt`);
    if (!configs.has(receipt.sourceId) || receipt.inspectedCommit !== snapshot.inspectedCommit ||
        receipt.observedAt !== snapshot.observedAt || receipt.snapshotContentSha256 !== snapshot.contentSha256 ||
        !arraysEqual(receipt.independentCounts.map(({ kind, count }) => `${kind}:${count}`),
          snapshot.countMetrics.map(({ kind, independentlyCountedTotal }) => `${kind}:${independentlyCountedTotal}`))) {
      throw new Error(`${snapshotId}: source config, receipt, and snapshot do not exactly agree`);
    }
  }
  if (snapshots.size !== repository.census.snapshotIds.length || receipts.size !== snapshots.size || configs.size !== snapshots.size) {
    throw new Error("research/census.json: unowned snapshot, receipt, or source config");
  }
  validateResearchQueueGraph(repository, new Set(catalog.completeV1.catalog.capabilityIds));
  const reviews = uniqueById("manifests/source-reviews", repository.sourceReviews);
  const providers = uniqueById("manifests/complete-v1-providers", repository.providers);
  const capabilities = new Map(catalog.completeV1.capabilityCollections.flatMap(({ capabilities }) => capabilities).map((value) => [value.id, value]));
  const categories = new Map(catalog.completeV1.categoryCollections.flatMap(({ categories }) => categories).map((value) => [value.id, value]));
  const domains = new Set(catalog.completeV1.domains.map(({ id }) => id));
  const packs = new Set(catalog.completeV1.packs.map(({ id }) => id));
  const observationScopes = repository.providers.flatMap((provider) => {
    if (provider.installStrategy === "owned") return [];
    const review = reviews.get(provider.sourceReviewId);
    return review === undefined ? [] : [{ providerId: provider.id, snapshotIds: review.snapshotIds }];
  });
  validateObservationContext({ snapshots: repository.snapshots, context: repository.context, observationScopes });
  const reachableReviewIds = new Set<string>();
  for (const provider of repository.providers) {
    if (provider.installStrategy === "owned") {
      const decision = evaluateResearchGovernance({ provider, ownedGapDecisions: repository.ownedGapDecisions, completeV1: catalog.completeV1, context: repository.context });
      if (decision.eligible) throw new Error(`${provider.id}: owned provider cannot be eligible in P03`);
      continue;
    }
    const review = reviews.get(provider.sourceReviewId);
    if (review === undefined || review.providerId !== provider.id) throw new Error(`${provider.id}: missing exact source review`);
    for (let cursor: SourceReviewManifest | undefined = review; cursor !== undefined; cursor = cursor.supersedesReviewId === undefined ? undefined : reviews.get(cursor.supersedesReviewId)) {
      if (reachableReviewIds.has(cursor.id)) break;
      reachableReviewIds.add(cursor.id);
    }
    if (!arraysEqual(provider.capabilityIds, review.capabilityIds) || !arraysEqual(provider.platforms, review.compatibility.platforms) ||
        JSON.stringify(provider.permissions) !== JSON.stringify(review.permissions)) throw new Error(`${provider.id}: provider and review declarations differ`);
    if (provider.platforms.some((platform) => !catalog.platforms.has(platform))) throw new Error(`${provider.id}: unsupported platform`);
    if (review.capabilityIds.some((id) => !capabilities.has(id)) || review.linkedCategoryIds.some((id) => !categories.has(id)) ||
        review.linkedDomainIds.some((id) => !domains.has(id)) || review.linkedPackIds.some((id) => !packs.has(id))) {
      throw new Error(`${review.id}: unknown P02 identity`);
    }
    const evidence = repository.evidence.filter((item): item is ReviewEvidence => item.kind !== "search-evidence" && item.providerId === provider.id);
    const decision = evaluateResearchGovernance({ provider, review, snapshots: repository.snapshots, evidence, completeV1: catalog.completeV1, context: repository.context });
    if (review.decision === "selected" && !decision.eligible) throw new Error(`${provider.id}: selected provider is governance-ineligible`);
    const freshness = evaluateReviewFreshness({ provider, review, snapshots: repository.snapshots, context: repository.context, observationScopes });
    if (review.decision === "selected" && freshness.issues.length > 0) throw new Error(`${provider.id}: ${freshness.issues.join(",")}`);
  }
  for (const review of repository.sourceReviews) {
    if (!reachableReviewIds.has(review.id)) throw new Error(`${review.id}: orphan source review`);
  }
  const referencedEvidenceIds = new Set(repository.sourceReviews.flatMap((review) => [
    ...review.evidenceIds,
    ...review.hardGates.flatMap(({ evidenceRefs }) => evidenceRefs),
    ...review.scoreCriteria.flatMap(({ evidenceRefs }) => evidenceRefs)
  ]));
  repository.queue.capabilitySearch.forEach((search) => search.fewerThanThreeEvidenceIds.forEach((id) => referencedEvidenceIds.add(id)));
  for (const evidence of repository.evidence) {
    if (!referencedEvidenceIds.has(evidence.id)) throw new Error(`${evidence.id}: orphan evidence`);
  }
  const gaps = uniqueById("manifests/owned-gaps", repository.ownedGapDecisions);
  for (const search of repository.queue.capabilitySearch) {
    if (search.ownedGapDecisionId !== undefined && gaps.get(search.ownedGapDecisionId)?.searchRecordId !== search.id) {
      throw new Error(`${search.id}: owned gap link is not bidirectional`);
    }
  }
  for (const gap of repository.ownedGapDecisions) {
    for (const reviewId of gap.terminalReviewIds) {
      const review = reviews.get(reviewId);
      const provider = review === undefined ? undefined : providers.get(review.providerId);
      if (review === undefined || provider === undefined || provider.installStrategy === "owned" || !["held", "rejected"].includes(review.decision)) {
        throw new Error(`${gap.id}: terminal review ${reviewId} is missing or non-terminal`);
      }
      const evidence = repository.evidence.filter((item): item is ReviewEvidence => item.kind !== "search-evidence" && item.providerId === provider.id);
      if (evaluateResearchGovernance({ provider, review, snapshots: repository.snapshots, evidence, completeV1: catalog.completeV1, context: repository.context }).eligible) {
        throw new Error(`${gap.id}: terminal review ${reviewId} remains governance-eligible`);
      }
    }
  }
  for (const conflict of repository.conflicts) {
    if (!conflict.providerIds.includes(conflict.preferredProviderId) || conflict.providerIds.some((id) => !repository.providers.some((provider) => provider.id === id))) {
      throw new Error(`${conflict.id}: conflict references an unknown or non-member preferred provider`);
    }
  }
  return structuredClone(repository);
}
```
- [ ] Implement the block exactly before the return. Task 5 owns candidate/search bidirectionality and review-lineage cycle/fork checks; this task owns repository-wide reachability and governance. Each test asserts the exact thrown string shown above.
- [ ] Empty provider/review/conflict/gap collections are valid. A non-empty disconnected subset fails. Return a structured-cloned repository only after zero diagnostics.
- [ ] Run `npm test -- tests/unit/research-graph.test.ts tests/unit/research-{queue,governance,freshness}.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: validate research governance graph"`.

### Task 9: Capture Census Batch A

**Files:** create `research/census-observed-at.txt`, `research/snapshots/2026-07-23-anthropic-plugins-official.json`, `research/snapshots/2026-07-23-anthropic-skills.json`, `research/snapshots/2026-07-23-obra-superpowers.json`, `research/snapshots/2026-07-23-wshobson-agents.json`, `research/snapshots/2026-07-23-coreyhaines31-marketingskills.json`, matching filenames under `research/receipts/`, and `tests/fixtures/research/expected/census-batch-a.json`; create `tests/integration/research-census.test.ts`.

- [ ] Run these exact commands:

```bash
date -u '+%Y-%m-%dT%H:%M:%SZ'
```

Immediately use `apply_patch` to create `research/census-observed-at.txt` containing that one output line plus LF. Then run:

```bash
OBSERVED_AT="$(sed -n '1p' research/census-observed-at.txt)"
npm run research:collect -- --config research/sources/anthropic-plugins-official.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-anthropic-plugins-official.json --receipt research/receipts/2026-07-23-anthropic-plugins-official.json
npm run research:collect -- --config research/sources/anthropic-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-anthropic-skills.json --receipt research/receipts/2026-07-23-anthropic-skills.json
npm run research:collect -- --config research/sources/obra-superpowers.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-obra-superpowers.json --receipt research/receipts/2026-07-23-obra-superpowers.json
npm run research:collect -- --config research/sources/wshobson-agents.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-wshobson-agents.json --receipt research/receipts/2026-07-23-wshobson-agents.json
npm run research:collect -- --config research/sources/coreyhaines31-marketingskills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-coreyhaines31-marketingskills.json --receipt research/receipts/2026-07-23-coreyhaines31-marketingskills.json
```

Use `apply_patch` in the same commit to replace `research/evaluation-context.json` `asOf` with `$OBSERVED_AT`; keep `privateRcAt: null` and `upstreamObservations: []`. The census observation file, every snapshot, every receipt, and evaluation context must then expose the same byte-for-byte timestamp.
- [ ] Delete the now-invalid `research/snapshots/.gitkeep` and `research/receipts/.gitkeep` with `apply_patch` before validation; the remaining empty roots retain their zero-byte construction sentinels.

Record upstream-reported counts only when the checked-in config cites a URL; otherwise store null pairs.
- [ ] RED-test the five exact IDs, URLs, immutable SHAs, per-kind metrics, and digests against the expected batch fixture before adding snapshots. The collector performs and receipts an independent recount before deleting its temporary clone; normal integration tests stay offline and compare that receipt with snapshot entries instead of refetching mutable upstream state.
- [ ] Add the five IDs to `research/census.json` in table order. Do not create queue candidates, reviews, providers, or trust claims.
- [ ] Run `npm test -- tests/integration/research-census.test.ts tests/unit/research-snapshot.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: add research census batch a"`.

### Task 10: Capture Census Batch B

**Files:** create the exact Batch B snapshot/receipt filenames for `deanpeters-product-manager-skills`, `daymade-claude-code-skills`, `k-dense-scientific-agent-skills`, `huggingface-skills`, and `chengfeng-videocut-skills`; create `tests/fixtures/research/expected/census-batch-b.json`; modify `tests/integration/research-census.test.ts` and `research/census.json`.

- [ ] Run these exact commands, independently recount each captured tree/marketplace array into the Batch B fixture, and assert cumulative census IDs equal rows A+B in order with all ten digests reproduced:

```bash
OBSERVED_AT="$(sed -n '1p' research/census-observed-at.txt)"
npm run research:collect -- --config research/sources/deanpeters-product-manager-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-deanpeters-product-manager-skills.json --receipt research/receipts/2026-07-23-deanpeters-product-manager-skills.json
npm run research:collect -- --config research/sources/daymade-claude-code-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-daymade-claude-code-skills.json --receipt research/receipts/2026-07-23-daymade-claude-code-skills.json
npm run research:collect -- --config research/sources/k-dense-scientific-agent-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-k-dense-scientific-agent-skills.json --receipt research/receipts/2026-07-23-k-dense-scientific-agent-skills.json
npm run research:collect -- --config research/sources/huggingface-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-huggingface-skills.json --receipt research/receipts/2026-07-23-huggingface-skills.json
npm run research:collect -- --config research/sources/chengfeng-videocut-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-chengfeng-videocut-skills.json --receipt research/receipts/2026-07-23-chengfeng-videocut-skills.json
```
- [ ] Run `npm test -- tests/integration/research-census.test.ts tests/unit/research-snapshot.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: add research census batch b"`.

### Task 11: Capture Census Batch C

**Files:** create the exact Batch C snapshot/receipt filenames for `nexscope-ecommerce-skills`, `kepano-obsidian-skills`, `alirezarezvani-claude-skills`, `jeremylongshore-plugins-plus-skills`, and `composio-awesome-claude-skills`; create `tests/fixtures/research/expected/census-batch-c.json`; modify `tests/integration/research-census.test.ts` and `research/census.json`.

- [ ] Run these exact commands, independently recount into the Batch C fixture, and assert the final census index equals `INITIAL_CENSUS_SNAPSHOT_IDS` with every receipt commit/count/hash and classified metric reproduced:

```bash
OBSERVED_AT="$(sed -n '1p' research/census-observed-at.txt)"
npm run research:collect -- --config research/sources/nexscope-ecommerce-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-nexscope-ecommerce-skills.json --receipt research/receipts/2026-07-23-nexscope-ecommerce-skills.json
npm run research:collect -- --config research/sources/kepano-obsidian-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-kepano-obsidian-skills.json --receipt research/receipts/2026-07-23-kepano-obsidian-skills.json
npm run research:collect -- --config research/sources/alirezarezvani-claude-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-alirezarezvani-claude-skills.json --receipt research/receipts/2026-07-23-alirezarezvani-claude-skills.json
npm run research:collect -- --config research/sources/jeremylongshore-plugins-plus-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-jeremylongshore-plugins-plus-skills.json --receipt research/receipts/2026-07-23-jeremylongshore-plugins-plus-skills.json
npm run research:collect -- --config research/sources/composio-awesome-claude-skills.json --observed-at "$OBSERVED_AT" --output research/snapshots/2026-07-23-composio-awesome-claude-skills.json --receipt research/receipts/2026-07-23-composio-awesome-claude-skills.json
```
- [ ] Treat aggregator counts as discovery scale only and preserve original-source URLs without creating provider decisions.
- [ ] Run `npm test -- tests/integration/research-census.test.ts tests/unit/research-snapshot.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: add research census batch c"`.

### Task 12: Render Deterministic Source and Trust Reports

**Files:** create `src/research/reports.ts`, `tests/unit/research-reports.test.ts`, `tests/fixtures/research/expected/source-audit.md`, and `tests/fixtures/research/expected/trust-report.md`.

**Produces:**

```ts
generateSourceAuditReport(repository: ResearchRepository): string;
generateTrustReport(repository: ResearchRepository, completeV1: CompleteV1Repository): string;
```

- [ ] RED golden-test shuffled census/review fixtures, simultaneous freshness issues, and attempts to add stars/downloads as trust fields.
- [ ] Derive census rows only from entries/metrics. Derive trust rows only from governance/freshness using `repository.context`. Show score criteria/components/total, gate/evidence failures, status, declared/computed trust, acknowledgement, revocation, due date, and drift.

```ts
interface TrustReportRow {
  id: string;
  status: ReleaseStatus;
  declared: TrustTier;
  computed: "trusted" | "community" | "blocked";
  score: number;
  components: string;
  criteria: string[];
  eligible: boolean;
  acknowledgement: boolean;
  failedGates: string[];
  failedEvidence: string[];
  revoked: boolean;
  nextReviewDate: string;
  reviewedCommit: string;
  observedHead: string | null;
  freshness: FreshnessIssue[];
}
function renderTrustRow(row: TrustReportRow): string {
  return `| ${row.id} | ${row.status} | ${row.declared} | ${row.computed} | ${row.score} | ${row.components} | ${row.criteria.join(", ") || "none"} | ${row.eligible ? "yes" : "no"} | ${row.acknowledgement ? "yes" : "no"} | ${row.failedGates.join(", ") || "none"} | ${row.failedEvidence.join(", ") || "none"} | ${row.revoked ? "yes" : "no"} | ${row.nextReviewDate} | ${row.reviewedCommit} | ${row.observedHead ?? "none"} | ${row.freshness.join(", ") || "none"} |`;
}
function renderTrustRows(rows: readonly TrustReportRow[]): string {
  const header = "| Provider | Status | Declared | Computed | Score | Components | Passed criteria | Eligible | Acknowledge | Failed gates | Failed evidence | Revoked | Next review | Reviewed commit | Observed head | Freshness |\n| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
  return `${header}${[...rows].sort((a, b) => compareCodePointStrings(a.id, b.id)).map(renderTrustRow).join("\n")}${rows.length === 0 ? "" : "\n"}`;
}
```
- [ ] `generateTrustReport` first builds `observationScopes` from every external provider's current source review and calls `validateObservationContext` once even when the scope array is empty. It then maps each external provider to that unique review, calls `evaluateResearchGovernance` with `completeV1` and `repository.context`, calls `evaluateReviewFreshness` with the same full scope array, and passes the exact fields above to `renderTrustRows`. `components` is the five stored fields in `outcome/security/maintenance/install/evidence` order; `criteria` lists only derived passes in `SCORE_CRITERIA` order; `failedEvidence` is every referenced non-passed evidence ID in code-point order. Owned providers produce `computed: "blocked"`, `score: 0`, all-zero components, empty criteria/failures/freshness, `eligible: false`, `revoked: false`, and `nextReviewDate`, `reviewedCommit`, and observed head as `"none"`, without a freshness call. `generateSourceAuditReport` renders one sorted row per census snapshot with ID, source URL, commit, observation time, each kind's independent/reported count, and content SHA-256; its header and empty-body LF are golden-tested.
- [ ] Sort by code point and end with one LF. Do not write `generated/`; P10 owns publication.
- [ ] Run `npm test -- tests/unit/research-reports.test.ts tests/unit/research-{governance,freshness}.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: render research governance reports"`.

### Task 13: Activate Atomic Research Validation

**Files:** modify `src/manifest/repository.ts`, `src/generate/all.ts`, `src/cli.ts`, `tests/integration/generation.test.ts`; create `tests/integration/research-governance.test.ts`.

**Changes:** `AtomicManifestRepository` adds `research: ResearchRepository`; both CLI commands load catalog and research through one boundary using checked-in `research/evaluation-context.json`.

- [ ] RED-test an otherwise-valid empty census, wrong ordered census IDs, missing/invalid census/context/queue roots, bad snapshot hash/count/receipt, broken evidence/review graph, stale/drifted selected provider, and malformed gap. For each fixture run both `validate` and `generate`, pre-seed all five artifacts, and assert all bytes remain unchanged.
- [ ] Call `loadResearchRepository()` and then `validateResearchGraph(researchInput, { completeV1, platforms: new Set<Platform>(["darwin", "linux", "win32"]), expectedCensusSnapshotIds: INITIAL_CENSUS_SNAPSHOT_IDS })` inside `loadManifestRepository()`. Do not expose partial views or filter failures. Keep `generateAll()` projecting only the validated foundation view; `src/cli.ts` continues routing both commands through that one checked-in evaluation context.

```ts
const [foundation, completeV1, foundationMigration, researchInput] = await Promise.all([
  loadFoundationManifestRepository(root), loadCompleteV1Repository(root),
  loadFoundationMigration(root), loadResearchRepository(root)
]);
const research = validateResearchGraph(researchInput, {
  completeV1,
  platforms: new Set<Platform>(["darwin", "linux", "win32"]),
  expectedCensusSnapshotIds: INITIAL_CENSUS_SNAPSHOT_IDS
});
```
- [ ] Assert production loads 15 census snapshots and zero providers/reviews/conflicts/gaps, and all five P02 artifact SHA-256 values remain exact.
- [ ] Run `npm test -- tests/integration/research-governance.test.ts tests/integration/generation.test.ts tests/unit/research-*.test.ts`, then `npm run check`.
- [ ] Commit `git commit -s -m "feat: activate research governance validation"`.

### Task 14: Close P03 With Independent Evidence

**Files:** modify `docs/superpowers/plans/2026-07-23-research-governance.md` and `docs/superpowers/plans/2026-07-23-complete-v1-master-roadmap.md`.

- [x] Run `npm run check`, `bash tests/e2e/clean-copy.sh`, and `git diff --check` from committed Task 13.
- [x] Generate both report strings twice from shuffled input and record byte-equality plus all 15 snapshot digests in the task report.
- [x] Request an independent P03 spec review. Fix every Critical and Important finding and repeat committed full/clean-copy verification.
- [x] Update the P03 roadmap row with the exact commit range, test count, 15-source census count/hash result, report reproducibility, clean-copy, and final review result.
- [x] Commit `git commit -s -m "docs: record p03 exit evidence"`.

## P03 Exit Evidence

P03 is complete only when:

- all 15 census snapshots resolve exact public commits and reproduce fixed-key hashes and per-kind counts;
- the census index owns every snapshot while provider/review/conflict/gap collections remain empty until P04;
- queue, candidate, review lineage, evidence, gap, provider, and conflict references fail closed;
- all 11 gates and 15 binary score criteria reproduce eligibility and the 40/20/15/15/10 totals;
- evidence is bound to the same review, provider, snapshot, revision, selected paths, and platforms;
- context-driven freshness reports simultaneous issues and preserves immutable reviewed revisions;
- source/trust reports reproduce byte-for-byte without popularity-based trust;
- both CLI paths reject invalid research before artifact writes;
- all five foundation artifacts and manager behavior remain unchanged;
- committed full checks and clean-copy pass;
- an independent reviewer reports zero Critical and zero Important findings.

P03 does not prove live capability coverage, candidate quality, provider selection, conflict priority, owned-gap necessity, real install/semantic smoke success, or onboarding resolution. P04 owns live reviews and P05+ own resolution.

## Task 14 Exit Evidence

P03 is complete. The final independent P03 spec re-review reported **0 Critical, 0 Important, and 0 Minor findings**.

- The private 34-commit development range and planning-gate commit IDs are not published. DCO-signed repairs bind review sources to immutable evidence, enforce exact discovery provenance, and restrict validation commands to lexically safe canonical relative plugin paths.
- From the committed development head, `npm run check` passed typecheck, `35/35` Vitest files, `658/658` tests, production validation, and generated-output equality. `git diff --check` passed.
- `bash tests/e2e/clean-copy.sh` cloned that committed head, ran a clean `npm ci`, and passed the same `35/35` files and `658/658` tests, generated-output equality, marketplace validation, and both shared-core and skillset-manager plugin validations.
- The atomic production loader reconciled exactly 15 census IDs, snapshots, source configs, and receipts. The census owns every loaded snapshot with no extra ID. Queue candidates, capability-search records, evidence, providers, source reviews, conflicts, and owned-gap decisions are all empty.
- Two separately seeded, shuffled production `ResearchRepository` inputs were loaded without fixtures. They shuffled the census IDs, snapshots, snapshot entries/metrics, source configs, receipts, context observations, queue collections, and all governance collections. `generateSourceAuditReport` output was byte-identical at `4,190` UTF-8 bytes with SHA-256 `c3ee84e06eb0ee8cc3ea5104c6a76138e09db11b7d5ba0a6944ef18e8fb723ce`; `generateTrustReport` output was byte-identical at `310` UTF-8 bytes with SHA-256 `c8d95d30bcd9b6c3b8b2bbf1a68f3493cfd3c0b851125abb480342658e1007ea`. The trust report has zero data rows because P03 intentionally has zero providers.
- Public release evidence is reproduced from the tracked census, receipts, snapshots, and validators; private implementation reports and their commit pointers are not published.
