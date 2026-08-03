import type {
  LocalizedText,
  PermissionDeclaration,
  ReleaseStatus,
  TrustTier
} from "./manifest.js";

export const COMPLETE_V1_DOMAIN_IDS = [
  "research-and-intelligence",
  "strategy-and-decision",
  "writing-and-publishing",
  "marketing-and-growth",
  "promotion-and-distribution",
  "sales-and-customer",
  "product-management",
  "project-management",
  "software-engineering",
  "devops-and-security",
  "ai-agents-and-automation",
  "data-and-analytics",
  "design-and-brand",
  "video-and-audio",
  "documents-and-knowledge",
  "business-operations",
  "finance-and-accounting",
  "commerce",
  "people-and-training",
  "legal-risk-and-compliance"
] as const;

export type DomainId = typeof COMPLETE_V1_DOMAIN_IDS[number];
export type Platform = "darwin" | "linux" | "win32";
export type InstallLevel =
  | "essential"
  | "recommended"
  | "domain-full"
  | "advanced"
  | "full-catalog";
export type ScenarioType = "normal" | "boundary" | "refusal";

export const COMPLETE_V1_PACK_IDS = [
  "question-to-cited-research-brief",
  "competitor-landscape-to-opportunity-map",
  "customer-interviews-to-insights",
  "evidence-to-strategic-decision",
  "idea-to-edited-article",
  "source-to-multilingual-publication",
  "product-to-positioning-and-offer",
  "keyword-to-ranked-content",
  "launch-plan-to-multichannel-campaign",
  "long-form-to-social-distribution",
  "account-research-to-personalized-outreach",
  "discovery-call-to-proposal",
  "customer-problem-to-validated-prd",
  "prd-to-prioritized-roadmap",
  "project-brief-to-execution-board",
  "repository-to-implementation-plan",
  "spec-to-tested-feature",
  "bug-report-to-verified-fix",
  "service-to-ci-cd-deployment",
  "incident-alert-to-postmortem",
  "application-to-security-review",
  "use-case-to-agent-design",
  "prototype-to-evaluated-agent",
  "raw-data-to-validated-dataset",
  "business-question-to-dashboard",
  "brief-to-accessible-interface",
  "brand-strategy-to-visual-system",
  "topic-to-recording-ready-script",
  "raw-footage-to-published-video",
  "long-video-to-multiplatform-clips",
  "meeting-to-decisions-and-actions",
  "source-files-to-polished-document",
  "manual-process-to-maintained-sop",
  "repetitive-work-to-approved-automation",
  "transactions-to-management-report",
  "product-idea-to-store-listing",
  "role-need-to-interview-scorecard",
  "expertise-to-training-program",
  "contract-to-risk-and-revision-brief",
  "regulation-to-compliance-checklist"
] as const;

export type PackId = typeof COMPLETE_V1_PACK_IDS[number];

export interface ReplacementEdge {
  replacementPackId: string;
  replacesPackIds: PackId[];
  decisionRef: string;
  reviewer: string;
  requiredCategoryIds: string[];
  requiredCapabilityIds: string[];
  requiredPlatforms: Platform[];
  minimumTrust: Exclude<TrustTier, "blocked">;
  evaluationRefs: string[];
}

export interface CatalogContract {
  schemaVersion: 2;
  releaseTarget: "complete-private-v1";
  domainIds: DomainId[];
  categoryIds: string[];
  capabilityIds: string[];
  initialPackIds: PackId[];
  replacements: ReplacementEdge[];
}

export interface CategoryManifest {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  status: ReleaseStatus;
}

export interface CategoryCollectionManifest {
  schemaVersion: 2;
  domainId: DomainId;
  categories: CategoryManifest[];
}

export interface CapabilityManifest {
  id: string;
  ownerDomainId: DomainId;
  categoryIds: string[];
  outcome: LocalizedText;
  status: ReleaseStatus;
}

export interface CapabilityCollectionManifest {
  schemaVersion: 2;
  domainId: DomainId;
  capabilities: CapabilityManifest[];
}

export interface ScenarioReference {
  id: string;
  type: ScenarioType;
  path: string;
}

