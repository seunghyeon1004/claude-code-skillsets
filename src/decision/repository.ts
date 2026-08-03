import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  validateDecisionCandidateEvidence,
  validateDecisionIndex,
  validateDecisionIntents,
  validateDecisionStarterRoutesSemantics
} from "../contracts/decision.js";
import {
  loadOfficialMarketplaceSelection,
  OFFICIAL_MARKETPLACE_SOURCE,
  officialMarketplaceCandidateIdentity,
  validateOfficialMarketplaceArtifact
} from "../discovery/official-marketplace.js";
import {
  materializeOfficialListingClaims,
  validateOfficialListingClaims
} from "./official-listing-claims.js";
import { resolveCandidateRevisionProjection } from "./candidate-revisions.js";
import {
  loadCompleteV1Repository,
  type CompleteV1Repository
} from "../manifest/complete-v1-repository.js";
import { loadYaml } from "../manifest/load.js";
import { COMPLETE_V1_DOMAIN_IDS } from "../model/complete-v1.js";
import type {
  CapabilityManifest,
  DomainId,
  ResearchEvidence
} from "../model/complete-v1.js";
import type {
  CandidateCapabilityEvidence,
  CapabilityEvidence,
  DecisionCandidateEvidenceManifest,
  DecisionCandidateProjection,
  DecisionIndex,
  IntentProfile,
  OfficialMarketplaceBaseline as CandidateOfficialMarketplaceBaseline,
  OfficialTargetCompatibilityEvidence,
  DecisionStarterRoute
} from "../model/decision.js";
import type { ReviewLedgerEvent } from "../model/review-ledger.js";
import { deepFreezeRepositoryData } from "../repository/deep-freeze-data.js";
import {
  canonicalizeContainedReadRoot,
  readContainedRegularFile
} from "../repository/contained-read.js";
import { validateReviewerRegistry } from "../contracts/review-ledger.js";
import { isCanonicalRepositoryRelativePosixPath, snapshotAttestsPath } from "../research/source-binding.js";
import { parseReviewLedgerJsonl, verifyReviewLedger } from "../research/review-ledger.js";
import {
  createAuthenticatedSourceObservationLoader,
  loadResearchRepository,
  type AuthenticatedSourceObservation
} from "../research/repository.js";
import {
  materializeSourceObservationContexts,
  resolveLatestEffectiveSourceObservation,
  type ReviewStateObservation
} from "../research/source-observation.js";
import { isExactReviewDecisionCurrent } from "../research/review-state.js";
import { canonicalize } from "../research/canonical-json.js";
import { compareCodePointStrings } from "../research/snapshot.js";
import { assertDecisionIndexIntegrity } from "./index-loader.js";
import { isCurrentOfficialTargetCompatibilityEvidence, targetVerifiedReason } from "./eligibility.js";

export interface DecisionManifestRepository {
  profiles: IntentProfile[];
  candidates: DecisionCandidateProjection[];
  candidateEvidence: CapabilityEvidence[];
  officialTargetCompatibilityEvidence: OfficialTargetCompatibilityEvidence[];
  /** Present only when the optional source manifest authenticates it. */
  starterRoutes?: DecisionStarterRoute[];
  digest: string;
}

/** Runtime-only authorization derived from a root-validated marketplace artifact. */
export interface VerifiedOfficialMarketplaceIdentity {
  marketplaceId: string;
  pluginName: string;
  displayName: string;
  description: string;
  marketplaceSource: string;
  scope: "user";
  argv: ["claude", "plugin", "install", string, "--scope", "user"];
  installRoute: string;
}

type SourceObservation = AuthenticatedSourceObservation;
type SourceObservationLoader = (sourceId: string) => Promise<SourceObservation>;

interface SourceBlobBinding {
  path: string;
  contentSha256: string;
  immutableRawUrl: string;
}

interface OfficialSourceCapabilityClaim {
  id: string;
  capabilityId: string;
  support: "direct" | "inferred";
  sourceBlobs: SourceBlobBinding[];
  claim: string;
}

interface OfficialSourceCapabilityArtifact {
  schemaVersion: 1;
  kind: "official-source-capability-evidence";
  candidate: {
    id: string;
    sourceId: string;
    candidateRevisionId?: string;
    officialBaseline: CandidateOfficialMarketplaceBaseline;
  };
  sourceBlobs: SourceBlobBinding[];
  capabilities: OfficialSourceCapabilityClaim[];
  audit?: {
    sourceAuditPath: string;
    sourceAuditSha256: string;
  };
  disclosures: string[];
}

interface VerifiedOfficialMarketplaceIdentityRecord {
  candidate: DecisionCandidateProjection;
  evidence: CandidateCapabilityEvidence;
  identity: VerifiedOfficialMarketplaceIdentity;
  binding: VerifiedOfficialMarketplaceCandidateBinding;
}

interface VerifiedOfficialMarketplaceCandidateBinding {
  id: string;
  sourceId: string;
  runtime: DecisionCandidateProjection["runtime"];
  skillPath: string | null;
  capabilityEvidenceIds: readonly string[];
  evidence: {
    id: string;
    candidateId: string;
    capabilityId: string;
    kind: CandidateCapabilityEvidence["kind"];
    current: boolean;
    reference: string;
    contentSha256: string;
  };
}

export interface VerifiedCodexHandoffCandidate {
  candidate: DecisionCandidateProjection;
  repository: string;
  commit: string;
  skillPath: string;
  reviewDecisionId: string;
  compatibilityEvidence: string;
  targetPlatform: "darwin" | "linux" | "win32";
  reviewExpiresAt: string;
}

const verifiedOfficialIdentitiesByIndex = new WeakMap<
  DecisionIndex,
  Map<DecisionCandidateProjection, VerifiedOfficialMarketplaceIdentityRecord>
>();
const verifiedOfficialIdentityObjects = new WeakSet<VerifiedOfficialMarketplaceIdentity>();
const verifiedOfficialIdentityRecords = new WeakMap<
  VerifiedOfficialMarketplaceIdentity,
  VerifiedOfficialMarketplaceIdentityRecord
>();
const verifiedCodexHandoffCandidatesByIndex = new WeakMap<
  DecisionIndex,
  Map<DecisionCandidateProjection, VerifiedCodexHandoffCandidate>
>();
const rootAuthenticatedIndexes = new WeakSet<DecisionIndex>();
const rootAuthenticatedManifestRepositories = new WeakSet<DecisionManifestRepository>();
const STARTER_ROUTE_DOMAIN_IDS: readonly DomainId[] = COMPLETE_V1_DOMAIN_IDS;

