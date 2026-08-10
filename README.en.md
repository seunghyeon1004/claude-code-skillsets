# Claude Code Skillsets

[한국어](README.md)

An unofficial bilingual Decision Broker that turns one goal into a reviewable
installation decision. It is not a marketplace list, external-skill bundle, or
safety certification. It does not copy external skills or guarantee safety; it
discloses provenance, compatibility, review state, and unknown information in a minimal plan.
For one goal or domain, it proposes at most two external upstream Claude plugins with
Anthropic official-marketplace listing and source-identity evidence. They appear
only when a route has candidates and first show their evidence, gaps, and `unknown` fields.
A route with no candidate returns an empty array and preserves its capability gaps.
External candidate installation requires separate approval; in `0.1`, candidate update and removal are also on a
review-required hold.

**Technical preview:** currently 0/20 executable and 20/20 review-held
discovery-only. Public repository visibility is not the launch of an
installation-executable product.

This repository owns its broker/control skills: `setup`, `doctor`, `maintain`,
and `shared-core`. It does not author, copy, or bundle external purpose/domain
skills.

## Claude Code Quick Start

Claude Code and Node.js `>=22` are required. Run these two commands:

```sh
claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user
claude plugin install skillset-manager@claude-code-skillsets --scope user
```

`skillset-manager` automatically installs its same-marketplace `shared-core`
dependency. Example: `/skillset-manager:setup "software development"`.

Setup boundary-matches one goal sentence against **bounded indexed goal phrases**
and accepts only an unambiguous goal or one broad domain. It does not infer detailed
categories or combine several broad domains for installation. When goal matching is
not unique, setup makes no install guess and uses the broad-domain fallback. The
installation unit is one decision-plan `primary` and, when justified, one optional
complement.

