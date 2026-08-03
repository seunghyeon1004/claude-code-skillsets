import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPublicHistory } from "../../scripts/release/verify-public-history.js";

interface Fixture {
  source: string;
  remote: string;
  clone: string;
  rootCommit: string;
  tipCommit: string;
  tagName: string;
  tagObject: string;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("public history verifier", () => {
  it("accepts exactly one root-to-tip history and one separately fetched annotated governance tag", async () => {
    const fixture = await repository();

    expect(verify(fixture)).toEqual({
      rootCommit: fixture.rootCommit,
      tipCommit: fixture.tipCommit,
      tagName: fixture.tagName,
      tagObject: fixture.tagObject,
      reachableCommitCount: 2
    });
  });

  it.each([
    ["root", { rootCommit: "a".repeat(40) }, /root commit/i],
    ["tip", { tipCommit: "b".repeat(40) }, /main tip|tip commit/i],
    ["tag object", { tagObject: "c".repeat(40) }, /tag object/i],
    ["tag name", { tagName: "public-history/root-v2" }, /tag name|advertised ref/i]
  ])("rejects wrong %s metadata", async (_label, override, pattern) => {
    const fixture = await repository();
    expect(() => verify({ ...fixture, ...override })).toThrow(pattern);
  });

  it("rejects an extra commit on public main", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.source, "extra.txt"), "extra\n");
    const extra = commit(fixture.source, "extra public commit");
    git(fixture.remote, ["fetch", "-q", "--no-tags", fixture.source, `+${extra}:refs/heads/main`]);
    refreshClone(fixture);

    expect(() => verify({ ...fixture, tipCommit: extra })).toThrow(/exactly.*two|exactly.*root.*parent|parent.*root/i);
  });

  it("rejects a tip whose tree differs from the approved public root", async () => {
    const fixture = await repository({ tipChangesTree: true });
    expect(() => verify(fixture)).toThrow(/same tree/i);
  });

  it.each([
    ["branch", "refs/heads/private-history"],
    ["tag", "refs/tags/private-history"]
  ])("rejects an extra advertised %s", async (_label, ref) => {
    const fixture = await repository();
    git(fixture.remote, ["update-ref", ref, fixture.rootCommit]);

    expect(() => verify(fixture)).toThrow(/advertised ref/i);
  });

  it("rejects a GitHub-managed pull ref instead of weakening the exact public ref contract", async () => {
    const fixture = await repository();
    git(fixture.remote, ["update-ref", "refs/pull/1/head", fixture.rootCommit]);

    expect(() => verify(fixture)).toThrow(/advertised ref/i);
  });

  it("rejects an old private commit reachable behind the declared root", async () => {
    const fixture = await repository({ rootHasPrivateParent: true });
    expect(() => verify(fixture)).toThrow(/root commit.*parent|exactly.*two/i);
  });

  it.each(["author", "committer", "tagger"] as const)("rejects a .local %s email", async (identity) => {
    const fixture = await repository({ localIdentity: identity });
    expect(() => verify(fixture)).toThrow(/\.local/i);
  });

  it("rejects an unrelated force replacement of public main", async () => {
    const fixture = await repository();
    const unrelated = await unrelatedCommit();
    git(fixture.remote, ["fetch", "-q", "--no-tags", unrelated.root, `+${unrelated.commit}:refs/heads/main`]);

    expect(() => verify(fixture)).toThrow(/advertised.*main|main tip/i);
  });

  it("rejects a dirty verification worktree", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.clone, "untracked.txt"), "dirty\n");

    expect(() => verify(fixture)).toThrow(/worktree.*clean/i);
  });

  it("does not require checkout tooling to create a local origin/main tracking ref", async () => {
    const fixture = await repository();
    git(fixture.clone, ["update-ref", "-d", "refs/remotes/origin/main"]);
    git(fixture.clone, ["update-ref", "-d", "refs/remotes/origin/HEAD"]);

    expect(verify(fixture).reachableCommitCount).toBe(2);
  });
});

