import { describe, expect, it } from "vitest";
import type { ResearchSourceConfig } from "../../src/model/complete-v1.js";
import {
  classifyTree,
  classifyTreePath,
  independentCounts
} from "../../src/research/classify.js";

const config: ResearchSourceConfig = {
  schemaVersion: 2,
  sourceId: "fixture",
  repository: "https://github.com/example/fixture",
  queryUrls: ["https://github.com/example/fixture"],
  reportedCountClaims: [],
  markdownIndexPaths: ["README.md"]
};

describe("research tree classification", () => {
  it("classifies only skill files and Claude plugin manifests by tree path", () => {
    expect(classifyTreePath("skills/example/SKILL.md")).toBe("skill-file");
    expect(classifyTreePath("nested/.claude-plugin/plugin.json")).toBe("plugin-manifest");
    expect(classifyTreePath(".claude-plugin/plugin.json")).toBe("plugin-manifest");
    expect(classifyTreePath("skills/example/skill.md")).toBeUndefined();
    expect(classifyTreePath("plugin.json")).toBeUndefined();
  });

  it("creates canonical closed entries from listed marketplace and Markdown documents", () => {
    const entries = classifyTree(
      [
        "skills/example/SKILL.md",
        ".claude-plugin/marketplace.json",
        ".claude-plugin/plugin.json",
        "README.md"
      ],
      new Map([[".claude-plugin/marketplace.json", {
        plugins: [
          { source: "https://github.com/example/original.git" },
          { source: "git@github.com:example/not-allowed" }
        ]
      }]]),
      new Map([["README.md", "[original](https://github.com/example/readme-source). https://github.com/example/readme-source"]]),
      config
    );

    expect(entries).toEqual([
      { kind: "marketplace-entry", address: ".claude-plugin/marketplace.json#/plugins/0", sourceUrl: "https://github.com/example/original" },
      { kind: "marketplace-entry", address: ".claude-plugin/marketplace.json#/plugins/1", sourceUrl: null },
      { kind: "plugin-manifest", address: ".claude-plugin/plugin.json", sourceUrl: null },
      { kind: "repository-record", address: ".", sourceUrl: "https://github.com/example/fixture" },
      { kind: "repository-record", address: "README.md#link/0", sourceUrl: "https://github.com/example/readme-source" },
      { kind: "skill-file", address: "skills/example/SKILL.md", sourceUrl: null }
    ]);
    expect(independentCounts(entries, config)).toEqual([
      { kind: "marketplace-entry", reportedCount: null, reportedCountSourceUrl: null, independentlyCountedTotal: 2 },
      { kind: "plugin-manifest", reportedCount: null, reportedCountSourceUrl: null, independentlyCountedTotal: 1 },
      { kind: "repository-record", reportedCount: null, reportedCountSourceUrl: null, independentlyCountedTotal: 2 },
      { kind: "skill-file", reportedCount: null, reportedCountSourceUrl: null, independentlyCountedTotal: 1 }
    ]);
  });

  it("uses strict marketplace roots and path-aware Markdown repository discovery", () => {
    const entries = classifyTree(
      [".claude-plugin/marketplace.json", "README.md"],
      new Map([[".claude-plugin/marketplace.json", {
        plugins: [
          { source: "https://github.com/user-attachments/assets" },
          { source: "https://github.com/example/original.git/tree/main" },
          { source: "https://github.com/github/docs" },
          { source: "https://github.com/actions/checkout.git" },
          { source: "https://github.com/example/query?ref=main" },
          { source: "https://github.com/example/fragment#readme" }
        ]
      }]]),
      new Map([["README.md", [
        "[attachment](https://github.com/USER-ATTACHMENTS/Assets/tree/main)",
        "[github docs](https://github.com/github/docs/tree/main)",
        "[actions checkout](https://github.com/actions/checkout/blob/main/action.yml)",
        "[original](https://github.com/example/readme-source/tree/main)"
      ].join("\n")]]),
      config
    );

    expect(entries).toEqual([
      { kind: "marketplace-entry", address: ".claude-plugin/marketplace.json#/plugins/0", sourceUrl: null },
      { kind: "marketplace-entry", address: ".claude-plugin/marketplace.json#/plugins/1", sourceUrl: null },
      { kind: "marketplace-entry", address: ".claude-plugin/marketplace.json#/plugins/2", sourceUrl: "https://github.com/github/docs" },
      { kind: "marketplace-entry", address: ".claude-plugin/marketplace.json#/plugins/3", sourceUrl: "https://github.com/actions/checkout" },
      { kind: "marketplace-entry", address: ".claude-plugin/marketplace.json#/plugins/4", sourceUrl: null },
      { kind: "marketplace-entry", address: ".claude-plugin/marketplace.json#/plugins/5", sourceUrl: null },
      { kind: "repository-record", address: ".", sourceUrl: "https://github.com/example/fixture" },
      { kind: "repository-record", address: "README.md#link/0", sourceUrl: "https://github.com/github/docs" },
      { kind: "repository-record", address: "README.md#link/1", sourceUrl: "https://github.com/actions/checkout" },
      { kind: "repository-record", address: "README.md#link/2", sourceUrl: "https://github.com/example/readme-source" }
    ]);
  });

  it("fails closed when a marketplace document is not a closed plugins object", () => {
    expect(() => classifyTree(
      [".claude-plugin/marketplace.json"],
      new Map([[".claude-plugin/marketplace.json", { plugins: [{ id: "missing-source" }] }]]),
      new Map(),
      config
    )).toThrow(/source is required/);
  });
});