export interface ScenarioSpec {
  id: string;
  packId: string;
  caseType: ScenarioType;
  prompt: string;
  expectedBehaviors: string[];
  forbiddenBehaviors: string[];
}

export interface CompletePackManifest {
  schemaVersion: 2;
  id: string;
  domainId: DomainId;
  categoryIds: string[];
  outcome: LocalizedText;
  inputs: string[];
  outputs: string[];
  completionCriteria: string[];
  routingProfileId: DomainId;
  requiredCapabilityIds: string[];
  recommendedCapabilityIds: string[];
  optionalCapabilityIds: string[];
  platforms: Platform[];
  minimumProviderTrust: "trusted";
  assuranceProfile: AssuranceProfile;
  scenarios: ScenarioReference[];
  replacesPackIds: PackId[];
  version: string;
  status: ReleaseStatus;
}

export const SUPPORTED_RUNTIMES = ["claude-code", "codex"] as const;
export type RuntimeId = typeof SUPPORTED_RUNTIMES[number];

export interface RuntimeTarget {
  runtime: RuntimeId;
  platform: Platform;
}

export interface ReviewedArtifact {
  path: string;
  sha256: string;
}

export interface NativePluginRuntimeContract {
  runtime: RuntimeId;
  packaging: "native-plugin";
  runtimeVersionRange: string;
  platforms: Platform[];
  marketplaceId: string;
  marketplaceSource: string;
  pluginId: string;
  reviewedCommit: string;
  artifacts: ReviewedArtifact[];
}

export interface AgentSkillRuntimeContract {
  runtime: RuntimeId;
  packaging: "agent-skill";
  runtimeVersionRange: string;
  platforms: Platform[];
  repositoryUrl: string;
  subdirectory: string;
  ref: string;
  reviewedCommit: string;
  artifacts: ReviewedArtifact[];
}

export type ProviderRuntimeContract = NativePluginRuntimeContract | AgentSkillRuntimeContract;

export interface ProviderManifest {
  schemaVersion: 2;
  id: string;
  capabilityIds: string[];
  sourceReviewId: string;
  permissions: PermissionDeclaration;
  version: string;
  status: ReleaseStatus;
  trustTier: "trusted" | "community" | "blocked";
  runtimeContracts: ProviderRuntimeContract[];
}

export type ProviderSelectionDisposition = "selected" | "alternate" | "rejected" | "unavailable";

export interface ProviderSelectionManifest extends RuntimeTarget {
  schemaVersion: 2;
  id: string;
  capabilityId: string;
  searchRecordId: string;
  disposition: ProviderSelectionDisposition;
  preferredProviderId?: string;
  alternateProviderIds: string[];
  terminalReviewIds: string[];
  decisionReasons: string[];
  releaseEvidence: "trialed-p04" | "not-applicable";
}

export interface ConflictGroupManifest extends RuntimeTarget {
  schemaVersion: 2;
  id: string;
  capabilityId: string;
  mode: "mutually-exclusive" | "redundant" | "composable";
  providerIds: string[];
  rationale: LocalizedText;
}

export type DiscoveryTier = "A" | "B" | "C" | "D";
export type ReviewDecision = "eligible" | "rejected" | "revoked";

export const HARD_GATE_IDS = [
  "bounded-permissions",
  "compatible-runtime-and-platforms",
  "documented-secret-flow",
  "immutable-reviewed-revision",
  "install-and-semantic-smoke",
  "lifecycle-strategy",
  "marketplace-identity-consistent",
  "original-repository-identified",
  "outcome-value-demonstrated",
  "selected-path-license-usable",
  "transparent-bootstrap-and-surfaces"
] as const;

export type HardGateId = typeof HARD_GATE_IDS[number];

export const SCORE_CRITERIA = {
  "fit-capability-coverage": 15,
  "fit-pack-outcome": 15,
  "fit-domain-depth": 10,
  "security-bounded-permissions": 8,
  "security-transparent-surfaces": 6,
  "security-secret-and-data-flow": 6,
  "maintenance-current": 5,
  "maintenance-versioned": 5,
  "maintenance-lifecycle": 5,
  "install-supported-strategy": 8,
  "install-verifiable-identity": 4,
  "install-platform-support": 3,
  "evidence-documentation": 4,
  "evidence-install-smoke": 3,
  "evidence-semantic-smoke": 3
} as const;