function verify(fixture: Fixture) {
  return verifyPublicHistory({
    root: fixture.clone,
    remote: "origin",
    branch: "main",
    rootCommit: fixture.rootCommit,
    tipCommit: fixture.tipCommit,
    tagName: fixture.tagName,
    tagObject: fixture.tagObject,
    runGeneratedCheck: false
  });
}

async function repository(options: {
  rootHasPrivateParent?: boolean;
  localIdentity?: "author" | "committer" | "tagger";
  tipChangesTree?: boolean;
} = {}): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "public-history-verifier-"));
  roots.push(base);
  const source = join(base, "source");
  const remote = join(base, "remote.git");
  const clone = join(base, "clone");
  const tagName = "public-history/root-v1";

  git(base, ["init", "-q", "-b", "main", source]);
  git(source, ["config", "user.name", "Public History Test"]);
  git(source, ["config", "user.email", "public-history@example.test"]);

  if (options.rootHasPrivateParent) {
    await writeFile(join(source, "private.txt"), "private history\n");
    commit(source, "private predecessor");
  }

  await writeFile(join(source, "README.md"), "public root\n");
  const rootCommit = commitWithIdentity(source, "public root", options.localIdentity === "author" ? "author" : undefined);
  if (options.tipChangesTree) await writeFile(join(source, "release.txt"), "public tip\n");
  const tipCommit = commitWithIdentity(
    source,
    "public tip",
    options.localIdentity === "committer" ? "committer" : undefined,
    !options.tipChangesTree
  );
  tag(source, tagName, rootCommit, options.localIdentity === "tagger");
  const tagObject = git(source, ["rev-parse", tagName]);

  git(base, ["init", "-q", "--bare", remote]);
  git(remote, ["fetch", "--no-tags", source, `${tipCommit}:refs/heads/main`]);
  git(remote, ["fetch", "--no-tags", source, `refs/tags/${tagName}:refs/tags/${tagName}`]);
  git(base, ["clone", "-q", "--no-local", "--single-branch", "--no-tags", "--branch", "main", remote, clone]);
  git(clone, ["fetch", "-q", "--no-tags", "origin", `refs/tags/${tagName}:refs/tags/${tagName}`]);

  return { source, remote, clone, rootCommit, tipCommit, tagName, tagObject };
}

function refreshClone(fixture: Fixture): void {
  git(fixture.clone, ["fetch", "-q", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  git(fixture.clone, ["reset", "-q", "--hard", "refs/remotes/origin/main"]);
}

async function unrelatedCommit(): Promise<{ root: string; commit: string }> {
  const root = await mkdtemp(join(tmpdir(), "public-history-unrelated-"));
  roots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Unrelated Test"]);
  git(root, ["config", "user.email", "unrelated@example.test"]);
  await writeFile(join(root, "unrelated.txt"), "unrelated\n");
  return { root, commit: commit(root, "unrelated root") };
}

function commit(root: string, message: string): string {
  return commitWithIdentity(root, message);
}

function commitWithIdentity(
  root: string,
  message: string,
  localIdentity?: "author" | "committer",
  allowEmpty = false
): string {
  git(root, ["add", "-A"]);
  const env: Record<string, string> = {};
  if (localIdentity === "author") env.GIT_AUTHOR_EMAIL = "author@private.local";
  if (localIdentity === "committer") env.GIT_COMMITTER_EMAIL = "committer@private.local";
  git(root, ["commit", "-q", ...(allowEmpty ? ["--allow-empty"] : []), "-m", message], env);
  return git(root, ["rev-parse", "HEAD"]);
}

function tag(root: string, name: string, target: string, localTagger: boolean): void {
  git(root, ["tag", "-a", name, target, "-m", "approved public root"], localTagger
    ? { GIT_COMMITTER_EMAIL: "tagger@private.local" }
    : {});
}

function git(root: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
