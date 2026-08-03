import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { parse } from "yaml";
import {
  validateConflictGroup,
  validateProvider,
  validateProviderSelection,
  validateResearchCensus,
  validateResearchCollectionReceipt,
  validateResearchContext,
  validateResearchEvidence,
  validateResearchQueue,
  validateSourceReviewBacklog,
  validateResearchSnapshot,
  validateResearchSourceConfig,
  validateReviewSourceIndex,
  validateReviewSourceExtensionIndex,
  validateSourceReview
} from "../contracts/complete-v1.js";
import { DECISION_BROKER_V1_REQUIRED_RESEARCH_SURFACES } from "../contracts/complete-v1.js";
import { validateObservationEvidence, validateSourceDiff, validateSourceObservation } from "../contracts/observation.js";
import { validateReviewerRegistry } from "../contracts/review-ledger.js";
import {
  loadOfficialMarketplaceSelection,
  validateOfficialMarketplaceArtifact
} from "../discovery/official-marketplace.js";
import type {
  ConflictGroupManifest,
  ProviderManifest,
  ProviderSelectionManifest,
  ResearchCensus,
  ResearchCollectionReceipt,
  ResearchEvaluationContext,
  ResearchEvidence,
  ResearchQueue,
  SourceReviewBacklog,
  ResearchSnapshot,
  ResearchSourceConfig,
  ReviewSourceIndex,
  ReviewSourceExtensionIndex,
  SourceReviewManifest
} from "../model/complete-v1.js";
import type { ObservationEvidence, SourceDiff, SourceObservation } from "../model/observation.js";
import type { ReviewLedgerEvent, ReviewerRegistry } from "../model/review-ledger.js";
import { deepFreezeRepositoryData } from "../repository/deep-freeze-data.js";
import { readContainedRegularFile } from "../repository/contained-read.js";
import { compareCodePointStrings, verifyResearchSnapshot } from "./snapshot.js";
import { parseReviewLedgerJsonl } from "./review-ledger.js";
import { materializeReviewState, type MaterializedReviewState } from "./review-state.js";
import { baselineSourceDiff, materializeSourceDiff } from "./source-diff.js";
import { materializeSourceObservationContexts } from "./source-observation.js";
import { assertSourceReviewBacklog } from "./source-review-backlog.js";
import { assertResearchTriadOwnership } from "./source-ownership.js";
import { validateObservedMarketplaceEvidenceBinding } from "./observed-marketplace-evidence.js";

export interface ResearchRepository {
  census: ResearchCensus;
  reviewSourceIndex: ReviewSourceIndex;
  reviewSourceExtensions: ReviewSourceExtensionIndex;
  baselineContext: ResearchEvaluationContext;
  context: ResearchEvaluationContext;
  sourceConfigs: ResearchSourceConfig[];
  collectionReceipts: ResearchCollectionReceipt[];
  snapshots: ResearchSnapshot[];
  evidence: ResearchEvidence[];
  observationEvidence: ObservationEvidence[];
  sourceObservations: SourceObservation[];
  sourceDiffs: SourceDiff[];
  materializedReviewState: MaterializedReviewState[];
  reviewLedger: ReviewLedgerEvent[];
  reviewers: ReviewerRegistry;
  queue: ResearchQueue;
  sourceReviewBacklog: SourceReviewBacklog;
  providers: ProviderManifest[];
  sourceReviews: SourceReviewManifest[];
  conflicts: ConflictGroupManifest[];
  providerSelections?: ProviderSelectionManifest[];
}

export interface AuthenticatedSourceObservation {
  source: ResearchSourceConfig;
  receipt: ResearchCollectionReceipt;
  snapshot: ResearchSnapshot;
  materialized: SourceObservation;
}

interface ObservationAuthenticationSurfaces {
  census: ResearchCensus;
  reviewSourceIndex: ReviewSourceIndex;
  reviewSourceExtensions: ReviewSourceExtensionIndex;
  sourceConfigs: LoadedRecord<ResearchSourceConfig>[];
  collectionReceipts: LoadedRecord<ResearchCollectionReceipt>[];
  snapshots: LoadedRecord<ResearchSnapshot>[];
  sourceReviewBacklog: SourceReviewBacklog;
  observationEvidence: LoadedRecord<ObservationEvidence>[];
  sourceObservations: SourceObservation[];
}

interface ObservationAuthenticationCacheEntry {
  fingerprint: string;
  surfaces: ObservationAuthenticationSurfaces;
}

const observationAuthenticationCache = new Map<string, ObservationAuthenticationCacheEntry>();
const OBSERVATION_AUTHENTICATION_CACHE_LIMIT = 4;

