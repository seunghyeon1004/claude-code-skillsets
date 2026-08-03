import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdtemp, open, readFile, realpath, rm, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  validateResearchCollectionReceipt,
  validateResearchSnapshot,
  validateResearchSourceConfig
} from "../../src/contracts/complete-v1.js";
import type {
  ResearchCollectionReceipt,
  ResearchSnapshot,
  ResearchSourceConfig
} from "../../src/model/complete-v1.js";
import {
  classifyTree,
  independentCounts,
  isMarketplacePath
} from "../../src/research/classify.js";
import {
  computeSnapshotContentSha256,
  verifyResearchSnapshot
} from "../../src/research/snapshot.js";
import {
  collectObservationEvidence,
  writeObservationEvidenceToStaging
} from "../../src/research/observation-collector.js";
import {
  isSafeRepositoryRelativePath,
  type GitTreeBlob,
  type ObservationEvidence
} from "../../src/model/observation.js";

const REQUIRED_FLAGS = ["--config", "--observed-at", "--output", "--receipt"] as const;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const HTTPS_GITHUB_REPOSITORY_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u;

export interface GitTreeTransport {
  resolveHead(repository: string): Promise<{ ref: string; commit: string }>;
  listPaths(repository: string, commit: string): Promise<string[]>;
  listBlobs(repository: string, commit: string): Promise<GitTreeBlob[]>;
  readBlob(repository: string, commit: string, path: string): Promise<Buffer>;
  dispose(): Promise<void>;
}

export type GitCommandRunner = (args: readonly string[], cwd?: string) => Promise<Buffer>;

export async function collectResearchSource(input: {
  config: ResearchSourceConfig;
  snapshotId: string;
  observedAt: string;
  toolVersion: string;
  transport: GitTreeTransport;
}): Promise<{ snapshot: ResearchSnapshot; receipt: ResearchCollectionReceipt }> {
  try {
    const { ref, commit } = await input.transport.resolveHead(input.config.repository);
    if (!COMMIT_SHA_PATTERN.test(commit)) {
      throw new Error(`${input.config.sourceId}: unresolved commit`);
    }
    const paths = await input.transport.listPaths(input.config.repository, commit);
    const marketplaceDocuments = new Map<string, unknown>();
    const markdownDocuments = new Map<string, string>();

    for (const path of paths.filter(isMarketplacePath)) {
      try {
        marketplaceDocuments.set(
          path,
          JSON.parse((await input.transport.readBlob(input.config.repository, commit, path)).toString("utf8"))
        );
      } catch {
        throw new Error(`${path}: invalid marketplace JSON`);
      }
    }
    for (const path of input.config.markdownIndexPaths) {
      if (!paths.includes(path)) {
        throw new Error(`${input.config.sourceId}: missing configured Markdown index ${path}`);
      }
      markdownDocuments.set(path, (await input.transport.readBlob(input.config.repository, commit, path)).toString("utf8"));
    }

    const entries = classifyTree(paths, marketplaceDocuments, markdownDocuments, input.config);
    const countMetrics = independentCounts(entries, input.config);
    const snapshot: ResearchSnapshot = {
      schemaVersion: 2,
      id: input.snapshotId,
      sourceUrl: input.config.repository,
      queryUrls: input.config.queryUrls,
      observedAt: input.observedAt,
      inspectedRef: ref,
      inspectedCommit: commit,
      collectionMethod: "git-tree-and-marketplace-v1",
      toolVersion: input.toolVersion,
      entries,
      countMetrics,
      contentSha256: computeSnapshotContentSha256(entries)
    };
    verifyResearchSnapshot(snapshot);
    const receipt: ResearchCollectionReceipt = {
      schemaVersion: 2,
      id: snapshot.id,
      sourceId: input.config.sourceId,
      snapshotId: snapshot.id,
      observedAt: input.observedAt,
      inspectedCommit: commit,
      collectorVersion: input.toolVersion,
      independentCounts: independentCounts(entries, input.config).map(({ kind, independentlyCountedTotal: count }) => ({ kind, count })),
      snapshotContentSha256: snapshot.contentSha256
    };
    return { snapshot, receipt };
  } finally {
    await input.transport.dispose();
  }
}

