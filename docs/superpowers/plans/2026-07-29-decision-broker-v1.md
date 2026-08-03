# Decision Broker v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development`. Each task is one reviewed, compiling
> unit. Follow test-first RED/GREEN/REFACTOR and do not weaken or skip existing
> assertions.

**Goal:** Turn the existing transparent discovery catalog into a goal-driven
decision broker that produces at most one primary and one justified complement,
tracks review and change evidence, refreshes the market through review-only weekly
PRs, and preserves explicit approval for every Claude Code or Codex action.

**Architecture:** Keep immutable legacy snapshots and the discovery-only broker.
Add separate v3 observation evidence, an append-only review ledger, a deterministic
materialized review state, and a generated decision index. Claude setup consumes the
plugin-owned index; Codex receives structured non-executing previews. Weekly research
publishes only fully validated pull requests.

**Tech Stack:** Node.js 22+, npm, TypeScript 7.0.2, Vitest 4.1.10, Ajv 8.20.0,
YAML 2.9.0, semver 7.8.5, Claude Code 2.1.198+, Git, GitHub CLI, and Bash.

## Global Constraints

- The approved design is
  `docs/superpowers/specs/2026-07-29-decision-broker-v1-design.md`; its private
  development baseline is not published.
- Keep the GitHub repository PRIVATE. Do not push, publish, enable remote branch
  protection, merge a remote PR, or alter real Claude Code/Codex user state without
  a separate exact approval.
- Do not vendor, copy, fork, or create purpose-specific third-party skills. This
  repository remains a broker.
- Preserve the 20 domain identities, existing immutable snapshots, receipts, P03
  protected files, and discovery `recommend` behavior unless this plan explicitly
  adds a separate decision surface.
- A plan contains at most one `primary` and one justified `complement`. Two domains
  still share the global two-item limit.
- `eligible-with-disclosures` is not `safe`, `trusted`, or individually reviewed.
  Unknown facts remain `unknown` in every user-facing surface.
- A non-official exact path cannot be eligible while runtime compatibility or any
  required sensitive evidence is unknown.
- Claude Code official listing is the only delegated exception and must show
  `individualSafetyReview: not-complete` and `revisionBinding: unavailable`.
- Codex never executes a command. It emits a `$skill-installer` handoff only for a
  currently reviewed exact path with verified Codex compatibility.
- Weekly automation runs Monday at `17 0 * * 1` UTC and by manual dispatch. It may
  create a review PR but never install, merge, force-push, or modify a real user
  environment.
- Every implementation task begins with a failing focused test, runs `npm run
  typecheck` and the focused suite before commit, and leaves the worktree compiling.
- Final integration must pass `npm run check`, `npm run verify:broker-only`,
  `git diff --check`, Claude plugin validation, and `bash tests/e2e/clean-copy.sh`.

## Target File Structure

```text
src/model/decision.ts                         decision-facing types
src/model/review-ledger.ts                    observation and review types
src/contracts/decision.ts                     decision schema validation
src/contracts/review-ledger.ts                observation/ledger validation
src/decision/normalize.ts                      bounded phrase normalization
src/decision/intent-router.ts                  goal/domain routing
src/decision/eligibility.ts                    fail-closed status precedence
src/decision/candidate-projection.ts           official/review adapters
src/decision/planner.ts                        primary/complement coverage
src/decision/repository.ts                     manifests and index loading
src/decision/codex-preview.ts                  non-executing Codex handoff
src/generate/decision-index.ts                 deterministic generated index
src/research/canonical-json.ts                 canonical event serialization
src/research/observation-collector.ts          bounded blob evidence collection
src/research/source-observation.ts             latest/previous projection
src/research/source-diff.ts                    field-level change classification
src/research/review-ledger.ts                  chain and authorization checks
src/research/review-state.ts                   materialized current state
src/research/refresh.ts                        atomic staging orchestration
src/lifecycle/maintain.ts                      update/remove preview planning
schemas/v3/*.schema.json                       new closed contracts
manifests/decision-intents.yaml                20-domain intent profiles
manifests/decision-candidate-evidence.yaml     capability coverage evidence
research/observation-evidence/                 new v3 collected evidence
research/source-observations.json              generated projection
research/source-diffs.json                     generated change projection
research/review-ledger.jsonl                   append-only decisions
research/materialized-review-state.json        generated current decisions
governance/reviewers.json                      base-SHA reviewer allowlist
generated/decision-index.json                  broker decision index
plugins/skillset-manager/data/decision-index.json
plugins/skillset-manager/skills/maintain/SKILL.md
.github/workflows/catalog-refresh.yml
```

## Frozen Interfaces

