import type {
  ResearchCensus,
  ResearchCollectionReceipt,
  ResearchSnapshot,
  ResearchSourceConfig,
  ReviewSourceExtensionIndex,
  ReviewSourceIndex,
  ReviewSourceTriad
} from "../model/complete-v1.js";

interface ResearchTriadOwnershipInput {
  census: ResearchCensus;
  reviewSourceIndex: ReviewSourceIndex;
  reviewSourceExtensions: ReviewSourceExtensionIndex;
  sourceConfigs: readonly LoadedResearchRecord<ResearchSourceConfig>[];
  collectionReceipts: readonly LoadedResearchRecord<ResearchCollectionReceipt>[];
  snapshots: readonly LoadedResearchRecord<ResearchSnapshot>[];
}

interface LoadedResearchRecord<T> {
  path: string;
  value: T;
}

interface OwnedTriad {
  triad: ReviewSourceTriad;
  owner: string;
}

/** Enforces the full repository's exact source/receipt/snapshot ownership graph. */
export function assertResearchTriadOwnership(input: ResearchTriadOwnershipInput): void {
  assertCanonicalRecordPaths("research/sources", input.sourceConfigs, ({ sourceId }) => sourceId);
  assertCanonicalRecordPaths("research/receipts", input.collectionReceipts, ({ id }) => id);
  assertCanonicalRecordPaths("research/snapshots", input.snapshots, ({ id }) => id);
  const sourceConfigs = input.sourceConfigs.map(({ value }) => value);
  const collectionReceipts = input.collectionReceipts.map(({ value }) => value);
  const snapshots = input.snapshots.map(({ value }) => value);
  assertUniqueIdentities("research source config", sourceConfigs, ({ sourceId }) => sourceId);
  assertUniqueIdentities("research collection receipt", collectionReceipts, ({ id }) => id);
  assertUniqueIdentities("research snapshot", snapshots, ({ id }) => id);
  const declared = declaredTriads(input);
  assertDeclaredTriadOwnership(declared, { sourceConfigs, collectionReceipts, snapshots });
  assertExactOwnership(
    "research/sources",
    sourceConfigs.map(({ sourceId }) => sourceId),
    declared.map(({ triad }) => triad.sourceId)
  );
  assertExactOwnership(
    "research/receipts",
    collectionReceipts.map(({ id }) => id),
    declared.map(({ triad }) => triad.receiptId)
  );
  assertExactOwnership(
    "research/snapshots",
    snapshots.map(({ id }) => id),
    declared.map(({ triad }) => triad.snapshotId)
  );
}

function declaredTriads(input: ResearchTriadOwnershipInput): OwnedTriad[] {
  const receiptsBySnapshotId = new Map<string, ResearchCollectionReceipt[]>();
  for (const { value: receipt } of input.collectionReceipts) {
    const values = receiptsBySnapshotId.get(receipt.snapshotId) ?? [];
    values.push(receipt);
    receiptsBySnapshotId.set(receipt.snapshotId, values);
  }
  const frozenTriads = input.census.snapshotIds.map((snapshotId) => {
    const receipts = receiptsBySnapshotId.get(snapshotId) ?? [];
    const receipt = receipts[0];
    if (receipt === undefined) {
      throw new Error(`research/census.json: snapshot ${snapshotId} has no collection receipt`);
    }
    return { sourceId: receipt.sourceId, receiptId: receipt.id, snapshotId };
  });
  const declared = [
    ...frozenTriads.map((triad) => ({ triad, owner: "research/census.json" })),
    ...input.reviewSourceIndex.triads.map((triad) => ({ triad, owner: "research/review-source-index.json" })),
    ...input.reviewSourceExtensions.triads.map((triad) => ({ triad, owner: "research/review-source-extensions.json" }))
  ];
  const ids = new Set<string>();
  for (const { triad, owner } of declared) {
    for (const [field, id] of [
      ["receiptId", triad.receiptId],
      ["snapshotId", triad.snapshotId]
    ] as const) {
      const key = `${field}\u0000${id}`;
      if (ids.has(key)) throw new Error(`${owner}: ${field} is already owned by a frozen or extension triad: ${id}`);
      ids.add(key);
    }
  }
  return declared;
}

function assertDeclaredTriadOwnership(
  declared: readonly OwnedTriad[],
  input: {
    sourceConfigs: readonly ResearchSourceConfig[];
    collectionReceipts: readonly ResearchCollectionReceipt[];
    snapshots: readonly ResearchSnapshot[];
  }
): void {
  const sources = new Map(input.sourceConfigs.map((source) => [source.sourceId, source]));
  const receipts = new Map(input.collectionReceipts.map((receipt) => [receipt.id, receipt]));
  const snapshots = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  for (const { triad, owner } of declared) {
    const source = sources.get(triad.sourceId);
    const receipt = receipts.get(triad.receiptId);
    const snapshot = snapshots.get(triad.snapshotId);
    if (source === undefined) throw new Error(`${owner}: declared source ID is missing from research/sources: ${triad.sourceId}`);
    if (receipt === undefined) throw new Error(`${owner}: declared receipt ID is missing from research/receipts: ${triad.receiptId}`);
    if (snapshot === undefined) throw new Error(`${owner}: declared snapshot ID is missing from research/snapshots: ${triad.snapshotId}`);
    if (receipt.sourceId !== source.sourceId || receipt.snapshotId !== snapshot.id) {
      throw new Error(`${owner}: source/receipt/snapshot triad does not match the immutable receipt`);
    }
    if (receipt.observedAt !== snapshot.observedAt
      || receipt.inspectedCommit !== snapshot.inspectedCommit
      || receipt.snapshotContentSha256 !== snapshot.contentSha256
      || snapshot.sourceUrl !== source.repository) {
      throw new Error(`${owner}: collection receipt does not bind exact snapshot provenance and source repository`);
    }
  }
}

function assertCanonicalRecordPaths<T>(
  directory: string,
  records: readonly LoadedResearchRecord<T>[],
  identity: (value: T) => string
): void {
  for (const record of records) {
    const expected = `${directory}/${identity(record.value)}.json`;
    if (record.path !== expected) {
      throw new Error(`${record.path}: filename must match record ID at canonical path ${expected}`);
    }
  }
}

function assertUniqueIdentities<T>(kind: string, values: readonly T[], identity: (value: T) => string): void {
  const ids = new Set<string>();
  for (const value of values) {
    const id = identity(value);
    if (ids.has(id)) throw new Error(`${kind} IDs must be unique: ${id}`);
    ids.add(id);
  }
}

function assertExactOwnership(directory: string, loaded: readonly string[], owned: readonly string[]): void {
  const loadedIds = new Set(loaded);
  const ownedIds = new Set(owned);
  for (const id of loadedIds) {
    if (!ownedIds.has(id)) throw new Error(`${directory}: record is not owned by a frozen or extension triad: ${id}`);
  }
  for (const id of ownedIds) {
    if (!loadedIds.has(id)) throw new Error(`${directory}: owned record is missing: ${id}`);
  }
}
