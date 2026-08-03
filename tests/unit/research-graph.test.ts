import { describe, expect, it } from "vitest";
import type { ResearchRepository } from "../../src/research/repository.js";
import { validateResearchGraph } from "../../src/research/graph.js";

const platforms = ["darwin", "linux", "win32"] as const;
const targets = ["claude-code", "codex"].flatMap((runtime) => platforms.map((platform) => ({ runtime: runtime as "claude-code" | "codex", platform })));

function catalog(role: "required" | "recommended-only" = "required") {
  return {
    completeV1: {
      catalog: { capabilityIds: ["capability-a"] },
      capabilityCollections: [{ capabilities: [{ id: "capability-a" }] }],
      packs: [{
        id: "pack-a",
        requiredCapabilityIds: role === "required" ? ["capability-a"] : [],
        recommendedCapabilityIds: role === "recommended-only" ? ["capability-a"] : []
      }]
    },
    platforms: new Set(platforms),
    expectedCensusSnapshotIds: []
  } as never;
}

function searches(candidateIds: string[] = []) {
  return targets.map(({ runtime, platform }) => ({
    id: `search-${runtime}-${platform}`,
    capabilityId: "capability-a",
    runtime,
    platform,
    candidateIds: candidateIds.slice(),
    searchEvidenceIds: [`evidence-${runtime}-${platform}`]
  }));
}

function searchEvidence(cells = searches()) {
  return cells.map((search) => ({ id: `evidence-${search.runtime}-${search.platform}`, kind: "search-evidence", outcome: "passed", searchRecordId: search.id, capabilityId: search.capabilityId, runtime: search.runtime, platform: search.platform }));
}

function selections(disposition: "selected" | "alternate" | "rejected" | "unavailable", terminalReviewIds: string[] = []) {
  return searches().map((search) => ({
    schemaVersion: 2,
    id: `selection-${search.id}`,
    capabilityId: "capability-a",
    runtime: search.runtime,
    platform: search.platform,
    searchRecordId: search.id,
    disposition,
    ...(disposition === "selected" || disposition === "alternate" ? { preferredProviderId: "provider-a" } : {}),
    alternateProviderIds: [],
    terminalReviewIds: terminalReviewIds.slice(),
    decisionReasons: [disposition],
    releaseEvidence: disposition === "selected" || disposition === "alternate" ? "trialed-p04" : "not-applicable"
  }));
}

