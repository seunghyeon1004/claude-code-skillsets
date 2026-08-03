import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadManifestRepository } from "../../src/manifest/repository.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
describe("production external-only research governance", () => {
  it("loads the frozen P03 census with no provider or owned-gap root", async () => {
    const repository = await loadManifestRepository(projectRoot);
    expect(repository.research.providers).toEqual([]);
    expect(repository.research.providerSelections).toEqual([]);
    expect(repository.research).not.toHaveProperty("ownedGapDecisions");
  });
});
