# Broker-Only Cross-Runtime Skill Registry Design

**Date:** 2026-07-24
**Status:** Approved
**Repository:** `claude-code-skillsets`

## Purpose

`claude-code-skillsets` is a continuously curated broker for external Claude Code
and Codex skills and plugins. It is not a domain-skill studio and does not fill
market gaps by authoring replacement skills.

The product helps a user move from a natural-language goal to a small, verified,
auditable combination of external skills for one or both supported runtimes. It
owns discovery, classification, evaluation, recommendation, consent, installation,
updates, removal, and health management. The external authors and marketplaces
continue to own the actual development, marketing, writing, video, research, and
other purpose-specific skills.

This design supersedes every earlier complete-v1 clause that permits a
repository-owned purpose skill, an `owned-gap` fallback, or a later phase that
authors a domain skill to make a pack appear complete.

## Market Position

The repository is not another large list or general plugin marketplace. Official
and community marketplaces already provide discovery and individual installation,
and community indexes compete on catalog size.

The product occupies the layer above those catalogs:

> A goal-based recommendation engine, evidence-backed trust layer, and lifecycle
> manager for external Claude Code and Codex skills.

Its differentiation is:

- twenty work, creative, and business domains with fine-grained categories;
- outcome-oriented packs instead of an undifferentiated skill list;
- source, revision, license, permission, maintenance, and effectiveness evidence;
- automatic detail selection after the user confirms only one to three domains;
- one exact preview and final approval before any real installation or update;
- deterministic update, conflict, removal, rollback, and doctor behavior;
- recurring market research that connects new community work without copying it;
- one shared evidence model across both skill ecosystems; and
- one goal and pack model across Claude Code and Codex, with runtime-specific
  compatibility and lifecycle proof.

The product reports evidence and residual risk. It never claims that an external
skill is absolutely safe.

## Ownership Boundary

### Repository-Owned Broker Core

The repository may implement only the machinery required to broker external
skills:

- natural-language goal and domain routing;
- consented environment detection;
- category, pack, capability, and provider resolution;
- research source adapters and immutable evidence capture;
- static and isolated trial validation;
- recommendation, preview, approval, and lockfile generation;
- marketplace registration and external plugin installation orchestration;
- update, replacement, rollback, removal, resume, and doctor workflows;
- Claude Code and Codex runtime adapters;
- generated registry, reports, documentation, and audit views; and
- thin domain profiles that contain routing metadata only.

Thin domain profiles are not purpose-specific skills. They may declare categories,
packs, provider constraints, and broker commands, but they may not contain domain
instructions that substitute for an external provider.

### Externally Owned Purpose Functionality

A purpose-specific capability may be supplied only by an original external skill
or plugin. When no eligible external provider exists, the capability remains
unavailable. The broker records and installs an upstream marketplace entry or
immutable original-repository revision. It does not copy external skill code into
this repository, fork it merely to bundle it, rewrite it as an owned substitute,
or publish it under the broker's namespace.

Examples of external-only functionality include coding workflows, research,
strategy, writing, marketing, promotion, image and video production, data work,
sales, operations, education, finance, legal workflows, and personal productivity.

## Architecture

The system has two product layers, two runtime adapters, and one research pipeline.

### Broker Core

The broker core interprets a user's objective, recommends one to three of the
twenty domains, combines the confirmed domains with consented environment facts,
detects installed supported runtimes, resolves suitable packs and external
providers, presents a complete change preview, and executes only the approved
operation.

### Runtime Adapters

Claude Code and Codex share taxonomy, pack intent, provider provenance, and
research policy. They do not share installation evidence or lifecycle state.

Each runtime adapter owns:

- runtime detection and version constraints;
- native marketplace and plugin inventory parsing;
- direct Agent Skill compatibility where the runtime supports the unchanged
  original skill;
- install, update, removal, rollback, and doctor commands;
- disposable research-root construction;
- runtime-native permission and executable-surface inspection; and
- normalized receipts returned to the common broker core.

