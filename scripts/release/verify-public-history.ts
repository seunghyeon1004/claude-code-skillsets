import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface PublicHistoryVerificationOptions {
  root?: string;
  remote: string;
  branch: "main";
  rootCommit: string;
  tipCommit: string;
  tagName: string;
  tagObject: string;
  runGeneratedCheck?: boolean;
}

export interface PublicHistoryVerificationResult {
  rootCommit: string;
  tipCommit: string;
  tagName: string;
  tagObject: string;
  reachableCommitCount: 2;
}

const objectIdPattern = /^[0-9a-f]{40,64}$/u;
const tagNamePattern = /^public-history\/root-v[1-9][0-9]*$/u;

export function verifyPublicHistory(options: PublicHistoryVerificationOptions): PublicHistoryVerificationResult {
  const root = resolve(options.root ?? process.cwd());
  assertObjectId(options.rootCommit, "root commit");
  assertObjectId(options.tipCommit, "tip commit");
  assertObjectId(options.tagObject, "tag object");
  if (!tagNamePattern.test(options.tagName)) {
    throw new Error("Public history governance tag name is invalid");
  }
  if (options.remote.length === 0 || options.remote.startsWith("-")) {
    throw new Error("Public history remote is invalid");
  }

  assertCommit(root, options.rootCommit, "root commit");
  assertCommit(root, options.tipCommit, "tip commit");
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head !== options.tipCommit) throw new Error("Public main tip does not match the declared tip commit");
  const branch = git(root, ["symbolic-ref", "--short", "HEAD"]);
  if (branch !== options.branch) throw new Error("Public history verification requires the main branch");

  const rootParents = commitParents(root, options.rootCommit);
  if (rootParents.length !== 0) throw new Error("Public root commit must have no parent");
  const tipParents = commitParents(root, options.tipCommit);
  if (tipParents.length !== 1 || tipParents[0] !== options.rootCommit) {
    throw new Error("Public tip commit must have exactly the declared root commit as its parent");
  }
  if (git(root, ["rev-parse", `${options.rootCommit}^{tree}`]) !== git(root, ["rev-parse", `${options.tipCommit}^{tree}`])) {
    throw new Error("Public root and attestation tip must have the same tree");
  }
  const commits = lines(git(root, ["rev-list", "--reverse", options.tipCommit]));
  if (commits.length !== 2 || commits[0] !== options.rootCommit || commits[1] !== options.tipCommit) {
    throw new Error("Public main must contain exactly the root and tip commits");
  }

  assertTag(root, options);
  assertIdentities(root, options);
  assertAdvertisedRefs(root, options);
  assertLocalRefs(root, options);
  assertReachableObjectTypes(root, options);

  if (options.runGeneratedCheck !== false) {
    run(root, "npm", ["run", "check:generated"], "Generated state verification failed");
  }
  if (git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).length !== 0) {
    throw new Error("Public history verification worktree and generated state must be clean");
  }

  return {
    rootCommit: options.rootCommit,
    tipCommit: options.tipCommit,
    tagName: options.tagName,
    tagObject: options.tagObject,
    reachableCommitCount: 2
  };
}

function assertTag(root: string, options: PublicHistoryVerificationOptions): void {
  const tagRef = `refs/tags/${options.tagName}`;
  let object: string;
  try {
    object = git(root, ["rev-parse", "--verify", `${tagRef}^{tag}`]);
  } catch {
    throw new Error("Public history governance tag name does not resolve to an annotated tag");
  }
  if (object !== options.tagObject) throw new Error("Public history tag object does not match the declared object");
  if (git(root, ["cat-file", "-t", options.tagObject]) !== "tag") {
    throw new Error("Public history governance tag must be annotated");
  }
  const payload = gitRaw(root, ["cat-file", "-p", options.tagObject]);
  const headers = tagHeaders(payload);
  if (headers.object !== options.rootCommit || headers.type !== "commit" || headers.tag !== options.tagName) {
    throw new Error("Public history governance tag must directly annotate the declared root commit");
  }
}

function assertIdentities(root: string, options: PublicHistoryVerificationOptions): void {
  for (const commit of [options.rootCommit, options.tipCommit]) {
    const [author, committer] = lines(gitRaw(root, ["show", "-s", "--format=%ae%n%ce", commit]));
    assertPublicEmail(author, "commit author");
    assertPublicEmail(committer, "commit committer");
  }
  const payload = gitRaw(root, ["cat-file", "-p", options.tagObject]);
  const tagger = payload.split("\n").find((line) => line.startsWith("tagger "));
  const email = tagger?.match(/<([^<>]+)>/u)?.[1];
  assertPublicEmail(email, "tagger");
}

function assertAdvertisedRefs(root: string, options: PublicHistoryVerificationOptions): void {
  const actual = new Map(parseLsRemote(gitRaw(root, ["ls-remote", "--refs", options.remote])));
  const expected = new Map([
    [`refs/heads/${options.branch}`, options.tipCommit],
    [`refs/tags/${options.tagName}`, options.tagObject]
  ]);
  assertExactRefs(actual, expected, "advertised ref");
}