const rootAuthenticatedResearchRepositories = new WeakSet<ResearchRepository>();

interface LoadedRecord<T> {
  path: string;
  value: T;
}

interface RepositoryRoot {
  path: string;
}

interface DirectRecordRoot<T> {
  relativeDirectory: string;
  extension: ".json" | ".yaml";
  kind: string;
  validate: (value: unknown) => T;
  identity: (value: T) => string;
  allowedDirectories?: readonly string[];
}

const evidenceArtifactsDirectory = "research/evidence/artifacts";
const requiredDirectories = [
  "research",
  "research/sources",
  "research/receipts",
  "research/snapshots",
  "research/evidence",
  evidenceArtifactsDirectory,
  "research/observation-evidence",
  "manifests",
  "manifests/complete-v1-providers",
  "manifests/provider-selections",
  "manifests/source-reviews",
  "manifests/conflicts"
] as const;

export async function loadResearchRepository(root: string): Promise<ResearchRepository> {
  const repositoryRoot = await canonicalizeRepositoryRoot(root);
  await assertRequiredRoots(repositoryRoot);
  await assertRequiredDecisionResearchSurfaces(repositoryRoot);

  const {
    census,
    reviewSourceIndex,
    reviewSourceExtensions,
    sourceConfigs,
    collectionReceipts,
    snapshots,
    sourceReviewBacklog,
    observationEvidence,
    sourceObservations
  } = await loadObservationAuthenticationSurfaces(repositoryRoot);
  const baselineContext = await loadJsonDocument(repositoryRoot, "research/evaluation-context.json", validateResearchContext);
  const context = await loadJsonDocument(repositoryRoot, "research/current-evaluation-context.json", validateResearchContext);

  const evidence = await loadDirectRecords(repositoryRoot, {
    relativeDirectory: "research/evidence",
    extension: ".json",
    kind: "research evidence",
    validate: validateResearchEvidence,
    identity: ({ id }) => id,
    allowedDirectories: ["artifacts"]
  });
  await verifyEvidenceArtifacts(repositoryRoot, evidence.map(({ value }) => value));

  const queue = await loadJsonDocument(repositoryRoot, "research/review-queue.json", validateResearchQueue);
  const sourceDiffs = await loadJsonDocument(
    repositoryRoot,
    "research/source-diffs.json",
    validateSourceDiffsDocument
  );
  const materializedReviewStateDocument = await loadJsonDocument(
    repositoryRoot,
    "research/materialized-review-state.json",
    validateMaterializedReviewStateDocument
  );
  const reviewLedger = parseReviewLedgerJsonl(await readRegularFile(repositoryRoot, "research/review-ledger.jsonl"));
  const reviewers = await loadJsonDocument(
    repositoryRoot,
    "governance/reviewers.json",
    validateReviewerRegistry
  );
  await validateObservedMarketplaceEvidenceBindings(repositoryRoot, {
    evidence: evidence.map(({ value }) => value),
    observationEvidence: observationEvidence.map(({ value }) => value),
    sourceConfigs: sourceConfigs.map(({ value }) => value)
  });
  const providers = await loadDirectRecords(repositoryRoot, {
    relativeDirectory: "manifests/complete-v1-providers",
    extension: ".yaml",
    kind: "provider manifest",
    validate: validateProvider,
    identity: ({ id }) => id
  });
  const providerSelections = await loadDirectRecords(repositoryRoot, {
    relativeDirectory: "manifests/provider-selections",
    extension: ".yaml",
    kind: "provider selection manifest",
    validate: validateProviderSelection,
    identity: ({ id }) => id
  });
  const sourceReviews = await loadDirectRecords(repositoryRoot, {
    relativeDirectory: "manifests/source-reviews",
    extension: ".yaml",
    kind: "source review manifest",
    validate: validateSourceReview,
    identity: ({ id }) => id
  });
  const conflicts = await loadDirectRecords(repositoryRoot, {
    relativeDirectory: "manifests/conflicts",
    extension: ".yaml",
    kind: "conflict group manifest",
    validate: validateConflictGroup,
    identity: ({ id }) => id
  });
  assertCurrentContext(baselineContext, context, snapshots.map(({ value }) => value));
  assertExtensionReachability(reviewSourceExtensions, queue, sourceReviews.map(({ value }) => value), evidence.map(({ value }) => value));
  assertDecisionResearchMaterialization({
    sourceConfigs: sourceConfigs.map(({ value }) => value),
    collectionReceipts: collectionReceipts.map(({ value }) => value),
    snapshots: snapshots.map(({ value }) => value),
    sourceReviewBacklog,
    observationEvidence: observationEvidence.map(({ value }) => value),
    reviewLedger,
    reviewers,
    sourceObservations,
    sourceDiffs,
    materializedReviewState: materializedReviewStateDocument.states,
    asOf: materializedReviewStateDocument.asOf
  });

  const repository: ResearchRepository = {
    census,
    reviewSourceIndex,
    reviewSourceExtensions,
    baselineContext,
    context,
    sourceConfigs: sourceConfigs.map(({ value }) => value),
    collectionReceipts: collectionReceipts.map(({ value }) => value),
    snapshots: snapshots.map(({ value }) => value),
    evidence: evidence.map(({ value }) => value),
    observationEvidence: observationEvidence.map(({ value }) => value),
    sourceObservations,
    sourceDiffs,
    materializedReviewState: materializedReviewStateDocument.states,
    reviewLedger,
    reviewers,
    queue,
    sourceReviewBacklog,
    providers: providers.map(({ value }) => value),
    providerSelections: providerSelections.map(({ value }) => value),
    sourceReviews: sourceReviews.map(({ value }) => value),
    conflicts: conflicts.map(({ value }) => value)
  };
  const frozenRepository = deepFreezeRepositoryData(repository);
  rootAuthenticatedResearchRepositories.add(frozenRepository);
  return frozenRepository;
}