export type ScoreCriterionId = keyof typeof SCORE_CRITERIA;

export const SCORE_COMPONENTS = {
  outcomeFitAndDepth: ["fit-capability-coverage", "fit-pack-outcome", "fit-domain-depth"],
  securityAndTransparency: ["security-bounded-permissions", "security-transparent-surfaces", "security-secret-and-data-flow"],
  maintenanceAndUpdateability: ["maintenance-current", "maintenance-versioned", "maintenance-lifecycle"],
  nativeInstallability: ["install-supported-strategy", "install-verifiable-identity", "install-platform-support"],
  documentationAndEvaluation: ["evidence-documentation", "evidence-install-smoke", "evidence-semantic-smoke"]
} as const;

export type SnapshotEntryKind =
  | "marketplace-entry"
  | "plugin-manifest"
  | "skill-file"
  | "repository-record";

export interface ResearchSnapshotEntry {
  kind: SnapshotEntryKind;
  address: string;
  sourceUrl: string | null;
}

export interface ResearchCountMetric {
  kind: SnapshotEntryKind;
  reportedCount: number | null;
  reportedCountSourceUrl: string | null;
  independentlyCountedTotal: number;
}

export interface ResearchSnapshot {
  schemaVersion: 2;
  id: string;
  sourceUrl: string;
  queryUrls: string[];
  observedAt: string;
  inspectedRef: string;
  inspectedCommit: string;
  collectionMethod: "git-tree-and-marketplace-v1";
  toolVersion: string;
  entries: ResearchSnapshotEntry[];
  countMetrics: ResearchCountMetric[];
  contentSha256: string;
}

export const INITIAL_CENSUS_SNAPSHOT_IDS = [
  "2026-07-23-anthropic-plugins-official",
  "2026-07-23-anthropic-skills",
  "2026-07-23-obra-superpowers",
  "2026-07-23-wshobson-agents",
  "2026-07-23-coreyhaines31-marketingskills",
  "2026-07-23-deanpeters-product-manager-skills",
  "2026-07-23-daymade-claude-code-skills",
  "2026-07-23-k-dense-scientific-agent-skills",
  "2026-07-23-huggingface-skills",
  "2026-07-23-chengfeng-videocut-skills",
  "2026-07-23-nexscope-ecommerce-skills",
  "2026-07-23-kepano-obsidian-skills",
  "2026-07-23-alirezarezvani-claude-skills",
  "2026-07-23-jeremylongshore-plugins-plus-skills",
  "2026-07-23-composio-awesome-claude-skills"
] as const;

export interface ResearchCensus {
  schemaVersion: 2;
  id: "initial-discovery-census-2026-07-23";
  purpose: "discovery-only";
  selectionAllowed: false;
  snapshotIds: string[];
}

export interface ReviewSourceTriad {
  sourceId: string;
  receiptId: string;
  snapshotId: string;
}

export interface ReviewSourceIndex {
  schemaVersion: 2;
  triads: ReviewSourceTriad[];
}

export interface ReviewSourceExtensionIndex {
  schemaVersion: 2;
  triads: ReviewSourceTriad[];
}

export interface ResearchEvaluationContext {
  schemaVersion: 2;
  asOf: string;
  privateRcAt: string | null;
  upstreamObservations: Array<{
    providerId: string;
    snapshotId: string;
    observedAt: string;
    headCommit: string;
  }>;
}

export type EvidenceScope =
  | { runtime: null; platform: null; capabilityId: null }
  | { runtime: RuntimeId; platform: Platform; capabilityId: null }
  | { runtime: RuntimeId; platform: Platform; capabilityId: string };

export type StaticEvidenceKind =
  | "source-identity" | "marketplace-identity" | "license"
  | "surface-inventory" | "permissions" | "secret-flow"
  | "maintenance" | "documentation";

export type TargetEvidenceKind =
  | "compatibility" | "install-smoke" | "update-smoke"
  | "remove-smoke" | "doctor-smoke" | "lifecycle";

export type CapabilityTargetEvidenceKind =
  | "outcome-evaluation" | "semantic-smoke" | "high-impact-review";

