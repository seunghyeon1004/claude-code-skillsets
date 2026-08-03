import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  isProtectedOfficialMarketplaceCandidate,
  isSelectedOfficialMarketplaceCandidate,
  loadOfficialMarketplaceSelection,
  officialMarketplaceCandidateIdentity,
  validateOfficialMarketplaceSelection
} from "../../src/discovery/official-marketplace.js";
import {
  approveOfficialMarketplaceObservation,
  stageOfficialMarketplaceObservation
} from "../../scripts/research/stage-official-marketplace.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];
const observedAt = addMilliseconds(loadOfficialMarketplaceSelection(projectRoot).observedAt, 86_400_000);
const approvedAt = addMilliseconds(observedAt, 3_600_000);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("official marketplace refresh staging", () => {
  it("protects every official-listing claims candidate from automatic renewal drift", async () => {
    const claims = YAML.parse(await readFile(
      join(projectRoot, "manifests", "official-listing-capability-claims.yaml"),
      "utf8"
    )) as { candidates: Array<{ pluginName: string }> };

    expect(claims.candidates).toHaveLength(34);
    expect(claims.candidates.every(({ pluginName }) =>
      isProtectedOfficialMarketplaceCandidate(pluginName, projectRoot)
    )).toBe(true);
    expect(isSelectedOfficialMarketplaceCandidate("atlan")).toBe(false);
  });

  it("appends a new artifact and renews the epoch only when selected identities are unchanged", async () => {
    const root = await fixtureRoot();
    const initialChainLength = loadOfficialMarketplaceSelection(root).chain.length;
    const manifest = await marketplaceManifest(root);

    const result = await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    });

    expect(result).toMatchObject({ state: "current", claimsRenewed: true });
    expect(result.artifactPath).not.toBe("claude-plugins-official-e3e378c.json");
    const selection = loadOfficialMarketplaceSelection(root);
    expect(selection.observedAt).toBe(observedAt);
    expect(selection.selectedChanges).toEqual([]);
    expect(selection.chain).toHaveLength(initialChainLength + 1);
    const claims = YAML.parse(await readFile(join(root, "manifests", "official-listing-capability-claims.yaml"), "utf8")) as {
      compatibilityAttestation: { observedAt: string; reviewedAt: string; expiresAt: string };
      candidates: Array<{ pluginName: string; marketplaceReference: string }>;
    };
    expect(claims.compatibilityAttestation).toMatchObject({
      observedAt,
      reviewedAt: observedAt,
      expiresAt: addMilliseconds(observedAt, 9 * 86_400_000)
    });
    expect(claims.candidates.find(({ pluginName }) => pluginName === "exa")?.marketplaceReference)
      .toMatch(new RegExp(`^research/marketplaces/${result.artifactPath}#/plugins/`));
    const backlog = JSON.parse(await readFile(
      join(root, "research", "official-marketplace-review-backlog.json"),
      "utf8"
    )) as { inventoryChanges: unknown[] };
    expect(backlog.inventoryChanges).toEqual([]);
  });

  it("rolls back claims and leaves the pointer unchanged when backlog publication fails", async () => {
    const root = await fixtureRoot();
    const pointerPath = join(root, "research", "marketplaces", "official-marketplace-current.json");
    const claimsPath = join(root, "manifests", "official-listing-capability-claims.yaml");
    const backlogPath = join(root, "research", "official-marketplace-review-backlog.json");
    const [pointerBefore, claimsBefore] = await Promise.all([
      readFile(pointerPath),
      readFile(claimsPath)
    ]);
    await mkdir(backlogPath);
    const manifest = await marketplaceManifest(root);

    await expect(stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    })).rejects.toThrow(/backlog|directory|EISDIR/i);

    expect(await readFile(pointerPath)).toEqual(pointerBefore);
    expect(await readFile(claimsPath)).toEqual(claimsBefore);
    expect(loadOfficialMarketplaceSelection(root).observedAt).not.toBe(observedAt);
  });

  it("holds selected drift for review without renewing claims", async () => {
    const root = await fixtureRoot();
    const before = await readFile(join(root, "manifests", "official-listing-capability-claims.yaml"), "utf8");
    const manifest = await marketplaceManifest(root);
    const exa = manifest.plugins.find(({ name }) => name === "exa")!;
    exa.description += " changed";

    const result = await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: "f".repeat(40),
      manifestBytes: manifestBytes(manifest)
    });

    expect(result).toMatchObject({ state: "review-required", claimsRenewed: false });
    expect(loadOfficialMarketplaceSelection(root).selectedChanges).toContainEqual({ name: "exa", status: "changed" });
    const backlog = JSON.parse(await readFile(
      join(root, "research", "official-marketplace-review-backlog.json"),
      "utf8"
    )) as { inventoryChanges: Array<{ name: string; status: string; selected: boolean }> };
    expect(backlog.inventoryChanges).toContainEqual(expect.objectContaining({
      name: "exa",
      status: "changed",
      selected: true
    }));
    expect(await readFile(join(root, "manifests", "official-listing-capability-claims.yaml"), "utf8")).toBe(before);
  });

  it("does not authenticate an abandoned review-held observation as approved history", async () => {
    const root = await fixtureRoot();
    const manifest = await marketplaceManifest(root);
    const exa = manifest.plugins.find(({ name }) => name === "exa")!;
    const originalSource = structuredClone(exa.source);
    (exa.source as { sha: string }).sha = "f".repeat(40);
    const abandoned = await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: "e".repeat(40),
      manifestBytes: manifestBytes(manifest)
    });
    expect(abandoned.state).toBe("review-required");

    exa.source = originalSource;
    const replacement = await stageOfficialMarketplaceObservation({
      root,
      observedAt: addMilliseconds(observedAt, 3_600_000),
      inspectedCommit: "d".repeat(40),
      manifestBytes: manifestBytes(manifest)
    });
    expect(replacement.state).toBe("review-required");

    const selection = loadOfficialMarketplaceSelection(root);
    expect(selection.approvedArtifactPaths).toContain(selection.approvedArtifactPath);
    expect(selection.approvedArtifactPaths).not.toContain(abandoned.artifactPath);
    expect(selection.observedArtifactPath).toBe(replacement.artifactPath);

    await writeFile(join(root, "research", "marketplaces", abandoned.artifactPath), "{}\n");
    expect(() => loadOfficialMarketplaceSelection(root)).toThrow(/artifact SHA-256 mismatch/i);
  });

  it.each([
    {
      label: "same-pin description drift",
      mutate(plugin: { description: string; source: unknown }) {
        plugin.description += " changed without a source-pin advance";
      }
    },
    {
      label: "same-SHA source coordinate drift",
      mutate(plugin: { description: string; source: unknown }) {
        (plugin.source as { url: string }).url = "https://github.com/example/rebound-atlan.git";
      }
    }
  ])("holds claims-only candidate $label for review", async ({ mutate }) => {
    const root = await fixtureRoot();
    const claimsPath = join(root, "manifests", "official-listing-capability-claims.yaml");
    const before = await readFile(claimsPath, "utf8");
    const manifest = await marketplaceManifest(root);
    const atlan = manifest.plugins.find(({ name }) => name === "atlan")!;
    mutate(atlan);

    const result = await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    });

    expect(result).toMatchObject({ state: "review-required", claimsRenewed: false });
    expect(loadOfficialMarketplaceSelection(root).selectedChanges)
      .toContainEqual({ name: "atlan", status: "changed" });
    const backlog = JSON.parse(await readFile(
      join(root, "research", "official-marketplace-review-backlog.json"),
      "utf8"
    )) as { inventoryChanges: Array<{ name: string; selected: boolean; protected: boolean }> };
    expect(backlog.inventoryChanges).toContainEqual(expect.objectContaining({
      name: "atlan",
      selected: false,
      protected: true
    }));
    expect(await readFile(claimsPath, "utf8")).toBe(before);
  });

  it("does not let claims removal shrink the append-only protected set", async () => {
    const root = await fixtureRoot();
    const claimsPath = join(root, "manifests", "official-listing-capability-claims.yaml");
    const document = YAML.parseDocument(await readFile(claimsPath, "utf8"));
    const claims = document.get("candidates") as { items: Array<{ toJSON(): { pluginName: string } }> };
    const atlanIndex = claims.items.findIndex((candidate) => candidate.toJSON().pluginName === "atlan");
    claims.items.splice(atlanIndex, 1);
    await writeFile(claimsPath, String(document));
    const manifest = await marketplaceManifest(root);
    manifest.plugins.find(({ name }) => name === "atlan")!.description += " changed after claim removal";

    const result = await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    });

    expect(result).toMatchObject({ state: "review-required", claimsRenewed: false });
    expect(loadOfficialMarketplaceSelection(root).selectedChanges)
      .toContainEqual({ name: "atlan", status: "changed" });
  });

  it("surfaces a new unselected listing for deterministic classification and review", async () => {
    const root = await fixtureRoot();
    const manifest = await marketplaceManifest(root);
    manifest.plugins.push({
      name: "new-research-tool",
      description: "A web research platform for source discovery and verification.",
      source: { source: "github", repo: "example/new-research-tool", commit: "f".repeat(40), sha: "f".repeat(40) }
    });

    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    });

    const backlog = JSON.parse(await readFile(
      join(root, "research", "official-marketplace-review-backlog.json"),
      "utf8"
    )) as {
      inventoryChanges: Array<{
        name: string;
        status: string;
        selected: boolean;
        observed: {
          candidateIdentity: string;
          classificationDomainIds: string[];
          sourceCoordinate: unknown;
        };
      }>;
    };
    expect(backlog.inventoryChanges).toContainEqual(expect.objectContaining({
      name: "new-research-tool",
      status: "added",
      selected: false,
      observed: expect.objectContaining({
        candidateIdentity: expect.any(String),
        classificationDomainIds: ["research-and-intelligence"],
        sourceCoordinate: { source: "github", repo: "example/new-research-tool" }
      })
    }));
  });

  it("requires exact manual identity approval before adopting a newly claimed listing", async () => {
    const root = await fixtureRoot();
    const manifest = await marketplaceManifest(root);
    manifest.plugins.push({
      name: "new-reviewed-tool",
      description: "A reviewed candidate for deterministic web research workflows.",
      source: {
        source: "github",
        repo: "example/new-reviewed-tool",
        commit: "f".repeat(40),
        sha: "f".repeat(40)
      }
    });
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    });

    const claimsPath = join(root, "manifests", "official-listing-capability-claims.yaml");
    const claims = YAML.parse(await readFile(claimsPath, "utf8")) as { candidates: unknown[] };
    claims.candidates.push({
      pluginName: "new-reviewed-tool",
      sourcePin: { kind: "external-sha", sha: "f".repeat(40) }
    });
    await writeFile(claimsPath, YAML.stringify(claims));
    const adoptionObservedAt = addMilliseconds(observedAt, 86_400_000);
    const observation = await stageOfficialMarketplaceObservation({
      root,
      observedAt: adoptionObservedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    });

    expect(observation).toMatchObject({ state: "review-required", claimsRenewed: false });
    expect(loadOfficialMarketplaceSelection(root).selectedChanges)
      .toContainEqual({ name: "new-reviewed-tool", status: "added" });
    const backlog = JSON.parse(await readFile(
      join(root, "research", "official-marketplace-review-backlog.json"),
      "utf8"
    )) as { inventoryChanges: Array<{
      name: string;
      observed: null | { candidateIdentity: string; sourceCoordinate: unknown };
    }> };
    const reviewedAddition = backlog.inventoryChanges.find(({ name }) => name === "new-reviewed-tool")!;
    expect(reviewedAddition.observed?.sourceCoordinate).toEqual({
      source: "github",
      repo: "example/new-reviewed-tool"
    });
    const adoptionApprovedAt = addMilliseconds(adoptionObservedAt, 3_600_000);
    await expect(approveOfficialMarketplaceObservation({
      root,
      approvedAt: adoptionApprovedAt,
      approvedBy: "reviewer:test",
      reason: "new candidate identity must be exact",
      candidateAdditions: [{ name: "new-reviewed-tool", expectedIdentity: "wrong" }]
    })).rejects.toThrow(/identity|candidate addition/i);

    const selection = loadOfficialMarketplaceSelection(root);
    const adopted = selection.observedArtifact.plugins.find(({ name }) => name === "new-reviewed-tool")!;
    expect(reviewedAddition.observed?.candidateIdentity)
      .toBe(officialMarketplaceCandidateIdentity(adopted));
    await expect(approveOfficialMarketplaceObservation({
      root,
      approvedAt: adoptionApprovedAt,
      approvedBy: "reviewer:test",
      reason: "reviewed exact candidate addition",
      candidateAdditions: [{
        name: adopted.name,
        expectedIdentity: reviewedAddition.observed!.candidateIdentity
      }]
    })).resolves.toMatchObject({ state: "current" });
  });

  it("holds a newly protected identity that was previously promoted as unselected", async () => {
    const root = await fixtureRoot();
    const manifest = await marketplaceManifest(root);
    manifest.plugins.push({
      name: "later-protected-tool",
      description: "A later protected candidate for reviewed research workflows.",
      source: {
        source: "github",
        repo: "example/later-protected-tool",
        commit: "e".repeat(40),
        sha: "e".repeat(40)
      }
    });
    (manifest.plugins.find(({ name }) => name === "exa")!.source as { sha: string }).sha = "f".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    });
    await approveOfficialMarketplaceObservation({
      root,
      approvedAt,
      approvedBy: "reviewer:test",
      reason: "approve only the selected source-pin drift"
    });
    expect(loadOfficialMarketplaceSelection(root).approvedArtifact.plugins)
      .toContainEqual(expect.objectContaining({ name: "later-protected-tool" }));

    const claimsPath = join(root, "manifests", "official-listing-capability-claims.yaml");
    const claims = YAML.parse(await readFile(claimsPath, "utf8")) as { candidates: unknown[] };
    claims.candidates.push({
      pluginName: "later-protected-tool",
      sourcePin: { kind: "external-sha", sha: "e".repeat(40) }
    });
    await writeFile(claimsPath, YAML.stringify(claims));
    const protectionObservedAt = addMilliseconds(approvedAt, 3_600_000);
    const observation = await stageOfficialMarketplaceObservation({
      root,
      observedAt: protectionObservedAt,
      inspectedCommit: manifest.inspectedCommit,
      manifestBytes: manifestBytes(manifest)
    });

    expect(observation).toMatchObject({ state: "review-required", claimsRenewed: false });
    expect(loadOfficialMarketplaceSelection(root).selectedChanges)
      .toContainEqual({ name: "later-protected-tool", status: "added" });
    const backlog = JSON.parse(await readFile(
      join(root, "research", "official-marketplace-review-backlog.json"),
      "utf8"
    )) as { inventoryChanges: Array<{
      name: string;
      status: string;
      protected: boolean;
      approved: null | { candidateIdentity: string };
      observed: null | { candidateIdentity: string };
    }> };
    expect(backlog.inventoryChanges).toContainEqual(expect.objectContaining({
      name: "later-protected-tool",
      status: "added",
      protected: true,
      approved: expect.objectContaining({ candidateIdentity: expect.any(String) }),
      observed: expect.objectContaining({ candidateIdentity: expect.any(String) })
    }));
  });

  it("provides a typed approval transition for audited source-pin-only drift", async () => {
    const root = await fixtureRoot();
    const initialChainLength = loadOfficialMarketplaceSelection(root).chain.length;
    const manifest = await marketplaceManifest(root);
    const exa = manifest.plugins.find(({ name }) => name === "exa")!;
    (exa.source as { sha: string }).sha = "f".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: "f".repeat(40),
      manifestBytes: manifestBytes(manifest)
    });

    const approved = await approveOfficialMarketplaceObservation({
      root,
      approvedAt,
      approvedBy: "reviewer:test",
      reason: "audited upstream source pin advances"
    });

    expect(approved).toMatchObject({ state: "current", approvedBy: "reviewer:test" });
    const selection = loadOfficialMarketplaceSelection(root);
    expect(selection.state).toBe("current");
    expect(selection.approvedArtifactPath).toBe(selection.observedArtifactPath);
    expect(selection.chain).toHaveLength(initialChainLength + 2);
    const claims = YAML.parse(await readFile(
      join(root, "manifests", "official-listing-capability-claims.yaml"),
      "utf8"
    )) as { candidates: Array<{ pluginName: string; sourcePin: { sha: string } }> };
    expect(claims.candidates.find(({ pluginName }) => pluginName === "exa")?.sourcePin.sha).toBe("f".repeat(40));
    const historicalArtifactPath = selection.approvedArtifactPaths.find(
      (path) => path !== selection.approvedArtifactPath
    );
    expect(historicalArtifactPath).toBeDefined();
    await writeFile(join(root, "research", "marketplaces", historicalArtifactPath!), "{}\n");
    expect(() => loadOfficialMarketplaceSelection(root)).toThrow(/artifact SHA-256 mismatch/i);
  });

  it("rejects coordinate changes and approval-path collisions without publishing partial claims", async () => {
    const coordinateRoot = await fixtureRoot();
    const coordinateManifest = await marketplaceManifest(coordinateRoot);
    const coordinateExa = coordinateManifest.plugins.find(({ name }) => name === "exa")!;
    (coordinateExa.source as { url: string }).url = "https://github.com/example/rebound.git";
    const coordinateObservation = await stageOfficialMarketplaceObservation({
      root: coordinateRoot,
      observedAt,
      inspectedCommit: coordinateManifest.inspectedCommit,
      manifestBytes: manifestBytes(coordinateManifest)
    });
    expect(coordinateObservation).toMatchObject({ state: "review-required", claimsRenewed: false });
    await expect(approveOfficialMarketplaceObservation({
      root: coordinateRoot,
      approvedAt,
      approvedBy: "reviewer:test",
      reason: "must not approve a coordinate change"
    })).rejects.toThrow(/coordinate|source-pin-only/i);

    const collisionRoot = await fixtureRoot();
    const collisionManifest = await marketplaceManifest(collisionRoot);
    (collisionManifest.plugins.find(({ name }) => name === "exa")!.source as { sha: string }).sha = "f".repeat(40);
    await stageOfficialMarketplaceObservation({
      root: collisionRoot,
      observedAt,
      inspectedCommit: "f".repeat(40),
      manifestBytes: manifestBytes(collisionManifest)
    });
    const pointerPath = join(collisionRoot, "research", "marketplaces", "official-marketplace-current.json");
    const claimsPath = join(collisionRoot, "manifests", "official-listing-capability-claims.yaml");
    const [pointerBefore, claimsBefore] = await Promise.all([
      readFile(pointerPath, "utf8"),
      readFile(claimsPath, "utf8")
    ]);
    await writeFile(
      join(
        collisionRoot,
        "research",
        "marketplaces",
        "official-marketplace-selections",
        `${approvedAt.replace(/[-:]/gu, "")}-${"f".repeat(12)}.json`
      ),
      "collision\n"
    );
    await expect(approveOfficialMarketplaceObservation({
      root: collisionRoot,
      approvedAt,
      approvedBy: "reviewer:test",
      reason: "collision must fail atomically"
    })).rejects.toThrow(/already exists|collision/i);
    expect(await readFile(pointerPath, "utf8")).toBe(pointerBefore);
    expect(await readFile(claimsPath, "utf8")).toBe(claimsBefore);
  });

  it("permits an explicit reviewed promotion but rejects automatic approval advancement", async () => {
    const root = await fixtureRoot();
    const manifest = await marketplaceManifest(root);
    manifest.plugins.find(({ name }) => name === "exa")!.description += " reviewed";
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: "f".repeat(40),
      manifestBytes: manifestBytes(manifest)
    });
    const pointerPath = join(root, "research", "marketplaces", "official-marketplace-current.json");
    const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as { selection: string; selectionSha256: string };
    const reviewRecord = JSON.parse(await readFile(join(root, "research", "marketplaces", pointer.selection), "utf8")) as {
      observedArtifact: string;
      observedArtifactSha256: string;
    };
    const protectedCandidates = loadOfficialMarketplaceSelection(root).protectedCandidateNames;

    const approvalPath = `official-marketplace-selections/${approvedAt.replace(/[-:]/gu, "")}-ffffffff.json`;
    const approval = {
      schemaVersion: 1,
      observedAt: approvedAt,
      state: "current",
      approvedArtifact: reviewRecord.observedArtifact,
      approvedArtifactSha256: reviewRecord.observedArtifactSha256,
      observedArtifact: reviewRecord.observedArtifact,
      observedArtifactSha256: reviewRecord.observedArtifactSha256,
      protectedCandidates,
      previousSelection: pointer.selection,
      previousSelectionSha256: pointer.selectionSha256,
      transition: "approval",
      approval: {
        approvedAt,
        approvedBy: "reviewer:test",
        reason: "selected listing changes reviewed"
      }
    };
    const approvalBytes = `${JSON.stringify(approval, null, 2)}\n`;
    await writeFile(join(root, "research", "marketplaces", approvalPath), approvalBytes);
    await writeFile(pointerPath, `${JSON.stringify({
      schemaVersion: 1,
      selection: approvalPath,
      selectionSha256: sha256(approvalBytes)
    }, null, 2)}\n`);
    expect(validateOfficialMarketplaceSelection(root).approvedArtifact.provenance.inspectedCommit).toBe("f".repeat(40));

    approval.observedAt = observedAt;
    approval.approval.approvedAt = observedAt;
    const nonMonotonicBytes = `${JSON.stringify(approval, null, 2)}\n`;
    await writeFile(join(root, "research", "marketplaces", approvalPath), nonMonotonicBytes);
    await writeFile(pointerPath, `${JSON.stringify({
      schemaVersion: 1,
      selection: approvalPath,
      selectionSha256: sha256(nonMonotonicBytes)
    }, null, 2)}\n`);
    expect(() => validateOfficialMarketplaceSelection(root)).toThrow(/observedAt.*increase|monotonic/i);

    approval.observedAt = approvedAt;
    approval.approval.approvedAt = approvedAt;
    approval.transition = "observation";
    approval.approval = null as never;
    const invalidBytes = `${JSON.stringify(approval, null, 2)}\n`;
    await writeFile(join(root, "research", "marketplaces", approvalPath), invalidBytes);
    await writeFile(pointerPath, `${JSON.stringify({
      schemaVersion: 1,
      selection: approvalPath,
      selectionSha256: sha256(invalidBytes)
    }, null, 2)}\n`);
    expect(() => validateOfficialMarketplaceSelection(root)).toThrow(/automatic|observation.*approved/i);
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "official-marketplace-refresh-"));
  temporaryRoots.push(root);
  await cp(join(projectRoot, "research", "marketplaces"), join(root, "research", "marketplaces"), { recursive: true });
  await mkdir(join(root, "manifests"), { recursive: true });
  await cp(
    join(projectRoot, "manifests", "official-listing-capability-claims.yaml"),
    join(root, "manifests", "official-listing-capability-claims.yaml")
  );
  return root;
}

async function marketplaceManifest(root: string): Promise<{
  inspectedCommit: string;
  plugins: Array<{ name: string; description: string; source: unknown }>;
}> {
  const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
  return {
    inspectedCommit: artifact.provenance.inspectedCommit,
    plugins: artifact.plugins.map(({ name, description, source }) => ({ name, description, source }))
  };
}

function manifestBytes(manifest: Awaited<ReturnType<typeof marketplaceManifest>>): Buffer {
  return Buffer.from(`${JSON.stringify({ plugins: manifest.plugins })}\n`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString().replace(".000Z", "Z");
}
