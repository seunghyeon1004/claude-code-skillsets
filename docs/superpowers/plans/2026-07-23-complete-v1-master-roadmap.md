# Complete Private v1 Master Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved 20-domain, 40-pack Claude Code skillset catalog as a verified private v1 without reducing the design scope or making the repository public.

**Architecture:** The complete release is a sequence of independently reviewable plans linked by immutable artifacts and acceptance gates. YAML manifests and checked-in research snapshots remain the source of truth; deterministic TypeScript tooling validates, resolves, generates, and tests them; the installed manager carries a dependency-free lifecycle runtime. No phase completion is equivalent to complete-v1 completion until the final evidence matrix is fully proven.

**Tech Stack:** Node.js 22+, npm, TypeScript 7.0.2, Vitest 4.1.10, Ajv 8.20.0, YAML 2.9.0, semver 7.8.5, Claude Code 2.1.198+, GitHub Actions, Bash on macOS/Linux, and PowerShell/.NET on Windows.

## Global Constraints

- Keep the GitHub repository PRIVATE until the user separately approves publication.
- Preserve exactly the approved 20 domain IDs and 40 initial pack IDs unless an approved replacement proves equal or stronger coverage.
- Keep detailed categories hidden from default onboarding; show them only in generated documentation and Advanced mode.
- Recommend one to three domains from natural-language intent, require domain confirmation, and derive categories, packs, and providers deterministically.
- Environment probes require current consent; every registration, install, update, repair, and removal requires an exact preview and final approval.
- External code remains upstream. Use an immutable native artifact contract or pinned `git-subdir`; never copy external implementation files into this repository.
- External providers can be at most `trusted`; `verified` is reserved for repository-owned release artifacts.
- The installed manager must run without repository checkout, `node_modules`, Python, `jq`, or another user-installed runtime beyond Claude Code and platform-native facilities.
- Support macOS arm64, Linux x64, and Windows x64. No plan or receipt may mix POSIX and PowerShell operation families.
- All manifest, generated-document, installation, state, and receipt outputs are deterministic or carry explicitly allowlisted runtime identity fields.
- Every task follows TDD, ends with a focused verification command, and produces a DCO-signed commit.
- Do not promote a pack from draft or beta to stable until its provider, install, semantic, lifecycle, and documentation gates pass.
- A green unit suite, a populated taxonomy, or completion of one phase never proves the complete-v1 goal.

---

## Current Baseline

At roadmap creation, `feature/complete-v1` is based on private `main` and contains the
approved design only. Runtime evidence still shows:

- install-index schema version 1;
- one domain and one pack;
- `essential`, `recommended`, and `custom-max` install levels;
- Unix-only state commands in generated data;
- prompt-only setup and doctor behavior with no installed lifecycle executable;
- no checked-in category, capability, source-review, conflict, or research-snapshot data;
- no complete-v1 release receipt.

These facts are baseline evidence, not partial proof of the complete-v1 release.

## Dependency Graph

```text
P01 catalog contracts
  -> P02 taxonomy and 40 draft packs
       -> P03 research governance
            -> P04 provider review waves
P02 + P04
  -> P05 recommendation and provider resolver
       -> P06 bundled lifecycle runtime
            -> P07 platform adapters
            -> P08 manager workflows
P04 + P05 + P08
  -> P09 domain plugins and owned-gap waves
P02 + P04 + P08 + P09
  -> P10 generated artifacts and bilingual docs
P07 + P08 + P09 + P10
  -> P11 semantic, clean-user, and private RC
       -> P12 independent review and private-main integration
```

P03 begins only after the P02 atomic catalog and identities pass. The four P04
provider-review waves may run in parallel after P03, with one source owner per
upstream repository. P07 and P09 may overlap only after P05 and P06 freeze the operation,
state, provider, and pack-activation interfaces. P12 is strictly last.

## Plan Index

