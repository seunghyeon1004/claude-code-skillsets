import { validateSourceObservation } from "../contracts/observation.js";
import type {
  ResearchCollectionReceipt,
  ResearchSnapshot,
  ResearchSourceConfig,
  SourceReviewBacklog
} from "../model/complete-v1.js";
import {
  OBSERVATION_FIELD_NAMES,
  type ObservationEvidence,
  type ObservationFields,
  type SourceObservation
} from "../model/observation.js";
import { compareCodePointStrings } from "./snapshot.js";

export interface ReviewStateObservation {
  source: SourceObservation;
  snapshotId: string;
  snapshotContentSha256: string;
  evidence: ObservationEvidence | undefined;
  previousEvidence: ObservationEvidence | undefined;
  previousSnapshotId?: string;
  previousSnapshotContentSha256?: string;
}

export interface MaterializeSourceObservationsInput {
  sourceConfigs: readonly ResearchSourceConfig[];
  collectionReceipts: readonly ResearchCollectionReceipt[];
  snapshots: readonly ResearchSnapshot[];
  observationEvidence: readonly ObservationEvidence[];
  sourceReviewBacklog: SourceReviewBacklog;
}

export interface LatestEffectiveSourceObservation {
  repository: string;
  inspectedCommit: string;
  observedAt: string;
  kind: "immutable-receipt" | "materialized-observation";
}

/** Selects the newest authenticated observation across immutable v2 and append-only v3 evidence. */
export function resolveLatestEffectiveSourceObservation(input: {
  source: ResearchSourceConfig;
  receipt: ResearchCollectionReceipt;
  snapshot: ResearchSnapshot;
  materialized: SourceObservation;
}): LatestEffectiveSourceObservation {
  if (input.receipt.sourceId !== input.source.sourceId
    || input.receipt.snapshotId !== input.snapshot.id
    || input.receipt.observedAt !== input.snapshot.observedAt
    || input.receipt.inspectedCommit !== input.snapshot.inspectedCommit
    || input.receipt.snapshotContentSha256 !== input.snapshot.contentSha256
    || input.snapshot.sourceUrl !== input.source.repository
    || input.materialized.sourceId !== input.source.sourceId) {
    throw new Error(`${input.source.sourceId}: source observations do not bind one authenticated source`);
  }
  const receiptTime = Date.parse(input.receipt.observedAt);
  const materializedTime = Date.parse(input.materialized.observedAt);
  if (!Number.isFinite(receiptTime) || !Number.isFinite(materializedTime)) {
    throw new Error(`${input.source.sourceId}: source observation timestamps are invalid`);
  }
  if (receiptTime === materializedTime
    && input.snapshot.inspectedCommit !== input.materialized.inspectedCommit) {
    throw new Error(`${input.source.sourceId}: latest effective source observation is ambiguous`);
  }
  return receiptTime > materializedTime
    ? {
        repository: input.source.repository,
        inspectedCommit: input.snapshot.inspectedCommit,
        observedAt: input.receipt.observedAt,
        kind: "immutable-receipt"
      }
    : {
        repository: input.source.repository,
        inspectedCommit: input.materialized.inspectedCommit,
        observedAt: input.materialized.observedAt,
        kind: "materialized-observation"
      };
}

/** Projects each source's latest bounded observation without mutating legacy snapshots. */
export function materializeSourceObservationContexts(
  input: MaterializeSourceObservationsInput
): ReviewStateObservation[] {
  const snapshotsById = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const receiptsBySource = groupBy(input.collectionReceipts, (receipt) => receipt.sourceId);
  const evidenceBySource = groupBy(input.observationEvidence, (evidence) => evidence.sourceId);
  const backlogBySource = new Map(input.sourceReviewBacklog.candidates.map((candidate) => [candidate.sourceId, candidate]));

  return [...input.sourceConfigs].sort((left, right) => compareCodePointStrings(left.sourceId, right.sourceId)).map((config) => {
    const receipts = [...(receiptsBySource.get(config.sourceId) ?? [])].sort(compareReceipt);
    const receipt = receipts.at(-1);
    if (receipt === undefined) throw new Error(`source ${config.sourceId} has no collection receipt`);
    const latestSnapshot = snapshotsById.get(receipt.snapshotId);
    if (latestSnapshot === undefined) throw new Error(`source ${config.sourceId} receipt references a missing snapshot`);

    const evidence = [...(evidenceBySource.get(config.sourceId) ?? [])].sort(compareEvidence);
    const currentEvidence = evidence.at(-1);
    const previousEvidence = evidence.at(-2);
    const currentSnapshot = snapshotForEvidence(currentEvidence, receipts, snapshotsById) ?? latestSnapshot;
    const previousSnapshot = snapshotForEvidence(previousEvidence, receipts, snapshotsById);
    const backlog = backlogBySource.get(config.sourceId);
    const representativePaths = backlog === undefined
      ? latestSnapshot.entries.filter(({ kind }) => kind === "skill-file").map(({ address }) => address).slice(0, 3)
      : [...backlog.representativeSkillPaths];
    const provisionalDomainIds = backlog === undefined
      ? []
      : uniqueSorted(backlog.domainClassifications.map(({ domainId }) => domainId));
    const source = validateSourceObservation({
      schemaVersion: 3,
      sourceId: config.sourceId,
      latestEvidenceId: currentEvidence?.id ?? `legacy-${latestSnapshot.id}`,
      previousEvidenceId: previousEvidence?.id ?? null,
      observedAt: currentEvidence?.observedAt ?? latestSnapshot.observedAt,
      inspectedCommit: currentEvidence?.inspectedCommit ?? latestSnapshot.inspectedCommit,
      representativePaths: uniqueSorted(representativePaths),
      provisionalDomainIds,
      fields: currentEvidence?.fields ?? unknownFields()
    });

    return {
      source,
      snapshotId: currentSnapshot.id,
      snapshotContentSha256: currentSnapshot.contentSha256,
      evidence: currentEvidence,
      previousEvidence,
      previousSnapshotId: previousSnapshot?.id,
      previousSnapshotContentSha256: previousSnapshot?.contentSha256
    };
  });
}

export function materializeSourceObservations(
  input: MaterializeSourceObservationsInput
): SourceObservation[] {
  return materializeSourceObservationContexts(input).map(({ source }) => source);
}

export function unknownFields(): ObservationFields {
  return Object.fromEntries(OBSERVATION_FIELD_NAMES.map((field) => [
    field,
    { status: "unknown", evidence: [] }
  ])) as unknown as ObservationFields;
}

function snapshotForEvidence(
  evidence: ObservationEvidence | undefined,
  receipts: readonly ResearchCollectionReceipt[],
  snapshotsById: ReadonlyMap<string, ResearchSnapshot>
): ResearchSnapshot | undefined {
  if (evidence === undefined) return undefined;
  const receipt = receipts.find((candidate) => candidate.inspectedCommit === evidence.inspectedCommit);
  return receipt === undefined ? undefined : snapshotsById.get(receipt.snapshotId);
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const group = grouped.get(key(item));
    if (group === undefined) grouped.set(key(item), [item]);
    else group.push(item);
  }
  return grouped;
}

function compareReceipt(left: ResearchCollectionReceipt, right: ResearchCollectionReceipt): number {
  return compareCodePointStrings(left.observedAt, right.observedAt)
    || compareCodePointStrings(left.id, right.id);
}

function compareEvidence(left: ObservationEvidence, right: ObservationEvidence): number {
  return compareCodePointStrings(left.observedAt, right.observedAt)
    || compareCodePointStrings(left.id, right.id);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePointStrings);
}
