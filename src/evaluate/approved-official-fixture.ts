import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializeDecisionResearch } from "../../scripts/research/materialize-decision-research.js";
import { approveOfficialMarketplaceObservation } from "../../scripts/research/stage-official-marketplace.js";
import { loadPluginDecisionIndexSet } from "../decision/index-loader.js";
import {
  loadOfficialMarketplaceSelection,
  officialMarketplaceCandidateIdentity
} from "../discovery/official-marketplace.js";
import { generateDecisionIndex } from "../generate/decision-index.js";

/** Builds an explicit approval only inside a disposable development-evaluation repository. */
export async function createApprovedOfficialDecisionIndexFixture(projectRoot: string): Promise<{
  root: string;
  raw: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "approved-official-decision-index-"));
  try {
    await Promise.all([
      cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
      cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
      cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
    ]);
    await materializeApprovedOfficialMarketplaceFixture(root);
    return { root, raw: await generateDecisionIndex(root) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function createApprovedOfficialDecisionIndexSetFixture(projectRoot: string) {
  const fixture = await createApprovedOfficialDecisionIndexFixture(projectRoot);
  const pluginRoot = join(fixture.root, "plugin");
  await mkdir(join(pluginRoot, "data"), { recursive: true });
  await writeFile(join(pluginRoot, "data", "decision-index.json"), fixture.raw, "utf8");
  const indexSet = await loadPluginDecisionIndexSet(pluginRoot);
  return { ...fixture, pluginRoot, indexSet, index: indexSet.current };
}

export async function materializeApprovedOfficialMarketplaceFixture(
  root: string,
  asOf?: string
): Promise<string> {
  const selection = loadOfficialMarketplaceSelection(root);
  const effectiveAsOf = asOf ?? await materializedAsOf(root);
  if (selection.state === "review-required") {
    await approveOfficialMarketplaceObservation({
      root,
      approvedAt: effectiveAsOf,
      approvedBy: "reviewer:fixture",
      reason: "exercise an isolated eligible official marketplace fixture",
      candidateRebindings: selection.selectedChanges.map(({ name }) => {
        const plugin = selection.observedArtifact.plugins.find((candidate) => candidate.name === name);
        if (plugin === undefined) throw new Error(`${name}: fixture marketplace plugin is missing`);
        return { name, expectedIdentity: officialMarketplaceCandidateIdentity(plugin) };
      })
    });
  }
  await materializeDecisionResearch({ root, asOf: effectiveAsOf, checkOnly: false });
  return effectiveAsOf;
}

async function materializedAsOf(root: string): Promise<string> {
  const state = JSON.parse(await readFile(
    join(root, "research", "materialized-review-state.json"),
    "utf8"
  )) as { asOf: string };
  return state.asOf;
}