export async function loadDecisionManifests(root: string): Promise<DecisionManifestRepository> {
  const [
    completeV1,
    rawIntents,
    rawCandidateEvidence,
    rawOfficialListingClaims,
    rawStarterRoutes,
    catalogEpoch,
    officialSelection
  ] = await Promise.all([
    loadCompleteV1Repository(root),
    loadYaml<unknown>(join(root, "manifests", "decision-intents.yaml")),
    loadYaml<unknown>(join(root, "manifests", "decision-candidate-evidence.yaml")),
    loadYaml<unknown>(join(root, "manifests", "official-listing-capability-claims.yaml")),
    loadOptionalYaml(join(root, "manifests", "decision-starter-routes.yaml")),
    loadCompatibilityCatalogEpoch(root),
    Promise.resolve(loadOfficialMarketplaceSelection(root))
  ]);
  const intents = validateDecisionIntents(rawIntents);
  const capabilities = validatedCompleteV1Capabilities(completeV1);
  const capabilityOwnership = new Map(capabilities.map(({ id, ownerDomainId }) => [id, ownerDomainId]));
  const manualCandidateEvidence = validateDecisionCandidateEvidence(rawCandidateEvidence);
  const officialBaseline = officialSelection.state === "current"
    ? officialSelection.observedArtifact
    : officialSelection.approvedArtifact;
  const officialArtifactPath = officialSelection.state === "current"
    ? officialSelection.observedArtifactPath
    : officialSelection.approvedArtifactPath;
  const officialListingClaims = validateOfficialListingClaims(rawOfficialListingClaims, {
    capabilityOwnership,
    catalogEpoch,
    selectionState: officialSelection.state
  });
  // The compatibility attestation renews atomically. While its observation is
  // held, no claims candidate may inherit the newer catalog epoch.
  const heldOfficialCandidates = new Set(officialSelection.state === "review-required"
    ? officialListingClaims.candidates.map(({ pluginName }) => pluginName)
    : []);
  const baselineCandidateEvidence = validateDecisionCandidateEvidence(materializeOfficialListingClaims({
    manifest: officialListingClaims,
    baseline: officialBaseline,
    existing: manualCandidateEvidence,
    marketplaceArtifactPath: `research/marketplaces/${officialArtifactPath}`
  }));
  const issuedCandidateEvidence = validateDecisionCandidateEvidence(materializeOfficialListingClaims({
    manifest: officialListingClaims,
    baseline: officialBaseline,
    existing: manualCandidateEvidence,
    marketplaceArtifactPath: `research/marketplaces/${officialArtifactPath}`,
    heldCandidateNames: heldOfficialCandidates
  }));
  const observations = new Map<string, Promise<SourceObservation>>();
  const loadObservation = createAuthenticatedSourceObservationLoader(root);
  const research = (issuedCandidateEvidence.candidateRevisions?.length ?? 0) > 0
    ? await loadResearchRepository(root)
    : undefined;
  const revisionProjection = resolveCandidateRevisionProjection(issuedCandidateEvidence, {
    selection: officialSelection,
    asOf: catalogEpoch,
    reviewers: research?.reviewers ?? { schemaVersion: 3, reviewers: [] },
    observationEvidence: research?.observationEvidence ?? [],
    latestObservationEvidenceIdBySource: Object.fromEntries(
      (research?.sourceObservations ?? []).map(({ sourceId, latestEvidenceId }) => [sourceId, latestEvidenceId])
    ),
    observedMarketplaceEvidence: (research?.evidence ?? []).filter((item) =>
      item.schemaVersion === 3 && item.kind === "marketplace-identity"),
    artifactSha256ByPath: await candidateRevisionArtifactDigests(root, issuedCandidateEvidence)
  });
  const candidateEvidence: DecisionCandidateEvidenceManifest = {
    schemaVersion: 3,
    candidates: revisionProjection.candidates,
    evidence: revisionProjection.evidence,
    officialTargetCompatibilityEvidence: revisionProjection.officialTargetCompatibilityEvidence
  };
  validateDecisionTaxonomy(
    intents.profiles,
    candidateEvidence.candidates,
    candidateEvidence.evidence,
    capabilities,
    { profiles: "profiles", candidates: "candidates", evidence: "evidence" }
  );
  // Authenticate the fixed 20-domain route table against the approved baseline
  // before projecting a review-held observation. The final candidate projection
  // still contains only held candidates, so this preserves discovery metadata
  // without creating an executable route.
  const starterRoutes = rawStarterRoutes === undefined
    ? undefined
    : projectStarterRoutesAfterQuarantine(
      validateStarterRoutes(
        rawStarterRoutes,
        capabilities,
        baselineCandidateEvidence.candidates,
        baselineCandidateEvidence.evidence
      ),
      baselineCandidateEvidence.evidence,
      new Set(revisionProjection.quarantinedCandidateIds)
    );
  const verifiedOfficialIdentities = await validateEvidenceFreshness(
    root,
    candidateEvidence,
    observations,
    loadObservation
  );
  const officialTargetCompatibilityEvidence = await validateOfficialTargetCompatibilityEvidence(
    root,
    candidateEvidence,
    catalogEpoch,
    officialSelection,
    observations,
    loadObservation
  );
  const officialIdentityByCandidateId = new Map<string, VerifiedOfficialMarketplaceIdentity>();
  for (const record of verifiedOfficialIdentities) {
    const existing = officialIdentityByCandidateId.get(record.candidate.id);
    if (existing !== undefined && stableValue(existing) !== stableValue(record.identity)) {
      throw new Error(`${record.candidate.id}: conflicting current official marketplace identities`);
    }
    officialIdentityByCandidateId.set(record.candidate.id, record.identity);
  }

  const candidates = new Map(candidateEvidence.candidates.map((candidate) => [candidate.id, candidate]));
  const resolvedEvidence = candidateEvidence.evidence.map((evidence) => ({
    ...evidence,
    candidate: candidates.get(evidence.candidateId)!
  }));
  const verifiedClaudeDarwinCandidateIds = new Set(officialTargetCompatibilityEvidence
    .filter((item) => item.runtime === "claude-code"
      && item.platform === "darwin"
      && item.compatibility === "verified"
      && isCurrentOfficialTargetCompatibilityEvidence(item, catalogEpoch))
    .map(({ candidateId }) => candidateId));

  const repository: DecisionManifestRepository = {
    profiles: intents.profiles.map((profile) => copyProfile(profile)),
    candidates: candidateEvidence.candidates.map((candidate) => copyCandidateWithOfficialInstall(
      candidate,
      officialIdentityByCandidateId.get(candidate.id),
      verifiedClaudeDarwinCandidateIds.has(candidate.id)
    )),
    candidateEvidence: resolvedEvidence.map((evidence) => ({
      ...evidence,
      candidate: copyCandidateWithOfficialInstall(
        evidence.candidate,
        officialIdentityByCandidateId.get(evidence.candidate.id),
        verifiedClaudeDarwinCandidateIds.has(evidence.candidate.id)
      )
    })),
    officialTargetCompatibilityEvidence: officialTargetCompatibilityEvidence.map((item) => structuredClone(item)),
    ...(starterRoutes === undefined ? {} : { starterRoutes }),
    digest: digest(starterRoutes === undefined
      ? { intents, candidateEvidence: issuedCandidateEvidence }
      : { intents, candidateEvidence: issuedCandidateEvidence, starterRoutes })
  };
  const frozenRepository = deepFreezeRepositoryData(repository);
  rootAuthenticatedManifestRepositories.add(frozenRepository);
  return frozenRepository;
}

/** Returns whether this exact object completed the root manifest validation flow. */
export function isRootDecisionManifestRepository(repository: DecisionManifestRepository): boolean {
  return rootAuthenticatedManifestRepositories.has(repository);
}

export async function loadDecisionIndex(root: string): Promise<DecisionIndex> {
  const [completeV1, manifests, value] = await Promise.all([
    loadCompleteV1Repository(root),
    loadDecisionManifests(root),
    readJson(root, "generated/decision-index.json")
  ]);
  const index = validateDecisionIndexForRepository(value, completeV1);
  if (index.catalogVersion !== manifests.digest) {
    throw new Error("decision index catalogVersion does not match the current validated manifest projection digest");
  }
  validateStarterRouteProjection(index, manifests);
  validateCandidateDisplayMetadata(index, manifests);
  const verifiedOfficialIdentities = await validateEvidenceFreshness(root, {
    schemaVersion: 3,
    candidates: index.candidates,
    evidence: index.candidateEvidence
  }, new Map<string, Promise<SourceObservation>>(), createAuthenticatedSourceObservationLoader(root));
  validateMaterializedOfficialInstallBindings(index, verifiedOfficialIdentities);
  validateMaterializedOfficialDecisionMetadata(index, manifests.officialTargetCompatibilityEvidence);
  assertDecisionIndexIntegrity(index);
  const verifiedCodexHandoffCandidates = await validateCodexHandoffCandidates(root, index);
  const records = new Map<DecisionCandidateProjection, VerifiedOfficialMarketplaceIdentityRecord>();
  for (const record of verifiedOfficialIdentities) {
    records.set(record.candidate, record);
    verifiedOfficialIdentityObjects.add(record.identity);
    verifiedOfficialIdentityRecords.set(record.identity, record);
  }
  verifiedOfficialIdentitiesByIndex.set(index, records);
  verifiedCodexHandoffCandidatesByIndex.set(index, verifiedCodexHandoffCandidates);
  rootAuthenticatedIndexes.add(index);
  return deepFreeze(index);
}

function validateStarterRouteProjection(index: DecisionIndex, manifests: DecisionManifestRepository): void {
  if (manifests.starterRoutes === undefined) {
    if (index.starterRoutes !== undefined) {
      throw new Error("decision index starterRoutes is present without authenticated manifest routes");
    }
    return;
  }
  if (stableValue(index.starterRoutes) !== stableValue(manifests.starterRoutes)) {
    throw new Error("decision index starterRoutes does not match the authenticated manifest projection");
  }
}

function validateCandidateDisplayMetadata(
  index: DecisionIndex,
  manifests: DecisionManifestRepository
): void {
  const expectedById = new Map(manifests.candidates.map((candidate) => [candidate.id, candidate]));
  for (const candidate of index.candidates) {
    const expected = expectedById.get(candidate.id);
    if (expected === undefined || candidate.displayName !== expected.displayName
      || candidate.description !== expected.description) {
      throw new Error(`${candidate.id}: generated display name or description does not match authenticated manifest evidence`);
    }
  }
}

