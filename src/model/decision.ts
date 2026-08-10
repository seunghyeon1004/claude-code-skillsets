import type { DomainId, Platform } from "./complete-v1.js";

export type DecisionState = "eligible-with-disclosures" | "held" | "blocked";

export interface SensitiveFieldEvidence<T = string | string[]> {
  status: "observed" | "unknown" | "not-applicable";
  value?: T;
  evidence: Array<{ path: string; contentSha256: string }>;
}

export interface IntentProfile {
  id: string;
  domainId: DomainId;
  phrases: { ko: string[]; en: string[] };
  coreCapabilityId: string;
  requiredCapabilityIds: string[];
}

export interface DecisionCandidateProjection {
  id: string;
  /** Present only on an append-only source revision or its current projection. */
  candidateRevisionId?: string;
  /** Source-authenticated marketplace or reviewed skill display metadata. */
  displayName?: string;
  description?: string;
  sourceId: string;
  skillPath: string | null;
  runtime: "claude-code" | "codex";
  state: DecisionState;
  stateReasons: string[];
  providedCapabilityIds: string[];
  capabilityEvidenceIds: string[];
  revisionBinding: "exact" | "unavailable";
  permissions: SensitiveFieldEvidence<string[]>;
  license: SensitiveFieldEvidence<string>;
  trust: SensitiveFieldEvidence<string>;
  dependencies: SensitiveFieldEvidence<string[]>;
  /** Authenticated validity bounds used for plan-time fail-closed checks. */
  eligibility?: {
    reviewExpiresAt: string | null;
    targetExpiresAt: Partial<Record<Platform, string>>;
  };
  /** Authenticated temporal inputs for deterministic candidate ranking. */
  ranking?: {
    targetEvidenceAt: Partial<Record<Platform, string>>;
    reviewedAt: string | null;
  };
  /** Immutable marketplace identity required by delegated official-source evidence. */
  officialBaseline?: OfficialMarketplaceBaseline;
  /** Generated only from a root-validated official marketplace observation. */
  claudeInstall?: ClaudeOfficialInstallBinding;
  codexInstall?: CodexInstallEvidence;
}

export interface OfficialMarketplaceBaseline {
  reference: string;
  marketplaceManifestSha256: string;
  pluginName: string;
  sourceUrl: string;
  sourceCommit: string;
  sourceBlobs: OfficialMarketplaceSourceBlob[];
}

/** Immutable upstream source identities retained as non-installable research metadata. */
export interface OfficialMarketplaceSourceBlob {
  path: string;
  immutableRawUrl: string;
  contentSha256: string;
}

/** A literal, approval-bound Claude Code marketplace operation. */
export interface ClaudeOfficialInstallBinding {
  sourceId: string;
  pluginName: string;
  marketplaceId: string;
  marketplaceSource: string;
  scope: "user";
  argv: ["claude", "plugin", "install", string, "--scope", "user"];
}

/** Exact reviewed provenance required before Codex may show an installer handoff. */
export interface CodexInstallEvidence {
  repository: string;
  commit: string;
  skillPath: string;
  reviewDecisionId: string;
  compatibilityEvidence: string;
  targetPlatform: Platform;
}

export interface CandidateCapabilityEvidence {
  id: string;
  candidateId: string;
  candidateRevisionId?: string;
  capabilityId: string;
  kind: "official-baseline" | "official-listing" | "observation";
  current: boolean;
  reference: string;
  contentSha256: string;
  artifactPath?: string;
  artifactSha256?: string;
  support?: "direct" | "inferred" | "related";
  sourceBlobs?: OfficialMarketplaceSourceBlob[];
  listingExcerpt?: string;
  listingExcerptSha256?: string;
}

export interface OfficialListingClaimsManifest {
  schemaVersion: 1;
  compatibilityAttestation: OfficialClaudeCompatibilityAttestation;
  candidates: OfficialListingCandidateClaims[];
}

export interface OfficialClaudeCompatibilityAttestation {
  id: string;
  sourceId: "anthropic-plugins-official";
  runtime: "claude-code";
  platform: "darwin";
  compatibility: "verified";
  kind: "official-source-bound-inference";
  observedAt: string;
  reviewedAt: string;
  expiresAt: string;
  sourceUrls: string[];
  disclosures: string[];
}

export interface OfficialListingCandidateClaims {
  pluginName: string;
  marketplaceReference: string;
  sourcePin: { kind: "external-sha" | "marketplace-commit"; sha: string };
  assignments: OfficialListingDomainAssignment[];
}

export interface OfficialListingDomainAssignment {
  domainId: DomainId;
  capabilityClaims: OfficialListingCapabilityClaim[];
}

export interface OfficialListingCapabilityClaim {
  id: string;
  capabilityId: string;
  /** `related` is marketplace relevance only and never provides capability coverage. */
  support: "direct" | "inferred" | "related";
  listingExcerpt: string;
  listingExcerptSha256: string;
}

/**
 * A dated compatibility conclusion limited to what named official sources state.
 * It is deliberately distinct from an install smoke test or individual safety review.
 */
export interface OfficialTargetCompatibilityEvidence {
  id: string;
  candidateId: string;
  candidateRevisionId?: string;
  sourceId: string;
  runtime: "claude-code" | "codex";
  platform: Platform;
  compatibility: "verified";
  kind: "official-source-bound-inference";
  observedAt: string;
  reviewedAt: string;
  expiresAt: string;
  snapshot: {
    id: string;
    sourceUrl: string;
    marketplaceEntryUrl: string;
    marketplaceEntrySourceUrl: string;
    marketplaceEntrySourceCommit: string;
    digest: string;
  };
  sourceUrls: string[];
  disclosures: string[];
  evidenceDigest: string;
}

