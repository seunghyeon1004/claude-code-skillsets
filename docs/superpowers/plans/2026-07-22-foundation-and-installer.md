# Foundation and Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the validated manifest pipeline, generated Claude Code marketplace, shared core plugin, and consent-based personalized installer that every domain pack will use.

**Architecture:** YAML manifests are the single source of truth. Development-only TypeScript tooling validates manifests, checks dependency and trust policies, and generates Claude Code marketplace and catalog artifacts deterministically. The installed manager is a declarative Claude Code plugin: its setup and doctor skills read generated data, disclose every probe and command, obtain consent, and use Claude Code's existing tool execution without requiring a separate Node runtime.

**Tech Stack:** Development: Node.js 22+, npm, TypeScript 7.0.2, Vitest 4.1.10, Ajv 8.20.0, YAML 2.9.0, semver 7.8.5. User runtime: Claude Code 2.1.121+ only.

## Global Constraints

- Original code and skills use Apache-2.0; external skills retain their original licenses and are never copied into this repository.
- Korean is the primary documentation language and English is maintained as an independently edited equivalent.
- `manifests/` is the source of truth; `.claude-plugin/marketplace.json` and `generated/` are generated artifacts.
- The installer collects no telemetry and performs environment detection only after explicit consent.
- Installed plugins must not require Node.js, Python, jq, or another user-installed runtime.
- Verified and Trusted compatible updates may auto-apply; Community updates require review; major, license, permission, and ownership changes always require review.
- User-facing plugin metadata stays small; detailed skill instructions load only when invoked.
- All changes follow TDD and each task ends in an independently reviewable commit.
- This plan covers the platform foundation only. Domain skill content is implemented through one separately approved plan per domain group after this foundation is stable.

---

## File Structure

```text
package.json                         npm scripts and pinned development dependencies
package-lock.json                    reproducible dependency graph
tsconfig.json                        strict TypeScript compiler settings
vitest.config.ts                     test discovery and coverage settings
src/model/manifest.ts                shared manifest and generated-index types
src/manifest/load.ts                 YAML loading and schema validation
src/manifest/repository.ts           repository-wide manifest discovery
src/graph/dependencies.ts            cycle, missing, and conflicting dependency checks
src/trust/update-policy.ts           trust-tier update decisions
src/generate/marketplace.ts          Claude marketplace generation
src/generate/catalog.ts              Korean, English, and installer index generation
src/generate/all.ts                  side-effect-free generation orchestration
src/cli.ts                           validate and generate command entry point
schemas/domain.schema.json           domain manifest contract
schemas/pack.schema.json             outcome-pack manifest contract
schemas/plugin.schema.json           local plugin identity and dependency contract
schemas/external-source.schema.json  external dependency and trust contract
manifests/domains/*.yaml             initial foundation domains used by tests
manifests/packs/*.yaml               initial foundation packs used by tests
manifests/plugins/*.yaml             local plugin records used by graph generation
manifests/external-sources/*.yaml    approved upstream records
plugins/shared-core/                 eight common workflow skills
plugins/skillset-manager/            runtime-free setup and doctor skills plus generated data
generated/install-index.json         compact installer data
generated/catalog.ko.md              generated Korean catalog
generated/catalog.en.md              generated English catalog
.claude-plugin/marketplace.json      generated Claude Code marketplace
tests/unit/                           focused TypeScript tests
tests/integration/                    generation and policy tests
tests/e2e/                            clean-copy Claude plugin validation
.github/workflows/ci.yml             reproducible CI gates
```

### Task 1: Establish the TypeScript Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/version.ts`
- Test: `tests/unit/version.test.ts`

**Interfaces:**
- Produces: `TOOLING_VERSION: string`
- Produces: npm commands `test`, `typecheck`, `validate`, `generate`, and `check`

- [ ] **Step 1: Write the failing tooling smoke test**