/** Returns whether this exact index completed the repository loader's private verification flow. */
export function isRootDecisionIndex(index: DecisionIndex): boolean {
  return rootAuthenticatedIndexes.has(index);
}

/** Returns a marketplace identity only when this exact loaded index authorized it. */
export function verifiedOfficialMarketplaceIdentityFor(
  index: DecisionIndex,
  candidate: DecisionCandidateProjection
): VerifiedOfficialMarketplaceIdentity | undefined {
  const record = verifiedOfficialIdentitiesByIndex.get(index)?.get(candidate);
  if (record === undefined
    || !index.candidates.includes(candidate)
    || !index.candidateEvidence.some((evidence) => evidence === record.evidence)
    || !matchesVerifiedOfficialMarketplaceBinding(record, candidate)) {
    return undefined;
  }
  return record.identity;
}

/** Rejects structurally fabricated marketplace records passed outside the repository loader. */
export function isVerifiedOfficialMarketplaceIdentity(
  value: VerifiedOfficialMarketplaceIdentity | undefined,
  candidate: DecisionCandidateProjection
): value is VerifiedOfficialMarketplaceIdentity {
  return value !== undefined
    && verifiedOfficialIdentityObjects.has(value)
    && verifiedOfficialIdentityRecords.has(value)
    && matchesVerifiedOfficialMarketplaceBinding(verifiedOfficialIdentityRecords.get(value)!, candidate);
}

/** Returns a Codex candidate only when the root loader resolved its exact review and target evidence. */
export function verifiedCodexHandoffCandidateFor(
  index: DecisionIndex,
  candidate: DecisionCandidateProjection
): VerifiedCodexHandoffCandidate | undefined {
  const binding = verifiedCodexHandoffCandidatesByIndex.get(index)?.get(candidate);
  if (binding === undefined
    || binding.candidate !== candidate
    || !index.candidates.includes(candidate)
    || candidate.codexInstall === undefined
    || candidate.runtime !== "codex"
    || candidate.skillPath !== binding.skillPath
    || candidate.codexInstall.repository !== binding.repository
    || candidate.codexInstall.commit !== binding.commit
    || candidate.codexInstall.skillPath !== binding.skillPath
    || candidate.codexInstall.reviewDecisionId !== binding.reviewDecisionId
    || candidate.codexInstall.compatibilityEvidence !== binding.compatibilityEvidence
    || candidate.codexInstall.targetPlatform !== binding.targetPlatform) {
    return undefined;
  }
  return binding;
}

export function validateDecisionIndexForRepository(
  value: unknown,
  completeV1: CompleteV1Repository
): DecisionIndex {
  const index = validateDecisionIndex(value);
  const capabilities = validatedCompleteV1Capabilities(completeV1);
  validateDecisionTaxonomy(
    index.profiles,
    index.candidates,
    index.candidateEvidence,
    capabilities,
    { profiles: "profiles", candidates: "candidates", evidence: "candidateEvidence" }
  );
  return index;
}

function validatedCompleteV1Capabilities(completeV1: CompleteV1Repository): CapabilityManifest[] {
  const capabilities = completeV1.capabilityCollections.flatMap((collection) => collection.capabilities);
  const errors: string[] = [];
  const firstPathById = new Map<string, string>();

  for (const collection of completeV1.capabilityCollections) {
    for (const [index, capability] of collection.capabilities.entries()) {
      const path = `manifests/capabilities/${collection.domainId}.yaml:/capabilities/${index}/id`;
      if (firstPathById.has(capability.id)) {
        errors.push(`${path}: Duplicate capability ID: ${capability.id}`);
      } else {
        firstPathById.set(capability.id, path);
      }
    }
  }

  const catalogCapabilityIds = [...completeV1.catalog.capabilityIds].sort(compareCodePointStrings);
  const loadedCapabilityIds = capabilities.map(({ id }) => id).sort(compareCodePointStrings);
  if (
    catalogCapabilityIds.length !== loadedCapabilityIds.length
    || catalogCapabilityIds.some((id, index) => id !== loadedCapabilityIds[index])
  ) {
    errors.push("manifests/catalog.yaml:/capabilityIds: Catalog capability IDs do not equal loaded capability IDs");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Complete v1 capability identity:\n${errors.sort(compareCodePointStrings).join("\n")}`);
  }
  return capabilities;
}

function validateDecisionTaxonomy(
  profiles: IntentProfile[],
  candidates: DecisionCandidateProjection[],
  evidence: CandidateCapabilityEvidence[],
  capabilities: CapabilityManifest[],
  paths: { profiles: string; candidates: string; evidence: string }
): void {
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const errors: string[] = [];

  if (profiles.length !== COMPLETE_V1_DOMAIN_IDS.length) {
    errors.push(`${paths.profiles}: must contain every Complete v1 domain in COMPLETE_V1_DOMAIN_IDS order`);
  }

  for (const [profileIndex, profile] of profiles.entries()) {
    const expectedDomainId = COMPLETE_V1_DOMAIN_IDS[profileIndex];
    if (profile.domainId !== expectedDomainId) {
      errors.push(
        `${paths.profiles}/${profileIndex}/domainId: must equal Complete v1 domain ${expectedDomainId ?? "<none>"}; received ${profile.domainId}`
      );
    }
    if (profile.requiredCapabilityIds.includes(profile.coreCapabilityId)) {
      errors.push(`${paths.profiles}/${profileIndex}/requiredCapabilityIds: must not repeat the core capability`);
    }
    const capabilityEntries = [
      { id: profile.coreCapabilityId, path: `${paths.profiles}/${profileIndex}/coreCapabilityId` },
      ...profile.requiredCapabilityIds.map((id, capabilityIndex) => ({
        id,
        path: `${paths.profiles}/${profileIndex}/requiredCapabilityIds/${capabilityIndex}`
      }))
    ];
    for (const { id: capabilityId, path } of capabilityEntries) {
      const capability = capabilityById.get(capabilityId);
      if (capability === undefined) {
        errors.push(`${path}: capability ${capabilityId} does not exist in the Complete v1 catalog`);
      } else if (capability.ownerDomainId !== profile.domainId) {
        errors.push(`${path}: capability ${capabilityId} must belong to ${profile.domainId}`);
      }
    }
  }

  for (const [candidateIndex, candidate] of candidates.entries()) {
    for (const [capabilityIndex, capabilityId] of candidate.providedCapabilityIds.entries()) {
      if (!capabilityById.has(capabilityId)) {
        errors.push(
          `${paths.candidates}/${candidateIndex}/providedCapabilityIds/${capabilityIndex}: capability ${capabilityId} does not exist in the Complete v1 catalog`
        );
      }
    }
  }
  for (const [evidenceIndex, evidenceItem] of evidence.entries()) {
    if (!capabilityById.has(evidenceItem.capabilityId)) {
      errors.push(
        `${paths.evidence}/${evidenceIndex}/capabilityId: capability ${evidenceItem.capabilityId} does not exist in the Complete v1 catalog`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid decision taxonomy:\n${errors.sort(compareCodePointStrings).join("\n")}`);
  }
}

async function validateEvidenceFreshness(
  root: string,
  manifest: DecisionCandidateEvidenceManifest,
  observations: Map<string, Promise<SourceObservation>>,
  loadObservation: SourceObservationLoader
): Promise<VerifiedOfficialMarketplaceIdentityRecord[]> {
  const candidates = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
  const verifiedOfficialIdentities: VerifiedOfficialMarketplaceIdentityRecord[] = [];

  for (const evidence of manifest.evidence) {
    const candidate = candidates.get(evidence.candidateId);
    if (candidate === undefined) continue;
    if (candidate.candidateRevisionId !== evidence.candidateRevisionId) {
      throw new Error(`${evidence.id}: capability evidence does not bind the current candidate revision`);
    }
    if (evidence.current !== true) {
      throw new Error(`${evidence.id}: current evidence claim is stale`);
    }
    const observation = await sourceObservation(candidate.sourceId, observations, loadObservation);
    if (evidence.kind === "official-baseline") {
      verifiedOfficialIdentities.push(await validateOfficialBaselineEvidence(root, evidence, candidate, observation));
    } else if (evidence.kind === "official-listing") {
      verifiedOfficialIdentities.push(await validateOfficialListingEvidence(root, evidence, candidate, observation));
    } else {
      validateObservationEvidence(evidence, candidate, observation);
    }
  }
  return verifiedOfficialIdentities;
}

/**
 * Verifies the integrity and identity binding of an official-documentation
 * compatibility inference. This is intentionally not a smoke-test or review
 * ledger path: it can authorize only the delegated official Claude listing.
 */
