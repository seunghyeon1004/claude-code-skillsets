import { describe, expect, it } from "vitest";
import {
  projectCandidate,
  projectDecisionCandidates,
  type CandidateProjectionInput
} from "../../src/decision/candidate-projection.js";
import { isCurrentOfficialTargetCompatibilityEvidence } from "../../src/decision/eligibility.js";
import type {
  CapabilityEvidence,
  DecisionCandidateProjection,
  DecisionIndex
} from "../../src/model/decision.js";
import type { MaterializedReviewState } from "../../src/research/review-state.js";

describe("decision candidate eligibility", () => {
  it("accepts official target evidence only inside its ordered review window", () => {
    const evidence = {
      observedAt: "2026-08-03T01:00:00Z",
      reviewedAt: "2026-08-03T02:00:00Z",
      expiresAt: "2026-08-12T02:00:00Z"
    } as Parameters<typeof isCurrentOfficialTargetCompatibilityEvidence>[0];

    expect(isCurrentOfficialTargetCompatibilityEvidence(evidence, evidence.reviewedAt)).toBe(true);
    expect(isCurrentOfficialTargetCompatibilityEvidence(evidence, evidence.expiresAt)).toBe(false);
    expect(isCurrentOfficialTargetCompatibilityEvidence(
      { ...evidence, reviewedAt: "2026-08-03T00:59:59Z" },
      "2026-08-03T02:00:00Z"
    )).toBe(false);
    expect(isCurrentOfficialTargetCompatibilityEvidence(
      { ...evidence, reviewedAt: "2026-08-03T03:00:00Z" },
      "2026-08-03T02:00:00Z"
    )).toBe(false);
  });

  it.each([
    ["blocked", "blocked"],
    ["stale", "held"],
    ["target-unknown", "held"],
    ["community-sensitive-unknown", "held"]
  ] as const)("applies precedence for %s", (fixture, expected) => {
    expect(projectCandidate(candidateFixture(fixture)).state).toBe(expected);
  });

  it("does not let a stale approval override an active source block", () => {
    const input = candidateFixture("stale");
    input.materializedState = materializedState({ state: "blocked", reason: "blocked" });

    expect(projectCandidate(input).state).toBe("blocked");
  });

  it("fails held for a plain official-shaped index even when its reference and hash look valid", () => {
    const candidate = officialClaudeCandidate();
    const [projected] = projectDecisionCandidates(
      decisionIndex([candidate], [officialMarketplaceEvidence(candidate)]),
      {
        runtime: "claude-code",
        platform: "darwin",
        asOf: "2026-07-29T00:00:00Z",
        targetCompatibilityEvidence: [targetEvidence(candidate, "darwin", "verified")]
      }
    );

    expect(projected).toMatchObject({
      state: "held",
      stateReasons: ["exact-path-approval-required"]
    });
  });

  it("requires explicit compatibility evidence for the exact target platform", () => {
    const candidate = candidateBase();
    const eligible = projectCandidate({
      ...candidateFixture("target-unknown"),
      candidate,
      targetCompatibility: targetEvidence(candidate, "darwin", "verified")
    });
    const missingLinux = projectCandidate({
      ...candidateFixture("target-unknown"),
      candidate,
      platform: "linux",
      targetCompatibility: targetEvidence(candidate, "darwin", "verified")
    });
    const unknownLinux = projectCandidate({
      ...candidateFixture("target-unknown"),
      candidate,
      platform: "linux",
      targetCompatibility: targetEvidence(candidate, "linux", "unknown")
    });
    const incompatibleLinux = projectCandidate({
      ...candidateFixture("target-unknown"),
      candidate,
      platform: "linux",
      targetCompatibility: targetEvidence(candidate, "linux", "incompatible")
    });

    expect(eligible).toMatchObject({
      state: "eligible-with-disclosures",
      stateReasons: expect.arrayContaining(["target-verified:claude-code/darwin"])
    });
    expect(missingLinux).toMatchObject({
      state: "held",
      stateReasons: ["target-unknown:claude-code/linux"]
    });
    expect(unknownLinux).toMatchObject({
      state: "held",
      stateReasons: ["target-unknown:claude-code/linux"]
    });
    expect(incompatibleLinux).toMatchObject({
      state: "held",
      stateReasons: ["target-incompatible:claude-code/linux"]
    });
  });

  it("uses Task 4 materialized exact-path state to hold an otherwise eligible candidate", () => {
    const candidate = candidateBase({
      id: "community-reviewed",
      sourceId: "community-source",
      skillPath: "skills/reviewed/SKILL.md",
      runtime: "claude-code",
      revisionBinding: "exact",
      permissions: observedArray(),
      license: observedString(),
      trust: observedString(),
      dependencies: observedArray()
    });
    const index = decisionIndex([candidate]);

    const [projected] = projectDecisionCandidates(index, {
      runtime: "claude-code",
      platform: "darwin",
      asOf: "2026-07-29T00:00:00Z",
      targetCompatibilityEvidence: [targetEvidence(candidate, "darwin", "verified")],
      materializedReviewState: [materializedState({
        sourceId: candidate.sourceId,
        skillPath: candidate.skillPath,
        state: "held",
        reason: "stale"
      })]
    });

    expect(projected).toMatchObject({ state: "held", stateReasons: expect.arrayContaining(["review-stale"]) });
  });
});

