import type { ProviderManifest, ResearchEvaluationContext, ResearchSnapshot, SourceReviewManifest } from "../model/complete-v1.js";

export interface EvaluationContextFreshness {
  current: boolean;
  reasonCodes: string[];
}

export interface ProviderReviewFreshness {
  current: boolean;
  reasonCodes: string[];
}

export function validateCurrentEvaluationContext(
  baseline: ResearchEvaluationContext,
  current: ResearchEvaluationContext,
  snapshots: readonly ResearchSnapshot[]
): void {
  if (Date.parse(current.asOf) < Date.parse(baseline.asOf)) throw new Error("current evaluation context cannot precede the frozen baseline");
  const snapshotsById = new Set(snapshots.map(({ id }) => id));
  const currentRows = new Set(current.upstreamObservations.map(stableObservation));
  for (const observation of baseline.upstreamObservations) {
    if (!currentRows.has(stableObservation(observation))) throw new Error("current evaluation context cannot remove or rewrite a baseline observation");
  }
  for (const observation of current.upstreamObservations) {
    if (!snapshotsById.has(observation.snapshotId)) throw new Error(`current evaluation context references an unowned snapshot: ${observation.snapshotId}`);
  }
}

export function evaluateEvaluationContextFreshness(
  baseline: ResearchEvaluationContext,
  current: ResearchEvaluationContext
): EvaluationContextFreshness {
  const reasons: string[] = [];
  if (Date.parse(current.asOf) < Date.parse(baseline.asOf)) reasons.push("context-before-baseline");
  if (current.privateRcAt !== null && Date.parse(current.privateRcAt) > Date.parse(current.asOf)) reasons.push("private-rc-after-context");
  return { current: reasons.length === 0, reasonCodes: reasons };
}

/** A selected revision is current only while the review date, RC boundary, and observed upstream head agree. */
export function evaluateProviderReviewFreshness(
  provider: ProviderManifest,
  review: SourceReviewManifest,
  context: ResearchEvaluationContext
): ProviderReviewFreshness {
  const reasons: string[] = [];
  if (review.nextReviewDate < context.asOf.slice(0, 10)) reasons.push("review-overdue");
  if (context.privateRcAt !== null && context.privateRcAt > review.reviewedAt) reasons.push("rc-recheck-required");
  const reviewedCommits = new Set(provider.runtimeContracts.map(({ reviewedCommit }) => reviewedCommit));
  if (context.upstreamObservations.some((observation) => observation.providerId === provider.id
    && (!reviewedCommits.has(observation.headCommit) || observation.headCommit !== review.reviewedCommit))) {
    reasons.push("upstream-drift");
  }
  return { current: reasons.length === 0, reasonCodes: reasons };
}

function stableObservation(value: { providerId: string; snapshotId: string; observedAt: string; headCommit: string }): string {
  return JSON.stringify(value);
}
