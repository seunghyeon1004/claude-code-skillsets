import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inc, valid } from "semver";
import { parseDocument } from "yaml";
import {
  catalogRefreshBranchName,
  refreshCatalog,
  type CatalogRefreshAdapters,
  type RefreshRequest,
  type RefreshResult,
  type RefreshSource
} from "../../src/research/refresh.js";
import { validateResearchSourceConfig } from "../../src/contracts/complete-v1.js";
import { loadOfficialMarketplaceSelection } from "../../src/discovery/official-marketplace.js";
import type { ResearchSourceConfig } from "../../src/model/complete-v1.js";
import { DELEGATED_OFFICIAL_SOURCE_IDS } from "../../src/research/source-review-backlog.js";
import {
  collectAndStageObservationEvidence,
  GitCliTransport
} from "./collect-github-tree.js";
import { stageOfficialMarketplaceObservation } from "./stage-official-marketplace.js";

const execFileAsync = promisify(execFile);
const catalogSelectors = [
  ".claude-plugin/marketplace.json",
  "generated/catalog.en.md",
  "generated/catalog.ko.md",
  "generated/decision-index.json",
  "generated/install-index.json",
  "generated/official-marketplace-index.json",
  "manifests/official-listing-capability-claims.yaml",
  "manifests/plugins/skillset-manager.yaml",
  "plugins/skillset-manager/.claude-plugin/plugin.json",
  "plugins/skillset-manager/data/decision-index.json",
  "plugins/skillset-manager/data/decision-index-history",
  "plugins/skillset-manager/data/install-index.json",
  "plugins/skillset-manager/data/official-marketplace-index.json",
  "research/materialized-review-state.json",
  "research/observation-evidence",
  "research/marketplaces",
  "research/official-marketplace-review-backlog.json",
  "research/source-diffs.json",
  "research/source-observations.json",
  "research/source-review-backlog.json"
] as const;

export interface CommandRunner {
  command(file: string, args: readonly string[], cwd: string, env?: Readonly<Record<string, string>>): Promise<Buffer>;
}

export interface RefreshSourceAdapter {
  listTrackedSources(root: string): Promise<readonly ResearchSourceConfig[]>;
  collect(input: {
    source: ResearchSourceConfig;
    observedAt: string;
    stagingRoot: string;
  }): Promise<{
    officialMarketplace: {
      inspectedCommit: string;
      manifestBytes: Buffer;
    };
  } | void>;
}

export interface RefreshCliInput {
  root: string;
  observedAt: string;
  githubRunId: string;
  stagingParent: string;
  artifactDirectory: string;
  expectedBaseSha: string;
  commands: CommandRunner;
  sources?: RefreshSourceAdapter;
}

export interface CatalogDeliveryResult {
  changed: boolean;
  previousVersion: string;
  nextVersion: string;
}

