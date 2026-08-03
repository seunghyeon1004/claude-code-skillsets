# Public v10 Gap-Fit Remediation Plan

> **Superseded / Historical (non-current):** This document preserves the original
> v10 remediation plan as historical planning evidence. Its proposed target of 7
> executable partial routes and 13 pending/discovery-only routes was not adopted.
> The current canonical generated truth is 0/20 executable and 20/20 review-held
> discovery-only. The numbered plan below is retained unchanged as history and must
> not be read as current release state or clearance.

**Goal:** Preserve the verified decision-broker market position while removing the
public-release blockers found in the 2026-08-02 market, UX, and security reviews.

**Release rule:** The existing private v9 candidate remains frozen and private. Any
accepted change creates a new v10 public-history candidate and restarts local,
clean-copy, private CI, and bootstrap verification. No visibility change, external
candidate install, release tag, announcement, or directory submission is part of
these implementation tasks.

## Binding Product Contract

- The repository is a broker, not a copied-skill bundle, safety certification, or
  claim to have the largest catalog.
- A Claude Code plan contains at most one primary and one justified complement.
- `related` evidence is relevance only and never authorizes an executable route.
- Unknown permissions, license, trust, dependencies, authentication, cost, and
  unavailable revision binding remain visible before approval.
- Probe consent, risk acknowledgement, and final install approval remain distinct.
- Every actual Claude invocation is represented in the approved command sequence.
- An install that may have succeeded before verification failed is preserved as an
  explicit reconciliation state; it is never silently retried or removed.
- Codex stays discovery-only and never executes marketplace or install commands.
- Weekly research may create review PRs only. It never auto-merges or auto-installs.

## Task 1: Maintainable Catalog Refresh And Public Anchor

1. Add failing tests for every generated/plugin-owned decision-index and history
   path that a real refresh changes, including byte parity and previous-index
   preservation.
2. Replace hard-coded current official-marketplace artifact selection with a
   validated append-only pointer/selection contract. Re-observe the official source,
   append immutable evidence, and renew the nine-day epoch only when every selected
   candidate identity, description, and source pin is unchanged. Changed or missing
   selected candidates must hold for review, never inherit evidence automatically.
3. Make the refresh candidate pass generation, append-only, index-history,
   broker-only, and clean-copy gates and emit only a validated bundle/PR.
4. After the strict A/B/public-history bootstrap, support a separate annotated
   `registry-approved/r01` at exact B. Document and test the order: verify tag,
   configure `REGISTRY_APPROVAL_ANCHORED=anchored` and the exact protected tag-object
   secret, rerun current-tip CI, then dispatch refresh. Do not weaken first-bootstrap
   exact-ref validation.
5. Define the installed-catalog delivery contract: a reviewed catalog merge must
   produce a marketplace-visible manager update and explicit update/reload steps.
   Test a cached 0.1.0 installation receiving the new decision index.

## Task 2: Honest Route Eligibility And First-Screen Positioning

1. Add failing tests proving a route with no current direct or inferred evidence is
   held and cannot produce `approvedExecution`, even if related evidence exists.
2. Preserve all 20 domains but report the current split honestly: 7 executable
   partial routes and 13 pending/discovery-only routes. Do not promote related
   evidence to capability coverage.
3. Generate a deterministic Korean/English 20-row route table from the authenticated
   decision index with domain, smallest honest profile, candidate order/state,
   availability, unsupported count, observed time, and expiry. Drift must fail
   `check:generated`.
4. Rewrite the top of both READMEs so a visitor immediately sees the concrete broker
   job, list/bundle/certification distinction, two-command install, automatic
   `shared-core` dependency, one example, current platform/version/coverage limits,
   and the route-table link. Move low-level release/state detail below the user path
   or into existing technical docs without deleting the contracts.
5. Narrow marketplace/plugin descriptions from ambiguous "reviewed" wording to
   exact official listing/source-identity evidence and incomplete individual safety
   review.

## Task 3: Reviewable Approval And Recoverable Runtime State

1. Add failing parity tests that compare the approved semantic command sequence to
   the actual Claude invocation trace. Represent all identity/version checks and
   marketplace/install/list calls in exact order and include them in command receipts.
2. Add a bounded human review summary that contains candidates, sources, exact
   external commands, evidence levels, unknowns, uncovered capabilities, expiry,
   executable identities, and state paths. Keep the full canonical approval object
   digest-bound and available on demand, but do not require a 59 KB object to be
   printed twice. The standard two-candidate summary must be at most 5 KiB and 120
   lines.
3. Represent install-success/post-verification-failure as
   `installed-but-unverified` (or an equally explicit closed state), retaining the
   install command evidence and candidate identity without minting a verified managed
   receipt. Disclose that the plugin may remain installed. Never auto-retry or
   auto-remove it.
4. Make doctor read that state and provide a read-only reconciliation diagnosis plus
   exact separately approval-gated manual next steps.
5. Align doctor with setup receipts and candidate IDs. Separate general Claude
   health from the exact execution-compatible `2.1.198` contract, and eliminate the
   domain/profile mismatch.

## Integration And Release Gates

1. Review each task for spec compliance and code quality before integration.
2. Merge the three task commits without weakening append-only, public-history,
   broker-only, consent, or runtime identity gates.
3. Run focused regression tests, `npm run check`, `npm run verify:broker-only`,
   strict Claude plugin validation, `npm audit`, and `tests/e2e/clean-copy.sh`.
4. Run a live post-expiry refresh rehearsal that creates a validated local bundle
   without publishing a branch or PR.
5. Re-run the independent whole-tree review. Fix every blocker and major finding.
6. Create a clean v10 A/B/public-history candidate, verify it locally, and request
   exact private replacement approval before changing the remote candidate.
7. Only after private CI/bootstrap pass, report the exact v10 SHA and ask for the
   separate public-visibility approval required by the release runbook.
