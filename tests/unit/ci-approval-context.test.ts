import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = join(projectRoot, "scripts", "research", "resolve-ci-approval-context.ts");
const tsx = join(projectRoot, "node_modules", ".bin", "tsx");
const zero = "0".repeat(40);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CI approval context", () => {
  it("accepts an exact manual current-tip revalidation on checked-out main", async () => {
    const fixture = await repository();

    expect(resolveCurrentTip(fixture)).toEqual({
      base: fixture.tipCommit,
      mode: "current-tip"
    });
  });

  it.each([
    ["missing expected tip", { EXPECTED_CURRENT_TIP: "" }, /EXPECTED_CURRENT_TIP.*lowercase object ID/i],
    ["uppercase expected tip", { EXPECTED_CURRENT_TIP: "A".repeat(40) }, /EXPECTED_CURRENT_TIP.*lowercase object ID/i],
    ["wrong ref", { GITHUB_REF: "refs/heads/not-main" }, /current-tip.*main ref/i],
    ["bootstrap metadata", { PUBLIC_ROOT_COMMIT: "a".repeat(40) }, /ambiguous.*bootstrap/i]
  ])("rejects manual current-tip %s", async (_label, override, pattern) => {
    const fixture = await repository();

    expect(() => resolveCurrentTip(fixture, override)).toThrow(pattern);
  });

  it("rejects manual current-tip checkout drift", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.root, "drift.txt"), "drift\n");
    commit(fixture.root, "drift");

    expect(() => resolveCurrentTip(fixture)).toThrow(/current-tip.*HEAD.*expected/i);
  });

  it("rejects a manual current-tip input that is not a commit", async () => {
    const fixture = await repository();
    const tree = git(fixture.root, ["rev-parse", "HEAD^{tree}"]);

    expect(() => resolveCurrentTip(fixture, { EXPECTED_CURRENT_TIP: tree }))
      .toThrow(/current-tip.*commit/i);
  });

  it("rejects the manual current-tip flag outside workflow dispatch", async () => {
    const fixture = await repository();

    expect(() => resolveCurrentTip(fixture, { EVENT_NAME: "pull_request" }))
      .toThrow(/manual current-tip.*workflow_dispatch/i);
  });

  it("accepts an exact one-time manual public-history bootstrap", async () => {
    const fixture = await repository();
    expect(resolve(fixture)).toEqual({ base: fixture.rootCommit, mode: "first-public-bootstrap" });
  });

  it("keeps an explicit false manual current-tip flag on the public-history bootstrap route", async () => {
    const fixture = await repository();

    expect(resolve(fixture, { MANUAL_CURRENT_TIP: "false" })).toEqual({
      base: fixture.rootCommit,
      mode: "first-public-bootstrap"
    });
  });

  it("rejects a zero base for an ordinary pull request", async () => {
    const fixture = await repository();
    expect(() => resolve(fixture, { EVENT_NAME: "pull_request" })).toThrow(/non-zero event base/i);
  });

  it("accepts the first main push only after the CI has attested an exact fresh A/B bootstrap", async () => {
    const fixture = await repository();

    expect(resolveAutomaticPush(fixture)).toEqual({
      base: fixture.rootCommit,
      mode: "first-public-bootstrap"
    });
  });

  it("fails closed for a zero-base push without the fresh-remote attestation", async () => {
    const fixture = await repository();

    expect(() => resolveAutomaticPush(fixture, { PUBLIC_BOOTSTRAP_REMOTE_EXACT: "" }))
      .toThrow(/fresh remote/i);
  });

  it("fails closed when the automatic bootstrap graph contains more than A and B", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.root, "extra.txt"), "extra\n");
    commit(fixture.root, "extra");

    expect(() => resolveAutomaticPush(fixture)).toThrow(/exactly.*two|history/i);
  });

  it("does not classify an ordinary non-zero main push as a bootstrap", async () => {
    const fixture = await repository();

    expect(() => resolveAutomaticPush(fixture, { PUSH_BEFORE: fixture.rootCommit }))
      .toThrow(/required public baseline/i);
  });

  it.each([
    ["root", { PUBLIC_ROOT_COMMIT: "a".repeat(40) }, /root/i],
    ["tip", { PUBLIC_TIP_COMMIT: "b".repeat(40) }, /tip/i],
    ["tag name", { PUBLIC_ROOT_TAG_NAME: "public-history/root-v2" }, /tag/i],
    ["tag object", { PUBLIC_ROOT_TAG_OBJECT: "c".repeat(40) }, /tag object/i],
    ["remote base", { PUSH_BEFORE: "d".repeat(40) }, /zero remote base/i],
    ["ref", { GITHUB_REF: "refs/heads/not-main" }, /main ref/i]
  ])("rejects wrong bootstrap %s metadata", async (_label, override, pattern) => {
    const fixture = await repository();
    expect(() => resolve(fixture, override)).toThrow(pattern);
  });

  it("rejects a tip with an extra commit", async () => {
    const fixture = await repository();
    await writeFile(join(fixture.root, "extra.txt"), "extra\n");
    const extra = commit(fixture.root, "extra");
    expect(() => resolve(fixture, { PUBLIC_TIP_COMMIT: extra })).toThrow(/tip.*parent|exactly.*two/i);
  });

  it("rejects a bootstrap tip whose tree differs from the public root", async () => {
    const fixture = await repository({ tipChangesTree: true });
    expect(() => resolve(fixture)).toThrow(/same tree/i);
  });

  it("rejects an unrelated force replacement", async () => {
    const fixture = await repository();
    git(fixture.root, ["checkout", "--orphan", "replacement"]);
    git(fixture.root, ["rm", "-q", "-rf", "."]);
    await writeFile(join(fixture.root, "replacement.txt"), "replacement\n");
    const replacement = commit(fixture.root, "replacement");
    git(fixture.root, ["branch", "-M", "main"]);
    expect(() => resolve(fixture, { PUBLIC_TIP_COMMIT: replacement })).toThrow(/tip.*parent|root/i);
  });
});