The adapters never translate a provider into a new repository-owned purpose
skill. A source is usable only through an upstream runtime-native plugin contract
or an unchanged original Agent Skill that the target runtime supports.

### Released External-Skill Registry

The released registry contains only reviewed metadata and upstream connection
contracts:

- original source and marketplace identity;
- exact version, commit, selected path, and artifact digests;
- source tier, license, maintenance, permissions, platforms, and trust status;
- capability and category mappings;
- runtime packaging (`native-plugin` or unchanged `agent-skill`);
- semantic evaluation and lifecycle evidence by runtime and platform;
- selected and alternate roles by runtime and platform;
- review date, evidence validity, revocation state, and residual risks; and
- deterministic installation, update, and removal contracts.

The installation resolver reads a released registry revision. It does not trust a
live search result at installation time. A Claude Code result never proves Codex
compatibility, and a Codex result never proves Claude Code compatibility.

### Market-Research Pipeline

The research pipeline discovers candidates from both ecosystems, captures
immutable evidence, evaluates them in isolation on every claimed target runtime,
and promotes only passing runtime-specific revisions into a later released
registry revision. Research state and user-install state are separate.

## Runtime Compatibility Model

Supported runtimes are exactly:

- `claude-code`; and
- `codex`.

Every provider revision declares one or both runtimes. For each declared runtime it
records:

- native plugin or unchanged Agent Skill packaging;
- exact upstream manifest and artifact identity;
- supported operating systems;
- runtime and minimum-version constraints;
- install, semantic, update, removal, and doctor evidence; and
- selected or alternate capability roles.

The same upstream revision may be one common provider for both runtimes only when
both runtime evidence sets pass independently. Otherwise the registry exposes it
only on the passing runtime. The broker does not require capability or pack parity
between runtimes.

## Source Policy

Sources have three operational roles.

### Official and Approved Marketplaces

New entries and versions from approved Claude Code and Codex marketplaces are
discovered automatically during a scheduled or operator-requested research run. A
candidate can be promoted automatically only after every required static,
isolation, semantic, and lifecycle gate passes on each claimed runtime.

Marketplace presence is discovery evidence, not proof of safety or effectiveness.

### Independent Community Repositories

Community repositories are discovered and classified automatically, then held in
`quarantined`. They require an independent review before promotion. A repository's
popularity does not bypass license, permission, provenance, maintenance, or trial
gates.

### Aggregators and Awesome Lists

Aggregators are discovery-only. Every candidate must be followed through to its
original repository and immutable original revision. An aggregator URL is never an
install source and never owns the provider record.

## Research and Promotion Lifecycle

A provider revision moves through this lifecycle:

```text
discovered -> quarantined -> eligible -> selected | alternate
quarantined -> rejected
selected | alternate -> revoked
```

- `discovered`: the candidate has an immutable discovery receipt.
- `quarantined`: classification exists, but promotion gates are incomplete.
- `eligible`: the exact revision passed every required gate.
- `selected`: the preferred eligible provider for a capability, runtime, and
  platform.
- `alternate`: an eligible non-default provider for compatibility or user choice.
- `rejected`: the reviewed candidate is unsuitable and includes terminal reasons.
- `revoked`: a formerly eligible revision must not be newly installed or updated.

Capability resolution uses exactly these terminal dispositions for each runtime
and platform:

- `selected`: at least one eligible external default exists;
- `alternate`: a recommended-only capability has eligible non-default providers;
- `rejected`: reviewed candidates exist, but none is suitable; or
- `unavailable`: no currently eligible external provider exists.

`owned-gap` is removed. `unavailable` creates no owned-skill obligation.

Required and recommended capabilities use the same external-provider quality
gates. The difference is pack availability, not a lower verification standard.

## Pack Availability

Pack state is derived for each target runtime and platform, never asserted
manually:

- `available`: every required capability has a selected external provider;
- `available-with-gaps`: required capabilities are available, but at least one
  recommended capability is rejected or unavailable;
- `unavailable`: at least one required capability has no selected external
  provider on the target runtime and platform; and