async function validateOfficialTargetCompatibilityEvidence(
  root: string,
  manifest: DecisionCandidateEvidenceManifest,
  catalogEpoch: string,
  officialSelection: ReturnType<typeof loadOfficialMarketplaceSelection>,
  observations: Map<string, Promise<SourceObservation>>,
  loadObservation: SourceObservationLoader
): Promise<OfficialTargetCompatibilityEvidence[]> {
  const evidence = manifest.officialTargetCompatibilityEvidence ?? [];
  const candidates = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
  const ids = new Set<string>();

  for (const item of evidence) {
    if (ids.has(item.id)) throw new Error(`${item.id}: duplicate official target compatibility evidence ID`);
    ids.add(item.id);
    const candidate = candidates.get(item.candidateId);
    if (candidate === undefined) throw new Error(`${item.id}: compatibility evidence candidate does not exist`);
    if (candidate.sourceId !== item.sourceId || candidate.runtime !== item.runtime
      || candidate.candidateRevisionId !== item.candidateRevisionId) {
      throw new Error(`${item.id}: compatibility evidence candidate/source/runtime identity mismatch`);
    }
    if (item.runtime !== "claude-code" || item.platform !== "darwin" || item.compatibility !== "verified") {
      throw new Error(`${item.id}: delegated official compatibility inference is limited to Claude Code on darwin`);
    }
    const observation = await sourceObservation(item.sourceId, observations, loadObservation);
    if (item.snapshot.sourceUrl !== observation.source.repository
      || item.snapshot.sourceUrl !== observation.snapshot.sourceUrl) {
      throw new Error(`${item.id}: compatibility inference snapshot source does not match the candidate source`);
    }
    if (!item.sourceUrls.includes(item.snapshot.marketplaceEntryUrl)
      || !item.sourceUrls.includes(item.snapshot.marketplaceEntrySourceUrl)
      || !item.sourceUrls.includes("https://code.claude.com/docs/en/overview")) {
      throw new Error(`${item.id}: compatibility inference source URLs are incomplete`);
    }
    assertDigest(item.snapshot, "digest", item.id, "snapshot");
    assertDigest(item, "evidenceDigest", item.id, "evidence");
    let sourceObservedAt = observation.receipt.observedAt;
    const requiresCurrentObservation = item.candidateRevisionId !== undefined
      || (item.observedAt === catalogEpoch && item.reviewedAt === catalogEpoch);
    if (requiresCurrentObservation) {
      sourceObservedAt = resolveLatestEffectiveSourceObservation(observation).observedAt;
    }
    assertCompatibleTimestamps(item, sourceObservedAt, catalogEpoch, officialSelection);
    const officialBaseline = await resolveCandidateOfficialBaseline(root, candidate, observation, item.id);
    if (item.snapshot.marketplaceEntrySourceUrl !== officialBaseline.sourceUrl
      || item.snapshot.marketplaceEntrySourceCommit !== officialBaseline.sourceCommit) {
      throw new Error(`${item.id}: marketplace source commit does not match the validated official entry`);
    }
    if (item.snapshot.marketplaceEntryUrl !== marketplaceEntryUrl(officialBaseline)) {
      throw new Error(`${item.id}: marketplace entry URL must be commit-qualified to the validated official entry`);
    }
    if (!item.disclosures.includes("compatibility-inference:not-install-smoke")
      || !item.disclosures.includes("individual-safety-review:not-complete")) {
      throw new Error(`${item.id}: compatibility inference must disclose its non-smoke and non-review limits`);
    }
  }
  return evidence;
}

function assertDigest(value: object, digestKey: "digest" | "evidenceDigest", id: string, label: string): void {
  const record = value as Record<string, unknown>;
  const expected = record[digestKey];
  const withoutDigest = { ...record };
  delete withoutDigest[digestKey];
  const actual = createHash("sha256").update(canonicalize(withoutDigest)).digest("hex");
  if (expected !== actual) throw new Error(`${id}: ${label} digest mismatch`);
}

function assertCompatibleTimestamps(
  item: OfficialTargetCompatibilityEvidence,
  sourceObservedAt: string,
  catalogEpoch: string,
  officialSelection: ReturnType<typeof loadOfficialMarketplaceSelection>
): void {
  const observed = Date.parse(item.observedAt);
  const reviewed = Date.parse(item.reviewedAt);
  const expires = Date.parse(item.expiresAt);
  const sourceObserved = Date.parse(sourceObservedAt);
  const catalogObserved = Date.parse(catalogEpoch);
  if (!Number.isFinite(observed) || !Number.isFinite(reviewed) || !Number.isFinite(expires)
    || !Number.isFinite(sourceObserved) || !Number.isFinite(catalogObserved)
    || reviewed < observed || expires <= reviewed) {
    throw new Error(`${item.id}: compatibility inference timestamps are invalid`);
  }
  if (sourceObserved > observed) {
    throw new Error(`${item.id}: compatibility inference timestamp is outside the authenticated catalog epoch or pinned source receipt`);
  }
  const currentEpoch = item.observedAt === catalogEpoch && item.reviewedAt === catalogEpoch;
  if (officialSelection.state === "current" && currentEpoch) {
    if (officialSelection.observedAt !== catalogEpoch) {
      throw new Error(`${item.id}: pinned source receipt replay is not bound to the current official marketplace observation epoch`);
    }
  } else if (observed > catalogObserved || reviewed > catalogObserved) {
    throw new Error(`${item.id}: compatibility inference is in the future of the authenticated catalog epoch`);
  } else if (observed - sourceObserved > 9 * 86_400_000) {
    throw new Error(`${item.id}: review-held compatibility inference exceeds its pinned source freshness window`);
  }
  if (expires - reviewed > 9 * 86_400_000) {
    throw new Error(`${item.id}: compatibility inference validity exceeds the nine-day catalog freshness window`);
  }
}

async function loadCompatibilityCatalogEpoch(root: string): Promise<string> {
  const value = await readJson(root, "research/materialized-review-state.json");
  if (!isRecord(value) || value.schemaVersion !== 3 || typeof value.asOf !== "string"
    || !Array.isArray(value.states) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value.asOf)
    || !Number.isFinite(Date.parse(value.asOf))) {
    throw new Error("research/materialized-review-state.json: invalid compatibility catalog epoch");
  }
  return value.asOf;
}

async function validateCodexHandoffCandidates(
  root: string,
  index: DecisionIndex
): Promise<Map<DecisionCandidateProjection, VerifiedCodexHandoffCandidate>> {
  const candidates = index.candidates.filter((candidate) =>
    candidate.runtime === "codex" && candidate.state === "eligible-with-disclosures"
  );
  if (candidates.length === 0) return new Map();

  const [ledgerText, reviewersValue] = await Promise.all([
    readRepositoryFile(root, "research/review-ledger.jsonl").then((bytes) => bytes.toString("utf8")),
    readJson(root, "governance/reviewers.json")
  ]);
  const ledger = verifyReviewLedger({
    base: parseReviewLedgerJsonl(ledgerText),
    head: parseReviewLedgerJsonl(ledgerText),
    baseReviewers: validateReviewerRegistry(reviewersValue),
    changedPaths: []
  });
  const research = await loadResearchRepository(root);
  const currentObservations = materializeSourceObservationContexts({
    sourceConfigs: research.sourceConfigs,
    collectionReceipts: research.collectionReceipts,
    snapshots: research.snapshots,
    observationEvidence: research.observationEvidence,
    sourceReviewBacklog: research.sourceReviewBacklog
  });
  const currentObservationBySource = new Map(
    currentObservations.map((observation) => [observation.source.sourceId, observation])
  );
  const observations = new Map<string, Promise<SourceObservation>>();
  const loadObservation = createAuthenticatedSourceObservationLoader(root);
  const bindings = new Map<DecisionCandidateProjection, VerifiedCodexHandoffCandidate>();

  for (const candidate of candidates) {
    const install = candidate.codexInstall;
    if (install === undefined) {
      throw new Error(`${candidate.id}: eligible Codex candidate requires structured install evidence`);
    }
    if (candidate.skillPath === null || candidate.skillPath !== install.skillPath
      || !isCanonicalRepositoryRelativePosixPath(candidate.skillPath)) {
      throw new Error(`${candidate.id}: Codex skillPath must be an exact repository-relative path`);
    }
    const observation = await sourceObservation(candidate.sourceId, observations, loadObservation);
    if (install.repository !== observation.source.repository) {
      throw new Error(`${candidate.id}: Codex repository does not match the current source observation`);
    }
    if (install.commit !== observation.snapshot.inspectedCommit) {
      throw new Error(`${candidate.id}: Codex commit does not match the current source observation`);
    }
    if (!snapshotAttestsPath(observation.snapshot, candidate.skillPath)) {
      throw new Error(`${candidate.id}: Codex skillPath is not attested by the current source observation`);
    }
    const currentObservation = currentObservationBySource.get(candidate.sourceId);
    if (currentObservation === undefined
      || currentObservation.snapshotId !== observation.snapshot.id
      || currentObservation.snapshotContentSha256 !== observation.snapshot.contentSha256
      || currentObservation.source.inspectedCommit !== observation.snapshot.inspectedCommit) {
      throw new Error(`${candidate.id}: Codex current observation is not bound to the source snapshot`);
    }

    const review = ledger.leaves.find((event) =>
      event.id === install.reviewDecisionId
      && event.target.sourceId === candidate.sourceId
      && event.target.skillPath === candidate.skillPath
    );
    if (review === undefined || review.disposition !== "approved") {
      throw new Error(`${candidate.id}: Codex review decision is not a current exact approval`);
    }
    assertCurrentCodexReview(
      candidate,
      install,
      review,
      currentObservation,
      index.observedThrough,
      research.evidence
    );
    bindings.set(candidate, Object.freeze({
      candidate,
      repository: install.repository,
      commit: install.commit,
      skillPath: install.skillPath,
      reviewDecisionId: install.reviewDecisionId,
      compatibilityEvidence: install.compatibilityEvidence,
      targetPlatform: install.targetPlatform,
      reviewExpiresAt: review.expiresAt
    }));
  }
  return bindings;
}