/** Preserves changed index bytes and makes the reviewed manager catalog updateable. */
export async function prepareCatalogDelivery(input: {
  root: string;
  previousDecisionIndexRaw: string;
}): Promise<CatalogDeliveryResult> {
  const root = resolve(input.root);
  const generatedPath = join(root, "generated", "decision-index.json");
  const pluginPath = join(root, "plugins", "skillset-manager", "data", "decision-index.json");
  const [generatedRaw, pluginRaw] = await Promise.all([
    readFile(generatedPath, "utf8"),
    readFile(pluginPath, "utf8")
  ]);
  if (generatedRaw !== pluginRaw) throw new Error("Generated and plugin decision indexes must have exact byte parity");

  const manifestPath = join(root, "manifests", "plugins", "skillset-manager.yaml");
  const pluginManifestPath = join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json");
  const [manifestRaw, pluginManifestRaw] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(pluginManifestPath, "utf8")
  ]);
  const manifest = parseDocument(manifestRaw);
  const previousVersion = manifest.get("version");
  const pluginManifest = JSON.parse(pluginManifestRaw) as { version?: unknown; description?: unknown };
  if (typeof previousVersion !== "string" || valid(previousVersion) === null
    || pluginManifest.version !== previousVersion) {
    throw new Error("Manager manifest versions must be aligned semantic versions");
  }
  const descriptionEn = manifest.getIn(["description", "en"]);
  const descriptionKo = manifest.getIn(["description", "ko"]);
  if (typeof descriptionEn !== "string" || typeof descriptionKo !== "string") {
    throw new Error("Manager manifest must expose a bilingual description");
  }
  const synchronizedDescription = `${descriptionEn} / ${descriptionKo}`;
  if (generatedRaw === input.previousDecisionIndexRaw) {
    if (pluginManifest.description !== synchronizedDescription) {
      pluginManifest.description = synchronizedDescription;
      await writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");
    }
    return { changed: false, previousVersion, nextVersion: previousVersion };
  }

  const previousIndex = JSON.parse(input.previousDecisionIndexRaw) as { digest?: unknown };
  if (typeof previousIndex.digest !== "string" || !/^[0-9a-f]{64}$/u.test(previousIndex.digest)) {
    throw new Error("Previous decision index must expose its authenticated digest");
  }
  const historyDirectory = join(root, "plugins", "skillset-manager", "data", "decision-index-history");
  await mkdir(historyDirectory, { recursive: true });
  const historyPath = join(historyDirectory, `${previousIndex.digest}.json`);
  try {
    await writeFile(historyPath, input.previousDecisionIndexRaw, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST"
      || await readFile(historyPath, "utf8") !== input.previousDecisionIndexRaw) throw error;
  }

  const nextVersion = inc(previousVersion, "patch");
  if (nextVersion === null) throw new Error("Manager version cannot be incremented");
  manifest.set("version", nextVersion);
  pluginManifest.version = nextVersion;
  pluginManifest.description = synchronizedDescription;
  await Promise.all([
    writeFile(manifestPath, manifest.toString({ lineWidth: 0 }), "utf8"),
    writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8")
  ]);
  return { changed: true, previousVersion, nextVersion };
}

