import { buildDiscoveryIndex, type DiscoveryTaxonomy } from "../discovery/broker.js";
import type {
  ResearchCollectionReceipt,
  ResearchSnapshot,
  ResearchSourceConfig,
  SourceReviewBacklog,
  SourceReviewBacklogCandidate
} from "../model/complete-v1.js";
import { compareCodePointStrings } from "./snapshot.js";
import { DELEGATED_OFFICIAL_SOURCE_IDS, latestSnapshotFor, receiptsBySource } from "./source-review-backlog.js";

const delegatedSourceIds = new Set<string>(DELEGATED_OFFICIAL_SOURCE_IDS);

export interface SourceReviewBacklogMaterializationInput {
  sourceConfigs: readonly ResearchSourceConfig[];
  collectionReceipts: readonly ResearchCollectionReceipt[];
  snapshots: readonly ResearchSnapshot[];
  taxonomy: DiscoveryTaxonomy;
}

/**
 * Builds a bounded, non-installable review backlog from the fixed discovery
 * snapshots. Future research observations replace the chosen latest snapshot.
 */
export function materializeSourceReviewCandidates(
  input: SourceReviewBacklogMaterializationInput
): SourceReviewBacklogCandidate[] {
  const snapshots = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const receipts = receiptsBySource(input.collectionReceipts, snapshots);
  const index = buildDiscoveryIndex(input.snapshots, input.taxonomy);
  return input.sourceConfigs
    .filter(({ sourceId }) => !delegatedSourceIds.has(sourceId))
    .map((source): SourceReviewBacklogCandidate => {
      const snapshot = latestSnapshotFor(source.sourceId, receipts, snapshots);
      const contracts = index.contracts.filter(({ visibility, observed }) =>
        visibility === "default" && observed.snapshotId === snapshot.id
      );
      const domainClassifications = representativeClassifications(contracts);
      const classificationPaths = uniqueSorted(domainClassifications.map(({ representativeSkillPath }) => representativeSkillPath));
      const representativeSkillPaths = uniqueSorted([
        ...classificationPaths,
        ...contracts.map(({ observed }) => observed.selectedSkillPath)
          .filter((path) => !classificationPaths.includes(path))
          .slice(0, Math.max(0, 3 - classificationPaths.length))
      ]);
      if (representativeSkillPaths.length === 0) {
        throw new Error(`source review backlog: ${source.sourceId} has no default-visible skill paths in ${snapshot.id}`);
      }
      return {
        id: `source-review-${source.sourceId}`,
        sourceId: source.sourceId,
        sourceRepository: source.repository,
        status: "review-required",
        snapshotId: snapshot.id,
        observedAt: snapshot.observedAt,
        inspectedCommit: snapshot.inspectedCommit,
        snapshotContentSha256: snapshot.contentSha256,
        representativeSkillPaths,
        domainClassifications,
        reclassification: "next-research-observation"
      };
    })
    .sort((left, right) => compareCodePointStrings(left.id, right.id));
}

/**
 * The tracked backlog is a generated projection. Callers that expose it must
 * reject any valid-shaped but stale or manually altered projection.
 */
export function assertSourceReviewBacklogMaterialization(
  input: SourceReviewBacklogMaterializationInput & { backlog: SourceReviewBacklog }
): SourceReviewBacklog {
  const expected = materializeSourceReviewCandidates(input);
  if (JSON.stringify(input.backlog.candidates) !== JSON.stringify(expected)) {
    throw new Error("research/source-review-backlog.json is not the deterministic materialization of the current research catalog");
  }
  return structuredClone(input.backlog);
}

function representativeClassifications(
  contracts: ReturnType<typeof buildDiscoveryIndex>["contracts"]
): SourceReviewBacklogCandidate["domainClassifications"] {
  const byDomain = new Map<string, string[]>();
  for (const contract of contracts) {
    for (const domainId of contract.classification.domainIds) {
      const paths = byDomain.get(domainId) ?? [];
      paths.push(contract.observed.selectedSkillPath);
      byDomain.set(domainId, paths);
    }
  }
  return [...byDomain.entries()]
    .map(([domainId, paths]) => ({
      domainId: domainId as SourceReviewBacklogCandidate["domainClassifications"][number]["domainId"],
      representativeSkillPath: uniqueSorted(paths)[0]!
    }))
    .sort((left, right) => compareCodePointStrings(left.domainId, right.domainId)
      || compareCodePointStrings(left.representativeSkillPath, right.representativeSkillPath))
    .slice(0, 3);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePointStrings);
}