```ts
export type DecisionState =
  | "eligible-with-disclosures"
  | "held"
  | "blocked";

export interface SensitiveFieldEvidence<T = string | string[]> {
  status: "observed" | "unknown" | "not-applicable";
  value?: T;
  evidence: Array<{ path: string; contentSha256: string }>;
}

export interface IntentProfile {
  id: string;
  domainId: DomainId;
  phrases: { ko: string[]; en: string[] };
  coreCapabilityId: string;
  requiredCapabilityIds: string[];
}

export interface DecisionCandidateProjection {
  id: string;
  sourceId: string;
  skillPath: string | null;
  runtime: "claude-code" | "codex";
  state: DecisionState;
  stateReasons: string[];
  providedCapabilityIds: string[];
  capabilityEvidenceIds: string[];
  revisionBinding: "exact" | "unavailable";
  permissions: SensitiveFieldEvidence<string[]>;
  license: SensitiveFieldEvidence<string>;
  trust: SensitiveFieldEvidence<string>;
  dependencies: SensitiveFieldEvidence<string[]>;
}

export interface DecisionPlan {
  status: DecisionState;
  goal: string | null;
  domainIds: DomainId[];
  primary: PlannedCandidate | null;
  complement: PlannedCandidate | null;
  coverageIncomplete: boolean;
  uncoveredCapabilityIds: string[];
  requiresDomainPrioritySelection: boolean;
  executionStatus: "not-executed";
  provenanceDigest: string;
}

export interface BuildDecisionPlanInput {
  goal?: string;
  domainIds?: DomainId[];
  runtime: "claude-code" | "codex";
  platform: "darwin" | "linux" | "win32";
  asOf: string;
}

export interface BlobEvidence {
  path: string;
  gitBlobSha: string;
  byteSize: number;
  readStatus: "observed" | "unknown";
  contentSha256?: string;
}

export interface ReviewLedgerEvent {
  sequence: number;
  id: string;
  previousEventHash: string | null;
  target: { sourceId: string; skillPath: string | null };
  disposition: "approved" | "held" | "blocked";
  supersedes: string | null;
  baseline: {
    snapshotId: string;
    inspectedCommit: string;
    contentSha256: string;
    pathBlobSha: string | null;
    inheritedEvidenceDigest: string;
  };
  reasonCode: string;
  reason: { ko: string; en: string };
  reviewedSensitiveFields: {
    license: SensitiveFieldEvidence<string>;
    permissions: SensitiveFieldEvidence<string[]>;
    ownership: SensitiveFieldEvidence<string>;
    trust: SensitiveFieldEvidence<string>;
    dependencies: SensitiveFieldEvidence<string[]>;
    executableSurface: SensitiveFieldEvidence<string[]>;
  };
  runtimeEvidence: Array<{
    runtime: "claude-code" | "codex";
    compatibility: "verified" | "incompatible" | "unknown";
    evidenceIds: string[];
  }>;
  reviewerId: string;
  reviewedAt: string;
  expiresAt: string;
  eventHash: string;
}

export interface ManagedInstallReceipt {
  managedBy: "claude-code-skillsets";
  decisionPlanDigest: string;
  pluginName: string;
  marketplaceId: string;
  marketplaceSource: string;
  scope: "user" | "project" | "local";
  preInstallVersion: string | null;
  postInstallVersion: string | null;
  versionStatus: "observed-semver" | "unknown";
  observedAt: string;
  installCommandDigest: string;
}
```

---

### Task 1: Add Closed Decision Contracts and Curated Intent Evidence

**Files:**
- Create: `src/model/decision.ts`
- Create: `src/contracts/decision.ts`
- Create: `src/decision/repository.ts`
- Create: `schemas/v3/decision-index.schema.json`
- Create: `schemas/v3/decision-intents.schema.json`
- Create: `schemas/v3/decision-candidate-evidence.schema.json`
- Create: `manifests/decision-intents.yaml`
- Create: `manifests/decision-candidate-evidence.yaml`
- Test: `tests/unit/decision-contracts.test.ts`

**Interfaces:**
- Produces the frozen `IntentProfile`, `DecisionCandidateProjection`,
  `DecisionPlan`, `DecisionIndex`, and `ManagedInstallReceipt` types.
- Produces `loadDecisionManifests(root): Promise<DecisionManifestRepository>`.
- Consumes existing `DomainId` and the 147 capability IDs from the complete-v1
  repository; it must not define a second taxonomy.

- [ ] **Step 1: Write the failing closed-schema tests**

```ts
it("rejects capability coverage without current evidence", async () => {
  const value = validCandidateEvidence();
  value.candidates[0]!.capabilityEvidenceIds = [];
  expect(() => validateDecisionCandidateEvidence(value)).toThrow(/evidence/i);
});

it("requires every domain and bounded required capabilities", async () => {
  const repository = await loadDecisionManifests(fixtureRoot);
  expect(repository.profiles.map(({ domainId }) => domainId)).toEqual(
    COMPLETE_V1_DOMAIN_IDS
  );
  expect(repository.profiles.every((p) =>
    p.requiredCapabilityIds.length >= 1 && p.requiredCapabilityIds.length <= 3
  )).toBe(true);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/decision-contracts.test.ts`
Expected: FAIL because the v3 schemas, validators, and repository do not exist.

- [ ] **Step 3: Implement the closed types, schemas, and loaders**

Validators must reject unknown properties, duplicate normalized phrases, missing
capabilities, evidence IDs that do not resolve, and candidate capability claims
whose evidence does not point at the current official baseline or observation.

```ts
export interface DecisionManifestRepository {
  profiles: IntentProfile[];
  candidateEvidence: CapabilityEvidence[];
  digest: string;
}
```

Populate all 20 profiles in Korean and English. Include regression phrases for
`쇼핑몰 상품 홍보 매출` and `영상 편집 유튜브 쇼츠`; do not hard-code whole test
sentences as one phrase.

- [ ] **Step 4: Run GREEN and repository checks**

Run: `npx vitest run tests/unit/decision-contracts.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/model/decision.ts src/contracts/decision.ts src/decision/repository.ts \
  schemas/v3/decision-index.schema.json schemas/v3/decision-intents.schema.json \
  schemas/v3/decision-candidate-evidence.schema.json manifests/decision-intents.yaml \
  manifests/decision-candidate-evidence.yaml tests/unit/decision-contracts.test.ts
git commit -s -m "feat: add decision broker contracts"
```

---

### Task 2: Collect Bounded Blob Evidence Without Mutating Legacy Snapshots

