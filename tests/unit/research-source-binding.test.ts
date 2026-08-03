import { describe, expect, it } from "vitest";
import type { ResearchSnapshot } from "../../src/model/complete-v1.js";
import { snapshotAttestsPath } from "../../src/research/source-binding.js";

function snapshot(entries: ResearchSnapshot["entries"]): ResearchSnapshot {
  return {
    id: "snapshot-a",
    sourceUrl: "https://github.com/acme/catalog",
    entries
  } as ResearchSnapshot;
}

describe("snapshotAttestsPath", () => {
  it("accepts an eligible selected file and its canonical parent directory", () => {
    const value = snapshot([
      { kind: "skill-file", address: "skills/catalog/SKILL.md", sourceUrl: null },
      { kind: "plugin-manifest", address: "plugins/catalog/.claude-plugin/plugin.json", sourceUrl: null }
    ]);

    expect(snapshotAttestsPath(value, "skills/catalog/SKILL.md")).toBe(true);
    expect(snapshotAttestsPath(value, "skills/catalog")).toBe(true);
    expect(snapshotAttestsPath(value, "plugins/catalog")).toBe(true);
  });

  it("rejects repository and marketplace records as path attestation", () => {
    const value = snapshot([
      { kind: "repository-record", address: "skills/catalog/SKILL.md", sourceUrl: "https://github.com/acme/catalog" },
      { kind: "marketplace-entry", address: "plugins/catalog/.claude-plugin/plugin.json", sourceUrl: "https://marketplace.example/catalog" }
    ]);

    expect(snapshotAttestsPath(value, "skills/catalog/SKILL.md")).toBe(false);
    expect(snapshotAttestsPath(value, "plugins/catalog")).toBe(false);
  });

  it("does not let an eligible entry attest a selected descendant", () => {
    const value = snapshot([{ kind: "skill-file", address: "skills/catalog/SKILL.md", sourceUrl: null }]);

    expect(snapshotAttestsPath(value, "skills/catalog/SKILL.md/child")).toBe(false);
  });
});
