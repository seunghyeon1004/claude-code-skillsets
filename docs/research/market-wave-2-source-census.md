# Market Wave 2 Source Census

Status: source-level market research only. This census does not approve, install,
enable, mirror, or publish any candidate.

Audit date: 2026-07-30 (Asia/Seoul)

## Decision boundary

`Verified source` means that the repository identity, observed revision, relevant
paths, license signal, packaging metadata, and obvious static risk surface were
inspected. It does **not** mean trusted, safe, approved, installable, enabled,
compatible, Korean-ready, or sufficient for a broad domain profile.

The exact revisions below were the repository HEADs observed on the audit date.
That observation is time-specific: a repository HEAD can move after this report.
The recorded full commit SHA is immutable, but any future proposal must refresh
the upstream state and deliberately select a pin rather than assume that the
observed HEAD is still current.

```yaml
auditDate: 2026-07-30
headObservationIsTimeSpecific: true
verifiedSourceCount: 13
approvalOrInstallEligible: []
currentBroadProfileImmediatelyClaimable: []
```

This report extends the route inventory in
[`remaining-18-routes.md`](remaining-18-routes.md) and uses the same source-level
boundary as [`external-route-source-audit.md`](external-route-source-audit.md).
The repositories here are leads for subsequent independent review, not entries
for the approval ledger or install index.

## Method and non-execution boundary

Discovery used web search and repository indexes, then every retained claim was
checked against the original GitHub repository. Read-only GitHub repository,
commit, recursive-tree, and content APIs were used to inspect exact blobs.
Aggregators, stars, README marketing, or a marketplace listing alone were not
treated as evidence of source safety or capability completeness.

Static review covered:

- Exact commit identity, relevant `SKILL.md` paths, referenced executables, root
  and per-skill license material, and Claude plugin/marketplace manifests.
- Shell and package-manager commands, network and API use, credentials, media or
  data upload, persistent writes, MCP dependencies, relative paths, and external
  content that could carry prompt injection.
- Direct support for the repository's 20 broad domains and explicit Korean
  behavior. General multilingual wording was not counted as a verified Korean
  contract.

Nothing from a candidate repository was executed. No repository was installed,
no dependency or plugin was added, no marketplace state was changed, no
candidate script was run, no candidate API credential was used, no media was
uploaded, and no remote state was written.

## Claude packaging evidence

Claude's current marketplace documentation permits a `git-subdir` source with
`url`, `path`, and a full `sha`; it also permits `defaultEnabled: false`, which
installs a plugin disabled until the user opts in. These are useful future
controls, but neither control replaces source review or runtime approval:

