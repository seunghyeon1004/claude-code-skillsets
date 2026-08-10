import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertArtifactsCurrent, run, writeArtifacts } from "../../src/cli.js";
import {
  generateAll,
  validateRepositoryGraph,
  validateRepositoryReferences
} from "../../src/generate/all.js";
import { generateCatalogs } from "../../src/generate/catalog.js";
import { generateMarketplace } from "../../src/generate/marketplace.js";
import { loadManifestRepository } from "../../src/manifest/repository.js";
import type { AtomicManifestRepository, BrokerManifestRepository } from "../../src/manifest/repository.js";
import type { LocalPluginManifest } from "../../src/model/manifest.js";
import { canonicalize } from "../../src/research/canonical-json.js";
import { resolveTestTimeout } from "../../vitest.config.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = join(projectRoot, "src", "cli.ts");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("artifact generation", () => {
  it("is byte-identical across two runs", async () => {
    const first = await generateAll(projectRoot);
    const second = await generateAll(projectRoot);

    expect(second).toEqual(first);
  }, resolveTestTimeout(process.env.CI, 15_000));

  it("emits a bounded routing projection bound to the complete decision index", async () => {
    const result = await generateAll(projectRoot);
    const routingRaw = (result as typeof result & { routingIndex?: unknown }).routingIndex;

    expect(typeof routingRaw).toBe("string");
    if (typeof routingRaw !== "string") return;
    const routing = JSON.parse(routingRaw) as Record<string, unknown>;
    const decision = JSON.parse(result.decisionIndex) as Record<string, unknown>;
    const { digest, ...withoutDigest } = routing;

    expect(Object.keys(routing)).toEqual([
      "schemaVersion",
      "catalogVersion",
      "observedThrough",
      "catalogExpiresAt",
      "profiles",
      "decisionIndexDigest",
      "digest"
    ]);
    expect(routing).toMatchObject({
      schemaVersion: 1,
      catalogVersion: decision.catalogVersion,
      observedThrough: decision.observedThrough,
      catalogExpiresAt: decision.catalogExpiresAt,
      decisionIndexDigest: decision.digest,
      profiles: decision.profiles
    });
    expect(digest).toBe(createHash("sha256").update(canonicalize(withoutDigest)).digest("hex"));
    expect(Buffer.byteLength(routingRaw, "utf8")).toBeLessThanOrEqual(128 * 1024);
    expect(routingRaw.split("\n").length).toBeLessThanOrEqual(2_001);
    expect(routingRaw.endsWith("\n")).toBe(true);
    expect(routingRaw).not.toMatch(
      /"(?:candidates|candidateEvidence|intentFixtures|starterRoutes|claudeInstall|codexInstall)"/u
    );
  });

  it("emits Korean and English labels for research-pending packs", async () => {
    const result = await generateAll(projectRoot);

    expect(result.catalogKo).toContain("실제 저장소 근거와 명시된 요구사항을 사용해");
    expect(result.catalogEn).toContain("Produces an implementation plan from actual repository evidence");
  });

  it("explains that candidate eligibility does not make a route executable or authorize installation", async () => {
    const result = await generateAll(projectRoot);

    expect(result.catalogEn).toContain(
      "Source model: candidate eligibility is candidate-level evidence state. A route can remain discovery-only even when its candidates are eligible-with-disclosures; this catalog does not authorize installation."
    );
    expect(result.catalogKo).toContain(
      "소스 모델: 후보 적격성은 후보 단위 근거 상태입니다. 후보가 eligible-with-disclosures여도 경로는 발견 전용일 수 있으며, 이 카탈로그는 설치를 승인하지 않습니다."
    );
  });

  it("emits a deterministic bilingual official marketplace evidence index", async () => {
    const result = await generateAll(projectRoot);
    const index = JSON.parse(result.officialMarketplaceIndex) as {
      schemaVersion: number;
      marketplace: {
        id: string;
        source: string;
        inspectedCommit: string;
        manifestSha256: string;
        pluginCount: number;
        listingStatus: string;
        individualSafetyReview: string;
      };
      notices: Record<string, { ko: string; en: string }>;
      executionStatus: string;
      decisionAuthority: string;
      nextAction: string;
      domains: Array<{
        id: string;
        name: { ko: string; en: string };
        candidates: Array<{
          name: string;
          description: string;
          sourcePin: { kind: string; sha: string };
          permissions: string;
          license: string;
          trust: string;
          dependencies: string;
          reviewedVersionVerification: string;
          listingStatus: string;
          individualSafetyReview: string;
        }>;
      }>;
    };

    expect(index.schemaVersion).toBe(1);
    expect(index.marketplace).toEqual(expect.objectContaining({
      id: "claude-plugins-official",
      source: "anthropics/claude-plugins-official",
      inspectedCommit: "e3e378cbbb205673a5d7254ded32679cafa6179d",
      manifestSha256: "64b111d8c1716c062a285ed63eade42f56e2e79ac95859a994d586f573a20e5e",
      pluginCount: 272,
      listingStatus: "marketplace-listed",
      individualSafetyReview: "not-complete"
    }));
    expect(index.notices.listing?.ko).toBeTruthy();
    expect(index.notices.listing?.en).toBeTruthy();
    expect(index.notices.safety?.ko).toBeTruthy();
    expect(index.notices.safety?.en).toBeTruthy();
    expect(index.domains).toHaveLength(20);
    expect(index.executionStatus).toBe("not-executed");
    expect(index.decisionAuthority).toBe("none");
    expect(index.nextAction).toBe("use-decision-plan");
    expect(index.domains.every((domain) => domain.name.ko !== "" && domain.name.en !== "")).toBe(true);
    expect(index.domains.every((domain) => domain.candidates.length === 2)).toBe(true);
    for (const candidate of index.domains.flatMap(({ candidates }) => candidates)) {
      expect(candidate.description).not.toBe("");
      expect(candidate.listingStatus).toBe("marketplace-listed");
      expect(candidate.individualSafetyReview).toBe("not-complete");
      expect(candidate).toMatchObject({
        permissions: "unknown",
        license: "unknown",
        trust: "unknown",
        dependencies: "unknown",
        reviewedVersionVerification: "unavailable"
      });
      expect(["external-sha", "marketplace-commit"]).toContain(candidate.sourcePin.kind);
      expect(candidate.sourcePin.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(candidate).not.toHaveProperty("installCommand");
    }
    expect(result.officialMarketplaceIndex).not.toMatch(/claude plugin (?:marketplace add|install)/);
  });

  it("sorts broker plugin output and emits trailing newlines", async () => {
    const repository = await shuffledRepository();
    const marketplace = generateMarketplace(repository.broker);
    const catalogs = generateCatalogs(repository);
    const index = JSON.parse(catalogs.installIndex) as {
      domains: { id: string }[];
      profiles: unknown[];
      availability: unknown[];
      plugins: { id: string; requiredDependencies: { id: string }[] }[];
    };

    expect(marketplace.$schema).toBe("https://json.schemastore.org/claude-code-marketplace.json");
    expect(marketplace.plugins.map(({ name }) => name)).toEqual(["shared-core", "skillset-manager"]);
    expect(marketplace.plugins[0]).toMatchObject({
      displayName: "Shared Core",
      homepage: "https://github.com/seunghyeon1004/claude-code-skillsets#readme",
      category: "productivity",
      tags: ["broker"]
    });
    expect(marketplace.plugins[1]).toMatchObject({
      displayName: "Skillset Manager",
      homepage: "https://github.com/seunghyeon1004/claude-code-skillsets#readme",
      category: "productivity",
      dependencies: [{ name: "shared-core" }],
      tags: ["setup"]
    });
    expect(index.domains.map(({ id }) => id)).toEqual([...index.domains.map(({ id }) => id)].sort());
    expect(index.profiles).toEqual([]);
    expect(index.availability).toEqual([]);
    const sharedCore = index.plugins.find((plugin) => plugin.id === "shared-core");
    const manager = index.plugins.find((plugin) => plugin.id === "skillset-manager");
    expect(sharedCore?.requiredDependencies).toEqual([]);
    expect(manager?.requiredDependencies).toEqual([
      expect.objectContaining({ id: "shared-core" })
    ]);
    expect(catalogs.catalogKo.endsWith("\n")).toBe(true);
    expect(catalogs.catalogEn.endsWith("\n")).toBe(true);
    expect(catalogs.installIndex.endsWith("\n")).toBe(true);
  });

  it("requires the exact broker dependency graph", async () => {
    const broker = cloneBroker((await loadManifestRepository(projectRoot)).broker);
    const manager = broker.plugins.find((plugin) => plugin.id === "skillset-manager");
    if (manager === undefined) throw new Error("fixture lacks skillset-manager");
    manager.requiredDependencies = [];

    expect(() => validateRepositoryGraph(broker)).toThrow(
      "skillset-manager must require shared-core as its only broker dependency"
    );
  });

  it("rejects a broker graph with an extra local plugin", async () => {
    const broker = cloneBroker((await loadManifestRepository(projectRoot)).broker);
    broker.plugins.push({ ...broker.plugins[0]!, id: "additional-plugin", source: "./plugins/additional-plugin" });

    expect(() => validateRepositoryGraph(broker)).toThrow(
      "Broker graph must contain exactly shared-core and skillset-manager"
    );
  });

  it.each([
    ["missing source", "./plugins/does-not-exist", /does not exist/i],
    ["outside source", "../outside", /escapes the repository/i]
  ])("rejects a broker %s", async (_label, source, expectedError) => {
    const broker = cloneBroker((await loadManifestRepository(projectRoot)).broker);
    broker.plugins[0]!.source = source;

    await expect(validateRepositoryReferences(projectRoot, broker)).rejects.toThrow(expectedError);
  });

  it("rejects a broker plugin identity mismatch", async () => {
    const broker = cloneBroker((await loadManifestRepository(projectRoot)).broker);
    broker.plugins[0]!.version = "9.9.9";

    await expect(validateRepositoryReferences(projectRoot, broker)).rejects.toThrow(/plugin\.json identity mismatch/i);
  });

  it("rejects a broker plugin dependency declaration that differs from its source manifest", async () => {
    const root = await createRepository();
    const pluginJsonPath = join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json");
    const pluginJson = JSON.parse(await readFile(pluginJsonPath, "utf8")) as Record<string, unknown>;
    pluginJson.dependencies = [{ name: "shared-core", version: "^0.1.0" }];
    await writeFile(pluginJsonPath, `${JSON.stringify(pluginJson, null, 2)}\n`);
    const broker = (await loadManifestRepository(root)).broker;

    await expect(validateRepositoryReferences(root, broker)).rejects.toThrow(
      "Broker plugin skillset-manager plugin.json dependencies mismatch"
    );
  });

  it.each(["file", "symlink"] as const)("rejects a broker source that is a %s", async (kind) => {
    const root = await createRepository();
    const source = join(root, "plugins", "shared-core");
    await rm(source, { recursive: true, force: true });
    if (kind === "file") {
      await writeFile(source, "not a plugin directory\n");
    } else {
      const outside = await mkdtemp(join(tmpdir(), "outside-plugin-"));
      temporaryRoots.push(outside);
      await symlink(outside, source);
    }
    const broker = (await loadManifestRepository(root)).broker;

    await expect(validateRepositoryReferences(root, broker)).rejects.toThrow(
      kind === "file" ? /source is not a directory/i : /escapes the repository/i
    );
  });

  it("uses one broker publication policy for marketplace and install-index output", async () => {
    const repository = await shuffledRepository();
    const broker = cloneBroker(repository.broker);
    const sharedCore = broker.plugins.find((plugin) => plugin.id === "shared-core");
    if (sharedCore === undefined) throw new Error("fixture lacks shared-core");
    sharedCore.status = "draft";

    expect(() => generateMarketplace(broker)).toThrow(/exactly shared-core and skillset-manager/i);
    expect(() => generateCatalogs({ ...repository, broker })).toThrow(/exactly shared-core and skillset-manager/i);
  });
});

