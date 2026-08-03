import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  ResearchCollectionReceipt,
  ResearchSnapshot,
  ResearchSourceConfig
} from "../../src/model/complete-v1.js";
import { INITIAL_CENSUS_SNAPSHOT_IDS } from "../../src/model/complete-v1.js";
import { independentCounts } from "../../src/research/classify.js";
import { compareCodePointStrings, computeSnapshotContentSha256 } from "../../src/research/snapshot.js";

interface ExpectedSource {
  id: string;
  sourceUrl: string;
  inspectedCommit: string;
  countMetrics: ResearchSnapshot["countMetrics"];
  contentSha256: string;
  originalSourceUrls?: string[];
}

interface ExpectedCensusBatch {
  observedAt: string;
  snapshotIds: string[];
  sources: ExpectedSource[];
}

interface ProductionCensusEvidence {
  snapshot: ResearchSnapshot;
  receipt: ResearchCollectionReceipt;
  source: ExpectedSource;
}

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const expectedBatches = [
  readJson<ExpectedCensusBatch>("tests/fixtures/research/expected/census-batch-a.json"),
  readJson<ExpectedCensusBatch>("tests/fixtures/research/expected/census-batch-b.json"),
  readJson<ExpectedCensusBatch>("tests/fixtures/research/expected/census-batch-c.json")
];
const expected = {
  observedAt: expectedBatches[0]!.observedAt,
  sources: expectedBatches.flatMap((batch) => batch.sources)
};

describe("research census batches a, b, and c", () => {
  it("matches the fixed offline fixture without refetching upstream", () => {
    expect(expectedBatches.map((batch) => batch.observedAt)).toEqual([
      expected.observedAt,
      expected.observedAt,
      expected.observedAt
    ]);
    expect(readFileSync(filePath("research/census-observed-at.txt"), "utf8")).toBe(`${expected.observedAt}\n`);
    expect(readJson<{ asOf: string; privateRcAt: null; upstreamObservations: unknown[] }>("research/evaluation-context.json")).toEqual({
      schemaVersion: 2,
      asOf: expected.observedAt,
      privateRcAt: null,
      upstreamObservations: []
    });
    const census = readJson<{ snapshotIds: string[] }>("research/census.json");
    verifyCumulativeCensusIndex(census);
    const evidence = loadProductionCensusEvidence(expected.sources);
    verifyCumulativeCensusEvidence(census, evidence);
    verifyFixedObservationTimestamp(evidence);
  });

  it("rejects the pre-c census and production evidence against the final fixture", () => {
    const preBatchC = expectedBatches.slice(0, -1);
    const preBatchCSources = preBatchC.flatMap((batch) => batch.sources);
    const firstBatchCId = INITIAL_CENSUS_SNAPSHOT_IDS[preBatchCSources.length]!;
    const preBatchCCensus = { snapshotIds: preBatchC.flatMap((batch) => batch.snapshotIds) };
    const preBatchCEvidence = loadProductionCensusEvidence(preBatchCSources);

    expect(() => verifyCumulativeCensusEvidence(preBatchCCensus, preBatchCEvidence)).toThrow(
      `research/census.json: missing required snapshot ID ${firstBatchCId}`
    );
    expect(() => verifyCumulativeCensusEvidence({ snapshotIds: [...INITIAL_CENSUS_SNAPSHOT_IDS] }, preBatchCEvidence)).toThrow(
      `research: missing production snapshot or receipt evidence for ${firstBatchCId}`
    );
  });

  it("rejects an entry removal that the prior fixture-only checks would accept", () => {
    const source = expected.sources[0]!;
    const snapshot = readJson<ResearchSnapshot>(`research/snapshots/${source.id}.json`);
    const receipt = readJson<ResearchCollectionReceipt>(`research/receipts/${source.id}.json`);
    const corrupted = structuredClone(snapshot);
    corrupted.entries.pop();

    expect(() => verifyProductionCensusSource(corrupted, receipt, source)).toThrow();
  });
});

function loadProductionCensusEvidence(sources: readonly ExpectedSource[]): Map<string, ProductionCensusEvidence> {
  return new Map(sources.flatMap((source) => {
    const snapshotPath = `research/snapshots/${source.id}.json`;
    const receiptPath = `research/receipts/${source.id}.json`;
    if (!existsSync(filePath(snapshotPath)) || !existsSync(filePath(receiptPath))) {
      return [];
    }
    return [[source.id, {
      snapshot: readJson<ResearchSnapshot>(snapshotPath),
      receipt: readJson<ResearchCollectionReceipt>(receiptPath),
      source
    }]];
  }));
}

function verifyCumulativeCensusEvidence(
  census: { snapshotIds: string[] },
  evidence: ReadonlyMap<string, ProductionCensusEvidence>
): void {
  verifyCumulativeCensusIndex(census);
  for (const [index, source] of expected.sources.entries()) {
    const productionEvidence = evidence.get(source.id);
    if (productionEvidence === undefined) {
      throw new Error(`research: missing production snapshot or receipt evidence for ${source.id}`);
    }
    verifyProductionCensusSource(productionEvidence.snapshot, productionEvidence.receipt, source);
  }

  const requiredSnapshotIds = new Set<string>(INITIAL_CENSUS_SNAPSHOT_IDS);
  if (evidence.size !== expected.sources.length || [...evidence.keys()].some((id) => !requiredSnapshotIds.has(id))) {
    throw new Error("research: production snapshot and receipt evidence must exactly match the cumulative fixture");
  }
}