interface Fixture {
  root: string;
  rootCommit: string;
  tipCommit: string;
  tagName: string;
  tagObject: string;
}

async function repository(options: { tipChangesTree?: boolean } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "ci-public-bootstrap-"));
  roots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "CI Bootstrap Test"]);
  git(root, ["config", "user.email", "ci-bootstrap@example.test"]);
  await writeFile(join(root, "root.txt"), "root\n");
  const rootCommit = commit(root, "public root");
  if (options.tipChangesTree) await writeFile(join(root, "tip.txt"), "tip\n");
  const tipCommit = options.tipChangesTree ? commit(root, "public tip") : emptyCommit(root, "public tip");
  const tagName = "public-history/root-v1";
  git(root, ["tag", "-a", tagName, rootCommit, "-m", "approved public root"]);
  return { root, rootCommit, tipCommit, tagName, tagObject: git(root, ["rev-parse", tagName]) };
}

function resolve(fixture: Fixture, overrides: Record<string, string> = {}): { base: string; mode: string } {
  const output = execFileSync(tsx, [script], {
    cwd: fixture.root,
    env: {
      ...process.env,
      EVENT_NAME: "workflow_dispatch",
      PUSH_BEFORE: zero,
      GITHUB_REF: "refs/heads/main",
      PUBLIC_ROOT_COMMIT: fixture.rootCommit,
      PUBLIC_TIP_COMMIT: fixture.tipCommit,
      PUBLIC_ROOT_TAG_NAME: fixture.tagName,
      PUBLIC_ROOT_TAG_OBJECT: fixture.tagObject,
      ...overrides
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return Object.fromEntries(output.trim().split("\n").map((line) => line.split("=", 2))) as {
    base: string;
    mode: string;
  };
}

function resolveAutomaticPush(fixture: Fixture, overrides: Record<string, string> = {}): { base: string; mode: string } {
  const output = execFileSync(tsx, [script], {
    cwd: fixture.root,
    env: {
      ...process.env,
      EVENT_NAME: "push",
      PUSH_BEFORE: zero,
      GITHUB_REF: "refs/heads/main",
      PUBLIC_BOOTSTRAP_REMOTE_EXACT: "true",
      PUBLIC_ROOT_TAG_NAME: fixture.tagName,
      ...overrides
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return Object.fromEntries(output.trim().split("\n").map((line) => line.split("=", 2))) as {
    base: string;
    mode: string;
  };
}

function resolveCurrentTip(fixture: Fixture, overrides: Record<string, string> = {}): { base: string; mode: string } {
  const output = execFileSync(tsx, [script], {
    cwd: fixture.root,
    env: {
      ...process.env,
      EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      MANUAL_CURRENT_TIP: "true",
      EXPECTED_CURRENT_TIP: fixture.tipCommit,
      PUSH_BEFORE: "",
      PUBLIC_BOOTSTRAP_REMOTE_EXACT: "",
      PUBLIC_ROOT_COMMIT: "",
      PUBLIC_TIP_COMMIT: "",
      PUBLIC_ROOT_TAG_NAME: "",
      PUBLIC_ROOT_TAG_OBJECT: "",
      ...overrides
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return Object.fromEntries(output.trim().split("\n").map((line) => line.split("=", 2))) as {
    base: string;
    mode: string;
  };
}

function commit(root: string, message: string): string {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function emptyCommit(root: string, message: string): string {
  git(root, ["commit", "-q", "--allow-empty", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
