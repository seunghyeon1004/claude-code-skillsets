import type { DecisionCandidateProjection, DecisionIndex } from "../model/decision.js";
import type { Platform } from "../model/complete-v1.js";
import type { MaterializedReviewState } from "../research/review-state.js";
import { verifiedOfficialMarketplaceIdentityFor } from "./repository.js";
import { isDecisionCatalogCurrent } from "./freshness.js";
import {
  projectCandidate,
  type CandidateEligibilityInput,
  type CandidateTargetCompatibilityEvidence,
  type IndividualSafetyReview
} from "./eligibility.js";

export type { CandidateEligibilityInput } from "./eligibility.js";
export type CandidateProjectionInput = CandidateEligibilityInput;
export { projectCandidate } from "./eligibility.js";

export interface ProjectDecisionCandidatesInput {
  runtime: DecisionCandidateProjection["runtime"];
  platform: Platform;
  asOf: string;
  materializedReviewState?: readonly MaterializedReviewState[];
  targetCompatibilityEvidence?: readonly CandidateTargetCompatibilityEvidence[];
  individualSafetyReviewByCandidateId?: Readonly<Record<string, IndividualSafetyReview | undefined>>;
}

/** Combines immutable candidate evidence with the current materialized review state. */
export function projectDecisionCandidates(
  index: DecisionIndex,
  input: ProjectDecisionCandidatesInput
): DecisionCandidateProjection[] {
  const catalogFresh = isDecisionCatalogCurrent(index.observedThrough, index.catalogExpiresAt, input.asOf);
  return index.candidates.map((candidate) => {
    const materializedState = materializedStateFor(candidate, input.materializedReviewState ?? []);
    const officialMarketplaceIdentity = verifiedOfficialMarketplaceIdentityFor(index, candidate);
    const evidenceCurrent = candidate.capabilityEvidenceIds.length > 0
      && candidate.capabilityEvidenceIds.every((evidenceId) => index.candidateEvidence.some((evidence) =>
        evidence.id === evidenceId && evidence.candidateId === candidate.id && evidence.current
      ));
    return projectCandidate({
      candidate,
      runtime: input.runtime,
      platform: input.platform,
      asOf: input.asOf,
      catalogFresh,
      officialMarketplaceIdentity,
      individualSafetyReview: input.individualSafetyReviewByCandidateId?.[candidate.id]
        ?? (officialMarketplaceIdentity === undefined ? "complete" : "not-complete"),
      targetCompatibility: targetCompatibilityFor(
        candidate,
        input.runtime,
        input.platform,
        input.targetCompatibilityEvidence ?? []
      ),
      evidenceCurrent,
      materializedState
    });
  });
}

function materializedStateFor(
  candidate: DecisionCandidateProjection,
  states: readonly MaterializedReviewState[]
): MaterializedReviewState | undefined {
  const matching = states.filter((state) => state.sourceId === candidate.sourceId);
  const sourceBlock = matching.find((state) => state.skillPath === null && state.state === "blocked");
  if (sourceBlock !== undefined) return sourceBlock;
  const exact = matching.find((state) => state.skillPath === candidate.skillPath);
  if (exact !== undefined) return exact;
  return matching.find((state) => state.skillPath === null);
}

function targetCompatibilityFor(
  candidate: DecisionCandidateProjection,
  runtime: DecisionCandidateProjection["runtime"],
  platform: Platform,
  evidence: readonly CandidateTargetCompatibilityEvidence[]
): CandidateTargetCompatibilityEvidence | undefined {
  const matching = evidence.filter((item) => item.candidateId === candidate.id
    && item.runtime === runtime
    && item.platform === platform);
  return matching.length === 1 ? matching[0] : undefined;
}
