import type { ObservedMarketplaceIdentityEvidence } from "../model/complete-v1.js";

export interface ObservedMarketplaceEvidenceBindingContext {
  observationEvidence: readonly {
    id: string;
    sourceId: string;
    observedAt: string;
    inspectedCommit: string;
  }[];
  sourceRepositoryById: Readonly<Record<string, string>>;
  artifactSha256ByPath: Readonly<Record<string, string>>;
  marketplaceArtifactsByPath: Readonly<Record<string, {
    repository: string;
    inspectedCommit: string;
  }>>;
}

/** Binds snapshot-free v3 research evidence to one authenticated selection-chain artifact. */
export function validateObservedMarketplaceEvidenceBinding(
  evidence: ObservedMarketplaceIdentityEvidence,
  context: ObservedMarketplaceEvidenceBindingContext
): void {
  const observation = context.observationEvidence.find(({ id }) => id === evidence.observationEvidenceId);
  if (observation === undefined) {
    throw new Error(`${evidence.id}: observation evidence ID does not resolve`);
  }
  if (observation.sourceId !== evidence.providerId
    || observation.observedAt !== evidence.observedAt
    || observation.inspectedCommit !== evidence.reviewedCommit) {
    throw new Error(`${evidence.id}: observation source, timestamp, or commit binding mismatch`);
  }

  const prefix = "research/marketplaces/";
  if (!evidence.observedArtifactPath.startsWith(prefix)) {
    throw new Error(`${evidence.id}: observed artifact path is not a marketplace selection artifact`);
  }
  const artifactPath = evidence.observedArtifactPath.slice(prefix.length);
  const artifact = context.marketplaceArtifactsByPath[artifactPath];
  if (artifact === undefined || context.artifactSha256ByPath[artifactPath] !== evidence.observedArtifactSha256) {
    throw new Error(`${evidence.id}: observed artifact path or SHA does not match the selection chain`);
  }
  const sourceRepository = context.sourceRepositoryById[evidence.providerId];
  if (sourceRepository === undefined || artifact.repository !== sourceRepository
    || artifact.repository !== "https://github.com/anthropics/claude-plugins-official"
    || artifact.inspectedCommit !== evidence.reviewedCommit) {
    throw new Error(`${evidence.id}: marketplace repository or commit does not match the selected artifact`);
  }
}
