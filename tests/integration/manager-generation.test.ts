import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveTestTimeout } from "../../vitest.config.js";
import { generateAll, validateRepositoryGraph } from "../../src/generate/all.js";
import { generateCatalogs } from "../../src/generate/catalog.js";
import { planInstall, type InstallIndex } from "../../src/installer/plan.js";
import { loadManifestRepository } from "../../src/manifest/repository.js";
import type { AtomicManifestRepository, BrokerManifestRepository } from "../../src/manifest/repository.js";
import type { LocalPluginManifest } from "../../src/model/manifest.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const generatedIndexPath = join(projectRoot, "generated", "install-index.json");
const managerIndexPath = join(
  projectRoot,
  "plugins",
  "skillset-manager",
  "data",
  "install-index.json"
);
const generatedDecisionIndexPath = join(projectRoot, "generated", "decision-index.json");
const managerDecisionIndexPath = join(projectRoot, "plugins", "skillset-manager", "data", "decision-index.json");

interface RuntimeIndex {
  schemaVersion: 1;
  indexFingerprint: string;
  marketplace: { id: string; source: string };
  domains: Array<{
    id: string;
    name: { ko: string; en: string };
    description: { ko: string; en: string };
    purposeIds: string[];
    profileIds: string[];
  }>;
  profiles: Array<{
    id: string;
    labels: { ko: string; en: string };
    domainIds: string[];
    purposeIds: string[];
    toolIds: string[];
    requiredPlugins: string[];
    recommendedPlugins: string[];
    optionalPlugins: string[];
    executables: Array<{ name: string; impact: "required" | "optional" }>;
    version: string;
    status: "beta" | "stable";
  }>;
  availability: unknown[];
  researchPendingPacks: Array<{ id: string; state: "research-pending" }>;
  executables: string[];
  plugins: Array<{
    id: string;
    name: { ko: string; en: string };
    version: string;
    source: string;
    marketplace: string;
    trustTier: "verified" | "trusted" | "community" | "blocked";
    permissions: {
      filesystem: string[];
      commands: string[];
      network: string[];
      externalData: string[];
    };
    requiredDependencies: Array<{ id: string; marketplace: string; version?: string }>;
    installCommand: string;
  }>;
}