describe("generation CLI", () => {
  it("validates without writing and exits zero", async () => {
    const root = await createRepository();

    const result = await runCli(root, "validate");

    expect(result.exitCode).toBe(0);
    await expect(access(join(root, "generated"))).rejects.toThrow();
    await expect(access(join(root, ".claude-plugin"))).rejects.toThrow();
  });

  it("loads a seeded repository without protected P04 test fixtures", async () => {
    const root = await createRepository();

    await expect(access(join(root, "tests", "fixtures", "research", "p04-capability-universe.json"))).rejects.toThrow();
    await expect(loadManifestRepository(root)).resolves.toMatchObject({
      research: { providerSelections: [] }
    });
  });

  it("writes all eleven artifacts and keeps official, decision, and routing indexes byte-identical", async () => {
    const root = await createRepository();

    const result = await runCli(root, "generate");

    expect(result.exitCode).toBe(0);
    const outputs = await Promise.all([
      readFile(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
      readFile(join(root, "generated", "catalog.ko.md"), "utf8"),
      readFile(join(root, "generated", "catalog.en.md"), "utf8"),
      readFile(join(root, "generated", "install-index.json"), "utf8"),
      readFile(join(root, "plugins", "skillset-manager", "data", "install-index.json"), "utf8"),
      readFile(join(root, "generated", "official-marketplace-index.json"), "utf8"),
      readFile(join(root, "plugins", "skillset-manager", "data", "official-marketplace-index.json"), "utf8"),
      readFile(join(root, "generated", "decision-index.json"), "utf8"),
      readFile(join(root, "plugins", "skillset-manager", "data", "decision-index.json"), "utf8"),
      readFile(join(root, "generated", "routing-index.json"), "utf8"),
      readFile(join(root, "plugins", "skillset-manager", "data", "routing-index.json"), "utf8")
    ]);
    expect(outputs.every((output) => output.endsWith("\n"))).toBe(true);
    expect(outputs[5]).toBe(outputs[6]);
    expect(outputs[7]).toBe(outputs[8]);
    expect(outputs[9]).toBe(outputs[10]);
  });

  it.each([
    ["a malformed complete-v1 pack", async (root: string) => {
      const packPath = join(
        root,
        "manifests",
        "complete-v1-packs",
        "repository-to-implementation-plan.yaml"
      );
      const pack = await readFile(packPath, "utf8");
      await writeFile(packPath, pack.replace("routingProfileId: software-engineering", "routingProfileId: research-and-intelligence"));
    }, "routingProfileId must equal owner domain"],
    ["a recreated legacy foundation pack", async (root: string) => {
      await mkdir(join(root, "manifests", "packs"), { recursive: true });
      await writeFile(join(root, "manifests", "packs", "recreated.yaml"), "id: recreated\n");
    }, "manifests/packs: retired foundation root"],
    ["a recreated legacy migration", async (root: string) => {
      await mkdir(join(root, "manifests", "migrations"), { recursive: true });
      await writeFile(join(root, "manifests", "migrations", "recreated.yaml"), "schemaVersion: 1\n");
    }, "manifests/migrations: retired foundation root"],
    ["a malformed complete-v1 scenario", async (root: string) => {
      const scenarioPath = join(root, "tests", "evaluations", "packs", "repository-to-implementation-plan", "normal.yaml");
      await writeFile(scenarioPath, `${await readFile(scenarioPath, "utf8")}unexpected: true\n`);
    }, "Invalid complete-v1 scenario"],
    ["a scenario with a mismatched ID", async (root: string) => {
      const scenarioPath = join(root, "tests", "evaluations", "packs", "repository-to-implementation-plan", "normal.yaml");
      const scenario = await readFile(scenarioPath, "utf8");
      await writeFile(scenarioPath, scenario.replace("id: repository-to-implementation-plan-normal", "id: wrong-id"));
    }, "scenario id does not match pack reference repository-to-implementation-plan-normal"],
    ["a scenario with a mismatched pack ID", async (root: string) => {
      const scenarioPath = join(root, "tests", "evaluations", "packs", "repository-to-implementation-plan", "normal.yaml");
      const scenario = await readFile(scenarioPath, "utf8");
      await writeFile(scenarioPath, scenario.replace("packId: repository-to-implementation-plan", "packId: wrong-pack"));
    }, "scenario packId does not match pack repository-to-implementation-plan"],
    ["a scenario with a mismatched case type", async (root: string) => {
      const scenarioPath = join(root, "tests", "evaluations", "packs", "repository-to-implementation-plan", "normal.yaml");
      const scenario = await readFile(scenarioPath, "utf8");
      await writeFile(scenarioPath, scenario.replace("caseType: normal", "caseType: refusal"));
    }, "scenario caseType does not match pack reference normal"],
    ["an orphan complete-v1 scenario", async (root: string) => {
      const directory = join(root, "tests", "evaluations", "packs", "repository-to-implementation-plan");
      await cp(join(directory, "normal.yaml"), join(directory, "orphan.yaml"));
    }, "Orphan complete-v1 scenario file"],
    ["an orphan scenario at the inventory root", async (root: string) => {
      const directory = join(root, "tests", "evaluations", "packs", "repository-to-implementation-plan");
      await cp(join(directory, "normal.yaml"), join(root, "tests", "evaluations", "packs", "orphan.yaml"));
    }, "Orphan complete-v1 scenario file"],
    ["an orphan nested scenario", async (root: string) => {
      const directory = join(root, "tests", "evaluations", "packs", "repository-to-implementation-plan");
      const nestedDirectory = join(directory, "nested");
      await mkdir(nestedDirectory);
      await cp(join(directory, "normal.yaml"), join(nestedDirectory, "orphan.yaml"));
    }, "Orphan complete-v1 scenario file"]
  ])("rejects %s before validate or generate changes any artifact", async (_label, mutate, expectedError) => {
    const root = await createRepository();
    const targets = artifactPaths(root);
    const expectedOutputs = targets.map((_, index) => `existing artifact ${index}\n`);
    await Promise.all(targets.map(async (target, index) => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, expectedOutputs[index]!);
    }));
    await mutate(root);

    const validate = await runCli(root, "validate");
    const generate = await runCli(root, "generate");

    expect(validate.exitCode).toBe(1);
    expect(validate.stderr).toContain(expectedError);
    expect(generate.exitCode).toBe(1);
    expect(generate.stderr).toContain(expectedError);
    await expect(Promise.all(targets.map((target) => readFile(target, "utf8")))).resolves.toEqual(expectedOutputs);
  });

  it("reports scenario inventory I/O using only a repository-relative path", async () => {
    const root = await createRepository();
    await rm(join(root, "tests", "evaluations", "packs", "repository-to-implementation-plan"), {
      recursive: true,
      force: true
    });

    const result = await runCli(root, "validate");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "tests/evaluations/packs/repository-to-implementation-plan: Unable to read complete-v1 scenario inventory"
    );
    expect(result.stderr).not.toContain(root);
  });

  it("rolls back every artifact after the manager publication rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-rollback-"));
    temporaryRoots.push(root);
    const targets = artifactPaths(root);
    await mkdir(dirname(targets[0]), { recursive: true });
    await mkdir(dirname(targets[2]), { recursive: true });
    await writeFile(targets[0], "old marketplace\n");
    await writeFile(targets[2], "old English catalog\n");
    let injected = false;

    await expect(writeArtifacts(root, generatedArtifacts("new"), {
      rename: async (source, target) => {
        if (!injected && source.endsWith(".tmp") && target === targets[4]) {
          injected = true;
          throw new Error("injected publication failure");
        }
        await rename(source, target);
      }
    })).rejects.toThrow("injected publication failure");

    expect(injected).toBe(true);
    await expect(readFile(targets[0], "utf8")).resolves.toBe("old marketplace\n");
    await expect(access(targets[1])).rejects.toThrow();
    await expect(readFile(targets[2], "utf8")).resolves.toBe("old English catalog\n");
    await expect(access(targets[3])).rejects.toThrow();
    const remainingPaths = await readdir(root, { recursive: true });
    expect(remainingPaths.filter((path) => path.endsWith(".tmp") || path.endsWith(".bak"))).toEqual([]);
  });

  it("compares every generated publication target without writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-current-"));
    temporaryRoots.push(root);
    const artifacts = generatedArtifacts("current");
    await writeArtifacts(root, artifacts);

    await expect(assertArtifactsCurrent(root, artifacts)).resolves.toBeUndefined();
    await writeFile(join(root, "generated", "catalog.en.md"), "stale\n");
    await expect(assertArtifactsCurrent(root, artifacts)).rejects.toThrow(/generated\/catalog\.en\.md/i);
  });

  it("preserves committed artifacts and warns when backup deletion fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-cleanup-warning-"));
    temporaryRoots.push(root);
    const targets = artifactPaths(root);
    await Promise.all(targets.map(async (target, index) => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `old artifact ${index}\n`);
    }));
    const artifacts = generatedArtifacts("new");
    let preservedBackup: string | undefined;

    const result = await writeArtifacts(root, artifacts, {
      rm: async (path) => {
        if (preservedBackup === undefined && path.endsWith(".bak")) {
          preservedBackup = path;
          throw new Error("injected backup cleanup failure");
        }
        await rm(path, { force: true });
      }
    });

    expect(result.warnings).toEqual([{
      code: "backup-cleanup-failed",
      path: preservedBackup,
      reason: "injected backup cleanup failure"
    }]);
    await expect(readFile(targets[0], "utf8")).resolves.toBe(artifacts.marketplace);
    await expect(readFile(targets[1], "utf8")).resolves.toBe(artifacts.catalogKo);
    await expect(readFile(targets[2], "utf8")).resolves.toBe(artifacts.catalogEn);
    await expect(readFile(targets[3], "utf8")).resolves.toBe(artifacts.installIndex);
    await expect(readFile(preservedBackup!, "utf8")).resolves.toBe("old artifact 0\n");
    const remainingPaths = await readdir(root, { recursive: true });
    expect(remainingPaths.filter((path) => path.endsWith(".tmp"))).toEqual([]);
  });

  it("prints publication warnings but exits zero after successful publication", async () => {
    const stderr: string[] = [];
    const warning = {
      code: "backup-cleanup-failed" as const,
      path: "/tmp/preserved-marketplace.bak",
      reason: "permission denied"
    };

    const exitCode = await run("generate", "/unused", {
      generate: async () => generatedArtifacts("new"),
      publish: async () => ({ warnings: [warning] }),
      writeStderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([
      "Warning [backup-cleanup-failed]: preserved backup /tmp/preserved-marketplace.bak: permission denied"
    ]);
  });

  it("exits one on validation failure without writing", async () => {
    const root = await createRepository();
    await mkdir(join(root, "manifests", "packs"));
    await writeFile(join(root, "manifests", "packs", "invalid.yaml"), "id: invalid-pack\n");

    const result = await runCli(root, "generate");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("manifests/packs: retired foundation root");
    await expect(access(join(root, "generated"))).rejects.toThrow();
    await expect(access(join(root, ".claude-plugin"))).rejects.toThrow();
  });

  it("exits one with graph context for an unknown local dependency", async () => {
    const root = await createRepository();
    const repository = await loadManifestRepository(root);
    const manager = repository.broker.plugins.find((plugin) => plugin.id === "skillset-manager");
    if (manager === undefined) throw new Error("fixture lacks skillset-manager");
    const invalidManager: LocalPluginManifest = {
      ...manager,
      requiredDependencies: [{
        name: "missing-plugin",
        reason: { ko: "누락된 의존성", en: "Missing dependency" }
      }]
    };
    await writeFile(
      join(root, "manifests", "plugins", "skillset-manager.yaml"),
      `${JSON.stringify(invalidManager, null, 2)}\n`
    );

    const result = await runCli(root, "validate");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Unknown required dependency ID: missing-plugin (required by skillset-manager)"
    );
    await expect(access(join(root, "generated"))).rejects.toThrow();
    await expect(access(join(root, ".claude-plugin"))).rejects.toThrow();
  });

  it("exits two for an unknown command", async () => {
    const result = await runCli(projectRoot, "unsupported");

    expect(result.exitCode).toBe(2);
  });
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artifact-generation-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "manifests"));
  await Promise.all([
    cp(join(projectRoot, "manifests", "catalog.yaml"), join(root, "manifests", "catalog.yaml")),
    ...[
      "plugins",
      "complete-v1-domains",
      "categories",
      "capabilities",
      "complete-v1-packs",
      "complete-v1-providers",
      "provider-selections",
      "source-reviews",
      "conflicts"
    ].map((directory) => cp(
      join(projectRoot, "manifests", directory),
      join(root, "manifests", directory),
      { recursive: true }
    )),
    cp(join(projectRoot, "manifests", "decision-intents.yaml"), join(root, "manifests", "decision-intents.yaml")),
    cp(join(projectRoot, "manifests", "decision-candidate-evidence.yaml"), join(root, "manifests", "decision-candidate-evidence.yaml")),
    cp(join(projectRoot, "manifests", "decision-starter-routes.yaml"), join(root, "manifests", "decision-starter-routes.yaml")),
    cp(join(projectRoot, "manifests", "official-listing-capability-claims.yaml"), join(root, "manifests", "official-listing-capability-claims.yaml")),
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true }),
    cp(join(projectRoot, "plugins"), join(root, "plugins"), { recursive: true }),
    cp(join(projectRoot, "tests", "evaluations", "packs"), join(root, "tests", "evaluations", "packs"), { recursive: true })
  ]);
  return root;
}