function candidateFixture(
  fixture: "blocked" | "stale" | "target-unknown" | "community-sensitive-unknown"
): CandidateProjectionInput {
  const candidate = candidateBase({
    permissions: fixture === "community-sensitive-unknown" ? unknownArray() : observedArray(),
    license: fixture === "community-sensitive-unknown" ? unknownString() : observedString(),
    trust: fixture === "community-sensitive-unknown" ? unknownString() : observedString(),
    dependencies: fixture === "community-sensitive-unknown" ? unknownArray() : observedArray()
  });

  return {
    candidate,
    runtime: candidate.runtime,
    platform: "darwin",
    asOf: "2026-07-29T00:00:00Z",
    catalogFresh: true,
    individualSafetyReview: "complete",
    targetCompatibility: fixture === "target-unknown" ? undefined : targetEvidence(candidate, "darwin", "verified"),
    evidenceCurrent: true,
    materializedState: fixture === "blocked"
      ? materializedState({ state: "blocked", reason: "blocked" })
      : fixture === "stale"
        ? materializedState({ state: "held", reason: "stale" })
        : materializedState({ state: "approved", reason: "current" })
  };
}

function candidateBase(overrides: Partial<DecisionCandidateProjection> = {}): DecisionCandidateProjection {
  return {
    id: "candidate-a",
    sourceId: "community-source",
    skillPath: "skills/example/SKILL.md",
    runtime: "claude-code",
    state: "held",
    stateReasons: ["not-reviewed"],
    providedCapabilityIds: ["capability-a"],
    capabilityEvidenceIds: ["evidence-a"],
    revisionBinding: "exact",
    permissions: observedArray(),
    license: observedString(),
    trust: observedString(),
    dependencies: observedArray(),
    ...overrides
  };
}

function officialClaudeCandidate(): DecisionCandidateProjection {
  return candidateBase({
    id: "shopify-ai-toolkit",
    sourceId: "anthropic-plugins-official",
    skillPath: null,
    runtime: "claude-code",
    stateReasons: ["marketplace-listed"],
    revisionBinding: "unavailable",
    permissions: unknownArray(),
    license: unknownString(),
    trust: unknownString(),
    dependencies: unknownArray()
  });
}

function officialMarketplaceEvidence(
  candidate: DecisionCandidateProjection,
  overrides: Partial<CapabilityEvidence> = {}
): CapabilityEvidence {
  return {
    id: "evidence-a",
    candidateId: candidate.id,
    capabilityId: "capability-a",
    kind: "official-baseline",
    current: true,
    reference: "research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/226",
    contentSha256: "64b111d8c1716c062a285ed63eade42f56e2e79ac95859a994d586f573a20e5e",
    candidate: structuredClone(candidate),
    ...overrides
  };
}

function targetEvidence(
  candidate: DecisionCandidateProjection,
  platform: "darwin" | "linux" | "win32",
  compatibility: "verified" | "incompatible" | "unknown"
) {
  return { candidateId: candidate.id, runtime: candidate.runtime, platform, compatibility } as const;
}

function decisionIndex(
  candidates: DecisionCandidateProjection[],
  candidateEvidence: CapabilityEvidence[] = []
): DecisionIndex {
  return {
    schemaVersion: 3,
    catalogVersion: "test-catalog",
    observedThrough: "2026-07-29T00:00:00Z",
    catalogExpiresAt: "2026-08-07T00:00:00Z",
    profiles: [],
    candidates,
    candidateEvidence,
    intentFixtures: [],
    digest: "0".repeat(64)
  };
}

function materializedState(overrides: Partial<MaterializedReviewState> = {}): MaterializedReviewState {
  return {
    sourceId: "community-source",
    skillPath: "skills/example/SKILL.md",
    state: "approved",
    reason: "current",
    decisionId: "decision-a",
    invalidatedDecisionId: null,
    snapshotId: "snapshot-a",
    inspectedCommit: "a".repeat(40),
    observedAt: "2026-07-29T00:00:00Z",
    changeStatus: "unchanged",
    ...overrides
  };
}

function observedArray() {
  return { status: "observed" as const, value: [], evidence: [] };
}

function observedString() {
  return { status: "observed" as const, value: "observed", evidence: [] };
}

function unknownArray() {
  return { status: "unknown" as const, evidence: [] };
}

function unknownString() {
  return { status: "unknown" as const, evidence: [] };
}