/** Returns whether this exact object completed the root repository validation flow. */
export function isRootResearchRepository(repository: ResearchRepository): boolean {
  return rootAuthenticatedResearchRepositories.has(repository);
}

/** Creates one request-scoped loader that authenticates shared research surfaces once. */
export function createAuthenticatedSourceObservationLoader(
  root: string
): (sourceId: string) => Promise<AuthenticatedSourceObservation> {
  let surfaces: Promise<ObservationAuthenticationSurfaces> | undefined;
  return async (sourceId: string) => {
    surfaces ??= (async () => {
      const repositoryRoot = await canonicalizeRepositoryRoot(root);
      return loadObservationAuthenticationSurfaces(repositoryRoot);
    })();
    return authenticateSourceObservation(await surfaces, sourceId);
  };
}

async function loadObservationAuthenticationSurfaces(
  root: RepositoryRoot
): Promise<ObservationAuthenticationSurfaces> {
  const fingerprint = await observationAuthenticationFingerprint(root);
  const cached = observationAuthenticationCache.get(root.path);
  if (cached?.fingerprint === fingerprint) {
    observationAuthenticationCache.delete(root.path);
    observationAuthenticationCache.set(root.path, cached);
    return cached.surfaces;
  }
  observationAuthenticationCache.delete(root.path);
  try {
    const surfaces = deepFreezeRepositoryData(await loadObservationAuthenticationSurfacesUncached(root));
    const confirmedFingerprint = await observationAuthenticationFingerprint(root);
    if (confirmedFingerprint !== fingerprint) {
      throw new Error("research observation authentication surfaces changed during validation");
    }
    observationAuthenticationCache.set(root.path, { fingerprint, surfaces });
    while (observationAuthenticationCache.size > OBSERVATION_AUTHENTICATION_CACHE_LIMIT) {
      const oldest = observationAuthenticationCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      observationAuthenticationCache.delete(oldest);
    }
    return surfaces;
  } catch (error) {
    observationAuthenticationCache.delete(root.path);
    throw error;
  }
}

