import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateAll, type GeneratedArtifacts } from "../../src/generate/all.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const verifierPath = join(projectRoot, "scripts", "verify-broker-only.ts");
const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
const temporaryRoots: string[] = [];
const artifacts = generateAll(projectRoot);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("broker-only verifier", () => {
  it("accepts the exact authenticated generated corpus", async () => {
    const root = await createRepository();

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("");
  });

  it.each([
    ["an added skill", async (root: string) => {
      const skill = join(root, "plugins", "shared-core", "skills", "unexpected", "SKILL.md");
      await mkdir(dirname(skill), { recursive: true });
      await writeFile(skill, "---\nname: unexpected\n---\n");
    }],
    ["a removed skill", async (root: string) => {
      await rm(join(root, "plugins", "shared-core", "skills", "workflow-router", "SKILL.md"));
    }],
    ["a renamed replacement skill", async (root: string) => {
      const source = join(root, "plugins", "shared-core", "skills", "workflow-router", "SKILL.md");
      const replacement = join(root, "plugins", "shared-core", "skills", "workflow-router-replacement", "SKILL.md");
      await mkdir(dirname(replacement), { recursive: true });
      await rename(source, replacement);
    }],
    ["a symlinked skill", async (root: string) => {
      const source = join(root, "plugins", "shared-core", "skills", "workflow-router", "SKILL.md");
      const target = join(root, "plugins", "shared-core", "skills", "workflow-router", "replacement.md");
      await rename(source, target);
      await symlink(target, source);
    }]
  ])("rejects %s against the exact local skill allowlist", async (_label, mutate) => {
    const root = await createRepository();
    await mutate(root);

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/SKILL\.md allowlist mismatch|symlinked local skill content/i);
  }, 15_000);

  it("rejects a recreated legacy foundation root", async () => {
    const root = await createRepository();
    const path = join(root, "manifests", "packs", "recreated.yaml");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "id: recreated\n");

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("manifests/packs must be absent or empty");
  });

  it.each(["directory", "symlink"] as const)(
    "rejects a retired-root .gitkeep %s replacement",
    async (kind) => {
      const root = await createRepository();
      const retiredRoot = join(root, "manifests", "packs");
      const sentinel = join(retiredRoot, ".gitkeep");
      await mkdir(retiredRoot);
      if (kind === "directory") {
        await mkdir(sentinel);
        await writeFile(join(sentinel, "recreated.yaml"), "id: recreated\n");
      } else {
        const target = join(root, "sentinel-target");
        await writeFile(target, "not a sentinel\n");
        await symlink(target, sentinel);
      }

      const result = await runVerifier(root);

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("manifests/packs must be absent or empty");
    }
  );

  it.each([
    ["repositoryUrl", "repositoryUrl: https://github.com/seunghyeon1004/claude-code-skillsets.git\n"],
    ["marketplaceSource", "marketplaceSource: https://github.com/seunghyeon1004/claude-code-skillsets/\n"],
    ["mixed-case repositoryUrl", "repositoryUrl: https://GitHub.com/Seunghyeon1004/Claude-Code-Skillsets.GIT/\n"],
    ["mixed-case marketplaceSource", "marketplaceSource: https://github.com/Seunghyeon1004/claude-code-skillsets.git/\n"]
  ])("rejects a provider %s that points to this repository", async (_field, contractField) => {
    const root = await createRepository();
    const path = join(root, "manifests", "complete-v1-providers", "self-reference.yaml");
    await rm(join(root, "manifests", "complete-v1-providers", ".gitkeep"));
    await writeFile(path, `id: self-reference\nruntimeContracts:\n  - ${contractField}`);

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("must not point to this repository");
  });

  it.each([
    ["retired field", "ownedSkillIds: []\n", /retired field ownedSkillIds/i],
    ["retired value", "migrationState: pending-p11\n", /retired value pending-p11/i]
  ])("rejects a %s in structured production data", async (_label, retiredYaml, expected) => {
    const root = await createRepository();
    const path = join(root, "manifests", "complete-v1-packs", "repository-to-implementation-plan.yaml");
    await writeFile(path, `${await readFile(path, "utf8")}${retiredYaml}`);

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(expected);
  });

  it("rejects a marketplace with more than the two broker plugins", async () => {
    const root = await createRepository();
    const path = join(root, ".claude-plugin", "marketplace.json");
    const marketplace = JSON.parse(await readFile(path, "utf8")) as {
      plugins: Array<Record<string, unknown>>;
    };
    marketplace.plugins.push({ name: "unexpected-plugin" });
    await writeFile(path, `${JSON.stringify(marketplace, null, 2)}\n`);

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("marketplace must contain exactly the two broker plugins");
  });

  it("requires byte-identical generated and manager decision indexes", async () => {
    const root = await createRepository();
    const path = join(root, "plugins", "skillset-manager", "data", "decision-index.json");
    await writeFile(path, `${await readFile(path, "utf8")}\n`);

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("generated and manager decision indexes differ byte-for-byte");
  });

  it("rejects an unapproved plugin executable surface", async () => {
    const root = await createRepository();
    const path = join(root, "plugins", "skillset-manager", "scripts", "unexpected.sh");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "#!/usr/bin/env sh\nexit 0\n");

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("plugin executable surface allowlist mismatch");
  });

  it("rejects vendored external source blobs in research evidence", async () => {
    const root = await createRepository();
    const path = join(root, "research", "evidence", "artifacts", "external", "source-blobs", "SKILL.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "---\nname: vendored-external-skill\n---\n");

    const result = await runVerifier(root);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("vendored external source blobs are not allowed");
  });
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "verify-broker-only-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "manifests"));
  await mkdir(join(root, "schemas"));
  await Promise.all([
    cp(join(projectRoot, "manifests", "plugins"), join(root, "manifests", "plugins"), { recursive: true }),
    cp(join(projectRoot, "manifests", "complete-v1-packs"), join(root, "manifests", "complete-v1-packs"), { recursive: true }),
    cp(join(projectRoot, "manifests", "complete-v1-providers"), join(root, "manifests", "complete-v1-providers"), { recursive: true }),
    cp(join(projectRoot, "manifests", "provider-selections"), join(root, "manifests", "provider-selections"), { recursive: true }),
    cp(join(projectRoot, "manifests", "source-reviews"), join(root, "manifests", "source-reviews"), { recursive: true }),
    cp(join(projectRoot, "manifests", "conflicts"), join(root, "manifests", "conflicts"), { recursive: true }),
    cp(join(projectRoot, "plugins"), join(root, "plugins"), { recursive: true }),
    cp(join(projectRoot, "schemas", "v2"), join(root, "schemas", "v2"), { recursive: true })
  ]);
  const generated = await artifacts;
  await writeGeneratedArtifacts(root, generated);
  return root;
}

async function writeGeneratedArtifacts(root: string, generated: GeneratedArtifacts): Promise<void> {
  await Promise.all([
    writeFileAt(root, ".claude-plugin/marketplace.json", generated.marketplace),
    writeFileAt(root, "generated/catalog.ko.md", generated.catalogKo),
    writeFileAt(root, "generated/catalog.en.md", generated.catalogEn),
    writeFileAt(root, "generated/install-index.json", generated.installIndex),
    writeFileAt(root, "plugins/skillset-manager/data/install-index.json", generated.installIndex),
    writeFileAt(root, "generated/decision-index.json", generated.decisionIndex),
    writeFileAt(root, "plugins/skillset-manager/data/decision-index.json", generated.decisionIndex)
  ]);
}

async function writeFileAt(root: string, relativePath: string, value: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

async function runVerifier(root: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(tsxPath, [verifierPath], { cwd: root });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({ exitCode: exitCode ?? -1, output });
    });
  });
}
