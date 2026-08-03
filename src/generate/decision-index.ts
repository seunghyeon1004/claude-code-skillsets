import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateDecisionIndex } from "../contracts/decision.js";
import {
  DECISION_CATALOG_FRESHNESS_MS,
  assertDecisionIndexIntegrity,
  buildDecisionIntentFixtures,
  decisionIndexDigest
} from "../decision/index-loader.js";
import { projectDecisionCandidates } from "../decision/candidate-projection.js";
import {
  isCurrentOfficialTargetCompatibilityEvidence,
  type CandidateTargetCompatibilityEvidence
} from "../decision/eligibility.js";
import {
  isRootDecisionManifestRepository,
  loadDecisionManifests,
  type DecisionManifestRepository
} from "../decision/repository.js";
import type {
  DecisionCandidateProjection,
  DecisionIndex,
  OfficialTargetCompatibilityEvidence
} from "../model/decision.js";
import type { Platform, TargetReviewEvidence } from "../model/complete-v1.js";
import type { ReviewLedgerEvent } from "../model/review-ledger.js";
import {
  isRootResearchRepository,
  loadResearchRepository,
  type ResearchRepository
} from "../research/repository.js";
import type { MaterializedReviewState } from "../research/review-state.js";
import { snapshotAttestsPath } from "../research/source-binding.js";

/** Materializes the catalog-only decision projection without inventing target trust. */
export async function generateDecisionIndex(root: string): Promise<string> {
  const [repository, research, observedThrough] = await Promise.all([
    loadDecisionManifests(root),
    loadResearchRepository(root),
    loadFixedMaterializationTime(root)
  ]);
  const candidates = projectGeneratedDecisionCandidates({
    repository,
    research,
    observedThrough
  });
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const candidateEvidence = repository.candidateEvidence.map((evidence) => ({
    ...evidence,
    candidate: candidateById.get(evidence.candidateId)!
  }));
  const catalogExpiresAt = utcSeconds(new Date(Date.parse(observedThrough) + DECISION_CATALOG_FRESHNESS_MS));
  const indexWithoutDigest: Omit<DecisionIndex, "digest"> = {
    schemaVersion: 3,
    catalogVersion: repository.digest,
    observedThrough,
    catalogExpiresAt,
    profiles: repository.profiles,
    candidates,
    candidateEvidence,
    intentFixtures: buildDecisionIntentFixtures(repository.profiles, observedThrough),
    ...(repository.starterRoutes === undefined ? {} : { starterRoutes: structuredClone(repository.starterRoutes) })
  };
  const index = validateDecisionIndex({
    ...indexWithoutDigest,
    digest: decisionIndexDigest(indexWithoutDigest)
  });
  assertDecisionIndexIntegrity(index);
  return `${JSON.stringify(index, null, 2)}\n`;
}