**Files:**
- Create: `src/model/observation.ts`
- Create: `src/contracts/observation.ts`
- Create: `schemas/v3/observation-evidence.schema.json`
- Create: `schemas/v3/source-observation.schema.json`
- Create: `schemas/v3/source-diff.schema.json`
- Create: `src/research/observation-collector.ts`
- Modify: `scripts/research/collect-github-tree.ts`
- Test: `tests/unit/observation-collector.test.ts`
- Modify: `tests/integration/research-collector.test.ts`

**Interfaces:**
- Produces `collectObservationEvidence(input): Promise<ObservationEvidence>`.
- File limit is exactly 256 KiB and source limit exactly 4 MiB.
- Existing files under `research/snapshots` and `research/receipts` remain byte
  identical; v3 output goes under `research/observation-evidence`.

- [ ] **Step 1: Write failing bounded-read and atomicity tests**

```ts
it("marks an oversized manifest unknown without inventing sensitive facts", async () => {
  const result = await collectObservationEvidence(oversizedFixture());
  expect(result.blobs[0]).toMatchObject({ readStatus: "unknown" });
  expect(result.fields.permissions.status).toBe("unknown");
});

it("publishes no files when collection fails before the staging commit", async () => {
  await expect(runCollector(failingSecondBlobFixture())).rejects.toThrow();
  expect(await readdir(outputRoot)).toEqual([]);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/observation-collector.test.ts tests/integration/research-collector.test.ts`
Expected: FAIL because v3 evidence collection does not exist.

- [ ] **Step 3: Implement evidence collection**

Use Git tree blob SHAs and byte sizes. Read only manifests, licenses, lockfiles,
scripts, hooks, MCP configs, and `SKILL.md` within the limits. Record direct evidence
hashes; a path with unread content is `unknown`, never `unchanged`.

```ts
export const MAX_BLOB_BYTES = 256 * 1024;
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
```

Write to a caller-provided staging directory. Move nothing into tracked research
paths inside this task.

- [ ] **Step 4: Run GREEN and immutable checks**

Run: `npx vitest run tests/unit/observation-collector.test.ts tests/integration/research-collector.test.ts && npm run verify:p03-immutable && npm run typecheck`
Expected: PASS and no legacy snapshot diff.

- [ ] **Step 5: Commit**

```sh
git add src/model/observation.ts src/contracts/observation.ts \
  schemas/v3/observation-evidence.schema.json schemas/v3/source-observation.schema.json \
  schemas/v3/source-diff.schema.json \
  src/research/observation-collector.ts scripts/research/collect-github-tree.ts \
  tests/unit/observation-collector.test.ts tests/integration/research-collector.test.ts
git commit -s -m "feat: collect bounded observation evidence"
```

---

### Task 3: Enforce the Append-Only Review Ledger and Base-SHA Authority

**Files:**
- Create: `src/model/review-ledger.ts`
- Create: `src/contracts/review-ledger.ts`
- Create: `src/research/canonical-json.ts`
- Create: `src/research/review-ledger.ts`
- Create: `schemas/v3/review-ledger-event.schema.json`
- Create: `schemas/v3/reviewer-registry.schema.json`
- Create: `schemas/v3/branch-protection-receipt.schema.json`
- Create: `scripts/research/assert-review-ledger-append-only.ts`
- Create: `scripts/github/verify-branch-protection.ts`
- Create: `research/review-ledger.jsonl`
- Create: `governance/reviewers.json`
- Create: `.github/CODEOWNERS`
- Modify: `package.json`
- Test: `tests/unit/review-ledger.test.ts`
- Test: `tests/integration/review-ledger-append-only.test.ts`
- Test: `tests/unit/branch-protection.test.ts`

**Interfaces:**
- Produces `canonicalize(value): string`, `hashReviewEvent(event): string`, and
  `verifyReviewLedger({ head, base, baseReviewers, changedPaths }): LedgerState`.
- Base reviewer roles, not head roles, authorize new events.
- Source-level events allow only `held|blocked`; `approved` requires an exact path.
- Produces `verifyBranchProtection(receipt)` and a read-only CLI that obtains current
  GitHub rules through `gh api`; local unit tests use fixtures and never call GitHub.
- Adds `npm run verify:branch-protection -- --repo <owner/repo> --branch main
  --output <receipt.json>`.

- [ ] **Step 1: Write failing chain, authority, and fork tests**

```ts
it("rejects a reviewer self-promotion in the same change", () => {
  expect(() => verifyReviewLedger({
    base: emptyLedger,
    head: approvedEventBy("new-reviewer"),
    baseReviewers: registryWithout("new-reviewer"),
    changedPaths: ["governance/reviewers.json", "research/review-ledger.jsonl"]
  })).toThrow(/base reviewer|same change/i);
});

it("rejects two active leaves for one target", () => {
  expect(() => verifyReviewLedger(forkedLedger())).toThrow(/leaf|fork/i);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/review-ledger.test.ts tests/unit/branch-protection.test.ts tests/integration/review-ledger-append-only.test.ts`
Expected: FAIL because canonical chain and base-prefix verification are absent.

- [ ] **Step 3: Implement canonical JSONL and authorization**

Canonicalization recursively sorts object keys by code point, preserves array order,
uses no spaces, and terminates every event with one LF. Hash the event without
`eventHash`, including `previousEventHash`. Reject sequence gaps, broken hashes,
past-line edits, invalid supersession, multiple leaves, unauthorized dispositions,
and simultaneous reviewer/ledger changes.

Seed `governance/reviewers.json` with `seunghyeon1004` as `maintainer` and
`security-reviewer`. Seed no historical review events.

