import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decisionIndexDigest, loadInstalledDecisionIndex } from "../../src/decision/index-loader.js";
import { verifyDecisionIndexHistoryRelease } from "../../src/decision/history-release.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("decision index history release gate", () => {
  it("allows a current-only first release and authenticates every existing history entry", async () => {
    const root = await releaseRoot();
    await expect(verifyDecisionIndexHistoryRelease({ pluginRoot: root })).resolves.toMatchObject({
      preservedPreviousDigest: null
    });
  });

  it("requires exact prior bytes when a later release changes the current digest", async () => {
    const root = await releaseRoot();
    const previousRaw = await readFile(join(root, "data", "decision-index.json"), "utf8");
    const previous = JSON.parse(previousRaw) as Awaited<ReturnType<typeof loadInstalledDecisionIndex>>;
    const { digest: _digest, ...withoutDigest } = structuredClone(previous);
    withoutDigest.catalogVersion = "d".repeat(64);
    const current = { ...withoutDigest, digest: decisionIndexDigest(withoutDigest) };
    await writeFile(join(root, "data", "decision-index.json"), `${JSON.stringify(current, null, 2)}\n`, "utf8");

    await expect(verifyDecisionIndexHistoryRelease({ pluginRoot: root, previousIndexRaw: previousRaw }))
      .rejects.toThrow(/missing exact prior history/i);
    const history = join(root, "data", "decision-index-history");
    await mkdir(history);
    await writeFile(join(history, `${previous.digest}.json`), `${previousRaw.trim()}\n\n`, "utf8");
    await expect(verifyDecisionIndexHistoryRelease({ pluginRoot: root, previousIndexRaw: previousRaw }))
      .rejects.toThrow(/exact bytes/i);
    await writeFile(join(history, `${previous.digest}.json`), previousRaw, "utf8");
    await expect(verifyDecisionIndexHistoryRelease({ pluginRoot: root, previousIndexRaw: previousRaw }))
      .resolves.toMatchObject({ preservedPreviousDigest: previous.digest });
    await rm(join(history, `${previous.digest}.json`));
    await expect(verifyDecisionIndexHistoryRelease({
      pluginRoot: root,
      previousHistoryEntries: { [`${previous.digest}.json`]: previousRaw }
    })).rejects.toThrow(/deleted or replaced/i);
  });
});

async function releaseRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-decision-history-release-"));
  roots.push(root);
  await mkdir(join(root, "data"));
  await writeFile(
    join(root, "data", "decision-index.json"),
    await readFile(join(process.cwd(), "plugins", "skillset-manager", "data", "decision-index.json"), "utf8"),
    "utf8"
  );
  return root;
}