async function loadObservationAuthenticationSurfacesUncached(
  root: RepositoryRoot
): Promise<ObservationAuthenticationSurfaces> {
  const [
    census,
    reviewSourceIndex,
    reviewSourceExtensions,
    sourceConfigs,
    collectionReceipts,
    snapshots,
    sourceReviewBacklog,
    observationEvidence,
    sourceObservations
  ] = await Promise.all([
    loadJsonDocument(root, "research/census.json", validateResearchCensus),
    loadJsonDocument(root, "research/review-source-index.json", validateReviewSourceIndex),
    loadJsonDocument(root, "research/review-source-extensions.json", validateReviewSourceExtensionIndex),
    loadDirectRecords(root, {
      relativeDirectory: "research/sources",
      extension: ".json",
      kind: "research source config",
      validate: validateResearchSourceConfig,
      identity: ({ sourceId }) => sourceId
    }),
    loadDirectRecords(root, {
      relativeDirectory: "research/receipts",
      extension: ".json",
      kind: "research collection receipt",
      validate: validateResearchCollectionReceipt,
      identity: ({ id }) => id
    }),
    loadDirectRecords(root, {
      relativeDirectory: "research/snapshots",
      extension: ".json",
      kind: "research snapshot",
      validate: (value) => verifyResearchSnapshot(validateResearchSnapshot(value)),
      identity: ({ id }) => id
    }),
    loadJsonDocument(root, "research/source-review-backlog.json", validateSourceReviewBacklog),
    loadDirectRecords(root, {
      relativeDirectory: "research/observation-evidence",
      extension: ".json",
      kind: "observation evidence",
      validate: validateObservationEvidence,
      identity: ({ id }) => id
    }),
    loadJsonDocument(root, "research/source-observations.json", validateSourceObservationsDocument)
  ]);
  const values = {
    census,
    reviewSourceIndex,
    reviewSourceExtensions,
    sourceConfigs: sourceConfigs.map(({ value }) => value),
    collectionReceipts: collectionReceipts.map(({ value }) => value),
    snapshots: snapshots.map(({ value }) => value)
  };
  assertResearchTriadOwnership({
    census,
    reviewSourceIndex,
    reviewSourceExtensions,
    sourceConfigs,
    collectionReceipts,
    snapshots
  });
  assertSourceReviewBacklog({
    backlog: sourceReviewBacklog,
    sourceConfigs: values.sourceConfigs,
    collectionReceipts: values.collectionReceipts,
    snapshots: values.snapshots
  });
  const materialized = materializeSourceObservationContexts({
    sourceConfigs: values.sourceConfigs,
    collectionReceipts: values.collectionReceipts,
    snapshots: values.snapshots,
    observationEvidence: observationEvidence.map(({ value }) => value),
    sourceReviewBacklog
  }).map(({ source }) => source);
  if (!sameJsonValue(sourceObservations, materialized)) {
    throw new Error("research/source-observations.json: is not the current deterministic materialization");
  }
  return {
    census,
    reviewSourceIndex,
    reviewSourceExtensions,
    sourceConfigs,
    collectionReceipts,
    snapshots,
    sourceReviewBacklog,
    observationEvidence,
    sourceObservations
  };
}