The branch-protection verifier requires direct pushes, force pushes, and branch
deletion disabled, plus required CI checks and required CODEOWNERS review. It writes
no tracked receipt by default. Private RC captures a sanitized temporary receipt
from GitHub; local release tests validate an explicit fixture. Missing or
unverifiable remote rules fail private RC but do not cause local tests to fabricate
compliance.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/unit/review-ledger.test.ts tests/unit/branch-protection.test.ts tests/integration/review-ledger-append-only.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/model/review-ledger.ts src/contracts/review-ledger.ts \
  src/research/canonical-json.ts src/research/review-ledger.ts \
  schemas/v3/review-ledger-event.schema.json schemas/v3/reviewer-registry.schema.json \
  schemas/v3/branch-protection-receipt.schema.json \
  scripts/research/assert-review-ledger-append-only.ts research/review-ledger.jsonl \
  scripts/github/verify-branch-protection.ts governance/reviewers.json \
  .github/CODEOWNERS package.json tests/unit/review-ledger.test.ts \
  tests/unit/branch-protection.test.ts \
  tests/integration/review-ledger-append-only.test.ts
git commit -s -m "feat: add append-only review ledger"
```

---

### Task 4: Materialize Observations, Diffs, and Current Review State

**Files:**
- Create: `src/research/source-observation.ts`
- Create: `src/research/source-diff.ts`
- Create: `src/research/review-state.ts`
- Create: `scripts/research/materialize-decision-research.ts`
- Create: `research/source-observations.json`
- Create: `research/source-diffs.json`
- Create: `research/materialized-review-state.json`
- Modify: `src/research/repository.ts`
- Modify: `package.json`
- Test: `tests/unit/source-diff.test.ts`
- Test: `tests/unit/review-state.test.ts`
- Test: `tests/integration/decision-research-generation.test.ts`

**Interfaces:**
- Consumes Task 2 evidence and Task 3 ledger.
- Produces `materializeReviewState({ observations, diffs, ledger, reviewers,
  asOf }): MaterializedReviewState[]` as a pure function.
- Produces `npm run research:materialize-decision -- [--check] --as-of <UTC>`.

- [ ] **Step 1: Write failing change and state-transition tests**

```ts
it("keeps an exact-path approval across unrelated commits", () => {
  const result = materializeReviewState(samePathEvidenceDifferentRepoCommit());
  expect(result[0]!.state).toBe("approved");
});

it("stales approval when the path blob or inherited evidence changes", () => {
  const result = materializeReviewState(changedManifestChain());
  expect(result[0]).toMatchObject({ state: "held", reason: "stale" });
});