export interface CapabilityEvidence extends CandidateCapabilityEvidence {
  candidate: DecisionCandidateProjection;
}

export interface DecisionIntentsManifest {
  schemaVersion: 3;
  profiles: IntentProfile[];
}

export interface DecisionCandidateEvidenceManifest {
  schemaVersion: 3;
  candidates: DecisionCandidateProjection[];
  candidateRevisions?: CandidateRevision[];
  evidence: CandidateCapabilityEvidence[];
  officialTargetCompatibilityEvidence?: OfficialTargetCompatibilityEvidence[];
}

export type SourceDecisionCandidate = Omit<
  DecisionCandidateProjection,
  "claudeInstall" | "eligibility" | "ranking"
>;

export interface CandidateRevisionApproval {
  kind: "exact-candidate-rebind";
  disposition: DecisionState;
  reviewerId: string;
  reviewedAt: string;
  sourceCommit: string;
  marketplaceManifestSha256: string;
  candidateIdentity: string;
  observedArtifactPath: string;
  observedArtifactSha256: string;
  observationEvidenceId: string;
  evidenceArtifactPath: string;
  evidenceArtifactSha256: string;
  evidenceIds: string[];
  digest: string;
}

export interface CandidateRevision {
  id: string;
  candidateId: string;
  previousRevisionId: string | null;
  candidate: SourceDecisionCandidate;
  approval: CandidateRevisionApproval;
}

export interface DecisionStarterRoutesManifest {
  schemaVersion: 1;
  routes: DecisionStarterRoute[];
}

export interface DecisionStarterRoute {
  domainId: DomainId;
  kind: "starter-partial";
  orderedCandidateIds: string[];
  smallestHonestProfile: { ko: string; en: string };
  directEvidenceIds: string[];
  inferredEvidenceIds: string[];
  /** Current marketplace relevance evidence for an explicitly unsupported capability. */
  relatedEvidenceIds?: string[];
  unsupportedCapabilityIds: string[];
  broadCoverageComplete: false;
}

export type PlannedCandidate = DecisionCandidateProjection;

/** A current candidate that the plan deliberately did not select. */
export interface DecisionExcludedCandidate {
  candidateId: string;
  sourceId: string;
  state: DecisionState;
  stateReasons: string[];
}

export interface DecisionIntentFixture {
  id: string;
  runtime: "claude-code" | "codex";
  platform: "darwin" | "linux" | "win32";
  asOf: string;
  goal?: string;
  domainIds?: DomainId[];
  domainPriority?: DomainId[];
}

export interface DecisionPlan {
  status: DecisionState;
  goal: string | null;
  domainIds: DomainId[];
  primary: PlannedCandidate | null;
  complement: PlannedCandidate | null;
  /** `starter-partial` is a bounded route, not a claim of broad-domain coverage. */
  planKind: "complete" | "starter-partial";
  /** Whether the selected domain came from an explicit input or a reviewed goal phrase. */
  selectionBasis: "explicit-domain" | "goal-match";
  /** Present only for a selected authenticated starter route. */
  smallestHonestProfile: { ko: string; en: string } | null;
  /** True only when the selected plan has complete coverage for its selected scope. */
  broadCoverageComplete: boolean;
  coverageIncomplete: boolean;
  /** Current direct capability evidence in a starter route. */
  directCapabilityIds: string[];
  /** Current inferred capability evidence in a starter route, excluding direct evidence. */
  inferredCapabilityIds: string[];
  /** Current related capability evidence. Related evidence never provides coverage. */
  relatedCapabilityIds: string[];
  uncoveredCapabilityIds: string[];
  holdReasons: string[];
  excludedCandidates: DecisionExcludedCandidate[];
  requiresDomainPrioritySelection: boolean;
  executionStatus: "not-executed";
  provenanceDigest: string;
}

export interface DecisionIndex {
  schemaVersion: 3;
  catalogVersion: string;
  observedThrough: string;
  catalogExpiresAt: string;
  profiles: IntentProfile[];
  candidates: DecisionCandidateProjection[];
  candidateEvidence: CapabilityEvidence[];
  intentFixtures: DecisionIntentFixture[];
  /** Present only when an authenticated starter-route manifest exists. */
  starterRoutes?: DecisionStarterRoute[];
  digest: string;
}

/** Bounded model-readable routing data bound to one complete decision index. */
export interface DecisionRoutingIndex {
  schemaVersion: 1;
  catalogVersion: string;
  observedThrough: string;
  catalogExpiresAt: string;
  profiles: IntentProfile[];
  decisionIndexDigest: string;
  digest: string;
}

/** Bounded non-installing candidate context projected only from authenticated starter routes. */
export interface DecisionDiscoveryCandidate {
  candidateId: string;
  displayName?: string;
  sourceId: string;
  domainIds: DomainId[];
  state: DecisionState;
  stateReasons: string[];
  evidenceSupport: Array<"direct" | "inferred" | "related">;
  installable: false;
}

export interface ManagedInstallReceipt {
  managedBy: "claude-code-skillsets";
  decisionPlanDigest: string;
  pluginName: string;
  marketplaceId: string;
  marketplaceSource: string;
  scope: "user" | "project" | "local";
  preInstallVersion: string | null;
  postInstallVersion: string | null;
  versionStatus: "observed-semver" | "unknown";
  observedAt: string;
  installCommandDigest: string;
}
