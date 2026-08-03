import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { generateDecisionIndex } from "../../src/generate/decision-index.js";
import type { DecisionIndex } from "../../src/model/decision.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("candidate revision drift quarantine", () => {
  it("keeps weekly generation available while one manual official candidate is quarantined", async () => {
    const root = await fixtureRoot();
    const previous = await readCurrentSelection(root);
    const observedAt = await installShopifyDriftSelection(root, "a".repeat(40));
    const current = await readCurrentSelection(root);

    expect(Date.parse(observedAt) - Date.parse(previous.observedAt)).toBe(1000);
    expect(current).toMatchObject({
      observedAt,
      previousSelection: previous.selection,
      previousSelectionSha256: previous.selectionSha256
    });

    const index = JSON.parse(await generateDecisionIndex(root)) as DecisionIndex;
    const shopify = index.candidates.find(({ id }) => id === "shopify-ai-toolkit")!;

    expect(shopify).toMatchObject({
      state: "held",
      providedCapabilityIds: [],
      capabilityEvidenceIds: [],
      revisionBinding: "unavailable"
    });
    expect(shopify.stateReasons).toContain("source-drift:unreviewed");
    expect(shopify).not.toHaveProperty("officialBaseline");
    expect(shopify).not.toHaveProperty("claudeInstall");
    expect(index.candidateEvidence.filter(({ candidateId }) => candidateId === shopify.id)).toEqual([]);
    expect(index.starterRoutes).toHaveLength(20);
    expect(index.starterRoutes?.some(({ orderedCandidateIds }) =>
      orderedCandidateIds.includes(shopify.id))).toBe(false);
    expect(index.candidates.find(({ id }) => id === "exa")).toBeDefined();
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "candidate-revision-drift-"));
  temporaryRoots.push(root);
  await Promise.all([
    cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
  ]);
  return root;
}

async function readCurrentSelection(root: string): Promise<{
  selection: string;
  selectionSha256: string;
  observedAt: string;
  previousSelection?: string;
  previousSelectionSha256?: string;
}> {
  const marketplaceRoot = join(root, "research", "marketplaces");
  const pointerPath = join(marketplaceRoot, "official-marketplace-current.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as {
    schemaVersion: 1;
    selection: string;
    selectionSha256: string;
  };
  const selectionPath = join(marketplaceRoot, pointer.selection);
  const selection = JSON.parse(await readFile(selectionPath, "utf8")) as {
    observedAt: string;
    previousSelection?: string;
    previousSelectionSha256?: string;
  };
  return {
    selection: pointer.selection,
    selectionSha256: pointer.selectionSha256,
    observedAt: selection.observedAt,
    previousSelection: selection.previousSelection,
    previousSelectionSha256: selection.previousSelectionSha256
  };
}

async function installShopifyDriftSelection(root: string, sourceCommit: string): Promise<string> {
  const marketplaceRoot = join(root, "research", "marketplaces");
  const pointerPath = join(marketplaceRoot, "official-marketplace-current.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as {
    schemaVersion: 1;
    selection: string;
    selectionSha256: string;
  };
  const previous = JSON.parse(await readFile(join(marketplaceRoot, pointer.selection), "utf8")) as {
    approvedArtifact: string;
    approvedArtifactSha256: string;
    observedArtifact: string;
    observedArtifactSha256: string;
    observedAt: string;
    protectedCandidates: string[];
  };
  const observedAt = new Date(Date.parse(previous.observedAt) + 1000).toISOString().replace(".000Z", "Z");
  const artifact = JSON.parse(await readFile(join(marketplaceRoot, previous.observedArtifact), "utf8")) as {
    plugins: Array<{ name: string; source: string | { sha: string } }>;
  };
  const shopify = artifact.plugins.find(({ name }) => name === "shopify-ai-toolkit")!;
  if (typeof shopify.source === "string") throw new Error("Shopify fixture source must be pinned");
  shopify.source.sha = sourceCommit;
  const artifactBytes = `${JSON.stringify(artifact, null, 2)}\n`;
  const observedArtifact = "claude-plugins-official-aaaaaaa.json";
  await writeFile(join(marketplaceRoot, observedArtifact), artifactBytes);

  const selection = {
    schemaVersion: 1,
    observedAt,
    state: "review-required",
    approvedArtifact: previous.approvedArtifact,
    approvedArtifactSha256: previous.approvedArtifactSha256,
    observedArtifact,
    observedArtifactSha256: sha256(artifactBytes),
    protectedCandidates: previous.protectedCandidates,
    previousSelection: pointer.selection,
    previousSelectionSha256: pointer.selectionSha256,
    transition: "observation",
    approval: null
  };
  const selectionBytes = `${JSON.stringify(selection, null, 2)}\n`;
  const selectionPath = `official-marketplace-selections/${observedAt.replaceAll("-", "").replaceAll(":", "")}-aaaaaaa.json`;
  await mkdir(join(marketplaceRoot, "official-marketplace-selections"), { recursive: true });
  await writeFile(join(marketplaceRoot, selectionPath), selectionBytes);
  await writeFile(pointerPath, `${JSON.stringify({
    schemaVersion: 1,
    selection: selectionPath,
    selectionSha256: sha256(selectionBytes)
  }, null, 2)}\n`);
  return observedAt;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