function assertCurrentCodexReview(
  candidate: DecisionCandidateProjection,
  install: NonNullable<DecisionCandidateProjection["codexInstall"]>,
  review: ReviewLedgerEvent,
  observation: ReviewStateObservation,
  observedThrough: string,
  evidence: readonly ResearchEvidence[]
): void {
  if (review.baseline.snapshotId !== observation.snapshotId
    || review.baseline.inspectedCommit !== observation.source.inspectedCommit
    || review.baseline.contentSha256 !== observation.snapshotContentSha256) {
    throw new Error(`${candidate.id}: Codex review does not resolve to the current observation and commit`);
  }
  const reviewExpiresAt = Date.parse(review.expiresAt);
  const catalogObservedAt = Date.parse(observedThrough);
  if (!Number.isFinite(reviewExpiresAt) || !Number.isFinite(catalogObservedAt) || reviewExpiresAt <= catalogObservedAt) {
    throw new Error(`${candidate.id}: Codex review is stale or expired for this catalog`);
  }
  if (!isExactReviewDecisionCurrent(review, observation, candidate.skillPath!, observedThrough)) {
    throw new Error(`${candidate.id}: Codex review does not match current exact path blob or inherited sensitive evidence`);
  }
  const matchingRuntimeEvidence = review.runtimeEvidence.filter((evidence) =>
    evidence.runtime === "codex"
    && evidence.compatibility === "verified"
    && evidence.evidenceIds.includes(install.compatibilityEvidence)
  );
  assertCodexCompatibilityEvidence(candidate, install, observation, evidence);
  if (matchingRuntimeEvidence.length !== 1
    || !candidate.stateReasons.includes(`target-verified:codex/${install.targetPlatform}`)) {
    throw new Error(`${candidate.id}: Codex target platform evidence does not match the reviewed target`);
  }
  const compatibility = evidence.find((item) => item.id === install.compatibilityEvidence && item.kind === "compatibility")!;
  if (stableValue(candidate.eligibility) !== stableValue({
    reviewExpiresAt: review.expiresAt,
    targetExpiresAt: { [install.targetPlatform]: review.expiresAt }
  })
    || stableValue(candidate.ranking) !== stableValue({
      targetEvidenceAt: { [install.targetPlatform]: compatibility.observedAt },
      reviewedAt: review.reviewedAt
    })) {
    throw new Error(`${candidate.id}: Codex decision expiry or ranking metadata does not match the exact review`);
  }
  const reviewedFields = [
    ["license", candidate.license, review.reviewedSensitiveFields.license],
    ["permissions", candidate.permissions, review.reviewedSensitiveFields.permissions],
    ["trust", candidate.trust, review.reviewedSensitiveFields.trust],
    ["dependencies", candidate.dependencies, review.reviewedSensitiveFields.dependencies]
  ] as const;
  for (const [field, candidateField, reviewedField] of reviewedFields) {
    if (candidateField.status === "unknown" || stableValue(candidateField) !== stableValue(reviewedField)) {
      throw new Error(`${candidate.id}: Codex ${field} evidence does not match the current exact review`);
    }
  }
}

function assertCodexCompatibilityEvidence(
  candidate: DecisionCandidateProjection,
  install: NonNullable<DecisionCandidateProjection["codexInstall"]>,
  observation: ReviewStateObservation,
  evidence: readonly ResearchEvidence[]
): void {
  const compatibility = evidence.find((item) => item.id === install.compatibilityEvidence);
  if (compatibility === undefined) {
    throw new Error(`${candidate.id}: Codex compatibility evidence does not resolve from the validated research repository`);
  }
  if (compatibility.kind !== "compatibility") {
    throw new Error(`${candidate.id}: Codex compatibility evidence must have compatibility kind`);
  }
  if (compatibility.reviewId !== install.reviewDecisionId || compatibility.providerId !== candidate.sourceId) {
    throw new Error(`${candidate.id}: Codex compatibility evidence does not match the exact review and provider`);
  }
  if (compatibility.scope.runtime !== "codex" || compatibility.scope.platform !== install.targetPlatform
    || compatibility.scope.capabilityId !== null) {
    throw new Error(`${candidate.id}: Codex compatibility evidence target platform does not match the requested target`);
  }
  if (compatibility.snapshotId !== observation.snapshotId || compatibility.reviewedCommit !== install.commit) {
    throw new Error(`${candidate.id}: Codex compatibility evidence commit does not match the current inspected commit`);
  }
  if (compatibility.outcome !== "passed") {
    throw new Error(`${candidate.id}: Codex compatibility evidence must have a passed verified outcome`);
  }
}

async function sourceObservation(
  sourceId: string,
  cache: Map<string, Promise<SourceObservation>>,
  loadObservation: SourceObservationLoader
): Promise<SourceObservation> {
  let result = cache.get(sourceId);
  if (result === undefined) {
    result = loadObservation(sourceId).catch((error: unknown) => {
      cache.delete(sourceId);
      throw error;
    });
    cache.set(sourceId, result);
  }
  return result;
}