export async function collectAndStageObservationEvidence(input: {
  config: ResearchSourceConfig;
  observationId: string;
  observedAt: string;
  stagingDirectory: string;
  transport: GitTreeTransport;
  afterCollection?: (input: {
    commit: string;
    readBlob(path: string): Promise<Buffer>;
  }) => Promise<void>;
}): Promise<ObservationEvidence> {
  try {
    const { commit } = await input.transport.resolveHead(input.config.repository);
    if (!COMMIT_SHA_PATTERN.test(commit)) throw new Error(`${input.config.sourceId}: unresolved commit`);
    const evidence = await collectObservationEvidence({
      id: input.observationId,
      sourceId: input.config.sourceId,
      observedAt: input.observedAt,
      inspectedCommit: commit,
      blobs: await input.transport.listBlobs(input.config.repository, commit),
      readBlob: (path) => input.transport.readBlob(input.config.repository, commit, path)
    });
    await writeObservationEvidenceToStaging({ evidence, stagingDirectory: input.stagingDirectory });
    await input.afterCollection?.({
      commit,
      readBlob: (path) => input.transport.readBlob(input.config.repository, commit, path)
    });
    return evidence;
  } finally {
    await input.transport.dispose();
  }
}

export class GitCliTransport implements GitTreeTransport {
  private cloneRoot: string | undefined;
  private clonedCommit: string | undefined;

  public constructor(
    private readonly repository: string,
    private readonly commandRunner: GitCommandRunner = runGit
  ) {
    assertHttpsGitHubRepository(repository);
  }

  public async resolveHead(repository: string): Promise<{ ref: string; commit: string }> {
    this.assertRepository(repository);
    const output = (await this.commandRunner(["ls-remote", "--symref", repository, "HEAD"])).toString("utf8");
    const refMatch = output.match(/^ref:\s+(refs\/[^\s]+)\s+HEAD$/mu);
    const commitMatch = output.match(/^([a-f0-9]{40})\s+HEAD$/mu);
    if (refMatch?.[1] === undefined || commitMatch?.[1] === undefined) {
      throw new Error(`${repository}: unable to resolve symbolic HEAD`);
    }
    return { ref: refMatch[1], commit: commitMatch[1] };
  }

  public async listPaths(repository: string, commit: string): Promise<string[]> {
    await this.ensureClone(repository, commit);
    const output = await this.commandRunner(["ls-tree", "-rz", "--name-only", commit], this.cloneRoot);
    return splitNulTerminatedPaths(output);
  }

  public async listBlobs(repository: string, commit: string): Promise<GitTreeBlob[]> {
    await this.ensureClone(repository, commit);
    const output = await this.commandRunner(["ls-tree", "-rz", "-l", commit], this.cloneRoot);
    return parseNulTerminatedBlobEntries(output);
  }

  public async readBlob(repository: string, commit: string, path: string): Promise<Buffer> {
    await this.ensureClone(repository, commit);
    assertRepositoryRelativePath(path);
    return this.commandRunner(["show", `${commit}:${path}`], this.cloneRoot);
  }

  public async dispose(): Promise<void> {
    const cloneRoot = this.cloneRoot;
    this.cloneRoot = undefined;
    this.clonedCommit = undefined;
    if (cloneRoot !== undefined) {
      await rm(cloneRoot, { recursive: true, force: true });
    }
  }

  private async ensureClone(repository: string, commit: string): Promise<void> {
    this.assertRepository(repository);
    if (!COMMIT_SHA_PATTERN.test(commit)) {
      throw new Error(`${repository}: unresolved commit`);
    }
    if (this.cloneRoot !== undefined) {
      if (this.clonedCommit !== commit) {
        throw new Error(`${repository}: transport is pinned to a different commit`);
      }
      return;
    }

    this.cloneRoot = await mkdtemp(join(tmpdir(), "claude-code-skillsets-research-"));
    this.clonedCommit = commit;
    await this.commandRunner(["init"], this.cloneRoot);
    await this.commandRunner(["remote", "add", "origin", repository], this.cloneRoot);
    await this.commandRunner(["fetch", "--depth=1", "--no-tags", "origin", commit], this.cloneRoot);
  }

  private assertRepository(repository: string): void {
    if (repository !== this.repository) {
      throw new Error("Git transport repository does not match the configured repository");
    }
  }
}