export function projectGeneratedDecisionCandidates(input: {
  repository: DecisionManifestRepository;
  research: ResearchRepository;
  observedThrough: string;
}
): DecisionCandidateProjection[] {
  const { repository, research, observedThrough } = input;
  if (!isRootDecisionManifestRepository(repository) || !isRootResearchRepository(research)) {
    throw new Error("generated decision projection requires root-authenticated repositories");
  }
  const materializedReviewState = research.materializedReviewState;
  const evidence = repository.candidateEvidence;
  const projectionIndex = projectionIndexFor(repository, repository.candidates, observedThrough);
  const candidates = new Map<string, DecisionCandidateProjection>();
  for (const candidate of repository.candidates) {
    const targetCompatibility = targetCompatibilityFor(
      candidate,
      repository.officialTargetCompatibilityEvidence,
      materializedStateFor(candidate, materializedReviewState),
      research,
      observedThrough
    );
    const platformReasons = platformReasonsFor(
      candidate,
      targetCompatibility,
      repository.officialTargetCompatibilityEvidence,
      observedThrough
    );
    const materializedState = materializedStateFor(candidate, materializedReviewState);
    const decisionMetadata = decisionMetadataFor(
      candidate,
      targetCompatibility,
      repository.officialTargetCompatibilityEvidence,
      materializedState,
      research,
      observedThrough
    );
    if (candidate.stateReasons.includes("source-drift:unreviewed")) {
      candidates.set(candidate.id, {
        ...candidate,
        state: "held",
        stateReasons: uniqueReasons([...candidate.stateReasons, ...platformReasons]),
        ...decisionMetadata
      });
      continue;
    }
    if (candidate.state === "held"
      && candidate.revisionBinding === "exact"
      && materializedState?.state !== "blocked") {
      candidates.set(candidate.id, {
        ...candidate,
        stateReasons: uniqueReasons([...candidate.stateReasons, ...platformReasons]),
        ...decisionMetadata
      });
      continue;
    }
    if (isDelegatedOfficialCandidate(candidate) && !requiresMaterializedHold(materializedState)) {
      const verifiedTarget = targetCompatibility.some((entry) => entry.platform === "darwin" && entry.compatibility === "verified");
      const declaredNonEligible = candidate.state !== "eligible-with-disclosures";
      candidates.set(candidate.id, {
        ...candidate,
        state: declaredNonEligible
          ? candidate.state
          : (verifiedTarget ? "eligible-with-disclosures" : "held"),
        stateReasons: verifiedTarget
          ? uniqueReasons([
            "marketplace-listed",
            "individual-safety-review:not-complete",
            ...(declaredNonEligible ? candidate.stateReasons.filter((reason) => reason !== "marketplace-listed") : []),
            "revision-binding:unavailable",
            "compatibility-inference:official-source-bound",
            ...platformReasons
          ])
          : uniqueReasons([...candidate.stateReasons, ...platformReasons]),
        ...decisionMetadata
      });
      continue;
    }

    const projectionPlatform = targetCompatibility.find(({ compatibility }) => compatibility === "verified")?.platform ?? "darwin";
    const [projected] = projectDecisionCandidates(projectionIndex, {
      runtime: candidate.runtime,
      platform: projectionPlatform,
      asOf: observedThrough,
      materializedReviewState,
      targetCompatibilityEvidence: targetCompatibility,
      individualSafetyReviewByCandidateId: { [candidate.id]: "complete" }
    }).filter((value) => value.id === candidate.id);
    if (projected === undefined) throw new Error(`${candidate.id}: decision candidate projection is missing`);
    candidates.set(candidate.id, {
      ...projected,
      stateReasons: uniqueReasons([...projected.stateReasons, ...platformReasons]),
      ...decisionMetadata
    });
  }
  return [...candidates.values()].sort((left, right) => compareCodePoints(left.id, right.id));
}

function decisionMetadataFor(
  candidate: DecisionCandidateProjection,
  compatibility: readonly CandidateTargetCompatibilityEvidence[],
  officialEvidence: readonly OfficialTargetCompatibilityEvidence[],
  state: MaterializedReviewState | undefined,
  research: ResearchRepository,
  observedThrough: string
): Pick<DecisionCandidateProjection, "eligibility" | "ranking"> {
  const targetExpiresAt: Partial<Record<Platform, string>> = {};
  const targetEvidenceAt: Partial<Record<Platform, string>> = {};
  const currentOfficial = officialEvidence.filter((item) =>
    item.candidateId === candidate.id && isCurrentCompatibilityInference(item, observedThrough)
  );
  for (const item of currentOfficial) {
    targetExpiresAt[item.platform] = item.expiresAt;
    targetEvidenceAt[item.platform] = item.reviewedAt;
  }
  if (currentOfficial.length > 0) {
    return {
      eligibility: { reviewExpiresAt: null, targetExpiresAt },
      ranking: {
        targetEvidenceAt,
        reviewedAt: null
      }
    };
  }

  const review = state?.decisionId === null || state?.decisionId === undefined
    ? undefined
    : research.reviewLedger.find((event) => event.id === state.decisionId);
  if (review !== undefined) {
    const evidenceIds = new Set(review.runtimeEvidence
      .filter((item) => item.runtime === candidate.runtime && item.compatibility === "verified")
      .flatMap((item) => item.evidenceIds));
    for (const item of research.evidence) {
      if (item.kind !== "compatibility" || !evidenceIds.has(item.id)
        || item.scope.runtime !== candidate.runtime || item.scope.platform === null
        || item.outcome !== "passed") continue;
      if (!compatibility.some((entry) => entry.platform === item.scope.platform && entry.compatibility === "verified")) continue;
      targetExpiresAt[item.scope.platform] = review.expiresAt;
      targetEvidenceAt[item.scope.platform] = item.observedAt;
    }
  }
  return {
    eligibility: { reviewExpiresAt: review?.expiresAt ?? null, targetExpiresAt },
    ranking: { targetEvidenceAt, reviewedAt: review?.reviewedAt ?? null }
  };
}

