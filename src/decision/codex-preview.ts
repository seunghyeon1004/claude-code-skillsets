import type { DecisionCandidateProjection, DecisionPlan } from "../model/decision.js";
import { isDecisionCatalogCurrent } from "./freshness.js";
import { authenticatedDecisionPlanFor } from "./planner.js";
import { verifiedCodexHandoffCandidateFor } from "./repository.js";

export interface CodexPreviewCandidate {
  role: "primary" | "complement";
  candidateId: string;
  repository: string;
  commit: string;
  skillPath: string;
  reviewDecisionId: string;
  compatibilityEvidence: string;
  skillInstaller: {
    skill: "$skill-installer";
    prompt: {
      action: "preview-only";
      repository: string;
      commit: string;
      skillPath: string;
      reviewDecisionId: string;
      compatibilityEvidence: string;
      executionStatus: "not-executed";
    };
  };
}

export interface CodexPreview {
  status: "eligible-with-disclosures" | "held";
  executionStatus: "not-executed";
  provenanceDigest: string;
  candidates: CodexPreviewCandidate[];
  holdReasons: string[];
}

/** Produces a structured, non-executing Codex handoff for exact reviewed skill paths only. */
export function prepareCodexHandoff(plan: DecisionPlan): CodexPreview {
  const authentication = authenticatedDecisionPlanFor(plan);
  if (authentication === undefined) {
    return heldPreview(plan, ["decision-plan-loader-authentication-required"]);
  }
  const selected = [
    { role: "primary" as const, candidate: plan.primary },
    { role: "complement" as const, candidate: plan.complement }
  ].filter((item): item is { role: "primary" | "complement"; candidate: DecisionCandidateProjection } => item.candidate !== null);
  const invalidReasons = selected.flatMap(({ role, candidate }) => codexHoldReasons(
    role,
    candidate,
    authentication.index,
    authentication.input
  ));
  invalidReasons.push(...plan.holdReasons);
  if (plan.status !== "eligible-with-disclosures") invalidReasons.push("decision-plan-not-eligible");
  if (plan.coverageIncomplete) invalidReasons.push("coverage-incomplete");
  if (selected.length === 0) invalidReasons.push("no-planned-candidates");
  if (authentication.input.runtime !== "codex") invalidReasons.push("decision-plan-runtime-not-codex");
  if (!isDecisionCatalogCurrent(authentication.index.observedThrough, authentication.index.catalogExpiresAt, authentication.input.asOf)) {
    invalidReasons.push("decision-plan-as-of-not-current");
  }

  if (invalidReasons.length > 0) {
    return heldPreview(plan, invalidReasons);
  }

  return {
    status: "eligible-with-disclosures",
    executionStatus: "not-executed",
    provenanceDigest: plan.provenanceDigest,
    candidates: selected.map(({ role, candidate }) => {
      const evidence = verifiedCodexHandoffCandidateFor(authentication.index, candidate)!;
      return {
        role,
        candidateId: candidate.id,
        repository: evidence.repository,
        commit: evidence.commit,
        skillPath: evidence.skillPath,
        reviewDecisionId: evidence.reviewDecisionId,
        compatibilityEvidence: evidence.compatibilityEvidence,
        skillInstaller: {
          skill: "$skill-installer",
          prompt: {
            action: "preview-only",
            repository: evidence.repository,
            commit: evidence.commit,
            skillPath: evidence.skillPath,
            reviewDecisionId: evidence.reviewDecisionId,
            compatibilityEvidence: evidence.compatibilityEvidence,
            executionStatus: "not-executed"
          }
        }
      };
    }),
    holdReasons: []
  };
}

function codexHoldReasons(
  role: "primary" | "complement",
  candidate: DecisionCandidateProjection,
  index: Parameters<typeof verifiedCodexHandoffCandidateFor>[0],
  input: { runtime: "claude-code" | "codex"; platform: "darwin" | "linux" | "win32"; asOf: string }
): string[] {
  const prefix = `${role}:${candidate.id}`;
  const reasons: string[] = [];
  if (candidate.runtime !== "codex") reasons.push(`${prefix}:runtime-not-codex`);
  if (candidate.state !== "eligible-with-disclosures") reasons.push(`${prefix}:candidate-not-eligible`);
  if (candidate.revisionBinding !== "exact") reasons.push(`${prefix}:exact-revision-required`);
  if (candidate.skillPath === null) reasons.push(`${prefix}:exact-skill-path-required`);
  const evidence = verifiedCodexHandoffCandidateFor(index, candidate);
  if (evidence === undefined) {
    reasons.push(`${prefix}:loader-authenticated-review-required`);
  } else if (input.runtime !== "codex" || evidence.targetPlatform !== input.platform) {
    reasons.push(`${prefix}:reviewed-target-mismatch`);
  } else if (!isBeforeReviewExpiry(input.asOf, evidence.reviewExpiresAt)) {
    reasons.push(`${prefix}:review-expired-for-plan`);
  }
  return reasons;
}

function heldPreview(plan: DecisionPlan, reasons: readonly string[]): CodexPreview {
  return {
    status: "held",
    executionStatus: "not-executed",
    provenanceDigest: plan.provenanceDigest,
    candidates: [],
    holdReasons: [...new Set(reasons)].sort(compareCodePoints)
  };
}

function isBeforeReviewExpiry(asOf: string, reviewExpiresAt: string): boolean {
  const requested = Date.parse(asOf);
  const expires = Date.parse(reviewExpiresAt);
  return Number.isFinite(requested) && Number.isFinite(expires) && requested < expires;
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
