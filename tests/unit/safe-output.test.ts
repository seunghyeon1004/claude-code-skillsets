import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExclusiveOutputDirectory, writeExclusiveOutputFile } from "../../src/safety/safe-output.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("exclusive public output paths", () => {
  it("creates only a new leaf below regular existing ancestors", async () => {
    const root = await temporaryRoot();
    const output = join(root, "output");
    await createExclusiveOutputDirectory(output);
    await writeExclusiveOutputFile(join(output, "receipt.json"), "first\n");
    await expect(readFile(join(output, "receipt.json"), "utf8")).resolves.toBe("first\n");
  });

  it("preserves preexisting directories and files instead of truncating them", async () => {
    const root = await temporaryRoot();
    const output = join(root, "output");
    await mkdir(output);
    const victim = join(output, "receipt.json");
    await writeFile(victim, "keep\n");
    await expect(createExclusiveOutputDirectory(output)).rejects.toThrow(/exist/i);
    await expect(writeExclusiveOutputFile(victim, "replace\n")).rejects.toThrow(/exist/i);
    await expect(readFile(victim, "utf8")).resolves.toBe("keep\n");
  });

  it("rejects a symlink ancestor and symlink leaf without touching the target", async () => {
    const root = await temporaryRoot();
    const outside = join(root, "outside");
    await mkdir(outside);
    const victim = join(outside, "victim.txt");
    await writeFile(victim, "keep\n");
    const linked = join(root, "linked");
    await symlink(outside, linked);
    await expect(createExclusiveOutputDirectory(join(linked, "output"))).rejects.toThrow(/symbolic link|symlink/i);
    const leaf = join(root, "leaf.json");
    await symlink(victim, leaf);
    await expect(writeExclusiveOutputFile(leaf, "replace\n")).rejects.toThrow(/exist|symbolic link|symlink/i);
    await expect(readFile(victim, "utf8")).resolves.toBe("keep\n");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "safe-output-")));
  roots.push(root);
  return root;
}
