import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadOfficialMarketplaceSelection,
  validateOfficialMarketplaceSelection
} from "../../src/discovery/official-marketplace.js";
import { assertOfficialMarketplaceSelectionAppendOnly } from "../../scripts/research/assert-extension-append-only.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("official marketplace current selection", () => {
  it("loads the append-only selected artifact instead of a compile-time filename", () => {
    const selection = loadOfficialMarketplaceSelection(projectRoot);

    expect(selection.chain.length).toBeGreaterThanOrEqual(1);
    expect(selection.approvedArtifact.plugins.length).toBeGreaterThanOrEqual(272);
    expect(selection.observedArtifact.plugins.length).toBeGreaterThanOrEqual(272);
    expect(selection.state === "current").toBe(selection.selectedChanges.length === 0);
    expect(selection.state === "review-required").toBe(selection.selectedChanges.length > 0);
    expect(selection.observedArtifact.provenance.sourceUrl).toContain(
      selection.observedArtifact.provenance.inspectedCommit
    );
  });

  it("rejects a pointer digest mismatch and selected description drift labeled current", async () => {
    const root = await fixtureRoot();
    const pointerPath = join(root, "research", "marketplaces", "official-marketplace-current.json");
    const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as {
      selection: string;
      selectionSha256: string;
    };
    pointer.selectionSha256 = "f".repeat(64);
    await writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`);
    expect(() => validateOfficialMarketplaceSelection(root)).toThrow(/selection SHA-256 mismatch/i);

    const cleanRoot = await fixtureRoot();
    const cleanPointerPath = join(cleanRoot, "research", "marketplaces", "official-marketplace-current.json");
    const cleanPointer = JSON.parse(await readFile(cleanPointerPath, "utf8")) as {
      selection: string;
      selectionSha256: string;
    };
    const priorSelectionPath = join(cleanRoot, "research", "marketplaces", cleanPointer.selection);
    const priorSelection = JSON.parse(await readFile(priorSelectionPath, "utf8")) as {
      approvedArtifact: string;
      approvedArtifactSha256: string;
      observedArtifact: string;
      observedArtifactSha256: string;
    };
    const approvedArtifactPath = join(cleanRoot, "research", "marketplaces", priorSelection.observedArtifact);
    const artifact = JSON.parse(await readFile(approvedArtifactPath, "utf8")) as {
      provenance: { inspectedCommit: string; sourceUrl: string };
      plugins: Array<{ name: string; description: string }>;
    };
    artifact.provenance.inspectedCommit = "f".repeat(40);
    artifact.provenance.sourceUrl =
      `https://raw.githubusercontent.com/anthropics/claude-plugins-official/${"f".repeat(40)}/.claude-plugin/marketplace.json`;
    artifact.plugins.find(({ name }) => name === "exa")!.description += " drift";
    const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
    const observedArtifact = "claude-plugins-official-fffffff.json";
    const artifactPath = join(cleanRoot, "research", "marketplaces", observedArtifact);
    await writeFile(artifactPath, bytes);
    const cleanSelection = loadOfficialMarketplaceSelection(cleanRoot);
    const selection = {
      schemaVersion: 1,
      observedAt: new Date(
        Date.parse(cleanSelection.observedAt) + 86_400_000
      ).toISOString().replace(".000Z", "Z"),
      state: "current",
      approvedArtifact: priorSelection.approvedArtifact,
      approvedArtifactSha256: priorSelection.approvedArtifactSha256,
      observedArtifact,
      observedArtifactSha256: sha256(bytes),
      protectedCandidates: cleanSelection.protectedCandidateNames,
      previousSelection: cleanPointer.selection,
      previousSelectionSha256: cleanPointer.selectionSha256,
      transition: "observation",
      approval: null
    };
    const selectionBytes = `${JSON.stringify(selection, null, 2)}\n`;
    const selectionPath = join(
      cleanRoot,
      "research",
      "marketplaces",
      "official-marketplace-selections",
      "20260730T000000Z-fffffff.json"
    );
    await writeFile(selectionPath, selectionBytes);
    cleanPointer.selection = "official-marketplace-selections/20260730T000000Z-fffffff.json";
    cleanPointer.selectionSha256 = sha256(selectionBytes);
    await writeFile(cleanPointerPath, `${JSON.stringify(cleanPointer, null, 2)}\n`);

    expect(() => validateOfficialMarketplaceSelection(cleanRoot)).toThrow(/selected candidate.*current/i);
  });

  it("keeps issued artifacts and selection records byte-immutable", async () => {
    const root = await fixtureRoot();
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "Selection Test"]);
    git(root, ["config", "user.email", "selection@example.test"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "selection base"]);
    const base = git(root, ["rev-parse", "HEAD"]);
    const selection = join(
      root,
      "research",
      "marketplaces",
      "official-marketplace-selections",
      "20260729T000000Z-e3e378c.json"
    );
    await writeFile(selection, `${await readFile(selection, "utf8")} `);

    expect(() => assertOfficialMarketplaceSelectionAppendOnly(root, base)).toThrow(/issued official marketplace/i);
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "official-marketplace-selection-"));
  temporaryRoots.push(root);
  await cp(join(projectRoot, "research", "marketplaces"), join(root, "research", "marketplaces"), {
    recursive: true
  });
  await mkdir(join(root, "manifests"), { recursive: true });
  await cp(
    join(projectRoot, "manifests", "official-listing-capability-claims.yaml"),
    join(root, "manifests", "official-listing-capability-claims.yaml")
  );
  return root;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
