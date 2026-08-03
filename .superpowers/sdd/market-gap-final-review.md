# Historical Public Candidate Market-Gap Review

> **Historical audit snapshot, superseded.** This report evaluates only the
> candidate SHA named below and is retained as review evidence. Subsequent work
> superseded its findings and verdict. This document does not state current release
> clearance or claim that a release occurred.

- Audit time: `2026-08-02T14:16:43Z`
- Historical candidate: `release/public-candidate` at
  `62fab37577419e064e17a7576fe06d29cd4d7fe5`
- Scope: market position, README/metadata claims, marketplace boundary, and
  observable decision/runtime contract
- Method: primary documentation, current upstream repositories at immutable
  commits, source inspection of the closest competitors, and local broker
  command probes
- External effects: none; no third-party plugin or skill was installed

## Historical Verdict

**FINDINGS: 0 blocker, 3 major, 2 minor.**

The broad catalog/installer/skillset market is crowded. This project must not
claim that nobody else turns a need into a skill recommendation, asks for
confirmation, tracks a content hash, or records install state. In particular,
`agentskill.sh` now overlaps materially with those features.

The narrower gap remains real and defensible in the surveyed market:

> A no-vendoring decision layer for external Claude plugins that reduces one
> bounded goal/domain to at most two Anthropic-official-marketplace-listed
> upstream candidates, shows capability evidence, unsupported coverage and
> unknowns, binds exact Claude CLI execution to explicit consent and approval,
> records local receipts/state, and fails closed on drift or incomplete
> evidence.

No surveyed product combined that entire contract. This is not proof that no
such project exists anywhere; it is a current, representative market audit.
After the three major findings below are fixed and reverified, the positioning
is suitable for public release. Expanding 7 executable routes to 20 is not a
launch prerequisite because the current README states the 7/13 split plainly.

## What The Market Already Provides

### Native platform marketplaces

