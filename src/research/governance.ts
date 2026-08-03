import {
  HARD_GATE_IDS,
  SCORE_COMPONENTS,
  SCORE_CRITERIA,
  type AssuranceProfile,
  type CapabilityResultEvidence,
  type HighImpactReviewEvidence,
  type ObservedMarketplaceIdentityEvidence,
  type ProviderManifest,
  type ProviderTargetEligibility,
  type ResearchEvaluationContext,
  type ResearchEvidence,
  type ResearchSnapshot,
  type RuntimeTarget,
  type ScoreBreakdown,
  type ScoreCriterionId,
  type SearchEvidence,
  type SourceReviewManifest
} from "../model/complete-v1.js";
import { evaluateProviderReviewFreshness } from "./freshness.js";
import { compareCodePointStrings } from "./snapshot.js";

type ReviewEvidence = Exclude<
  ResearchEvidence,
  SearchEvidence | ObservedMarketplaceIdentityEvidence
>;
type EvidenceKind = ReviewEvidence["kind"];
type EvidenceRequirement = readonly EvidenceKind[];

/** Every gate is anchored to the smallest immutable evidence class that can prove it. */
const HARD_GATE_EVIDENCE_KINDS: Record<(typeof HARD_GATE_IDS)[number], EvidenceRequirement> = {
  "bounded-permissions": ["permissions"],
  "compatible-runtime-and-platforms": ["compatibility"],
  "documented-secret-flow": ["secret-flow"],
  "immutable-reviewed-revision": ["source-identity"],
  "install-and-semantic-smoke": ["install-smoke", "semantic-smoke"],
  "lifecycle-strategy": ["update-smoke", "remove-smoke", "doctor-smoke", "lifecycle"],
  "marketplace-identity-consistent": ["marketplace-identity"],
  "original-repository-identified": ["source-identity"],
  "outcome-value-demonstrated": ["outcome-evaluation"],
  "selected-path-license-usable": ["license"],
  "transparent-bootstrap-and-surfaces": ["surface-inventory", "documentation"]
};

const SCORE_EVIDENCE_KINDS: Record<ScoreCriterionId, EvidenceRequirement> = {
  "fit-capability-coverage": ["outcome-evaluation"],
  "fit-pack-outcome": ["outcome-evaluation"],
  "fit-domain-depth": ["outcome-evaluation"],
  "security-bounded-permissions": ["permissions"],
  "security-transparent-surfaces": ["surface-inventory"],
  "security-secret-and-data-flow": ["secret-flow"],
  "maintenance-current": ["maintenance"],
  "maintenance-versioned": ["source-identity"],
  "maintenance-lifecycle": ["update-smoke", "lifecycle"],
  "install-supported-strategy": ["install-smoke"],
  "install-verifiable-identity": ["source-identity"],
  "install-platform-support": ["compatibility"],
  "evidence-documentation": ["documentation"],
  "evidence-install-smoke": ["install-smoke"],
  "evidence-semantic-smoke": ["semantic-smoke"]
};