export interface ReviewEvidenceBase {
  schemaVersion: 2;
  id: string;
  reviewId: string;
  providerId: string;
  snapshotId: string;
  observedAt: string;
  artifactPath: string;
  artifactSha256: string;
  outcome: "passed" | "failed";
  summary: string;
}

export interface StaticReviewEvidence extends ReviewEvidenceBase {
  kind: StaticEvidenceKind;
  scope: { runtime: null; platform: null; capabilityId: null };
  reviewedCommit: string;
}

export interface TargetReviewEvidence extends ReviewEvidenceBase {
  kind: TargetEvidenceKind;
  scope: { runtime: RuntimeId; platform: Platform; capabilityId: null };
  reviewedCommit: string;
}

export interface CapabilityResultEvidence extends ReviewEvidenceBase {
  kind: "outcome-evaluation" | "semantic-smoke";
  scope: { runtime: RuntimeId; platform: Platform; capabilityId: string };
  reviewedCommit: string;
  caseId: string;
  caseClass: "normal" | "boundary" | "refusal";
  outcome: "passed" | "failed";
}

export interface HighImpactReviewEvidence extends ReviewEvidenceBase {
  kind: "high-impact-review";
  scope: { runtime: RuntimeId; platform: Platform; capabilityId: string };
  reviewedCommit: string;
  reviewedArtifactSha256s: string[];
  reviewerId: string;
  collectorId: string;
  upstreamAuthorIds: string[];
  independenceAttestation: string;
  normalResultEvidenceIds: string[];
  boundaryResultEvidenceIds: string[];
  refusalResultEvidenceIds: string[];
  decision: "approved";
}

export interface SearchEvidence {
  schemaVersion: 2;
  id: string;
  kind: "search-evidence";
  searchRecordId: string;
  capabilityId: string;
  runtime: RuntimeId;
  platform: Platform;
  queryTerms: string[];
  sourceUrls: string[];
  snapshotIds: string[];
  observedAt: string;
  artifactPath: string;
  artifactSha256: string;
  outcome: "passed" | "failed";
  summary: string;
}

export interface ObservedMarketplaceIdentityEvidence {
  schemaVersion: 3;
  id: string;
  reviewId: string;
  providerId: string;
  kind: "marketplace-identity";
  observationEvidenceId: string;
  reviewedCommit: string;
  observedArtifactPath: string;
  observedArtifactSha256: string;
  scope: { runtime: null; platform: null; capabilityId: null };
  observedAt: string;
  artifactPath: string;
  artifactSha256: string;
  outcome: "passed" | "failed";
  summary: string;
}

export type ResearchEvidence =
  | StaticReviewEvidence
  | TargetReviewEvidence
  | CapabilityResultEvidence
  | HighImpactReviewEvidence
  | SearchEvidence
  | ObservedMarketplaceIdentityEvidence;

export interface ResearchQueueCandidate {
  id: string;
  capabilityIds: string[];
  snapshotId: string;
  discoverySnapshotId: string;
  discoveryEntryAddress: string;
  searchTerms: string[];
  discoverySourceUrl: string;
  observedAt: string;
  candidateRepository: string;
  candidatePath: string;
  originalRepository: string;
  discoveryTier: DiscoveryTier;
  provenance: "original" | "aggregator-follow-through";
  materiallyDistinctGroup: string;
  targets: RuntimeTarget[];
}

export interface CapabilityTargetSearch extends RuntimeTarget {
  id: string;
  capabilityId: string;
  candidateIds: string[];
  searchEvidenceIds: string[];
}

/**
 * A bounded source-level review record. It is discovery evidence only and
 * never authorizes a marketplace or direct installation.
 */
export interface SourceReviewBacklogCandidate {
  id: string;
  sourceId: string;
  sourceRepository: string;
  status: "review-required";
  snapshotId: string;
  observedAt: string;
  inspectedCommit: string;
  snapshotContentSha256: string;
  representativeSkillPaths: string[];
  domainClassifications: Array<{
    domainId: DomainId;
    representativeSkillPath: string;
  }>;
  reclassification: "next-research-observation";
}

export interface SourceReviewBacklog {
  schemaVersion: 2;
  candidates: SourceReviewBacklogCandidate[];
}