```ts
import { describe, expect, it } from "vitest";
import { TOOLING_VERSION } from "../../src/version.js";

describe("tooling version", () => {
  it("uses a semantic version", () => {
    expect(TOOLING_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Create the pinned npm project and confirm the test fails**

Create `package.json` with this exact script surface:

```json
{
  "name": "claude-code-skillsets",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "validate": "tsx src/cli.ts validate",
    "generate": "tsx src/cli.ts generate",
    "check:generated": "npm run generate && git diff --exit-code -- .claude-plugin generated",
    "check": "npm run typecheck && npm test && npm run validate && npm run check:generated"
  },
  "dependencies": {
    "ajv": "8.20.0",
    "semver": "7.8.5",
    "yaml": "2.9.0"
  },
  "devDependencies": {
    "@types/node": "26.1.1",
    "@types/semver": "7.7.1",
    "tsx": "4.23.1",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

Run: `npm install && npm test -- tests/unit/version.test.ts`

Expected: FAIL because `src/version.ts` does not exist.

- [ ] **Step 3: Add strict compiler and test configuration**

Use `NodeNext`, `ES2022`, `strict: true`, `noUncheckedIndexedAccess: true`, and
include `src/**/*.ts` plus `tests/**/*.ts`. Configure Vitest to include
`tests/**/*.test.ts`, use the Node environment, and clear mocks between tests.

- [ ] **Step 4: Add the minimal implementation and ignore generated runtime noise**

```ts
export const TOOLING_VERSION = "0.1.0";
```

Ignore `node_modules/`, `dist/`, `coverage/`, `.DS_Store`, and `*.log`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/version.test.ts`

Expected: one passing test and zero TypeScript errors.

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/version.ts tests/unit/version.test.ts
git commit -m "build: establish TypeScript test harness"
```

### Task 2: Define Typed Manifest Contracts

**Files:**
- Create: `src/model/manifest.ts`
- Create: `schemas/domain.schema.json`
- Create: `schemas/pack.schema.json`
- Create: `schemas/plugin.schema.json`
- Create: `schemas/external-source.schema.json`
- Create: `tests/unit/manifest-types.test.ts`

**Interfaces:**
- Produces: `DomainManifest`, `PackManifest`, `LocalPluginManifest`, `PluginDependency`, `ExternalSourceManifest`, `TrustTier`, `RiskLevel`, and `ReleaseStatus`

- [ ] **Step 1: Write compile-time and runtime shape tests**

```ts
import { describe, expect, it } from "vitest";
import type { PackManifest } from "../../src/model/manifest.js";

describe("PackManifest", () => {
  it("represents a complete outcome pack", () => {
    const pack: PackManifest = {
      id: "repository-to-implementation-plan",
      domain: "software-engineering",
      categories: ["repository-analysis", "planning"],
      outcome: { ko: "검증 가능한 구현 계획", en: "A verifiable implementation plan" },
      targetUsers: ["software-developer"],
      whenToUse: ["기존 저장소의 변경 계획이 필요할 때"],
      whenNotToUse: ["구현이 이미 완료되어 검증만 필요할 때"],
      inputs: ["repository", "requested-change"],
      outputs: ["implementation-plan"],
      workflow: ["workspace-context", "intent-to-brief", "plan-and-checkpoints"],
      requiredPlugins: ["shared-core"],
      recommendedPlugins: [],
      optionalPlugins: [],
      tools: ["git"],
      languages: ["ko", "en"],
      regions: ["global"],
      riskLevel: "standard",
      trustRequirements: "trusted",
      licenses: ["Apache-2.0"],
      evaluationCases: ["tests/evaluations/repository-plan.yaml"],
      maintainers: ["seunghyeon1004"],
      version: "0.1.0",
      status: "draft"
    };
    expect(pack.id).toBe("repository-to-implementation-plan");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/manifest-types.test.ts`

Expected: FAIL because `src/model/manifest.ts` does not exist.

- [ ] **Step 3: Implement the exact shared types**

Define localized text as `{ ko: string; en: string }`. Define trust tiers as
`verified | trusted | community | blocked`, risk levels as
`standard | review-required | expert-required`, and release states as
`draft | beta | stable | deprecated | blocked`. A `PluginDependency` contains
`name`, optional `marketplace`, optional `version`, and `reason` as localized text.

- [ ] **Step 4: Add JSON Schemas matching the TypeScript names**

Each schema uses JSON Schema draft 2020-12, `additionalProperties: false`, kebab-case
IDs, non-empty arrays for `categories`, `inputs`, `outputs`, `languages`,
`licenses`, `evaluationCases`, and `maintainers`, plus semver validation for
`version`. Local plugin records require `id`, `source`, `version`, `status`, and
required, recommended, and optional dependency arrays. External sources require `homepage`, `repository`, `license`,
`trustTier`, `updatePolicy`, and `reviewedAt` in `YYYY-MM-DD` format.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/manifest-types.test.ts`

Expected: one passing test and zero TypeScript errors.

```bash
git add src/model schemas tests/unit/manifest-types.test.ts
git commit -m "feat: define manifest contracts"
```

### Task 3: Load and Validate YAML Manifests

**Files:**
- Create: `src/manifest/load.ts`
- Create: `src/manifest/repository.ts`
- Create: `tests/fixtures/manifests/valid/pack.yaml`
- Create: `tests/fixtures/manifests/invalid/pack.yaml`
- Test: `tests/unit/manifest-loader.test.ts`

**Interfaces:**
- Produces: `loadYaml<T>(path: string): Promise<T>`
- Produces: `validatePack(value: unknown): PackManifest`
- Produces: `loadManifestRepository(root: string): Promise<ManifestRepository>`

- [ ] **Step 1: Write tests for valid input and actionable errors**

```ts
import { describe, expect, it } from "vitest";
import { loadYaml, validatePack } from "../../src/manifest/load.js";

describe("manifest loader", () => {
  it("loads a valid pack", async () => {
    const value = await loadYaml("tests/fixtures/manifests/valid/pack.yaml");
    expect(validatePack(value).id).toBe("repository-to-implementation-plan");
  });

  it("reports the field path for invalid data", async () => {
    const value = await loadYaml("tests/fixtures/manifests/invalid/pack.yaml");
    expect(() => validatePack(value)).toThrow(/version.*semver/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/manifest-loader.test.ts`

Expected: FAIL because the loader module does not exist.

- [ ] **Step 3: Implement YAML parsing and Ajv validation**

Use `readFile` from `node:fs/promises`, `parse` from `yaml`, and one compiled Ajv
validator per schema. Sort Ajv errors by `instancePath` and throw one error whose
message contains every invalid path and message.

- [ ] **Step 4: Implement repository discovery**

Read only `.yaml` files directly beneath `manifests/domains`, `manifests/packs`,
`manifests/plugins`, and `manifests/external-sources`; sort paths before loading;
reject duplicate IDs across each manifest kind; return
`{ domains, packs, plugins, externalSources }` sorted by ID.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/manifest-loader.test.ts`

Expected: two passing tests and zero TypeScript errors.

```bash
git add src/manifest tests/fixtures/manifests tests/unit/manifest-loader.test.ts
git commit -m "feat: load and validate manifests"
```

### Task 4: Validate the Dependency Graph

**Files:**
- Create: `src/graph/dependencies.ts`
- Test: `tests/unit/dependency-graph.test.ts`

**Interfaces:**
- Consumes: `DependencyNode` values with `{ id: string; required: string[] }`
- Produces: `validateDependencyGraph(nodes: DependencyNode[]): void`
- Produces: `resolvePackClosure(packId: string, nodes: DependencyNode[]): string[]`

- [ ] **Step 1: Write graph failure and deterministic-order tests**

```ts
import { describe, expect, it } from "vitest";
import { resolvePackClosure, validateDependencyGraph } from "../../src/graph/dependencies.js";

describe("dependency graph", () => {
  it("rejects a cycle with its complete path", () => {
    const nodes = [
      { id: "a", required: ["b"] },
      { id: "b", required: ["a"] }
    ];
    expect(() => validateDependencyGraph(nodes)).toThrow("a -> b -> a");
  });

  it("returns dependencies before dependents", () => {
    const nodes = [
      { id: "publish", required: ["write"] },
      { id: "write", required: ["shared-core"] },
      { id: "shared-core", required: [] }
    ];
    expect(resolvePackClosure("publish", nodes)).toEqual(["shared-core", "write", "publish"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/dependency-graph.test.ts`

Expected: FAIL because the dependency graph module does not exist.

- [ ] **Step 3: Implement missing and cycle checks**

Create an adjacency map from `DependencyNode.required`. Reject duplicate node IDs and
unknown required IDs. Use depth-first traversal with `visiting` and `visited` sets
and include the full cycle in the error. `ManifestRepository` converts local required
dependencies to nodes before invoking this module; recommended and optional
dependencies remain suggestions and cannot make a pack unloadable.

- [ ] **Step 4: Implement deterministic closure resolution**

Resolve required dependencies only, put dependencies before their dependents, remove
duplicates, and sort peers lexicographically. Keep recommended and optional plugins
as separately labeled suggestions.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/dependency-graph.test.ts`

Expected: all graph tests pass with zero TypeScript errors.

```bash
git add src/graph tests/unit/dependency-graph.test.ts
git commit -m "feat: validate plugin dependency graph"
```

### Task 5: Encode Trust and Update Decisions

**Files:**
- Create: `src/trust/update-policy.ts`
- Test: `tests/unit/update-policy.test.ts`

**Interfaces:**
- Produces: `decideUpdate(input: UpdateCandidate): UpdateDecision`
- `UpdateDecision.action`: `auto-apply | review | block`
- `UpdateDecision.reasons`: non-empty `string[]`

- [ ] **Step 1: Write the policy table as tests**

```ts
import { describe, expect, it } from "vitest";
import { decideUpdate } from "../../src/trust/update-policy.js";

describe("update policy", () => {
  it.each([
    ["verified", "2.1.0", "2.2.0", "auto-apply"],
    ["trusted", "2.1.0", "2.1.4", "auto-apply"],
    ["community", "2.1.0", "2.1.4", "review"],
    ["verified", "2.1.0", "3.0.0", "review"],
    ["blocked", "2.1.0", "2.1.1", "block"]
  ] as const)("maps %s %s -> %s to %s", (trustTier, current, next, action) => {
    expect(decideUpdate({ trustTier, current, next, licenseChanged: false, permissionsChanged: false, ownershipChanged: false }).action).toBe(action);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/update-policy.test.ts`

Expected: FAIL because the update policy module does not exist.

- [ ] **Step 3: Implement compatible-version decisions**

Use `semver.major`. Verified and Trusted updates auto-apply only when the next major
equals the current major. Community always requires review. Blocked always blocks.

- [ ] **Step 4: Add sensitive-change overrides**

Any `licenseChanged`, `permissionsChanged`, or `ownershipChanged` value forces
`review`, except Blocked remains `block`. Invalid or decreasing versions return
`block` with an explicit reason.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/update-policy.test.ts`

Expected: all policy rows pass.

```bash
git add src/trust tests/unit/update-policy.test.ts
git commit -m "feat: enforce external update trust policy"
```

### Task 6: Generate Marketplace and Catalog Artifacts

**Files:**
- Create: `src/generate/marketplace.ts`
- Create: `src/generate/catalog.ts`
- Create: `src/generate/all.ts`
- Create: `src/cli.ts`
- Create: `manifests/domains/software-engineering.yaml`
- Create: `manifests/packs/repository-to-implementation-plan.yaml`
- Create: `manifests/plugins/shared-core.yaml`
- Create: `manifests/plugins/skillset-manager.yaml`
- Create: `.claude-plugin/marketplace.json`
- Create: `generated/catalog.ko.md`
- Create: `generated/catalog.en.md`
- Create: `generated/install-index.json`
- Test: `tests/integration/generation.test.ts`

**Interfaces:**
- Produces: `generateMarketplace(repository: ManifestRepository): Marketplace`
- Produces: `generateCatalogs(repository: ManifestRepository): GeneratedCatalogs`
- Produces CLI: `tsx src/cli.ts validate|generate`

- [ ] **Step 1: Write deterministic generation tests**

```ts
import { describe, expect, it } from "vitest";
import { generateAll } from "../../src/generate/all.js";

describe("artifact generation", () => {
  it("is byte-identical across two runs", async () => {
    const first = await generateAll(process.cwd(), false);
    const second = await generateAll(process.cwd(), false);
    expect(second).toEqual(first);
  });

  it("emits Korean and English names for every pack", async () => {
    const result = await generateAll(process.cwd(), false);
    expect(result.catalogKo).toContain("저장소에서 구현 계획까지");
    expect(result.catalogEn).toContain("Repository to implementation plan");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/generation.test.ts`

Expected: FAIL because generation functions do not exist.

- [ ] **Step 3: Implement deterministic generators**

Sort domains, packs, dependencies, and tags by ID. Serialize JSON with two-space
indentation and a trailing newline. Generate Markdown tables from localized manifest
fields. Do not include timestamps because they make clean regeneration impossible.

- [ ] **Step 4: Add CLI write and validate modes**

`generateAll` stays side-effect-free in `src/generate/all.ts`. The CLI imports it;
`validate` loads the repository and runs schema plus graph checks without writing.
`generate` validates first, then atomically writes the four generated artifacts.
Unknown commands exit 2; validation failures exit 1; successful commands exit 0.

- [ ] **Step 5: Verify Claude compatibility and commit**

Run:

```bash
npm run generate
npm run check:generated
```

Expected: clean git diff after regeneration. Root Claude validation is deferred to
Task 11, after every generated relative plugin source exists.

```bash
git add src/generate src/cli.ts manifests .claude-plugin generated tests/integration/generation.test.ts
git commit -m "feat: generate marketplace and catalogs"
```

### Task 7: Build the Shared Core Plugin

**Files:**
- Create: `plugins/shared-core/.claude-plugin/plugin.json`
- Create: `plugins/shared-core/skills/workspace-context/SKILL.md`
- Create: `plugins/shared-core/skills/intent-to-brief/SKILL.md`
- Create: `plugins/shared-core/skills/workflow-router/SKILL.md`
- Create: `plugins/shared-core/skills/plan-and-checkpoints/SKILL.md`
- Create: `plugins/shared-core/skills/evidence-provenance/SKILL.md`
- Create: `plugins/shared-core/skills/risk-privacy-permissions/SKILL.md`
- Create: `plugins/shared-core/skills/quality-verification/SKILL.md`
- Create: `plugins/shared-core/skills/handoff-continuity/SKILL.md`
- Create: `tests/integration/shared-core.test.ts`

**Interfaces:**
- Produces plugin: `shared-core@claude-code-skillsets`
- Produces eight namespaced skills matching the approved design IDs

- [ ] **Step 1: Use `superpowers:writing-skills` and write failing structure tests**

The test must assert exactly eight skill directories, required YAML frontmatter with
`name` and `description`, matching folder and frontmatter names, a `When Not to Use`
section, and no SKILL.md longer than 500 lines.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/shared-core.test.ts`

Expected: FAIL because `plugins/shared-core` does not exist.

- [ ] **Step 3: Create the plugin manifest**

Use name `shared-core`, version `0.1.0`, Apache-2.0, repository
`https://github.com/seunghyeon1004/claude-code-skillsets`, and skills path
`./skills/`. Keep keywords limited to `workflow`, `verification`, `privacy`, and
`provenance`.

- [ ] **Step 4: Author and pressure-test each skill**

For each skill, first record one baseline scenario where Claude skips the intended
behavior, then write the minimum instruction that changes the behavior, and rerun the
scenario. Store cases beneath `tests/evaluations/shared-core/<skill>.yaml` with fields
`id`, `prompt`, `expectedBehaviors`, and `forbiddenBehaviors`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/integration/shared-core.test.ts
claude plugin validate plugins/shared-core
```

Expected: eight skills pass structure checks and Claude validates the plugin.

```bash
git add plugins/shared-core tests/integration/shared-core.test.ts tests/evaluations/shared-core
git commit -m "feat: add shared workflow core"
```

### Task 8: Implement the Reference Installation Planner

**Files:**
- Create: `src/installer/plan.ts`
- Test: `tests/unit/install-planner.test.ts`

**Interfaces:**
- Consumes: `InstallRequest` with `{ domains, tools, level, optionalPlugins }`
- Produces: `InstallPlan` with `{ required, recommended, optional, warnings, commands }`
- `level`: `essential | recommended | custom-max`

- [ ] **Step 1: Write exact profile-resolution tests**

```ts
import { describe, expect, it } from "vitest";
import { planInstall } from "../../src/installer/plan.js";

describe("installation planner", () => {
  it("includes only explicitly selected optional plugins", () => {
    const plan = planInstall(
      {
        domains: ["software-engineering"],
        tools: ["github"],
        level: "custom-max",
        optionalPlugins: ["github-tools"]
      },
      fixtureIndex()
    );
    expect(plan.required).toEqual(["shared-core"]);
    expect(plan.recommended).toEqual(["repository-to-implementation-plan"]);
    expect(plan.optional).toEqual(["github-tools"]);
    expect(plan.commands).toEqual([
      "claude plugin install shared-core@claude-code-skillsets --scope user",
      "claude plugin install repository-to-implementation-plan@claude-code-skillsets --scope user",
      "claude plugin install github-tools@trusted-tools --scope user"
    ]);
  });
});
```

`fixtureIndex()` returns one software engineering profile with the exact three
plugins asserted above and is defined in the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/install-planner.test.ts`

Expected: FAIL because `src/installer/plan.ts` does not exist.

- [ ] **Step 3: Implement pure plan resolution**

Essential includes required plugins; recommended adds recommended plugins;
custom-max adds only names present in `optionalPlugins`. Reject Blocked sources,
warn for Community sources, deduplicate plugins, and keep dependency-first order.

- [ ] **Step 4: Keep the planner development-only**

The planner validates generated profiles and provides expected examples for skill
evaluations. It must not be bundled as an executable user runtime. The setup skill
reads the same generated index and follows the same ordering and trust rules.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/unit/install-planner.test.ts`

Expected: planner tests pass with no duplicate commands.

```bash
git add src/installer/plan.ts tests/unit/install-planner.test.ts
git commit -m "feat: add reference installation planner"
```

### Task 9: Create the Consent-Based Setup Skill

**Files:**
- Create: `plugins/skillset-manager/.claude-plugin/plugin.json`
- Create: `plugins/skillset-manager/skills/setup/SKILL.md`
- Test: `tests/integration/setup-skill.test.ts`
- Create: `tests/evaluations/skillset-manager/setup.yaml`

**Interfaces:**
- Produces plugin: `skillset-manager@claude-code-skillsets`
- Depends on: `shared-core` with compatible version range `^0.1.0`
- Produces skill: `/skillset-manager:setup`
- Reads: `${CLAUDE_PLUGIN_ROOT}/data/install-index.json`

- [ ] **Step 1: Write failing structure and behavior tests**

Assert that setup asks for language, lists every proposed environment probe, obtains
consent before probing, accepts multiple work purposes, accepts explicit optional
plugin selections, shows the full install preview with trust and permissions, and
asks approval before any install command.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/setup-skill.test.ts`

Expected: FAIL because the manager plugin does not exist.

- [ ] **Step 3: Author the runtime-free setup skill**

The skill uses Korean or English as selected. Before environment detection it prints
the exact read-only commands it proposes to run and asks consent. On refusal it asks
manual questions. It never reads shell history, environment variable values, browser
data, SSH keys, or arbitrary project file contents.

- [ ] **Step 4: Add preview and execution rules**

The skill reads the generated install index, applies Essential, Recommended, or
Custom Max rules, displays source, trust tier, permissions, and every resulting
`claude plugin install` command, then asks one final approval. It executes approved
commands sequentially, records success or failure per command, and invokes doctor.

- [ ] **Step 5: Pressure-test and commit**

Run: `npm test -- tests/integration/setup-skill.test.ts`

Expected: setup structure and safety checks pass, including a refusal scenario where
no environment probe or install command is allowed.

```bash
git add plugins/skillset-manager tests/integration/setup-skill.test.ts tests/evaluations/skillset-manager/setup.yaml
git commit -m "feat: add consent-based setup skill"
```

### Task 10: Create the Doctor Skill

**Files:**
- Create: `plugins/skillset-manager/skills/doctor/SKILL.md`
- Test: `tests/integration/doctor-skill.test.ts`
- Create: `tests/evaluations/skillset-manager/doctor.yaml`

**Interfaces:**
- Produces skill: `/skillset-manager:doctor`
- Runs only disclosed read-only checks
- Requires Claude Code 2.1.121 or newer

- [ ] **Step 1: Write failing doctor behavior tests**

Assert that doctor discloses and runs `claude --version`,
`claude plugin marketplace list`, and `claude plugin list --json`; identifies load and
dependency errors; checks only executables required by installed packs; and never
upgrades software, changes settings, or removes plugins.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/doctor-skill.test.ts`

Expected: FAIL because the doctor skill does not exist.

- [ ] **Step 3: Author the runtime-free doctor skill**

The skill explains each check before execution, parses the reported Claude version,
requires 2.1.121 or newer, summarizes marketplace and plugin errors, and separates
hard failures from optional missing-tool warnings. It asks before any follow-up action
that would mutate the user's environment.

- [ ] **Step 4: Add bilingual failure guidance**

Provide Korean and English guidance for outdated Claude, missing marketplace,
disabled dependency, range conflict, missing executable, and clean health results.
Do not print secret values or complete environment dumps.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/integration/doctor-skill.test.ts
claude plugin validate plugins/skillset-manager
```

Expected: doctor safety checks pass and Claude validates the plugin.

```bash
git add plugins/skillset-manager/skills/doctor tests/integration/doctor-skill.test.ts tests/evaluations/skillset-manager/doctor.yaml
git commit -m "feat: add skillset doctor"
```

### Task 11: Wire Generated Runtime Data into the Manager

**Files:**
- Modify: `src/generate/catalog.ts`
- Modify: `plugins/skillset-manager/data/install-index.json`
- Modify: `.claude-plugin/marketplace.json`
- Test: `tests/integration/manager-generation.test.ts`

**Interfaces:**
- Consumes: validated manifests and dependency graph
- Produces: manager install index containing domains, packs, dependencies, tools, trust tiers, and localized labels

- [ ] **Step 1: Write stale-data and completeness tests**

Assert that every stable or beta pack appears in the install index, every referenced
external source includes a trust tier, every label includes Korean and English, and a
second generation run produces no diff.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/integration/manager-generation.test.ts`

Expected: FAIL because the generator does not yet update the manager's bundled data.

- [ ] **Step 3: Extend the generator**

Write the same canonical JSON bytes to `generated/install-index.json` and
`plugins/skillset-manager/data/install-index.json`. Include only fields required at
install time and exclude evaluation prompts, maintainer notes, and source file paths.

- [ ] **Step 4: Generate both plugins in the marketplace**

Add `shared-core` and `skillset-manager` as relative plugin sources. Declare the
manager's `shared-core` dependency in one source manifest so generation, not manual
editing, owns the marketplace dependency record.

- [ ] **Step 5: Verify and commit**

Run: `npm run generate && npm run check:generated && npm test -- tests/integration/manager-generation.test.ts`

Then run: `claude plugin validate .`

Expected: generated files are current, all completeness assertions pass, every
relative plugin source exists, and Claude validates the root marketplace.

```bash
git add src/generate plugins/skillset-manager/data .claude-plugin generated tests/integration/manager-generation.test.ts
git commit -m "feat: generate installer runtime data"
```

### Task 12: Add CI and Clean-Copy Verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `tests/e2e/clean-copy.sh`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `LICENSE`
- Modify: `README.md`

**Interfaces:**
- Produces CI jobs: `quality` and `claude-plugin-validation`
- Produces local gate: `npm run check`

- [ ] **Step 1: Write the clean-copy test**

The shell test creates a temporary directory, runs
`git clone --no-hardlinks --local "$(git rev-parse --show-toplevel)" "$tmp/repo"`,
checks out the source HEAD, runs `npm ci` and `npm run check`, validates the root
marketplace and both plugins with `claude plugin validate`, then removes the temporary
directory. Any command failure exits nonzero. The clone retains `.git`, so
`check:generated` can use `git diff --exit-code`.

- [ ] **Step 2: Run the clean-copy test before CI wiring**

Run: `bash tests/e2e/clean-copy.sh`

Expected: PASS locally after Tasks 1-11 with Claude Code 2.1.198 or newer.

- [ ] **Step 3: Add GitHub Actions gates**

Use `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` with comment
`actions/checkout v7`, and
`actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` with comment
`actions/setup-node v7`. Configure Node 22 with npm cache, install the validation CLI
using `npm install --global @anthropic-ai/claude-code@2.1.198`, then run `npm ci`,
`npm run check`, and the clean-copy script.

- [ ] **Step 4: Add public project policy files**

Add the canonical Apache License 2.0 text. CONTRIBUTING requires Issue-first pack
proposals, DCO sign-off, no copied external skills, bilingual user-facing metadata,
and passing checks. SECURITY directs vulnerability reports to GitHub private
security advisories. Update README status and contributor links without publishing
installation commands until a private release candidate passes.

- [ ] **Step 5: Run the full gate and commit**

Run:

```bash
npm run check
bash tests/e2e/clean-copy.sh
git diff --check
```

Expected: zero test failures, zero type errors, no generated diff, valid Claude
manifests, and no whitespace errors.

```bash
git add .github tests/e2e CONTRIBUTING.md SECURITY.md LICENSE README.md
git commit -m "ci: enforce foundation release gates"
```

## Final Foundation Verification

Run all of the following from a clean checkout:

```bash
npm ci
npm run check
claude plugin validate .
claude plugin validate plugins/shared-core
claude plugin validate plugins/skillset-manager
bash tests/e2e/clean-copy.sh
git status --short
```

Acceptance evidence:

- TypeScript exits with zero errors.
- Vitest reports zero failed tests.
- Regeneration leaves no diff.
- Claude validates the marketplace and both plugins.
- The clean-copy test exits zero.
- Git status is empty.
- The local manual setup review shows every command before execution and performs no environment probe before consent.

After this foundation is accepted, write separate implementation plans for these
domain groups in order: research through promotion, sales through DevOps, AI through
documents, and business operations through legal. Each domain plan must select and
evaluate external sources before deriving its owned skills and outcome packs.
