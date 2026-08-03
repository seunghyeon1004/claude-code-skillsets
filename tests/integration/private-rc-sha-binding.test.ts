import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local sole-maintainer semantic RC", () => {
  it("binds a read-only fixture evaluation to the exact clean local main SHA", async () => {
    const root = await repository();
    const module = await import("../../scripts/release/run-solo-semantic-rc.js").catch(() => null);
    expect(module).not.toBeNull();
    const commitSha = git(root, ["rev-parse", "HEAD"]);

    expect(module!.verifyLocalSemanticRcTarget({ root, commitSha })).toEqual({
      schemaVersion: 5,
      receiptType: "local-semantic-rc-target",
      commitSha,
      executionMode: "subscription-claude-cli-fixture-read-only",
      humanReviewGuarantee: "not-guaranteed"
    });

    expect(() => module!.verifyLocalSemanticRcTarget({ root, commitSha: "a".repeat(40) }))
      .toThrow(/exact main tip/i);
    await writeFile(join(root, "dirty.txt"), "dirty\n");
    expect(() => module!.verifyLocalSemanticRcTarget({ root, commitSha })).toThrow(/clean/i);
  });

  it("requires explicit read-only approval before it can invoke local Claude CLI evaluations", async () => {
    const module = await import("../../scripts/release/run-solo-semantic-rc.js").catch(() => null);
    expect(module).not.toBeNull();

    expect(() => module!.parseSoloSemanticRcOptions([
      "--commit-sha", "a".repeat(40), "--output-dir", join(process.cwd(), ".rc-artifacts", "a".repeat(40)), "--execute"
    ])).toThrow(/approved-read-only/i);
    expect(module!.parseSoloSemanticRcOptions([
      "--commit-sha", "a".repeat(40), "--output-dir", join(process.cwd(), ".rc-artifacts", "a".repeat(40)), "--execute", "--approved-read-only"
    ])).toMatchObject({ execute: true, approvedReadOnly: true });
  });

  it("rejects every output path except the canonical repo-owned exact-SHA directory without deleting data", async () => {
    const module = await import("../../scripts/release/run-solo-semantic-rc.js").catch(() => null);
    expect(module).not.toBeNull();
    const root = await repository();
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    const outside = await mkdtemp(join(tmpdir(), "semantic-rc-victim-"));
    roots.push(outside);
    const victim = join(outside, "keep.txt");
    await writeFile(victim, "keep\n");
    const invalid = [
      outside,
      join(root, "..", "victim"),
      root,
      homedir(),
      join(root, ".rc-artifacts", "b".repeat(40))
    ];
    for (const outputDirectory of invalid) {
      await expect(module!.runSoloSemanticRc({
        root,
        commitSha,
        outputDirectory,
        execute: true,
        approvedReadOnly: true
      })).rejects.toThrow(/canonical|output|exact.*SHA|repo-owned/i);
      await expect(readFile(victim, "utf8")).resolves.toBe("keep\n");
    }

    const linkedOutside = await mkdtemp(join(tmpdir(), "semantic-rc-linked-victim-"));
    roots.push(linkedOutside);
    await writeFile(join(linkedOutside, "keep.txt"), "linked-keep\n");
    await symlink(linkedOutside, join(root, ".rc-artifacts"));
    await expect(module!.runSoloSemanticRc({
      root,
      commitSha,
      outputDirectory: join(root, ".rc-artifacts", commitSha),
      execute: true,
      approvedReadOnly: true
    })).rejects.toThrow(/symbolic link|symlink/i);
    await expect(readFile(join(linkedOutside, "keep.txt"), "utf8")).resolves.toBe("linked-keep\n");
  });

  it("rejects a noncanonical raw CLI output path before creating the exact-SHA directory", async () => {
    const module = await import("../../scripts/release/run-solo-semantic-rc.js").catch(() => null);
    expect(module).not.toBeNull();
    const root = await repository();
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    const exactOutput = join(root, ".rc-artifacts", commitSha);
    const parsed = module!.parseSoloSemanticRcOptions([
      "--root", root,
      "--commit-sha", commitSha,
      "--output-dir", exactOutput
    ]);
    expect(parsed.outputDirectory).toBe(exactOutput);
    await expect(module!.runSoloSemanticRc(parsed)).resolves.toMatchObject({ commitSha });

    const result = spawnSync(
      join(projectRoot, "node_modules", ".bin", "tsx"),
      [
        join(projectRoot, "scripts", "release", "run-solo-semantic-rc.ts"),
        "--root", root,
        "--commit-sha", commitSha,
        "--output-dir", `${root}/.rc-artifacts/junk/../${commitSha}`,
        "--execute",
        "--approved-read-only"
      ],
      { encoding: "utf8" }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/canonical.*repo-owned.*exact-SHA|must be (?:a )?canonical/i);
    await expect(access(join(root, ".rc-artifacts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses no self-hosted runner, protected environment, special branch-protection token, or remote Claude call", async () => {
    const [packageJson, releaseGuide, script] = await Promise.all([
      readFile(join(projectRoot, "package.json"), "utf8"),
      readFile(join(projectRoot, "docs", "release", "github-free-staged-public.md"), "utf8"),
      readFile(join(projectRoot, "scripts", "release", "run-solo-semantic-rc.ts"), "utf8")
    ]);
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;

    expect(scripts["verify:solo-semantic-rc"]).toBe("tsx scripts/release/run-solo-semantic-rc.ts");
    expect(scripts["verify:private-rc-target"]).toBeUndefined();
    expect(script).toContain("--approved-read-only");
    expect(script).toContain("eval:setup");
    expect(script).toContain("eval:maintain");
    expect(script).toContain("eval:doctor");
    expect(script).toContain("eval:shared-core");
    expect(script).toContain("eval:sanitize");
    expect(script).not.toMatch(/gh api|BRANCH_PROTECTION_READ_TOKEN|self-hosted|private-rc/i);
    const setupEvaluator = await readFile(join(projectRoot, "src", "evaluate", "setup.ts"), "utf8");
    expect(setupEvaluator).toContain('"--safe-mode"');
    expect(setupEvaluator).toContain('args.push("--tools", ...allowedTools)');
    expect(setupEvaluator).toContain('allowedTools: ["Read"]');
    expect(setupEvaluator).toContain("additionalDirectories: [evaluationCase.fixturePluginRoot]");
    expect(releaseGuide).toMatch(/local subscription Claude CLI[\s\S]*read-only fixture/i);
    expect(releaseGuide).toMatch(/human review is not guaranteed/i);
    await expect(readFile(join(projectRoot, ".github", "workflows", "private-rc.yml"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function repository(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "solo-semantic-rc-")));
  roots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Semantic RC Test"]);
  git(root, ["config", "user.email", "semantic-rc@example.test"]);
  await Promise.all([
    writeFile(join(root, "tracked.txt"), "tracked\n"),
    writeFile(join(root, ".gitignore"), ".rc-artifacts\n")
  ]);
  git(root, ["add", "tracked.txt", ".gitignore"]);
  git(root, ["commit", "-q", "-m", "candidate"]);
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