async function observationAuthenticationFingerprint(root: RepositoryRoot): Promise<string> {
  const paths = [
    "research/census.json",
    "research/review-source-index.json",
    "research/review-source-extensions.json",
    "research/source-review-backlog.json",
    "research/source-observations.json"
  ];
  for (const directory of [
    "research/sources",
    "research/receipts",
    "research/snapshots",
    "research/observation-evidence"
  ]) {
    for (const entry of await directoryEntries(root, directory)) {
      paths.push(joinRepositoryPath(directory, entry));
    }
  }
  paths.sort(compareCodePointStrings);
  const records = await Promise.all(paths.map(async (path) => ({
    path,
    bytes: await readContainedRegularFile(root, path)
  })));
  const hash = createHash("sha256");
  for (const { path, bytes } of records) {
    hash.update(`${Buffer.byteLength(path)}:`);
    hash.update(path);
    hash.update(`:${bytes.byteLength}:`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function authenticateSourceObservation(
  surfaces: ObservationAuthenticationSurfaces,
  sourceId: string
): AuthenticatedSourceObservation {
  const source = surfaces.sourceConfigs.find(({ value }) => value.sourceId === sourceId)?.value;
  const receipt = surfaces.collectionReceipts
    .filter(({ value }) => value.sourceId === sourceId)
    .sort((left, right) => compareCodePointStrings(right.value.observedAt, left.value.observedAt)
      || compareCodePointStrings(right.value.id, left.value.id))[0]?.value;
  const snapshot = receipt === undefined
    ? undefined
    : surfaces.snapshots.find(({ value }) => value.id === receipt.snapshotId)?.value;
  const materialized = surfaces.sourceObservations.find((observation) => observation.sourceId === sourceId);
  if (source === undefined || receipt === undefined || snapshot === undefined || materialized === undefined) {
    throw new Error(`${sourceId}: authenticated source observation does not resolve exactly once`);
  }
  if (receipt.observedAt !== snapshot.observedAt || receipt.inspectedCommit !== snapshot.inspectedCommit
    || receipt.snapshotContentSha256 !== snapshot.contentSha256 || snapshot.sourceUrl !== source.repository) {
    throw new Error(`${sourceId}: latest snapshot provenance does not match its source binding and receipt`);
  }
  return { source, receipt, snapshot, materialized };
}

async function loadDirectRecords<T>(
  root: RepositoryRoot,
  definition: DirectRecordRoot<T>
): Promise<LoadedRecord<T>[]> {
  const entries = await directoryEntries(root, definition.relativeDirectory);
  const allowedDirectories = new Set(definition.allowedDirectories ?? []);
  const dataPaths: string[] = [];
  let gitkeepPath: string | undefined;

  for (const entry of entries) {
    const relativePath = joinRepositoryPath(definition.relativeDirectory, entry);
    const stat = await lstatPath(root, relativePath);
    if (entry === ".gitkeep") {
      assertGitkeep(relativePath, stat);
      gitkeepPath = relativePath;
      continue;
    }
    if (allowedDirectories.has(entry)) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${relativePath}: must be a direct regular non-symlink directory`);
      }
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${relativePath}: must be a direct regular non-symlink ${definition.extension} file`);
    }
    if (!entry.endsWith(definition.extension)) {
      throw new Error(`${relativePath}: must use the ${definition.extension} extension`);
    }
    dataPaths.push(relativePath);
  }

  if (dataPaths.length === 0) {
    if (gitkeepPath === undefined) {
      throw new Error(
        `${definition.relativeDirectory}: empty tracked root requires exactly one zero-byte regular non-symlink .gitkeep`
      );
    }
  }

  const records: LoadedRecord<T>[] = [];
  for (const path of dataPaths) {
    records.push({
      path,
      value: definition.extension === ".json"
        ? await loadJsonDocument(root, path, definition.validate)
        : await loadYamlDocument(root, path, definition.validate)
    });
  }

  rejectDuplicateIdentities(definition.kind, records, definition.identity);
  return records.sort((left, right) => compareCodePointStrings(
    definition.identity(left.value),
    definition.identity(right.value)
  ));
}

async function loadOptionalDirectRecords<T>(
  root: RepositoryRoot,
  definition: DirectRecordRoot<T>
): Promise<LoadedRecord<T>[]> {
  try {
    await lstatPath(root, definition.relativeDirectory);
  } catch (error) {
    if (errorMessage(error) === `${definition.relativeDirectory}: missing required path`) return [];
    throw error;
  }
  return loadDirectRecords(root, definition);
}

function validateSourceObservationsDocument(value: unknown): SourceObservation[] {
  const document = generatedDocument(value, "observations");
  const observations = document.observations.map(validateSourceObservation);
  assertGeneratedSourceOrder(observations, "source observations");
  return observations;
}

function validateSourceDiffsDocument(value: unknown): SourceDiff[] {
  const document = generatedDocument(value, "diffs");
  const diffs = document.diffs.map(validateSourceDiff);
  assertGeneratedSourceOrder(diffs, "source diffs");
  return diffs;
}

function validateMaterializedReviewStateDocument(value: unknown): { asOf: string; states: MaterializedReviewState[] } {
  if (!isRecord(value) || value.schemaVersion !== 3 || typeof value.asOf !== "string" || !Array.isArray(value.states)
    || Object.keys(value).length !== 3) {
    throw new Error("Invalid materialized review state document");
  }
  const states = value.states.map(validateMaterializedReviewState);
  let previous: MaterializedReviewState | undefined;
  for (const state of states) {
    if (previous !== undefined && compareCodePointStrings(previous.sourceId, state.sourceId) > 0) {
      throw new Error("materialized review state must be source sorted");
    }
    if (previous !== undefined && previous.sourceId === state.sourceId
      && compareNullableCodePointStrings(previous.skillPath, state.skillPath) >= 0) {
      throw new Error("materialized review state must be target sorted and unique");
    }
    previous = state;
  }
  return { asOf: value.asOf, states };
}

function generatedDocument(value: unknown, collection: "observations" | "diffs"): Record<typeof collection, unknown[]> {
  if (!isRecord(value) || value.schemaVersion !== 3 || !Array.isArray(value[collection]) || Object.keys(value).length !== 2) {
    throw new Error(`Invalid generated ${collection} document`);
  }
  return { [collection]: value[collection] } as Record<typeof collection, unknown[]>;
}

/** Every checked-in v1 projection is derived again before a caller may use it. */
function assertDecisionResearchMaterialization(input: {
  sourceConfigs: readonly ResearchSourceConfig[];
  collectionReceipts: readonly ResearchCollectionReceipt[];
  snapshots: readonly ResearchSnapshot[];
  sourceReviewBacklog: SourceReviewBacklog;
  observationEvidence: readonly ObservationEvidence[];
  reviewLedger: readonly ReviewLedgerEvent[];
  reviewers: ReviewerRegistry;
  sourceObservations: readonly SourceObservation[];
  sourceDiffs: readonly SourceDiff[];
  materializedReviewState: readonly MaterializedReviewState[];
  asOf: string;
}): void {
  const contexts = materializeSourceObservationContexts({
    sourceConfigs: input.sourceConfigs,
    collectionReceipts: input.collectionReceipts,
    snapshots: input.snapshots,
    observationEvidence: input.observationEvidence,
    sourceReviewBacklog: input.sourceReviewBacklog
  });
  const observations = contexts.map(({ source }) => source);
  const diffs = contexts.map(({ source, evidence, previousEvidence }) => evidence === undefined
    ? baselineSourceDiff({ sourceId: source.sourceId, currentEvidenceId: source.latestEvidenceId })
    : materializeSourceDiff({ current: evidence, previous: previousEvidence }));
  const states = materializeReviewState({
    observations: contexts,
    diffs,
    ledger: input.reviewLedger,
    reviewers: input.reviewers,
    asOf: input.asOf
  });
  if (!sameJsonValue(input.sourceObservations, observations)) {
    throw new Error("research/source-observations.json: is not the current deterministic materialization");
  }
  if (!sameJsonValue(input.sourceDiffs, diffs)) {
    throw new Error("research/source-diffs.json: is not the current deterministic materialization");
  }
  if (!sameJsonValue(input.materializedReviewState, states)) {
    throw new Error("research/materialized-review-state.json: is not the current deterministic materialization");
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertGeneratedSourceOrder(values: readonly { sourceId: string }[], kind: string): void {
  let previous: string | undefined;
  for (const value of values) {
    if (previous !== undefined && compareCodePointStrings(previous, value.sourceId) >= 0) {
      throw new Error(`${kind} must be source sorted and unique`);
    }
    previous = value.sourceId;
  }
}

function validateMaterializedReviewState(value: unknown): MaterializedReviewState {
  if (!isRecord(value) || Object.keys(value).length !== 10
    || typeof value.sourceId !== "string"
    || (typeof value.skillPath !== "string" && value.skillPath !== null)
    || !["approved", "held", "blocked"].includes(String(value.state))
    || !["not-reviewed", "current", "blocked", "stale", "stale-evidence"].includes(String(value.reason))
    || (typeof value.decisionId !== "string" && value.decisionId !== null)
    || (typeof value.invalidatedDecisionId !== "string" && value.invalidatedDecisionId !== null)
    || typeof value.snapshotId !== "string"
    || typeof value.inspectedCommit !== "string"
    || typeof value.observedAt !== "string"
    || !["baseline", "unchanged", "changed", "unknown"].includes(String(value.changeStatus))) {
    throw new Error("Invalid materialized review state");
  }
  return value as unknown as MaterializedReviewState;
}

async function loadJsonDocument<T>(
  root: RepositoryRoot,
  relativePath: string,
  validate: (value: unknown) => T
): Promise<T> {
  const source = await readRegularFile(root, relativePath);
  try {
    return validate(JSON.parse(source) as unknown);
  } catch (error) {
    throw new Error(`${relativePath}: ${errorMessage(error)}`, { cause: error });
  }
}

async function loadOptionalJsonDocument<T>(
  root: RepositoryRoot,
  relativePath: string,
  validate: (value: unknown) => T
): Promise<T | undefined> {
  try {
    return await loadJsonDocument(root, relativePath, validate);
  } catch (error) {
    if (errorMessage(error) === `${relativePath}: missing required path`) return undefined;
    throw error;
  }
}

async function loadYamlDocument<T>(
  root: RepositoryRoot,
  relativePath: string,
  validate: (value: unknown) => T
): Promise<T> {
  const source = await readRegularFile(root, relativePath);
  try {
    return validate(parse(source) as unknown);
  } catch (error) {
    throw new Error(`${relativePath}: ${errorMessage(error)}`, { cause: error });
  }
}

function assertCurrentContext(
  baseline: ResearchEvaluationContext,
  current: ResearchEvaluationContext,
  snapshots: readonly ResearchSnapshot[]
): void {
  if (Date.parse(current.asOf) < Date.parse(baseline.asOf)) {
    throw new Error("research/current-evaluation-context.json: asOf must not precede research/evaluation-context.json");
  }
  const snapshotIds = new Set(snapshots.map(({ id }) => id));
  const currentByIdentity = new Map(current.upstreamObservations.map((observation) => [observationKey(observation), observation]));
  for (const observation of baseline.upstreamObservations) {
    const actual = currentByIdentity.get(observationKey(observation));
    if (actual === undefined || JSON.stringify(actual) !== JSON.stringify(observation)) {
      throw new Error("research/current-evaluation-context.json: baseline observations must remain identical");
    }
  }
  for (const observation of current.upstreamObservations) {
    if (!snapshotIds.has(observation.snapshotId)) {
      throw new Error(`research/current-evaluation-context.json: observation references unknown snapshot ID: ${observation.snapshotId}`);
    }
  }
}

function observationKey(observation: { providerId: string; snapshotId: string; observedAt: string; headCommit: string }): string {
  return `${observation.providerId}\u0000${observation.snapshotId}\u0000${observation.observedAt}\u0000${observation.headCommit}`;
}

function assertExtensionReachability(
  extensions: ReviewSourceExtensionIndex,
  queue: ResearchQueue,
  reviews: readonly SourceReviewManifest[],
  evidence: readonly ResearchEvidence[]
): void {
  const reachable = new Set<string>([
    ...queue.candidates.map(({ snapshotId }) => snapshotId),
    ...reviews.flatMap(({ snapshotIds }) => snapshotIds),
    ...evidence.flatMap((item) => item.kind === "search-evidence"
      ? item.snapshotIds
      : item.schemaVersion === 3 && item.kind === "marketplace-identity" ? [] : [item.snapshotId])
  ]);
  for (const triad of extensions.triads) {
    if (!reachable.has(triad.snapshotId)) {
      throw new Error(`research/review-source-extensions.json: extension triad is unreachable: ${triad.snapshotId}`);
    }
  }
}

async function validateObservedMarketplaceEvidenceBindings(
  root: RepositoryRoot,
  input: {
    evidence: readonly ResearchEvidence[];
    observationEvidence: readonly ObservationEvidence[];
    sourceConfigs: readonly ResearchSourceConfig[];
  }
): Promise<void> {
  const records = input.evidence.filter((item): item is Extract<ResearchEvidence, { schemaVersion: 3 }> =>
    item.schemaVersion === 3 && item.kind === "marketplace-identity");
  if (records.length === 0) return;
  const selection = loadOfficialMarketplaceSelection(root.path);
  const sourceRepositoryById = Object.fromEntries(input.sourceConfigs.map((item) => [item.sourceId, item.repository]));
  for (const evidence of records) {
    const relativePath = evidence.observedArtifactPath.slice("research/marketplaces/".length);
    let artifact;
    try {
      artifact = validateOfficialMarketplaceArtifact(JSON.parse(await readRegularFile(root, evidence.observedArtifactPath)));
    } catch (error) {
      throw new Error(`${evidence.id}: unable to load observed marketplace selection artifact`, { cause: error });
    }
    validateObservedMarketplaceEvidenceBinding(evidence, {
      observationEvidence: input.observationEvidence,
      sourceRepositoryById,
      artifactSha256ByPath: selection.artifactSha256ByPath,
      marketplaceArtifactsByPath: {
        [relativePath]: {
          repository: artifact.provenance.repository,
          inspectedCommit: artifact.provenance.inspectedCommit
        }
      }
    });
  }
}

async function verifyEvidenceArtifacts(root: RepositoryRoot, evidence: readonly ResearchEvidence[]): Promise<void> {
  for (const item of evidence) {
    try {
      await verifyEvidenceArtifact(root, item);
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith(`${item.artifactPath}: `)) {
        throw error;
      }
      throw new Error(`${item.artifactPath}: unable to verify evidence artifact`, { cause: error });
    }
  }

  await rejectUnreferencedArtifacts(root, new Set(evidence.map(({ artifactPath }) => artifactPath)));
}

async function verifyEvidenceArtifact(root: RepositoryRoot, evidence: ResearchEvidence): Promise<void> {
  const artifactsRoot = await resolvedContainedPath(root, evidenceArtifactsDirectory);
  const containedArtifactPath = await resolvedContainedPath(root, evidence.artifactPath);
  const relativePath = relative(artifactsRoot, containedArtifactPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${evidence.artifactPath}: evidence artifact escapes research/evidence/artifacts`);
  }
  const stat = await lstatPath(root, evidence.artifactPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${evidence.artifactPath}: evidence artifact must be a regular non-symlink file`);
  }
  const actual = createHash("sha256").update(await readContainedRegularFile(root, evidence.artifactPath)).digest("hex");
  if (actual !== evidence.artifactSha256) {
    throw new Error(`${evidence.artifactPath}: evidence artifact SHA-256 mismatch`);
  }
}

async function rejectUnreferencedArtifacts(
  root: RepositoryRoot,
  referencedArtifacts: ReadonlySet<string>
): Promise<void> {
  const files = await artifactFiles(root, evidenceArtifactsDirectory);
  const hasReferencedArtifacts = referencedArtifacts.size > 0;
  let gitkeepPath: string | undefined;

  for (const path of files) {
    if (path === `${evidenceArtifactsDirectory}/.gitkeep`) {
      gitkeepPath = path;
      continue;
    }
    if (!referencedArtifacts.has(path)) {
      throw new Error(`${path}: unreferenced evidence artifact`);
    }
  }

  if (!hasReferencedArtifacts && gitkeepPath === undefined) {
    throw new Error(
      `${evidenceArtifactsDirectory}: empty tracked root requires exactly one zero-byte regular non-symlink .gitkeep`
    );
  }
}

async function artifactFiles(root: RepositoryRoot, relativeDirectory: string): Promise<string[]> {
  const entries = await directoryEntries(root, relativeDirectory);
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = joinRepositoryPath(relativeDirectory, entry);
    const stat = await lstatPath(root, relativePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`${relativePath}: evidence artifact must be a regular non-symlink file`);
    }
    if (stat.isDirectory()) {
      files.push(...await artifactFiles(root, relativePath));
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`${relativePath}: evidence artifact must be a regular non-symlink file`);
    }
    if (entry === ".gitkeep") {
      assertGitkeep(relativePath, stat);
    }
    files.push(relativePath);
  }
  return files;
}

