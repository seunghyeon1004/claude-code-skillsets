# Starter Route Contracts Design

- Status: approved design; phase 1 contract implemented separately from data wiring
- Date: 2026-07-30
- Base: `release/public-candidate`; private development commit is not published

## Goal

Add a durable, authenticated contract for the 18 incomplete broad-domain
starter routes without changing planning or installation behavior in this
change. Each route selects at most one primary and one complement from the
pinned Claude official marketplace and records the full Complete v1 capability
gap explicitly.

## Product boundary

The contract is not a broad-domain completeness claim. A starter route is
always `starter-partial`, always has `broadCoverageComplete: false`, and must
carry at least one unsupported Complete v1 capability. `directEvidenceIds` and
`inferredEvidenceIds` identify current, source-authenticated capability evidence;
the remaining capabilities must be listed exactly in
`unsupportedCapabilityIds`.

The route manifest does not authorize installation. Planner and setup changes
will consume it in a later change. Official marketplace listing remains distinct
from individual safety review, runtime smoke testing, permission review,
authentication requirements, and cost.

## Source of truth

`manifests/decision-starter-routes.yaml` will be the reviewed route allowlist. It is
validated against:

1. the complete domain and capability universe loaded from Complete v1;
2. candidates and evidence materialized from
   `manifests/official-listing-capability-claims.yaml`;
3. current evidence ownership, support classification, and candidate identity;
4. known candidate state, including the held Shopify candidate.

The manifest contains exactly the 18 domains other than
`research-and-intelligence` and `software-engineering`. Candidate order is
meaningful: the first candidate is the future primary and the optional second
candidate is the future complement. The contract permits one or two candidate
IDs only.

## Route invariants

For every route:

- `domainId` is unique and belongs to the expected 18-domain set.
- `kind` is `starter-partial` and `broadCoverageComplete` is `false`.
- `orderedCandidateIds` has one or two unique decision candidate IDs.
- Every candidate is a Claude Code official marketplace candidate and is not
  `held` or `blocked` in the source manifest.
- Every direct or inferred evidence ID is unique across the route, current,
  belongs to a listed route candidate, and owns a capability in the route domain.
- Evidence support exactly matches the route list: `direct` evidence cannot be
  listed as inferred, and inferred evidence cannot be listed as direct.
- Every listed candidate contributes at least one evidence item.
- The supported and unsupported capability sets are disjoint.
- The union of capabilities referenced by direct evidence, inferred evidence,
  and `unsupportedCapabilityIds` equals the full Complete v1 capability set for
  the domain.
- `unsupportedCapabilityIds` is non-empty.
- `shopify-ai-toolkit` is forbidden from starter routes while it remains held.

The commerce starter is intentionally `windsor-ai` only. It supports an
inferred revenue-analysis slice while stores, catalogs, inventory, fulfillment,
returns, reviews, product research, pricing, merchandising, and promotions stay
explicitly unsupported.

## Runtime representation and compatibility

`DecisionManifestRepository` carries authenticated `starterRoutes` and includes
them in its digest. Generated root decision indexes must include the same route
projection. The closed v3 decision-index schema treats `starterRoutes` as
optional so an older v3 index can still be parsed by the contract validator.
Root loading is stricter: a generated index loaded against current manifests
must contain routes exactly matching the authenticated manifest projection.

This provides structural backward compatibility without allowing a current root
index to omit the new contract. Existing plan, approval, receipt, and setup-state
shapes are unchanged by this change.

## Implementation staging

Phase 1 adds only the closed route schema, TypeScript model, pure semantic
validator, and fixture-based contract tests. It deliberately does not add the
production route manifest, official listing claims, repository loading,
generation, or index parity. This keeps the validation boundary independently
reviewable before the 18-route evidence dataset is introduced.

The integration change must add the production manifest and exact claims, call
the semantic validator only after candidate/evidence and Complete v1 validation,
include authenticated routes in the repository digest, project routes into the
generated root index, and enforce root parity. Standalone v3 parsing must keep
the future `starterRoutes` field optional; current root generation and loading
must require exact authenticated parity.

## Non-goals

- No planner fallback or selection behavior.
- No setup evaluator, plugin runtime, or skill changes.
- No README product claim changes.
- No generated index or generated runtime update.
- No external plugin installation, execution, or remote repository change.
