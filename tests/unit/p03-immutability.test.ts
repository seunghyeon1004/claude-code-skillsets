import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, lstat, mkdtemp, mkdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertP03Immutable } from "../../scripts/research/assert-p03-immutable.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots: string[] = [];
const protectedPath = "research/census.json";

interface PublicFixture {
  root: string;
  rootCommit: string;
  tipCommit: string;
}

let root = "";
let fixture: PublicFixture;

beforeEach(async () => {
  fixture = await clonePublicRepository();
  root = fixture.root;
});

async function clonePublicRepository(directoryName = "repository"): Promise<PublicFixture> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "p03-immutability-"));
  temporaryRoots.push(temporaryRoot);
  const source = join(temporaryRoot, "source");
  const remote = join(temporaryRoot, "source.git");
  const repository = join(temporaryRoot, directoryName);
  await mkdir(source);
  git(source, ["init", "--quiet", "--initial-branch=main"]);
  git(source, ["config", "user.name", "Public Fixture"]);
  git(source, ["config", "user.email", "public-fixture@example.test"]);
  await writeFixtureFile(source, "research/census-observed-at.txt", "2026-07-30T00:00:00Z\n");
  await writeFixtureFile(source, protectedPath, '{"sources":["source-a"]}\n');
  await writeFixtureFile(source, "research/evaluation-context.json", '{"schemaVersion":2}\n');
  await writeFixtureFile(source, "research/review-source-index.json", '{"schemaVersion":2}\n');
  await writeFixtureFile(source, "research/sources/source-a.json", '{"sourceId":"source-a"}\n');
  await writeFixtureFile(source, "research/receipts/receipt-a.json", '{"id":"receipt-a"}\n');
  await writeFixtureFile(source, "research/snapshots/snapshot-a.json", '{"id":"snapshot-a"}\n');
  await writeFixtureFile(source, "package.json", JSON.stringify({
    private: true,
    type: "module",
    scripts: { "verify:p03-immutable": "tsx scripts/research/assert-p03-immutable.ts" }
  }) + "\n");
  await mkdir(join(source, "scripts", "research"), { recursive: true });
  await copyFile(
    join(repositoryRoot, "scripts", "research", "assert-p03-immutable.ts"),
    join(source, "scripts", "research", "assert-p03-immutable.ts")
  );
  git(source, ["add", "-A"]);
  git(source, ["commit", "--quiet", "-m", "public root"]);
  const rootCommit = git(source, ["rev-parse", "HEAD"]);
  git(source, ["tag", "-a", "public-history/root-v1", "-m", "Public history root", rootCommit]);
  git(source, ["commit", "--quiet", "--allow-empty", "-m", "public attestation"]);
  const tipCommit = git(source, ["rev-parse", "HEAD"]);
  git(source, ["clone", "--quiet", "--bare", "--no-hardlinks", source, remote]);
  git(source, ["clone", "--quiet", "--no-local", remote, repository]);
  git(repository, ["config", "user.name", "Public Fixture"]);
  git(repository, ["config", "user.email", "public-fixture@example.test"]);
  await symlink(join(repositoryRoot, "node_modules"), join(repository, "node_modules"), "dir");
  return { root: repository, rootCommit, tipCommit };
}

afterEach(async () => Promise.all(temporaryRoots.splice(0).map((temporaryRoot) => rm(temporaryRoot, { recursive: true, force: true }))));

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function write(path: string, contents: string): Promise<void> {
  await writeFixtureFile(root, path, contents);
}

async function writeFixtureFile(repository: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(repository, path)), { recursive: true });
  await writeFile(join(repository, path), contents);
}