async function validateOfficialBaselineEvidence(
  root: string,
  evidence: CandidateCapabilityEvidence,
  candidate: DecisionCandidateProjection,
  observation: SourceObservation
): Promise<VerifiedOfficialMarketplaceIdentityRecord> {
  const officialBaseline = await resolveCandidateOfficialBaseline(root, candidate, observation, evidence.id);
  if (evidence.reference !== candidate.officialBaseline!.reference) {
    throw new Error(`${evidence.id}: capability evidence reference does not resolve the candidate officialBaseline pointer`);
  }
  if (evidence.contentSha256 !== candidate.officialBaseline!.marketplaceManifestSha256) {
    throw new Error(`${evidence.id}: capability evidence contentSha256 does not resolve the candidate officialBaseline pointer`);
  }
  const sourceArtifact = await loadOfficialSourceCapabilityArtifact(root, evidence);
  if (!sameSourceBlobs(candidate.officialBaseline!.sourceBlobs, sourceArtifact.sourceBlobs)) {
    throw new Error(`${evidence.id}: immutable official source blob binding does not match the candidate baseline`);
  }
  const claim = sourceArtifact.capabilities.find((item) =>
    item.id === evidence.id && item.capabilityId === evidence.capabilityId
  );
  if (claim === undefined
    || evidence.support !== claim.support
    || !sameSourceBlobs(evidence.sourceBlobs, claim.sourceBlobs)
    || !claim.sourceBlobs.every((blob) => sourceArtifact.sourceBlobs.some((sourceBlob) => sameSourceBlob(blob, sourceBlob)))) {
    throw new Error(`${evidence.id}: capability source blobs do not match the immutable official artifact`);
  }
  if (sourceArtifact.candidate.id !== candidate.id
    || sourceArtifact.candidate.sourceId !== candidate.sourceId
    || sourceArtifact.candidate.candidateRevisionId !== candidate.candidateRevisionId
    || sourceArtifact.candidate.candidateRevisionId !== evidence.candidateRevisionId
    || stableValue(sourceArtifact.candidate.officialBaseline) !== stableValue(candidate.officialBaseline)) {
    throw new Error(`${evidence.id}: capability artifact candidate officialBaseline binding mismatch`);
  }
  if (!sourceArtifact.disclosures.includes("not-an-install-smoke")
    || !sourceArtifact.disclosures.includes("not-an-individual-safety-review")
    || !sourceArtifact.disclosures.includes("privacy-telemetry-review:not-complete")
    || !sourceArtifact.disclosures.includes("telemetry-default-on")
    || !sourceArtifact.disclosures.includes("telemetry-endpoint:https://shopify.dev/mcp/usage")
    || !sourceArtifact.disclosures.includes("license:MIT")) {
    throw new Error(`${evidence.id}: capability artifact must disclose its safety, telemetry, and license evidence`);
  }
  const snapshotAddress = `${officialBaseline.marketplaceArtifact.provenance.manifestPath}#/plugins/${officialBaseline.pluginIndex}`;
  if (!observation.snapshot.entries.some((entry) => entry.kind === "marketplace-entry" && entry.address === snapshotAddress)) {
    throw new Error(`${evidence.id}: current source observation does not contain the official baseline reference`);
  }
  const identity = Object.freeze({
    marketplaceId: officialBaseline.marketplaceArtifact.marketplace,
    pluginName: officialBaseline.plugin.name,
    displayName: officialBaseline.plugin.name,
    description: officialBaseline.plugin.description,
    marketplaceSource: OFFICIAL_MARKETPLACE_SOURCE,
    scope: "user" as const,
    argv: [
      "claude",
      "plugin",
      "install",
      `${officialBaseline.plugin.name}@${officialBaseline.marketplaceArtifact.marketplace}`,
      "--scope",
      "user"
    ] as ["claude", "plugin", "install", string, "--scope", "user"],
    installRoute: `claude plugin install ${officialBaseline.plugin.name}@${officialBaseline.marketplaceArtifact.marketplace} --scope user`
  });
  return {
    candidate,
    evidence,
    identity,
    binding: freezeVerifiedOfficialMarketplaceBinding(candidate, evidence)
  };
}

async function validateOfficialListingEvidence(
  root: string,
  evidence: CandidateCapabilityEvidence,
  candidate: DecisionCandidateProjection,
  observation: SourceObservation
): Promise<VerifiedOfficialMarketplaceIdentityRecord> {
  const officialBaseline = await resolveCandidateOfficialBaseline(root, candidate, observation, evidence.id);
  const excerpt = evidence.listingExcerpt;
  if (evidence.reference !== `${candidate.officialBaseline!.reference}/description`
    || evidence.contentSha256 !== digestText(officialBaseline.plugin.description)
    || evidence.support === undefined
    || excerpt === undefined
    || evidence.listingExcerptSha256 !== digestText(excerpt)
    || !officialBaseline.plugin.description.includes(excerpt)) {
    throw new Error(`${evidence.id}: official listing description evidence is stale or mismatched`);
  }
  const identity = officialMarketplaceIdentity(officialBaseline);
  return {
    candidate,
    evidence,
    identity,
    binding: freezeVerifiedOfficialMarketplaceBinding(candidate, evidence)
  };
}

async function resolveCandidateOfficialBaseline(
  root: string,
  candidate: DecisionCandidateProjection,
  observation: SourceObservation,
  evidenceId: string
): Promise<{
  marketplaceArtifact: ReturnType<typeof validateOfficialMarketplaceArtifact>;
  plugin: ReturnType<typeof validateOfficialMarketplaceArtifact>["plugins"][number];
  pluginIndex: number;
  sourceUrl: string;
  sourceCommit: string;
}> {
  const candidateBaseline = candidate.officialBaseline;
  if (candidateBaseline === undefined) {
    throw new Error(`${evidenceId}: official-baseline candidate requires an officialBaseline pointer`);
  }
  const match = /^research\/marketplaces\/([a-z0-9][a-z0-9-]*\.json)#\/plugins\/(0|[1-9][0-9]*)$/u.exec(candidateBaseline.reference);
  if (match === null) {
    throw new Error(`${evidenceId}: officialBaseline reference must identify a marketplace plugin JSON Pointer`);
  }
  const marketplaceArtifactPath = match[1]!;
  const marketplaceArtifact = validateOfficialMarketplaceArtifact(await readJson(
    root,
    `research/marketplaces/${marketplaceArtifactPath}`
  ));
  const pluginIndex = Number(match[2]);
  const plugin = marketplaceArtifact.plugins[pluginIndex];
  if (plugin === undefined || plugin.provenance.jsonPointer !== `/plugins/${pluginIndex}`) {
    throw new Error(`${evidenceId}: officialBaseline reference does not exist`);
  }
  const selection = loadOfficialMarketplaceSelection(root);
  const allowedArtifactPaths = Object.keys(selection.artifactByPath);
  const currentPlugin = selection.observedArtifact.plugins.find(({ name }) => name === plugin.name);
  if (currentPlugin === undefined
    || officialMarketplaceCandidateIdentity(currentPlugin) !== officialMarketplaceCandidateIdentity(plugin)) {
    throw new Error(`${evidenceId}: historical officialBaseline identity drifted from current approved evidence`);
  }
  const source = normalizedOfficialPluginSource(plugin, marketplaceArtifact);
  if (candidate.id !== candidateBaseline.pluginName || candidate.id !== plugin.name
    || candidateBaseline.sourceUrl !== source.sourceUrl || candidateBaseline.sourceCommit !== source.sourceCommit) {
    throw new Error(`${evidenceId}: candidate/plugin/source URL/source commit does not match the validated marketplace entry`);
  }
  validateImmutableRawUrls(candidateBaseline, evidenceId);
  const latestOfficialObservation = selection.observedArtifact.provenance;
  const effectiveObservation = resolveLatestEffectiveSourceObservation(observation);
  if (candidateBaseline.marketplaceManifestSha256 !== marketplaceArtifact.provenance.manifestSha256
    || !allowedArtifactPaths.includes(marketplaceArtifactPath)
    || effectiveObservation.repository !== latestOfficialObservation.repository
    || effectiveObservation.inspectedCommit !== latestOfficialObservation.inspectedCommit) {
    throw new Error(`${evidenceId}: officialBaseline source binding is stale or mismatched`);
  }
  return { marketplaceArtifact, plugin, pluginIndex, ...source };
}

function normalizedOfficialPluginSource(
  plugin: ReturnType<typeof validateOfficialMarketplaceArtifact>["plugins"][number],
  marketplace: ReturnType<typeof validateOfficialMarketplaceArtifact>
): { sourceUrl: string; sourceCommit: string } {
  if (typeof plugin.source === "string") {
    return {
      sourceUrl: marketplace.provenance.repository,
      sourceCommit: marketplace.provenance.inspectedCommit
    };
  }
  if (plugin.source.source === "github") {
    return { sourceUrl: `https://github.com/${plugin.source.repo}.git`, sourceCommit: plugin.source.sha };
  }
  return { sourceUrl: plugin.source.url, sourceCommit: plugin.source.sha };
}

function officialMarketplaceIdentity(officialBaseline: {
  marketplaceArtifact: ReturnType<typeof validateOfficialMarketplaceArtifact>;
  plugin: ReturnType<typeof validateOfficialMarketplaceArtifact>["plugins"][number];
}): VerifiedOfficialMarketplaceIdentity {
  return Object.freeze({
    marketplaceId: officialBaseline.marketplaceArtifact.marketplace,
    pluginName: officialBaseline.plugin.name,
    displayName: officialBaseline.plugin.name,
    description: officialBaseline.plugin.description,
    marketplaceSource: OFFICIAL_MARKETPLACE_SOURCE,
    scope: "user" as const,
    argv: [
      "claude",
      "plugin",
      "install",
      `${officialBaseline.plugin.name}@${officialBaseline.marketplaceArtifact.marketplace}`,
      "--scope",
      "user"
    ] as ["claude", "plugin", "install", string, "--scope", "user"],
    installRoute: `claude plugin install ${officialBaseline.plugin.name}@${officialBaseline.marketplaceArtifact.marketplace} --scope user`
  });
}

function marketplaceEntryUrl(officialBaseline: {
  marketplaceArtifact: ReturnType<typeof validateOfficialMarketplaceArtifact>;
}): string {
  const { repository, inspectedCommit, manifestPath } = officialBaseline.marketplaceArtifact.provenance;
  return `${repository}/blob/${inspectedCommit}/${manifestPath}`;
}

