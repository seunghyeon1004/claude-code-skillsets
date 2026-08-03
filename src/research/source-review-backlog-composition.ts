import { createDiscoveryTaxonomy } from "../discovery/broker.js";
import { loadCompleteV1Repository } from "../manifest/complete-v1-repository.js";
import type { SourceReviewBacklog } from "../model/complete-v1.js";
import { assertSourceReviewBacklogMaterialization } from "./review-queue-materialization.js";
import { loadResearchRepository } from "./repository.js";

/** Loads the tracked projection only after reproducing it from local evidence. */
export async function loadVerifiedSourceReviewBacklog(root: string): Promise<SourceReviewBacklog> {
  const [research, complete] = await Promise.all([
    loadResearchRepository(root),
    loadCompleteV1Repository(root)
  ]);
  return assertSourceReviewBacklogMaterialization({
    backlog: research.sourceReviewBacklog,
    sourceConfigs: research.sourceConfigs,
    collectionReceipts: research.collectionReceipts,
    snapshots: research.snapshots,
    taxonomy: createDiscoveryTaxonomy(complete)
  });
}