export function createGitCliTransport(repository: string, commandRunner: GitCommandRunner): GitCliTransport {
  return new GitCliTransport(repository, commandRunner);
}

interface CollectorArguments {
  config: string;
  observedAt: string;
  output: string;
  receipt: string;
}

export async function main(args: readonly string[]): Promise<void> {
  const argumentsByName = parseCollectorArguments(args);
  assertRfc3339Utc(argumentsByName.observedAt);
  const config = validateResearchSourceConfig(JSON.parse(await readFile(argumentsByName.config, "utf8")));
  assertHttpsGitHubRepository(config.repository);
  const output = await resolveSafeOutputPath(argumentsByName.output, "output");
  const receipt = await resolveSafeOutputPath(argumentsByName.receipt, "receipt");
  if (output === receipt) {
    throw new Error("Collector output and receipt paths must differ");
  }
  await assertPathDoesNotExist(output, "output");
  await assertPathDoesNotExist(receipt, "receipt");

  const snapshotId = basename(output).slice(0, -".json".length);
  const expectedSnapshotId = `2026-07-23-${config.sourceId}`;
  if (snapshotId !== expectedSnapshotId) {
    throw new Error(`Output basename must be ${expectedSnapshotId}.json`);
  }

  const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json: version must be a string");
  }

  const result = await collectResearchSource({
    config,
    snapshotId,
    observedAt: argumentsByName.observedAt,
    toolVersion: packageJson.version,
    transport: new GitCliTransport(config.repository)
  });
  verifyResearchSnapshot(result.snapshot);
  validateResearchSnapshot(result.snapshot);
  const independentlyCounted = independentCounts(result.snapshot.entries, config)
    .map(({ kind, independentlyCountedTotal: count }) => ({ kind, count }));
  if (JSON.stringify(result.receipt.independentCounts) !== JSON.stringify(independentlyCounted)) {
    throw new Error("Collector receipt counts do not match an independent recount");
  }
  validateResearchCollectionReceipt(result.receipt);
  await writeSnapshotAndReceiptAtomically(output, receipt, result.snapshot, result.receipt);
}

function parseCollectorArguments(args: readonly string[]): CollectorArguments {
  if (args.length !== REQUIRED_FLAGS.length * 2) {
    throw new Error("Expected exactly --config, --observed-at, --output, and --receipt");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || value === undefined || !(REQUIRED_FLAGS as readonly string[]).includes(flag)) {
      throw new Error("Unexpected collector argument");
    }
    if (value.length === 0 || value.startsWith("--") || values.has(flag)) {
      throw new Error(`Invalid collector argument for ${flag}`);
    }
    values.set(flag, value);
  }
  return {
    config: values.get("--config")!,
    observedAt: values.get("--observed-at")!,
    output: values.get("--output")!,
    receipt: values.get("--receipt")!
  };
}

export async function resolveSafeOutputPath(
  value: string,
  kind: "output" | "receipt",
  root = process.cwd()
): Promise<string> {
  if (value.includes("\0") || isAbsolute(value) || !value.endsWith(".json")) {
    throw new Error(`Unsafe ${kind} path`);
  }
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new Error(`Unsafe ${kind} path: root directory does not exist`);
  }
  const output = resolve(realRoot, value);
  const relativeOutput = relative(realRoot, output);
  if (relativeOutput.length === 0 || relativeOutput === ".." || relativeOutput.startsWith(`..${sep}`) || isAbsolute(relativeOutput)) {
    throw new Error(`Unsafe ${kind} path`);
  }
  const parent = dirname(output);
  let realParent: string;
  try {
    realParent = await realpath(parent);
  } catch {
    throw new Error(`Unsafe ${kind} path: parent directory does not exist`);
  }
  const relativeParent = relative(realRoot, realParent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent)) {
    throw new Error(`Unsafe ${kind} path: parent directory escapes root`);
  }
  let parentStats: Awaited<ReturnType<typeof lstat>>;
  try {
    parentStats = await lstat(realParent);
  } catch {
    throw new Error(`Unsafe ${kind} path: parent directory does not exist`);
  }
  if (!parentStats.isDirectory()) {
    throw new Error(`Unsafe ${kind} path: parent must be a regular directory`);
  }
  return join(realParent, basename(output));
}

