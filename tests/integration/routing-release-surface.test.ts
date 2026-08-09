import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const projectRoot = process.cwd();

describe("routing repair release surface", () => {
  it("bundles the routing contract into the installed manager runtime", async () => {
    const buildScript = await readFile(
      join(projectRoot, "scripts", "build-skillset-manager-runtime.ts"),
      "utf8"
    );

    expect(buildScript).toContain("routing-index.schema.json");
    expect(buildScript).toContain("decisionRoutingIndexSchema");
    expect(buildScript).toContain(
      'const decisionRoutingIndexSchema = require("../../schemas/v3/routing-index.schema.json") as object;'
    );
  });

  it("publishes the manager routing repair as version 0.1.3 on every generated surface", async () => {
    const [manifestRaw, pluginRaw, marketplaceRaw, installIndexRaw] = await Promise.all([
      readFile(join(projectRoot, "manifests", "plugins", "skillset-manager.yaml"), "utf8"),
      readFile(join(projectRoot, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"), "utf8"),
      readFile(join(projectRoot, ".claude-plugin", "marketplace.json"), "utf8"),
      readFile(join(projectRoot, "generated", "install-index.json"), "utf8")
    ]);
    const manifest = YAML.parse(manifestRaw) as { version: string };
    const plugin = JSON.parse(pluginRaw) as { version: string };
    const marketplace = JSON.parse(marketplaceRaw) as {
      plugins: Array<{ name: string; version: string }>;
    };
    const installIndex = JSON.parse(installIndexRaw) as {
      plugins: Array<{ id: string; version: string }>;
    };

    expect(manifest.version).toBe("0.1.3");
    expect(plugin.version).toBe("0.1.3");
    expect(marketplace.plugins.find(({ name }) => name === "skillset-manager")?.version).toBe("0.1.3");
    expect(installIndex.plugins.find(({ id }) => id === "skillset-manager")?.version).toBe("0.1.3");
  });

  it("keeps both routing copies in the generated drift gate", async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const command = packageJson.scripts["check:generated"] ?? "";

    expect(command).toContain("generated/routing-index.json");
    expect(command).toContain("plugins/skillset-manager/data/routing-index.json");
  });
});