/** Stages and validates a new v3 observation batch, then emits a content-addressed Git bundle. */
export async function runCatalogRefresh(input: RefreshCliInput): Promise<RefreshResult> {
  const root = resolve(input.root);
  const localSha = await gitText(root, input.commands, ["rev-parse", "HEAD"]);
  if (localSha !== input.expectedBaseSha) throw new Error("Checked out commit does not match the workflow base SHA");
  const localDigest = await catalogDigest(root);
  const initial = { sha: localSha, catalogDigest: localDigest };

  const sourceAdapter = input.sources ?? defaultSourceAdapter;
  const sourceConfigs = await sourceAdapter.listTrackedSources(root);
  assertTrackedSources(sourceConfigs);
  const branch = catalogRefreshBranchName(initial.catalogDigest, input.githubRunId);
  const stagingParent = await realDirectory(input.stagingParent, "Catalog refresh staging parent");
  const request: RefreshRequest = {
    observedAt: input.observedAt,
    baseSha: initial.sha,
    baseCatalogDigest: initial.catalogDigest,
    stagingRoot: stagingParent
  };
  const sources: RefreshSource[] = [...sourceConfigs]
    .sort((left, right) => compare(left.sourceId, right.sourceId))
    .map((source) => ({
      id: source.sourceId,
      collect: async ({ observedAt, stagingRoot }) => {
        const result = await sourceAdapter.collect({ source, observedAt, stagingRoot });
        if (source.sourceId === "anthropic-plugins-official") {
          if (result === undefined) throw new Error("Official marketplace collection did not capture its manifest");
          await stageOfficialMarketplaceObservation({
            root: stagingRoot,
            observedAt,
            ...result.officialMarketplace
          });
        } else if (result !== undefined) {
          throw new Error(`Unexpected official marketplace capture from ${source.sourceId}`);
        }
      }
    }));

  const adapters: CatalogRefreshAdapters = {
    createStagingRoot: (parent) => createStagingRoot({
      root,
      parent,
      baseSha: initial.sha,
      commands: input.commands
    }),
    removeStagingRoot: (stagingRoot) => removeStagingRoot({ root, stagingRoot, commands: input.commands }),
    prepareStaging: async (stagingRoot) => {
      await input.commands.command("npm", ["ci"], stagingRoot);
      await input.commands.command("npm", ["run", "check"], stagingRoot);
    },
    generateCatalog: async ({ stagingRoot, observedAt }) => {
      const previousDecisionIndexRaw = await readFile(
        join(stagingRoot, "plugins", "skillset-manager", "data", "decision-index.json"),
        "utf8"
      );
      await input.commands.command("npm", ["run", "research:materialize-source-review-backlog"], stagingRoot);
      await input.commands.command("npm", ["run", "research:materialize-decision", "--", "--as-of", observedAt], stagingRoot);
      await input.commands.command("npm", ["run", "generate"], stagingRoot);
      const delivery = await prepareCatalogDelivery({ root: stagingRoot, previousDecisionIndexRaw });
      if (delivery.changed) await input.commands.command("npm", ["run", "generate"], stagingRoot);
    },
    digestCatalog: async (stagingRoot) => {
      await assertOnlyCatalogPathsDirty(root, stagingRoot, input.commands);
      return catalogDigest(stagingRoot);
    },
    prepareCandidate: async ({ stagingRoot }) => {
      const changedPaths = await changedCatalogPaths(root, stagingRoot);
      await input.commands.command("git", ["switch", "--create", branch], stagingRoot);
      await input.commands.command("git", ["add", "--", ...changedPaths], stagingRoot);
      await input.commands.command(
        "git",
        [
          "-c", "user.name=github-actions[bot]",
          "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
          "commit", "--signoff", "-m", "chore: refresh research catalog"
        ],
        stagingRoot
      );
      return { changedPaths, publish: true };
    },
    runReleaseGates: async ({ stagingRoot, observedAt }) => {
      const reviewRequired = loadOfficialMarketplaceSelection(stagingRoot).state === "review-required";
      const candidateEnvironment = {
        REGISTRY_APPROVAL_MODE: "pre-approval-candidate",
        APPEND_BASE: request.baseSha,
        LEDGER_APPEND_BASE: request.baseSha,
        CATALOG_REFRESH_CANDIDATE: reviewRequired ? "true" : "false"
      } as const;
      await input.commands.command("bash", [
        "scripts/research/require-registry-anchor-input.sh",
        "--mode", "pre-approval-candidate",
        "--base", request.baseSha
      ], stagingRoot);
      await input.commands.command("npm", [
        "run", "verify:research-append-only", "--",
        "--base", request.baseSha,
        "--approval-mode", "pre-approval-candidate"
      ], stagingRoot);
      await input.commands.command("npm", [
        "run", "verify:review-ledger-append-only", "--", "--base", request.baseSha
      ], stagingRoot);
      await input.commands.command("npm", [
        "run", "verify:official-claims-append-only", "--", "--base", request.baseSha
      ], stagingRoot);
      await input.commands.command("npm", [
        "run", "verify:decision-index-history", "--", "--previous-ref", request.baseSha
      ], stagingRoot);
      await input.commands.command("npm", ["run", "research:materialize-decision", "--", "--check", "--as-of", observedAt], stagingRoot);
      await input.commands.command("npm", ["run", reviewRequired ? "check:catalog-refresh" : "check"], stagingRoot);
      await input.commands.command("npm", ["run", "verify:broker-only"], stagingRoot);
      await input.commands.command("bash", ["tests/e2e/clean-copy.sh"], stagingRoot, candidateEnvironment);
    },
    readRemoteMain: async () => ({
      sha: await gitText(root, input.commands, ["rev-parse", "HEAD"]),
      catalogDigest: await catalogDigest(root)
    }),
    publishValidatedArtifacts: async ({ stagingRoot, resultDigest, candidate }) => {
      if (!candidate.publish) throw new Error("Refusing to publish a no-op catalog refresh candidate");
      await writeValidatedArtifact({
        artifactDirectory: input.artifactDirectory,
        stagingRoot,
        baseSha: request.baseSha,
        baseDigest: request.baseCatalogDigest,
        resultDigest,
        branch,
        commands: input.commands
      });
    }
  };

  return refreshCatalog({ request, sources, adapters });
}