function platformReasonsFor(
  candidate: DecisionCandidateProjection,
  evidence: readonly CandidateTargetCompatibilityEvidence[],
  officialEvidence: readonly OfficialTargetCompatibilityEvidence[],
  observedThrough: string
): string[] {
  return (["darwin", "linux", "win32"] as const).map((platform) => {
    const matching = evidence.filter((entry) => entry.runtime === candidate.runtime && entry.platform === platform);
    if (matching.length === 1 && matching[0]!.compatibility === "verified") {
      return `target-verified:${candidate.runtime}/${platform}`;
    }
    const official = officialEvidence.filter((entry) => entry.candidateId === candidate.id && entry.platform === platform);
    if (official.length === 1 && !isCurrentCompatibilityInference(official[0]!, observedThrough)) {
      return `compatibility-inference-stale:${candidate.runtime}/${platform}`;
    }
    return `target-unknown:${candidate.runtime}/${platform}`;
  });
}

function targetCompatibilityFor(
  candidate: DecisionCandidateProjection,
  officialEvidence: readonly OfficialTargetCompatibilityEvidence[],
  materializedState: MaterializedReviewState | undefined,
  research: ResearchRepository,
  observedThrough: string
): CandidateTargetCompatibilityEvidence[] {
  const official = officialEvidence
    .filter((entry) => entry.candidateId === candidate.id && isCurrentCompatibilityInference(entry, observedThrough))
    .map((entry) => ({
      candidateId: entry.candidateId,
      runtime: entry.runtime,
      platform: entry.platform,
      compatibility: "verified" as const
    }));
  if (official.length > 0) return official;
  return exactReviewedTargetCompatibility(candidate, materializedState, research, observedThrough);
}

/**
 * The repository loader authenticates every input file and materializes the
 * ledger. This still binds each target result to the exact source, path,
 * decision, commit, runtime, platform and compatibility evidence.
 */
function exactReviewedTargetCompatibility(
  candidate: DecisionCandidateProjection,
  state: MaterializedReviewState | undefined,
  research: ResearchRepository,
  observedThrough: string
): CandidateTargetCompatibilityEvidence[] {
  if (candidate.skillPath === null || state?.state !== "approved" || state.reason !== "current"
    || state.skillPath !== candidate.skillPath || state.decisionId === null) return [];

  const review = research.reviewLedger.find((event) => event.id === state.decisionId
    && event.target.sourceId === candidate.sourceId
    && event.target.skillPath === candidate.skillPath);
  const source = research.sourceConfigs.find((item) => item.sourceId === candidate.sourceId);
  const snapshot = research.snapshots.find((item) => item.id === state.snapshotId);
  if (review === undefined || review.disposition !== "approved" || source === undefined || snapshot === undefined
    || review.baseline.snapshotId !== state.snapshotId
    || review.baseline.inspectedCommit !== state.inspectedCommit
    || review.baseline.contentSha256 !== snapshot.contentSha256
    || snapshot.sourceUrl !== source.repository
    || snapshot.inspectedCommit !== state.inspectedCommit
    || !snapshotAttestsPath(snapshot, candidate.skillPath)
    || Date.parse(snapshot.observedAt) > Date.parse(observedThrough)
    || Date.parse(review.reviewedAt) > Date.parse(observedThrough)
    || Date.parse(review.expiresAt) <= Date.parse(observedThrough)
    || !candidateSensitiveFieldsMatch(candidate, review)) return [];

  const install = candidate.codexInstall;
  if (candidate.runtime === "codex" && (install === undefined
    || install.reviewDecisionId !== review.id
    || install.repository !== source.repository
    || install.commit !== state.inspectedCommit
    || install.skillPath !== candidate.skillPath)) return [];

  const verifiedIds = new Set(review.runtimeEvidence
    .filter((item) => item.runtime === candidate.runtime && item.compatibility === "verified")
    .flatMap((item) => item.evidenceIds));
  return research.evidence
    .filter((item): item is TargetReviewEvidence => item.kind === "compatibility")
    .filter((item) => verifiedIds.has(item.id)
      && item.reviewId === review.id
      && item.providerId === candidate.sourceId
      && item.outcome === "passed"
      && item.scope.runtime === candidate.runtime
      && item.scope.platform !== null
      && item.scope.capabilityId === null
      && item.snapshotId === state.snapshotId
      && item.reviewedCommit === state.inspectedCommit
      && Date.parse(item.observedAt) <= Date.parse(review.reviewedAt)
      && (install === undefined || (item.id === install.compatibilityEvidence
        && item.scope.platform === install.targetPlatform)))
    .map((item) => ({
      candidateId: candidate.id,
      runtime: candidate.runtime,
      platform: item.scope.platform,
      compatibility: "verified" as const
    }));
}

