import { describe, expect, it } from "vitest";
import { HARD_GATE_IDS, SCORE_CRITERIA, type ProviderManifest, type ResearchEvidence, type ResearchSnapshot, type RuntimeTarget, type SourceReviewManifest } from "../../src/model/complete-v1.js";
import { evaluateProviderTargetEligibility } from "../../src/research/governance.js";

const commit = "a".repeat(40);
const digest = "b".repeat(64);
const target = { runtime: "claude-code" as const, platform: "darwin" as const };
const snapshots: ResearchSnapshot[] = [{ id: "snapshot-a", inspectedCommit: commit } as ResearchSnapshot];
const provider: ProviderManifest = {
  schemaVersion: 2,
  id: "provider-a",
  capabilityIds: ["capability-a"],
  sourceReviewId: "review-a",
  permissions: { filesystem: [], commands: [], network: [], externalData: [] },
  version: "1.0.0",
  status: "stable",
  trustTier: "trusted",
  runtimeContracts: [{
    runtime: "claude-code",
    packaging: "agent-skill",
    runtimeVersionRange: ">=1.0.0",
    platforms: ["darwin"],
    repositoryUrl: "https://github.com/example/provider",
    subdirectory: "skills/provider",
    ref: "v1",
    reviewedCommit: commit,
    artifacts: [{ path: "skills/provider/SKILL.md", sha256: digest }]
  }]
};

const staticEvidenceIds = ["documentation-a", "license-a", "maintenance-a", "marketplace-a", "permissions-a", "secret-flow-a", "source-identity-a", "surface-a"];
const targetEvidenceIds = ["compatibility-a", "doctor-a", "install-a", "lifecycle-a", "outcome-normal", "remove-a", "semantic-boundary", "semantic-normal", "update-a"];
const gateEvidence: Record<(typeof HARD_GATE_IDS)[number], string[]> = {
  "bounded-permissions": ["permissions-a"],
  "compatible-runtime-and-platforms": ["compatibility-a"],
  "documented-secret-flow": ["secret-flow-a"],
  "immutable-reviewed-revision": ["source-identity-a"],
  "install-and-semantic-smoke": ["install-a", "semantic-normal"],
  "lifecycle-strategy": ["doctor-a", "lifecycle-a", "remove-a", "update-a"],
  "marketplace-identity-consistent": ["marketplace-a"],
  "original-repository-identified": ["source-identity-a"],
  "outcome-value-demonstrated": ["outcome-normal"],
  "selected-path-license-usable": ["license-a"],
  "transparent-bootstrap-and-surfaces": ["documentation-a", "surface-a"]
};
const scoreEvidence: Record<keyof typeof SCORE_CRITERIA, string[]> = {
  "fit-capability-coverage": ["outcome-normal"],
  "fit-pack-outcome": ["outcome-normal"],
  "fit-domain-depth": ["outcome-normal"],
  "security-bounded-permissions": ["permissions-a"],
  "security-transparent-surfaces": ["surface-a"],
  "security-secret-and-data-flow": ["secret-flow-a"],
  "maintenance-current": ["maintenance-a"],
  "maintenance-versioned": ["source-identity-a"],
  "maintenance-lifecycle": ["lifecycle-a", "update-a"],
  "install-supported-strategy": ["install-a"],
  "install-verifiable-identity": ["source-identity-a"],
  "install-platform-support": ["compatibility-a"],
  "evidence-documentation": ["documentation-a"],
  "evidence-install-smoke": ["install-a"],
  "evidence-semantic-smoke": ["semantic-normal"]
};

