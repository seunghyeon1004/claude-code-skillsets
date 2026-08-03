import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const baselineSelectors = [
  "research/census-observed-at.txt",
  "research/census.json",
  "research/evaluation-context.json",
  "research/review-source-index.json",
  "research/sources",
  "research/receipts",
  "research/snapshots"
] as const;
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const governanceTagPattern = /^public-history\/root-v[1-9][0-9]*$/u;
const objectIdPattern = /^[0-9a-f]{40,64}$/u;

interface TreeEntry {
  mode: string;
  objectId: string;
  path: string;
}

export interface P03ImmutabilityResult {
  baselineCommit: string;
  baselineDigest: string;
  protectedPathCount: number;
}

export function assertP03Immutable(options: { root?: string; baselineRef?: string } = {}): P03ImmutabilityResult {
  const root = realRepositoryRoot(options.root ?? defaultRoot);
  const selected = selectBaseline(root, options.baselineRef);
  const baseline = readBaseline(root, selected);

  for (const entry of baseline) assertCurrentEntry(root, entry);

  return {
    baselineCommit: selected.commit,
    baselineDigest: selected.digest,
    protectedPathCount: baseline.length
  };
}

interface SelectedBaseline {
  ref: string;
  commit: string;
  digest: string;
}

function selectBaseline(root: string, publicBaselineRef: string | undefined): SelectedBaseline {
  if (publicBaselineRef !== undefined) {
    if (!objectIdPattern.test(publicBaselineRef)) {
      throw new Error("P03 public baseline must be a full lowercase object ID");
    }
    const commit = gitText(root, ["rev-parse", "--verify", `${publicBaselineRef}^{commit}`]);
    if (commit !== publicBaselineRef) throw new Error("P03 public baseline must resolve to its exact commit object ID");
    const output = gitBuffer(root, ["ls-tree", "-r", publicBaselineRef, "--", ...baselineSelectors]);
    return {
      ref: publicBaselineRef,
      commit,
      digest: createHash("sha256").update(output).digest("hex")
    };
  }
  return selectGovernanceTagBaseline(root);
}