it("lets source blocked override exact-path approved", () => {
  expect(materializeReviewState(blockedSourceApprovedPath())[0]!.state).toBe("blocked");
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/source-diff.test.ts tests/unit/review-state.test.ts tests/integration/decision-research-generation.test.ts`
Expected: FAIL because projections and state transitions do not exist.

- [ ] **Step 3: Implement deterministic projections**

First observation is `baseline`; both known and equal is `unchanged`; directly
observed difference is `changed`; either side unknown is `unknown`. Source decisions
stale on source commit change. Exact-path approvals survive unrelated commits only
when path blob, manifest chain, ownership, and inherited evidence digest are equal.
Blocked never expires automatically.

Initial migration reads legacy snapshots without changing them, emits unknown
sensitive fields where v3 evidence is absent, and therefore leaves all 14
non-official sources `held/not-reviewed`.

- [ ] **Step 4: Run GREEN and generated equality**

Run: `npm run research:materialize-decision -- --check --as-of 2026-07-29T00:00:00Z && npx vitest run tests/unit/source-diff.test.ts tests/unit/review-state.test.ts tests/integration/decision-research-generation.test.ts && npm run typecheck`
Expected: PASS and byte-identical regenerated files.

- [ ] **Step 5: Commit**

```sh
git add src/research/source-observation.ts src/research/source-diff.ts \
  src/research/review-state.ts scripts/research/materialize-decision-research.ts \
  src/research/repository.ts research/source-observations.json \
  research/source-diffs.json research/materialized-review-state.json package.json \
  tests/unit/source-diff.test.ts tests/unit/review-state.test.ts \
  tests/integration/decision-research-generation.test.ts
git commit -s -m "feat: materialize review decisions and diffs"
```

---

### Task 5: Project Eligibility and Build Minimal Capability-Covering Plans

**Files:**
- Create: `src/decision/normalize.ts`
- Create: `src/decision/intent-router.ts`
- Create: `src/decision/eligibility.ts`
- Create: `src/decision/candidate-projection.ts`
- Create: `src/decision/planner.ts`
- Test: `tests/unit/decision-eligibility.test.ts`
- Test: `tests/unit/decision-engine.test.ts`

**Interfaces:**
- Consumes Task 1 manifests and Task 4 materialized state.
- Produces `projectDecisionCandidates(...)` and
  `buildDecisionPlan(index, input): DecisionPlan`.
- Existing `src/discovery/broker.ts::recommend` remains unchanged.

- [ ] **Step 1: Write failing eligibility and minimum-set tests**

```ts
it.each([
  ["blocked", "blocked"],
  ["stale", "held"],
  ["codex-path-observed", "held"],
  ["community-sensitive-unknown", "held"],
  ["official-claude-listed", "eligible-with-disclosures"]
])("applies precedence for %s", (fixture, expected) => {
  expect(projectCandidate(candidateFixture(fixture)).state).toBe(expected);
});

it("adds a complement only when it closes required coverage", () => {
  const plan = buildDecisionPlan(indexWithRedundantSecondCandidate(), input());
  expect(plan.primary).not.toBeNull();
  expect(plan.complement).toBeNull();
});

it("holds a two-domain plan when two candidates do not cover both profiles", () => {
  const plan = buildDecisionPlan(incompletePairIndex(), twoDomainInput());
  expect(plan).toMatchObject({ status: "held", coverageIncomplete: true });
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/decision-eligibility.test.ts tests/unit/decision-engine.test.ts`
Expected: FAIL because the decision engine does not exist.

- [ ] **Step 3: Implement routing, precedence, and coverage**

Normalize with NFKC, lowercase, punctuation removal, and whitespace collapse. Longest
phrase wins; equal-length profile conflict asks for domain selection. More than two
domains sets `requiresDomainPrioritySelection` and returns no install plan.

Filter to eligible candidates before capability scoring. One domain chooses a core
provider and adds one complement only if it closes all remaining required coverage.
Two domains choose at most two candidates whose union covers both profiles. Any
uncovered capability holds the whole plan.

- [ ] **Step 4: Run GREEN and regression goals**

Run: `npx vitest run tests/unit/decision-eligibility.test.ts tests/unit/decision-engine.test.ts && npm run typecheck`
Expected: PASS, including the shopping promotion and video-editing regression goals.

- [ ] **Step 5: Commit**

```sh
git add src/decision/normalize.ts src/decision/intent-router.ts \
  src/decision/eligibility.ts src/decision/candidate-projection.ts \
  src/decision/planner.ts tests/unit/decision-eligibility.test.ts \
  tests/unit/decision-engine.test.ts
git commit -s -m "feat: build minimal decision plans"
```

---

### Task 6: Generate the Plugin-Owned Index and Add Broker/Codex Surfaces

**Files:**
- Create: `src/generate/decision-index.ts`
- Create: `src/decision/index-loader.ts`
- Create: `src/decision/codex-preview.ts`
- Modify: `src/generate/all.ts`
- Modify: `src/cli.ts`
- Modify: `src/discovery/cli.ts`
- Create: `generated/decision-index.json`
- Create: `plugins/skillset-manager/data/decision-index.json`
- Test: `tests/integration/decision-generation.test.ts`
- Test: `tests/unit/decision-cli.test.ts`
- Test: `tests/unit/codex-preview.test.ts`

**Interfaces:**
- Produces byte-identical root and plugin-owned decision indexes.
- Adds `npm run broker -- decision-plan --runtime <runtime> --platform <platform>
  --as-of <UTC> (--goal <text> | --domain <id> [--domain <id>])`.
- Produces `prepareCodexHandoff(plan): CodexPreview` with
  `executionStatus: "not-executed"`.

- [ ] **Step 1: Write failing generation and CLI tests**

```ts
it("generates byte-identical root and plugin indexes", async () => {
  await generateAll(root);
  expect(await readFile(rootIndex)).toEqual(await readFile(pluginIndex));
});

it("never emits Claude commands in a Codex preview", () => {
  const output = JSON.stringify(prepareCodexHandoff(eligibleCodexPlan()));
  expect(output).not.toMatch(/claude plugin/i);
  expect(output).toContain('"executionStatus":"not-executed"');
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/integration/decision-generation.test.ts tests/unit/decision-cli.test.ts tests/unit/codex-preview.test.ts`
Expected: FAIL because index generation and decision CLI are absent.

- [ ] **Step 3: Implement deterministic generation and previews**

Set `catalogVersion` from the projection digest, `observedThrough` from the fixed
materialization input, and `catalogExpiresAt` to exactly nine days later. Generate
all single-profile and ordered two-profile fixtures. Reject index digest changes,
blocked/stale planned candidates, and an expiry window other than nine days.

Codex handoff includes repository, exact commit, exact skill path, review decision,
compatibility evidence, and a structured `$skill-installer` prompt. It never runs or
claims to have run the installer.

- [ ] **Step 4: Run GREEN and generated check**

Run: `npx vitest run tests/integration/decision-generation.test.ts tests/unit/decision-cli.test.ts tests/unit/codex-preview.test.ts && npm run generate && npm run typecheck`
Expected: PASS and both index files identical.

- [ ] **Step 5: Commit**

```sh
git add src/generate/decision-index.ts src/decision/index-loader.ts \
  src/decision/codex-preview.ts src/generate/all.ts src/cli.ts \
  src/discovery/cli.ts generated/decision-index.json \
  plugins/skillset-manager/data/decision-index.json \
  tests/integration/decision-generation.test.ts tests/unit/decision-cli.test.ts \
  tests/unit/codex-preview.test.ts
git commit -s -m "feat: expose decision plans to Claude and Codex"
```

---

### Task 7: Replace Claude Setup With the Decision-Index Journey

**Files:**
- Modify: `plugins/skillset-manager/skills/setup/SKILL.md`
- Modify: `src/evaluate/setup.ts`
- Replace: `tests/evaluations/skillset-manager/setup/*.yaml`
- Replace: `tests/fixtures/setup-evaluations/*`
- Modify: `tests/unit/setup-evaluator.test.ts`
- Modify: `tests/integration/setup-skill.test.ts`
- Modify: `tests/integration/official-setup.test.ts`

**Interfaces:**
- Consumes only plugin-owned `data/decision-index.json` for recommendation data.
- Setup order is language, goal/domain, optional domain priority, disclosed UTC probe,
  precomputed plan, complete preview, risk acknowledgement, separate approval,
  sequential execution and receipt.
- Adds `date -u +%Y-%m-%dT%H:%M:%SZ` to the exact consented probe list.
- Records the Task 1 `ManagedInstallReceipt` with pre/post CLI versions and exact
  marketplace identity after every successful managed install.
- Exports
  `evaluateSetupDecisionFixture(index, fixture): Promise<NormalizedSetupPlan>` so
  parity tests execute the real evaluator rather than an undefined test adapter.

- [ ] **Step 1: Replace legacy scenarios with failing decision scenarios**

```yaml
id: setup-shopping-promotion-ko
goal: "내 온라인 쇼핑몰 상품을 홍보하고 매출을 늘리고 싶어"
expect:
  maxInstallCandidates: 2
  requiresUnknownDisclosure: true
  requiresSeparateApproval: true
  noExecutionBeforeApproval: true
```

Add video editing, ambiguous goal, two domains, three-domain reprioritization,
expired catalog, refused time probe, blocked candidate, changed digest, and install
failure scenarios. Delete purpose/tool/Essential/Recommended/Custom Max expectations;
do not skip them.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/setup-evaluator.test.ts tests/integration/setup-skill.test.ts tests/integration/official-setup.test.ts`
Expected: FAIL because setup still reads the old static flow.

- [ ] **Step 3: Rewrite setup and evaluator**

The setup skill performs bounded phrase matching only and reads precomputed plans.
Expired or unknown time holds all installs. Official plans must display unknown
fields, incomplete individual safety review, and unavailable revision binding.
Approval binds the decision index digest, expiry, commands, candidates, order, and
state paths. Preserve atomic lock receipts and per-command verification.

- [ ] **Step 4: Run GREEN and semantic evaluator**

Run: `npx vitest run tests/unit/setup-evaluator.test.ts tests/integration/setup-skill.test.ts tests/integration/official-setup.test.ts && npm run eval:setup -- --output-dir .tmp-eval/setup && npm run typecheck`
Expected: PASS with sanitized, secret-free receipts.

- [ ] **Step 5: Commit**

```sh
git add plugins/skillset-manager/skills/setup/SKILL.md src/evaluate/setup.ts \
  tests/evaluations/skillset-manager/setup tests/fixtures/setup-evaluations \
  tests/unit/setup-evaluator.test.ts tests/integration/setup-skill.test.ts \
  tests/integration/official-setup.test.ts
git commit -s -m "feat: route setup through decision plans"
```

---

### Task 8: Add Approval-Bound Update and Removal Maintenance

**Files:**
- Create: `src/lifecycle/maintain.ts`
- Create: `plugins/skillset-manager/skills/maintain/SKILL.md`
- Create: `src/evaluate/maintain.ts`
- Create: `tests/unit/maintain-planner.test.ts`
- Create: `tests/unit/maintain-evaluator.test.ts`
- Create: `tests/integration/maintain-skill.test.ts`
- Create: `tests/evaluations/skillset-manager/maintain/*.yaml`
- Create: `tests/fixtures/maintain-evaluations/*`
- Modify: `src/trust/update-policy.ts`
- Modify: `package.json`

**Interfaces:**

Consumes Task 1 `ManagedInstallReceipt` exactly; maintain does not redefine or infer
the setup receipt shape.

```ts
export type MaintenanceAction =
  | "compatible-update-preview"
  | "review-required-hold"
  | "blocked-notice"
  | "removal-preview";
```

- [ ] **Step 1: Write failing ownership and approval tests**

```ts
it("holds removal for an installation without a managed receipt", () => {
  expect(planMaintenance(unownedInstallation())).toMatchObject({
    action: "review-required-hold"
  });
});

it("never auto-applies an update", () => {
  expect(decideUpdate(compatibleTrustedUpdate()).action).not.toBe("auto-apply");
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/update-policy.test.ts tests/unit/maintain-planner.test.ts tests/unit/maintain-evaluator.test.ts tests/integration/maintain-skill.test.ts`
Expected: FAIL because maintain is absent and update policy still auto-applies.

- [ ] **Step 3: Implement fail-closed maintenance**

Only receipts created by this project and matching current installed identity are
managed. Unknown version/source, missing receipt, identity drift, stale review, or
unverified CLI syntax holds the operation. Every supported update or removal shows
exact commands and state changes and requires a new separate approval. A failed
update preserves the prior installed identity.

- [ ] **Step 4: Run GREEN and maintain evaluation**

Run: `npx vitest run tests/unit/update-policy.test.ts tests/unit/maintain-planner.test.ts tests/unit/maintain-evaluator.test.ts tests/integration/maintain-skill.test.ts && npm run eval:maintain -- --output-dir .tmp-eval/maintain && npm run typecheck`
Expected: PASS; no `auto-apply` action remains.

- [ ] **Step 5: Commit**

```sh
git add src/lifecycle/maintain.ts plugins/skillset-manager/skills/maintain \
  src/evaluate/maintain.ts tests/unit/update-policy.test.ts \
  tests/unit/maintain-planner.test.ts tests/unit/maintain-evaluator.test.ts \
  tests/integration/maintain-skill.test.ts \
  tests/evaluations/skillset-manager/maintain tests/fixtures/maintain-evaluations \
  src/trust/update-policy.ts package.json
git commit -s -m "feat: add approval-bound skill maintenance"
```

---

### Task 9: Add Atomic Weekly and Manual Review-PR Refresh

**Files:**
- Create: `src/research/refresh.ts`
- Create: `scripts/research/refresh-catalog.ts`
- Create: `.github/workflows/catalog-refresh.yml`
- Create: `tests/unit/catalog-refresh.test.ts`
- Create: `tests/integration/catalog-refresh-workflow.test.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export interface RefreshRequest {
  observedAt: string;
  baseSha: string;
  baseCatalogDigest: string;
  stagingRoot: string;
}

export interface RefreshResult {
  changed: boolean;
  baseDigest: string;
  resultDigest: string;
  changedPaths: string[];
}
```

- [ ] **Step 1: Write failing atomicity and workflow-policy tests**

```ts
it("publishes nothing when one source fails", async () => {
  await expect(refreshCatalog(oneSourceFails())).rejects.toThrow();
  expect(await trackedResearchDigest()).toBe(beforeDigest);
});

it("keeps the workflow PR-only", async () => {
  const workflow = await readFile(".github/workflows/catalog-refresh.yml", "utf8");
  expect(workflow).toContain("17 0 * * 1");
  expect(workflow).not.toMatch(/merge|force|claude plugin|skill-installer/i);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/catalog-refresh.test.ts tests/integration/catalog-refresh-workflow.test.ts`
Expected: FAIL because refresh orchestration and workflow do not exist.

- [ ] **Step 3: Implement staged refresh and the pinned workflow**

Collect every source into a unique temporary staging root. Any source failure deletes
staging and publishes nothing. Recheck remote main SHA and catalog digest before
copying validated artifacts. Run all generation and release gates before branch push.

Workflow requirements: `contents: write`, `pull-requests: write`, all other
permissions absent/none, full-SHA actions, `concurrency.group: catalog-refresh`,
`cancel-in-progress: false`, branch
`automation/catalog-refresh-<baseDigest8>-<githubRunId>`, no force push, no auto merge,
and no plugin or user-state command. An identical open PR is a no-op receipt.

- [ ] **Step 4: Run GREEN and static workflow validation**

Run: `npx vitest run tests/unit/catalog-refresh.test.ts tests/integration/catalog-refresh-workflow.test.ts && npm run typecheck`
Expected: PASS without contacting or changing the remote repository.

- [ ] **Step 5: Commit**

```sh
git add src/research/refresh.ts scripts/research/refresh-catalog.ts \
  .github/workflows/catalog-refresh.yml tests/unit/catalog-refresh.test.ts \
  tests/integration/catalog-refresh-workflow.test.ts package.json
git commit -s -m "feat: add weekly catalog refresh reviews"
```

---

### Task 10: Align KO/EN First-Run Documentation and Semantic RC

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `.github/workflows/private-rc.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `src/evaluate/sanitize.ts`
- Modify: `tests/integration/codex-quickstart-docs.test.ts`
- Modify: `tests/integration/release-gates.test.ts`
- Create: `tests/integration/decision-surface-parity.test.ts`
- Create: `tests/integration/decision-readme.test.ts`

**Interfaces:**
- Claude install commands and `/skillset-manager:setup` appear before the Codex
  developer workflow in both languages.
- README installation unit is `primary + optional complement`, not Outcome Pack.
- RC evaluates setup, maintain, doctor, and shared-core and uploads sanitized output
  only.
- RC runs `verify:branch-protection` first, writes only the sanitized receipt to
  `.rc-artifacts/raw/governance/branch-protection.json`, and includes that step's
  outcome in the final enforced success condition.

- [ ] **Step 1: Write failing documentation, parity, and RC tests**

```ts
it("places the Claude setup CTA before Codex commands in both READMEs", async () => {
  for (const path of ["README.md", "README.en.md"]) {
    const body = await readFile(path, "utf8");
    expect(body.indexOf("skillset-manager@claude-code-skillsets"))
      .toBeLessThan(body.indexOf("runtime codex"));
  }
});

it("matches every generated intent fixture across broker and setup", async () => {
  for (const fixture of decisionIndex.intentFixtures) {
    expect(normalizePlan(await brokerPlan(fixture))).toEqual(
      normalizePlan(await evaluateSetupDecisionFixture(decisionIndex, fixture))
    );
  }
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/integration/decision-readme.test.ts tests/integration/decision-surface-parity.test.ts tests/integration/release-gates.test.ts tests/integration/codex-quickstart-docs.test.ts`
Expected: FAIL because docs and RC still describe the prior flow.

- [ ] **Step 3: Update docs and RC**

Explain official, held, blocked, and stale states identically in Korean and English.
Make Claude the first CTA and keep Codex as a separate decision/discovery section.
Add `eval:maintain` to private RC, sanitize its receipts, and fetch enough Git history
for base-prefix ledger verification. Do not add secrets to artifacts.

Add this required RC step before semantic evaluation:

```yaml
- id: branch_protection
  run: >-
    npm run verify:branch-protection --
    --repo "$GITHUB_REPOSITORY"
    --branch main
    --output .rc-artifacts/raw/governance/branch-protection.json
```

The final gate exports `BRANCH_PROTECTION_OUTCOME` and requires it to equal
`success`. Sanitization keeps rule names and compliance booleans but removes tokens,
actor details, and raw API headers.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run tests/integration/decision-readme.test.ts tests/integration/decision-surface-parity.test.ts tests/integration/release-gates.test.ts tests/integration/codex-quickstart-docs.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add README.md README.en.md .github/workflows/private-rc.yml \
  .github/workflows/ci.yml src/evaluate/sanitize.ts \
  tests/integration/decision-readme.test.ts \
  tests/integration/decision-surface-parity.test.ts \
  tests/integration/release-gates.test.ts \
  tests/integration/codex-quickstart-docs.test.ts
git commit -s -m "docs: align decision broker user journeys"
```

---

### Task 11: Integrate Migration, Repository Gates, and Clean-Copy Release

**Files:**
- Create: `scripts/research/migrate-decision-broker-v1.ts`
- Modify: `src/research/repository.ts`
- Modify: `src/contracts/complete-v1.ts`
- Modify: `src/generate/all.ts`
- Modify: `scripts/verify-broker-only.ts`
- Modify: `tests/e2e/clean-copy.sh`
- Modify: `package.json`
- Modify: `tests/integration/generation.test.ts`
- Modify: `tests/integration/manager-generation.test.ts`
- Modify: `tests/integration/verify-broker-only.test.ts`
- Modify: `tests/integration/release-gates.test.ts`
- Create: `tests/integration/decision-migration.test.ts`
- Create: `tests/fixtures/github/branch-protection.valid.json`

**Interfaces:**
- Migration is idempotent and never changes legacy snapshots or receipts.
- `check:generated` includes observations, diffs, review state, and both decision
  indexes.
- `verify:broker-only` permits only broker/setup/doctor/maintain machinery and still
  rejects purpose-specific owned skills or installation side effects.

- [ ] **Step 1: Write failing migration and release-gate tests**

```ts
it("does not seed reviews that never happened", async () => {
  const migrated = await migrateDecisionBrokerV1(legacyFixture);
  expect(migrated.ledgerEvents).toEqual([]);
  expect(migrated.reviewStates.every((x) => x.state === "held")).toBe(true);
});

it("detects any legacy research mutation", async () => {
  await expect(migrateDecisionBrokerV1(mutatedLegacySnapshot())).rejects.toThrow();
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/integration/decision-migration.test.ts tests/integration/generation.test.ts tests/integration/manager-generation.test.ts tests/integration/verify-broker-only.test.ts tests/integration/release-gates.test.ts`
Expected: FAIL because migration and release integration are incomplete.

- [ ] **Step 3: Implement migration and every gate**

Generate initial unknown evidence and held review state without editing the 15 legacy
snapshots or receipts. Add base-prefix ledger validation commands that require an
explicit base in PR/push contexts. Local `npm run check` validates the hash chain and
generated state with fixtures; private RC alone performs the read-only live
branch-protection query and fails when its receipt is missing or noncompliant.

Update clean-copy to install dependencies, validate every new schema and generated
artifact, run append-only and broker-only checks, validate all three plugins, and
prove a clean checkout reproduces the decision index.

- [ ] **Step 4: Run the full local gate**

Run:

```sh
npm run check
npm run verify:p03-immutable
private_base="${PRIVATE_DEVELOPMENT_BASE:?private development baseline not published}"
npm run verify:research-append-only -- --base "$private_base"
npm run verify:review-ledger-append-only -- --base "$private_base"
npm run verify:broker-only
git diff --check
bash tests/e2e/clean-copy.sh
```

Expected: every command exits 0; no real plugin install/update/remove occurs.

- [ ] **Step 5: Commit**

```sh
git add scripts/research/migrate-decision-broker-v1.ts src/research/repository.ts \
  src/contracts/complete-v1.ts src/generate/all.ts scripts/verify-broker-only.ts \
  tests/e2e/clean-copy.sh package.json tests/integration/decision-migration.test.ts \
  tests/integration/generation.test.ts tests/integration/manager-generation.test.ts \
  tests/integration/verify-broker-only.test.ts tests/integration/release-gates.test.ts \
  tests/fixtures/github/branch-protection.valid.json
git commit -s -m "test: gate decision broker v1 release"
```

---

### Task 12: Independent Reviews and Local Main Completion

**Files:**
- Review only: all Decision Broker v1 changes
- Create locally ignored reports under `.superpowers/sdd/`

**Interfaces:**
- Reviewer A owns decision correctness and Claude/Codex parity.
- Reviewer B owns observation, ledger, diff, and weekly workflow safety.
- Reviewer C owns setup/maintain UX, semantic RC, and release gates.

- [ ] **Step 1: Run three independent reviews in parallel**

Each reviewer reports findings first as blocker/major/minor with file and line. No
reviewer edits the implementation under review.

- [ ] **Step 2: Fix blocker and major findings using fresh RED/GREEN cycles**

Each accepted finding gets a reproducing failing test before its fix. Re-run the
focused suite and the full gate after each review batch.

- [ ] **Step 3: Run final verification from committed HEAD**

```sh
git status --short
npm run check
npm run verify:broker-only
bash tests/e2e/clean-copy.sh
claude plugin validate .
claude plugin validate plugins/shared-core
claude plugin validate plugins/skillset-manager
```

Expected: clean worktree, all commands exit 0, and independent reviews have zero
blocker and zero major findings.

- [ ] **Step 4: Confirm local/remote boundary**

```sh
git log -1 --oneline
git rev-list --left-right --count origin/main...main
gh repo view seunghyeon1004/claude-code-skillsets \
  --json visibility,isPrivate,defaultBranchRef,url
```

Expected: local `main` contains the completed commits, repository remains PRIVATE,
and no remote push occurred without a separate approval.

## Parallel Execution Map

```text
Wave 1: Task 1 | Task 2 | Task 3
Wave 2: Task 4
Wave 3: Task 5
Wave 4: Task 6 | Task 9
Wave 5: Task 7 | Task 8
Wave 6: Task 10
Wave 7: Task 11
Wave 8: Task 12
```

Tasks in the same wave use disjoint files. If an agent discovers a shared-file
collision, it must stop before editing that shared file and report the required
integration change to the primary agent. The primary agent alone integrates
`package.json`, `src/generate/all.ts`, `src/discovery/cli.ts`, CI workflows, and
release gates when parallel branches would overlap.

Every parallel task runs in an isolated git worktree created with
`superpowers:using-git-worktrees`. Each agent commits only its explicit file list.
The primary agent reviews and cherry-picks completed task commits into the integration
branch in dependency order. Agents never share a git index, never cherry-pick their
own work, and never stage a directory that can contain another task's files.