async function assertPathDoesNotExist(path: string, kind: "output" | "receipt"): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (isErrnoCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  throw new Error(`Refusing to overwrite existing ${kind}: ${path}`);
}

export async function writeSnapshotAndReceiptAtomically(
  output: string,
  receiptPath: string,
  snapshot: ResearchSnapshot,
  receipt: ResearchCollectionReceipt,
  options: { beforePublish?: () => Promise<void> | void } = {}
): Promise<void> {
  const snapshotTemp = siblingTemporaryPath(output);
  const receiptTemp = siblingTemporaryPath(receiptPath);
  let renamedSnapshot = false;
  let renamedReceipt = false;
  try {
    await writePrivateFile(snapshotTemp, `${JSON.stringify(snapshot, null, 2)}\n`);
    await writePrivateFile(receiptTemp, `${JSON.stringify(receipt, null, 2)}\n`);
    verifyResearchSnapshot(snapshot);
    await assertPathDoesNotExist(output, "output");
    await assertPathDoesNotExist(receiptPath, "receipt");
    await options.beforePublish?.();
    await link(snapshotTemp, output);
    renamedSnapshot = true;
    await link(receiptTemp, receiptPath);
    renamedReceipt = true;
    await unlink(snapshotTemp);
    await unlink(receiptTemp);
  } catch (error) {
    await Promise.all([
      removeIfPresent(snapshotTemp),
      removeIfPresent(receiptTemp),
      renamedSnapshot ? removeIfPresent(output) : Promise.resolve(),
      renamedReceipt ? removeIfPresent(receiptPath) : Promise.resolve()
    ]);
    throw error;
  }
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function siblingTemporaryPath(path: string): string {
  return join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
}

async function removeIfPresent(path: string): Promise<void> {
  await rm(path, { force: true });
}

function assertHttpsGitHubRepository(repository: string): void {
  if (!HTTPS_GITHUB_REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Repository must be an HTTPS GitHub repository: ${repository}`);
  }
}

function assertRepositoryRelativePath(path: string): void {
  if (!isSafeRepositoryRelativePath(path)) {
    throw new Error("Unsafe repository path: " + path);
  }
}

function assertRfc3339Utc(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?Z$/u.exec(value);
  if (match === null) {
    throw new Error("observed-at must be an RFC3339 UTC timestamp");
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) {
    throw new Error("observed-at must be an RFC3339 UTC timestamp");
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function splitNulTerminatedPaths(output: Buffer): string[] {
  const paths: string[] = [];
  let start = 0;
  while (start < output.length) {
    const end = output.indexOf(0, start);
    if (end === -1) {
      throw new Error("git ls-tree returned a non-NUL-terminated path list");
    }
    paths.push(output.subarray(start, end).toString("utf8"));
    start = end + 1;
  }
  return paths;
}

function parseNulTerminatedBlobEntries(output: Buffer): GitTreeBlob[] {
  const entries: GitTreeBlob[] = [];
  let start = 0;
  while (start < output.length) {
    const end = output.indexOf(0, start);
    if (end === -1) throw new Error("git ls-tree returned a non-NUL-terminated blob list");
    const record = output.subarray(start, end).toString("utf8");
    const match = /^(?:100644|100755|120000) blob ([a-f0-9]{40}) +(\d+)\t([\s\S]+)$/u.exec(record);
    if (match === null) {
      const nonBlob = /^(?:040000 tree|160000 commit) [a-f0-9]{40} +-\t([\s\S]+)$/u.exec(record);
      if (nonBlob === null) throw new Error("git ls-tree returned an invalid blob entry");
      assertRepositoryRelativePath(nonBlob[1]!);
      start = end + 1;
      continue;
    }
    const path = match[3]!;
    assertRepositoryRelativePath(path);
    const byteSize = Number(match[2]);
    if (!Number.isSafeInteger(byteSize)) throw new Error("git ls-tree returned an invalid blob byte size");
    entries.push({ path, gitBlobSha: match[1]!, byteSize });
    start = end + 1;
  }
  return entries;
}

function runGit(args: readonly string[], cwd?: string): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout));
        return;
      }
      rejectPromise(new Error(`git ${args.join(" ")} failed with exit code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
