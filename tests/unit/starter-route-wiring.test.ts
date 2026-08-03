import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateDecisionIndex } from "../../src/contracts/decision.js";
import { assertDecisionIndexIntegrity, decisionIndexDigest } from "../../src/decision/index-loader.js";
import { loadDecisionIndex, loadDecisionManifests } from "../../src/decision/repository.js";
import { generateDecisionIndex } from "../../src/generate/decision-index.js";
import type { DecisionIndex, DecisionStarterRoute } from "../../src/model/decision.js";
import { stringify } from "yaml";
import { COMPLETE_V1_DOMAIN_IDS } from "../../src/model/complete-v1.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("optional starter-route wiring", () => {
  it("projects the authenticated production routes into byte-identical generated catalogs", async () => {
    const [tracked, generated, repository] = await Promise.all([
      readFile(join(projectRoot, "generated", "decision-index.json"), "utf8"),
      generateDecisionIndex(projectRoot),
      loadDecisionManifests(projectRoot)
    ]);

    expect(repository.starterRoutes?.map(({ domainId }) => domainId)).toEqual(COMPLETE_V1_DOMAIN_IDS);
    expect(generated).toBe(tracked);
    expect(JSON.parse(generated).starterRoutes).toEqual(repository.starterRoutes);
  });

  it("loads an optional route manifest through semantic validation before repository projection", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "manifests", "decision-starter-routes.yaml"), stringify({
      schemaVersion: 1,
      routes: [{
        domainId: "commerce",
        kind: "starter-partial",
        orderedCandidateIds: ["exa"],
        smallestHonestProfile: { ko: "Test route", en: "Test route" },
        directEvidenceIds: ["exa-web-research"],
        inferredEvidenceIds: [],
        unsupportedCapabilityIds: ["operate-stores-and-marketplaces"],
        broadCoverageComplete: false
      }]
    }), "utf8");

    await expect(loadDecisionManifests(root)).rejects.toThrow(
      /decision-starter-routes\.yaml: Invalid starter routes[\s\S]*(candidate|capability|missing expected domain)/i
    );
  });

  it("preserves an optional starterRoutes projection in the v3 contract and digest", async () => {
    const baseline = JSON.parse(await readFile(
      join(projectRoot, "generated", "decision-index.json"), "utf8"
    )) as DecisionIndex;
    const starterRoutes = [starterRoute()];
    const { digest: _digest, ...withoutDigest } = {
      ...baseline,
      starterRoutes
    };
    const index = {
      ...withoutDigest,
      digest: decisionIndexDigest(withoutDigest)
    };

    const validated = validateDecisionIndex(index);
    expect(validated.starterRoutes).toEqual(starterRoutes);
    expect(() => assertDecisionIndexIntegrity(validated)).not.toThrow();
  });

  it("rejects a generated route projection when the authenticated manifest is absent", async () => {
    const root = await fixtureRoot();
    await rm(join(root, "manifests", "decision-starter-routes.yaml"));
    const repository = await loadDecisionManifests(root);
    const baseline = JSON.parse(await readFile(
      join(root, "generated", "decision-index.json"), "utf8"
    )) as DecisionIndex;
    const { digest: _digest, ...withoutDigest } = {
      ...baseline,
      catalogVersion: repository.digest,
      starterRoutes: [starterRoute()]
    };
    await writeFile(join(root, "generated", "decision-index.json"), `${JSON.stringify({
      ...withoutDigest,
      digest: decisionIndexDigest(withoutDigest)
    }, null, 2)}\n`, "utf8");

    await expect(loadDecisionIndex(root)).rejects.toThrow(
      /starterRoutes is present without authenticated manifest routes/
    );
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "starter-route-wiring-"));
  temporaryRoots.push(root);
  await Promise.all([
    cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "generated"), join(root, "generated"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
  ]);
  return root;
}

function starterRoute(): DecisionStarterRoute {
  return {
    domainId: "commerce",
    kind: "starter-partial",
    orderedCandidateIds: ["windsor-ai"],
    smallestHonestProfile: { ko: "Queries revenue data.", en: "Queries revenue data." },
    directEvidenceIds: [],
    inferredEvidenceIds: ["windsor-commerce-revenue"],
    unsupportedCapabilityIds: ["operate-stores-and-marketplaces"],
    broadCoverageComplete: false
  };
}
