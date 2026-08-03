import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadYaml,
  validateExternalSource,
  validatePack,
  validatePlugin
} from "../../src/manifest/load.js";
import { loadBrokerManifestRepository, loadManifestRepository } from "../../src/manifest/repository.js";

const temporaryRoots: string[] = [];
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("manifest loader", () => {
  it("rejects duplicate YAML mapping keys instead of silently taking the last value", async () => {
    const root = await mkdtemp(join(tmpdir(), "duplicate-yaml-"));
    temporaryRoots.push(root);
    const path = join(root, "duplicate.yaml");
    await writeFile(path, "capabilityId: first\ncapabilityId: second\n");

    await expect(loadYaml(path)).rejects.toThrow(/map keys must be unique/i);
  });

  it("loads a valid pack", async () => {
    const value = await loadYaml("tests/fixtures/manifests/valid/pack.yaml");

    expect(validatePack(value).id).toBe("repository-to-implementation-plan");
  });

  it("reports the field path for invalid data", async () => {
    const value = await loadYaml("tests/fixtures/manifests/invalid/pack.yaml");

    expect(() => validatePack(value)).toThrow(/version.*semver/i);
  });

  it("rejects blocked as a pack minimum trust requirement", () => {
    expect(() => validatePack({
      ...pack("blocked-minimum"),
      trustRequirements: "blocked"
    })).toThrow(/trustRequirements.*allowed values|trustRequirements.*enum/i);
  });

  it.each([
    ["plugin ID", () => validatePlugin({ ...plugin("safe-plugin"), id: "safe;touch-pwned" })],
    ["dependency ID", () => validatePlugin({
      ...plugin("safe-plugin"),
      requiredDependencies: [dependency("dep$(touch-pwned)")]
    })],
    ["dependency marketplace", () => validatePlugin({
      ...plugin("safe-plugin"),
      requiredDependencies: [dependency("safe-dep", "market;touch-pwned")]
    })],
    ["executable", () => validatePack({
      ...pack("safe-pack"),
      requiredExecutables: ["git;touch-pwned"]
    })],
    ["external marketplace source", () => validateExternalSource({
      ...externalSource("safe-source"),
      marketplace: "safe-marketplace",
      marketplaceSource: "owner/repo;touch-pwned",
      version: "1.0.0",
      permissions: emptyPermissions(),
      requiredDependencies: []
    })]
  ])("rejects unsafe command-bearing %s at the schema boundary", (_label, validate) => {
    expect(validate).toThrow(/pattern|safe|invalid/i);
  });

  it("loads exactly the two local broker plugins in deterministic order", async () => {
    const repository = await loadBrokerManifestRepository(projectRoot);

    expect(repository.plugins.map(({ id }) => id)).toEqual(["shared-core", "skillset-manager"]);
  });

  it("rejects an additional local plugin rather than accepting a local purpose provider", async () => {
    const root = await createRepository();
    await writeManifest(root, "plugins/local-purpose.yaml", {
      ...plugin("local-purpose"),
      name: { ko: "로컬", en: "Local" },
      source: "./plugins/local-purpose",
      marketplace: "claude-code-skillsets",
      trustTier: "verified",
      permissions: emptyPermissions(),
      status: "beta"
    });

    await expect(loadBrokerManifestRepository(root)).rejects.toThrow(/exactly broker plugins/i);
  });

  it("rejects recreated legacy foundation records before loading the atomic view", async () => {
    const root = await mkdtemp(join(tmpdir(), "legacy-root-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "manifests", "packs"), { recursive: true });
    await writeFile(join(root, "manifests", "packs", "recreated.yaml"), "id: recreated\n");

    await expect(loadManifestRepository(root)).rejects.toThrow(/manifests\/packs: retired foundation root/i);
  });

  it.each(["directory", "symlink"] as const)(
    "rejects a retired-root .gitkeep %s replacement",
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), "legacy-sentinel-"));
      temporaryRoots.push(root);
      const retiredRoot = join(root, "manifests", "packs");
      const sentinel = join(retiredRoot, ".gitkeep");
      await mkdir(retiredRoot, { recursive: true });
      if (kind === "directory") {
        await mkdir(sentinel);
        await writeFile(join(sentinel, "recreated.yaml"), "id: recreated\n");
      } else {
        const target = join(root, "sentinel-target");
        await writeFile(target, "not a sentinel\n");
        await symlink(target, sentinel);
      }

      await expect(loadManifestRepository(root)).rejects.toThrow(
        /manifests\/packs: retired foundation root/i
      );
    }
  );
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "manifest-repository-"));
  temporaryRoots.push(root);
  await Promise.all(
    ["domains", "packs", "plugins", "external-sources"].map((directory) =>
      mkdir(join(root, "manifests", directory), { recursive: true })
    )
  );
  return root;
}

async function writeManifest(root: string, relativePath: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, "manifests", relativePath), toYaml(value));
}

function toYaml(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function domain(id: string): Record<string, unknown> {
  return {
    id,
    name: { ko: "도메인", en: "Domain" },
    description: { ko: "설명", en: "Description" },
    categories: ["planning"],
    languages: ["en"],
    regions: [],
    maintainers: ["maintainer"],
    version: "0.1.0",
    status: "draft"
  };
}

function pack(id: string): Record<string, unknown> {
  return {
    id,
    domain: "a-domain",
    categories: ["planning"],
    outcome: { ko: "결과", en: "Outcome" },
    targetUsers: [],
    whenToUse: [],
    whenNotToUse: [],
    inputs: ["input"],
    outputs: ["output"],
    workflow: [],
    requiredPlugins: [],
    recommendedPlugins: [],
    optionalPlugins: [],
    tools: [],
    languages: ["en"],
    regions: [],
    riskLevel: "standard",
    trustRequirements: "trusted",
    licenses: ["Apache-2.0"],
    evaluationCases: ["tests/evaluation.yaml"],
    maintainers: ["maintainer"],
    version: "0.1.0",
    status: "draft"
  };
}

function plugin(id: string): Record<string, unknown> {
  return {
    id,
    source: "./plugins/example",
    version: "0.1.0",
    status: "draft",
    requiredDependencies: [],
    recommendedDependencies: [],
    optionalDependencies: []
  };
}

function externalSource(id: string): Record<string, unknown> {
  return {
    id,
    name: { ko: "외부 소스", en: "External source" },
    homepage: "https://example.com",
    repository: "https://github.com/example/source",
    license: "Apache-2.0",
    trustTier: "trusted",
    status: "stable",
    marketplace: "external",
    marketplaceSource: "example/external-marketplace",
    version: "1.0.0",
    permissions: emptyPermissions(),
    requiredDependencies: [],
    updatePolicy: "compatible-patch",
    reviewedAt: "2026-07-22"
  };
}

function dependency(name: string, marketplace?: string): Record<string, unknown> {
  return {
    name,
    ...(marketplace === undefined ? {} : { marketplace }),
    version: "^1.0.0",
    reason: { ko: "의존성", en: "Dependency" }
  };
}

function emptyPermissions(): Record<string, string[]> {
  return { filesystem: [], commands: [], network: [], externalData: [] };
}
