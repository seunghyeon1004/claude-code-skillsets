import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("marketplace package readiness", () => {
  it("ships cache-local documentation, licenses, and third-party notices", async () => {
    const sharedCoreRoot = join(projectRoot, "plugins", "shared-core");
    const managerRoot = join(projectRoot, "plugins", "skillset-manager");
    const [sharedReadme, managerReadme, sharedLicense, managerLicense, notices] = await Promise.all([
      readFile(join(sharedCoreRoot, "README.md"), "utf8"),
      readFile(join(managerRoot, "README.md"), "utf8"),
      readFile(join(sharedCoreRoot, "LICENSE"), "utf8"),
      readFile(join(managerRoot, "LICENSE"), "utf8"),
      readFile(join(managerRoot, "THIRD_PARTY_NOTICES"), "utf8")
    ]);

    expect(sharedReadme).toContain("Shared Core / 공용 코어");
    expect(managerReadme).toContain("Skillset Manager / 스킬셋 관리자");
    expect(sharedLicense).toContain("Apache License");
    expect(managerLicense).toContain("Apache License");
    for (const dependency of [
      "ajv 8.20.0 - MIT",
      "fast-deep-equal 3.1.3 - MIT",
      "fast-uri 3.1.5 - BSD-3-Clause",
      "json-schema-traverse 1.0.0 - MIT",
      "semver 7.8.5 - ISC",
      "yaml 2.9.0 - ISC"
    ]) {
      expect(notices).toContain(dependency);
    }
  });

  it("documents a bare first-public dependency without requiring a release tag", async () => {
    const [managerManifest, sourceManifest, marketplace, managerReadme, releaseGuide] = await Promise.all([
      readFile(join(projectRoot, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"), "utf8"),
      readFile(join(projectRoot, "manifests", "plugins", "skillset-manager.yaml"), "utf8"),
      readFile(join(projectRoot, ".claude-plugin", "marketplace.json"), "utf8"),
      readFile(join(projectRoot, "plugins", "skillset-manager", "README.md"), "utf8"),
      readFile(join(projectRoot, "docs", "release", "github-free-staged-public.md"), "utf8")
    ]);
    const manifest = JSON.parse(managerManifest) as Record<string, unknown>;
    const listing = (JSON.parse(marketplace) as { plugins: Array<Record<string, unknown>> }).plugins
      .find(({ name }) => name === "skillset-manager");

    expect(manifest.dependencies).toEqual(["shared-core"]);
    expect(sourceManifest).toMatch(/requiredDependencies:\n\s+- name: shared-core\n/);
    expect(sourceManifest).not.toMatch(/requiredDependencies:[\s\S]*?version:/);
    expect(listing?.dependencies).toEqual([{ name: "shared-core" }]);
    expect(managerReadme).toContain("first installation must not require that tag");
    expect(releaseGuide).toMatch(/the first\s+installation must not require that tag/);
  });

  it("uses strict validation in CI, clean-copy, and local gates", async () => {
    const [workflow, cleanCopy, contributing] = await Promise.all([
      readFile(join(projectRoot, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(join(projectRoot, "tests", "e2e", "clean-copy.sh"), "utf8"),
      readFile(join(projectRoot, "CONTRIBUTING.md"), "utf8")
    ]);

    for (const content of [workflow, cleanCopy, contributing]) {
      expect(content).toContain("claude plugin validate . --strict");
      expect(content).toContain("claude plugin validate plugins/shared-core --strict");
      expect(content).toContain("claude plugin validate plugins/skillset-manager --strict");
    }
  });
});