function assertLocalRefs(root: string, options: PublicHistoryVerificationOptions): void {
  const actual = new Map(lines(gitRaw(root, [
    "for-each-ref",
    "--format=%(refname)%09%(objectname)",
    "refs/heads",
    "refs/remotes",
    "refs/tags"
  ])).map(parseRefLine));
  const expected = new Map([
    [`refs/heads/${options.branch}`, options.tipCommit],
    [`refs/tags/${options.tagName}`, options.tagObject]
  ]);
  const remoteBranch = `refs/remotes/${options.remote}/${options.branch}`;
  if (actual.has(remoteBranch)) expected.set(remoteBranch, options.tipCommit);
  const remoteHead = `refs/remotes/${options.remote}/HEAD`;
  if (actual.get(remoteHead) === options.tipCommit) expected.set(remoteHead, options.tipCommit);
  assertExactRefs(actual, expected, "local verification ref");
}

function assertReachableObjectTypes(root: string, options: PublicHistoryVerificationOptions): void {
  const objectIds = lines(gitRaw(root, ["rev-list", "--objects", "--all"]))
    .map((line) => line.split(" ", 1)[0]!)
    .filter(Boolean);
  const commits: string[] = [];
  const tags: string[] = [];
  for (const object of objectIds) {
    const type = git(root, ["cat-file", "-t", object]);
    if (type === "commit") commits.push(object);
    if (type === "tag") tags.push(object);
  }
  commits.sort();
  tags.sort();
  const expectedCommits = [options.rootCommit, options.tipCommit].sort();
  if (JSON.stringify(commits) !== JSON.stringify(expectedCommits)) {
    throw new Error("Public refs make an old or extra commit reachable");
  }
  if (JSON.stringify(tags) !== JSON.stringify([options.tagObject])) {
    throw new Error("Public refs make an old or extra tag object reachable");
  }
}

function commitParents(root: string, commit: string): string[] {
  const fields = git(root, ["rev-list", "--parents", "-n", "1", commit]).split(" ");
  if (fields[0] !== commit) throw new Error("Public history commit identity mismatch");
  return fields.slice(1).filter(Boolean);
}

function assertCommit(root: string, object: string, label: string): void {
  try {
    if (git(root, ["cat-file", "-t", object]) !== "commit") throw new Error();
  } catch {
    throw new Error(`Public history ${label} is not an available commit`);
  }
}

function assertObjectId(value: string, label: string): void {
  if (!objectIdPattern.test(value)) throw new Error(`Public history ${label} must be a full lowercase object ID`);
}

function assertPublicEmail(value: string | undefined, label: string): void {
  if (value === undefined || value.length === 0) throw new Error(`Public history ${label} email is missing`);
  if (value.toLowerCase().endsWith(".local")) throw new Error(`Public history ${label} email must not use .local`);
}

function tagHeaders(payload: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of payload.split("\n")) {
    if (line.length === 0) break;
    const separator = line.indexOf(" ");
    if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

function parseLsRemote(value: string): Array<[string, string]> {
  return lines(value).map((line) => {
    const [object, ref, ...rest] = line.split("\t");
    if (!objectIdPattern.test(object ?? "") || ref === undefined || rest.length !== 0) {
      throw new Error("Public remote advertised ref output is malformed");
    }
    return [ref, object!] as [string, string];
  });
}

function parseRefLine(line: string): [string, string] {
  const [ref, object, ...rest] = line.split("\t");
  if (ref === undefined || !objectIdPattern.test(object ?? "") || rest.length !== 0) {
    throw new Error("Public local ref output is malformed");
  }
  return [ref, object!] as [string, string];
}

function assertExactRefs(actual: Map<string, string>, expected: Map<string, string>, label: string): void {
  if (actual.size !== expected.size) throw new Error(`Public ${label} set contains an unexpected or missing ref`);
  for (const [ref, object] of expected) {
    if (actual.get(ref) !== object) throw new Error(`Public ${label} does not match approved metadata: ${ref}`);
  }
}

function lines(value: string): string[] {
  return value.split("\n").filter((line) => line.length > 0);
}

function git(root: string, args: string[]): string {
  return gitRaw(root, args).trim();
}

function gitRaw(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed`, { cause: error });
  }
}

function run(root: string, command: string, args: string[], label: string): void {
  try {
    execFileSync(command, args, { cwd: root, stdio: "inherit" });
  } catch (error) {
    throw new Error(label, { cause: error });
  }
}

function requiredOption(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function cliOptions(args: readonly string[]): PublicHistoryVerificationOptions {
  if (args.length !== 12) {
    throw new Error("usage: verify-public-history --remote <name> --root-commit <sha> --tip-commit <sha> --tag-name <name> --tag-object <id> --branch main");
  }
  const branch = requiredOption(args, "--branch");
  if (branch !== "main") throw new Error("--branch must be main");
  return {
    remote: requiredOption(args, "--remote"),
    rootCommit: requiredOption(args, "--root-commit"),
    tipCommit: requiredOption(args, "--tip-commit"),
    tagName: requiredOption(args, "--tag-name"),
    tagObject: requiredOption(args, "--tag-object"),
    branch,
    runGeneratedCheck: true
  };
}

async function main(): Promise<void> {
  const result = verifyPublicHistory(cliOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ status: "public-history-valid", ...result }, null, 2)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Public history verification failed"}\n`);
    process.exitCode = 1;
  });
}