function selectGovernanceTagBaseline(root: string): SelectedBaseline {
  const records = gitBuffer(root, [
    "for-each-ref",
    "--format=%(refname)%09%(objectname)%09%(objecttype)",
    "refs/tags/public-history/"
  ]).toString("utf8").split("\n").filter(Boolean);
  if (records.length !== 1) {
    throw new Error("P03 requires exactly one public-history governance tag");
  }

  const fields = records[0]!.split("\t");
  if (fields.length !== 3) throw new Error("P03 governance tag ref is malformed");
  const [ref, tagObject, objectType] = fields as [string, string, string];
  const tagName = ref.replace(/^refs\/tags\//u, "");
  if (!governanceTagPattern.test(tagName)) throw new Error("P03 governance tag name is invalid");
  if (!objectIdPattern.test(tagObject) || objectType !== "tag") {
    throw new Error("P03 governance tag must be annotated");
  }

  const headers = tagHeaders(gitBuffer(root, ["cat-file", "-p", tagObject]).toString("utf8"));
  if (headers.type !== "commit" || headers.tag !== tagName || !objectIdPattern.test(headers.object ?? "")) {
    throw new Error("P03 governance tag must directly authenticate its named root commit");
  }
  const commit = headers.object!;
  if (gitText(root, ["cat-file", "-t", commit]) !== "commit") {
    throw new Error("P03 governance tag target must be a commit");
  }
  if (gitText(root, ["rev-parse", "--verify", `${ref}^{commit}`]) !== commit) {
    throw new Error("P03 governance tag commit authentication failed");
  }
  if (gitText(root, ["rev-list", "--parents", "-n", "1", commit]).split(" ").length !== 1) {
    throw new Error("P03 governance tag must authenticate the parentless public root commit");
  }
  const currentRoots = gitBuffer(root, ["rev-list", "--max-parents=0", "HEAD"])
    .toString("utf8").split("\n").filter(Boolean);
  if (currentRoots.length !== 1) {
    throw new Error("P03 requires exactly one current HEAD root commit");
  }
  if (currentRoots[0] !== commit) {
    throw new Error("P03 governance tag must authenticate the current HEAD root commit");
  }

  const output = gitBuffer(root, ["ls-tree", "-r", commit, "--", ...baselineSelectors]);
  return {
    ref: commit,
    commit,
    digest: createHash("sha256").update(output).digest("hex")
  };
}

function tagHeaders(payload: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of payload.split("\n")) {
    if (line.length === 0) break;
    const separator = line.indexOf(" ");
    if (separator > 0) headers[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return headers;
}

function readBaseline(root: string, selected: SelectedBaseline): TreeEntry[] {
  const output = gitBuffer(root, ["ls-tree", "-r", selected.ref, "--", ...baselineSelectors]);
  if (createHash("sha256").update(output).digest("hex") !== selected.digest) {
    throw new Error("P03 baseline tree digest mismatch");
  }
  const lines = output.toString("utf8").split("\n");
  if (lines.pop() !== "") throw new Error("P03 baseline tree output is not newline terminated");
  const entries = lines.map(parseTreeEntry).sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error("P03 baseline contains duplicate protected paths");
  }
  return entries;
}

function parseTreeEntry(line: string): TreeEntry {
  const match = /^(\d{6}) blob ([0-9a-f]{40,64})\t(.+)$/.exec(line);
  if (match === null) throw new Error("P03 baseline tree entry is malformed");
  return { mode: match[1]!, objectId: match[2]!, path: match[3]! };
}

function assertCurrentEntry(root: string, entry: TreeEntry): void {
  const indexEntry = readIndexEntry(root, entry.path);
  if (indexEntry === undefined) {
    throw new Error(`P03 protected path is missing or is untracked: ${entry.path}`);
  }
  if (indexEntry.mode !== entry.mode || indexEntry.objectId !== entry.objectId) {
    throw new Error(`P03 protected tracked blob mismatch: ${entry.path}`);
  }

  const stats = protectedPathStats(root, entry.path);
  if (!stats.isFile()) throw new Error(`P03 protected path is missing or is not a regular file: ${entry.path}`);
  if (modeFor(stats.mode) !== entry.mode) throw new Error(`P03 protected path type or mode mismatch: ${entry.path}`);

  if (gitText(root, ["hash-object", "--no-filters", "--", entry.path]) !== entry.objectId) {
    throw new Error(`P03 protected working-tree blob mismatch: ${entry.path}`);
  }
}

function realRepositoryRoot(root: string): string {
  try {
    const realRoot = realpathSync(resolve(root));
    if (!lstatSync(realRoot).isDirectory()) throw new Error("not a directory");
    return realRoot;
  } catch {
    throw new Error("P03 repository root is missing or is not a directory");
  }
}

function protectedPathStats(root: string, path: string): Stats {
  const components = path.split("/");
  if (components.length === 0 || components.some((component) => component === "" || component === "." || component === "..")) {
    throw new Error(`P03 protected path escapes repository root: ${path}`);
  }

  let current = root;
  for (const [index, component] of components.entries()) {
    const next = join(current, component);
    if (!isContainedBy(root, next)) throw new Error(`P03 protected path escapes repository root: ${path}`);

    let stats: Stats;
    try {
      stats = lstatSync(next);
    } catch {
      throw new Error(`P03 protected path is missing or is not a regular file: ${path}`);
    }
    if (stats.isSymbolicLink()) {
      if (index === components.length - 1) throw new Error(`P03 protected path type or mode mismatch: ${path}`);
      throw new Error(`P03 protected path has a symlink ancestor: ${path}`);
    }
    if (index < components.length - 1 && !stats.isDirectory()) {
      throw new Error(`P03 protected path is missing or is not a regular file: ${path}`);
    }
    current = next;
    if (index === components.length - 1) return stats;
  }
  throw new Error(`P03 protected path escapes repository root: ${path}`);
}

function isContainedBy(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function readIndexEntry(root: string, path: string): Omit<TreeEntry, "path"> | undefined {
  const records = gitBuffer(root, ["ls-files", "--stage", "-z", "--", path]).toString("utf8")
    .split("\0").filter(Boolean);
  if (records.length !== 1) return undefined;
  const match = /^(\d{6}) ([0-9a-f]{40,64}) 0\t(.+)$/.exec(records[0]!);
  if (match === null || match[3] !== path) return undefined;
  return { mode: match[1]!, objectId: match[2]! };
}

function modeFor(mode: number): string {
  return mode & 0o111 ? "100755" : "100644";
}

function gitText(root: string, args: string[]): string {
  return gitBuffer(root, args).toString("utf8").trim();
}

function gitBuffer(root: string, args: string[]): Buffer {
  try {
    return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error(`P03 Git command failed: ${args.join(" ")}`);
  }
}

function cliOptions(args: readonly string[]): { root: string; baselineRef?: string } {
  let root = defaultRoot;
  let publicBaselineRef: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined || (option !== "--root" && option !== "--baseline-ref") || seen.has(option)) {
      throw new Error("usage: assert-p03-immutable.ts [--root <repository-path>] [--baseline-ref <full-object-id>]");
    }
    seen.add(option);
    if (option === "--root") root = resolve(value);
    else publicBaselineRef = value;
  }
  return { root, baselineRef: publicBaselineRef };
}

function isCliEntrypoint(argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(resolve(argvPath))).href;
  } catch {
    throw new Error("P03 CLI entrypoint path cannot be resolved");
  }
}

function runCli(): void {
  try {
    if (!isCliEntrypoint(process.argv[1])) return;
    const result = assertP03Immutable(cliOptions(process.argv.slice(2)));
    process.stdout.write(`P03 immutable: ${result.protectedPathCount} paths at ${result.baselineCommit}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "P03 immutable verification failed"}\n`);
    process.exitCode = 1;
  }
}

runCli();
