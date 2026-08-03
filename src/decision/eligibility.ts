import type {
  DecisionCandidateProjection,
  DecisionState,
  OfficialTargetCompatibilityEvidence
} from "../model/decision.js";
import type { Platform } from "../model/complete-v1.js";
import type { MaterializedReviewState } from "../research/review-state.js";
import {
  isVerifiedOfficialMarketplaceIdentity,
  type VerifiedOfficialMarketplaceIdentity
} from "./repository.js";

export type TargetCompatibility = "verified" | "incompatible" | "unknown";
export type IndividualSafetyReview = "complete" | "not-complete";

export interface CandidateTargetCompatibilityEvidence {
  candidateId: string;
  runtime: DecisionCandidateProjection["runtime"];
  platform: Platform;
  compatibility: TargetCompatibility;
}

export interface CandidateEligibilityInput {
  candidate: DecisionCandidateProjection;
  runtime: DecisionCandidateProjection["runtime"];
  platform: Platform;
  asOf: string;
  catalogFresh: boolean;
  officialMarketplaceIdentity?: VerifiedOfficialMarketplaceIdentity;
  individualSafetyReview: IndividualSafetyReview;
  targetCompatibility?: CandidateTargetCompatibilityEvidence;
  evidenceCurrent?: boolean;
  materializedState?: MaterializedReviewState;
}

export interface CandidateEligibility {
  state: DecisionState;
  reasons: string[];
}

/** Applies the policy's ordered fail-closed eligibility rules. */
export function assessCandidateEligibility(input: CandidateEligibilityInput): CandidateEligibility {
  const { candidate, materializedState } = input;

  if (candidate.state === "blocked" || materializedState?.state === "blocked") {
    return { state: "blocked", reasons: ["review-blocked"] };
  }
  if (!input.catalogFresh || isStale(materializedState) || hasStaleReason(candidate)) {
    return { state: "held", reasons: [!input.catalogFresh ? "catalog-expired" : "review-stale"] };
  }
  if (isCurrentHumanHold(materializedState)) {
    return { state: "held", reasons: ["review-held"] };
  }
  const targetCompatibility = targetCompatibilityFor(input);
  if (targetCompatibility !== "verified") {
    return {
      state: "held",
      reasons: [`target-${targetCompatibility}:${input.runtime}/${input.platform}`]
    };
  }

  if (input.evidenceCurrent !== true) {
    return { state: "held", reasons: ["capability-evidence-not-current"] };
  }

  const delegatedOfficialClaudeListing = hasVerifiedOfficialMarketplaceIdentity(candidate, input.officialMarketplaceIdentity);
  if (!delegatedOfficialClaudeListing) {
    if (!hasExactApprovedReview(candidate, materializedState)) {
      return { state: "held", reasons: ["exact-path-approval-required"] };
    }
    if (hasUnknownSensitiveField(candidate)) {
      return { state: "held", reasons: ["sensitive-evidence-unknown"] };
    }
    return {
      state: "eligible-with-disclosures",
      reasons: ["exact-path-approved", targetVerifiedReason(input.runtime, input.platform), "evidence-current"]
    };
  }

  return {
    state: "eligible-with-disclosures",
    reasons: [
      "marketplace-listed",
      "individual-safety-review:not-complete",
      "revision-binding:unavailable",
      targetVerifiedReason(input.runtime, input.platform)
    ]
  };
}

export function projectCandidate(input: CandidateEligibilityInput): DecisionCandidateProjection {
  const eligibility = assessCandidateEligibility(input);
  return {
    ...input.candidate,
    state: eligibility.state,
    stateReasons: eligibility.reasons,
    revisionBinding: hasVerifiedOfficialMarketplaceIdentity(input.candidate, input.officialMarketplaceIdentity)
      ? "unavailable"
      : input.candidate.revisionBinding
  };
}

export function targetVerifiedReason(
  runtime: DecisionCandidateProjection["runtime"],
  platform: Platform
): string {
  return `target-verified:${runtime}/${platform}`;
}

export function isCurrentOfficialTargetCompatibilityEvidence(
  evidence: OfficialTargetCompatibilityEvidence,
  asOf: string
): boolean {
  const observedAt = Date.parse(evidence.observedAt);
  const reviewedAt = Date.parse(evidence.reviewedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  const catalogObservedAt = Date.parse(asOf);
  return Number.isFinite(observedAt)
    && Number.isFinite(reviewedAt)
    && Number.isFinite(expiresAt)
    && Number.isFinite(catalogObservedAt)
    && observedAt <= reviewedAt
    && reviewedAt <= catalogObservedAt
    && catalogObservedAt < expiresAt;
}

function hasVerifiedOfficialMarketplaceIdentity(
  candidate: DecisionCandidateProjection,
  identity: VerifiedOfficialMarketplaceIdentity | undefined
): boolean {
  return candidate.runtime === "claude-code"
    && candidate.skillPath === null
    && identity?.pluginName === candidate.id
    && isVerifiedOfficialMarketplaceIdentity(identity, candidate);
}

function isStale(state: MaterializedReviewState | undefined): boolean {
  return state?.reason === "stale" || state?.reason === "stale-evidence";
}

function hasStaleReason(candidate: DecisionCandidateProjection): boolean {
  return candidate.stateReasons.some((reason) => reason === "stale" || reason === "expired");
}

function isCurrentHumanHold(state: MaterializedReviewState | undefined): boolean {
  return state?.state === "held"
    && (state.decisionId !== null || state.reason !== "not-reviewed");
}

function targetCompatibilityFor(input: CandidateEligibilityInput): TargetCompatibility {
  const { candidate, targetCompatibility } = input;
  if (candidate.runtime !== input.runtime) return "incompatible";
  if (targetCompatibility === undefined
    || targetCompatibility.candidateId !== candidate.id
    || targetCompatibility.runtime !== input.runtime
    || targetCompatibility.platform !== input.platform) {
    return "unknown";
  }
  return targetCompatibility.compatibility;
}

function hasExactApprovedReview(
  candidate: DecisionCandidateProjection,
  state: MaterializedReviewState | undefined
): boolean {
  return candidate.skillPath !== null
    && candidate.revisionBinding === "exact"
    && state?.state === "approved"
    && state.skillPath === candidate.skillPath;
}

function hasUnknownSensitiveField(candidate: DecisionCandidateProjection): boolean {
  return [candidate.permissions, candidate.license, candidate.trust, candidate.dependencies]
    .some((field) => field.status === "unknown");
}