async function runCli(root: string, command: string): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(projectRoot, "node_modules", ".bin", "tsx"), [cliPath, command], { cwd: root });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? -1, stderr });
    });
  });
}

function artifactPaths(root: string): [
  string, string, string, string, string, string, string, string, string, string, string
] {
  return [
    join(root, ".claude-plugin", "marketplace.json"),
    join(root, "generated", "catalog.ko.md"),
    join(root, "generated", "catalog.en.md"),
    join(root, "generated", "install-index.json"),
    join(root, "plugins", "skillset-manager", "data", "install-index.json"),
    join(root, "generated", "official-marketplace-index.json"),
    join(root, "plugins", "skillset-manager", "data", "official-marketplace-index.json"),
    join(root, "generated", "decision-index.json"),
    join(root, "plugins", "skillset-manager", "data", "decision-index.json"),
    join(root, "generated", "routing-index.json"),
    join(root, "plugins", "skillset-manager", "data", "routing-index.json")
  ];
}

function generatedArtifacts(prefix: string) {
  return {
    marketplace: `${prefix} marketplace\n`,
    catalogKo: `${prefix} Korean catalog\n`,
    catalogEn: `${prefix} English catalog\n`,
    installIndex: `${prefix} install index\n`,
    officialMarketplaceIndex: `${prefix} official marketplace index\n`,
    decisionIndex: `${prefix} decision index\n`,
    routingIndex: `${prefix} routing index\n`
  };
}

async function shuffledRepository(): Promise<AtomicManifestRepository> {
  const repository = await loadManifestRepository(projectRoot);
  return { ...repository, broker: { plugins: [...cloneBroker(repository.broker).plugins].reverse() } };
}

function cloneBroker(repository: BrokerManifestRepository): BrokerManifestRepository {
  return {
    plugins: repository.plugins.map(clonePlugin)
  };
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
    requiredDependencies: plugin.requiredDependencies.map(cloneDependency),
    recommendedDependencies: plugin.recommendedDependencies.map(cloneDependency),
    optionalDependencies: plugin.optionalDependencies.map(cloneDependency)
  };
}

function cloneDependency(dependency: LocalPluginManifest["requiredDependencies"][number]): LocalPluginManifest["requiredDependencies"][number] {
  return {
    ...dependency,
    reason: { ...dependency.reason }
  };
}
