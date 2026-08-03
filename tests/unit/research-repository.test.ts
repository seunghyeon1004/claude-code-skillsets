import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadResearchRepository } from "../../src/research/repository.js";
import { loadManifestRepository } from "../../src/manifest/repository.js";
import { computeSnapshotContentSha256 } from "../../src/research/snapshot.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("external-only research repository", () => {
  it("loads production with empty provider, review, conflict, and selection roots", async () => {
    const repository = await loadResearchRepository(projectRoot);
    expect(repository.providers).toEqual([]);
    expect(repository.sourceReviews).toEqual([]);
    expect(repository.conflicts).toEqual([]);
    expect(repository.providerSelections).toEqual([]);
    expect(repository.reviewSourceExtensions).toEqual({ schemaVersion: 2, triads: [] });
    expect(repository.context).toEqual(repository.baselineContext);
  });

  it("fails closed when one terminal provider selection is present without every target cell", async () => {
    const root = await mkdtemp(join(tmpdir(), "research-partial-selection-"));
    roots.push(root);
    await copyResearchFixture(root);
    await unlink(join(root, "manifests", "provider-selections", ".gitkeep"));
    await writeFile(join(root, "manifests", "provider-selections", "one-cell.yaml"), JSON.stringify({
      schemaVersion: 2,
      id: "one-cell",
      capabilityId: "analyze-repository-context",
      runtime: "claude-code",
      platform: "darwin",
      searchRecordId: "one-search",
      disposition: "unavailable",
      alternateProviderIds: [],
      terminalReviewIds: [],
      decisionReasons: ["incomplete test cell"],
      releaseEvidence: "not-applicable"
    }));

    await expect(loadManifestRepository(root)).rejects.toThrow(
      /provider-selections.*must have one.*claude-code\/darwin.*selection cell/i
    );
  });

  it("rejects a current context that rewrites a baseline observation", async () => {
    const root = await mkdtemp(join(tmpdir(), "research-current-context-"));
    roots.push(root);
    await copyResearchFixture(root);
    const path = join(root, "research", "current-evaluation-context.json");
    const current = JSON.parse(await readFile(path, "utf8")) as { upstreamObservations: unknown[] };
    current.upstreamObservations = [{ providerId: "provider", snapshotId: "missing", observedAt: "2026-07-23T05:39:45Z", headCommit: "a".repeat(40) }];
    await writeFile(path, JSON.stringify(current));
    await expect(loadResearchRepository(root)).rejects.toThrow("unknown snapshot ID");
  });

  it.each(["source", "receipt", "snapshot"])("rejects an unowned extension %s record", async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "research-unowned-record-"));
    roots.push(root);
    await copyResearchFixture(root);
    if (kind === "source") {
      await writeFile(join(root, "research/sources/unowned-source.json"), JSON.stringify({ schemaVersion: 2, sourceId: "unowned-source", repository: "https://github.com/example/unowned", queryUrls: ["https://github.com/example/unowned"], reportedCountClaims: [], markdownIndexPaths: [] }));
      await expect(loadResearchRepository(root)).rejects.toThrow("research/sources: record is not owned");
      return;
    }
    if (kind === "receipt") {
      await writeFile(join(root, "research/receipts/unowned-receipt.json"), JSON.stringify({ schemaVersion: 2, id: "unowned-receipt", sourceId: "obra-superpowers", snapshotId: "2026-07-23-obra-superpowers", observedAt: "2026-07-23T09:08:12Z", inspectedCommit: "a".repeat(40), collectorVersion: "0.1.0", independentCounts: [], snapshotContentSha256: "b".repeat(64) }));
      await expect(loadResearchRepository(root)).rejects.toThrow("research/receipts: record is not owned");
      return;
    }
    await writeFile(join(root, "research/snapshots/unowned-snapshot.json"), JSON.stringify({ schemaVersion: 2, id: "unowned-snapshot", sourceUrl: "https://github.com/example/unowned", queryUrls: ["https://github.com/example/unowned"], observedAt: "2026-07-23T09:08:12Z", inspectedRef: "main", inspectedCommit: "a".repeat(40), collectionMethod: "git-tree-and-marketplace-v1", toolVersion: "0.1.0", entries: [], countMetrics: [], contentSha256: computeSnapshotContentSha256([]) }));
    await expect(loadResearchRepository(root)).rejects.toThrow("research/snapshots: record is not owned");
  });
});

async function copyResearchFixture(root: string): Promise<void> {
  await Promise.all([
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
  ]);
}