export function evaluateProviderTargetEligibility(input: {
  provider: ProviderManifest;
  review: SourceReviewManifest;
  evidence: readonly ResearchEvidence[];
  capabilityId: string;
  target: RuntimeTarget;
  context?: ResearchEvaluationContext;
  snapshots?: readonly ResearchSnapshot[];
}): ProviderTargetEligibility {
  const { provider, review, capabilityId, target } = input;
  const reasons = new Set<string>();
  const runtimeContract = provider.runtimeContracts.find(({ runtime }) => runtime === target.runtime);
  const targetReview = review.capabilityTargetReviews.find((item) => item.capabilityId === capabilityId
    && item.runtime === target.runtime && item.platform === target.platform);
  const compatibility = review.compatibility.find(({ runtime }) => runtime === target.runtime);
  const runtimeSource = runtimeContract === undefined
    ? undefined
    : (runtimeContract.packaging === "agent-skill" ? runtimeContract.repositoryUrl : runtimeContract.marketplaceSource);

  if (provider.sourceReviewId !== review.id || review.providerId !== provider.id) reasons.add("provider-review-binding-mismatch");
  if (!provider.capabilityIds.includes(capabilityId) || !review.capabilityIds.includes(capabilityId)) reasons.add("capability-not-declared");
  if (runtimeContract === undefined || !runtimeContract.platforms.includes(target.platform)) reasons.add("provider-target-unsupported");
  if (compatibility === undefined || !compatibility.platforms.includes(target.platform)
    || compatibility.runtimeVersionRange !== runtimeContract?.runtimeVersionRange) reasons.add("review-target-incompatible");
  if (review.reviewedCommit !== runtimeContract?.reviewedCommit || review.originalRepository !== runtimeSource) reasons.add("reviewed-identity-mismatch");
  if (runtimeContract !== undefined && runtimeContract.artifacts.some((artifact) => !review.selectedPaths.some((path) => artifact.path === path || artifact.path.startsWith(`${path}/`)))) {
    reasons.add("reviewed-artifact-outside-selected-path");
  }
  if (targetReview === undefined || targetReview.decision !== "eligible") reasons.add(`target-review:${targetReview?.decision ?? "missing"}`);
  if (provider.trustTier !== "trusted") reasons.add("provider-not-trusted");
  if (provider.status !== "stable") reasons.add("provider-not-stable");
  if (input.context !== undefined) {
    for (const reason of evaluateProviderReviewFreshness(provider, review, input.context).reasonCodes) reasons.add(reason);
  }

  const declaredIds = targetReview === undefined
    ? [...review.evidenceIds]
    : [...new Set([...review.evidenceIds, ...targetReview.evidenceIds])];
  const evidenceById = indexEvidence(input.evidence);
  const boundEvidence: ReviewEvidence[] = [];
  for (const id of declaredIds) {
    const matches = evidenceById.get(id) ?? [];
    if (matches.length !== 1 || !isReviewEvidence(matches[0]!)) {
      reasons.add("declared-evidence-unresolved");
      continue;
    }
    const item = matches[0]!;
    if (item.reviewId !== review.id || item.providerId !== provider.id) {
      reasons.add("declared-evidence-identity-mismatch");
      continue;
    }
    boundEvidence.push(item);
  }
  const byId = new Map(boundEvidence.map((item) => [item.id, item]));
  if (byId.size !== declaredIds.length) reasons.add("declared-evidence-closure-incomplete");
  bindEvidenceSnapshots(reasons, boundEvidence, review, input.snapshots);

  const evidencePasses = (id: string, expectedKinds: EvidenceRequirement): boolean => {
    const item = byId.get(id);
    return item !== undefined
      && item.outcome === "passed"
      && item.reviewedCommit === review.reviewedCommit
      && item.reviewedCommit === runtimeContract?.reviewedCommit
      && expectedKinds.includes(item.kind)
      && evidenceScopeMatches(item, capabilityId, target);
  };
  const requirementPasses = (refs: readonly string[], expectedKinds: EvidenceRequirement): boolean => {
    if (refs.length === 0 || refs.some((id) => !evidencePasses(id, expectedKinds))) return false;
    return expectedKinds.every((kind) => refs.some((id) => byId.get(id)?.kind === kind && evidencePasses(id, expectedKinds)));
  };

  const gates = targetReview?.hardGates ?? [];
  if (gates.length !== HARD_GATE_IDS.length || HARD_GATE_IDS.some((id) => {
    const gate = gates.find((item) => item.id === id);
    return gate === undefined || !gate.passed || !requirementPasses(gate.evidenceRefs, HARD_GATE_EVIDENCE_KINDS[id]);
  })) {
    reasons.add("hard-gates-incomplete");
  }
  if (targetReview === undefined || targetReview.evidenceIds.length === 0 || targetReview.evidenceIds.some((id) => !byId.has(id))) reasons.add("review-evidence-unbound");

  const result = (kind: CapabilityResultEvidence["kind"], caseClass: CapabilityResultEvidence["caseClass"]) => boundEvidence.some((item): item is CapabilityResultEvidence =>
    (item.kind === "semantic-smoke" || item.kind === "outcome-evaluation") && item.kind === kind && item.caseClass === caseClass
      && evidencePasses(item.id, [kind])
  );
  const standard = result("semantic-smoke", "normal") && result("semantic-smoke", "boundary") && result("outcome-evaluation", "normal");
  if (!standard) reasons.add("standard-assurance-unproven");
  const highImpact = standard && result("semantic-smoke", "refusal") && boundEvidence.some((item): item is HighImpactReviewEvidence =>
    item.kind === "high-impact-review" && evidencePasses(item.id, ["high-impact-review"])
      && highImpactReferencesBind(item, byId, capabilityId, target, review.reviewedCommit, runtimeContract?.artifacts.map(({ sha256 }) => sha256) ?? [])
  );
  const declaredProfiles = targetReview?.assuranceProfiles ?? [];
  if (declaredProfiles.includes("high-impact") && !highImpact) reasons.add("high-impact-assurance-unproven");

  const score = targetReview === undefined ? zeroScore() : recomputeScore(targetReview.scoreCriteria, requirementPasses);
  if (targetReview === undefined || !hasExactScoreCriteria(targetReview.scoreCriteria)) reasons.add("score-incomplete");
  if (targetReview !== undefined && targetReview.scoreCriteria.some((criterion) => {
    const expectedKinds = scoreEvidenceKinds(criterion.id);
    return expectedKinds === undefined || !requirementPasses(criterion.evidenceRefs, expectedKinds);
  })) reasons.add("score-evidence-mismatch");
  if (targetReview === undefined || !sameScore(targetReview.score, score)) reasons.add("score-mismatch");
  const assuranceProfiles: AssuranceProfile[] = declaredProfiles.filter((profile) => profile === "standard" ? standard : highImpact).sort(compareCodePointStrings);
  return {
    providerId: provider.id,
    capabilityId,
    target: { ...target },
    eligible: reasons.size === 0,
    assuranceProfiles,
    evidenceIds: [...byId.keys()].sort(compareCodePointStrings),
    reasonCodes: [...reasons].sort(compareCodePointStrings)
  };
}