- Anthropic's official marketplace is auto-added, is curated at Anthropic's
  discretion, and its browser now exposes context cost, last-updated time, and
  a `Will install` component list before install. Its separate community
  marketplace uses automated validation/safety screening and commit-SHA pins.
  It remains the strongest substitute for basic Claude plugin discovery and
  install review, but it does not expose this project's goal-to-capability-gap
  decision contract or local approval-bound execution receipts.
  ([Anthropic discovery documentation](https://code.claude.com/docs/en/discover-plugins),
  [marketplace authoring documentation](https://code.claude.com/docs/en/plugin-marketplaces))
- OpenAI's Plugin Directory is now the primary discovery surface across
  ChatGPT and Codex. Plugins can bundle skills, apps, and app templates, and
  workspace controls govern access. Codex also has a curated/GitHub
  `$skill-installer`. These are materially stronger native Codex routes than
  this project's read-only Codex companion, but they do not broker external
  Claude marketplace plugins.
  ([OpenAI plugin documentation](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex),
  [Codex skill-installer source](https://github.com/openai/codex/blob/2b5bdcf67547860f2e5c5a605009a70026796b2b/codex-rs/skills/src/assets/samples/skill-installer/SKILL.md),
  [openai/skills](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431))

### Cross-agent catalogs and installers

- Vercel's `skills` CLI supports Claude Code, Codex and 70+ other agents,
  arbitrary Git/GitHub/direct-download sources, search, install, list, update,
  remove, copy/symlink modes, a skill-folder hash lock, and optional `-y`/`--all`
  non-interactive paths. Its bundled `find-skills` skill maps a need to a domain
  and task, searches, uses installs/source reputation/stars as quality
  heuristics, presents options, and offers an install command. It is a package
  manager and popularity/reputation discovery layer rather than a bounded
  capability-coverage decision broker.
  ([CLI source](https://github.com/vercel-labs/skills/blob/1164afa5f0e21ebd01e6fc11249759353f494ad1/README.md#L28-L120),
  [`find-skills`](https://github.com/vercel-labs/skills/blob/1164afa5f0e21ebd01e6fc11249759353f494ad1/skills/find-skills/SKILL.md#L33-L103),
  [lock model](https://github.com/vercel-labs/skills/blob/1164afa5f0e21ebd01e6fc11249759353f494ad1/src/skill-lock.ts#L15-L119))
- `agentskill.sh` is the closest direct competitor. Its `/learn` skill searches
  a large central catalog, detects project context, shows install and security
  scores, confirms ordinary search/skillset installs, installs to multiple
  agents, stores content SHA in a lock, updates/removes skills, and supports
  bundled skillsets. This invalidates any broad claim that goal-aware discovery,
  confirmation, security disclosure, and install state are an empty market.
  ([current `/learn` source](https://github.com/agentskill-sh/ags/blob/ede92fd8fc94335d40dc0f74c60b4355c83c4a4c/skills/learn/SKILL.md#L50-L138),
  [install flow](https://github.com/agentskill-sh/ags/blob/ede92fd8fc94335d40dc0f74c60b4355c83c4a4c/skills/learn/SKILL.md#L233-L284),
  [CLI install code](https://github.com/agentskill-sh/ags/blob/ede92fd8fc94335d40dc0f74c60b4355c83c4a4c/src/commands/install.ts#L18-L57),
  [lock code](https://github.com/agentskill-sh/ags/blob/ede92fd8fc94335d40dc0f74c60b4355c83c4a4c/src/skill-lock.ts#L20-L50))

`agentskill.sh` is still not the same contract. Its published direct
`/learn @owner/slug` route invokes the JSON installer without the shared preview
and confirmation flow. The JSON CLI branch writes immediately and then records
the content SHA; `/learn` can also self-update without separate approval and
automatically submits ratings. Those choices may be valid for that product,
but they are not an approval-digest/exact-command/receipt boundary. It also
writes skill content returned by its central API, whereas this project does not
copy external skills into its repository.

### Curated suites and pack managers

- ECC is a major adjacent competitor: it accepts natural-language queries,
  ranks its own components/profiles with reasons, emits install and plan
  commands, supports selective cross-harness installs, and writes install
  state. Its default consultation limit is 5 (maximum 20). It is a creator and
  distributor of its own suite, not a no-vendoring broker for independent
  upstream plugins; it does not disclose external capability gaps and unknown
  review fields.
  ([consult implementation](https://github.com/affaan-m/ECC/blob/e4e4163101f162881e628f300a9ca4e6a940bcea/scripts/consult.js#L119-L137),
  [ranking and commands](https://github.com/affaan-m/ECC/blob/e4e4163101f162881e628f300a9ca4e6a940bcea/scripts/consult.js#L241-L357))
- `claude-code-templates` is a broad creator/catalog/installer with a web
  browser, agents, commands, MCPs, settings, hooks, skills, health checks and a
  plugin dashboard. It competes for first-run convenience, not the same trust
  boundary.
  ([source](https://github.com/davila7/claude-code-templates/blob/789f8f7634ac010dd5ba89a68c57a17d3e055a5f/README.md#L59-L132))
- `laurigates/claude-plugins` provides a tiered creator-owned plugin suite,
  health/audit recommendations, canonical pins and drift checks. This is a
  useful benchmark for lifecycle ergonomics, but not an upstream intermediary.
  ([source](https://github.com/laurigates/claude-plugins/blob/c9b59994c91b69a79cb00e7443b3854c712733ce/README.md#L267-L293),
  [pin/drift workflow](https://github.com/laurigates/claude-plugins/blob/c9b59994c91b69a79cb00e7443b3854c712733ce/README.md#L417-L442))
- Cisco's Skill Scanner supplies best-effort prompt-injection, data-exfiltration,
  malicious-code and policy scanning with machine-readable reports. It is a
  scanner, not a recommendation/install broker, and its README explicitly says
  that a clean scan is not a safety guarantee. This project should remain
  explicit that it is not a security scanner or certification.
  ([source](https://github.com/cisco-ai-defense/skill-scanner/blob/4dee90371890ff23e1b21ea974e02847eacaa464/README.md))

## Feature Comparison

| Contract layer | This candidate | Anthropic native | Vercel skills/find-skills | agentskill.sh `/learn` | ECC |
| --- | --- | --- | --- | --- | --- |
| Goal/context routing | Bounded reviewed phrases/domain | Browse/search | Domain/task query | Project/query context | Natural-language query |
| Default install candidates | Maximum 2 | User-selected | Unbounded or `--all` | Search returns 5; skillsets may contain many | 5, max 20 |
| Independent upstreams | Official-marketplace-listed external plugins | Official/community marketplace sources | Arbitrary skill sources | Central indexed skill sources | Own suite |
| No external source vendoring in project | Yes | Marketplace references sources | Installs canonical copy/symlink | Writes API-returned skill files | No, distributes own suite |
| Capability evidence plus uncovered gaps | Yes | Component inventory, no goal gap model | Popularity/reputation heuristics | Security/content scores | Match reasons |
| Unknown fields stay unknown | Yes | Listing/setup details | No equivalent decision state | Scores, no equivalent unknown contract | No equivalent external state |
| Approval bound to exact execution | Preview/risk/identity digests and exact argv | Interactive install scope | Confirmation can be skipped | Text confirmation on ordinary path; direct JSON path differs | Plan/dry-run, no external approval digest |
| Durable execution receipts/failure state | Yes | Native installed state | Folder-hash lock | Content-SHA lock | Own install state |
| Stale/evidence drift fails closed | Yes | Marketplace refresh/update behavior | Update flow | Update flow | Pin/drift audit for own suite |
| Codex execution here | Intentionally none | N/A | Yes | Yes | Yes |

The differentiator is the **composition** of the second through ninth rows, not
any single row.

## Candidate Contract Verification

The local candidate substantiates the core narrow claim:

- The README immediately says this is not a marketplace list, external-skill
  bundle, or safety certification and discloses the exact 7 executable / 13
  discovery-only split.
- The generated route table shows 20 routes, candidate order, availability,
  unsupported count, observation time and expiry.
- The decision index carries official listing/source identity, per-candidate
  state reasons, unknown permission/license/trust/dependency fields, fixed
  Claude install argv, capability evidence and uncovered capabilities.
- The runtime exposes only a digest and bounded review summary by default,
  requires on-demand approval-object access, binds execution to preview/risk
  digests and exact Claude executable identity, caps executable previews at two
  candidates, checks the literal Claude install argv, verifies marketplace and
  installed state, and records reconciliation state instead of automatically
  retrying/removing a failed install.
- Local `claude --version` was `2.1.198`, matching the advertised exact runtime
  contract at audit time.

Local probes also confirmed the intended limits:

- Claude Code `software development` returned two candidates with explicit
  partial coverage and eight uncovered capabilities; it executed nothing.
- Codex `software development` returned `held`, an empty candidate list and
  `executionStatus: not-executed`.
- Ambiguous Codex `marketing` returned `held` with
  `domain-selection-required`.

## Findings

### MAJOR-01: `official upstream` can imply first-party authorship or endorsement

**Evidence:** README lines 8-10 in Korean and lines 9-10 in English call the
candidates `official upstream plugins`. Many selected candidates are external
publishers whose only common authority is listing in Anthropic's official
marketplace. The same README later states this distinction correctly, and the
marketplace manifest already uses the precise phrase `official
marketplace-listing and source-identity evidence`.

**Risk:** The highest-trust claim appears before the later disclaimer and can be
read as Anthropic-authored, vendor-official, individually reviewed, or endorsed.
That weakens the exact trust distinction that makes this project valuable.

**Required before public:** Replace both first-screen phrases with the precise
boundary, for example:

> Anthropic 공식 Marketplace에 등재되고 source identity 근거가 있는 외부
> upstream Claude 플러그인

> external upstream Claude plugins with Anthropic official-marketplace listing
> and source-identity evidence

Do not use `official plugin`, `trusted`, `safe`, or `verified` as a shorthand.

### MAJOR-02: package metadata overstates the Codex product lane

**Evidence:** `package.json` describes the package as reviewing `Claude Code and
Codex skill installations`. The README and actual behavior say the Codex lane is
decision/discovery-only, performs no install/update/marketplace change, and the
audited `software development` decision was held with zero candidates. Native
Codex now also has its own Plugin Directory and `$skill-installer`.

**Risk:** Search results or metadata previews can imply a cross-platform
installer that the product intentionally does not provide. That invites direct
comparison with stronger cross-agent installers on their best axis and hides
the Claude approval/receipt boundary where this project is differentiated.

**Required before public:** Change the package description to a literal scope,
using this exact English metadata value:

> A bilingual decision broker for reviewable Claude Code plugin installation,
> with a non-executing Codex discovery companion.

Its Korean meaning, which should remain aligned in the README/GitHub description,
is:

> 검토 가능한 Claude Code 플러그인 설치 결정을 제공하고 실행하지 않는 Codex
> 발견 경로를 보조로 제공하는 이중 언어 Decision Broker.

Keep Codex secondary in positioning until there is independently verified
Codex eligibility and execution support. Do not describe `preview-only`
handoffs as installs.

### MAJOR-03: the release candidate's official-marketplace evidence is already behind live upstream

**Evidence:** The candidate's pinned official baseline is
`e3e378cbbb205673a5d7254ded32679cafa6179d` with 272 plugins and manifest SHA-256
`64b111d8c1716c062a285ed63eade42f56e2e79ac95859a994d586f573a20e5e`.
At audit time, live upstream HEAD was
`a473e6e809e0866cdf7798e2d534f03c0367036b` with 276 plugins and manifest SHA-256
`c99cd51813f84b9c2eef4f7e26951d651828774c72be4a210175f8d0155d1182`.
The candidate's decision catalog expires `2026-08-07T00:00:00Z`, only about five
days after this audit.

**Risk:** Publishing the old evidence would immediately make freshness, change
review and maintenance the weakest part of a product whose differentiation is
precisely evidence lifecycle. The difference itself does not prove any selected
candidate unsafe; it proves a review transition is required.

**Required before public:** Materialize the live observation through the
append-only refresh path, review the inventory/source-pin delta, explicitly
approve only the reviewed transition, regenerate all decision surfaces, and run
the complete release gates. Re-read upstream HEAD immediately before the final
candidate is frozen. Do not auto-promote an observation merely because the
plugin name is unchanged.

### MINOR-01: the repository name still sounds like a bundled skill collection

The first paragraph corrects this immediately, so a rename is not required.
Keep `Decision Broker` prominent in the GitHub description, topics and release
copy. Never market `Claude Code Skillsets` as an all-in-one pack or 20-domain
installation bundle.

### MINOR-02: current utility is deliberately narrow

Seven partial routes execute and thirteen only discover. This is not a defect
because the limitation, unsupported counts and gaps are public. It does mean
launch copy should demonstrate one real executable route and one held route,
not imply complete coverage across all 20 domains. Route expansion can follow
only when direct/inferred capability evidence supports it.

## Recommended Public Position

Use these paired category statements.

Korean:

> Claude Code Skillsets는 외부 Claude 플러그인을 위한 비공식 한국어 우선
> Decision Broker입니다. 제한된 목표 하나를 Anthropic 공식 Marketplace에 등재되고
> source identity 근거가 있는 플러그인 최대 두 개로 좁힌 뒤, 근거, 미지원 능력과
> unknown을 보여 주고, 별도 승인에 묶인 정확한 설치와 로컬 영수증을 제공합니다.
> 카탈로그, 번들, 스캐너 또는 안전성 인증이 아니며 Codex 지원은 실행 없는 발견
> 경로입니다.

English:

> Claude Code Skillsets is an unofficial, Korean-first decision broker for
> external Claude plugins. It narrows one bounded goal to at most two plugins
> with Anthropic official-marketplace listing and source-identity evidence,
> shows evidence, unsupported capabilities and unknowns, and only then offers
> an approval-bound exact install with local receipts. It is not a catalog,
> bundle, scanner, or safety certification. Codex support is non-executing
> discovery.

This deliberately concedes the crowded discovery/installer market and owns the
smaller trust-and-decision layer. The moat is not catalog size. It is the
reviewable chain:

`goal/domain -> max 2 -> evidence/gaps/unknown -> consent/approval -> exact execution -> receipt/state -> fail closed`

## Historical Launch Gate

**Not clear for public at this exact SHA.** Resolve MAJOR-01 through MAJOR-03,
regenerate and re-run the full candidate review. If those checks pass with no
new blocker/major findings, the market position is **CLEAR for a narrow v0.1
public release**. No catalog expansion, security certification, Codex execution,
web UI, or competitor feature parity is required for that release.
