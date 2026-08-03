import { describe, expect, it, vi } from "vitest";
import {
  refreshCatalog,
  type CatalogRefreshAdapters,
  type RefreshCatalogInput,
  type RefreshSource
} from "../../src/research/refresh.js";

const request = {
  observedAt: "2026-07-29T00:00:00Z",
  baseSha: "a".repeat(40),
  baseCatalogDigest: "b".repeat(64),
  stagingRoot: "/tmp/catalog-refresh"
};

describe("catalog refresh", () => {
  it("publishes nothing when one source fails", async () => {
    const harness = createHarness([
      source("source-a"),
      source("source-b", async () => {
        throw new Error("source-b unavailable");
      })
    ]);

    await expect(refreshCatalog(harness.input)).rejects.toThrow("source-b unavailable");

    expect(harness.adapters.prepareStaging).toHaveBeenCalledOnce();
    expect(harness.adapters.generateCatalog).not.toHaveBeenCalled();
    expect(harness.adapters.prepareCandidate).not.toHaveBeenCalled();
    expect(harness.adapters.runReleaseGates).not.toHaveBeenCalled();
    expect(harness.adapters.readRemoteMain).not.toHaveBeenCalled();
    expect(harness.adapters.publishValidatedArtifacts).not.toHaveBeenCalled();
    expect(harness.adapters.removeStagingRoot).toHaveBeenCalledWith("/tmp/catalog-refresh/run-unique");
  });

  it("commits before gates and rechecks immediately before publication", async () => {
    const sourceA = source("source-a");
    const sourceB = source("source-b");
    const harness = createHarness([sourceA, sourceB]);

    const result = await refreshCatalog(harness.input);

    expect(result).toEqual({
      changed: true,
      baseDigest: request.baseCatalogDigest,
      resultDigest: "c".repeat(64),
      changedPaths: ["generated/catalog.en.md", "generated/catalog.ko.md"]
    });
    expect(sourceA.collect).toHaveBeenCalledWith({ observedAt: request.observedAt, stagingRoot: "/tmp/catalog-refresh/run-unique" });
    expect(sourceB.collect).toHaveBeenCalledWith({ observedAt: request.observedAt, stagingRoot: "/tmp/catalog-refresh/run-unique" });
    expect(harness.events).toEqual([
      "stage",
      "prepare",
      "source-a",
      "source-b",
      "generate",
      "digest",
      "candidate",
      "gates",
      "recheck",
      "publish",
      "cleanup"
    ]);
  });

  it("fails closed when remote main changes after candidate gates", async () => {
    const harness = createHarness([source("source-a")]);
    harness.adapters.readRemoteMain.mockResolvedValueOnce({
      sha: "d".repeat(40),
      catalogDigest: request.baseCatalogDigest
    });

    await expect(refreshCatalog(harness.input)).rejects.toThrow(/remote main changed/i);

    expect(harness.adapters.prepareCandidate).toHaveBeenCalledOnce();
    expect(harness.adapters.runReleaseGates).toHaveBeenCalledOnce();
    expect(harness.adapters.publishValidatedArtifacts).not.toHaveBeenCalled();
    expect(harness.adapters.removeStagingRoot).toHaveBeenCalledTimes(1);
  });

  it("returns an unchanged receipt without committing, gating, or publishing", async () => {
    const harness = createHarness([source("source-a")], request.baseCatalogDigest);

    await expect(refreshCatalog(harness.input)).resolves.toEqual({
      changed: false,
      baseDigest: request.baseCatalogDigest,
      resultDigest: request.baseCatalogDigest,
      changedPaths: []
    });
    expect(harness.adapters.prepareCandidate).not.toHaveBeenCalled();
    expect(harness.adapters.runReleaseGates).not.toHaveBeenCalled();
    expect(harness.adapters.readRemoteMain).not.toHaveBeenCalled();
    expect(harness.adapters.publishValidatedArtifacts).not.toHaveBeenCalled();
  });

  it("suppresses gates and publication for an identical open review PR", async () => {
    const harness = createHarness([source("source-a")], "c".repeat(64), false);

    await expect(refreshCatalog(harness.input)).resolves.toMatchObject({
      changed: true,
      changedPaths: ["generated/catalog.en.md", "generated/catalog.ko.md"]
    });

    expect(harness.adapters.prepareCandidate).toHaveBeenCalledOnce();
    expect(harness.adapters.runReleaseGates).not.toHaveBeenCalled();
    expect(harness.adapters.readRemoteMain).not.toHaveBeenCalled();
    expect(harness.adapters.publishValidatedArtifacts).not.toHaveBeenCalled();
  });

  it("cleans up even when a staging adapter returns the requested parent", async () => {
    const harness = createHarness([source("source-a")]);
    harness.adapters.createStagingRoot.mockResolvedValue(request.stagingRoot);

    await expect(refreshCatalog(harness.input)).rejects.toThrow(/unique child directory/i);

    expect(harness.adapters.removeStagingRoot).toHaveBeenCalledWith(request.stagingRoot);
  });
});

function source(id: string, collect: () => Promise<void> = async () => undefined): RefreshSource {
  return {
    id,
    collect: vi.fn(async () => collect())
  };
}

function createHarness(
  sources: readonly RefreshSource[],
  resultDigest = "c".repeat(64),
  publish = true
): {
  input: RefreshCatalogInput;
  adapters: CatalogRefreshAdapters & {
    createStagingRoot: ReturnType<typeof vi.fn>;
    removeStagingRoot: ReturnType<typeof vi.fn>;
    prepareStaging: ReturnType<typeof vi.fn>;
    generateCatalog: ReturnType<typeof vi.fn>;
    digestCatalog: ReturnType<typeof vi.fn>;
    prepareCandidate: ReturnType<typeof vi.fn>;
    runReleaseGates: ReturnType<typeof vi.fn>;
    readRemoteMain: ReturnType<typeof vi.fn>;
    publishValidatedArtifacts: ReturnType<typeof vi.fn>;
  };
  events: string[];
} {
  const events: string[] = [];
  const adapters = {
    createStagingRoot: vi.fn(async () => {
      events.push("stage");
      return "/tmp/catalog-refresh/run-unique";
    }),
    removeStagingRoot: vi.fn(async () => {
      events.push("cleanup");
    }),
    prepareStaging: vi.fn(async () => {
      events.push("prepare");
    }),
    generateCatalog: vi.fn(async () => {
      events.push("generate");
    }),
    digestCatalog: vi.fn(async () => {
      events.push("digest");
      return resultDigest;
    }),
    prepareCandidate: vi.fn(async () => {
      events.push("candidate");
      return {
        changedPaths: ["generated/catalog.en.md", "generated/catalog.ko.md"],
        publish
      };
    }),
    runReleaseGates: vi.fn(async () => {
      events.push("gates");
    }),
    readRemoteMain: vi.fn(async () => {
      events.push("recheck");
      return { sha: request.baseSha, catalogDigest: request.baseCatalogDigest };
    }),
    publishValidatedArtifacts: vi.fn(async () => {
      events.push("publish");
    })
  } satisfies CatalogRefreshAdapters;
  for (const item of sources) {
    const original = item.collect;
    item.collect = vi.fn(async (input) => {
      events.push(item.id);
      await original(input);
    });
  }
  return {
    input: { request, sources, adapters },
    adapters,
    events
  };
}
