# External Route Source Audit

Status: source-level research only. This report does not create a candidate,
change an approval ledger, install a plugin, or make any route eligible.

Audit date: 2026-07-30

## Scope and method

The audit reviewed only the paths named in
[`remaining-18-routes.md`](remaining-18-routes.md), plus files those skills
directly reference for execution or configuration, root license and ownership
signals, and packaging metadata. All four repositories were fetched at the
exact commits below. No repository code was executed, no dependency was
installed, and no Claude marketplace or plugin state was changed.

Static checks covered:

- Git blob identity for every in-scope `SKILL.md` and every referenced Python
  executable.
- Shell commands, subprocesses, network endpoints, secret and environment
  access, persistent writes, hooks, MCP configuration, and telemetry.
- Standard-library and external dependencies, platform assumptions, and
  relative-path behavior after Claude plugin caching.
- MIT license text, commit authorship, security-policy presence, and upstream
  marketplace/plugin ownership metadata.
- Direct capability support against the current broad domain profiles. A skill
  does not close a broad profile when language, safety, or capability gaps
  remain.

The verdicts mean:

- `eligible-for-independent-review`: this source slice is coherent enough for a
  second reviewer. It is not approved or install-eligible.
- `held`: a known packaging, data-egress, side-effect, integrity, or missing-file
  issue must be resolved before eligibility.
- `blocked`: the proposed skill cannot load as a conforming selected skill at
  this commit, or no safe reference package can be formed.

## Curated packaging rule