function verifyCumulativeCensusIndex(census: { snapshotIds: string[] }): void {
  const fixtureSnapshotIds = expectedBatches.flatMap((batch) => batch.snapshotIds);
  if (fixtureSnapshotIds.length !== INITIAL_CENSUS_SNAPSHOT_IDS.length
    || fixtureSnapshotIds.some((snapshotId, index) => snapshotId !== INITIAL_CENSUS_SNAPSHOT_IDS[index])) {
    throw new Error("research fixture: batch snapshot IDs must exactly match INITIAL_CENSUS_SNAPSHOT_IDS");
  }
  if (expected.sources.length !== INITIAL_CENSUS_SNAPSHOT_IDS.length
    || expected.sources.some((source, index) => source.id !== INITIAL_CENSUS_SNAPSHOT_IDS[index])) {
    throw new Error("research fixture: source evidence must exactly match INITIAL_CENSUS_SNAPSHOT_IDS");
  }
  for (const [index, snapshotId] of INITIAL_CENSUS_SNAPSHOT_IDS.entries()) {
    if (census.snapshotIds[index] !== snapshotId) {
      if (!census.snapshotIds.includes(snapshotId)) {
        throw new Error(`research/census.json: missing required snapshot ID ${snapshotId}`);
      }
      throw new Error(`research/census.json: snapshot ID ${snapshotId} must be at index ${index}`);
    }
  }
  if (census.snapshotIds.length !== INITIAL_CENSUS_SNAPSHOT_IDS.length) {
    throw new Error("research/census.json: snapshot IDs must exactly equal INITIAL_CENSUS_SNAPSHOT_IDS");
  }
  expect(census.snapshotIds).toEqual(INITIAL_CENSUS_SNAPSHOT_IDS);
}

function verifyProductionCensusSource(
  snapshot: ResearchSnapshot,
  receipt: ResearchCollectionReceipt,
  source: ExpectedSource
): void {
  const sourceId = source.id.replace("2026-07-23-", "");
  const sourceConfig = readJson<ResearchSourceConfig>(`research/sources/${sourceId}.json`);
  const recomputedMetrics = independentCounts(snapshot.entries, sourceConfig);
  const recomputedIndependentCounts = recomputedMetrics.map(({ kind, independentlyCountedTotal: count }) => ({ kind, count }));
  const recomputedContentSha256 = computeSnapshotContentSha256(snapshot.entries);

  expect(snapshot).toMatchObject({
    schemaVersion: 2,
    id: source.id,
    sourceUrl: source.sourceUrl,
    queryUrls: [source.sourceUrl],
    observedAt: expected.observedAt,
    inspectedCommit: source.inspectedCommit,
    contentSha256: source.contentSha256
  });
  expect(snapshot.countMetrics).toEqual(source.countMetrics);
  expect(recomputedMetrics).toEqual(snapshot.countMetrics);
  expect(recomputedMetrics).toEqual(source.countMetrics);
  expect(recomputedContentSha256).toBe(snapshot.contentSha256);
  expect(recomputedContentSha256).toBe(source.contentSha256);
  verifyAggregatorFollowThrough(snapshot, source);
  expect(receipt).toEqual({
    schemaVersion: 2,
    id: source.id,
    sourceId,
    snapshotId: source.id,
    observedAt: expected.observedAt,
    inspectedCommit: source.inspectedCommit,
    collectorVersion: "0.1.0",
    independentCounts: recomputedIndependentCounts,
    snapshotContentSha256: recomputedContentSha256
  });
}

function verifyAggregatorFollowThrough(snapshot: ResearchSnapshot, source: ExpectedSource): void {
  if (source.id !== "2026-07-23-composio-awesome-claude-skills") {
    return;
  }
  const sourceConfig = readJson<ResearchSourceConfig>("research/sources/composio-awesome-claude-skills.json");
  const linkedOriginals = snapshot.entries.filter(({ kind, address }) =>
    kind === "repository-record" && sourceConfig.markdownIndexPaths.some((path) => address.startsWith(`${path}#link/`))
  );
  const repositoryRecordMetric = source.countMetrics.find(({ kind }) => kind === "repository-record");
  if (source.originalSourceUrls === undefined) {
    throw new Error("research fixture: Composio must pin its original-source URLs");
  }

  expect(linkedOriginals).toHaveLength(repositoryRecordMetric!.independentlyCountedTotal - 1);
  const actualOriginalSourceUrls = linkedOriginals.map(({ sourceUrl }) => {
    if (sourceUrl === null || sourceUrl === source.sourceUrl) {
      throw new Error("research: Composio linked record must preserve an original repository URL");
    }
    return sourceUrl;
  });
  expect(canonicalSourceUrlSet(actualOriginalSourceUrls)).toEqual(source.originalSourceUrls);
}

function canonicalSourceUrlSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePointStrings);
}

function verifyFixedObservationTimestamp(evidence: ReadonlyMap<string, ProductionCensusEvidence>): void {
  const values = [
    readFileSync(filePath("research/census-observed-at.txt"), "utf8").trimEnd(),
    readJson<{ asOf: string }>("research/evaluation-context.json").asOf,
    ...[...evidence.values()].flatMap(({ snapshot, receipt }) => [snapshot.observedAt, receipt.observedAt])
  ];
  expect(values).toHaveLength(32);
  expect(values).toEqual(Array.from({ length: 32 }, () => expected.observedAt));
}

function filePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, `file://${repositoryRoot}/`));
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(filePath(relativePath), "utf8")) as T;
}