function candidateSensitiveFieldsMatch(
  candidate: DecisionCandidateProjection,
  review: ReviewLedgerEvent
): boolean {
  return candidate.license.status !== "unknown"
    && candidate.permissions.status !== "unknown"
    && candidate.trust.status !== "unknown"
    && candidate.dependencies.status !== "unknown"
    && stableValue(candidate.license) === stableValue(review.reviewedSensitiveFields.license)
    && stableValue(candidate.permissions) === stableValue(review.reviewedSensitiveFields.permissions)
    && stableValue(candidate.trust) === stableValue(review.reviewedSensitiveFields.trust)
    && stableValue(candidate.dependencies) === stableValue(review.reviewedSensitiveFields.dependencies);
}

function projectionIndexFor(
  repository: DecisionManifestRepository,
  candidates: readonly DecisionCandidateProjection[],
  observedThrough: string
): DecisionIndex {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const candidateEvidence = repository.candidateEvidence.map((evidence) => ({
    ...evidence,
    candidate: candidateById.get(evidence.candidateId)!
  }));
  return {
    schemaVersion: 3,
    catalogVersion: repository.digest,
    observedThrough,
    catalogExpiresAt: utcSeconds(new Date(Date.parse(observedThrough) + DECISION_CATALOG_FRESHNESS_MS)),
    profiles: repository.profiles,
    candidates: [...candidates],
    candidateEvidence,
    intentFixtures: [],
    digest: ""
  };
}

function isDelegatedOfficialCandidate(candidate: DecisionCandidateProjection): boolean {
  return candidate.runtime === "claude-code"
    && candidate.sourceId === "anthropic-plugins-official"
    && candidate.skillPath === null
    && candidate.officialBaseline !== undefined;
}

function materializedStateFor(
  candidate: DecisionCandidateProjection,
  states: readonly MaterializedReviewState[]
): MaterializedReviewState | undefined {
  const matching = states.filter((state) => state.sourceId === candidate.sourceId);
  const sourceBlock = matching.find((state) => state.skillPath === null && state.state === "blocked");
  if (sourceBlock !== undefined) return sourceBlock;
  return matching.find((state) => state.skillPath === candidate.skillPath)
    ?? matching.find((state) => state.skillPath === null);
}

function requiresMaterializedHold(state: MaterializedReviewState | undefined): boolean {
  return state?.state === "blocked"
    || state?.reason === "stale"
    || state?.reason === "stale-evidence"
    || (state?.state === "held" && (state.decisionId !== null || state.reason !== "not-reviewed"));
}

function uniqueReasons(reasons: readonly string[]): string[] {
  return reasons.filter((reason, index) => reasons.indexOf(reason) === index);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isCurrentCompatibilityInference(
  evidence: OfficialTargetCompatibilityEvidence,
  observedThrough: string
): boolean {
  return isCurrentOfficialTargetCompatibilityEvidence(evidence, observedThrough);
}

async function loadFixedMaterializationTime(root: string): Promise<string> {
  const path = join(root, "research", "materialized-review-state.json");
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isMaterializedReviewStateDocument(value)) {
    throw new Error("research/materialized-review-state.json: invalid fixed materialization input");
  }
  const timestamp = Date.parse(value.asOf);
  if (!Number.isFinite(timestamp) || !value.asOf.endsWith("Z")) {
    throw new Error("research/materialized-review-state.json: asOf must be an explicit RFC3339 UTC timestamp");
  }
  return value.asOf;
}

function isMaterializedReviewStateDocument(value: unknown): value is { schemaVersion: 3; asOf: string; states: unknown[] } {
  return typeof value === "object" && value !== null
    && "schemaVersion" in value && value.schemaVersion === 3
    && "asOf" in value && typeof value.asOf === "string"
    && "states" in value && Array.isArray(value.states);
}

function compareCodePoints(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftCharacters[index]!.codePointAt(0)!;
    const rightPoint = rightCharacters[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
  return leftCharacters.length === rightCharacters.length ? 0 : (leftCharacters.length < rightCharacters.length ? -1 : 1);
}

function utcSeconds(value: Date): string {
  return value.toISOString().replace(".000Z", "Z");
}