- `action-required`: an installed pack lost an eligible provider through
  revocation, deletion, license change, or incompatible update.

An unavailable pack is excluded from default recommendations. The broker shows the
missing capability and may offer a different available pack. It never fabricates
coverage, silently drops a required capability, or authors a replacement skill.

## Research Cadence

There is no daily discovery job.

Market research runs through:

- one scheduled weekly discovery and validation batch;
- an operator-requested manual refresh;
- an optional latest-candidate check before planning an installation, which may
  discover candidates but cannot install or promote unreviewed results; and
- immediate revocation processing when a known security, deletion, or license
  event is received.

Deep validation runs only for new or changed candidate revisions. An unchanged
pinned revision receives freshness and evidence-validity checks. A failed new
revision leaves the last eligible pinned revision active unless that older revision
has independently become unsafe or invalid.

## User Experience

The default setup flow is:

1. Accept a natural-language objective.
2. Recommend one to three of the twenty top-level domains.
3. Let the user confirm or change those domains.
4. Request consent for relevant environment detection.
5. Detect Claude Code and Codex, then let the user confirm one or both targets.
6. Automatically resolve categories, packs, and external providers from the
   released registry.
7. Exclude unavailable packs and explain missing required capabilities separately
   for each target runtime.
8. Present one exact preview covering target runtimes, marketplaces, providers,
   revisions, permissions, commands, platform limits, conflicts, replacements, and
   removals.
9. Execute only after final approval.
10. Record runtime-specific lock state and sanitized operation receipts.

The default flow does not ask the user to select fine-grained categories or
individual skills. Advanced settings expose those controls.

Updates follow the same consent rule. The broker shows the old and proposed
provider revisions, evidence changes, permissions, commands, conflicts, and
rollback target before approval.

## Installation and Isolation Boundary

Research trials use fresh temporary roots for `HOME`, runtime configuration and
plugin caches, temporary files, XDG directories, and the project. Claude Code
trials isolate `CLAUDE_CONFIG_DIR` and its plugin cache. Codex trials isolate
`CODEX_HOME` and its marketplace/plugin cache. Every trial installation uses the
narrowest disposable project-local contract supported by that runtime and removes
every root before return. Research never promotes a trial into a real user or
project configuration.

Real project or user installation requires the production preview and final
approval. The resolver installs only a released, pinned provider contract. The
broker does not execute an unreviewed bootstrap command, provider-owned installer,
or live search result.

## Validation Gates

Promotion requires evidence for:

- original repository, author, marketplace, and revision provenance;
- license and installation rights;
- immutable commit, selected paths, marketplace entry, and artifact digests;
- filesystem, command, network, external-data, hook, MCP, and executable surfaces;
- supported platforms and version constraints;
- maintenance activity, archival status, security notices, and removals;
- isolated installation in every claimed Claude Code or Codex environment;
- normal and boundary semantic cases for each claimed capability;
- update and complete removal behavior; and
- sanitized receipts with no credential, raw prompt, private path, or customer data.

External providers can be at most `trusted`. Repository-owned broker artifacts may
be `verified` after their release gates pass. Trust applies to the exact reviewed
revision, not all future upstream versions.

## Failure and Recovery

- A failed candidate remains quarantined or becomes rejected.
- A failed provider update does not replace the previous eligible revision.
- A revoked provider is removed from new resolutions immediately.
- An installed revoked provider makes the affected pack `action-required` and
  produces a removal or eligible-replacement plan.
- A deleted upstream source blocks new installation; cached presence is not treated
  as ongoing upstream availability.
- A license change triggers a new review and can revoke later installation rights.
- Platform results remain independent. Darwin evidence never proves Linux or
  Windows eligibility.
- Runtime results remain independent. Claude Code evidence never proves Codex
  eligibility, and Codex evidence never proves Claude Code eligibility.
- Interrupted real operations resume or roll back from the atomic lock and receipt
  state; they never guess that an external command succeeded.

## Generated Transparency

Korean and English generated documentation must expose:

