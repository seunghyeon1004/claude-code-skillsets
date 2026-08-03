import { lt, major, valid } from "semver";
import type { TrustTier } from "../model/manifest.js";

export interface UpdateCandidate {
  trustTier: TrustTier;
  current: string;
  next: string;
  licenseChanged: boolean;
  permissionsChanged: boolean;
  ownershipChanged: boolean;
}

export interface UpdateDecision {
  action: "preview" | "review" | "block";
  reasons: string[];
}

export function decideUpdate(candidate: UpdateCandidate): UpdateDecision {
  const current = valid(candidate.current);
  if (current === null) {
    return block("invalid current version");
  }

  const next = valid(candidate.next);
  if (next === null) {
    return block("invalid next version");
  }

  if (lt(next, current)) {
    return block("decreasing next version");
  }

  if (next === current) {
    return review(["next version equals current version"]);
  }

  if (candidate.trustTier === "blocked") {
    return block("blocked trust tier");
  }

  const sensitiveChanges = changedSensitiveFields(candidate);
  if (sensitiveChanges.length > 0) {
    return review(sensitiveChanges);
  }

  if (candidate.trustTier === "community") {
    return review(["community trust tier"]);
  }

  if (major(next) !== major(current)) {
    return review(["major version change"]);
  }

  return {
    action: "preview",
    reasons: [`compatible update for ${candidate.trustTier} source`]
  };
}

function changedSensitiveFields(candidate: UpdateCandidate): string[] {
  const reasons: string[] = [];
  if (candidate.licenseChanged) {
    reasons.push("license changed");
  }
  if (candidate.permissionsChanged) {
    reasons.push("permissions changed");
  }
  if (candidate.ownershipChanged) {
    reasons.push("ownership changed");
  }
  return reasons;
}

function review(reasons: string[]): UpdateDecision {
  return { action: "review", reasons };
}

function block(reason: string): UpdateDecision {
  return { action: "block", reasons: [reason] };
}
