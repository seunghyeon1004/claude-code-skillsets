import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("catalog refresh check contract", () => {
  it("runs the full base check and narrowly excludes only public-current snapshot suites for a review hold", async () => {
    const [packageJson, config, runner, refreshCore, cleanCopy] = await Promise.all([
      readFile(join(projectRoot, "package.json"), "utf8"),
      readFile(join(projectRoot, "vitest.catalog-refresh.config.ts"), "utf8"),
      readFile(join(projectRoot, "scripts", "research", "refresh-catalog.ts"), "utf8"),
      readFile(join(projectRoot, "src", "research", "refresh.ts"), "utf8"),
      readFile(join(projectRoot, "tests", "e2e", "clean-copy.sh"), "utf8")
    ]);
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;
    const excludedSuites = [...config.matchAll(/"(tests\/(?:integration|unit)\/[^"*]+\.test\.ts)"/gu)]
      .map((match) => match[1]!);

    expect(excludedSuites).toHaveLength(19);
    expect(new Set(excludedSuites).size).toBe(excludedSuites.length);
    const excludeBlock = config.slice(
      config.indexOf("const publicCurrentSnapshotSuites"),
      config.indexOf("] as const;")
    );
    expect(excludeBlock).not.toMatch(/tests\/\*\*|tests\/(?:integration|unit)\/\*/u);
    expect(scripts.test).toBe("vitest run");
    expect(scripts["test:catalog-refresh"]).toContain("vitest.catalog-refresh.config.ts");
    expect(scripts["check:catalog-refresh"]).toBe(
      "npm run typecheck && npm run test:catalog-refresh && npm run validate && npm run check:generated"
    );
    expect(runner).toContain('prepareStaging: async (stagingRoot) =>');
    expect(runner).toContain('input.commands.command("npm", ["run", "check"], stagingRoot)');
    expect(refreshCore.indexOf("prepareStaging(stagingRoot)")).toBeLessThan(
      refreshCore.indexOf("for (const source of input.sources)")
    );
    expect(runner).toContain('loadOfficialMarketplaceSelection(stagingRoot).state === "review-required"');
    expect(runner).toContain('reviewRequired ? "check:catalog-refresh" : "check"');
    expect(cleanCopy).toContain('[[ "${CATALOG_REFRESH_CANDIDATE:-false}" = true ]]');
    expect(cleanCopy).toContain("npm run check:catalog-refresh");
    expect(cleanCopy).toContain("npm run check");
    expect(runner).toContain('"verify:official-claims-append-only"');
    expect(cleanCopy).toContain("npm run verify:official-claims-append-only");
  });
});