Claude marketplace entries may pin a GitHub source by full `sha`, set
`strict: false`, and declare exact `skills` directories. In that mode the
marketplace entry is the component definition, so undeclared agents, commands,
hooks, MCP servers, and LSP servers are not exposed. A `plugin.json` at the
selected plugin root that itself declares components conflicts with
`strict: false` and makes the plugin fail to load. Custom paths must exist; if
none exists, Claude falls back to the default scan. These constraints come from
the [Claude Code marketplace source and strict-mode documentation](https://code.claude.com/docs/en/plugin-marketplaces#advanced-plugin-entries).

The proposals below therefore use only pinned upstream GitHub content. They do
not copy upstream skills into this repository. Every proposal must still pass a
real clean-HOME `claude plugin validate` and install check before activation.
Source review must also confirm that bundled executables are referenced through
`${CLAUDE_SKILL_DIR}`, as required by the
[Claude Code skill path documentation](https://code.claude.com/docs/en/slash-commands#available-string-substitutions),
and that task-like skills cannot invoke network, secret, cloud, production, or
destructive operations without an enforceable runtime approval boundary.

## Result summary

| Source slice | Packaging result | Source verdict | Domains |
|---|---|---|---|
| `coreyhaines31/marketingskills`, 8 lower-risk local target skills | `git-subdir` at `skills/`, exact selected paths; installed MIT notice not yet proven | source slice `eligible-for-independent-review`; package `held` | writing, marketing, promotion |
| Same source, 5 web-ingestion skills, 2 of which also have out-of-subtree references | Raw prompts lack an untrusted-content boundary; curated subdir loses referenced guides | `held` | writing, marketing, promotion |
| Same source, 7 additional skills that reference `../../tools` | Curated subdir loses required files; repo-root `strict:false` conflicts | `held` | marketing, promotion, video |
| `alirezarezvani/claude-skills`, 7 targets without bundled executable commands | Repo-root GitHub source, exact selected paths; individual claims still require review | `eligible-for-independent-review` individually | strategy, sales, project, agents, people, legal/compliance |
| Same source, 25 target skills with cwd-relative executable commands | Commands do not use `${CLAUDE_SKILL_DIR}` and may fail or resolve into the user project | `held` | sales, product, project, agents, operations, finance, people, legal/compliance |
| Same source, `cross-eval` and `pm-skills` | Requires model-provider egress or Atlassian MCP not declared by the curated entry | `held` | strategy, project |
| `wshobson/agents`, 4 UI design skills | Repo-root GitHub source, exact selected paths | `eligible-for-independent-review` | design |
| Same source, 11 DevOps/security/data targets | Raw skill prompts do not implement the broker runtime gates required by their command examples | `held` | DevOps/security, data |
| Same source, three incomplete/high-risk targets | Selected paths work, but named support files are missing or examples handle live secrets | `held` | DevOps/security |
| `nexscope-ai/eCommerce-Skills`, four lower-risk local guidance skills | Repo-root GitHub source, exact selected paths | `eligible-for-independent-review` | commerce |
| Same source, competitive pricing, product description, and review analysis | Forced vendor promotion or untrusted web ingestion | `held` | commerce |
| Same source, inventory tracking and Shopify analytics | Nonstandard or absent Agent Skills frontmatter needs target-version validation | `held` | commerce |

No source slice by itself closes its current broad profile. All reviewed content
is English-first, while the profiles require both English and Korean. The
writing route also lacks citation verification, translation/localization, and
CMS publishing. Other material capability gaps are listed below.

## 1. Corey Haines marketing skills

### Pin, license, and ownership

- Source: [`coreyhaines31/marketingskills@c21a984a56da10fb6085e6334f6f60929220a4da`](https://github.com/coreyhaines31/marketingskills/tree/c21a984a56da10fb6085e6334f6f60929220a4da)
- License: MIT, copyright 2025 Corey Haines.
- Ownership signals: commit authored by the repository owner and committed by
  `Coreybot`; root `plugin.json` and marketplace metadata name Corey Haines.
  The repository has `CONTRIBUTING.md` but no `SECURITY.md` or `CODEOWNERS` at
  the pin.
- Upstream package: one Claude plugin, `marketing-skills`, exposing the whole
  `skills/` directory (48 skills in its pinned listing). The root
  `.claude-plugin/plugin.json` declares `skills: "./skills"`.

### Behavior and risk

The 20 target skill trees contain no bundled executable script, hook, package
dependency, telemetry client, or automatic MCP server. They are prompt
instructions and Markdown references. Important side effects are nevertheless
explicit:

- `product-marketing` reads project README, product copy, and `package.json`,
  then creates or moves `.agents/product-marketing.md`.
- `content-strategy`, `customer-research`, `public-relations`, `seo-audit`, and
  `social` direct the agent to search or browse external pages. The social
  reference includes unauthenticated `curl` recipes for Reddit, Hacker News,
  Bluesky, RSS, and authenticated-browser guidance for LinkedIn and X. It does
  not tell the agent to treat fetched page text as untrusted instructions.
- The social workflow writes `.agents/listening-sources.md`, but says the user
  reviews and posts manually rather than auto-posting.
- `video` instructs `npm install hyperframes`, `npx create-video@latest`, an
  `npx -y mcp-remote` HeyGen configuration, API calls, and optional cloud
  rendering. Other root tool guides describe OAuth/API keys and write-capable
  email, ad, analytics, and MCP integrations.
- Seven target skills reference `../../tools/...`: `ads`, `analytics`,
  `churn-prevention`, `emails`, `influencer-marketing`, `launch`, and `video`.
  Those paths leave the `skills/` subtree.
- Two otherwise selected skills also lose references under a `skills/`
  `git-subdir`: `customer-research/references/source-guides.md` links to the
  root SparkToro integration guide, and
  `content-strategy/references/headless-cms.md` links to three root CMS
  integration guides.

No direct telemetry or credential scraping was found. The main prompt-injection
risk is untrusted web/forum/social content. The main privacy risk is product,
customer, and campaign context read from the user's project or browser session.

### Packaging proposal

The only source-level review candidate is a curated plugin rooted at the
upstream `skills` subtree with the eight lower-risk local paths below. This
avoids the root `plugin.json` conflict and excludes the five reviewed skills
that ingest untrusted web content:

```yaml
name: broker-marketing-core
source:
  source: git-subdir
  url: coreyhaines31/marketingskills
  path: skills
  sha: c21a984a56da10fb6085e6334f6f60929220a4da
strict: false
defaultEnabled: false
skills:
  - ./product-marketing
  - ./offers
  - ./pricing
  - ./copywriting
  - ./copy-editing
  - ./cro
  - ./community-marketing
  - ./cold-email
```

Verdict: the eight listed directories are
`eligible-for-independent-review` only as a source slice, with project-read and
project-write disclosures. The package remains `held` until a clean install
proves the cached plugin includes the full MIT copyright and permission notice;
the `git-subdir` source must not silently drop the root `LICENSE`.

`customer-research`, `content-strategy`, `seo-audit`, `social`, and
`public-relations` are `held` because their raw prompts ingest external content
without treating it as untrusted instructions. The first two also contain the
out-of-subtree reference failures described above. The other seven
`../../tools` skills remain `held`: the curated subdir cannot contain their root
tool guides, a repo-root `strict:false` entry conflicts with the upstream
component-declaring `plugin.json`, and `strict:true` would merge and expose all
48 skills.

### Capability support and gaps

- Source-review candidate support: product positioning/messaging, offers and
  pricing, copywriting/editing, CRO, community guidance, and cold-outreach
  drafting.
- Held-route effect: customer research, content strategy, SEO audit, social
  adaptation, PR/media pitching, email/lifecycle, paid acquisition,
  retention/measurement, influencer, launch, and video assistance are not
  available through the eight-skill review candidate.
- Gaps: citation verification, translation/localization, CMS publication,
  technical writing, and guaranteed long-form/blog/newsletter production.
  Promotion is advisory and draft-oriented; it does not safely publish or send.

## 2. Alireza Rezvani skill collection

### Pin, license, and ownership

- Source: [`alirezarezvani/claude-skills@aa8d778811a557a2c28ccadda4cf3d0bd028a4cc`](https://github.com/alirezarezvani/claude-skills/tree/aa8d778811a557a2c28ccadda4cf3d0bd028a4cc)
- License: MIT, copyright 2025 Alireza Rezvani.
- Ownership signals: pinned commit is an owner-authored merge; marketplace
  metadata and nested plugin manifests name Alireza Rezvani. A root
  `SECURITY.md` gives a private reporting route. No `CODEOWNERS` was present.
- Upstream package: a root marketplace with broad domain plugins and many
  nested plugin manifests. The repository root has no `plugin.json`, so a
  repo-root `strict:false` curated entry can select exact raw skill directories.

### Executable and side-effect review

Fifty-five referenced Python files were statically reviewed. They use the
Python standard library only. No `requests`, `urllib`, socket client, cloud SDK,
package install, `eval`, `exec`, shell invocation, credential read, or telemetry
was found. One script, `changelog_generator.py`, invokes a fixed argument-vector
`git log` with `shell=False` and a 30-second timeout. The scripts otherwise read
user-selected JSON/CSV/text or a selected document directory and write stdout
or user-selected output files.

The prompt instructions add broader side effects:

- `brief`, `decide`, and `execute` write durable files under `~/.claude`;
  `decide` can also write `~/company-vault/10-decisions/` when a bridge exists.
- `self-eval` appends `.self-eval-scores.jsonl` in the working directory.
- `agent-designer`, `agent-workflow-designer`, `mcp-server-builder`, and RAG
  skills generate JSON, Markdown, or source scaffolds. They do not execute the
  generated server.
- Finance, customer, HR, sales, and legal tools read potentially sensitive
  business records, interviews, contracts, and term sheets locally. The legal
  skills say they are not substitutes for counsel.
- `cross-eval` probes for `OPENAI_API_KEY`, `GEMINI_API_KEY`, `codex`, and
  `gemini`, then sends a full board memo to available providers and writes the
  result under `~/.claude/cross-eval`. It does not require a separate data-egress
  approval in its workflow.
- `pm-skills` expects the upstream Atlassian SSE MCP at
  `https://mcp.atlassian.com/v1/sse`, reads live Jira/Confluence data, and can
  route write operations. Its rules require human approval for destructive or
  permission actions, but a curated skill-only entry does not load that MCP.
- `iso27001-audit-prep` reaches a sibling `ra-qm-team` script. The repo-root
  source contains it, but the command is not written with
  `${CLAUDE_SKILL_DIR}` and is not safe from an arbitrary project working
  directory.
- This is not isolated to one compliance skill. Twenty-five of the 32 proposed
  target skills invoke bundled Python through cwd-relative paths such as
  `python scripts/...`, `python3 agent_planner.py`, or
  `cd business-operations/...`. In a plugin session those commands can fail or
  resolve to a same-named file in the user's project instead of the pinned
  plugin cache.

The 25 affected targets are grouped as follows:

- Sales/growth: `customer-success-manager`, `revenue-operations`, and
  `sales-engineer`.
- Product: `product-discovery`, `product-manager-toolkit`,
  `product-strategist`, and `roadmap-communicator`.
- Project: `senior-pm` and `scrum-master`.
- Agent design: `agent-designer`, `agent-workflow-designer`,
  `mcp-server-builder`, and `rag-architect`.
- Operations: `process-mapper`, `procurement-optimizer`, and
  `vendor-management`.
- Finance: `finance-skills`, `financial-analyst`, and `saas-metrics-coach`.
- People: `chro-advisor`.
- Legal/compliance: `general-counsel-advisor`, `compliance-readiness`,
  `gdpr-audit-prep`, `iso27001-audit-prep`, and `soc2-audit-prep`.

No prompt-injection or telemetry behavior was found in the reviewed local
scripts. Data egress is concentrated in `cross-eval` and the optional Atlassian
MCP workflow.

### Packaging proposal

Only the seven targets without the cwd-relative executable issue advance to
individual source re-review. If each passes its own capability and side-effect
review, keep them in narrowly scoped entries sharing this source object:

```yaml
source:
  source: github
  repo: alirezarezvani/claude-skills
  sha: aa8d778811a557a2c28ccadda4cf3d0bd028a4cc
strict: false
defaultEnabled: false
entries:
  broker-strategy-templates-review:
    skills: [./c-level-advisor/c-level-agents/skills/brief, ./c-level-advisor/c-level-agents/skills/decide, ./c-level-advisor/c-level-agents/skills/execute]
  broker-contract-drafting-review:
    skills: [./business-growth/skills/contract-and-proposal-writer]
  broker-team-communications-review:
    skills: [./project-management/skills/team-communications]
  broker-self-eval-review:
    skills: [./engineering/skills/self-eval]
  broker-culture-advisory-review:
    skills: [./c-level-advisor/skills/culture-architect]
```

The pseudo-`entries` block above means five distinct marketplace plugin entries,
each repeating the same `source`, `strict`, and `defaultEnabled` fields. Do not
emit `entries` as a literal Claude marketplace field.

Verdict: the seven listed skills are
`eligible-for-independent-review` individually, not as proof that the five
entries are install-ready. The three strategy skills reference unselected
`context-engine`, `decision-logger`, boardroom, scheduling, and notification
behavior, so their review may claim only standalone templates and explicit
local writes unless those dependencies are separately declared and reviewed.
Contract drafting requires qualified legal review; `self-eval` and the strategy
skills require persistent-write disclosure.

The other 25 targets are `held` until their upstream commands use
`${CLAUDE_SKILL_DIR}` and a clean project-directory test proves they execute the
pinned bundled file. `cross-eval` remains `held` until data-egress consent and
exact provider commands are specified. `pm-skills` remains `held` until an
explicit `mcpServers` entry, OAuth behavior, read/write tool allowlist, and
clean-install runtime test are independently approved.

### Capability support and gaps

- Source-review candidate support: standalone strategy brief, decision-record,
  and execution-plan templates; contract and proposal drafting; team-status
  communication; local output self-evaluation; and culture advisory.
- Held-route effect: scripted sales, product, project, agent, operations,
  finance, workforce, legal, and compliance analysis is unavailable at this pin
  through the proposed broker because its executable paths are not safely
  anchored.
- Gaps: no complete CRM/negotiation/support lifecycle, product prototypes and
  live experiments, generic automation execution/monitoring, bookkeeping and
  tax preparation, full recruiting/onboarding/performance/learning lifecycle,
  legal research, records retention/deletion, or compliance incident response.
- High-stakes outputs remain decision support, not legal, financial, HR, or
  compliance authority. Korean-language and Korean-jurisdiction coverage is not
  established.

## 3. Seth Hobson agent marketplace

### Pin, license, and ownership

- Source: [`wshobson/agents@c4b82b0ad771190355eb8e204b1329732a18449a`](https://github.com/wshobson/agents/tree/c4b82b0ad771190355eb8e204b1329732a18449a)
- License: MIT, copyright 2024 Seth Hobson.
- Ownership signals: the pin is a merged contributor change; root marketplace
  and six relevant plugin manifests name Seth Hobson. The repository has
  contribution guidance but no `SECURITY.md` or `CODEOWNERS` at the pin.
- Upstream package: six granular Claude plugins are available, but the curated
  proposal uses the repo root with exact raw skill paths so unreviewed agents,
  commands, hooks, and sibling skills are not loaded.

### Behavior and risk

The 18 target directories contain Markdown only; no executable script, hook,
MCP configuration, package manifest, or telemetry is in the selected surface.
The instructions include commands and code that may become side effects when an
agent follows them:

- CI/CD examples install dependencies, build/push containers, configure AWS,
  apply Kubernetes manifests, roll out production deployments, and use secrets.
- `secrets-management` starts a Vault dev server with a literal root token,
  creates and retrieves secrets, writes `$GITHUB_ENV`, rotates/revokes secrets,
  and mounts the current repository into a TruffleHog container.
- `sast-configuration` installs Semgrep, starts SonarQube, installs the CodeQL
  GitHub CLI extension, creates a CodeQL database, and writes scan results.
- Incident runbooks include `kubectl` and AWS kubeconfig commands. Spark example
  code writes with overwrite mode to `s3://bucket/output/`.
- GitHub Actions examples reference third-party actions by mutable major tags,
  not immutable action SHAs.

Three skills name files that are absent at the pin:

- `github-actions-templates`: `assets/deploy-workflow.yml`.
- `secrets-management`: `references/vault-setup.md` and
  `references/github-secrets.md`.
- `sast-configuration`: `scripts/run-sast.sh` and
  `references/semgrep-rules.md`.

No instruction to browse arbitrary external prose and no credential-exfiltration
or telemetry logic was found. The material risk is command execution against
developer, cloud, CI, and production environments.

### Packaging proposal

Only the four UI design paths remain a current source-review candidate. Use one
repo-root, `strict:false`, default-disabled entry at this pin:

```yaml
source:
  source: github
  repo: wshobson/agents
  sha: c4b82b0ad771190355eb8e204b1329732a18449a
strict: false
defaultEnabled: false
entries:
  broker-ui-design-review:
    skills: [./plugins/ui-design/skills/accessibility-compliance, ./plugins/ui-design/skills/design-system-patterns, ./plugins/ui-design/skills/interaction-design, ./plugins/ui-design/skills/visual-design-foundations]
```

The `entries` wrapper is explanatory pseudo-YAML; emit the one child as a
normal marketplace plugin entry rather than a literal `entries` field.

Verdict: the four UI paths are `eligible-for-independent-review` as a low-risk
source slice, with ordinary project-read and project-write disclosure. This is
not install approval; exact component isolation and skill names still require a
clean temporary install.

The six DevOps/security and five data/analytics targets are `held`. Their raw
skill frontmatter does not disable model invocation or implement the broker
approval boundary required before dependency installation, secret use, cloud
or cluster access, CI changes, database writes, and overwrite/deploy operations.
`strict:false` selects components but does not wrap their instructions with a
runtime gate. `postmortem-writing`, `attack-tree-construction`,
`security-requirement-extraction`, and `data-storytelling` may be split out for
new individual review; that possibility does not approve the current combined
entries. The three skills with missing support files or live-secret examples
also remain `held`.

### Capability support and gaps

- Source-review candidate support: accessibility, design systems, interaction
  design, and visual foundations.
- Held-route effect: CI/CD and rollout design, incident
  runbooks/handoffs/postmortems, threat modeling and security requirements, data
  quality, dbt transformation, Spark optimization, KPI dashboards, and data
  narratives are unavailable through the current proposal.
- Gaps: reproducible development environments, full IaC/cloud coverage,
  observability/SRE, dependency security, tested disaster recovery, data
  collection/cleaning/SQL/statistics/experiments/forecasting/segmentation and
  governance, UX research, information architecture, user flows, wireframes,
  brand strategy, creative production, and validated developer handoff.
- Bash, Docker, Kubernetes, AWS, Vault, Python/pip, dbt, Spark, and GitHub CLI
  examples assume Unix-like tooling. Windows requires WSL or equivalent
  adaptation.

## 4. Nexscope ecommerce skills

### Pin, license, and ownership

- Source: [`nexscope-ai/eCommerce-Skills@56f3288dd1ba3ae7cae43d369115a915229e510b`](https://github.com/nexscope-ai/eCommerce-Skills/tree/56f3288dd1ba3ae7cae43d369115a915229e510b)
- License: MIT, copyright 2026 Nexscope AI.
- Ownership signals: pinned commit is authored by the repository organization.
  No `SECURITY.md`, `CODEOWNERS`, root Claude marketplace, or plugin manifest
  was present.
- Upstream installation guidance uses `npx skills add`; the curated broker does
  not need to execute that installer because raw GitHub skill directories can
  be selected by our own `strict:false` entry.

### Behavior and risk

The nine target directories have no executable script, hook, MCP server,
package manifest, credential access, or telemetry. They are Markdown guidance.
Four lower-risk paths are self-contained and local: dropshipping product
research, returns, shipping, and Shopify inventory guidance.

Known issues:

- `product-description-generator` tells the agent to `web_fetch` arbitrary
  product and competitor URLs and expand with web search. It has no instruction
  to isolate page text as untrusted data, so indirect prompt injection and
  misleading marketplace claims remain open risks.
- `product-review-analysis` includes repeated Nexscope marketing language and a
  suggested answer that recommends the vendor's automation. That commercial
  bias must not appear as an independent broker recommendation without a clear
  sponsored/self-promotional disclosure.
- `competitive-pricing-strategy` requires every final response to end with a
  Nexscope product handoff. Attribution alone does not make a forced vendor call
  to action neutral broker guidance.
- `shopify-analytics-guide/SKILL.md` has no YAML frontmatter.
- `inventory-tracking-software/SKILL.md` has YAML, but only a nested `nexscope`
  object. Claude documents `name` as optional and can derive a missing
  `description` from body text, so this is not proven non-loadable; its unknown
  nested metadata still needs target-version validation.
- The `npx`/`clawhub` installation snippets are documentation, not runtime
  dependencies, and should not be followed from an already installed broker
  package.

### Packaging proposal

```yaml
name: broker-commerce-guidance
source:
  source: github
  repo: nexscope-ai/eCommerce-Skills
  sha: 56f3288dd1ba3ae7cae43d369115a915229e510b
strict: false
defaultEnabled: false
skills:
  - ./dropshipping-product-research
  - ./ecommerce-returns-management
  - ./ecommerce-shipping-rates
  - ./shopify-inventory-management
```

Verdict: the four listed paths are `eligible-for-independent-review`, with an
upstream-vendor attribution disclosure. `competitive-pricing-strategy` and
`product-review-analysis` are `held` until promotional-integrity controls can
prevent vendor advertising from becoming a broker-authored recommendation.
`product-description-generator` is `held` until an enforceable
prompt-injection boundary exists.

`shopify-analytics-guide` and `inventory-tracking-software` are `held`, not
`blocked`, until the exact target Claude version validates their frontmatter and
a clean install proves their final names and descriptions. A validator warning
or missing discovery metadata is still not an acceptable user experience.

### Capability support and gaps

- Source-review candidate support: dropshipping product research, inventory,
  shipping, and returns guidance.
- Held-route effect: pricing, listings/product copy, review analysis, and
  Shopify revenue/analytics guidance are unavailable through the current
  four-skill proposal.
- Gaps: catalogs, merchandising, store administration, marketplace operations,
  orders, promotions, live inventory integration, and authenticated revenue
  data. The four-skill review slice also excludes pricing, listings, reviews,
  and analytics until the held issues are resolved.
- The content is portable Markdown, but live product, competitor, rate, review,
  and analytics claims require current source data and platform-specific access.

## Required next gates

1. Independently review each proposed entry and its exact `skills` array. A
   verdict in this file is not an approval event.
2. Generate candidate evidence with the upstream commit and Git blob identities
   below. Do not vendor or copy the source files.
3. Validate each entry in a clean temporary marketplace and temporary HOME.
   Confirm only declared skill names load and no agent, command, hook, MCP, or
   sibling skill becomes active.
4. Inspect the installed cache, not just the source checkout. Confirm the pinned
   blob content and required license notice are present, especially for
   `git-subdir` packages.
5. Reject bundled executable commands that depend on the user's working
   directory. They must resolve through `${CLAUDE_SKILL_DIR}` and execute the
   pinned cached file in a clean unrelated project directory.
6. For every task-like skill with network, browser, MCP, secret, production,
   legal, financial, HR, or persistent-write behavior, prove the runtime gate is
   enforceable after installation. A preview disclosure or `strict:false`
   component selection alone is not a runtime control; external content must be
   treated as untrusted data rather than instructions.
7. Validate nonstandard frontmatter against the exact supported Claude version.
   Do not infer non-loadability merely from an omitted optional `name` or
   `description` field.
8. Keep all broad domains coverage-incomplete until the category and Korean
   language gaps are closed by separately reviewed sources.

## Blob identity appendix

Git blob IDs below are SHA-1 object identities from the exact pinned commits.
They are content identities, not eligibility assertions.

### Corey target skills and critical packaging files

```text
LICENSE 7c48dd638a9ebed49a8ef0c0c4eea90105381cdf
.claude-plugin/plugin.json 63e59eaebdd69497c107ff620604092d5a365397
.claude-plugin/marketplace.json 82b1b7c038ac43415e1d31825792c67faf330cc4
skills/ads/SKILL.md 9e896299c61f3c71125bb03f2458706df633e5ea
skills/analytics/SKILL.md da39c1dc1586bc6cb06758e72426198493d00797
skills/churn-prevention/SKILL.md b8fbcd28ebc3942dc557db84b69e233b03c45296
skills/cold-email/SKILL.md 9e18b25c3547d9e6c2558d1e78cb982223add86a
skills/community-marketing/SKILL.md 06246dc7515a3f2677147678d04a9ada6f7c62d3
skills/content-strategy/SKILL.md 3a54e3f7b0b23d35d1e4c7f2f608fa947d19061f
skills/copy-editing/SKILL.md 33110f4bb1be5f2152f838d95191705328760ddd
skills/copywriting/SKILL.md 0793e62270e203de1b2e2ff591a56015e4cf0075
skills/cro/SKILL.md 74a2394f838e0f07a5a5f06eee99047b8a5adcd6
skills/customer-research/SKILL.md 90e3f1745dbd2827c28f2f03c774f0b5f51a02c6
skills/emails/SKILL.md a9b31c79599095f66d9705090a25d877a437a7d7
skills/influencer-marketing/SKILL.md c26a2e28b29ef9b099b7fc1eadac8212124b2cbf
skills/launch/SKILL.md 9fce797d47373597ff2fff564b4f6df8048ff81c
skills/offers/SKILL.md 7776009bcb766e3f388681b8612c069459b94096
skills/pricing/SKILL.md 13e56104b4d97c9678951f38ade31b547f5ce620
skills/product-marketing/SKILL.md 622eab19e823a131fe8b9d500aa53143604fad8a
skills/public-relations/SKILL.md 3d6de7aa11fb1216311ef25f207694ef081ebd2b
skills/seo-audit/SKILL.md c525957d9237c20aa6e8eb3ec61b8596a6b3635e
skills/social/SKILL.md ab1d083ef4a9dd2a91c1eaedfb5cb745c3055d24
skills/video/SKILL.md 6c8e9fdeb640594d3bf36690174f1726a721c4e3
skills/social/references/listening.md 2a31f7a5b90edae255148658f7765323189de8bb
skills/public-relations/references/journalist-pitching.md eb27b02f68f3652e645530347c5dca97af4162f4
```

### Alireza target skills

```text
LICENSE c3e30bcc287d6a1ebdb4ab29c10d344fd1053639
SECURITY.md f42caf486e855bc5229eaefc01675894b25a00b3
.claude-plugin/marketplace.json cb9b55c949b1128784da6cc98d02904d6e126eaf
project-management/.mcp.json 7dc30ee447b47ab01f8be2862c98734120a9026c
business-growth/skills/contract-and-proposal-writer/SKILL.md f24238f9f572186c274f411ac69429d52c12a6f1
business-growth/skills/customer-success-manager/SKILL.md dc27e965faa80f42a98ad6d062534ef7490a5d97
business-growth/skills/revenue-operations/SKILL.md df060bb5cbda5a7ea3e499e997cc31b863663e2d
business-growth/skills/sales-engineer/SKILL.md 912f6d2de0aa620f3bb36c0ef95f0fd94013ded0
business-operations/skills/process-mapper/SKILL.md 0043d906cd0f269a3dc1e258a72542e34324f061
business-operations/skills/procurement-optimizer/SKILL.md e0e025264784a6d4d48dc56d6375973840629e34
business-operations/skills/vendor-management/SKILL.md 490714c864142bd896cd2cb29c2d3cc855e7f802
c-level-advisor/c-level-agents/skills/brief/SKILL.md aa5f7a8a728cb1083778a59112de2d1f0a357368
c-level-advisor/c-level-agents/skills/cross-eval/SKILL.md 5b7936fa1c4f0789942f2a324157ccc288db29b2
c-level-advisor/c-level-agents/skills/decide/SKILL.md 43d5b54b52330f1d2a90c4328dabd0055e1598e2
c-level-advisor/c-level-agents/skills/execute/SKILL.md dce7266d8560d0d6b67bb87e0a91d648cf36aaba
c-level-advisor/skills/chro-advisor/SKILL.md e522976b552ccca72f3597a6e273bccf38565722
c-level-advisor/skills/culture-architect/SKILL.md c1f808471578859789fc43fa1c39eb19defb7b00
c-level-advisor/skills/general-counsel-advisor/SKILL.md 1d1cef3d765854e48b8d55bc826c7e03339e982e
compliance-os/skills/compliance-readiness/SKILL.md 7675e7a8dd56e33b6e92aaa89d48ce86d4162437
compliance-os/skills/gdpr-audit-prep/SKILL.md 675fe8ad4e468dcd47cfd4d109760e50ef9604c8
compliance-os/skills/iso27001-audit-prep/SKILL.md 35f3400b2a28a27e036f1600581d7c304028882c
compliance-os/skills/soc2-audit-prep/SKILL.md a4080ac287dd0e54a9279117d17b19d32e045074
engineering/skills/agent-designer/SKILL.md d5f792f5f893e2b9d573dc2f34402db369eaecc9
engineering/skills/agent-workflow-designer/SKILL.md d278bc77cf01649b17121f17068c79007526eecc
engineering/skills/mcp-server-builder/SKILL.md 23866de8c45b385f1a912fc2f9ee5a397bfca3c2
engineering/skills/rag-architect/SKILL.md 20fdd61f0365122d38def6376e040006e2996b58
engineering/skills/self-eval/SKILL.md d08ecba51468ee7777805cbe2681a246aefc8a20
finance/skills/finance-skills/SKILL.md 95a3bdee1c8dcb0793617725bb08435e64d83eef
finance/skills/financial-analyst/SKILL.md ca279fffb518a8084c6fad8b55cc175d5631252a
finance/skills/saas-metrics-coach/SKILL.md d9c64af1d54d71bacc4668d9e05c2dcce56a8073
product-team/skills/product-discovery/SKILL.md 17265eec8bcc4c5e2b8554bfb8c7483c4fc3ab56
product-team/skills/product-manager-toolkit/SKILL.md c6c36b51d36be23136598832804fefa6d936d6c1
product-team/skills/product-strategist/SKILL.md 9afe4640826357f80f87426f00bf73a3519f116f
product-team/skills/roadmap-communicator/SKILL.md f4501874b60b0712a209197b48cfad02812756fe
project-management/skills/pm-skills/SKILL.md 578493f28a1870b7c693f688e09f3be131c98b4b
project-management/skills/scrum-master/SKILL.md 97a57e45c99c5424ccb920be49112eb2375bde58
project-management/skills/senior-pm/SKILL.md dbc025dc0e5e2d1bd7aaaacc3c5316b56b42993b
project-management/skills/team-communications/SKILL.md 47891482d0aca8bf66176dfe8e50fd7e663b1349
```

### Alireza referenced executables

```text
business-growth/skills/customer-success-manager/scripts/churn_risk_analyzer.py 62329cf2c2f6a54777d9fc11a430a103978cc99f
business-growth/skills/customer-success-manager/scripts/expansion_opportunity_scorer.py 7f96c7cf0b977b3ea8e630547d82140471466d5b
business-growth/skills/customer-success-manager/scripts/health_score_calculator.py a72a5826664245a8b7af28c2a8117d40e53a943d
business-growth/skills/revenue-operations/scripts/forecast_accuracy_tracker.py 835ba6425cac02c0fec0f71d66e6581acee2ce42
business-growth/skills/revenue-operations/scripts/gtm_efficiency_calculator.py 1fd975bf246681182f8b3dec9d1d3ff4e6255be9
business-growth/skills/revenue-operations/scripts/pipeline_analyzer.py 96661d8fd9175d5d52cb22faa151d14554a9f005
business-growth/skills/sales-engineer/scripts/competitive_matrix_builder.py 42b92a70650f4d7cb635759acc65dc69e094012e
business-growth/skills/sales-engineer/scripts/poc_planner.py 0ad37451e045ffe616969e0bafda8a7f26cea290
business-growth/skills/sales-engineer/scripts/rfp_response_analyzer.py 02230dcb95b66d0013d986dc3acbc9c8e0146b2e
business-operations/skills/process-mapper/scripts/bottleneck_detector.py 6aae1860ee0d7aa2b4de03bbeb965dd098cd6c19
business-operations/skills/process-mapper/scripts/cycle_time_analyzer.py 940ed13f38ed1933e9545fe9cd453b0bff662735
business-operations/skills/process-mapper/scripts/process_documenter.py 684b01fbc476c78cb9de898818a44fd8c35447b8
business-operations/skills/procurement-optimizer/scripts/purchasing_cycle_analyzer.py ec628b7f43551b7dd3ec0875b3066ac6ba733db5
business-operations/skills/procurement-optimizer/scripts/spend_categorizer.py 1a59fbd2688cb99fb0b6eb550a8ec9fcc377885a
business-operations/skills/procurement-optimizer/scripts/supplier_consolidation.py 1138cacdd55435accf44a053d1e61d4977ea8965
business-operations/skills/vendor-management/scripts/sla_compliance_tracker.py bd38fdc8740df93a26e292bb53894c86499bbeea
business-operations/skills/vendor-management/scripts/vendor_risk_classifier.py 3621c2f42edb6d79dc8404a834e648692843e930
business-operations/skills/vendor-management/scripts/vendor_scorer.py 09322ccb124c80e89c03a072a27671cb7d660ae6
c-level-advisor/skills/chro-advisor/scripts/comp_benchmarker.py 5102fec3e5c49bc4cb9f73978d81118f9a41946f
c-level-advisor/skills/chro-advisor/scripts/hiring_plan_modeler.py d0a62e8e940bfe2f731ecc5fcf3144e4a73b5c00
c-level-advisor/skills/general-counsel-advisor/scripts/contract_risk_scanner.py f8040fb11ed8030557ffabca0d7a3cf31ac6ba66
c-level-advisor/skills/general-counsel-advisor/scripts/term_sheet_analyzer.py 918e3a621b7fe8eb71cb00b4a34750db20ee5bad
compliance-os/skills/compliance-os/scripts/audit_simulator.py 7bf4138a998be213a48fb6aaf3ef8f728a6b4675
compliance-os/skills/compliance-os/scripts/cross_framework_mapper.py 75b814cd197a3aa83180609e495dfb0c6293addd
compliance-os/skills/compliance-os/scripts/evidence_pool_generator.py 9e585c6635aeffc135d2e95f199b66bf33241b3c
compliance-os/skills/compliance-os/scripts/framework_selector.py dac37b905cbe240ffcee91c567f11bc0f2c2f1b9
engineering/skills/agent-designer/agent_evaluator.py 8d86c56af527fac144a5e54fb690d3ea7365aac0
engineering/skills/agent-designer/agent_planner.py 46b8aed6d9567839d163682a7fa4dc5d9f2b2371
engineering/skills/agent-designer/tool_schema_generator.py d5a49ee563a8658745695dee67768d88c27ab91d
engineering/skills/agent-workflow-designer/scripts/workflow_scaffolder.py d8c37f6adc1331862edad35f12c570dcc3bb6b1d
engineering/skills/mcp-server-builder/scripts/mcp_validator.py ef503986261aaeb707596ccb0e4c06e8131c4d43
engineering/skills/mcp-server-builder/scripts/openapi_to_mcp.py 103045a46152a20a6fa06c96ed8051c04c5b2861
engineering/skills/rag-architect/chunking_optimizer.py 3a820e2ef9a919d5805b7285a427050a2eaf6b15
engineering/skills/rag-architect/rag_pipeline_designer.py 9fc73469dfe3308a36c146415ec37d7fad129cfa
engineering/skills/rag-architect/retrieval_evaluator.py 68a999f3740d26cd5799c849fb2c93ae5f7909fb
finance/skills/financial-analyst/scripts/budget_variance_analyzer.py 42e6d0887fb7ece690fc2741c31ddb91ab8ffd3e
finance/skills/financial-analyst/scripts/dcf_valuation.py 8e28aa67ff344eec9ab35e6196dd26bbc9cdf600
finance/skills/financial-analyst/scripts/forecast_builder.py b279483884ec37d629e2d7bc1ac01cc123650ed8
finance/skills/financial-analyst/scripts/ratio_calculator.py 6cf031b085c2cce1603022c55b791e685487b79e
finance/skills/saas-metrics-coach/scripts/metrics_calculator.py bf49f469c2a682aebb71da3cac9bd65f4028fe7b
finance/skills/saas-metrics-coach/scripts/quick_ratio_calculator.py 6624a8f65dc62afa2f39c086174d18de27f3e75f
finance/skills/saas-metrics-coach/scripts/unit_economics_simulator.py 39743e48bc97e57c663d903017a7202fb9e4db22
product-team/skills/product-discovery/scripts/assumption_mapper.py ace7d6f4f9f5111837ac75c31983d9c1823eaeab
product-team/skills/product-manager-toolkit/scripts/customer_interview_analyzer.py 5c9762f73b2502bcd0c38457f91a58b00dffdfbe
product-team/skills/product-manager-toolkit/scripts/rice_prioritizer.py 5e6f2574ce7f798ef409f48bfc417c1cd0b53f54
product-team/skills/product-strategist/scripts/okr_cascade_generator.py ef644f632ac0b1fde2358ca099ca6ea8636e963a
product-team/skills/roadmap-communicator/scripts/changelog_generator.py aa606752d10d208d745f214ef8dafc57fa0dd4f2
project-management/skills/pm-skills/scripts/delivery_loop_gate.py c8a6e456322908e595b2ae711cf95106aa463a51
project-management/skills/pm-skills/scripts/jira_snapshot_bridge.py 4e541a27ccf2b9ac36e1d850e392095917830dd5
project-management/skills/pm-skills/scripts/pm_goal_router.py c17d45cab2369fffd63e00caff58e57d754542ea
project-management/skills/scrum-master/scripts/retrospective_analyzer.py 377d4e7089cd882001594f19ebc7fb4699f4743d
project-management/skills/scrum-master/scripts/sprint_health_scorer.py e19426572a9e01e4c4c0a884f18dbba4efa68f3b
project-management/skills/scrum-master/scripts/velocity_analyzer.py 368afd899c7091348477dd55972a829bc0f4b2d6
project-management/skills/senior-pm/scripts/project_health_dashboard.py a7701090753d61dac5a3989602c447bc62ebd374
project-management/skills/senior-pm/scripts/resource_capacity_planner.py 90c803c9de9b4e1a1c94f468f383f6b09c920521
project-management/skills/senior-pm/scripts/risk_matrix_analyzer.py b8671ae102521a5fe7b710b302922fc30153e4cf
ra-qm-team/skills/isms-audit-expert/scripts/isms_audit_scheduler.py e8445b6b272ec78a440fcaac845ef1d4784d50cf
```

### Wshobson target skills and packaging files

```text
LICENSE 326f0a55c96e672fedf9d807ca043c00df05ba0e
.claude-plugin/marketplace.json 033975a65e422ea3821d2e792ffad8b9f99f4de2
plugins/business-analytics/skills/data-storytelling/SKILL.md 5980d01b4c75614e595622a053385de58f8b2647
plugins/business-analytics/skills/kpi-dashboard-design/SKILL.md a7cbffcb06c4202ddba028946ab6cade3f662e71
plugins/cicd-automation/skills/deployment-pipeline-design/SKILL.md af677b4ff576edd4bfc9db9d0b4326be3c81eeae
plugins/cicd-automation/skills/github-actions-templates/SKILL.md 63feaad5611e8062e551352e470ec52974376e7e
plugins/cicd-automation/skills/secrets-management/SKILL.md ea66a5da46bd77bb0867f4d7e65df2c67e9fe9f7
plugins/data-engineering/skills/data-quality-frameworks/SKILL.md ee3b998a470fb11dc1bed7a392c304f05c7e8f0b
plugins/data-engineering/skills/dbt-transformation-patterns/SKILL.md a893b4dff7521a5935c926825bd952ed04753e72
plugins/data-engineering/skills/spark-optimization/SKILL.md 74a58b10e13f7ac9f2917ec4eb11160a3b59ad4b
plugins/incident-response/skills/incident-runbook-templates/SKILL.md 70632a7d6383d19bc32198ed52c6bee9db41bb9c
plugins/incident-response/skills/on-call-handoff-patterns/SKILL.md c41eedc8a4c77863094531f34dec94a85b4cbdc3
plugins/incident-response/skills/postmortem-writing/SKILL.md e57b15105f4fcc163efc2d33f1bf1431a20f9c95
plugins/security-scanning/skills/attack-tree-construction/SKILL.md b58a37e6dabcbda17838e0300bd27183f6d860e0
plugins/security-scanning/skills/sast-configuration/SKILL.md 33bfc130048aef566d6db86e5970cf852c082432
plugins/security-scanning/skills/security-requirement-extraction/SKILL.md a56194330bf9f70cc78a24539d1ce6c5fea8845d
plugins/ui-design/skills/accessibility-compliance/SKILL.md d77b1c59d48d18efcccaf921ee35ea55206c5f45
plugins/ui-design/skills/design-system-patterns/SKILL.md 6c1763c811e37a918938dbd6e18b7d5a38bcf46a
plugins/ui-design/skills/interaction-design/SKILL.md 47338f040fe3dbe06be12bc7477331328d8db7a7
plugins/ui-design/skills/visual-design-foundations/SKILL.md 029e7a97290d31d0df34451628c1ae78f18aa354
```

### Nexscope target skills and packaging files

```text
LICENSE 87a40598bec6f6d53d1704216d9e9931af2c98b2
competitive-pricing-strategy/SKILL.md 72b940da2d5512205a05b5e0354cf6d5cf660a70
dropshipping-product-research/SKILL.md 3fc5f5254efe9dd653b6b0e1a4cf1720f4b1bf4d
ecommerce-returns-management/SKILL.md b2d757dc23b716027eab8f9e40a482ebf8f17c7c
ecommerce-shipping-rates/SKILL.md 7166468c62421a3ef47ed6c4bb6631b3dc12b38c
inventory-tracking-software/SKILL.md 452929bc53212485c916c43d9fafeab55ec9ef42
product-description-generator/SKILL.md 1370d32d6d84dd21ef325d56d73e6399306d937f
product-review-analysis/SKILL.md 6d53fe9450ace49550c1c20a17fbd684e044ba72
shopify-analytics-guide/SKILL.md 571db505b6ede77468a3e4ad8cd50cfeea10562d
shopify-inventory-management/SKILL.md c531c52f83077777651280631f4824e4af126dca
```