describe("manager runtime generation", () => {
  it("publishes byte-identical install and decision indexes to generated and manager data", async () => {
    const artifacts = await generateAll(projectRoot);
    const [generated, manager] = await Promise.all([
      readFile(generatedIndexPath, "utf8"),
      readFile(managerIndexPath, "utf8")
    ]);

    expect(generated).toBe(artifacts.installIndex);
    expect(manager).toBe(artifacts.installIndex);
    expect(manager).toBe(generated);
    expect((await generateAll(projectRoot)).installIndex).toBe(artifacts.installIndex);
    const [generatedDecision, managerDecision] = await Promise.all([
      readFile(generatedDecisionIndexPath, "utf8"),
      readFile(managerDecisionIndexPath, "utf8")
    ]);
    expect(generatedDecision).toBe(artifacts.decisionIndex);
    expect(managerDecision).toBe(artifacts.decisionIndex);
    expect(managerDecision).toBe(generatedDecision);
  }, resolveTestTimeout(process.env.CI, 15_000));

  it("contains every complete-v1 pack only as research-pending metadata", async () => {
    const repository = await loadManifestRepository(projectRoot);
    const index = JSON.parse((await generateAll(projectRoot)).installIndex) as RuntimeIndex;

    expect(index.profiles).toEqual([]);
    expect(index.availability).toEqual([]);
    expect(index.researchPendingPacks.map(({ id }) => id)).toEqual(
      repository.completeV1.packs.map(({ id }) => id).sort()
    );
  }, 15_000);

  it("emits the complete localized runtime contract and excludes maintainer-only data", async () => {
    const index = JSON.parse((await generateAll(projectRoot)).installIndex) as RuntimeIndex;

    expect(index.schemaVersion).toBe(1);
    expect(index.indexFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(index).not.toHaveProperty("state");
    expect(index.marketplace).toEqual({
      id: "claude-code-skillsets",
      source: "seunghyeon1004/claude-code-skillsets"
    });
    expect(index.domains.length).toBeGreaterThan(0);
    expect(index.profiles).toEqual([]);
    expect(index.availability).toEqual([]);
    expect(index.researchPendingPacks).toHaveLength(40);
    expect(index.plugins.map(({ id }) => id)).toEqual(["shared-core", "skillset-manager"]);

    for (const domain of index.domains) {
      expectLocalized(domain.name);
      expectLocalized(domain.description);
      expect(domain.purposeIds.length).toBeGreaterThan(0);
      expect(domain.profileIds).toEqual([]);
    }
    for (const plugin of index.plugins) {
      expectLocalized(plugin.name);
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(plugin.source.trim()).not.toBe("");
      expect(plugin.marketplace.trim()).not.toBe("");
      expect(plugin.trustTier).toBe("verified");
      expect(Object.keys(plugin.permissions).sort()).toEqual([
        "commands",
        "externalData",
        "filesystem",
        "network"
      ]);
      expect(plugin.installCommand).toBe(
        `claude plugin install ${plugin.id}@${plugin.marketplace} --scope user`
      );
    }

    const serialized = JSON.stringify(index);
    for (const forbidden of [
      "evaluationCases",
      "maintainers",
      "whenToUse",
      "whenNotToUse",
      "workflow",
      "reviewedAt",
      "updatePolicy"
    ]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
    expect(serialized).not.toMatch(/manifests\/(?:domains|packs|plugins|external-sources)\//);
  });

  it("emits no external provider runtime route", async () => {
    const index = JSON.parse((await generateAll(projectRoot)).installIndex) as RuntimeIndex;

    expect(index.plugins).toHaveLength(2);
    expect(index.plugins.every((plugin) => plugin.marketplace === "claude-code-skillsets")).toBe(true);
    expect(index.plugins.every((plugin) => plugin.source.startsWith("./plugins/"))).toBe(true);
    expect(JSON.stringify(index)).not.toMatch(/marketplaceSource|marketplaceAddCommand|verificationCommand/);
  });

  it("feeds the generated broker contract directly to the dependency-first planner", async () => {
    const index = JSON.parse((await generateAll(projectRoot)).installIndex) as InstallIndex;
    const plan = planInstall({
      domains: ["software-engineering"],
      purposes: ["planning"],
      tools: ["git"],
      level: "essential",
      optionalPlugins: []
    }, index);

    expect(plan.required).toEqual(["shared-core", "skillset-manager"]);
    expect(plan.commands).toEqual([
      "claude plugin install shared-core@claude-code-skillsets --scope user",
      "claude plugin install skillset-manager@claude-code-skillsets --scope user"
    ]);
  });

  it("rejects a local broker plugin assigned to a non-root marketplace", async () => {
    const repository = await repositoryWithBroker((broker) => {
      const sharedCore = broker.plugins.find((plugin) => plugin.id === "shared-core");
      if (sharedCore === undefined) throw new Error("fixture lacks shared-core");
      sharedCore.marketplace = "other-marketplace";
    });

    expect(() => generateCatalogs(repository)).toThrow(
      /Broker plugin shared-core declares marketplace other-marketplace; expected claude-code-skillsets/i
    );
  });

  it("rejects a dependency marketplace that differs from the broker marketplace", async () => {
    const repository = await repositoryWithBroker((broker) => {
      const manager = broker.plugins.find((plugin) => plugin.id === "skillset-manager");
      if (manager === undefined) throw new Error("fixture lacks skillset-manager");
      manager.requiredDependencies[0]!.marketplace = "wrong-marketplace";
    });

    expect(() => validateRepositoryGraph(repository.broker)).toThrow(
      "skillset-manager dependency shared-core must resolve from claude-code-skillsets"
    );
  });

  it.each([
    ["plugin ID", (broker: BrokerManifestRepository) => {
      broker.plugins[0]!.id = "shared-core;touch-pwned";
    }],
    ["dependency ID", (broker: BrokerManifestRepository) => {
      const manager = broker.plugins.find((plugin) => plugin.id === "skillset-manager");
      if (manager === undefined) throw new Error("fixture lacks skillset-manager");
      manager.requiredDependencies[0]!.name = "shared-core$(touch-pwned)";
    }],
    ["dependency marketplace", (broker: BrokerManifestRepository) => {
      const manager = broker.plugins.find((plugin) => plugin.id === "skillset-manager");
      if (manager === undefined) throw new Error("fixture lacks skillset-manager");
      manager.requiredDependencies[0]!.marketplace = "safe;touch-pwned";
    }]
  ])("rejects unsafe broker %s when typed objects bypass manifest loading", async (_label, mutate) => {
    const repository = await repositoryWithBroker(mutate);

    expect(() => generateCatalogs(repository)).toThrow(/unsafe/i);
  });
});

function expectLocalized(value: { ko: string; en: string }): void {
  expect(value.ko.trim()).not.toBe("");
  expect(value.en.trim()).not.toBe("");
}

async function repositoryWithBroker(
  mutate: (broker: BrokerManifestRepository) => void
): Promise<AtomicManifestRepository> {
  const repository = await loadManifestRepository(projectRoot);
  const broker = {
    plugins: repository.broker.plugins.map(clonePlugin)
  };
  mutate(broker);
  return { ...repository, broker };
}

function clonePlugin(plugin: LocalPluginManifest): LocalPluginManifest {
  return {
    ...plugin,
    ...(plugin.name === undefined ? {} : { name: { ...plugin.name } }),
    ...(plugin.permissions === undefined ? {} : {
      permissions: {
        filesystem: [...plugin.permissions.filesystem],
        commands: [...plugin.permissions.commands],
        network: [...plugin.permissions.network],
        externalData: [...plugin.permissions.externalData]
      }
    }),
    requiredDependencies: plugin.requiredDependencies.map((dependency) => ({
      ...dependency,
      reason: { ...dependency.reason }
    })),
    recommendedDependencies: plugin.recommendedDependencies.map((dependency) => ({
      ...dependency,
      reason: { ...dependency.reason }
    })),
    optionalDependencies: plugin.optionalDependencies.map((dependency) => ({
      ...dependency,
      reason: { ...dependency.reason }
    }))
  };
}
