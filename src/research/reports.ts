import type { ResearchRepository } from "./repository.js";
import { assertResearchGraphValidated } from "./graph.js";
import { compareCodePointStrings } from "./snapshot.js";

export interface TargetScoreRow {
  providerId: string;
  capabilityId: string;
  runtime: string;
  platform: string;
  decision: string;
  score: number;
}

export function targetScoreRows(repository: ResearchRepository): TargetScoreRow[] {
  assertResearchGraphValidated(repository);
  return repository.sourceReviews.flatMap((review) => review.capabilityTargetReviews.map((target) => ({
    providerId: review.providerId,
    capabilityId: target.capabilityId,
    runtime: target.runtime,
    platform: target.platform,
    decision: target.decision,
    score: Object.values(target.score).reduce((total, value) => total + value, 0)
  }))).sort((left, right) => compareCodePointStrings(`${left.capabilityId}\u0000${left.providerId}\u0000${left.runtime}\u0000${left.platform}`, `${right.capabilityId}\u0000${right.providerId}\u0000${right.runtime}\u0000${right.platform}`));
}

export function generateTrustReport(repository: ResearchRepository): string {
  const rows = targetScoreRows(repository);
  return ["# Target Trust Report", "", "| Provider | Capability | Target | Decision | Score |", "| --- | --- | --- | --- | --- |", ...rows.map((row) => `| ${row.providerId} | ${row.capabilityId} | ${row.runtime}/${row.platform} | ${row.decision} | ${row.score} |`), ""].join("\n");
}

export function generateSourceAuditReport(repository: ResearchRepository): string {
  const frozen = repository.reviewSourceIndex.triads.length;
  const extensions = repository.reviewSourceExtensions.triads.length;
  return ["# Research Source Audit", "", `- Frozen review triads: ${frozen}`, `- Extension review triads: ${extensions}`, `- Provider reviews: ${repository.sourceReviews.length}`, ""].join("\n");
}
