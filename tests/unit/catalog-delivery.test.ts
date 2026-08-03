import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { prepareCatalogDelivery } from "../../scripts/research/refresh-catalog.js";

const limitationEn = "v0.1: darwin + exact Claude Code 2.1.198; 0/20 executable, 20/20 review-held discovery-only.";
const limitationKo = "v0.1: darwin + 정확한 Claude Code 2.1.198; 0/20 실행 가능, 20/20 검토 대기·발견 전용.";

describe("reviewed catalog delivery", () => {
  it("preserves the exact previous index and conditionally bumps a cached manager install", async () => {
    const root = await fixtureRoot("catalog-delivery-");
    const previous = `${JSON.stringify({ digest: "a".repeat(64), observedThrough: "2026-07-29T00:00:00Z" }, null, 2)}\n`;
    const current = `${JSON.stringify({ digest: "b".repeat(64), observedThrough: "2026-08-08T00:00:00Z" }, null, 2)}\n`;
    await seed(root, current);

    const result = await prepareCatalogDelivery({ root, previousDecisionIndexRaw: previous });

    expect(result).toEqual({ changed: true, previousVersion: "0.1.0", nextVersion: "0.1.1" });
    expect(await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index-history", `${"a".repeat(64)}.json`),
      "utf8"
    )).toBe(previous);
    const manifest = parse(await readFile(join(root, "manifests", "plugins", "skillset-manager.yaml"), "utf8")) as {
      version: string;
    };
    expect(manifest.version).toBe("0.1.1");
    const manifestRaw = await readFile(join(root, "manifests", "plugins", "skillset-manager.yaml"), "utf8");
    expect(manifestRaw).toContain(limitationEn);
    expect(manifestRaw).toContain(limitationKo);
    expect(JSON.parse(await readFile(
      join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
      "utf8"
    ))).toMatchObject({
      version: "0.1.1",
      description: `Anthropic official Marketplace listing is not safety certification. ${limitationEn} / Anthropic 공식 Marketplace 등재는 안전성 인증이 아닙니다. ${limitationKo}`
    });
  });

  it("does not mint a version or history entry when the authenticated index bytes are unchanged", async () => {
    const root = await fixtureRoot("catalog-delivery-noop-");
    const index = `${JSON.stringify({ digest: "a".repeat(64) }, null, 2)}\n`;
    await seed(root, index);

    await expect(prepareCatalogDelivery({ root, previousDecisionIndexRaw: index })).resolves.toEqual({
      changed: false,
      previousVersion: "0.1.0",
      nextVersion: "0.1.0"
    });
  });
});

async function fixtureRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await Promise.all([
    mkdir(join(root, "generated"), { recursive: true }),
    mkdir(join(root, "plugins", "skillset-manager", "data"), { recursive: true }),
    mkdir(join(root, "plugins", "skillset-manager", ".claude-plugin"), { recursive: true }),
    mkdir(join(root, "manifests", "plugins"), { recursive: true })
  ]);
  return root;
}

async function seed(root: string, index: string): Promise<void> {
  await Promise.all([
    writeFile(join(root, "generated", "decision-index.json"), index),
    writeFile(join(root, "plugins", "skillset-manager", "data", "decision-index.json"), index),
    writeFile(join(root, "manifests", "plugins", "skillset-manager.yaml"), [
      "id: skillset-manager",
      "description:",
      `  en: "Anthropic official Marketplace listing is not safety certification. ${limitationEn}"`,
      `  ko: "Anthropic 공식 Marketplace 등재는 안전성 인증이 아닙니다. ${limitationKo}"`,
      "version: 0.1.0",
      ""
    ].join("\n")),
    writeFile(join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: "skillset-manager", version: "0.1.0" }, null, 2)}\n`)
  ]);
}