function isReviewEvidence(evidence: ResearchEvidence): evidence is ReviewEvidence {
  return evidence.kind !== "search-evidence"
    && !(evidence.schemaVersion === 3 && evidence.kind === "marketplace-identity");
}

function indexEvidence(evidence: readonly ResearchEvidence[]): ReadonlyMap<string, readonly ResearchEvidence[]> {
  const indexed = new Map<string, ResearchEvidence[]>();
  for (const item of evidence) indexed.set(item.id, [...(indexed.get(item.id) ?? []), item]);
  return indexed;
}

function bindEvidenceSnapshots(
  reasons: Set<string>,
  evidence: readonly ReviewEvidence[],
  review: SourceReviewManifest,
  snapshots: readonly ResearchSnapshot[] | undefined
): void {
  if (snapshots === undefined) {
    reasons.add("snapshot-closure-missing");
    return;
  }
  const byId = new Map<string, ResearchSnapshot[]>();
  for (const snapshot of snapshots) byId.set(snapshot.id, [...(byId.get(snapshot.id) ?? []), snapshot]);
  for (const item of evidence) {
    const matches = byId.get(item.snapshotId) ?? [];
    if (!review.snapshotIds.includes(item.snapshotId) || matches.length !== 1 || matches[0]!.inspectedCommit !== review.reviewedCommit) {
      reasons.add("evidence-snapshot-mismatch");
    }
  }
}

function evidenceScopeMatches(item: ReviewEvidence, capabilityId: string, target: RuntimeTarget): boolean {
  if (item.scope.runtime === null) return item.scope.platform === null && item.scope.capabilityId === null;
  if (item.scope.runtime !== target.runtime || item.scope.platform !== target.platform) return false;
  return item.scope.capabilityId === null || item.scope.capabilityId === capabilityId;
}

function recomputeScore(
  criteria: readonly { id: ScoreCriterionId; evidenceRefs: string[] }[],
  requirementPasses: (refs: readonly string[], expectedKinds: EvidenceRequirement) => boolean
): ScoreBreakdown {
  const passing = new Set(criteria.filter((criterion) => {
    const expectedKinds = scoreEvidenceKinds(criterion.id);
    return expectedKinds !== undefined && requirementPasses(criterion.evidenceRefs, expectedKinds);
  }).map(({ id }) => id));
  return Object.fromEntries(Object.entries(SCORE_COMPONENTS).map(([component, ids]) => [component, ids.reduce((total, id) => total + (passing.has(id) ? SCORE_CRITERIA[id] : 0), 0)])) as unknown as ScoreBreakdown;
}

function scoreEvidenceKinds(id: string): EvidenceRequirement | undefined {
  return (SCORE_EVIDENCE_KINDS as Partial<Record<string, EvidenceRequirement>>)[id];
}

function hasExactScoreCriteria(criteria: readonly { id: ScoreCriterionId; evidenceRefs: string[] }[]): boolean {
  const ids = criteria.map(({ id }) => id).sort(compareCodePointStrings);
  const expected = Object.keys(SCORE_CRITERIA).sort(compareCodePointStrings);
  return ids.length === expected.length && ids.every((id, index) => id === expected[index]);
}

function zeroScore(): ScoreBreakdown {
  return { outcomeFitAndDepth: 0, securityAndTransparency: 0, maintenanceAndUpdateability: 0, nativeInstallability: 0, documentationAndEvaluation: 0 };
}

function sameScore(left: ScoreBreakdown, right: ScoreBreakdown): boolean {
  const components = Object.keys(SCORE_COMPONENTS) as Array<keyof ScoreBreakdown>;
  return Object.keys(left).length === components.length
    && Object.keys(right).length === components.length
    && components.every((component) => left[component] === right[component]);
}

function highImpactReferencesBind(
  review: HighImpactReviewEvidence,
  evidence: ReadonlyMap<string, ReviewEvidence>,
  capabilityId: string,
  target: RuntimeTarget,
  commit: string,
  artifactHashes: readonly string[]
): boolean {
  if (review.reviewerId === review.collectorId || review.upstreamAuthorIds.includes(review.reviewerId)
    || review.decision !== "approved" || !sameSet(review.reviewedArtifactSha256s, artifactHashes)) return false;
  const classes: Array<[readonly string[], CapabilityResultEvidence["caseClass"]]> = [
    [review.normalResultEvidenceIds, "normal"],
    [review.boundaryResultEvidenceIds, "boundary"],
    [review.refusalResultEvidenceIds, "refusal"]
  ];
  const ids = classes.flatMap(([items]) => items);
  return ids.length === new Set(ids).size && classes.every(([items, caseClass]) => items.every((id) => {
    const item = evidence.get(id);
    return item?.kind === "semantic-smoke" && item.outcome === "passed" && item.caseClass === caseClass
      && evidenceScopeMatches(item, capabilityId, target) && item.reviewedCommit === commit;
  }));
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}
