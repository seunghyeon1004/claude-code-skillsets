import { describe, expect, it } from "vitest";
import { validateResearchGraph } from "../../src/research/graph.js";
import { generateSourceAuditReport, generateTrustReport, targetScoreRows } from "../../src/research/reports.js";
import type { ResearchRepository } from "../../src/research/repository.js";

function repository(): ResearchRepository {
  return {
    census: { snapshotIds: [] },
    queue: { candidates: [], capabilitySearch: [] },
    providerSelections: [],
    conflicts: [],
    providers: [],
    sourceReviews: [],
    snapshots: [],
    reviewSourceIndex: { triads: [] },
    reviewSourceExtensions: { triads: [] }
  } as unknown as ResearchRepository;
}

function validatedRepository(): ResearchRepository {
  const value = repository();
  validateResearchGraph(value, { completeV1: { catalog: { capabilityIds: [] } }, platforms: new Set(["darwin"]), expectedCensusSnapshotIds: [] } as never);
  value.sourceReviews = [{ providerId: "provider-a", capabilityTargetReviews: [{ capabilityId: "capability-a", runtime: "claude-code", platform: "darwin", decision: "eligible", score: { outcomeFitAndDepth: 30, securityAndTransparency: 20, maintenanceAndUpdateability: 15, nativeInstallability: 15, documentationAndEvaluation: 10 } }] }] as never;
  return value;
}

describe("target-aware reports", () => {
  it("rejects unvalidated review input", () => expect(() => targetScoreRows(repository())).toThrow("graph-validated"));
  it("aggregates graph-validated explicit target scores without promoting another capability", () => expect(targetScoreRows(validatedRepository())).toEqual([expect.objectContaining({ capabilityId: "capability-a", score: 90 })]));
  it("reports immutable and extension source ownership separately", () => {
    const value = validatedRepository();
    expect(generateTrustReport(value)).toContain("claude-code/darwin");
    expect(generateSourceAuditReport(value)).toContain("Extension review triads: 0");
  });
});
