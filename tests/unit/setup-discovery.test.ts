import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPluginDecisionBoundary } from "../../src/decision/index-loader.js";
import {
  buildSetupDiscoveryCandidates,
  evaluateSetupDecisionFixture
} from "../../src/evaluate/setup.js";

const projectRoot = process.cwd();
const pluginRoot = join(projectRoot, "plugins", "skillset-manager");

describe("setup discovery projection", () => {
  it("keeps selected-domain order, deduplicates candidates, and caps discovery at two", async () => {
    const { decisionIndex } = await loadPluginDecisionBoundary(pluginRoot);

    const duplicated = buildSetupDiscoveryCandidates(
      decisionIndex,
      ["marketing-and-growth", "commerce"],
      []
    );
    expect(duplicated).toHaveLength(1);
    expect(duplicated[0]).toMatchObject({
      candidateId: "windsor-ai",
      domainIds: ["marketing-and-growth", "commerce"],
      evidenceSupport: ["related"],
      installable: false
    });

    const capped = buildSetupDiscoveryCandidates(
      decisionIndex,
      ["sales-and-customer", "documents-and-knowledge"],
      []
    );
    expect(capped.map(({ candidateId }) => candidateId)).toEqual(["apollo", "monday-crm"]);
  });

  it("excludes install-selected candidates and exposes only the bounded discovery shape", async () => {
    const { decisionIndex } = await loadPluginDecisionBoundary(pluginRoot);
    const windsor = decisionIndex.candidates.find(({ id }) => id === "windsor-ai");
    if (windsor === undefined) throw new Error("Current fixture lacks windsor-ai");

    expect(buildSetupDiscoveryCandidates(decisionIndex, ["marketing-and-growth"], [windsor])).toEqual([]);
    const [candidate] = buildSetupDiscoveryCandidates(decisionIndex, ["video-and-audio"], []);
    expect(Object.keys(candidate ?? {}).sort()).toEqual([
      "candidateId",
      "displayName",
      "domainIds",
      "evidenceSupport",
      "installable",
      "sourceId",
      "state",
      "stateReasons"
    ]);
    expect(JSON.stringify(candidate)).not.toMatch(/argv|marketplaceSource|absolute|skillPath/u);
  });

  it("returns detached arrays whose caller mutation cannot change index authority", async () => {
    const { decisionIndex } = await loadPluginDecisionBoundary(pluginRoot);
    const original = decisionIndex.candidates.find(({ id }) => id === "runway-api");
    if (original === undefined) throw new Error("Current fixture lacks runway-api");
    const originalReasons = [...original.stateReasons];
    const projected = buildSetupDiscoveryCandidates(decisionIndex, ["video-and-audio"], []);

    projected[0]!.domainIds.push("marketing-and-growth");
    projected[0]!.stateReasons.push("caller-forged");
    projected[0]!.evidenceSupport.push("direct");

    expect(original.stateReasons).toEqual(originalReasons);
    expect(buildSetupDiscoveryCandidates(decisionIndex, ["video-and-audio"], [])).toEqual([
      expect.objectContaining({
        candidateId: "runway-api",
        domainIds: ["video-and-audio"],
        stateReasons: originalReasons,
        evidenceSupport: ["related"]
      })
    ]);
  });

  it("does not enter the approval preview or alter its digest", async () => {
    const { decisionIndex } = await loadPluginDecisionBoundary(pluginRoot);
    const plan = await evaluateSetupDecisionFixture(decisionIndex, {
      language: "en",
      platform: "darwin",
      domainIds: ["video-and-audio"],
      timeProbe: { consent: "granted", utcTimestamp: decisionIndex.observedThrough }
    });
    const digestBefore = plan.approvalBinding.previewDigest;

    expect(buildSetupDiscoveryCandidates(decisionIndex, plan.domainIds, plan.candidates)).toHaveLength(1);
    expect(plan.approvalBinding.previewDigest).toBe(digestBefore);
    expect(plan.approvalBinding.preview).not.toHaveProperty("discoveryCandidates");
    expect(await readFile(join(pluginRoot, "data", "decision-index.json"), "utf8"))
      .not.toContain('"discoveryCandidates"');
  });
});