async function writeValidatedArtifact(input: {
  artifactDirectory: string;
  stagingRoot: string;
  baseSha: string;
  baseDigest: string;
  resultDigest: string;
  branch: string;
  commands: CommandRunner;
}): Promise<void> {
  const artifactDirectory = await realDirectory(input.artifactDirectory, "Catalog refresh artifact directory");
  if ((await readdir(artifactDirectory)).length !== 0) throw new Error("Catalog refresh artifact directory must be empty");
  const candidateSha = await gitText(input.stagingRoot, input.commands, ["rev-parse", "HEAD"]);
  await input.commands.command("git", ["merge-base", "--is-ancestor", input.baseSha, candidateSha], input.stagingRoot);
  const bundlePath = join(artifactDirectory, "candidate.bundle");
  await input.commands.command("git", ["bundle", "create", bundlePath, "HEAD"], input.stagingRoot);
  const bundleDigest = createHash("sha256").update(await readFile(bundlePath)).digest("hex");
  const files = {
    "base-sha": input.baseSha,
    "candidate-sha": candidateSha,
    "branch": input.branch,
    "base-digest": input.baseDigest,
    "result-digest": input.resultDigest,
    "candidate.bundle.sha256": `${bundleDigest}  candidate.bundle`
  } as const;
  await Promise.all(Object.entries(files).map(([name, value]) => writeFile(
    join(artifactDirectory, name),
    `${value}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  )));
}

const defaultSourceAdapter: RefreshSourceAdapter = {
  listTrackedSources: loadTrackedSources,
  async collect({ source, observedAt, stagingRoot }) {
    const stagingDirectory = join(stagingRoot, "research", "observation-evidence");
    await mkdir(stagingDirectory, { recursive: true });
    let officialMarketplace: { inspectedCommit: string; manifestBytes: Buffer } | undefined;
    await collectAndStageObservationEvidence({
      config: source,
      observationId: observationId(source.sourceId, observedAt),
      observedAt,
      stagingDirectory,
      transport: new GitCliTransport(source.repository, runSanitizedGit),
      ...(source.sourceId === "anthropic-plugins-official" ? {
        afterCollection: async ({ commit, readBlob }: {
          commit: string;
          readBlob(path: string): Promise<Buffer>;
        }) => {
          officialMarketplace = {
            inspectedCommit: commit,
            manifestBytes: await readBlob(".claude-plugin/marketplace.json")
          };
        }
      } : {})
    });
    return officialMarketplace === undefined ? undefined : { officialMarketplace };
  }
};

async function loadTrackedSources(root: string): Promise<ResearchSourceConfig[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", "research/sources"],
    { cwd: root, encoding: "buffer", env: childEnvironment() }
  );
  const paths = Buffer.from(stdout).toString("utf8").split("\0")
    .filter((path) => /^research\/sources\/[^/]+\.json$/u.test(path))
    .sort(compare);
  return Promise.all(paths.map(async (path) => {
    const { stdout: document } = await execFileAsync("git", ["show", `HEAD:${path}`], {
      cwd: root,
      encoding: "buffer",
      env: childEnvironment()
    });
    return validateResearchSourceConfig(JSON.parse(Buffer.from(document).toString("utf8")) as unknown);
  }));
}

function assertTrackedSources(sources: readonly ResearchSourceConfig[]): void {
  if (sources.length === 0) throw new Error("Catalog refresh requires tracked research source configs");
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.sourceId)) throw new Error(`Duplicate tracked research source: ${source.sourceId}`);
    ids.add(source.sourceId);
  }
  for (const sourceId of DELEGATED_OFFICIAL_SOURCE_IDS) {
    if (!ids.has(sourceId)) throw new Error(`Catalog refresh is missing official marketplace source: ${sourceId}`);
  }
}

function observationId(sourceId: string, observedAt: string): string {
  return `observation-${observedAt.replace(/[^0-9]/gu, "")}-${sourceId}`;
}

async function createStagingRoot(input: {
  root: string;
  parent: string;
  baseSha: string;
  commands: CommandRunner;
}): Promise<string> {
  const parent = await realDirectory(input.parent, "Catalog refresh staging parent");
  const allocatedRoot = await mkdtemp(join(parent, "catalog-refresh-"));
  try {
    await rm(allocatedRoot, { recursive: true, force: true });
    await input.commands.command("git", ["worktree", "add", "--detach", allocatedRoot, input.baseSha], input.root);
    const stagingRoot = await realDirectory(allocatedRoot, "Catalog refresh staging root");
    assertRealChild(parent, stagingRoot, "Catalog refresh staging root");
    return stagingRoot;
  } catch (error) {
    await removeStagingRoot({ root: input.root, stagingRoot: allocatedRoot, commands: input.commands }).catch(() => undefined);
    throw error;
  }
}

async function removeStagingRoot(input: { root: string; stagingRoot: string; commands: CommandRunner }): Promise<void> {
  let worktreeError: unknown;
  try {
    await input.commands.command("git", ["worktree", "remove", "--force", input.stagingRoot], input.root);
  } catch (error) {
    worktreeError = error;
  }
  try {
    await rm(input.stagingRoot, { recursive: true, force: true });
  } catch (error) {
    if (worktreeError !== undefined) {
      throw new AggregateError([worktreeError, error], "Catalog refresh staging cleanup failed");
    }
    throw error;
  }
  if (worktreeError !== undefined) throw worktreeError;
}

async function realDirectory(path: string, label: string): Promise<string> {
  const resolved = resolve(path);
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    throw new Error(`${label} must exist`);
  }
  const entry = await lstat(real);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a regular directory`);
  return real;
}

function assertRealChild(parent: string, child: string, label: string): void {
  const relation = relative(parent, child);
  if (relation.length === 0 || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} must be a unique real child of its requested parent`);
  }
}

async function catalogDigest(root: string): Promise<string> {
  const paths = await catalogPaths(root);
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(createHash("sha256").update(await readFile(join(root, path))).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function catalogPaths(root: string): Promise<string[]> {
  const paths = new Set<string>();
  for (const selector of catalogSelectors) {
    await collectCatalogPaths(root, selector, paths);
  }
  return [...paths].sort(compare);
}

async function collectCatalogPaths(root: string, path: string, paths: Set<string>): Promise<void> {
  const absolute = join(root, path);
  let entry: Awaited<ReturnType<typeof stat>>;
  try {
    entry = await stat(absolute);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (entry.isFile()) {
    paths.add(path);
    return;
  }
  if (!entry.isDirectory()) throw new Error(`Catalog selector must be a regular file or directory: ${path}`);
  for (const name of (await readdir(absolute)).sort(compare)) {
    await collectCatalogPaths(root, join(path, name), paths);
  }
}

async function changedCatalogPaths(root: string, stagingRoot: string): Promise<string[]> {
  const basePaths = await catalogPaths(root);
  const stagedPaths = await catalogPaths(stagingRoot);
  const changed: string[] = [];
  for (const path of stagedPaths) {
    const previous = await fileDigest(root, path).catch(() => undefined);
    const next = await fileDigest(stagingRoot, path);
    if (previous !== next) changed.push(path);
  }
  for (const path of basePaths) {
    if (!stagedPaths.includes(path)) changed.push(path);
  }
  if (changed.length === 0) throw new Error("Staged catalog digest changed without changed catalog paths");
  return changed.sort(compare);
}

async function assertOnlyCatalogPathsDirty(
  root: string,
  stagingRoot: string,
  commands: CommandRunner
): Promise<void> {
  const status = await commands.command(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    stagingRoot
  );
  const dirtyPaths = parsePorcelainPaths(status);
  const allowedPaths = new Set([
    ...await catalogPaths(root),
    ...await catalogPaths(stagingRoot)
  ]);
  const outside = dirtyPaths.filter((path) => !allowedPaths.has(path));
  if (outside.length > 0) {
    throw new Error(`Catalog refresh changed paths outside catalog selectors: ${outside.join(", ")}`);
  }
}

function parsePorcelainPaths(status: Buffer): string[] {
  const fields = status.toString("utf8").split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index]!;
    if (record.length === 0) continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Catalog refresh received malformed Git status output");
    }
    const statusCode = record.slice(0, 2);
    paths.add(record.slice(3));
    if (/[RC]/u.test(statusCode)) {
      const original = fields[index + 1];
      if (original === undefined || original.length === 0) {
        throw new Error("Catalog refresh received an incomplete Git rename status");
      }
      paths.add(original);
      index += 1;
    }
  }
  return [...paths].sort(compare);
}

async function fileDigest(root: string, path: string): Promise<string> {
  return createHash("sha256").update(await readFile(join(root, path))).digest("hex");
}

async function gitText(root: string, commands: CommandRunner, args: readonly string[]): Promise<string> {
  return (await commands.command("git", args, root)).toString("utf8").trim();
}

function defaultCommands(): CommandRunner {
  return {
    async command(file, args, cwd, env) {
      const { stdout } = await execFileAsync(file, [...args], {
        cwd,
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        env: childEnvironment(env)
      });
      return Buffer.from(stdout);
    }
  };
}

function childEnvironment(overrides?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.GH_TOKEN;
  delete environment.GITHUB_TOKEN;
  delete environment.CATALOG_PUBLISH_TOKEN;
  return environment;
}

async function runSanitizedGit(args: readonly string[], cwd?: string): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    env: childEnvironment()
  });
  return Buffer.from(stdout);
}

function parseArguments(args: readonly string[]): {
  observedAt: string;
  githubRunId: string;
  stagingParent: string;
  artifactDirectory: string;
  expectedBaseSha: string;
} {
  const values = new Map<string, string>();
  const allowed = ["--observed-at", "--github-run-id", "--staging-parent", "--artifact-dir", "--base-sha"];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || value === undefined || !allowed.includes(flag) || values.has(flag)) {
      throw new Error("Expected exactly the catalog refresh validation arguments");
    }
    values.set(flag, value);
  }
  const observedAt = values.get("--observed-at");
  const githubRunId = values.get("--github-run-id");
  const stagingParent = values.get("--staging-parent");
  const artifactDirectory = values.get("--artifact-dir");
  const expectedBaseSha = values.get("--base-sha");
  if (observedAt === undefined || githubRunId === undefined || stagingParent === undefined
    || artifactDirectory === undefined || expectedBaseSha === undefined
    || !isAbsolute(stagingParent) || !isAbsolute(artifactDirectory)
    || !/^[0-9a-f]{40}$/u.test(expectedBaseSha)) {
    throw new Error("Catalog refresh validation requires absolute staging/artifact paths and an exact base SHA");
  }
  return { observedAt, githubRunId, stagingParent, artifactDirectory, expectedBaseSha };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function main(): Promise<void> {
  const argumentsList = parseArguments(process.argv.slice(2));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const commands = defaultCommands();
  const result = await runCatalogRefresh({ ...argumentsList, root, commands });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "catalog refresh failed"}\n`);
    process.exitCode = 1;
  });
}
