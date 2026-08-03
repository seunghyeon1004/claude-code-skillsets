import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  exactEnabledPluginVersion,
  parseClaudeMarketplaceList21198,
  parseClaudePluginList21198
} from "../../src/runtime/claude-2-1-198.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureRoot = join(projectRoot, "tests", "fixtures", "claude-2-1-198");

describe("Claude Code 2.1.198 runtime adapters", () => {
  it("keeps an exact official github identity when an unrelated git marketplace is present", async () => {
    const rows = parseClaudeMarketplaceList21198(await readFile(
      join(fixtureRoot, "marketplace-list-mixed.json"),
      "utf8"
    ));

    expect(rows).toContainEqual({
      id: "claude-plugins-official",
      source: "anthropics/claude-plugins-official"
    });
  });

  it("uses enabled as installed-state evidence and does not invent load status or semver", async () => {
    const rows = parseClaudePluginList21198(await readFile(
      join(fixtureRoot, "plugin-list.json"),
      "utf8"
    ));

    expect(exactEnabledPluginVersion(rows, {
      pluginName: "versioned-plugin",
      marketplaceId: "claude-plugins-official",
      scope: "user"
    })).toEqual({ version: "3.3.8", versionStatus: "observed-semver" });
    expect(exactEnabledPluginVersion(rows, {
      pluginName: "unversioned-plugin",
      marketplaceId: "claude-plugins-official",
      scope: "user"
    })).toEqual({ version: null, versionStatus: "unknown" });
    expect(exactEnabledPluginVersion(rows, {
      pluginName: "opaque-version-plugin",
      marketplaceId: "claude-plugins-official",
      scope: "user"
    })).toEqual({ version: null, versionStatus: "unknown" });
    expect(exactEnabledPluginVersion(rows, {
      pluginName: "disabled-plugin",
      marketplaceId: "claude-plugins-official",
      scope: "user"
    })).toBeNull();
  });

  it("rejects an empty or control-character version field", () => {
    for (const version of ["", "unknown\nforged"]) {
      expect(() => parseClaudePluginList21198(JSON.stringify([{
        id: "plugin@claude-plugins-official",
        version,
        scope: "user",
        enabled: true
      }]))).toThrow(/invalid plugin list entry/i);
    }
  });
});
