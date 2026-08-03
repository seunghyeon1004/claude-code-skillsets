import { describe, expect, it } from "vitest";
import type { ResearchRepository } from "../../src/research/repository.js";
import { ResearchQueueGraphError, validateResearchQueueGraph } from "../../src/research/queue.js";

function repository(): ResearchRepository {
  return { queue: { schemaVersion: 2, candidates: [{ id: "candidate-a", capabilityIds: ["capability-a"], snapshotId: "snapshot-a", discoverySnapshotId: "snapshot-a", discoveryEntryAddress: ".", searchTerms: ["term"], discoverySourceUrl: "https://github.com/example/provider", observedAt: "2026-07-23T05:39:45Z", candidateRepository: "https://github.com/example/provider", candidatePath: "skills/provider", originalRepository: "https://github.com/example/provider", discoveryTier: "A", provenance: "original", materiallyDistinctGroup: "provider", targets: [{ runtime: "claude-code", platform: "darwin" }] }], capabilitySearch: [{ id: "search-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin", candidateIds: ["candidate-a"], searchEvidenceIds: [] }] }, evidence: [], sourceReviews: [] } as unknown as ResearchRepository;
}

describe("capability target queue", () => {
  it("accepts a candidate only in its exact target cell", () => {
    expect(validateResearchQueueGraph(repository(), new Set(["capability-a"])).capabilitySearch).toHaveLength(1);
  });
  it("rejects a Claude-only candidate in a Codex cell", () => {
    const input = repository();
    input.queue.capabilitySearch[0]!.runtime = "codex";
    expect(() => validateResearchQueueGraph(input, new Set(["capability-a"]))).toThrow(ResearchQueueGraphError);
  });
  it("requires immutable passed no-candidate evidence for an empty target cell", () => {
    const input = repository();
    input.queue.candidates = [];
    input.queue.capabilitySearch[0]!.candidateIds = [];
    expect(() => validateResearchQueueGraph(input, new Set(["capability-a"]))).toThrow("empty target cell requires passed");
    input.queue.capabilitySearch[0]!.searchEvidenceIds = ["search-evidence-a"];
    input.evidence = [{ id: "search-evidence-a", kind: "search-evidence", outcome: "passed", searchRecordId: "search-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin" }] as never;
    expect(() => validateResearchQueueGraph(input, new Set(["capability-a"]))).not.toThrow();
  });
  it("rejects unordered target search cells", () => {
    const input = repository();
    input.queue.candidates = [];
    input.queue.capabilitySearch = [
      { id: "search-b", capabilityId: "capability-b", runtime: "claude-code", platform: "darwin", candidateIds: [], searchEvidenceIds: ["evidence-b"] },
      { id: "search-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin", candidateIds: [], searchEvidenceIds: ["evidence-a"] }
    ];
    input.evidence = [
      { id: "evidence-a", kind: "search-evidence", outcome: "passed", searchRecordId: "search-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin" },
      { id: "evidence-b", kind: "search-evidence", outcome: "passed", searchRecordId: "search-b", capabilityId: "capability-b", runtime: "claude-code", platform: "darwin" }
    ] as never;
    expect(() => validateResearchQueueGraph(input, new Set(["capability-a", "capability-b"]))).toThrow("code-point sorted");
  });
});