| ID | Plan file | Deliverable | Entry gate | Exit gate |
| --- | --- | --- | --- | --- |
| P01 | `2026-07-23-catalog-contracts.md` | Typed schemas and pure validators for every complete-v1 entity | Approved design | PASS: 220/220 tests, protected-path diff 0, clean-copy and independent contract review passed. Private development history is not published. |
| P02 | `2026-07-23-taxonomy-and-pack-catalog.md` | Canonical 20-domain taxonomy, capabilities, and 40 draft pack manifests | P01 | PASS: 350/350 tests, byte-identical foundation artifacts, committed clean-copy, and independent exit review with zero Critical/Important findings. Private development history is not published. |
| P03 | `2026-07-23-research-governance.md` | Reproducible snapshots, hard gates, 100-point scoring, freshness, and reports | P02 PASS; reviewed plan with zero Critical/Important findings | **PASS:** `35/35` files and `658/658` tests pass; all 15 census/config/receipt/snapshot records reconcile with exact commit/count/content hashes; independently shuffled production report runs reproduce source-audit SHA-256 `c3ee84e06eb0ee8cc3ea5104c6a76138e09db11b7d5ba0a6944ef18e8fb723ce` (4,190 bytes) and trust-report SHA-256 `c8d95d30bcd9b6c3b8b2bbf1a68f3493cfd3c0b851125abb480342658e1007ea` (310 bytes); committed clean-copy and all three Claude plugin validations pass. Final independent P03 spec re-review: `0` Critical, `0` Important, `0` Minor. Private development history is not published. |
| P04 | `2026-07-23-provider-review-waves.md` | Four five-domain market-review waves with selected providers, alternates, conflicts, and owned-gap decisions | P02 and P03 PASS; reviewed plan with zero Critical/Important/Minor findings | All `147/147` pack-referenced capabilities have an exact selection/gap disposition; every current-platform preferred provider has immutable static/install/semantic/remove evidence, while non-current platform roles remain explicit P11 obligations. Private development history is not published. |
| P05 | `2026-07-23-hybrid-recommendation-resolver.md` | Structured intent validation and deterministic five-level resolution | P02, P04 | 20-domain, ambiguous, adversarial, conflict, platform, and no-provider fixtures pass |
| P06 | `2026-07-23-bundled-lifecycle-runtime.md` | Self-contained manager runtime, v2 state, approval, receipts, ownership, resume, update, remove, and doctor | P05 | Installed-plugin clean-home lifecycle tests pass without repository dependencies |
| P07 | `2026-07-23-platform-operation-contracts.md` | POSIX and Windows operation rendering and atomic state adapters | P06 operation IR frozen | Real macOS/Linux/Windows failure-injection suites pass |
| P08 | `2026-07-23-manager-hybrid-workflows.md` | Setup, update, remove, doctor, export, import, and source-audit user workflows | P05, P06 | Normal/boundary semantic suites prove consent, preview, approval, and fail-closed behavior |
| P09 | `2026-07-23-domain-plugins-and-owned-gaps.md` | 20 domain meta plugins and only research-approved owned gap skills in four waves | P04, P05, P08 | All plugin validation, pack activation, guardrail, and owned-skill evaluations pass |
| P10 | `2026-07-23-generated-artifacts-and-docs.md` | Marketplace/index v2, reports, domain/pack pages, and Korean/English first-use docs | P02, P04, P08, P09 | Generated equality and documentation-to-manifest parity pass |
| P11 | `2026-07-23-semantic-e2e-private-release.md` | Three-OS CI, 40-pack semantic corpus, sanitized receipts, and private RC | P07-P10 | Complete clean-user matrix and independent sanitizer verifier pass |
| P12 | `2026-07-23-private-main-integration.md` | Frozen candidate, independent review, private-main merge, and post-merge reproduction | P11 | Zero Critical/Important findings and GitHub-main receipt digests prove the release |

Each child plan is written only after its entry-gate artifacts exist, so it can name exact
provider IDs, owned-gap skill IDs, migration fields, commands, and expected outputs instead
of guessing them. The plan file itself is reviewed and committed before its implementation
begins.

