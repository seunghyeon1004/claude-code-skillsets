import { COMPLETE_V1_DOMAIN_IDS, type ResearchCollectionReceipt, type ResearchSnapshot, type ResearchSourceConfig, type SourceReviewBacklog } from "../model/complete-v1.js";
import { compareCodePointStrings } from "./snapshot.js";

/** This official marketplace baseline is handled by the delegated marketplace flow. */
export const DELEGATED_OFFICIAL_SOURCE_IDS = ["anthropic-plugins-official"] as const;

const delegatedSourceIds = new Set<string>(DELEGATED_OFFICIAL_SOURCE_IDS);

export interface SourceReviewBacklogValidationInput {
  backlog: SourceReviewBacklog;
  sourceConfigs: readonly ResearchSourceConfig[];
  collectionReceipts: readonly ResearchCollectionReceipt[];
  snapshots: readonly ResearchSnapshot[];
}

/**
 * Enforces a complete, source-level review backlog without changing the P04
 * capability-target search queue. The backlog contains no installation data.
 */
export function assertSourceReviewBacklog(input: SourceReviewBacklogValidationInput): SourceReviewBacklog {
  const expectedSources = input.sourceConfigs
    .filter(({ sourceId }) => !delegatedSourceIds.has(sourceId))
    .sort((left, right) => compareCodePointStrings(left.sourceId, right.sourceId));
  const candidates = [...input.backlog.candidates];
  const candidateIds = candidates.map(({ id }) => id);
  if (!isSortedUnique(candidateIds)) {
    throw new Error("research/source-review-backlog.json: candidate IDs must be code-point sorted and unique");
  }
  if (candidates.length !== expectedSources.length) {
    throw new Error(`research/source-review-backlog.json: must materialize ${expectedSources.length} non-delegated source review candidates`);
  }

  const bySourceId = new Map(candidates.map((candidate) => [candidate.sourceId, candidate]));
  if (bySourceId.size !== candidates.length) {
    throw new Error("research/source-review-backlog.json: source IDs must be unique");
  }
  const snapshots = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const receiptsBySourceId = receiptsBySource(input.collectionReceipts, snapshots);
  for (const source of expectedSources) {
    const candidate = bySourceId.get(source.sourceId);
    if (candidate === undefined) {
      throw new Error(`research/source-review-backlog.json: missing source review candidate for ${source.sourceId}`);
    }
    const snapshot = latestSnapshotFor(source.sourceId, receiptsBySourceId, snapshots);
    if (candidate.id !== `source-review-${source.sourceId}`) {
      throw new Error(`research/source-review-backlog.json: ${source.sourceId} has a non-canonical candidate ID`);
    }
    if (candidate.sourceRepository !== source.repository) {
      throw new Error(`research/source-review-backlog.json: ${source.sourceId} source repository does not match its source config`);
    }
    if (candidate.status !== "review-required" || candidate.reclassification !== "next-research-observation") {
      throw new Error(`research/source-review-backlog.json: ${source.sourceId} must remain review-required until the next research observation`);
    }
    if (candidate.snapshotId !== snapshot.id || candidate.observedAt !== snapshot.observedAt
      || candidate.inspectedCommit !== snapshot.inspectedCommit || candidate.snapshotContentSha256 !== snapshot.contentSha256) {
      throw new Error(`research/source-review-backlog.json: ${source.sourceId} does not match its latest immutable snapshot provenance`);
    }
    assertCandidatePaths(source.sourceId, candidate, snapshot);
  }
  for (const candidate of candidates) {
    if (!expectedSources.some(({ sourceId }) => sourceId === candidate.sourceId)) {
      throw new Error(`research/source-review-backlog.json: unexpected or delegated source ${candidate.sourceId}`);
    }
  }
  return structuredClone(input.backlog);
}

export function latestSnapshotFor(
  sourceId: string,
  receiptsBySourceId: ReadonlyMap<string, readonly ResearchCollectionReceipt[]>,
  snapshots: ReadonlyMap<string, ResearchSnapshot>
): ResearchSnapshot {
  const receipts = receiptsBySourceId.get(sourceId) ?? [];
  const observations = receipts.map((receipt) => {
    const snapshot = snapshots.get(receipt.snapshotId);
    if (snapshot === undefined) throw new Error(`source review backlog: ${sourceId} receipt references an unavailable snapshot ${receipt.snapshotId}`);
    return snapshot;
  }).sort((left, right) => compareCodePointStrings(right.observedAt, left.observedAt)
    || compareCodePointStrings(right.id, left.id));
  const latest = observations[0];
  if (latest === undefined) throw new Error(`source review backlog: ${sourceId} has no collection receipt or snapshot`);
  return latest;
}

export function receiptsBySource(
  receipts: readonly ResearchCollectionReceipt[],
  snapshots: ReadonlyMap<string, ResearchSnapshot>
): ReadonlyMap<string, readonly ResearchCollectionReceipt[]> {
  const bySourceId = new Map<string, ResearchCollectionReceipt[]>();
  for (const receipt of receipts) {
    if (!snapshots.has(receipt.snapshotId)) continue;
    const values = bySourceId.get(receipt.sourceId) ?? [];
    values.push(receipt);
    bySourceId.set(receipt.sourceId, values);
  }
  return new Map([...bySourceId.entries()].map(([sourceId, values]) => [sourceId, values.sort((left, right) =>
    compareCodePointStrings(left.snapshotId, right.snapshotId)
  )]));
}

function assertCandidatePaths(
  sourceId: string,
  candidate: SourceReviewBacklog["candidates"][number],
  snapshot: ResearchSnapshot
): void {
  if (!isSortedUnique(candidate.representativeSkillPaths)) {
    throw new Error(`research/source-review-backlog.json: ${sourceId} representative skill paths must be code-point sorted and unique`);
  }
  const snapshotPaths = new Set(snapshot.entries
    .filter(({ kind }) => kind === "skill-file")
    .map(({ address }) => address));
  for (const path of candidate.representativeSkillPaths) {
    if (!snapshotPaths.has(path)) {
      throw new Error(`research/source-review-backlog.json: ${sourceId} representative path is absent from its snapshot: ${path}`);
    }
  }
  const classifications = candidate.domainClassifications;
  const classificationKeys = classifications.map(({ domainId, representativeSkillPath }) => `${domainId}\u0000${representativeSkillPath}`);
  if (!isSortedUnique(classificationKeys)) {
    throw new Error(`research/source-review-backlog.json: ${sourceId} domain classifications must be code-point sorted and unique`);
  }
  for (const classification of classifications) {
    if (!COMPLETE_V1_DOMAIN_IDS.includes(classification.domainId)) {
      throw new Error(`research/source-review-backlog.json: ${sourceId} has an unknown domain classification ${classification.domainId}`);
    }
    if (!candidate.representativeSkillPaths.includes(classification.representativeSkillPath)) {
      throw new Error(`research/source-review-backlog.json: ${sourceId} domain classification path must be representative`);
    }
  }
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || compareCodePointStrings(values[index - 1]!, value) < 0);
}
