import type { RequiredCheckBinding } from "../governance/branch-protection.js";

export const REVIEWER_ROLES = ["source-reviewer", "security-reviewer", "maintainer"] as const;

export type ReviewerRole = typeof REVIEWER_ROLES[number];
export type ReviewDisposition = "approved" | "held" | "blocked";
export type RuntimeCompatibility = "verified" | "incompatible" | "unknown";
export type EvidenceStatus = "observed" | "unknown" | "not-applicable";

export interface SensitiveFieldEvidence<T = string | string[]> {
  status: EvidenceStatus;
  value?: T;
  evidence: Array<{ path: string; contentSha256: string }>;
}

export interface ReviewLedgerEvent {
  sequence: number;
  id: string;
  previousEventHash: string | null;
  target: { sourceId: string; skillPath: string | null };
  disposition: ReviewDisposition;
  supersedes: string | null;
  baseline: {
    snapshotId: string;
    inspectedCommit: string;
    contentSha256: string;
    pathBlobSha: string | null;
    inheritedEvidenceDigest: string;
  };
  reasonCode: string;
  reason: { ko: string; en: string };
  reviewedSensitiveFields: {
    license: SensitiveFieldEvidence<string>;
    permissions: SensitiveFieldEvidence<string[]>;
    ownership: SensitiveFieldEvidence<string>;
    trust: SensitiveFieldEvidence<string>;
    dependencies: SensitiveFieldEvidence<string[]>;
    executableSurface: SensitiveFieldEvidence<string[]>;
  };
  runtimeEvidence: Array<{
    runtime: "claude-code" | "codex";
    compatibility: RuntimeCompatibility;
    evidenceIds: string[];
  }>;
  reviewerId: string;
  reviewedAt: string;
  expiresAt: string;
  eventHash: string;
}

export interface ReviewerRegistry {
  schemaVersion: 3;
  reviewers: Array<{ id: string; roles: ReviewerRole[] }>;
}

export interface LedgerState {
  events: ReviewLedgerEvent[];
  leaves: ReviewLedgerEvent[];
}

export interface BranchProtectionReceipt {
  schemaVersion: 3;
  repository: string;
  repositoryId: number;
  repositoryOwnerLogin: string;
  repositoryOwnerType: "User" | "Organization";
  commitSha: string;
  branch: string;
  observedAt: string;
  directPushesDisabled: boolean;
  forcePushesDisabled: boolean;
  deletionsDisabled: boolean;
  requiredChecks: RequiredCheckBinding[];
  minimumApprovals: number;
  dismissesStaleReviews: boolean;
  requiresCodeOwnerReview: boolean;
  governanceMode: "solo-maintainer";
  humanReviewGuarantee: "not-guaranteed";
}