Current execution limit: v0.1: darwin + exact Claude Code 2.1.198; 0/20 executable,
20/20 review-held discovery-only. `2.1.198` is the exact contract tested by this
release, not a claim that it is the latest version. Every current domain route is
review-held and performs no installation. `related` evidence never supplies coverage
or authorizes installation. See the generated [route availability table](generated/catalog.en.md#route-availability)
for each route's candidate order/state, unsupported count, observation time, and expiry.
Setup preview `discoveryCandidates` are discovery-only and never enter the approval
digest or installation authority. A route with no candidate returns an empty array
while preserving its existing capability gaps.

The 20 broad domains below and 40 draft outcome packs are a classification taxonomy
and future-review backlog, not supported or executable capabilities.

**20 broad domains:** `ai-agents-and-automation`, `business-operations`, `commerce`,
`data-and-analytics`, `design-and-brand`, `devops-and-security`,
`documents-and-knowledge`, `finance-and-accounting`, `legal-risk-and-compliance`,
`marketing-and-growth`, `people-and-training`, `product-management`,
`project-management`, `promotion-and-distribution`, `research-and-intelligence`,
`sales-and-customer`, `software-engineering`, `strategy-and-decision`,
`video-and-audio`, `writing-and-publishing`

All 40 outcome packs in the catalog remain **draft outcome packs**: they are design
data for classification and future review, not active install units. Multi-domain
selection, ambiguous goals, expired catalogs, `linux`, and `win32` are held.

Before installation, each candidate discloses `unknown` permissions, license,
trust, dependencies, marketplace authentication status, and cost when they are not
observed. An official listing is not an individual safety review and does not prove
that authentication or cost is absent. Only separate final approval can run the
exact Claude CLI install; successful installs are recorded in local
`state/install-lock.json` receipts and state.

## Project Principles

- Primary documentation: Korean
- Companion documentation: English
- License for original code and skills: Apache-2.0
- External skills: referenced at their upstream marketplaces and under their
  original licenses; they are not copied here
- Data collection: no default collection of installation statistics or user
  configuration

## Codex Quick Start

The Codex route is **decision and discovery only; it does not execute**. It
requires Node.js `>=22`; the `gh` CLI is not required.

For a fresh checkout, run these commands in order:

```sh
git clone https://github.com/seunghyeon1004/claude-code-skillsets.git
cd claude-code-skillsets
npm ci
AS_OF="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
npm run broker -- decision-plan --runtime codex --platform darwin --as-of "$AS_OF" --goal "software development"
npm run broker -- domains
npm run broker -- runtime codex --limit 20
npm run broker -- review-queue
npm run broker -- recommend "software development" --limit 20
npm run broker -- provenance
```

For an existing checkout, prepare dependencies in that repository before using
the same broker commands:

```sh
cd /path/to/claude-code-skillsets
npm ci
```

- Codex `decision-plan` returns at most one primary and one optional complement
  as a `preview-only` `$skill-installer` handoff when evidence is current. It
  returns a held response with no candidates when evidence is insufficient or
  expired. `executionStatus: "not-executed"` means no command ran.
- `domains`, `runtime codex`, `review-queue`, `recommend`, and `provenance` show
  decision evidence and discovery state from the current catalog.
- A `.codex` path observation is not automatic compatibility or installability.
  Without sufficient compatibility evidence, a Codex plan is held and creates no
  installation preview.

Codex does not install, update, or change marketplaces through this broker. Passing
an eligible handoff to an actual `$skill-installer` operation is a separate
user-approved step outside the broker. Claude Code installation is approved
separately through `/skillset-manager:setup`.

## Decision States

- `marketplace-listed`: the candidate appears in an official marketplace. It
  does not mean an individual safety review is complete or that safety is guaranteed.
- `eligible-with-disclosures`: current-runtime installation evidence exists and
  there is no blocked or stale review, but all unknown information and risks must
  be disclosed before approval can be requested.
- `held`: incomplete review, unverified compatibility, missing evidence, or expiry
  permits an explanation only and excludes the candidate from the install plan.
- `blocked`: a recorded blocking reason means recommendation and installation are
  prohibited.
- `stale`: prior review evidence no longer matches the current observation, so the
  candidate is held until a new review is complete.

`unknown` is never assumed safe. Permissions, license, trust, dependencies,
authentication, and cost remain `unknown` whenever they are not observed.

## Runtime State Detail

State schema v2 appends approved setup executions as independent `runs` in
`state/install-lock.json`. It preserves each prior run's approval, statuses, and
receipts and permits only new candidates whose global `(pluginName, marketplaceId,
scope)` identity does not overlap. Replaying the same fully successful approved run
invokes no Claude command and leaves the durable install lock unchanged; it only
acquires and releases the approved transient execution lock. A validated v1 single
run is deterministically migrated when the next non-overlapping run is appended.
Partial or failed runs, approval/index drift, malformed state, duplicate runs, and
duplicate receipts hold before any Claude command. Automatic resume of a failed run
is not supported.

An anchored execution lock admits only one concurrent setup, and every publisher
write runs an **expected-prior-digest stale check** on the prior canonical raw digest
immediately before rename. This is not an atomic CAS against same-user external
writers that ignore the execution lock, and it does not claim to block a pathname
write between that check and rename. Completed historical runs are authenticated from
plugin-owned digest history rather than reprojected from the current catalog.
Execution-lock release also only rechecks the pathname identity immediately before
removal; it is not an inode-bound unlink, so a same-user replacement after that check
remains a residual limitation. An observed identity mismatch preserves that path and
holds for doctor review.

## Known Held Candidate

`shopify-ai-toolkit` is `held` and is excluded from every install plan until an
individual privacy and telemetry review is complete. Its pinned upstream README
discloses the following observed behavior:

- Telemetry is enabled by default and sent to `https://shopify.dev/mcp/usage`.
- Data categories include tool/skill/version; model/client/version when supplied;
  search query and response/error; validation result, validated code, and context;
  artifact/revision IDs; up to 2,000 characters of the recent user prompt verbatim;
  session/tool IDs when supplied; and hook activation events.
- `OPT_OUT_INSTRUMENTATION=true` opts out, but does not complete the individual
  review or make the candidate installable.
- The upstream license is [MIT](https://raw.githubusercontent.com/Shopify/Shopify-AI-Toolkit/556811e94dd45c795abe5c0b1bf6b5a4b098149d/LICENSE).

This repository does not copy Shopify README or SKILL source. It retains only
verification metadata composed of the pinned repository, commit, path, immutable
raw URL, and content SHA-256.

## Release Standard

Every release must pass generation checks, TypeScript checks, behavior
evaluations, manifest validation, Claude plugin validation, and clean-copy
verification from a new clone. Environment discovery and command execution are
disclosed before use and require explicit user approval.

On GitHub Free, staged publication begins with an exact two-commit public history.
Create a parentless `A` from the approved clean tree, create `B` as its same-tree
child, and point the annotated `public-history/root-v1` tag at `A`. Preserve the
existing repository as a private archive and push only that exact `A`/`B`/tag graph
to a new empty private repository. After ordinary CI and the public-history bootstrap
pass, anchor `registry-approved/r01` exactly at `B`. Subsequent security and release
maintenance is one commit `C` whose only parent is `B`. It may change only the exact
reviewed path allowlist and must leave protected research and R01 catalog/data bytes
unchanged.

After separate approval, fast-forward private `main` from `B` to `C` without force and
retain that push-event CI run. Only if private Actions billing blocks it, obtain final
public-visibility approval and rerun the same run ID after publication. Require
successful `quality` and `claude-plugin-validation` checks on exact `C`, then enable
and verify private vulnerability reporting before protecting `main`. Public visibility
is not a release. Pull requests are required with
an approval count of `0`, and the policy does not require CODEOWNERS review. Both
required checks are bound to GitHub Actions app ID `15368`. Direct pushes, force
pushes, and branch deletion are disabled; enforcement includes admins and there is
no bypass for any user, team, or app. This solo-maintainer write-path policy does
not create a human-review gate. Independent human review is not guaranteed.

Stage 3 uses exactly one of two paths. The default path runs and passes the
read-only same SHA fixture suite from a clean local `main` checkout of exact `C` using
the local subscription Claude CLI and retains its passed receipt. The exceptional path
is a manual exact-SHA owner waiver approved only after the protected public remote
`main` final SHA is confirmed, when subscription cost prevents the full semantic RC.
The waiver is not a pass; it records that the full same-SHA fixture suite was not run
and semantic coverage is not proven. The manual path creates no local waiver receipt or
verifier. It does not mechanically prove historical absence, and the owner must not
delete or hide a known semantic failure. When the manual waiver is used, display this
sentence verbatim in the repository README, GitHub Release body, and submission-visible
description:

> Full exact-SHA semantic RC was not run; semantic coverage is not proven; release proceeds under an explicit owner waiver.

The full RC path installs no external candidate, makes no GitHub mutation, and retains
only sanitized receipts as release evidence. Then verify an unauthenticated clone of
that SHA, marketplace add, manager install, and the first setup preview. Only after
stages 1, 2, and 4 pass and Stage 3 has either a full RC pass or a separately approved
manual exact-SHA owner waiver may the maintainer create a release tag or GitHub
Release and announce the project. On failure, return the repository to private without
a tag or announcement. Before the
remote push, C may be replaced by another single child of B. After remote C exists,
never non-fast-forward or force-push a sibling C. Stop after returning private until a
new explicit plan approves one append-only repair commit on the current remote C and
re-audits every public commit from B through that repair. Never rerun the A/B/R01
bootstrap or move those tags. Copies fetched while
public cannot be recalled. The full order is
fixed in the
[GitHub Free staged-public runbook](docs/release/github-free-staged-public.md).

`skillset-manager` declares `shared-core` as a static same-marketplace dependency and
is distributed only through the author-owned GitHub marketplace. Only `shared-core`
is a Claude plugin directory submission candidate. This community-driven directory
is surfaced in Claude Code as the official `claude-plugins-official` marketplace;
external authors submit through the official in-app or Console forms, not a repository
pull request. `skillset-manager` remains on a current policy hold because it directs
dynamic installation of external plugin behavioral instructions. A future
`shared-core` listing would not list, approve, or endorse the manager. The submission
boundary and owner-only terms-acceptance gate are fixed in the
[Claude plugin directory submission draft](docs/release/claude-directory-submission.md).

## Project Documents

- [Approved Decision Broker design](docs/superpowers/specs/2026-07-29-decision-broker-v1-design.md)
- [Decision Broker implementation plan](docs/superpowers/plans/2026-07-29-decision-broker-v1.md)
- [Contribution guide](CONTRIBUTING.md)
- [Security reporting policy](SECURITY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Apache-2.0 license](LICENSE)

This independent community project is not an official Anthropic product.