async function loadOfficialSourceCapabilityArtifact(
  root: string,
  evidence: CandidateCapabilityEvidence
): Promise<OfficialSourceCapabilityArtifact> {
  if (evidence.artifactPath === undefined || evidence.artifactSha256 === undefined
    || evidence.support === undefined || evidence.sourceBlobs === undefined) {
    throw new Error(`${evidence.id}: official-baseline capability evidence requires immutable source artifact and blob bindings`);
  }
  if (!isCanonicalOfficialArtifactPath(evidence.artifactPath)) {
    throw new Error(`${evidence.id}: official capability artifact path is invalid`);
  }
  const bytes = await readRepositoryFile(root, evidence.artifactPath);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== evidence.artifactSha256) {
    throw new Error(`${evidence.id}: official capability artifact SHA-256 mismatch`);
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${evidence.id}: official capability artifact is not valid JSON`);
  }
  if (!isOfficialSourceCapabilityArtifact(value)) {
    throw new Error(`${evidence.id}: official capability artifact has an invalid structure`);
  }
  if (value.audit !== undefined) {
    const auditBytes = await readRepositoryFile(root, value.audit.sourceAuditPath);
    const actualAuditSha256 = createHash("sha256").update(auditBytes).digest("hex");
    if (actualAuditSha256 !== value.audit.sourceAuditSha256) {
      throw new Error(`${evidence.id}: official capability source audit SHA-256 mismatch`);
    }
  }
  return value;
}

function isCanonicalOfficialArtifactPath(path: string): boolean {
  return isCanonicalEvidenceArtifactPath(path) && path.endsWith(".json");
}

function isCanonicalEvidenceArtifactPath(path: string): boolean {
  return path.startsWith("research/evidence/artifacts/")
    && isCanonicalRepositoryRelativePosixPath(path);
}

function isOfficialSourceCapabilityArtifact(value: unknown): value is OfficialSourceCapabilityArtifact {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== "official-source-capability-evidence"
    || !isRecord(value.candidate) || !isRecord(value.candidate.officialBaseline)
    || typeof value.candidate.id !== "string" || typeof value.candidate.sourceId !== "string"
    || (value.candidate.candidateRevisionId !== undefined
      && typeof value.candidate.candidateRevisionId !== "string")
    || !isCandidateOfficialBaseline(value.candidate.officialBaseline)
    || !isStoredSourceBlobList(value.sourceBlobs) || !Array.isArray(value.capabilities)
    || !value.capabilities.every(isOfficialSourceCapabilityClaim)
    || (value.audit !== undefined && !isOfficialSourceAuditBinding(value.audit))
    || !Array.isArray(value.disclosures) || !value.disclosures.every((item) => typeof item === "string")) {
    return false;
  }
  return uniqueStrings(value.sourceBlobs.map((item) => item.path))
    && uniqueStrings(value.capabilities.map((item) => item.id));
}

function isOfficialSourceAuditBinding(value: unknown): value is OfficialSourceCapabilityArtifact["audit"] {
  return isRecord(value)
    && typeof value.sourceAuditPath === "string"
    && /^research\/audits\/[a-z0-9][a-z0-9-]*\.md$/u.test(value.sourceAuditPath)
    && isCanonicalRepositoryRelativePosixPath(value.sourceAuditPath)
    && isSha256(value.sourceAuditSha256);
}

function isCandidateOfficialBaseline(value: unknown): value is CandidateOfficialMarketplaceBaseline {
  return isRecord(value) && typeof value.reference === "string" && isSha256(value.marketplaceManifestSha256)
    && typeof value.pluginName === "string" && typeof value.sourceUrl === "string"
    && /^[a-f0-9]{40}$/u.test(String(value.sourceCommit)) && isBaselineSourceBlobList(value.sourceBlobs);
}

function isBaselineSourceBlobList(value: unknown): value is SourceBlobBinding[] {
  return Array.isArray(value) && value.every((item) =>
    isRecord(item) && typeof item.path === "string" && isCanonicalRepositoryRelativePosixPath(item.path)
      && typeof item.immutableRawUrl === "string" && isSha256(item.contentSha256)
  ) && uniqueStrings(value.map((item) => String((item as Record<string, unknown>).path)));
}

function validateImmutableRawUrls(
  baseline: CandidateOfficialMarketplaceBaseline,
  evidenceId: string
): void {
  const repository = githubRepositoryIdentity(baseline.sourceUrl);
  if (repository === undefined) {
    throw new Error(`${evidenceId}: officialBaseline source URL cannot derive an immutable raw URL`);
  }
  for (const blob of baseline.sourceBlobs) {
    const expected = `https://raw.githubusercontent.com/${repository.owner}/${repository.repository}/${baseline.sourceCommit}/${blob.path}`;
    if (blob.immutableRawUrl !== expected) {
      throw new Error(`${evidenceId}: immutable raw URL must be derived exactly from source repository, commit, and path`);
    }
  }
}

function githubRepositoryIdentity(sourceUrl: string): { owner: string; repository: string } | undefined {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port !== ""
    || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return undefined;
  }
  const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/u.exec(url.pathname);
  return match === null ? undefined : { owner: match[1]!, repository: match[2]! };
}

function isOfficialSourceCapabilityClaim(value: unknown): value is OfficialSourceCapabilityClaim {
  return isRecord(value) && typeof value.id === "string" && typeof value.capabilityId === "string"
    && (value.support === "direct" || value.support === "inferred")
    && isSourceBlobList(value.sourceBlobs) && typeof value.claim === "string";
}

function isStoredSourceBlobList(value: unknown): value is SourceBlobBinding[] {
  return isSourceBlobList(value);
}

function isSourceBlobList(value: unknown): value is SourceBlobBinding[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) =>
    isRecord(item) && typeof item.path === "string" && isCanonicalRepositoryRelativePosixPath(item.path)
      && typeof item.immutableRawUrl === "string" && isSha256(item.contentSha256)
  ) && uniqueStrings(value.map((item) => String((item as Record<string, unknown>).path)));
}

function sameSourceBlobs(
  left: readonly SourceBlobBinding[] | undefined,
  right: readonly SourceBlobBinding[]
): boolean {
  return left !== undefined && left.length === right.length
    && left.every((blob, index) => sameSourceBlob(blob, right[index]!));
}

function sameSourceBlob(left: SourceBlobBinding, right: SourceBlobBinding): boolean {
  return left.path === right.path
    && left.contentSha256 === right.contentSha256
    && left.immutableRawUrl === right.immutableRawUrl;
}

