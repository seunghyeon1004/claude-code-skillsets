import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import { createDiscoveryTaxonomy } from "../../src/discovery/broker.js";
import { runDiscoveryCli } from "../../src/discovery/cli.js";
import {
  assertSourceReviewBacklogMaterialization,
  materializeSourceReviewCandidates
} from "../../src/research/review-queue-materialization.js";
import { loadResearchRepository } from "../../src/research/repository.js";
import {
  assertSourceReviewBacklog,
  DELEGATED_OFFICIAL_SOURCE_IDS
} from "../../src/research/source-review-backlog.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
let research!: Awaited<ReturnType<typeof loadResearchRepository>>;
let candidates!: ReturnType<typeof materializeSourceReviewCandidates>;
let taxonomy!: ReturnType<typeof createDiscoveryTaxonomy>;

describe("source-level review backlog materialization", () => {
  beforeAll(async () => {
    const [loadedResearch, complete] = await Promise.all([
      loadResearchRepository(repositoryRoot),
      loadCompleteV1Repository(repositoryRoot)
    ]);
    research = loadedResearch;
    taxonomy = createDiscoveryTaxonomy(complete);
    candidates = materializeSourceReviewCandidates({
      sourceConfigs: research.sourceConfigs,
      collectionReceipts: research.collectionReceipts,
      snapshots: research.snapshots,
      taxonomy
    });
  }, 20_000);

  it("materializes every non-delegated research source as a bounded review-required candidate", () => {
    expect(candidates).toHaveLength(14);
    expect(candidates.map(({ sourceId }) => sourceId)).not.toContain("anthropic-plugins-official");
    expect(candidates.map(({ sourceId }) => sourceId)).toContain("anthropic-skills");
    expect(DELEGATED_OFFICIAL_SOURCE_IDS).toEqual(["anthropic-plugins-official"]);
    for (const candidate of candidates) {
      expect(candidate.status).toBe("review-required");
      expect(candidate.reclassification).toBe("next-research-observation");
      expect(candidate.representativeSkillPaths).toHaveLength(Math.min(3, candidate.representativeSkillPaths.length));
      expect(candidate.representativeSkillPaths.length).toBeGreaterThan(0);
      expect(candidate.domainClassifications.every(({ representativeSkillPath }) =>
        candidate.representativeSkillPaths.includes(representativeSkillPath)
      )).toBe(true);
      expect(candidate.inspectedCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(candidate.snapshotContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("keeps the tracked backlog equal to the deterministic materialization and rejects an empty backlog", () => {
    expect(research.sourceReviewBacklog.candidates).toEqual(candidates);
    expect(() => assertSourceReviewBacklog({
      backlog: { ...research.sourceReviewBacklog, candidates: [] },
      sourceConfigs: research.sourceConfigs,
      collectionReceipts: research.collectionReceipts,
      snapshots: research.snapshots
    })).toThrow("must materialize 14 non-delegated source review candidates");
  });

  it("rejects a valid-shaped representative-path classification mutation before it can be exposed", () => {
    const changed = structuredClone(research.sourceReviewBacklog);
    const candidate = changed.candidates.find(({ domainClassifications }) => domainClassifications.length > 1)!;
    const [first, second] = candidate.domainClassifications;
    candidate.domainClassifications = [
      { ...first!, representativeSkillPath: second!.representativeSkillPath },
      second!,
      ...candidate.domainClassifications.slice(2)
    ];

    expect(() => assertSourceReviewBacklog({
      backlog: changed,
      sourceConfigs: research.sourceConfigs,
      collectionReceipts: research.collectionReceipts,
      snapshots: research.snapshots
    })).not.toThrow();
    expect(() => assertSourceReviewBacklogMaterialization({
      backlog: changed,
      sourceConfigs: research.sourceConfigs,
      collectionReceipts: research.collectionReceipts,
      snapshots: research.snapshots,
      taxonomy
    })).toThrow("not the deterministic materialization");
  });

  it("exposes the materialized backlog through a read-only review-queue command", async () => {
    let stdout = "";
    const exitCode = await runDiscoveryCli(["review-queue"], repositoryRoot, {
      loadSourceReviewBacklog: async () => research.sourceReviewBacklog,
      writeStdout: (value) => { stdout += value; }
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      kind: "source-review-backlog",
      status: "review-required",
      executionStatus: "not-executed",
      totalCandidateCount: 14,
      delegatedOfficialSourceIds: ["anthropic-plugins-official"]
    });
  });
});
