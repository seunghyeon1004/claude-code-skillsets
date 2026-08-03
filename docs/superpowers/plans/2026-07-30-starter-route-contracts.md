# Starter Route Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize and authenticate 18 official-marketplace starter-partial routes with complete direct, inferred, and unsupported capability accounting.

**Architecture:** A new reviewed YAML manifest names the bounded candidates and evidence for each route. The decision repository validates it against materialized official listing claims and the Complete v1 taxonomy, includes it in the catalog digest, and projects it into root decision indexes while retaining optional v3 schema compatibility.

**Tech Stack:** TypeScript, Node.js 22, YAML, JSON Schema 2020-12, AJV, Vitest.

## Global Constraints

- Do not modify planner behavior, setup evaluation, plugin runtime or skills, README files, or generated artifacts.
- Do not execute or install any external candidate and do not change a remote repository.
- Preserve `schemaVersion: 3`; `starterRoutes` is optional for standalone v3 parsing but required for a current root-generated index.
- `shopify-ai-toolkit` remains held and is excluded from every starter route.
- Use test-first red-green-refactor cycles.

## Staging

This work is split at a review boundary. Phase 1 implements Task 1 plus the pure
semantic invariants from Task 2 using in-memory fixtures. The production route
manifest, 18 exact official claims, repository/generator wiring, and index field
remain integration dependencies and must not be included in the phase 1 commit.

---

### Task 1: Starter route schema and semantic contract

**Files:**
- Create: `schemas/v3/decision-starter-routes.schema.json`
- Modify: `src/model/decision.ts`
- Modify: `src/contracts/decision.ts`
- Test: `tests/unit/starter-route-contracts.test.ts`

**Interfaces:**
- Produces: `DecisionStarterRoutesManifest`, `DecisionStarterRoute`, and `validateDecisionStarterRoutes(value)`.
- Consumes: canonical domain, candidate, evidence, and capability identities.

- [ ] **Step 1: Write failing tests for the closed structural schema**

Test one valid route and mutations for an unknown field, more than two candidates,
duplicate candidate IDs, `broadCoverageComplete: true`, and an empty unsupported
set.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/unit/starter-route-contracts.test.ts`

Expected: failure because `validateDecisionStarterRoutes` and the route types do
not exist.

- [ ] **Step 3: Implement the minimal model, schema, and AJV validator**

The manifest shape is:

```ts
interface DecisionStarterRoutesManifest {
  schemaVersion: 1;
  routes: DecisionStarterRoute[];
}

interface DecisionStarterRoute {
  domainId: DomainId;
  kind: "starter-partial";
  orderedCandidateIds: string[];
  smallestHonestProfile: { ko: string; en: string };
  directEvidenceIds: string[];
  inferredEvidenceIds: string[];
  unsupportedCapabilityIds: string[];
  broadCoverageComplete: false;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/unit/starter-route-contracts.test.ts`

Expected: all structural contract tests pass.

### Task 2: Full-domain semantic validation and repository authentication

**Files:**
- Create: `manifests/decision-starter-routes.yaml`
- Modify: `manifests/official-listing-capability-claims.yaml`
- Modify: `src/contracts/decision.ts`
- Modify: `src/decision/repository.ts`
- Test: `tests/unit/starter-route-contracts.test.ts`

**Interfaces:**
- Produces: authenticated `DecisionManifestRepository.starterRoutes`.
- Consumes: materialized candidates/evidence and Complete v1 capability ownership.

- [ ] **Step 1: Write failing semantic tests**

Copy the project manifests to a temporary root and assert rejection for a held
Shopify route, wrong direct/inferred classification, evidence from another route
candidate, a missing capability gap, an overlapping capability gap, a candidate
that contributes no evidence, and a missing one of the exact 18 domains.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/unit/starter-route-contracts.test.ts`

Expected: semantic mutations are accepted or the route manifest is not loaded.

- [ ] **Step 3: Add exact official listing claims and the 18 reviewed routes**

Use only exact substrings from the pinned official marketplace descriptions.
Classify broad-domain mappings as `inferred` unless the description directly
states the Complete v1 outcome. Keep commerce limited to `windsor-ai`.

- [ ] **Step 4: Implement repository semantic validation**

Resolve every route through the materialized candidate/evidence graph, compare
capability coverage to Complete v1, enforce the exact 18-domain set and Shopify
exclusion, copy routes into the frozen repository, and include them in the
manifest digest.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm test -- tests/unit/starter-route-contracts.test.ts`

Expected: all route and mutation tests pass.

### Task 3: Optional v3 index field and strict root parity

**Files:**
- Modify: `schemas/v3/decision-index.schema.json`
- Modify: `src/model/decision.ts`
- Modify: `src/contracts/decision.ts`
- Modify: `src/decision/repository.ts`
- Modify: `src/generate/decision-index.ts`
- Test: `tests/unit/starter-route-contracts.test.ts`
- Test: `tests/integration/decision-generation.test.ts`

**Interfaces:**
- Produces: optional `DecisionIndex.starterRoutes` and root generation/parity enforcement.
- Consumes: authenticated repository starter routes.

- [ ] **Step 1: Write failing compatibility and parity tests**

Assert that standalone `validateDecisionIndex` accepts a valid legacy v3 object
without `starterRoutes`, generated JSON contains all 18 routes, and root loading
rejects an omitted or altered route projection even after recomputing the index
digest.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/unit/starter-route-contracts.test.ts tests/integration/decision-generation.test.ts`

Expected: generated route assertion fails and root omission is accepted.

- [ ] **Step 3: Wire index schema, generation, and root parity**

Add the optional schema property, project authenticated routes during generation,
and compare root index routes exactly to `DecisionManifestRepository.starterRoutes`.
Keep temporary internal projection indexes valid without requiring the field.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/unit/starter-route-contracts.test.ts tests/integration/decision-generation.test.ts`

Expected: all focused tests pass.

### Task 4: Contract verification

**Files:**
- Verify only; do not regenerate tracked artifacts.

**Interfaces:**
- Consumes: all contract-layer changes.
- Produces: a reviewable commit with explicit downstream integration requirements.

- [ ] **Step 1: Run type and contract checks**

Run: `npm run typecheck`

Run: `npm test -- tests/unit/starter-route-contracts.test.ts tests/unit/decision-contracts.test.ts tests/unit/official-listing-claims.test.ts tests/integration/decision-generation.test.ts`

Expected: all commands pass.

- [ ] **Step 2: Inspect scope**

Run: `git diff --check`

Run: `git status --short`

Expected: no planner, setup, plugin runtime/skill, README, or generated artifact is modified.

- [ ] **Step 3: Commit**

```sh
git add docs/superpowers/specs/2026-07-30-starter-route-contracts-design.md \
  docs/superpowers/plans/2026-07-30-starter-route-contracts.md \
  manifests/decision-starter-routes.yaml \
  manifests/official-listing-capability-claims.yaml \
  schemas/v3/decision-starter-routes.schema.json \
  schemas/v3/decision-index.schema.json \
  src/model/decision.ts src/contracts/decision.ts src/decision/repository.ts \
  src/generate/decision-index.ts tests/unit/starter-route-contracts.test.ts \
  tests/integration/decision-generation.test.ts
git commit -m "feat: authenticate partial starter routes"
```