export interface ResearchQueue {
  schemaVersion: 2;
  candidates: ResearchQueueCandidate[];
  capabilitySearch: CapabilityTargetSearch[];
}

export interface ScoreBreakdown {
  outcomeFitAndDepth: number;
  securityAndTransparency: number;
  maintenanceAndUpdateability: number;
  nativeInstallability: number;
  documentationAndEvaluation: number;
}

export interface HardGateResult {
  id: HardGateId;
  passed: boolean;
  evidenceRefs: string[];
}

export interface ScoreCriterionResult {
  id: ScoreCriterionId;
  evidenceRefs: string[];
}

export interface SourceReviewManifest {
  schemaVersion: 2;
  id: string;
  providerId: string;
  candidateId: string;
  searchRecordIds: string[];
  snapshotIds: string[];
  supersedesReviewId?: string;
  discoveryTier: DiscoveryTier;
  originalRepository: string;
  selectedPaths: string[];
  reviewedCommit: string;
  reviewedAt: string;
  marketplaceIdentity: { id: string; source: string } | null;
  observedVersion: string | null;
  licenseConclusion: string;
  lastMeaningfulChange: string;
  surfaces: {
    skills: string[]; commands: string[]; agents: string[]; hooks: string[];
    mcpServers: string[]; scripts: string[]; binaries: string[];
  };
  permissions: PermissionDeclaration;
  secretFlows: Array<{ name: string; documentedIntegrationFlow: boolean }>;
  compatibility: Array<{ runtime: RuntimeId; runtimeVersionRange: string; platforms: Platform[] }>;
  linkedDomainIds: DomainId[];
  linkedCategoryIds: string[];
  linkedPackIds: PackId[];
  capabilityIds: string[];
  removalStrategy: string;
  evidenceIds: string[];
  capabilityTargetReviews: ProviderCapabilityTargetReview[];
  updatePolicy: string;
  nextReviewDate: string;
}

export type AssuranceProfile = "standard" | "high-impact";

export interface ProviderCapabilityTargetReview extends RuntimeTarget {
  capabilityId: string;
  decision: ReviewDecision;
  assuranceProfiles: AssuranceProfile[];
  hardGates: HardGateResult[];
  evidenceIds: string[];
  scoreCriteria: ScoreCriterionResult[];
  score: ScoreBreakdown;
  decisionReasons: string[];
}

export interface ProviderTargetEligibility {
  providerId: string;
  capabilityId: string;
  target: RuntimeTarget;
  eligible: boolean;
  assuranceProfiles: AssuranceProfile[];
  evidenceIds: string[];
  reasonCodes: string[];
}

export type ProviderIneligibilityReason =
  | "revoked"
  | "deleted"
  | "license-changed"
  | "incompatible-update";

export interface InstalledCapabilityProvider {
  capabilityId: string;
  providerId: string;
}

export interface InstalledProviderFailure extends RuntimeTarget {
  providerId: string;
  reason: ProviderIneligibilityReason;
}

export interface InstalledTargetHealth {
  bindings: InstalledCapabilityProvider[];
  failures: InstalledProviderFailure[];
}

export interface ResolvedCapabilityProvider {
  capabilityId: string;
  providerId: string;
  role: "selected" | "alternate";
}

export interface ActionRequiredIssue {
  capabilityId: string;
  providerId: string;
  reason: ProviderIneligibilityReason;
}

export type PackAvailability =
  | "available"
  | "available-with-gaps"
  | "unavailable"
  | "action-required";

export interface PackAvailabilityResult extends RuntimeTarget {
  packId: PackId;
  availability: PackAvailability;
  resolvedProviders: ResolvedCapabilityProvider[];
  missingRequiredCapabilityIds: string[];
  missingRecommendedCapabilityIds: string[];
  actionRequiredIssues: ActionRequiredIssue[];
}

export interface ResearchSourceConfig {
  schemaVersion: 2;
  sourceId: string;
  repository: string;
  queryUrls: string[];
  reportedCountClaims: Array<{
    kind: SnapshotEntryKind;
    count: number;
    sourceUrl: string;
  }>;
  markdownIndexPaths: string[];
}