function uniqueStrings(values: readonly string[]): boolean {
  return values.length === new Set(values).size;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateObservationEvidence(
  evidence: CandidateCapabilityEvidence,
  candidate: DecisionCandidateProjection,
  observation: SourceObservation
): void {
  const match = /^research\/snapshots\/([a-z0-9][a-z0-9-]*)\.json#\/entries\/(0|[1-9][0-9]*)$/u.exec(evidence.reference);
  if (match === null) {
    throw new Error(`${evidence.id}: observation reference must identify a snapshot entry JSON Pointer`);
  }
  if (match[1] !== observation.snapshot.id || observation.snapshot.entries[Number(match[2])] === undefined) {
    throw new Error(`${evidence.id}: observation reference does not exist in the current source snapshot`);
  }
  if (evidence.contentSha256 !== observation.snapshot.contentSha256) {
    throw new Error(`${evidence.id}: contentSha256 does not match the current observation`);
  }
  if (candidate.skillPath !== null && !snapshotAttestsPath(observation.snapshot, candidate.skillPath)) {
    throw new Error(`${evidence.id}: current observation does not attest the candidate skillPath`);
  }
}

async function readJson(root: string, relativePath: string): Promise<unknown> {
  return JSON.parse((await readRepositoryFile(root, relativePath)).toString("utf8")) as unknown;
}

async function readRepositoryFile(root: string, relativePath: string): Promise<Buffer> {
  const repositoryRoot = await canonicalizeContainedReadRoot(root);
  return readContainedRegularFile(repositoryRoot, relativePath);
}

async function loadOptionalYaml(path: string): Promise<unknown | undefined> {
  try {
    return await loadYaml<unknown>(path);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function validateStarterRoutes(
  value: unknown,
  capabilities: readonly CapabilityManifest[],
  candidates: readonly DecisionCandidateProjection[],
  evidence: readonly CandidateCapabilityEvidence[]
): DecisionStarterRoute[] {
  try {
    return validateDecisionStarterRoutesSemantics(value, {
      expectedDomainIds: STARTER_ROUTE_DOMAIN_IDS,
      capabilities,
      candidates,
      evidence
    }).routes.map((route) => structuredClone(route));
  } catch (error) {
    throw new Error(`manifests/decision-starter-routes.yaml: ${errorMessage(error)}`, { cause: error });
  }
}

function projectStarterRoutesAfterQuarantine(
  routes: readonly DecisionStarterRoute[],
  evidence: readonly CandidateCapabilityEvidence[],
  quarantinedCandidateIds: ReadonlySet<string>
): DecisionStarterRoute[] {
  if (quarantinedCandidateIds.size === 0) return routes.map((route) => structuredClone(route));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return routes.map((route) => {
    const keepEvidence = (id: string): boolean => {
      const item = evidenceById.get(id);
      return item !== undefined && !quarantinedCandidateIds.has(item.candidateId);
    };
    const directEvidenceIds = route.directEvidenceIds.filter(keepEvidence);
    const inferredEvidenceIds = route.inferredEvidenceIds.filter(keepEvidence);
    const relatedEvidenceIds = route.relatedEvidenceIds?.filter(keepEvidence);
    const retainedSupportedCapabilities = new Set([...directEvidenceIds, ...inferredEvidenceIds]
      .map((id) => evidenceById.get(id)!.capabilityId));
    const removedSupportedCapabilities = [...route.directEvidenceIds, ...route.inferredEvidenceIds]
      .filter((id) => !keepEvidence(id))
      .map((id) => evidenceById.get(id)?.capabilityId)
      .filter((id): id is string => id !== undefined && !retainedSupportedCapabilities.has(id));
    return {
      ...structuredClone(route),
      orderedCandidateIds: route.orderedCandidateIds.filter((id) => !quarantinedCandidateIds.has(id)),
      directEvidenceIds,
      inferredEvidenceIds,
      ...(route.relatedEvidenceIds === undefined ? {} : { relatedEvidenceIds }),
      unsupportedCapabilityIds: [...new Set([
        ...route.unsupportedCapabilityIds,
        ...removedSupportedCapabilities
      ])].sort(compareCodePointStrings),
      broadCoverageComplete: false
    };
  });
}

function copyProfile(profile: IntentProfile): IntentProfile {
  return {
    ...profile,
    phrases: { ko: [...profile.phrases.ko], en: [...profile.phrases.en] },
    requiredCapabilityIds: [...profile.requiredCapabilityIds]
  };
}

function copyCandidate(candidate: DecisionCandidateProjection): DecisionCandidateProjection {
  return structuredClone(candidate);
}

function copyCandidateWithOfficialInstall(
  candidate: DecisionCandidateProjection,
  identity: VerifiedOfficialMarketplaceIdentity | undefined,
  targetVerified: boolean
): DecisionCandidateProjection {
  const copy = copyCandidate(candidate);
  delete copy.claudeInstall;
  if (identity === undefined
    || copy.state !== "eligible-with-disclosures"
    || copy.runtime !== "claude-code"
    || !targetVerified) return copy;
  return {
    ...copy,
    displayName: identity.displayName,
    description: identity.description,
    claudeInstall: {
      sourceId: copy.sourceId,
      pluginName: identity.pluginName,
      marketplaceId: identity.marketplaceId,
      marketplaceSource: identity.marketplaceSource,
      scope: identity.scope,
      argv: [...identity.argv] as ["claude", "plugin", "install", string, "--scope", "user"]
    }
  };
}

async function candidateRevisionArtifactDigests(
  root: string,
  manifest: DecisionCandidateEvidenceManifest
): Promise<Record<string, string>> {
  const paths = [...new Set((manifest.candidateRevisions ?? []).map(({ approval }) => approval.evidenceArtifactPath))];
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [
    path,
    createHash("sha256").update(await readRepositoryFile(root, path)).digest("hex")
  ])));
}

function validateMaterializedOfficialInstallBindings(
  index: DecisionIndex,
  records: readonly VerifiedOfficialMarketplaceIdentityRecord[]
): void {
  const identityByCandidate = new Map(records.map((record) => [record.candidate, record.identity]));
  for (const candidate of index.candidates) {
    const identity = identityByCandidate.get(candidate);
    if (identity === undefined) {
      if (candidate.claudeInstall !== undefined) {
        throw new Error(`${candidate.id}: generated Claude install binding has no current official identity`);
      }
      continue;
    }
    const expected = copyCandidateWithOfficialInstall(
      candidate,
      identity,
      candidate.stateReasons.includes(targetVerifiedReason(candidate.runtime, "darwin"))
        && candidate.eligibility?.targetExpiresAt.darwin !== undefined
    ).claudeInstall;
    if (expected === undefined) {
      if (candidate.claudeInstall !== undefined) {
        throw new Error(`${candidate.id}: ineligible official candidate exposes a Claude install binding`);
      }
      continue;
    }
    if (stableValue(candidate.claudeInstall) !== stableValue(expected)
      || candidate.displayName !== identity.displayName || candidate.description !== identity.description) {
      throw new Error(`${candidate.id}: generated Claude install binding does not match the current official identity`);
    }
  }
}

function validateMaterializedOfficialDecisionMetadata(
  index: DecisionIndex,
  evidence: readonly OfficialTargetCompatibilityEvidence[]
): void {
  for (const candidate of index.candidates.filter((item) => item.claudeInstall !== undefined)) {
    const current = evidence.filter((item) => item.candidateId === candidate.id
      && Date.parse(item.observedAt) <= Date.parse(item.reviewedAt)
      && Date.parse(item.reviewedAt) <= Date.parse(index.observedThrough)
      && Date.parse(index.observedThrough) < Date.parse(item.expiresAt));
    const targetExpiresAt = Object.fromEntries(current.map((item) => [item.platform, item.expiresAt]));
    const targetEvidenceAt = Object.fromEntries(current.map((item) => [item.platform, item.reviewedAt]));
    const reviewedAt = null;
    if (stableValue(candidate.eligibility) !== stableValue({ reviewExpiresAt: null, targetExpiresAt })
      || stableValue(candidate.ranking) !== stableValue({ targetEvidenceAt, reviewedAt })) {
      throw new Error(`${candidate.id}: generated decision expiry or ranking metadata does not match official evidence`);
    }
  }
}

function freezeVerifiedOfficialMarketplaceBinding(
  candidate: DecisionCandidateProjection,
  evidence: CandidateCapabilityEvidence
): VerifiedOfficialMarketplaceCandidateBinding {
  return Object.freeze({
    id: candidate.id,
    sourceId: candidate.sourceId,
    runtime: candidate.runtime,
    skillPath: candidate.skillPath,
    capabilityEvidenceIds: Object.freeze([...candidate.capabilityEvidenceIds]),
    evidence: Object.freeze({
      id: evidence.id,
      candidateId: evidence.candidateId,
      capabilityId: evidence.capabilityId,
      kind: evidence.kind,
      current: evidence.current,
      reference: evidence.reference,
      contentSha256: evidence.contentSha256
    })
  });
}

function matchesVerifiedOfficialMarketplaceBinding(
  record: VerifiedOfficialMarketplaceIdentityRecord,
  candidate: DecisionCandidateProjection
): boolean {
  const { binding, evidence } = record;
  return record.candidate === candidate
    && candidate.id === binding.id
    && candidate.sourceId === binding.sourceId
    && candidate.runtime === binding.runtime
    && candidate.runtime === "claude-code"
    && candidate.skillPath === binding.skillPath
    && candidate.skillPath === null
    && candidate.id === record.identity.pluginName
    && stableValue(candidate.claudeInstall) === stableValue({
      sourceId: candidate.sourceId,
      pluginName: record.identity.pluginName,
      marketplaceId: record.identity.marketplaceId,
      marketplaceSource: record.identity.marketplaceSource,
      scope: record.identity.scope,
      argv: record.identity.argv
    })
    && sameStrings(candidate.capabilityEvidenceIds, binding.capabilityEvidenceIds)
    && evidence.id === binding.evidence.id
    && evidence.candidateId === binding.evidence.candidateId
    && evidence.candidateId === candidate.id
    && evidence.capabilityId === binding.evidence.capabilityId
    && evidence.kind === binding.evidence.kind
    && (evidence.kind === "official-baseline" || evidence.kind === "official-listing")
    && evidence.current === binding.evidence.current
    && evidence.current === true
    && evidence.reference === binding.evidence.reference
    && evidence.contentSha256 === binding.evidence.contentSha256
    && candidate.capabilityEvidenceIds.includes(evidence.id);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key), seen);
  }
  return Object.freeze(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableValue(value)).digest("hex");
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareCodePointStrings)
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