function review(): SourceReviewManifest {
  const targetReview = {
    ...target,
    capabilityId: "capability-a",
    decision: "eligible" as const,
    assuranceProfiles: [],
    hardGates: HARD_GATE_IDS.map((id) => ({ id, passed: true, evidenceRefs: gateEvidence[id]!.slice() })),
    evidenceIds: targetEvidenceIds.slice(),
    scoreCriteria: Object.keys(SCORE_CRITERIA).map((id) => ({ id: id as keyof typeof SCORE_CRITERIA, evidenceRefs: scoreEvidence[id as keyof typeof SCORE_CRITERIA]!.slice() })),
    score: { outcomeFitAndDepth: 40, securityAndTransparency: 20, maintenanceAndUpdateability: 15, nativeInstallability: 15, documentationAndEvaluation: 10 },
    decisionReasons: ["passed"]
  };
  return {
    schemaVersion: 2,
    id: "review-a",
    providerId: "provider-a",
    candidateId: "candidate-a",
    searchRecordIds: ["search-a"],
    snapshotIds: ["snapshot-a"],
    discoveryTier: "A",
    originalRepository: "https://github.com/example/provider",
    selectedPaths: ["skills/provider"],
    reviewedCommit: commit,
    reviewedAt: "2026-07-23T05:39:45Z",
    marketplaceIdentity: null,
    observedVersion: "1.0.0",
    licenseConclusion: "MIT",
    lastMeaningfulChange: "2026-07-23",
    surfaces: { skills: [], commands: [], agents: [], hooks: [], mcpServers: [], scripts: [], binaries: [] },
    permissions: provider.permissions,
    secretFlows: [],
    compatibility: [{ runtime: "claude-code", runtimeVersionRange: ">=1.0.0", platforms: ["darwin"] }],
    linkedDomainIds: ["software-engineering"],
    linkedCategoryIds: ["implementation"],
    linkedPackIds: ["repository-to-implementation-plan"],
    capabilityIds: ["capability-a"],
    removalStrategy: "remove",
    evidenceIds: staticEvidenceIds.slice(),
    capabilityTargetReviews: [targetReview],
    updatePolicy: "quarterly",
    nextReviewDate: "2026-12-31"
  };
}

function evidence(): ResearchEvidence[] {
  const base = { schemaVersion: 2 as const, reviewId: "review-a", providerId: "provider-a", snapshotId: "snapshot-a", reviewedCommit: commit, observedAt: "2026-07-23T05:39:45Z", artifactPath: "research/evidence/artifacts/a.json", artifactSha256: digest, outcome: "passed" as const, summary: "passed" };
  return [
    { ...base, id: "source-identity-a", kind: "source-identity" as const, scope: { runtime: null, platform: null, capabilityId: null } },
    { ...base, id: "marketplace-a", kind: "marketplace-identity" as const, scope: { runtime: null, platform: null, capabilityId: null } },
    { ...base, id: "license-a", kind: "license" as const, scope: { runtime: null, platform: null, capabilityId: null } },
    { ...base, id: "surface-a", kind: "surface-inventory" as const, scope: { runtime: null, platform: null, capabilityId: null } },
    { ...base, id: "permissions-a", kind: "permissions" as const, scope: { runtime: null, platform: null, capabilityId: null } },
    { ...base, id: "secret-flow-a", kind: "secret-flow" as const, scope: { runtime: null, platform: null, capabilityId: null } },
    { ...base, id: "maintenance-a", kind: "maintenance" as const, scope: { runtime: null, platform: null, capabilityId: null } },
    { ...base, id: "documentation-a", kind: "documentation" as const, scope: { runtime: null, platform: null, capabilityId: null } },
    ...["compatibility", "install-smoke", "update-smoke", "remove-smoke", "doctor-smoke", "lifecycle"].map((kind, index) => ({ ...base, id: ["compatibility-a", "install-a", "update-a", "remove-a", "doctor-a", "lifecycle-a"][index]!, kind: kind as "compatibility", scope: { ...target, capabilityId: null } })),
    { ...base, id: "semantic-normal", kind: "semantic-smoke" as const, scope: { ...target, capabilityId: "capability-a" }, caseId: "semantic-normal", caseClass: "normal" as const },
    { ...base, id: "semantic-boundary", kind: "semantic-smoke" as const, scope: { ...target, capabilityId: "capability-a" }, caseId: "semantic-boundary", caseClass: "boundary" as const },
    { ...base, id: "outcome-normal", kind: "outcome-evaluation" as const, scope: { ...target, capabilityId: "capability-a" }, caseId: "outcome-normal", caseClass: "normal" as const }
  ] as ResearchEvidence[];
}