async function directoryEntries(root: RepositoryRoot, relativeDirectory: string): Promise<string[]> {
  const path = join(root.path, relativeDirectory);
  const stat = await lstatPath(root, relativeDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${relativeDirectory}: must be a regular non-symlink directory`);
  }
  try {
    return (await readdir(path)).sort(compareCodePointStrings);
  } catch {
    throw new Error(`${relativeDirectory}: unable to read directory`);
  }
}

async function readRegularFile(root: RepositoryRoot, relativePath: string): Promise<string> {
  return (await readContainedRegularFile(root, relativePath)).toString("utf8");
}

async function readOptionalRegularFile(root: RepositoryRoot, relativePath: string): Promise<string | undefined> {
  try {
    return await readRegularFile(root, relativePath);
  } catch (error) {
    if (errorMessage(error) === `${relativePath}: missing required path`) return undefined;
    throw error;
  }
}

async function lstatPath(root: RepositoryRoot, relativePath: string) {
  await resolvedContainedPath(root, relativePath);
  try {
    return await lstat(join(root.path, relativePath));
  } catch {
    throw new Error(`${relativePath}: missing required path`);
  }
}

async function canonicalizeRepositoryRoot(root: string): Promise<RepositoryRoot> {
  let path: string;
  try {
    path = await realpath(root);
  } catch {
    throw new Error("repository root: missing required directory");
  }

  try {
    const stat = await lstat(path);
    if (!stat.isDirectory()) {
      throw new Error("repository root: must be a directory");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("repository root:")) {
      throw error;
    }
    throw new Error("repository root: missing required directory", { cause: error });
  }

  return { path };
}

async function assertRequiredRoots(root: RepositoryRoot): Promise<void> {
  for (const relativeDirectory of requiredDirectories) {
    const stat = await lstatPath(root, relativeDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${relativeDirectory}: must be a regular non-symlink directory`);
    }
  }
}

