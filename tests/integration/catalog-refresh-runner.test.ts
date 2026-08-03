import { execFile, execFileSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inc } from "semver";
import { describe, expect, it, vi } from "vitest";
import { validateResearchSourceConfig } from "../../src/contracts/complete-v1.js";
import {
  loadOfficialMarketplaceSelection,
  validateOfficialMarketplaceSelection
} from "../../src/discovery/official-marketplace.js";
import type { ResearchSourceConfig } from "../../src/model/complete-v1.js";
import {
  runCatalogRefresh,
  type CommandRunner,
  type RefreshSourceAdapter
} from "../../scripts/research/refresh-catalog.js";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const observedAt = new Date(
  Date.parse(loadOfficialMarketplaceSelection(projectRoot).observedAt) + 86_400_000
).toISOString().replace(".000Z", "Z");

describe("catalog refresh runner", () => {
  it("collects all tracked sources, commits before gates, then writes a validated bundle", async () => {
    const harness = await createHarness({ reviewRequired: true });
    try {
      const initialManager = JSON.parse(await readFile(
        join(harness.root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
        "utf8"
      )) as { version: string };
      const expectedManagerVersion = inc(initialManager.version, "patch");
      expect(expectedManagerVersion).not.toBeNull();
      const result = await runCatalogRefresh(harness.input);

      expect(harness.collectedSourceIds).toEqual(harness.expectedSourceIds);
      expect(harness.collectedSourceIds).toHaveLength(15);
      expect(harness.collectedSourceIds).toContain("anthropic-plugins-official");
      expect(result.changedPaths).toContain("research/source-observations.json");
      expect(result.changedPaths).toContain("research/source-diffs.json");
      expect(result.changedPaths).toContain("research/materialized-review-state.json");
      expect(result.changedPaths).toContain("research/source-review-backlog.json");
      expect(result.changedPaths).toContain("generated/catalog.en.md");
      expect(result.changedPaths).toContain("generated/official-marketplace-index.json");
      expect(result.changedPaths).toContain("generated/decision-index.json");
      expect(result.changedPaths).toContain("plugins/skillset-manager/data/decision-index.json");
      expect(result.changedPaths).toContain("manifests/plugins/skillset-manager.yaml");
      expect(result.changedPaths).toContain("plugins/skillset-manager/.claude-plugin/plugin.json");
      expect(result.changedPaths).toContain(".claude-plugin/marketplace.json");
      expect(result.changedPaths.some((path) => path.startsWith("plugins/skillset-manager/data/decision-index-history/"))).toBe(true);
      expect(result.changedPaths.some((path) => path.startsWith("research/marketplaces/claude-plugins-official-e3e378cbbb"))).toBe(true);
      expect(result.changedPaths.some((path) => path.startsWith("research/marketplaces/official-marketplace-selections/"))).toBe(true);
      expect(result.changedPaths.filter((path) => path.startsWith("research/observation-evidence/"))).toHaveLength(15);
      expect(harness.events.filter((event) => event === "npm generate")).toHaveLength(2);

      const commit = indexOfEvent(harness.events, "git commit");
      const baseCheck = indexOfEvent(harness.events, "npm check");
      const candidateAnchor = indexOfEvent(harness.events, "bash require candidate anchor");
      const candidateAppendOnly = indexOfEvent(harness.events, "npm verify research candidate");
      const gates = indexOfEvent(harness.events, "npm research:materialize-decision -- --check");
      expect(harness.events).toContain("npm verify decision index history");
      expect(harness.events).toContain("npm verify official claims append only");
      expect(harness.events).toContain("npm check catalog refresh");
      expect(baseCheck).toBeLessThan(commit);
      expect(commit).toBeLessThan(candidateAnchor);
      expect(candidateAnchor).toBeLessThan(candidateAppendOnly);
      expect(candidateAppendOnly).toBeLessThan(gates);
      const bundle = indexOfEvent(harness.events, "git bundle");
      expect(gates).toBeLessThan(bundle);
      expect(harness.events).not.toContain("git push");
      expect(await readFile(join(harness.artifactDirectory, "base-sha"), "utf8")).toBe(`${harness.baseSha}\n`);
      expect(await readFile(join(harness.artifactDirectory, "candidate-sha"), "utf8")).toMatch(/^[0-9a-f]{40}\n$/u);
      expect(await readFile(join(harness.artifactDirectory, "branch"), "utf8")).toMatch(/^automation\/catalog-refresh-[0-9a-f]{8}-987654321\n$/u);
      await run("git", ["bundle", "verify", join(harness.artifactDirectory, "candidate.bundle")], harness.root);
      await run("git", ["fetch", join(harness.artifactDirectory, "candidate.bundle"), "HEAD:refs/catalog-refresh/test-candidate"], harness.root);
      expect(await git(harness.root, ["rev-parse", "refs/catalog-refresh/test-candidate"])).toBe(
        (await readFile(join(harness.artifactDirectory, "candidate-sha"), "utf8")).trim()
      );
      const previousRaw = await readFile(join(harness.root, "generated", "decision-index.json"), "utf8");
      const previousDigest = (JSON.parse(previousRaw) as { digest: string }).digest;
      expect(await git(harness.root, [
        "show", `refs/catalog-refresh/test-candidate:plugins/skillset-manager/data/decision-index-history/${previousDigest}.json`
      ])).toBe(previousRaw.trim());
      const managerManifest = JSON.parse(await git(harness.root, [
        "show", "refs/catalog-refresh/test-candidate:plugins/skillset-manager/.claude-plugin/plugin.json"
      ])) as { version: string };
      const marketplace = JSON.parse(await git(harness.root, [
        "show", "refs/catalog-refresh/test-candidate:.claude-plugin/marketplace.json"
      ])) as { plugins: Array<{ name: string; version: string }> };
      expect(managerManifest.version).toBe(expectedManagerVersion);
      expect(marketplace.plugins.find(({ name }) => name === "skillset-manager")?.version)
        .toBe(expectedManagerVersion);
      expect(await readdir(harness.stagingParent)).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it("takes an r01-anchored first refresh candidate through validation and PR preparation without minting a tag", async () => {
    const harness = await createHarness({ executeCandidateApprovalGates: true });
    try {
      const result = await runCatalogRefresh(harness.input);

      expect(result).toMatchObject({ changed: true });
      expect(result.changedPaths).toContain("manifests/official-listing-capability-claims.yaml");
      expect(harness.events).toContain("bash require candidate anchor");
      expect(harness.events).toContain("npm verify research candidate");
      expect(harness.approvedTagNames()).toEqual(["registry-approved/r01"]);
      expect(harness.events).toContain("git bundle");
      expect(harness.events.filter((event) => event === "npm check")).toHaveLength(2);
      expect(harness.events).not.toContain("npm check catalog refresh");
      await run("git", [
        "fetch", join(harness.artifactDirectory, "candidate.bundle"),
        "HEAD:refs/catalog-refresh/current-candidate"
      ], harness.root);
      expect(await git(harness.root, [
        "show", "refs/catalog-refresh/current-candidate:manifests/official-listing-capability-claims.yaml"
      ])).toContain(`observedAt: ${observedAt}`);
    } finally {
      await harness.cleanup();
    }
  }, 20_000);

  it("publishes nothing and removes staging when an observed source fails", async () => {
    const harness = await createHarness({ failSourceId: "anthropic-skills" });
    try {
      await expect(runCatalogRefresh(harness.input)).rejects.toThrow("anthropic-skills unavailable");

      expect(harness.events).not.toContain("git switch");
      expect(harness.events).not.toContain("git commit");
      expect(harness.events).not.toContain("git bundle");
      expect(await readdir(harness.stagingParent)).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it.each([
    ["tracked", "README.md"],
    ["untracked", "generated/catalog.debug.md"]
  ] as const)("rejects a %s generation output outside catalog selectors before commit", async (kind, path) => {
    const harness = await createHarness({ generationOutsideSelector: kind });
    try {
      await expect(runCatalogRefresh(harness.input)).rejects.toThrow(
        new RegExp(`outside catalog selectors.*${path.replaceAll(".", "\\.")}`, "i")
      );

      expect(harness.events).not.toContain("git switch");
      expect(harness.events).not.toContain("git commit");
      expect(harness.events).not.toContain("git bundle");
      expect(await readdir(harness.stagingParent)).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects a checkout that does not match the workflow base SHA", async () => {
    const harness = await createHarness({ wrongExpectedBaseSha: true });
    try {
      await expect(runCatalogRefresh(harness.input)).rejects.toThrow(/workflow base SHA/i);

      expect(harness.collectedSourceIds).toEqual([]);
      expect(harness.events).not.toContain("git bundle");
      expect(await readdir(harness.stagingParent)).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });
});

interface HarnessOptions {
  failSourceId?: string;
  wrongExpectedBaseSha?: boolean;
  executeCandidateApprovalGates?: boolean;
  reviewRequired?: boolean;
  generationOutsideSelector?: "tracked" | "untracked";
}

async function createHarness(options: HarnessOptions = {}): Promise<{
  input: Parameters<typeof runCatalogRefresh>[0];
  expectedSourceIds: string[];
  collectedSourceIds: string[];
  events: string[];
  root: string;
  baseSha: string;
  artifactDirectory: string;
  stagingParent: string;
  approvedTagNames(): string[];
  cleanup(): Promise<void>;
}> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "catalog-refresh-runner-"));
  const root = join(temporaryRoot, "repository");
  const stagingParent = join(temporaryRoot, "staging");
  const artifactDirectory = join(temporaryRoot, "artifact");
  await mkdir(stagingParent);
  await mkdir(artifactDirectory);
  await run("git", ["clone", "--quiet", "--no-hardlinks", "--local", "--no-tags", projectRoot, root], projectRoot);
  await run("git", ["config", "user.name", "Catalog Refresh Test"], root);
  await run("git", ["config", "user.email", "catalog-refresh@example.test"], root);
  for (const path of [
    "research/marketplaces/official-marketplace-current.json",
    "research/marketplaces/official-marketplace-selections/20260729T000000Z-e3e378c.json"
  ]) {
    await copyFile(join(projectRoot, path), join(root, path));
  }
  await run("git", ["add", "research/marketplaces"], root);
  if (await git(root, ["diff", "--cached", "--name-only"]) !== "") {
    await run("git", ["commit", "-q", "--signoff", "-m", "test: seed selection contract"], root);
  }
  expect(await git(root, ["tag", "--list", "registry-approved/*"])).toBe("");
  if (options.executeCandidateApprovalGates) {
    for (const path of [
      "scripts/research/assert-extension-append-only.ts",
      "scripts/research/require-registry-anchor-input.sh",
      "scripts/research/resolve-clean-copy-append-base.sh",
      "src/discovery/official-marketplace.ts"
    ]) {
      await copyFile(join(projectRoot, path), join(root, path));
    }
    await run("git", ["add", "scripts/research", "src/discovery/official-marketplace.ts"], root);
    if (await git(root, ["diff", "--cached", "--name-only"]) !== "") {
      await run("git", ["commit", "-q", "--signoff", "-m", "test: seed candidate governance"], root);
    }
  }
  await run("git", ["tag", "-a", "registry-approved/r01", "-m", "R01 root"], root);

  const baseSha = await git(root, ["rev-parse", "HEAD"]);
  const rootTagObject = await git(root, ["rev-parse", "registry-approved/r01"]);
  const expectedSourceIds = await sourceIds(root);
  const collectedSourceIds: string[] = [];
  const events: string[] = [];

  const commands: CommandRunner = {
    async command(file, args, cwd, env) {
      const label = `${file} ${args.join(" ")}`;
      if (file === "git" && args[0] === "bundle") events.push("git bundle");
      if (options.executeCandidateApprovalGates
        && ((file === "bash" && args[0]?.endsWith("require-registry-anchor-input.sh"))
          || (file === "npm" && args[0] === "run"
            && (args[1] === "verify:research-append-only"
              || args[1] === "verify:review-ledger-append-only"
              || args[1] === "verify:official-claims-append-only")))) {
        events.push(labelForGate(file, args));
        if (file === "npm" && args[1] === "verify:research-append-only") {
          expect(() => validateOfficialMarketplaceSelection(cwd)).not.toThrow();
        }
        return run(file, [...args], cwd, {
          ...env,
          REGISTRY_APPROVAL_ANCHORED: "anchored",
          APPROVED_REGISTRY_TAG_OBJECT: rootTagObject
        });
      }
      if (options.executeCandidateApprovalGates && file === "npm" && args[0] === "ci") {
        events.push(labelForGate(file, args));
        return run(file, [...args], cwd, env);
      }
      if (file === "git" && args[0] === "switch") events.push("git switch");
      if (file === "git" && args.includes("commit")) events.push("git commit");
      if (file === "npm" || file === "bash") {
        events.push(labelForGate(file, args));
        await materializeCommandOutput(file, args, cwd);
        if (file === "npm" && args[0] === "run" && args[1] === "generate") {
          if (options.generationOutsideSelector === "tracked") {
            await writeFile(join(cwd, "README.md"), "unexpected generated README change\n");
          } else if (options.generationOutsideSelector === "untracked") {
            await writeFile(join(cwd, "generated", "catalog.debug.md"), "unexpected generated file\n");
          }
        }
        return Buffer.alloc(0);
      }
      return run(file, [...args], cwd);
    }
  };
  const sources: RefreshSourceAdapter = {
    listTrackedSources: () => loadSources(root),
    async collect({ source, stagingRoot }) {
      collectedSourceIds.push(source.sourceId);
      if (source.sourceId === options.failSourceId) throw new Error(`${source.sourceId} unavailable`);
      const outputDirectory = join(stagingRoot, "research", "observation-evidence");
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(
        join(outputDirectory, `${source.sourceId}.json`),
        `${JSON.stringify(observationEvidence(source.sourceId))}\n`
      );
      if (source.sourceId === "anthropic-plugins-official") {
        const artifact = loadOfficialMarketplaceSelection(stagingRoot).approvedArtifact;
        const plugins = artifact.plugins.map(
          ({ name, description, source: pluginSource }) => ({ name, description, source: pluginSource })
        );
        if (options.reviewRequired) {
          plugins.find(({ name }) => name === "exa")!.description += " changed for review";
        }
        return {
          officialMarketplace: {
            inspectedCommit: artifact.provenance.inspectedCommit,
            manifestBytes: Buffer.from(`${JSON.stringify({ plugins })}\n`)
          }
        };
      }
    }
  };

  return {
    input: {
      root,
      observedAt,
      githubRunId: "987654321",
      stagingParent,
      artifactDirectory,
      expectedBaseSha: options.wrongExpectedBaseSha ? "f".repeat(40) : baseSha,
      commands,
      sources
    },
    expectedSourceIds,
    collectedSourceIds,
    events,
    root,
    baseSha,
    artifactDirectory,
    stagingParent,
    approvedTagNames: () => execFileSync("git", ["tag", "--list", "registry-approved/*"], {
      cwd: root,
      encoding: "utf8"
    }).trim().split("\n").filter(Boolean),
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true })
  };
}

async function materializeCommandOutput(file: string, args: readonly string[], root: string): Promise<void> {
  if (file !== "npm" || args[0] !== "run") return;
  switch (args[1]) {
    case "research:materialize-source-review-backlog":
      await writeFile(join(root, "research", "source-review-backlog.json"), "{\"refresh\":\"backlog\"}\n");
      return;
    case "research:materialize-decision":
      if (args.includes("--check")) return;
      await writeFile(join(root, "research", "source-observations.json"), "{\"refresh\":\"observations\"}\n");
      await writeFile(join(root, "research", "source-diffs.json"), "{\"refresh\":\"diffs\"}\n");
      await writeFile(join(root, "research", "materialized-review-state.json"), "{\"refresh\":\"state\"}\n");
      return;
    case "generate":
      await writeFile(join(root, "generated", "catalog.en.md"), "refresh catalog\n");
      await writeFile(join(root, "generated", "catalog.ko.md"), "refresh catalog\n");
      await writeFile(join(root, "generated", "official-marketplace-index.json"), "{\"refresh\":\"official\"}\n");
      await writeFile(join(root, "plugins", "skillset-manager", "data", "official-marketplace-index.json"), "{\"refresh\":\"official\"}\n");
      await writeFile(join(root, "generated", "install-index.json"), "{\"refresh\":\"install\"}\n");
      await writeFile(join(root, "plugins", "skillset-manager", "data", "install-index.json"), "{\"refresh\":\"install\"}\n");
      await writeFile(join(root, "generated", "decision-index.json"), `{\"digest\":\"${"b".repeat(64)}\",\"refresh\":true}\n`);
      await writeFile(join(root, "plugins", "skillset-manager", "data", "decision-index.json"), `{\"digest\":\"${"b".repeat(64)}\",\"refresh\":true}\n`);
      const manager = JSON.parse(await readFile(
        join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
        "utf8"
      )) as { version: string };
      const marketplace = JSON.parse(await readFile(join(root, ".claude-plugin", "marketplace.json"), "utf8")) as {
        plugins: Array<{ name: string; version: string }>;
      };
      marketplace.plugins.find(({ name }) => name === "skillset-manager")!.version = manager.version;
      await writeFile(join(root, ".claude-plugin", "marketplace.json"), `${JSON.stringify(marketplace, null, 2)}\n`);
  }
}

async function loadSources(root: string): Promise<ResearchSourceConfig[]> {
  const directory = join(root, "research", "sources");
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(filenames.map(async (filename) => validateResearchSourceConfig(JSON.parse(
    await readFile(join(directory, filename), "utf8")
  ) as unknown)));
}

async function sourceIds(root: string): Promise<string[]> {
  return (await loadSources(root)).map(({ sourceId }) => sourceId).sort();
}

async function git(root: string, args: string[]): Promise<string> {
  return (await run("git", args, root)).toString("utf8").trim();
}

async function run(
  file: string,
  args: string[],
  cwd: string,
  env?: Readonly<Record<string, string>>
): Promise<Buffer> {
  const { stdout } = await execFileAsync(file, args, {
    cwd,
    encoding: "buffer",
    env: env === undefined ? process.env : { ...process.env, ...env }
  });
  return Buffer.from(stdout);
}

function observationEvidence(id: string): unknown {
  const unknown = { status: "unknown", evidence: [] };
  return {
    schemaVersion: 3,
    id,
    sourceId: id,
    observedAt,
    inspectedCommit: "a".repeat(40),
    blobs: [],
    fields: {
      license: unknown,
      permissions: unknown,
      ownership: unknown,
      dependencies: unknown,
      executableSurface: unknown
    }
  };
}

function labelForGate(file: string, args: readonly string[]): string {
  if (file === "bash" && args[0]?.endsWith("require-registry-anchor-input.sh")) {
    return "bash require candidate anchor";
  }
  if (file === "npm" && args[0] === "run" && args[1] === "verify:research-append-only") {
    return "npm verify research candidate";
  }
  if (file === "npm" && args[0] === "run" && args[1] === "research:materialize-decision" && args.includes("--check")) {
    return "npm research:materialize-decision -- --check";
  }
  if (file === "npm" && args[0] === "run" && args[1] === "verify:decision-index-history") {
    return "npm verify decision index history";
  }
  if (file === "npm" && args[0] === "run" && args[1] === "verify:official-claims-append-only") {
    return "npm verify official claims append only";
  }
  if (file === "npm" && args[0] === "run" && args[1] === "generate") return "npm generate";
  if (file === "npm" && args[0] === "run" && args[1] === "check") return "npm check";
  if (file === "npm" && args[0] === "run" && args[1] === "check:catalog-refresh") {
    return "npm check catalog refresh";
  }
  return `${file} ${args.join(" ")}`;
}

function indexOfEvent(events: readonly string[], event: string): number {
  const index = events.indexOf(event);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}