function eligibility(input: { review?: SourceReviewManifest; records?: ResearchEvidence[]; target?: RuntimeTarget; context?: { schemaVersion: 2; asOf: string; privateRcAt: string | null; upstreamObservations: Array<{ providerId: string; snapshotId: string; observedAt: string; headCommit: string }> }; snapshots?: ResearchSnapshot[] } = {}) {
  return evaluateProviderTargetEligibility({ provider, review: input.review ?? review(), evidence: input.records ?? evidence(), capabilityId: "capability-a", target: input.target ?? target, context: input.context, snapshots: input.snapshots ?? snapshots });
}

describe("target eligibility", () => {
  it("accepts only the declared, snapshot-bound evidence closure for its target", () => {
    expect(eligibility().eligible).toBe(true);
  });

  it("does not transfer Claude evidence to Codex", () => {
    expect(eligibility({ target: { runtime: "codex", platform: "darwin" } }).reasonCodes).toContain("provider-target-unsupported");
  });

  it("fails closed when a required target receipt failed", () => {
    const records = evidence();
    const install = records.find((item) => item.kind === "install-smoke");
    if (install?.kind !== "install-smoke") throw new Error("test fixture missing install smoke");
    install.outcome = "failed";
    expect(eligibility({ records }).eligible).toBe(false);
  });

  it("rejects source identity as proof for license, permissions, maintenance, documentation, install, semantic, and outcome claims", () => {
    const mutations: Array<(input: SourceReviewManifest) => void> = [
      (input) => { input.capabilityTargetReviews[0]!.hardGates.find(({ id }) => id === "selected-path-license-usable")!.evidenceRefs = ["source-identity-a"]; },
      (input) => { input.capabilityTargetReviews[0]!.hardGates.find(({ id }) => id === "bounded-permissions")!.evidenceRefs = ["source-identity-a"]; },
      (input) => { input.capabilityTargetReviews[0]!.scoreCriteria.find(({ id }) => id === "maintenance-current")!.evidenceRefs = ["source-identity-a"]; },
      (input) => { input.capabilityTargetReviews[0]!.scoreCriteria.find(({ id }) => id === "evidence-documentation")!.evidenceRefs = ["source-identity-a"]; },
      (input) => { input.capabilityTargetReviews[0]!.scoreCriteria.find(({ id }) => id === "install-supported-strategy")!.evidenceRefs = ["source-identity-a"]; },
      (input) => { input.capabilityTargetReviews[0]!.scoreCriteria.find(({ id }) => id === "evidence-semantic-smoke")!.evidenceRefs = ["source-identity-a"]; },
      (input) => { input.capabilityTargetReviews[0]!.hardGates.find(({ id }) => id === "outcome-value-demonstrated")!.evidenceRefs = ["source-identity-a"]; }
    ];
    for (const mutate of mutations) {
      const input = review();
      mutate(input);
      expect(eligibility({ review: input }).eligible).toBe(false);
    }
  });

  it("rejects undeclared evidence and snapshot or revision mismatches", () => {
    const closure = review();
    closure.capabilityTargetReviews[0]!.evidenceIds = closure.capabilityTargetReviews[0]!.evidenceIds.filter((id) => id !== "semantic-boundary");
    expect(eligibility({ review: closure }).eligible).toBe(false);
    expect(eligibility({ snapshots: [{ ...snapshots[0]!, inspectedCommit: "c".repeat(40) }] }).eligible).toBe(false);
    const records = evidence();
    const outcome = records.find((item) => item.id === "outcome-normal");
    if (outcome?.kind !== "outcome-evaluation") throw new Error("test fixture missing outcome evidence");
    outcome.reviewedCommit = "c".repeat(40);
    expect(eligibility({ records }).eligible).toBe(false);
  });

  it("blocks overdue and upstream-drifted target decisions", () => {
    const context = { schemaVersion: 2 as const, asOf: "2027-01-01T00:00:00Z", privateRcAt: null, upstreamObservations: [{ providerId: "provider-a", snapshotId: "snapshot-a", observedAt: "2027-01-01T00:00:00Z", headCommit: "c".repeat(40) }] };
    const decision = eligibility({ context });
    expect(decision.eligible).toBe(false);
    expect(decision.reasonCodes).toEqual(expect.arrayContaining(["review-overdue", "upstream-drift"]));
  });

  it("does not return high-impact assurance when its structured review is invalid", () => {
    const inputReview = review();
    inputReview.capabilityTargetReviews[0]!.assuranceProfiles = ["high-impact", "standard"];
    const records = evidence();
    records.push({
      schemaVersion: 2,
      id: "high-impact-a",
      reviewId: "review-a",
      providerId: "provider-a",
      snapshotId: "snapshot-a",
      reviewedCommit: commit,
      kind: "high-impact-review",
      scope: { ...target, capabilityId: "capability-a" },
      reviewedArtifactSha256s: ["c".repeat(64)],
      reviewerId: "collector-a",
      collectorId: "collector-a",
      upstreamAuthorIds: ["author-a"],
      independenceAttestation: "independent",
      normalResultEvidenceIds: ["semantic-normal"],
      boundaryResultEvidenceIds: ["semantic-boundary"],
      refusalResultEvidenceIds: ["missing-refusal"],
      decision: "approved",
      observedAt: "2026-07-23T05:39:45Z",
      artifactPath: "research/evidence/artifacts/high-impact-a.json",
      artifactSha256: digest,
      outcome: "passed",
      summary: "invalid"
    });
    inputReview.capabilityTargetReviews[0]!.evidenceIds.push("high-impact-a");
    expect(eligibility({ review: inputReview, records }).assuranceProfiles).not.toContain("high-impact");
  });

  it("returns high-impact assurance only for a complete independent structured review", () => {
    const inputReview = review();
    inputReview.capabilityTargetReviews[0]!.assuranceProfiles = ["high-impact", "standard"];
    inputReview.capabilityTargetReviews[0]!.evidenceIds.push("semantic-refusal", "high-impact-a");
    const records = evidence();
    const normal = records.find((item) => item.id === "semantic-normal");
    if (normal?.kind !== "semantic-smoke") throw new Error("test fixture missing normal semantic evidence");
    records.push(
      { ...normal, id: "semantic-refusal", caseId: "semantic-refusal", caseClass: "refusal" },
      {
        schemaVersion: 2,
        id: "high-impact-a",
        reviewId: "review-a",
        providerId: "provider-a",
        snapshotId: "snapshot-a",
        reviewedCommit: commit,
        kind: "high-impact-review",
        scope: { ...target, capabilityId: "capability-a" },
        reviewedArtifactSha256s: [digest],
        reviewerId: "reviewer-a",
        collectorId: "collector-a",
        upstreamAuthorIds: ["upstream-author-a"],
        independenceAttestation: "independent",
        normalResultEvidenceIds: ["semantic-normal"],
        boundaryResultEvidenceIds: ["semantic-boundary"],
        refusalResultEvidenceIds: ["semantic-refusal"],
        decision: "approved",
        observedAt: "2026-07-23T05:39:45Z",
        artifactPath: "research/evidence/artifacts/high-impact-a.json",
        artifactSha256: digest,
        outcome: "passed",
        summary: "approved"
      }
    );

    expect(eligibility({ review: inputReview, records })).toMatchObject({ eligible: true, assuranceProfiles: ["high-impact", "standard"] });
  });

  it("fails closed for stored-score and score-criteria shape mismatches", () => {
    const missingStoredComponent = review();
    delete (missingStoredComponent.capabilityTargetReviews[0]!.score as unknown as Record<string, number>).nativeInstallability;
    expect(eligibility({ review: missingStoredComponent }).reasonCodes).toContain("score-mismatch");

    const unknownCriterion = review();
    (unknownCriterion.capabilityTargetReviews[0]!.scoreCriteria[0] as { id: string }).id = "unknown-criterion";
    const decision = eligibility({ review: unknownCriterion });
    expect(decision.eligible).toBe(false);
    expect(decision.reasonCodes).toEqual(expect.arrayContaining(["score-incomplete", "score-evidence-mismatch"]));
  });
});