## Provider Review Waves

P04 uses these fixed ownership waves:

1. Research and Intelligence; Strategy and Decision; Writing and Publishing; Marketing and Growth; Promotion and Distribution.
2. Sales and Customer; Product Management; Project Management; Software Engineering; DevOps and Security.
3. AI, Agents, and Automation; Data and Analytics; Design and Brand; Video and Audio; Documents and Knowledge.
4. Business Operations; Finance and Accounting; Commerce; People and Training; Legal, Risk, and Compliance.

An upstream repository belongs to exactly one wave owner. Other waves reference the same
source review and selected capability provider instead of duplicating review records.

## Domain Plugin Waves

P09 uses the same four domain waves. Pack totals are fixed at 10, 11, 11, and 8. Each wave
creates five domain meta plugins, activates only selected packs in manager state, installs
no unrelated external provider, and validates first-install and last-removal reference
count behavior.

## Release Evidence Matrix

| Complete-v1 requirement | Current state | Required proof |
| --- | --- | --- |
| 20 domains and detailed categories | Missing | Canonical catalog, 20 domain/category collections, exact-set and ownership tests |
| 40 initial packs or approved equivalents | Missing except one beta pack | Stable manifests, replacement edges, capability equivalence, and 40 pack receipts |
| Eligible provider coverage | Missing | Current source reviews, immutable revisions, conflict choices, smoke and semantic evidence |
| Hybrid onboarding | Contradicted by purpose/profile selector | 20-domain recommendation fixtures and one-preview consent/approval semantic receipts |
| Five install levels | Contradicted by three current levels | Resolver snapshots for Essential, Recommended, Domain Full, Advanced, and Full Catalog |
| Install/resume/update/remove/doctor | Foundation install/doctor only | Clean-home runtime receipts for every lifecycle and failure path |
| macOS/Linux/Windows | Contradicted by Unix-only state commands | Real three-OS adapter and lifecycle jobs with platform-bound receipts |
| Korean/English first screen | Commands intentionally hidden | First-viewport assertions and generated data parity after the private RC passes |
| Owned skill and pack semantics | Shared core only | Three normal and two boundary cases per owned skill plus normal/boundary/refusal per pack |
| Clean-copy and Claude plugin validation | Proven for foundation only | All generated files and 22 owned plugins validated from a no-hardlinks clean copy |
| Private semantic RC sanitation | Proven for foundation receipt shapes only | v2 lifecycle/domain receipt projection, independent verification, digests, and attestations |
| GitHub-main new-user journey | Foundation flow only | Private-main marketplace through removal receipts for the required OS matrix |
| Independent review | Foundation branch only | Frozen complete-v1 SHA with zero Critical and zero Important findings |
| Private visibility | Currently PRIVATE | Pre-merge and post-merge `gh repo view` visibility receipts |

## Execution Protocol

- [ ] Before each child plan, verify its entry-gate commit and update this roadmap with the exact child-plan commit.
- [ ] Execute a child plan through red test, minimal implementation, focused green test, full `npm run check`, clean-copy validation when applicable, and DCO-signed commit.
- [ ] Run an independent spec-conformance review at each child-plan exit gate; fix blocker and major findings before opening the next dependent plan.
- [ ] Keep provider research and semantic raw outputs local; commit only reviewed manifests, immutable non-secret snapshots, and sanitizer-approved receipts.
- [ ] Record failures honestly in the evidence matrix. Do not convert `Missing` or `Contradicted` to `Proven` from indirect evidence.
- [ ] At P12, audit every row against current files, commands, GitHub state, and receipt digests before marking the active goal complete.

## Stop Conditions

Stop execution and request a decision only when the same unresolved blocker prevents
meaningful work for three consecutive goal turns, or when proceeding would require public
visibility, credential disclosure, unreviewed external execution, destructive unmanaged
removal, or a paid API path the user did not approve. A failed candidate, unavailable
provider, or one platform defect is work to resolve, not permission to shrink the scope.