async function assertRequiredDecisionResearchSurfaces(root: RepositoryRoot): Promise<void> {
  for (const path of DECISION_BROKER_V1_REQUIRED_RESEARCH_SURFACES) {
    await lstatPath(root, path);
  }
}

async function resolvedContainedPath(root: RepositoryRoot, relativePath: string): Promise<string> {
  let path: string;
  try {
    path = await realpath(join(root.path, relativePath));
  } catch {
    throw new Error(`${relativePath}: missing required path`);
  }

  const pathWithinRoot = relative(root.path, path);
  if (pathWithinRoot === ".." || pathWithinRoot.startsWith(`..${sep}`) || isAbsolute(pathWithinRoot)) {
    throw new Error(`${relativePath}: resolved path escapes repository root`);
  }
  return path;
}

function assertGitkeep(relativePath: string, stat: Awaited<ReturnType<typeof lstat>>): void {
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== 0) {
    throw new Error(`${relativePath}: must be a zero-byte regular non-symlink file`);
  }
}

function rejectDuplicateIdentities<T>(
  kind: string,
  records: readonly LoadedRecord<T>[],
  identity: (value: T) => string
): void {
  const identities = new Set<string>();
  for (const record of records) {
    const id = identity(record.value);
    if (identities.has(id)) {
      throw new Error(`Duplicate ${kind} ID: ${id}`);
    }
    identities.add(id);
  }
}

function joinRepositoryPath(directory: string, entry: string): string {
  return `${directory}/${entry}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareNullableCodePointStrings(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : -1;
  return right === null ? 1 : compareCodePointStrings(left, right);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