describe("P03 Git baseline immutability", () => {
  it("accepts the protected selector tree authenticated by the sole public root tag in a clean A/B clone", () => {
    const result = assertP03Immutable({ root });

    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe("2");
    expect(git(root, ["rev-parse", "HEAD"])).toBe(fixture.tipCommit);
    expect(result.baselineCommit).toBe(fixture.rootCommit);
    expect(result.baselineDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.protectedPathCount).toBe(7);
  });

  it("accepts an authenticated full-SHA public root as the dynamic protected baseline", async () => {
    const publicRoot = fixture.rootCommit;
    const result = assertP03Immutable({ root, baselineRef: publicRoot });

    expect(result.baselineCommit).toBe(publicRoot);
    expect(result.baselineDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.protectedPathCount).toBe(7);

    await write(protectedPath, '{"tampered":true}\n');
    expect(() => assertP03Immutable({ root, baselineRef: publicRoot }))
      .toThrow(`P03 protected working-tree blob mismatch: ${protectedPath}`);
  });

  it("requires the dynamic public baseline to be a full commit object ID", () => {
    expect(() => assertP03Immutable({ root, baselineRef: "HEAD" }))
      .toThrow(/public baseline.*full.*object ID/i);
  });

  it("allows changes outside the literal protected path set", async () => {
    await write("research/review-queue.json", '{"mutable":true}\n');
    await write("research/receipts/2026-07-24-future-p04b-evidence.json", '{"new":true}\n');
    await write("research/snapshots/2026-07-24-future-p04b-evidence.json", '{"new":true}\n');

    expect(() => assertP03Immutable({ root })).not.toThrow();
  });

  it("fails closed when the public-history governance tag is missing", () => {
    git(root, ["tag", "-d", "public-history/root-v1"]);

    expect(() => assertP03Immutable({ root })).toThrow(/exactly one.*governance tag/i);
  });

  it("fails closed when public-history governance tags compete", () => {
    git(root, ["tag", "-a", "public-history/root-v2", "-m", "Competing root", fixture.rootCommit]);

    expect(() => assertP03Immutable({ root })).toThrow(/exactly one.*governance tag/i);
  });

  it("fails closed when the sole public-history tag name is invalid", () => {
    git(root, ["tag", "-d", "public-history/root-v1"]);
    git(root, ["tag", "-a", "public-history/root-v0", "-m", "Invalid root", fixture.rootCommit]);

    expect(() => assertP03Immutable({ root })).toThrow(/governance tag name is invalid/i);
  });

  it("fails closed when the sole public-history governance tag is lightweight", () => {
    git(root, ["tag", "-d", "public-history/root-v1"]);
    git(root, ["tag", "public-history/root-v1", fixture.rootCommit]);

    expect(() => assertP03Immutable({ root })).toThrow(/must be annotated/i);
  });

  it("rejects an annotated governance tag moved to an unrelated parentless commit", () => {
    const unrelatedRoot = git(root, ["commit-tree", git(root, ["rev-parse", "HEAD^{tree}"]), "-m", "unrelated root"]);
    git(root, ["tag", "-f", "-a", "public-history/root-v1", "-m", "Unrelated root", unrelatedRoot]);

    expect(() => assertP03Immutable({ root })).toThrow(/governance tag.*current HEAD root/i);
  });

  it("rejects side history that gives current HEAD more than one root", () => {
    const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
    const sideRoot = git(root, ["commit-tree", tree, "-m", "side root"]);
    const mergedHead = git(root, [
      "commit-tree", tree,
      "-p", fixture.tipCommit,
      "-p", sideRoot,
      "-m", "merge side history"
    ]);
    git(root, ["update-ref", "HEAD", mergedHead]);

    expect(() => assertP03Immutable({ root })).toThrow(/exactly one current HEAD root/i);
  });

  it("rejects an unstaged protected byte rewrite with its literal path", async () => {
    await write(protectedPath, '{"tampered":true}\n');

    expect(() => assertP03Immutable({ root })).toThrow(`P03 protected working-tree blob mismatch: ${protectedPath}`);
  });

  it("rejects a staged protected blob rewrite with its literal path", async () => {
    await write(protectedPath, '{"tampered":true}\n');
    git(root, ["add", "--", protectedPath]);

    expect(() => assertP03Immutable({ root })).toThrow(`P03 protected tracked blob mismatch: ${protectedPath}`);
  });

  it("rejects a deleted protected path", async () => {
    await unlink(join(root, protectedPath));

    expect(() => assertP03Immutable({ root })).toThrow(`P03 protected path is missing or is not a regular file: ${protectedPath}`);
  });

  it("rejects a renamed protected path", async () => {
    await rename(join(root, protectedPath), join(root, "research", "census-renamed.json"));

    expect(() => assertP03Immutable({ root })).toThrow(`P03 protected path is missing or is not a regular file: ${protectedPath}`);
  });

  it("rejects an untracked replacement at a protected path", () => {
    git(root, ["rm", "--cached", "--", protectedPath]);

    expect(() => assertP03Immutable({ root })).toThrow(`P03 protected path is missing or is untracked: ${protectedPath}`);
  });

  it("rejects symlink, directory, and executable replacements", async () => {
    await unlink(join(root, protectedPath));
    await symlink("review-queue.json", join(root, protectedPath));
    expect(() => assertP03Immutable({ root })).toThrow(`P03 protected path type or mode mismatch: ${protectedPath}`);

    await unlink(join(root, protectedPath));
    await mkdir(join(root, protectedPath));
    expect(() => assertP03Immutable({ root })).toThrow(`P03 protected path is missing or is not a regular file: ${protectedPath}`);

    await rm(join(root, protectedPath), { recursive: true });
    await write(protectedPath, "{}\n");
    await chmod(join(root, protectedPath), 0o755);
    expect(() => assertP03Immutable({ root })).toThrow(`P03 protected path type or mode mismatch: ${protectedPath}`);
  });

  it("rejects a no-hardlinks parent-directory symlink to byte-identical protected files", async () => {
    const externalResearch = join(dirname(root), "external-research");
    await rename(join(root, "research"), externalResearch);
    await symlink(externalResearch, join(root, "research"));

    expect(git(root, ["status", "--short", "--", "research"])).not.toBe("");
    expect(() => assertP03Immutable({ root })).toThrow("P03 protected path has a symlink ancestor:");
  });

  it("runs the canonical package tsx command with an explicit root in a repository path containing spaces", async () => {
    const spacedRoot = (await clonePublicRepository("repository with spaces")).root;
    await writeFile(join(spacedRoot, protectedPath), '{"tampered":true}\n');

    const result = spawnSync("npm", ["run", "verify:p03-immutable", "--", "--root", spacedRoot], { cwd: spacedRoot, encoding: "utf8" });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`P03 protected working-tree blob mismatch: ${protectedPath}`);
  });

  it("accepts --baseline-ref through the canonical package command", async () => {
    const publicFixture = await clonePublicRepository("public baseline repository");
    const spacedRoot = publicFixture.root;
    const publicRoot = publicFixture.rootCommit;

    const result = spawnSync(
      "npm",
      ["run", "verify:p03-immutable", "--", "--root", spacedRoot, "--baseline-ref", publicRoot],
      { cwd: spacedRoot, encoding: "utf8" }
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(publicRoot);
  });

  it("runs direct tsx through a repository symlink and rejects a protected tamper", async () => {
    const symlinkedRoot = join(dirname(root), "repository-symlink");
    await writeFile(join(root, protectedPath), '{"tampered":true}\n');
    await symlink(root, symlinkedRoot, "dir");

    const result = spawnSync(
      join(repositoryRoot, "node_modules", ".bin", "tsx"),
      [join(symlinkedRoot, "scripts", "research", "assert-p03-immutable.ts"), "--root", symlinkedRoot],
      { cwd: dirname(root), encoding: "utf8" }
    );

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`P03 protected working-tree blob mismatch: ${protectedPath}`);
  });

  it("fails closed with a deterministic error when Git cannot inspect the repository", async () => {
    const gitDirectory = join(root, ".git");
    const hiddenGitDirectory = join(root, ".git-hidden");
    expect((await lstat(gitDirectory)).isDirectory()).toBe(true);
    await rename(gitDirectory, hiddenGitDirectory);

    expect(() => assertP03Immutable({ root })).toThrow("P03 Git command failed: for-each-ref");

    await rename(hiddenGitDirectory, gitDirectory);
  });
});