- the twenty domains, fine-grained categories, and outcome packs;
- pack availability and missing required or recommended capabilities by runtime
  and platform;
- each selected and alternate original provider;
- source tier, license, revision, permissions, runtimes, platforms, maintenance,
  and review dates;
- semantic and lifecycle validation scope;
- rejected, unavailable, and revoked reasons; and
- the exact install, update, removal, and doctor entry points.

Generated pages and CLI output derive from the same released manifests. Handwritten
documentation cannot claim provider or pack availability absent from the registry.

## Verification Strategy

The broker core must pass type, schema, unit, integration, generated-artifact,
plugin-validation, clean-copy, and real Claude Code and Codex lifecycle E2E checks.

The research system must prove:

- exact source and revision lineage;
- deterministic classification and capability coverage;
- quarantine and promotion boundaries;
- static gate failures and passing eligible revisions;
- disposable install, semantic, update, and removal trials on each runtime;
- selected and alternate runtime-and-platform resolution;
- rejected, unavailable, revoked, and recovery behavior; and
- weekly incremental refresh with unchanged-revision reuse and changed-revision
  revalidation.

Every user-visible pack scenario must verify available, available-with-gaps,
unavailable, and action-required behavior where applicable. A private release
candidate cannot pass with an unexplained capability, unreviewed provider,
repository-owned purpose skill, or documentation/manifest mismatch.

## Migration from the Earlier Complete-v1 Design

Before P04 implementation continues:

1. Replace `owned-gap` selection semantics with `unavailable`.
2. Remove repository-owned purpose-provider and owned-gap realization contracts.
3. Amend P04 coverage so a required unavailable capability makes its pack
   unavailable rather than causing owned implementation.
4. Retarget P09 from owned-skill authoring to generated domain routing profiles,
   external-provider linkage, and pack-resolution verification.
5. Remove owned-skill semantic-evaluation requirements and replace them with
   external-provider and broker-routing evaluations.
6. Update the master roadmap, downstream phase dependencies, generated reports,
   and release gates to use broker-only states.
7. Add an exact `claude-code | codex` runtime contract, runtime-specific provider
   roles and evidence, and separate lifecycle adapters.
8. Expand market research to both ecosystems without treating one runtime's result
   as evidence for the other.
9. Preserve the existing twenty domains, 281 categories, 147 capabilities, forty
   initial packs, and 120 pack scenarios.

No current purpose-specific owned skill needs deletion because none has been
implemented. Existing owned-gap schemas and validators are compatibility debt to
remove or migrate before provider-selection data is committed.

## Non-Goals

- Hosting a general-purpose marketplace.
- Competing on the raw number of listed skills.
- Copying or republishing external skill source.
- Authoring purpose-specific domain skills.
- Filling unavailable capabilities with generated prompts or hidden fallbacks.
- Automatically installing or replacing real user state after research promotion.
- Translating a Claude Code-only plugin into a repository-owned Codex substitute,
  or the reverse.
- Running daily discovery.
- Claiming absolute safety for an external provider.
- Making the GitHub repository public before separate user approval.

## Acceptance Criteria

This broker-only design is realized when:

- no manifest, plan, resolver, report, or release gate requires or permits a
  repository-owned purpose skill;
- every pack-referenced capability has an explicit selected, alternate, rejected,
  or unavailable external-market disposition for each supported runtime and target
  platform;
- pack availability is derived from target-runtime and target-platform external
  provider coverage;
- every selected and alternate revision has complete, current, immutable evidence
  for the runtime on which it is offered;
- weekly and manual research refreshes discover and classify new providers without
  touching real installation state;
- changed revisions are revalidated and failed updates retain the last eligible
  revision when safe;
- unavailable and revoked states produce honest user-visible behavior;
- setup exposes only top-level domain choices by default and requires exact preview
  plus final approval before real changes;
- update, replacement, rollback, removal, resume, and doctor workflows operate on
  pinned external-provider contracts through the correct runtime adapter; and
- private-main release evidence proves broker-core and external-provider workflows
  on both Claude Code and Codex without any owned purpose-skill implementation.