- [Git subdirectories and full-SHA pins](https://code.claude.com/docs/en/plugin-marketplaces#git-subdirectories)
- [Optional plugin fields and `defaultEnabled`](https://code.claude.com/docs/en/plugin-marketplaces#optional-plugin-fields)
- [Strict-mode behavior](https://code.claude.com/docs/en/plugin-marketplaces#strict-mode)
- [Plugin marketplace overview](https://code.claude.com/docs/en/plugin-marketplaces)

The same documentation notes that plugins are copied into a cache, so relative
references outside the selected plugin directory are not automatically present.
Consequently, a discoverable path is not yet a valid package. Every proposed
slice still needs an independently reproduced clean-cache validation at its
chosen exact SHA.

## Census summary

| Original source | Observed exact HEAD | License finding | Packaging finding | Candidate status |
|---|---|---|---|---|
| [`microsoft/skills`](https://github.com/microsoft/skills) | [`4a2873faffc1b101a33a0b59c24713d4ed78142f`](https://github.com/microsoft/skills/commit/4a2873faffc1b101a33a0b59c24713d4ed78142f) | MIT | Marketplace plus nested plugin; version mismatch needs validation | Next independent source review: Deep Wiki only |
| [`anthropics/skills`](https://github.com/anthropics/skills) | [`b29e7cf65e5cb78a5ac33d582270551bc74a14eb`](https://github.com/anthropics/skills/commit/b29e7cf65e5cb78a5ac33d582270551bc74a14eb) | Proprietary per-skill terms; `doc-coauthoring` license unclear | Official marketplace, `strict: false` | Official link-only; never mirror or repackage from this census |
| [`kepano/obsidian-skills`](https://github.com/kepano/obsidian-skills) | [`a1dc48e68138490d522c04cbf5822214c6eb1202`](https://github.com/kepano/obsidian-skills/commit/a1dc48e68138490d522c04cbf5822214c6eb1202) | MIT | Marketplace plus plugin manifest | Next independent source review: three local-format skills only |
| [`daymade/claude-code-skills`](https://github.com/daymade/claude-code-skills) | [`df616433d9e297f0a980df251505acc07290e8a4`](https://github.com/daymade/claude-code-skills/commit/df616433d9e297f0a980df251505acc07290e8a4) | MIT | Marketplace suites, `strict: false`; no nested plugin manifest found | Conditional |
| [`higgsfield-ai/skills`](https://github.com/higgsfield-ai/skills) | [`91051d3f260ae0792708c5eb0a87b07122ad3830`](https://github.com/higgsfield-ai/skills/commit/91051d3f260ae0792708c5eb0a87b07122ad3830) | MIT | Marketplace plus one plugin bundling seven skills | Conditional; paid/auth/upload gate required |
| [`runwayml/skills`](https://github.com/runwayml/skills) | [`16353db3500ea5e346460755205991081567902a`](https://github.com/runwayml/skills/commit/16353db3500ea5e346460755205991081567902a) | MIT | Plugin manifest; no author-owned marketplace manifest found | Conditional; paid/auth/upload gate required |
| [`elevenlabs/skills`](https://github.com/elevenlabs/skills) | [`37c0f2a682a8953cb9f09b152a0e1624d234193e`](https://github.com/elevenlabs/skills/commit/37c0f2a682a8953cb9f09b152a0e1624d234193e) | MIT | Agent Skills repository; no Claude manifest found | Conditional; paid/auth/upload gate required |
| [`remotion-dev/claude-code-plugin`](https://github.com/remotion-dev/claude-code-plugin) | [`9a40b40c96ed3f429adf56100dc83840046e2467`](https://github.com/remotion-dev/claude-code-plugin/commit/9a40b40c96ed3f429adf56100dc83840046e2467) | Manifest says MIT; no license file found at pin | Marketplace plus plugin manifest | Conditional; resolve installed notice/provenance first |
| [`trailofbits/skills`](https://github.com/trailofbits/skills) | [`ca08fc8a91f64d80b00d48597907c579d0a85c6f`](https://github.com/trailofbits/skills/commit/ca08fc8a91f64d80b00d48597907c579d0a85c6f) | CC-BY-SA-4.0 | Root marketplace plus per-plugin manifests | Next independent source review: `insecure-defaults` only |
| [`huggingface/skills`](https://github.com/huggingface/skills) | [`87f9ee5b670a630b022809a8742606c6da21812c`](https://github.com/huggingface/skills/commit/87f9ee5b670a630b022809a8742606c6da21812c) | Apache-2.0 | Marketplace exposes `hf-cli`; other reviewed skills are not listed plugins | Conditional; split read-only from write/upload behavior |
| [`K-Dense-AI/scientific-agent-skills`](https://github.com/K-Dense-AI/scientific-agent-skills) | [`ab2f84ab10597c59fac186ecda6d5edd5dcc8b92`](https://github.com/K-Dense-AI/scientific-agent-skills/commit/ab2f84ab10597c59fac186ecda6d5edd5dcc8b92) | MIT | No Claude marketplace or plugin manifest found | Next independent source review: four statistical skills |
| [`OneWave-AI/claude-skills`](https://github.com/OneWave-AI/claude-skills) | [`27f8cdcea225e627a73de89b9a3d477af9e249da`](https://github.com/OneWave-AI/claude-skills/commit/27f8cdcea225e627a73de89b9a3d477af9e249da) | MIT | No Claude marketplace or plugin manifest found | Next independent source review: four local workflow skills |
| [`deanpeters/Product-Manager-Skills`](https://github.com/deanpeters/Product-Manager-Skills) | [`99710188c134acf590a02c0e4ee1f431e60004cf`](https://github.com/deanpeters/Product-Manager-Skills/commit/99710188c134acf590a02c0e4ee1f431e60004cf) | CC-BY-NC-SA-4.0 | Marketplace plus plugin; 70 individual `strict: false` entries | Conditional; license policy and path defects unresolved |

Approval/install eligible from this table: **none**. `Next independent source
review` is a research priority, not an approval verdict.

## Verified source records

### 1. Microsoft Skills

- **Pin and license:** [`4a2873f...`](https://github.com/microsoft/skills/tree/4a2873faffc1b101a33a0b59c24713d4ed78142f), root MIT license.
- **Relevant paths:** `wiki-architect`, `wiki-researcher`, `wiki-page-writer`,
  and `wiki-qa` under
  [`.github/plugins/deep-wiki/skills/`](https://github.com/microsoft/skills/tree/4a2873faffc1b101a33a0b59c24713d4ed78142f/.github/plugins/deep-wiki/skills).
- **Manifest:** root
  [marketplace](https://github.com/microsoft/skills/blob/4a2873faffc1b101a33a0b59c24713d4ed78142f/.claude-plugin/marketplace.json)
  plus nested Deep Wiki
  [plugin manifest](https://github.com/microsoft/skills/blob/4a2873faffc1b101a33a0b59c24713d4ed78142f/.github/plugins/deep-wiki/.claude-plugin/plugin.json).
  The marketplace entry reports `1.0.0` while the nested plugin reports `2.0.0`.
- **Risk surface:** local Git inspection and Bash/read/write workflows. No
  intrinsic MCP, credential, or network requirement was found in the reviewed
  slice, but source material still lacks an explicit untrusted-content boundary.
- **Korean signal:** `wiki-qa` instructs same-language responses after language
  detection; the other three skills make no explicit Korean commitment.
- **Direct support and status:** codebase wiki architecture, research, writing,
  and grounded Q&A support `documents-and-knowledge`, `software-engineering`, and
  onboarding. Deep Wiki only is a **next independent source-review candidate**.

### 2. Anthropic Skills

- **Pin and license:** [`b29e7cf...`](https://github.com/anthropics/skills/tree/b29e7cf65e5cb78a5ac33d582270551bc74a14eb).
  `docx`, `pdf`, `pptx`, and `xlsx` each carry proprietary all-rights terms in
  their own `LICENSE.txt`; no corresponding license was found for
  `doc-coauthoring`. There is no root license that makes the set redistributable.
- **Relevant paths:** [`skills/xlsx`](https://github.com/anthropics/skills/tree/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/skills/xlsx),
  [`docx`](https://github.com/anthropics/skills/tree/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/skills/docx),
  [`pptx`](https://github.com/anthropics/skills/tree/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/skills/pptx),
  [`pdf`](https://github.com/anthropics/skills/tree/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/skills/pdf), and
  [`doc-coauthoring`](https://github.com/anthropics/skills/tree/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/skills/doc-coauthoring).
- **Manifest:** official
  [marketplace](https://github.com/anthropics/skills/blob/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/.claude-plugin/marketplace.json)
  groups document and example skills with `strict: false`.
- **Risk surface:** bundled document scripts and dependencies execute and write
  user files; some instructions are relative-path dependent. No core MCP or
  credential requirement was found in this slice.
- **Korean signal:** no explicit Korean behavior was found.
- **Direct support and status:** strong Office document and coauthoring coverage,
  but redistribution rights are not established. Treat as **official link-only**,
  not a source to mirror, curate, or install from this report.

### 3. Obsidian Skills

- **Pin and license:** [`a1dc48e...`](https://github.com/kepano/obsidian-skills/tree/a1dc48e68138490d522c04cbf5822214c6eb1202), MIT.
- **Relevant paths:** [`obsidian-markdown`](https://github.com/kepano/obsidian-skills/tree/a1dc48e68138490d522c04cbf5822214c6eb1202/skills/obsidian-markdown),
  [`obsidian-bases`](https://github.com/kepano/obsidian-skills/tree/a1dc48e68138490d522c04cbf5822214c6eb1202/skills/obsidian-bases),
  [`json-canvas`](https://github.com/kepano/obsidian-skills/tree/a1dc48e68138490d522c04cbf5822214c6eb1202/skills/json-canvas),
  [`obsidian-cli`](https://github.com/kepano/obsidian-skills/tree/a1dc48e68138490d522c04cbf5822214c6eb1202/skills/obsidian-cli), and
  [`defuddle`](https://github.com/kepano/obsidian-skills/tree/a1dc48e68138490d522c04cbf5822214c6eb1202/skills/defuddle).
- **Manifest:** root marketplace and plugin manifests are both present.
- **Risk surface:** the three format skills are mostly local-file guidance.
  `obsidian-cli` can mutate a vault and invoke `obsidian eval`; `defuddle`
  installs an npm CLI and fetches arbitrary pages without an explicit prompt-
  injection boundary.
- **Korean signal:** no explicit Korean contract; the core formats are generally
  language-agnostic.
- **Direct support and status:** markdown, bases, and canvas support
  `documents-and-knowledge`. Those three are **next independent source-review
  candidates**; CLI and Defuddle remain held separately.

### 4. Daymade Claude Code Skills

- **Pin and license:** [`df61643...`](https://github.com/daymade/claude-code-skills/tree/df616433d9e297f0a980df251505acc07290e8a4), MIT.
- **Relevant paths:** `daymade-docs/doc-to-markdown`,
  `daymade-docs/pdf-creator`, `daymade-audio/asr-transcribe-to-text`,
  `daymade-audio/transcript-fixer`, and `daymade-audio/meeting-minutes-taker`
  in the [repository tree](https://github.com/daymade/claude-code-skills/tree/df616433d9e297f0a980df251505acc07290e8a4).
- **Manifest:** the root marketplace declares `daymade-docs` and
  `daymade-audio` suites with `strict: false`; no nested plugin manifest was
  found.
- **Risk surface:** bundled relative `scripts/`, uv/pip and other tools, file
  writes, possible local or external ASR/API paths, and subagent output. The
  transcript pipeline lacks an explicit untrusted-content boundary.
- **Korean signal:** ASR maps `korean` to `ko`; document guidance mentions CJK
  rendering and Hangul domains.
- **Direct support and status:** document conversion/generation, ASR,
  transcript repair, and meeting minutes. **Conditional** pending package-path,
  dependency, external-service, and transcript-ingestion review.

### 5. Higgsfield Skills

- **Pin and license:** [`91051d3...`](https://github.com/higgsfield-ai/skills/tree/91051d3f260ae0792708c5eb0a87b07122ad3830), MIT.
- **Relevant paths:** [`higgsfield-generate`](https://github.com/higgsfield-ai/skills/tree/91051d3f260ae0792708c5eb0a87b07122ad3830/higgsfield-generate),
  `higgsfield-video-explainer`, `higgsfield-product-photoshoot`, and
  `higgsfield-marketplace-cards` at the same repository root.
- **Manifest:** root marketplace and plugin manifests; plugin version `0.12.0`
  bundles seven skills rather than exposing only the four reviewed here.
- **Risk surface:** curl-to-shell bootstrap, CLI authentication, paid credits,
  media upload, external jobs, and output downloads. Source documents and web
  research lack an explicit prompt-injection boundary.
- **Korean signal:** response and narration language can be selected, but the
  reviewed API/voice contract does not explicitly verify Korean support.
- **Direct support and status:** video generation/explainers, audio, product
  imagery, and marketplace cards support media, marketing, design, and commerce.
  **Conditional** on separate paid-service, authentication, upload, and bundle
  approval; not suitable for automatic generic installation.

### 6. Runway Skills

- **Pin and license:** [`16353db...`](https://github.com/runwayml/skills/tree/16353db3500ea5e346460755205991081567902a), MIT.
- **Relevant paths:** `skills/rw-generate-video`, `rw-generate-audio`,
  `rw-integrate-video`, and `rw-integrate-audio` in the
  [skills tree](https://github.com/runwayml/skills/tree/16353db3500ea5e346460755205991081567902a/skills).
- **Manifest:** plugin manifest present; no author-owned marketplace manifest
  was found. The README points to an Anthropic community marketplace or an
  `npx skills` path, neither of which is source approval evidence.
- **Risk surface:** `RUNWAYML_API_SECRET`, prepaid credits, media uploads and
  downloads, API polling, network access, and cwd-relative `uv run scripts/...`.
- **Korean signal:** no explicit Korean contract was found.
- **Direct support and status:** Runway media generation/integration supports
  `video-and-audio`. **Conditional** on paid/auth/upload approval and clean-cache
  script-path validation.

### 7. ElevenLabs Skills

- **Pin and license:** [`37c0f2a...`](https://github.com/elevenlabs/skills/tree/37c0f2a682a8953cb9f09b152a0e1624d234193e), MIT.
- **Relevant paths:** `speech-to-text`, `text-to-speech`, `voice-isolator`,
  `voice-changer`, `sound-effects`, and `music` in the
  [repository tree](https://github.com/elevenlabs/skills/tree/37c0f2a682a8953cb9f09b152a0e1624d234193e).
- **Manifest:** Agent Skills repository; no Claude marketplace or plugin
  manifest was found.
- **Risk surface:** `ELEVENLABS_API_KEY`, paid network calls, user-audio upload,
  and generated-audio download. Downstream use of audio or transcripts needs an
  untrusted-content boundary.
- **Korean signal:** the STT reference lists `kor`; voice-changer explicitly
  lists Korean.
- **Direct support and status:** STT, TTS, voice isolation/change, sound effects,
  and music support `video-and-audio`. **Conditional** on package construction
  and separate paid/auth/media-data approval.

### 8. Remotion Claude Code Plugin

- **Pin and license:** [`9a40b40...`](https://github.com/remotion-dev/claude-code-plugin/tree/9a40b40c96ed3f429adf56100dc83840046e2467).
  The manifest declares MIT, but no license file was found in this repository at
  the pin. The main Remotion repository uses different terms, so the installed
  notice and provenance must be independently resolved.
- **Relevant paths:** `skills/remotion-markup`, `remotion-render`,
  `remotion-captions`, and `remotion-multimedia` in the
  [skills tree](https://github.com/remotion-dev/claude-code-plugin/tree/9a40b40c96ed3f429adf56100dc83840046e2467/skills).
- **Manifest:** root marketplace and plugin manifests are present.
- **Risk surface:** npx/bun/yarn/pnpm dependency changes, rendering and FFmpeg,
  remote media/docs, and optional AWS, ElevenLabs, Mapbox, or MapTiler secrets.
  External media has no explicit prompt-injection boundary.
- **Korean signal:** no explicit Korean contract was found.
- **Direct support and status:** programmatic video editing, rendering,
  captions, and audio integration support `video-and-audio`. **Conditional** on
  license/provenance resolution before runtime review.

### 9. Trail of Bits Skills

- **Pin and license:** [`ca08fc8...`](https://github.com/trailofbits/skills/tree/ca08fc8a91f64d80b00d48597907c579d0a85c6f), CC-BY-SA-4.0.
- **Relevant paths:** plugin skills
  [`insecure-defaults`](https://github.com/trailofbits/skills/tree/ca08fc8a91f64d80b00d48597907c579d0a85c6f/plugins/insecure-defaults),
  [`supply-chain-risk-auditor`](https://github.com/trailofbits/skills/tree/ca08fc8a91f64d80b00d48597907c579d0a85c6f/plugins/supply-chain-risk-auditor), and
  [`devcontainer-setup`](https://github.com/trailofbits/skills/tree/ca08fc8a91f64d80b00d48597907c579d0a85c6f/plugins/devcontainer-setup).
- **Manifest:** root marketplace and per-plugin manifests are present.
- **Risk surface:** `insecure-defaults` is static read/grep/glob/Bash review.
  Supply-chain review calls `gh`, reads external project metadata, and writes a
  report without an explicit prompt-injection boundary. Devcontainer setup
  writes configuration, installs packages, forwards `CLAUDE_CODE_OAUTH_TOKEN`
  or `ANTHROPIC_API_KEY`, and grants Docker/network capability.
- **Korean signal:** none found.
- **Direct support and status:** insecure-default detection supports
  `devops-and-security` and is a **next independent source-review candidate**.
  The supply-chain and devcontainer plugins remain conditional/held.

### 10. Hugging Face Skills

- **Pin and license:** [`87f9ee5...`](https://github.com/huggingface/skills/tree/87f9ee5b670a630b022809a8742606c6da21812c), Apache-2.0.
- **Relevant paths:** `skills/huggingface-best`, `huggingface-datasets`,
  `huggingface-papers`, and `hf-mem` in the
  [skills tree](https://github.com/huggingface/skills/tree/87f9ee5b670a630b022809a8742606c6da21812c/skills).
- **Manifest:** marketplace and plugin manifests exist, but the current
  marketplace exposes only `hf-cli`; the other reviewed repository skills are
  not standalone Claude marketplace entries.
- **Risk surface:** HF token use, network APIs, model/dataset uploads, and cloud
  jobs. `huggingface-datasets` calls itself read-only in its description while
  its body includes create/upload flows. External dataset, model, and paper
  content lacks an explicit prompt-injection boundary.
- **Korean signal:** none found.
- **Direct support and status:** model selection, dataset exploration, paper
  lookup, and memory estimation support research, agents, and data. **Conditional**
  until read-only lookup is separated from write/upload behavior.

### 11. K-Dense Scientific Agent Skills

- **Pin and license:** [`ab2f84a...`](https://github.com/K-Dense-AI/scientific-agent-skills/tree/ab2f84ab10597c59fac186ecda6d5edd5dcc8b92), MIT.
- **Relevant paths:** `skills/statistical-analysis`, `statistical-power`,
  `experimental-design`, and `exploratory-data-analysis` in the
  [skills tree](https://github.com/K-Dense-AI/scientific-agent-skills/tree/ab2f84ab10597c59fac186ecda6d5edd5dcc8b92/skills).
- **Manifest:** no Claude marketplace or plugin manifest was found.
- **Risk surface:** uv/pip dependencies, bundled Python, and write/edit/Bash.
  Examples use skill-relative scripts without `${CLAUDE_SKILL_DIR}`, so packaged
  resolution and dependency behavior require clean-cache validation. The
  selected slice is local-data oriented and showed no credential/MCP need.
- **Korean signal:** none found.
- **Direct support and status:** statistics, power analysis, experimental design,
  and EDA support `research-and-intelligence` and `data-and-analytics`. All four
  are **next independent source-review candidates**, not install candidates.

### 12. OneWave Claude Skills

- **Pin and license:** [`27f8cdc...`](https://github.com/OneWave-AI/claude-skills/tree/27f8cdcea225e627a73de89b9a3d477af9e249da), MIT.
- **Relevant paths:** `cowork-sop-writer`, `cash-flow-forecaster`,
  `hiring-scorecard`, and `meeting-to-tasks` in the
  [repository tree](https://github.com/OneWave-AI/claude-skills/tree/27f8cdcea225e627a73de89b9a3d477af9e249da).
  `client-proposal-generator` is a separate conditional lead because it adds
  web-research risk.
- **Manifest:** no Claude marketplace or plugin manifest was found.
- **Risk surface:** file read/write and some Bash/WebSearch; nonstandard `tools:`
  frontmatter must not be assumed to enforce permission policy. Transcript and
  web content lack an explicit untrusted-content boundary, and finance/people
  inputs are sensitive. High-stakes `contract-analyzer` and
  `compliance-checker` are outside the recommended slice.
- **Korean signal:** meeting guidance says multilingual generally but makes no
  explicit Korean contract.
- **Direct support and status:** SOPs, cash-flow forecasts, hiring scorecards,
  and meeting task extraction support operations, finance, people, and project
  work. The four local workflows are **next independent source-review
  candidates** individually; no suite is approved.

### 13. Product Manager Skills

- **Pin and license:** [`9971018...`](https://github.com/deanpeters/Product-Manager-Skills/tree/99710188c134acf590a02c0e4ee1f431e60004cf), CC-BY-NC-SA-4.0.
- **Relevant paths:** lower-risk examples include `skills/problem-statement`,
  `finance-metrics-quickref`, and `saas-economics-efficiency-metrics` in the
  [skills tree](https://github.com/deanpeters/Product-Manager-Skills/tree/99710188c134acf590a02c0e4ee1f431e60004cf/skills).
  `prd-development`, `roadmap-planning`, and `prioritization-advisor` reference
  sibling `../workshop-facilitation/SKILL.md`; `user-story` runs cwd-relative
  `python3 scripts/user-story-template.py`.
- **Manifest:** marketplace and plugin manifests expose 70 individual entries
  with `strict: false`.
- **Risk surface:** noncommercial/share-alike licensing, cached sibling-path and
  cwd-relative-script defects, and web research without an explicit prompt-
  injection boundary in some skills.
- **Korean signal:** none found.
- **Direct support and status:** problem framing and finance metrics are narrow
  source-review leads for product/strategy/finance. The repository is
  **conditional** pending license policy and path fixes; no broad product pack is
  supported by this census.

## Mapping to the 20 broad domains

The table records direct leads only. `Gap remains` means the leads do not meet
the domain's breadth, Korean, packaging, safety, or approval requirements.

| Domain | Wave 2 direct leads | Current result |
|---|---|---|
| `research-and-intelligence` | Hugging Face papers; K-Dense data/statistics; conditional Product Manager research workflows | Gap remains; no approved general research pack |
| `software-engineering` | Microsoft Deep Wiki; Trail of Bits static review | Gap remains beyond codebase knowledge and a security slice |
| `strategy-and-decision` | Self-contained Product Manager subset | Gap remains; license and breadth unresolved |
| `writing-and-publishing` | Anthropic official link-only; Daymade docs | Gap remains for citations, localization, and publishing |
| `marketing-and-growth` | Product Manager and Higgsfield partial material | Gap remains; no high-confidence broad strategy pack |
| `promotion-and-distribution` | No new high-confidence general source | Gap remains |
| `sales-and-customer` | OneWave client proposal, conditional only | Gap remains; retain existing official-vendor routes |
| `product-management` | Self-contained Product Manager subset only | Gap remains; broad pack held on license/path defects |
| `project-management` | OneWave `meeting-to-tasks` | Gap remains; not general project orchestration |
| `devops-and-security` | Trail of Bits `insecure-defaults`; other Trail plugins conditional | Gap remains beyond a static-review slice |
| `ai-agents-and-automation` | Hugging Face and Microsoft Azure-specific material | Gap remains; existing Superpowers source remains the stronger generic route |
| `data-and-analytics` | K-Dense; Hugging Face; Anthropic XLSX official link | Gap remains pending package/runtime review |
| `design-and-brand` | Higgsfield and Anthropic examples, partial | Gap remains; paid service and redistribution constraints |
| `video-and-audio` | Higgsfield, Runway, ElevenLabs, Remotion, Daymade | Strong lead density, but every route remains conditional |
| `documents-and-knowledge` | Microsoft, Anthropic, Obsidian, Daymade | Best non-media coverage; still no approved bilingual broad pack |
| `business-operations` | OneWave SOP and meeting workflows | Gap remains beyond two narrow workflows |
| `finance-and-accounting` | OneWave cash flow; Product Manager metrics; Anthropic XLSX | Gap remains for bookkeeping and tax workflows |
| `commerce` | Higgsfield marketplace cards | Gap remains; retain existing Nexscope/official-vendor routes |
| `people-and-training` | OneWave hiring scorecard | Gap remains for the HR/training lifecycle |
| `legal-risk-and-compliance` | No new high-confidence general legal source; Trail covers technical security only | Gap remains; retain existing LegalZoom/Vanta routes |

The market is deepest in specialized document, knowledge, and generative-media
skills. The broker opportunity remains the missing layer between discovery and
safe, purpose-oriented installation: exact source identity, license handling,
narrow packaging, Korean and capability-gap disclosure, paid/auth/data-egress
gates, and maintained refresh evidence. This census supplies leads for that
layer; it does not shortcut it.

## Excluded sources

These repositories were inspected but excluded from the 13 verified candidates
because the source or package failed a basic current-shape threshold.

| Excluded source | Observed exact HEAD | Reason for exclusion |
|---|---|---|
| [`sales-skills/sales`](https://github.com/sales-skills/sales) | [`3df70573c332aa969b5e49d7476899b459448eca`](https://github.com/sales-skills/sales/commit/3df70573c332aa969b5e49d7476899b459448eca) | No root license; skill frontmatter says MIT without a complete grant. Its marketplace uses `schema_version`/`org` but lacks current required `name` and `owner`; skills also fetch raw web content and mutate `references/learnings.md`. |
| [`claude-office-skills/skills`](https://github.com/claude-office-skills/skills) | [`9c4c7d5cd2813a8936bf2c9fdb174ea883b85a11`](https://github.com/claude-office-skills/skills/commit/9c4c7d5cd2813a8936bf2c9fdb174ea883b85a11) | MIT root but no plugin manifest; inconsistent names/descriptions, nonexistent MCP/knowledge references, and stale high-stakes legal/applicant-scoring claims. |
| [`aicontentskills/ai-video-storyboard-skill`](https://github.com/aicontentskills/ai-video-storyboard-skill) | [`93f8a6d6935858bc4acd7ff3bbea2411edf88caa`](https://github.com/aicontentskills/ai-video-storyboard-skill/commit/93f8a6d6935858bc4acd7ff3bbea2411edf88caa) | README/SKILL claim MIT but no license file; referenced `shot-types.md`, `camera-moves.md`, `lighting.md`, and `genre-templates.md` are missing. |
| [`DavidROliverBA/Daves-Claude-Code-Skills`](https://github.com/DavidROliverBA/Daves-Claude-Code-Skills) | [`396429a7668dfb2440ac03066b83abe54143421a`](https://github.com/DavidROliverBA/Daves-Claude-Code-Skills/commit/396429a7668dfb2440ac03066b83abe54143421a) | MIT root, but legacy flat `skills/**/*.md`, no `SKILL.md`, and no marketplace/plugin manifest. |

Exclusion is not a permanent claim about an author or future revision. It records
why the observed exact revision should not enter the next review queue.

## Recommended next audit wave

The next work should remain source-level and independently reviewed. Priority
order:

1. Microsoft Deep Wiki: validate the complete plugin in a clean cache, reconcile
   the marketplace/plugin version mismatch, and verify installed notices.
2. Trail of Bits `insecure-defaults`: isolate only that plugin and verify the
   CC-BY-SA notice and output boundary.
3. Obsidian core: review only `obsidian-markdown`, `obsidian-bases`, and
   `json-canvas`; keep `obsidian-cli` and `defuddle` excluded from the slice.
4. K-Dense statistics: review the four named skills, referenced scripts,
   dependencies, and exact package directories.
5. OneWave local workflows: review SOP, cash flow, hiring scorecard, and meeting
   tasks individually, including bundled references and sensitive-data notices.

Paid, authenticated, or upload-capable sources form a separate later wave:

- Higgsfield, Runway, and ElevenLabs require explicit paid/network/secret/media-
  upload approval and must not become default generic installs.
- Remotion requires license and installed-notice provenance before runtime work.
- Daymade requires relative-path, dependency, and external-service review.
- Anthropic document skills remain official link-only under their own terms.
- Hugging Face must split read-only discovery from write/upload/cloud jobs.
- Product Manager Skills requires a repository redistribution policy decision and
  correction of sibling/cwd path assumptions before packaging review.

For every priority, the next artifact must preserve the distinction between
`candidate`, `eligible-for-independent-review`, `approved`, and
`install-eligible`. No transition may be inferred from inclusion in this census,
and no source should be added to a pack until its exact proposed revision,
license notice, clean-cache behavior, runtime boundaries, and bilingual profile
gaps have been reviewed and recorded.