function eligibleRouteRepository(disposition: "selected" | "alternate"): ResearchRepository {
  const commit = "a".repeat(40);
  const digest = "b".repeat(64);
  const routeTarget = targets[0]!;
  const cells = searches();
  cells[0]!.candidateIds = ["candidate-a"];
  const staticEvidenceIds = ["documentation-a", "license-a", "maintenance-a", "marketplace-a", "permissions-a", "secret-flow-a", "source-identity-a", "surface-a"];
  const targetEvidenceIds = ["compatibility-a", "doctor-a", "install-a", "lifecycle-a", "outcome-normal", "remove-a", "semantic-boundary", "semantic-normal", "update-a"];
  const gateEvidence = {
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
  const scoreEvidence = {
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
  const base = {
    schemaVersion: 2,
    reviewId: "review-a",
    providerId: "provider-a",
    snapshotId: "snapshot-a",
    reviewedCommit: commit,
    observedAt: "2026-07-23T05:39:45Z",
    artifactPath: "research/evidence/artifacts/a.json",
    artifactSha256: digest,
    outcome: "passed",
    summary: "passed"
  };
  const evidence = [
    ...searchEvidence(cells),
    ...[
      ["documentation-a", "documentation"],
      ["license-a", "license"],
      ["maintenance-a", "maintenance"],
      ["marketplace-a", "marketplace-identity"],
      ["permissions-a", "permissions"],
      ["secret-flow-a", "secret-flow"],
      ["source-identity-a", "source-identity"],
      ["surface-a", "surface-inventory"]
    ].map(([id, kind]) => ({ ...base, id, kind, scope: { runtime: null, platform: null, capabilityId: null } })),
    ...["compatibility", "install-smoke", "update-smoke", "remove-smoke", "doctor-smoke", "lifecycle"].map((kind, index) => ({ ...base, id: ["compatibility-a", "install-a", "update-a", "remove-a", "doctor-a", "lifecycle-a"][index]!, kind, scope: { ...routeTarget, capabilityId: null } })),
    { ...base, id: "semantic-normal", kind: "semantic-smoke", scope: { ...routeTarget, capabilityId: "capability-a" }, caseId: "semantic-normal", caseClass: "normal" },
    { ...base, id: "semantic-boundary", kind: "semantic-smoke", scope: { ...routeTarget, capabilityId: "capability-a" }, caseId: "semantic-boundary", caseClass: "boundary" },
    { ...base, id: "outcome-normal", kind: "outcome-evaluation", scope: { ...routeTarget, capabilityId: "capability-a" }, caseId: "outcome-normal", caseClass: "normal" }
  ];
  const targetReview = {
    ...routeTarget,
    capabilityId: "capability-a",
    decision: "eligible",
    assuranceProfiles: [],
    hardGates: Object.entries(gateEvidence).map(([id, evidenceRefs]) => ({ id, passed: true, evidenceRefs })),
    evidenceIds: targetEvidenceIds,
    scoreCriteria: Object.entries(scoreEvidence).map(([id, evidenceRefs]) => ({ id, evidenceRefs })),
    score: { outcomeFitAndDepth: 40, securityAndTransparency: 20, maintenanceAndUpdateability: 15, nativeInstallability: 15, documentationAndEvaluation: 10 },
    decisionReasons: ["passed"]
  };
  const provider = {
    id: "provider-a",
    sourceReviewId: "review-a",
    capabilityIds: ["capability-a"],
    trustTier: "trusted",
    status: "stable",
    runtimeContracts: [{ runtime: "claude-code", packaging: "agent-skill", runtimeVersionRange: ">=1.0.0", platforms: ["darwin"], repositoryUrl: "https://github.com/example/provider", subdirectory: "skills/provider", ref: "v1", reviewedCommit: commit, artifacts: [{ path: "skills/provider/SKILL.md", sha256: digest }] }]
  };
  const review = {
    id: "review-a",
    providerId: "provider-a",
    candidateId: "candidate-a",
    capabilityIds: ["capability-a"],
    snapshotIds: ["snapshot-a"],
    compatibility: [{ runtime: "claude-code", runtimeVersionRange: ">=1.0.0", platforms: ["darwin"] }],
    evidenceIds: staticEvidenceIds,
    reviewedCommit: commit,
    originalRepository: "https://github.com/example/provider",
    selectedPaths: ["skills/provider"],
    searchRecordIds: [cells[0]!.id],
    capabilityTargetReviews: [targetReview]
  };
  const routeSelections = cells.map((search, index) => ({
    schemaVersion: 2,
    id: `selection-${search.id}`,
    capabilityId: "capability-a",
    runtime: search.runtime,
    platform: search.platform,
    searchRecordId: search.id,
    disposition: index === 0 ? disposition : "unavailable",
    ...(index === 0 ? { preferredProviderId: "provider-a" } : {}),
    alternateProviderIds: [],
    terminalReviewIds: [],
    decisionReasons: [index === 0 ? disposition : "unavailable"],
    releaseEvidence: index === 0 ? "trialed-p04" : "not-applicable"
  }));
  return {
    census: { snapshotIds: [] },
    queue: { candidates: [{ id: "candidate-a", capabilityIds: ["capability-a"], searchTerms: [], targets: [routeTarget], snapshotId: "snapshot-a" }], capabilitySearch: cells },
    providerSelections: routeSelections,
    conflicts: [],
    providers: [provider],
    sourceReviews: [review],
    evidence,
    snapshots: [{ id: "snapshot-a", inspectedCommit: commit }]
  } as unknown as ResearchRepository;
}

describe("target-isolated research graph", () => {
  it("does not require future provider collections in the production-empty state", () => {
    const repository = { census: { snapshotIds: [] }, queue: { candidates: [], capabilitySearch: [] }, providerSelections: [], conflicts: [], providers: [], sourceReviews: [], snapshots: [] } as unknown as ResearchRepository;
    const catalog = { completeV1: { catalog: { capabilityIds: [] } }, platforms: new Set(["darwin"]), expectedCensusSnapshotIds: [] } as never;
    expect(validateResearchGraph(repository, catalog)).toBe(repository);
  });

  it("rejects a provider that has no exact source-review binding", () => {
    const repository = {
      census: { snapshotIds: [] },
      queue: { candidates: [], capabilitySearch: [] },
      providerSelections: [],
      conflicts: [],
      providers: [{ id: "provider-a", sourceReviewId: "missing-review" }],
      sourceReviews: [],
      snapshots: []
    } as unknown as ResearchRepository;
    const catalog = { completeV1: { catalog: { capabilityIds: [] } }, platforms: new Set(["darwin"]), expectedCensusSnapshotIds: [] } as never;

    expect(() => validateResearchGraph(repository, catalog)).toThrow("source review");
  });

  it("rejects a rejected target selection with a nonexistent terminal review", () => {
    const candidate = {
      id: "candidate-a",
      capabilityIds: ["capability-a"],
      searchTerms: [],
      targets,
      snapshotId: "snapshot-a"
    };
    const searches = targets.map(({ runtime, platform }) => ({
      id: `search-${runtime}-${platform}`,
      capabilityId: "capability-a",
      runtime,
      platform,
      candidateIds: ["candidate-a"],
      searchEvidenceIds: [`evidence-${runtime}-${platform}`]
    }));
    const selections = searches.map((search) => ({
      schemaVersion: 2,
      id: `selection-${search.id}`,
      capabilityId: "capability-a",
      runtime: search.runtime,
      platform: search.platform,
      searchRecordId: search.id,
      disposition: "rejected",
      alternateProviderIds: [],
      terminalReviewIds: ["missing-review"],
      decisionReasons: ["rejected"],
      releaseEvidence: "not-applicable"
    }));
    const repository = {
      census: { snapshotIds: [] },
      queue: { candidates: [candidate], capabilitySearch: searches },
      providerSelections: selections,
      conflicts: [],
      providers: [],
      sourceReviews: [],
      evidence: searches.map((search) => ({
        id: `evidence-${search.runtime}-${search.platform}`,
        kind: "search-evidence",
        outcome: "passed",
        searchRecordId: search.id,
        capabilityId: search.capabilityId,
        runtime: search.runtime,
        platform: search.platform
      })),
      snapshots: []
    } as unknown as ResearchRepository;
    const catalog = { completeV1: { catalog: { capabilityIds: ["capability-a"] } }, platforms: new Set(platforms), expectedCensusSnapshotIds: [] } as never;

    expect(() => validateResearchGraph(repository, catalog)).toThrow("terminal review missing-review does not exist");
  });

  it("accepts target-unavailable cells only with exact passed no-candidate search evidence", () => {
    const cells = searches();
    const repository = {
      census: { snapshotIds: [] },
      queue: { candidates: [], capabilitySearch: cells },
      providerSelections: selections("unavailable"),
      conflicts: [],
      providers: [],
      sourceReviews: [],
      evidence: searchEvidence(cells),
      snapshots: []
    } as unknown as ResearchRepository;
    expect(validateResearchGraph(repository, catalog())).toBe(repository);
  });

  it("rejects unavailable cells that retain a candidate or terminal review", () => {
    const candidateCells = searches();
    candidateCells[0]!.candidateIds = ["candidate-a"];
    const candidateRepository = {
      census: { snapshotIds: [] },
      queue: { candidates: [{ id: "candidate-a", capabilityIds: ["capability-a"], searchTerms: [], targets: [targets[0]], snapshotId: "snapshot-a" }], capabilitySearch: candidateCells },
      providerSelections: selections("unavailable"),
      conflicts: [],
      providers: [],
      sourceReviews: [],
      evidence: searchEvidence(candidateCells),
      snapshots: []
    } as unknown as ResearchRepository;
    expect(() => validateResearchGraph(candidateRepository, catalog())).toThrow("unavailable is only valid");

    const terminalRepository = structuredClone(candidateRepository);
    terminalRepository.queue.candidates = [];
    terminalRepository.queue.capabilitySearch[0]!.candidateIds = [];
    const terminalSelections = terminalRepository.providerSelections ?? [];
    terminalSelections[0]!.terminalReviewIds = ["review-a"];
    expect(() => validateResearchGraph(terminalRepository, catalog())).toThrow("unavailable is only valid");
  });

  it("accepts an eligible selected provider route for a required capability", () => {
    const repository = eligibleRouteRepository("selected");
    expect(validateResearchGraph(repository, catalog("required"))).toBe(repository);
  });

  it("accepts an eligible alternate provider route for a recommended-only capability", () => {
    const repository = eligibleRouteRepository("alternate");
    expect(validateResearchGraph(repository, catalog("recommended-only"))).toBe(repository);
  });

  it("rejects an alternate provider route for a required capability", () => {
    const repository = eligibleRouteRepository("alternate");
    expect(() => validateResearchGraph(repository, catalog("required"))).toThrow("alternate requires a recommended-only capability");
  });

  it("rejects selected and alternate routes that are not an eligible target candidate", () => {
    for (const disposition of ["selected", "alternate"] as const) {
      const cells = searches();
      const repository = {
        census: { snapshotIds: [] },
        queue: { candidates: [], capabilitySearch: cells },
        providerSelections: selections(disposition),
        conflicts: [],
        providers: [],
        sourceReviews: [],
        evidence: searchEvidence(cells),
        snapshots: []
      } as unknown as ResearchRepository;
      expect(() => validateResearchGraph(repository, catalog(disposition === "alternate" ? "recommended-only" : "required"))).toThrow("not eligible for this exact target");
    }
  });

  it("requires owned providers and every candidate terminal review, while accepting revoked no-eligible candidates", () => {
    const cells = searches(["candidate-a"]);
    const provider = { id: "provider-a", sourceReviewId: "review-a", capabilityIds: ["capability-a"], runtimeContracts: [] };
    const review = {
      id: "review-a",
      providerId: "provider-a",
      candidateId: "candidate-a",
      capabilityIds: ["capability-a"],
      snapshotIds: [],
      compatibility: [],
      evidenceIds: [],
      reviewedCommit: "a".repeat(40),
      originalRepository: "https://github.com/example/provider",
      selectedPaths: [],
      searchRecordIds: cells.map(({ id }) => id),
      capabilityTargetReviews: targets.map((target) => ({ ...target, capabilityId: "capability-a", decision: "revoked", evidenceIds: [], hardGates: [], scoreCriteria: [], score: {}, assuranceProfiles: [] }))
    };
    const base = {
      census: { snapshotIds: [] },
      queue: { candidates: [{ id: "candidate-a", capabilityIds: ["capability-a"], searchTerms: [], targets, snapshotId: "snapshot-a" }], capabilitySearch: cells },
      providerSelections: selections("rejected", ["review-a"]),
      conflicts: [],
      providers: [provider],
      sourceReviews: [review],
      evidence: searchEvidence(cells),
      snapshots: []
    } as unknown as ResearchRepository;
    expect(validateResearchGraph(base, catalog())).toBe(base);

    const orphaned = structuredClone(base) as ResearchRepository;
    orphaned.providers = [];
    expect(() => validateResearchGraph(orphaned, catalog())).toThrow("must bind an owned provider");

    const mixed = structuredClone(base) as ResearchRepository;
    mixed.queue.candidates.push({ ...mixed.queue.candidates[0]!, id: "candidate-b" });
    mixed.queue.capabilitySearch.forEach((cell) => cell.candidateIds.push("candidate-b"));
    expect(() => validateResearchGraph(mixed, catalog())).toThrow("every target candidate");

    const providerB = { ...mixed.providers[0]!, id: "provider-b", sourceReviewId: "review-b" };
    const reviewB = structuredClone(mixed.sourceReviews[0]!);
    reviewB.id = "review-b";
    reviewB.providerId = "provider-b";
    reviewB.candidateId = "candidate-b";
    reviewB.capabilityTargetReviews.forEach((item) => { item.decision = "rejected"; });
    mixed.providers.push(providerB);
    mixed.sourceReviews.push(reviewB);
    (mixed.providerSelections ?? []).forEach((selection) => selection.terminalReviewIds.push("review-b"));
    expect(validateResearchGraph(mixed, catalog())).toBe(mixed);
  });

  it("rejects a terminal disposition without passed search evidence even when candidates exist", () => {
    const cells = searches(["candidate-a"]);
    cells[0]!.searchEvidenceIds = [];
    const repository = {
      census: { snapshotIds: [] },
      queue: { candidates: [{ id: "candidate-a", capabilityIds: ["capability-a"], searchTerms: [], targets, snapshotId: "snapshot-a" }], capabilitySearch: cells },
      providerSelections: selections("rejected", ["missing-review"]),
      conflicts: [],
      providers: [],
      sourceReviews: [],
      evidence: searchEvidence(cells).filter((item) => item.searchRecordId !== cells[0]!.id),
      snapshots: []
    } as unknown as ResearchRepository;
    expect(() => validateResearchGraph(repository, catalog())).toThrow("terminal disposition requires passed search evidence");
  });
});