export interface ResearchCollectionReceipt {
  schemaVersion: 2;
  id: string;
  sourceId: string;
  snapshotId: string;
  observedAt: string;
  inspectedCommit: string;
  collectorVersion: string;
  independentCounts: Array<{ kind: SnapshotEntryKind; count: number }>;
  snapshotContentSha256: string;
}

declare const sanitizedGoalSummaryBrand: unique symbol;

export type SanitizedGoalSummary = string & {
  readonly [sanitizedGoalSummaryBrand]: "SanitizedGoalSummary";
};

export interface GoalSummaryProjection {
  kind: "allowlisted-summary-v1";
  sanitizerVersion: string;
  sourceSha256: string;
}

export interface StructuredRecommendation {
  schemaVersion: 2;
  goalSummary: SanitizedGoalSummary;
  goalSummaryProjection: GoalSummaryProjection;
  inputs: string[];
  outputs: string[];
  domainIds: DomainId[];
  packIds: PackId[];
  evidence: string[];
  unresolvedQuestions: string[];
}

export type OperationKind =
  | "probe" | "marketplace-add" | "verify-marketplace" | "install"
  | "verify-provider" | "state-write" | "update" | "uninstall" | "marketplace-remove";

export interface ApprovedOperation {
  id: string;
  kind: OperationKind;
  platform: Platform;
  providerId?: string;
  commandId: string;
  approvedPlanFingerprint: string;
}

export interface OperationReceipt {
  operationId: string;
  status: "succeeded" | "failed" | "skipped";
  resultCode: string;
}

export interface OwnershipRecord {
  pluginId: string;
  packIds: PackId[];
  managed: boolean;
}

export interface LifecycleState {
  schemaVersion: 2;
  catalogFingerprint: string;
  goalSummarySha256: string;
  domainIds: DomainId[];
  level: InstallLevel;
  packIds: PackId[];
  providerIds: string[];
  marketplaceIdentities: { id: string; source: string }[];
  platform: Platform;
  claudeVersion: string;
  approvedPlanFingerprint: string;
  operations: ApprovedOperation[];
  receipts: OperationReceipt[];
  ownership: OwnershipRecord[];
  resumeCursor?: string;
}

export interface ReleaseEvidenceRow {
  id: string;
  platform: Platform | "cross-platform";
  status: "proven" | "missing" | "contradicted";
  artifactSha256?: string;
  workflowRunId?: string;
}

export interface ReleaseManifest {
  schemaVersion: 2;
  candidateCommit: string;
  catalogFingerprint: string;
  repositoryVisibility: "PUBLIC";
  evidence: ReleaseEvidenceRow[];
  criticalFindings: number;
  importantFindings: number;
}

const validCatalogContract = {
  schemaVersion: 2,
  releaseTarget: "complete-private-v1",
  domainIds: ["software-engineering"],
  categoryIds: ["implementation"],
  capabilityIds: ["implementation-planning"],
  initialPackIds: ["repository-to-implementation-plan"],
  replacements: []
} satisfies CatalogContract;

const invalidDomainCatalogContract: CatalogContract = {
  schemaVersion: 2,
  releaseTarget: "complete-private-v1",
  // @ts-expect-error Domain IDs must be part of the frozen complete-v1 set.
  domainIds: ["unknown"],
  categoryIds: [],
  capabilityIds: [],
  initialPackIds: [],
  replacements: []
};

const invalidSchemaVersionCatalogContract: CatalogContract = {
  // @ts-expect-error The complete-v1 catalog uses schema version 2.
  schemaVersion: 1,
  releaseTarget: "complete-private-v1",
  domainIds: [],
  categoryIds: [],
  capabilityIds: [],
  initialPackIds: [],
  replacements: []
};

const invalidReleaseTargetCatalogContract: CatalogContract = {
  schemaVersion: 2,
  // @ts-expect-error The complete-v1 catalog is private only.
  releaseTarget: "public",
  domainIds: [],
  categoryIds: [],
  capabilityIds: [],
  initialPackIds: [],
  replacements: []
};

void [
  validCatalogContract,
  invalidDomainCatalogContract,
  invalidSchemaVersionCatalogContract,
  invalidReleaseTargetCatalogContract
];
