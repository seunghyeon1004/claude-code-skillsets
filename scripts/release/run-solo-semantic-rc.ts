import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { validateDecisionIndex, validateDecisionRoutingIndex } from "../../src/contracts/decision.js";
import { assertDecisionIndexIntegrity } from "../../src/decision/index-loader.js";
import { canonicalize } from "../../src/research/canonical-json.js";
import {
  createExclusiveOutputDirectory,
  writeExclusiveOutputFile
} from "../../src/safety/safe-output.js";

const commitPattern = /^[0-9a-f]{40}$/u;
const routingIndexRelativePath = "plugins/skillset-manager/data/routing-index.json";
const decisionIndexRelativePath = "plugins/skillset-manager/data/decision-index.json";
const routingIndexMaxBytes = 128 * 1024;
const forbiddenEnvironmentKeys = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
  "CLAUDE_CODE_SKIP_VERTEX_AUTH",
  "CLAUDE_CODE_SKIP_FOUNDRY_AUTH"
] as const;

type SafeChildEnvironment = Record<"PATH" | "HOME" | "TMPDIR" | "LANG" | "LC_ALL" | "NO_COLOR" | "TERM", string>;
type EvaluationChildEnvironment = SafeChildEnvironment & Record<
  "SEMANTIC_RC_CLAUDE_EXECUTABLE" | "SEMANTIC_RC_CLAUDE_SHA256",
  string
>;
type GitChildEnvironment = SafeChildEnvironment & Record<
  "GIT_CONFIG_NOSYSTEM" | "GIT_CONFIG_GLOBAL" | "GIT_TERMINAL_PROMPT",
  string
>;

interface ExecutableIdentity {
  path: string;
  sha256: string;
}

interface DecisionIndexInspection {
  routingIndexByteLength: number;
  routingIndexBytesSha256: string;
  routingIndexDigest: string;
  routingDecisionIndexDigest: string;
  catalogVersion: string;
  catalogObservedThrough: string;
  catalogExpiresAt: string;
  decisionIndexDigest: string;
  decisionIndexByteLength: number;
  decisionIndexBytesSha256: string;
  executableAvailability: "none" | "present";
}

export interface LocalSemanticRcTargetReceipt {
  schemaVersion: 6;
  receiptType: "local-semantic-rc-target";
  commitSha: string;
  routingIndexPath: typeof routingIndexRelativePath;
  routingIndexByteLength: number;
  routingIndexBytesSha256: string;
  routingIndexDigest: string;
  routingDecisionIndexDigest: string;
  catalogVersion: string;
  catalogObservedThrough: string;
  catalogExpiresAt: string;
  decisionIndexDigest: string;
  decisionIndexByteLength: number;
  decisionIndexBytesSha256: string;
  subscriptionAuthMode: "claude.ai";
  semanticHarnessStatus: "not-run" | "passed";
  executableAvailability: "none" | "present";
  executionMode: "subscription-claude-cli-fixture-read-only";
  humanReviewGuarantee: "not-guaranteed";
}

export interface SoloSemanticRcOptions {
  root: string;
  commitSha: string;
  outputDirectory: string;
  execute: boolean;
  approvedReadOnly: boolean;
}

export interface SoloSemanticRcDependencies {
  environment?: NodeJS.ProcessEnv;
  resolveExecutable?: (name: "claude", environment: NodeJS.ProcessEnv) => Promise<string>;
  tsxExecutablePath?: string;
  gitExecutablePath?: string;
  runClaudeAuthStatus?: (
    executable: string,
    args: readonly string[],
    environment: SafeChildEnvironment
  ) => Promise<string>;
  runEvaluationCommand?: (
    executable: string,
    args: readonly string[],
    environment: EvaluationChildEnvironment,
    cwd: string
  ) => Promise<void>;
}

interface SemanticRcPreflight {
  receipt: LocalSemanticRcTargetReceipt;
  indexes: DecisionIndexInspection;
  claudeExecutable: ExecutableIdentity;
  tsxExecutable: ExecutableIdentity;
  gitExecutable: ExecutableIdentity;
  environment: SafeChildEnvironment;
  gitEnvironment: GitChildEnvironment;
}

/**
 * Proves the local checkout is the exact clean main candidate before any
 * subscription-backed fixture evaluation is allowed to begin.
 */
export async function verifyLocalSemanticRcTarget(input: {
  root: string;
  commitSha: string;
}, dependencies: SoloSemanticRcDependencies = {}): Promise<LocalSemanticRcTargetReceipt> {
  return (await semanticRcPreflight(input, dependencies)).receipt;
}

async function semanticRcPreflight(input: {
  root: string;
  commitSha: string;
}, dependencies: SoloSemanticRcDependencies): Promise<SemanticRcPreflight> {
  const root = await realpath(resolve(input.root));
  if (!commitPattern.test(input.commitSha)) throw new Error("commit SHA must be a 40-character lowercase object ID");
  const inheritedEnvironment = dependencies.environment ?? process.env;
  assertNoAlternateProviderEnvironment(inheritedEnvironment);
  const environment = safeChildEnvironment(inheritedEnvironment);
  const gitEnvironment = closedGitEnvironment(environment);
  const resolveExecutable = dependencies.resolveExecutable ?? resolveExecutableFromPath;
  const [claudeExecutable, tsxExecutable, gitExecutable, indexes] = await Promise.all([
    executableIdentity(await resolveExecutable("claude", inheritedEnvironment), "Claude"),
    executableIdentity(
      dependencies.tsxExecutablePath ?? join(root, "node_modules", ".bin", "tsx"),
      "tsx"
    ),
    executableIdentity(dependencies.gitExecutablePath ?? "/usr/bin/git", "Git"),
    inspectDecisionIndexes(root)
  ]);
  await assertGitTarget(root, input.commitSha, gitExecutable, gitEnvironment);
  const runAuth = dependencies.runClaudeAuthStatus ?? runClaudeAuthStatus;
  let authRaw: string;
  try {
    authRaw = await invokeBoundExecutable(claudeExecutable, "Claude", () =>
      runAuth(claudeExecutable.path, ["auth", "status", "--json"], environment));
  } catch {
    throw new Error("Claude subscription auth status command failed");
  }
  assertClaudeAiSubscriptionStatus(authRaw);

  return {
    claudeExecutable,
    tsxExecutable,
    gitExecutable,
    environment,
    gitEnvironment,
    indexes,
    receipt: {
      schemaVersion: 6,
      receiptType: "local-semantic-rc-target",
      commitSha: input.commitSha,
      routingIndexPath: routingIndexRelativePath,
      routingIndexByteLength: indexes.routingIndexByteLength,
      routingIndexBytesSha256: indexes.routingIndexBytesSha256,
      routingIndexDigest: indexes.routingIndexDigest,
      routingDecisionIndexDigest: indexes.routingDecisionIndexDigest,
      catalogVersion: indexes.catalogVersion,
      catalogObservedThrough: indexes.catalogObservedThrough,
      catalogExpiresAt: indexes.catalogExpiresAt,
      decisionIndexDigest: indexes.decisionIndexDigest,
      decisionIndexByteLength: indexes.decisionIndexByteLength,
      decisionIndexBytesSha256: indexes.decisionIndexBytesSha256,
      subscriptionAuthMode: "claude.ai",
      semanticHarnessStatus: "not-run",
      executableAvailability: indexes.executableAvailability,
      executionMode: "subscription-claude-cli-fixture-read-only",
      humanReviewGuarantee: "not-guaranteed"
    }
  };
}

async function inspectDecisionIndexes(root: string): Promise<DecisionIndexInspection> {
  const routingPath = join(root, routingIndexRelativePath);
  const decisionPath = join(root, decisionIndexRelativePath);
  const [routingMetadata, decisionMetadata] = await Promise.all([
    lstat(routingPath),
    lstat(decisionPath)
  ]);
  if (routingMetadata.isSymbolicLink() || !routingMetadata.isFile()
    || decisionMetadata.isSymbolicLink() || !decisionMetadata.isFile()) {
    throw new Error("Decision routing inputs must be regular non-symlink files");
  }
  const [canonicalRoutingPath, canonicalDecisionPath] = await Promise.all([
    realpath(routingPath),
    realpath(decisionPath)
  ]);
  if (canonicalRoutingPath !== resolve(routingPath) || canonicalDecisionPath !== resolve(decisionPath)) {
    throw new Error("Decision routing input paths must be canonical");
  }
  const [routingRaw, decisionRaw] = await Promise.all([
    readFile(routingPath),
    readFile(decisionPath)
  ]);
  if (routingRaw.byteLength < 1 || routingRaw.byteLength > routingIndexMaxBytes) {
    throw new Error("Routing index must be nonempty and no larger than 128 KiB");
  }
  const routingText = routingRaw.toString("utf8");
  if ((routingText.endsWith("\n") ? routingText.split("\n").length - 1 : routingText.split("\n").length) > 2_000) {
    throw new Error("Routing index exceeds its 2000-line contract");
  }
  let routingValue: unknown;
  let decisionValue: unknown;
  try {
    routingValue = JSON.parse(routingText) as unknown;
    decisionValue = JSON.parse(decisionRaw.toString("utf8")) as unknown;
  } catch {
    throw new Error("Decision routing inputs must be valid JSON");
  }
  const decisionIndex = validateDecisionIndex(decisionValue);
  assertDecisionIndexIntegrity(decisionIndex);
  const routingIndex = validateDecisionRoutingIndex(routingValue, decisionIndex);
  if (`${JSON.stringify(routingIndex, null, 2)}\n` !== routingText
    || `${JSON.stringify(decisionIndex, null, 2)}\n` !== decisionRaw.toString("utf8")) {
    throw new Error("Decision routing inputs must use exact generated JSON bytes");
  }
  return {
    routingIndexByteLength: routingRaw.byteLength,
    routingIndexBytesSha256: sha256(routingRaw),
    routingIndexDigest: routingIndex.digest,
    routingDecisionIndexDigest: routingIndex.decisionIndexDigest,
    catalogVersion: decisionIndex.catalogVersion,
    catalogObservedThrough: decisionIndex.observedThrough,
    catalogExpiresAt: decisionIndex.catalogExpiresAt,
    decisionIndexDigest: decisionIndex.digest,
    decisionIndexByteLength: decisionRaw.byteLength,
    decisionIndexBytesSha256: sha256(decisionRaw),
    executableAvailability: decisionIndex.candidates.some((candidate) =>
      candidate.runtime === "claude-code"
      && candidate.state === "eligible-with-disclosures"
      && candidate.claudeInstall !== undefined)
      ? "present"
      : "none"
  };
}

function assertNoAlternateProviderEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of forbiddenEnvironmentKeys) {
    if (environment[key] !== undefined) {
      throw new Error(`${key} must be unset for subscription-backed semantic RC`);
    }
  }
}

function safeChildEnvironment(environment: NodeJS.ProcessEnv): SafeChildEnvironment {
  const path = requiredEnvironmentValue(environment, "PATH");
  const home = requiredEnvironmentValue(environment, "HOME");
  const temporary = environment.TMPDIR === undefined || environment.TMPDIR === ""
    ? "/tmp"
    : environment.TMPDIR;
  if (!isAbsolute(home) || !isAbsolute(temporary)) {
    throw new Error("HOME and TMPDIR must be absolute for semantic RC");
  }
  return {
    PATH: path,
    HOME: home,
    TMPDIR: temporary,
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    TERM: "dumb"
  };
}

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, key: "PATH" | "HOME"): string {
  const value = environment[key];
  if (value === undefined || value === "") throw new Error(`${key} is required for semantic RC`);
  return value;
}

async function resolveExecutableFromPath(
  name: "claude",
  environment: NodeJS.ProcessEnv
): Promise<string> {
  const path = requiredEnvironmentValue(environment, "PATH");
  for (const directory of path.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the caller's explicit PATH.
    }
  }
  throw new Error(`${name} executable was not found on an absolute PATH entry`);
}

async function executableIdentity(path: string, label: string): Promise<ExecutableIdentity> {
  if (!isAbsolute(path)) throw new Error(`${label} executable path must be absolute`);
  const canonical = await realpath(path);
  const metadata = await lstat(canonical);
  if (!metadata.isFile()) throw new Error(`${label} executable must resolve to a regular file`);
  await access(canonical, constants.X_OK);
  return { path: canonical, sha256: sha256(await readFile(canonical)) };
}

async function verifyExecutableIdentity(identity: ExecutableIdentity, label: string): Promise<void> {
  let observed: ExecutableIdentity;
  try {
    observed = await executableIdentity(identity.path, label);
  } catch (error) {
    throw new Error(`${label} executable identity changed`, { cause: error });
  }
  if (observed.path !== identity.path || observed.sha256 !== identity.sha256) {
    throw new Error(`${label} executable identity changed (path or SHA-256 mismatch)`);
  }
}

async function invokeBoundExecutable<T>(
  identity: ExecutableIdentity,
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  await verifyExecutableIdentity(identity, label);
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  await verifyExecutableIdentity(identity, label);
  if (operationError !== undefined) throw operationError;
  return result as T;
}

function runClaudeAuthStatus(
  executable: string,
  args: readonly string[],
  environment: SafeChildEnvironment
): Promise<string> {
  return Promise.resolve(execFileSync(executable, [...args], {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  }));
}

function assertClaudeAiSubscriptionStatus(raw: string): void {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Claude auth status did not return valid JSON");
  }
  const keys = isRecord(value) ? Object.keys(value).sort() : [];
  const expectedKeys = [
    "apiProvider", "authMethod", "email", "loggedIn", "orgId", "orgName", "subscriptionType"
  ];
  if (!isRecord(value)
    || keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || value.loggedIn !== true
    || value.authMethod !== "claude.ai"
    || value.apiProvider !== "firstParty"
    || typeof value.subscriptionType !== "string"
    || value.subscriptionType.trim() === "") {
    throw new Error("Claude auth status must confirm a first-party claude.ai subscription");
  }
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function releaseReceipt(receipt: LocalSemanticRcTargetReceipt): LocalSemanticRcTargetReceipt {
  return {
    ...receipt,
    semanticHarnessStatus: "passed"
  };
}

function evaluationEnvironment(
  base: SafeChildEnvironment,
  claudeExecutable: ExecutableIdentity
): EvaluationChildEnvironment {
  return {
    ...base,
    PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
    SEMANTIC_RC_CLAUDE_EXECUTABLE: claudeExecutable.path,
    SEMANTIC_RC_CLAUDE_SHA256: claudeExecutable.sha256
  };
}

function runEvaluationCommand(
  executable: string,
  args: readonly string[],
  environment: EvaluationChildEnvironment,
  cwd: string
): Promise<void> {
  execFileSync(executable, [...args], { cwd, env: environment, stdio: "inherit" });
  return Promise.resolve();
}

function receiptJson(target: LocalSemanticRcTargetReceipt): string {
  return `${canonicalize(target)}\n`;
}

function targetReceiptPath(raw: string): string {
  return join(raw, "governance", "local-semantic-rc-target.json");
}

function semanticCommands(root: string, raw: string): string[][] {
  return [
    [join(root, "src", "evaluate", "setup.ts"), "--output-dir", join(raw, "setup")],
    [join(root, "src", "evaluate", "setup-preview.ts"), "--output-dir", join(raw, "setup-preview")],
    [join(root, "src", "evaluate", "maintain.ts"), "--output-dir", join(raw, "maintain")],
    [join(root, "src", "evaluate", "doctor.ts"), "--output-dir", join(raw, "doctor")],
    [join(root, "src", "evaluate", "shared-core.ts"), "--output", join(raw, "shared-core")]
  ];
}

function sanitizationCommands(root: string, raw: string, sanitized: string): string[][] {
  return [
    [join(root, "src", "evaluate", "sanitize.ts"), raw, sanitized],
    [join(root, "src", "evaluate", "sanitize.ts"), "--verify", sanitized]
  ];
}

export function parseSoloSemanticRcOptions(args: readonly string[]): SoloSemanticRcOptions {
  const values = new Map<string, string>();
  let execute = false;
  let approvedReadOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--execute") {
      if (execute) throw new Error("--execute may appear only once");
      execute = true;
      continue;
    }
    if (argument === "--approved-read-only") {
      if (approvedReadOnly) throw new Error("--approved-read-only may appear only once");
      approvedReadOnly = true;
      continue;
    }
    if (argument !== "--commit-sha" && argument !== "--output-dir" && argument !== "--root") {
      throw new Error("usage: run-solo-semantic-rc.ts --commit-sha <SHA> --output-dir <directory> [--root <repository>] [--execute --approved-read-only]");
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--") || values.has(argument)) {
      throw new Error(`exactly one value is required for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }
  const commitSha = values.get("--commit-sha");
  const outputDirectory = values.get("--output-dir");
  if (commitSha === undefined || outputDirectory === undefined) {
    throw new Error("--commit-sha and --output-dir are required");
  }
  if (execute && !approvedReadOnly) {
    throw new Error("--execute requires explicit --approved-read-only confirmation");
  }
  if (!isAbsolute(outputDirectory) || resolve(outputDirectory) !== outputDirectory) {
    throw new Error("--output-dir must be a canonical absolute path");
  }
  return {
    root: resolve(values.get("--root") ?? process.cwd()),
    commitSha,
    outputDirectory,
    execute,
    approvedReadOnly
  };
}

export async function runSoloSemanticRc(
  options: SoloSemanticRcOptions,
  dependencies: SoloSemanticRcDependencies = {}
): Promise<LocalSemanticRcTargetReceipt> {
  if (options.execute && !options.approvedReadOnly) {
    throw new Error("--execute requires explicit --approved-read-only confirmation");
  }
  const root = await realpath(options.root);
  const artifactsRoot = join(root, ".rc-artifacts");
  const expectedOutput = join(artifactsRoot, options.commitSha);
  if (options.outputDirectory !== expectedOutput) {
    throw new Error(`local semantic RC output must be the canonical repo-owned exact-SHA directory ${expectedOutput}`);
  }
  await assertArtifactsRootSafe(artifactsRoot);
  const preflight = await semanticRcPreflight({ root, commitSha: options.commitSha }, dependencies);
  const target = preflight.receipt;
  if (!options.execute) return target;

  try {
    await access(artifactsRoot);
  } catch (error) {
    if (!isMissingPath(error)) throw error;
    await createExclusiveOutputDirectory(artifactsRoot);
  }
  await createExclusiveOutputDirectory(expectedOutput);
  const raw = join(options.outputDirectory, "raw");
  const sanitized = join(options.outputDirectory, "sanitized");
  await createExclusiveOutputDirectory(raw);
  await createExclusiveOutputDirectory(join(raw, "governance"));
  const environment = evaluationEnvironment(preflight.environment, preflight.claudeExecutable);
  const executeCommand = dependencies.runEvaluationCommand ?? runEvaluationCommand;

  for (const args of semanticCommands(root, raw)) {
    await invokeBoundExecutable(preflight.tsxExecutable, "tsx", () =>
      executeCommand(preflight.tsxExecutable.path, args, environment, root));
  }
  await Promise.all([
    assertGitTarget(root, options.commitSha, preflight.gitExecutable, preflight.gitEnvironment),
    verifyExecutableIdentity(preflight.claudeExecutable, "Claude"),
    verifyExecutableIdentity(preflight.tsxExecutable, "tsx")
  ]);
  const completedIndexes = await inspectDecisionIndexes(root);
  if (canonicalize(completedIndexes) !== canonicalize(preflight.indexes)) {
    throw new Error("Decision routing snapshot changed during semantic evaluation");
  }
  const completedTarget = releaseReceipt(target);
  await writeExclusiveOutputFile(
    targetReceiptPath(raw),
    receiptJson(completedTarget)
  );
  for (const args of sanitizationCommands(root, raw, sanitized)) {
    await invokeBoundExecutable(preflight.tsxExecutable, "tsx", () =>
      executeCommand(preflight.tsxExecutable.path, args, environment, root));
  }
  return completedTarget;
}

async function assertArtifactsRootSafe(artifactsRoot: string): Promise<void> {
  try {
    const metadata = await lstat(artifactsRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()
      || await realpath(artifactsRoot) !== artifactsRoot) {
      throw new Error("local semantic RC artifact root contains a symbolic link or is not canonical");
    }
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function closedGitEnvironment(base: SafeChildEnvironment): GitChildEnvironment {
  return {
    ...base,
    PATH: "/usr/bin:/bin",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0"
  };
}

async function assertGitTarget(
  root: string,
  commitSha: string,
  executable: ExecutableIdentity,
  environment: GitChildEnvironment
): Promise<void> {
  const topLevel = await git(root, ["rev-parse", "--show-toplevel"], executable, environment);
  if (await realpath(topLevel) !== root) {
    throw new Error("local semantic RC Git worktree root must equal the canonical repository root");
  }
  if (await git(root, ["branch", "--show-current"], executable, environment) !== "main") {
    throw new Error("local semantic RC must run from the main branch");
  }
  if (await git(root, ["status", "--porcelain", "--untracked-files=normal"], executable, environment) !== "") {
    throw new Error("local semantic RC requires a clean working tree");
  }
  const [head, mainTip] = await Promise.all([
    git(root, ["rev-parse", "HEAD"], executable, environment),
    git(root, ["rev-parse", "refs/heads/main"], executable, environment)
  ]);
  if (head !== commitSha || mainTip !== commitSha) {
    throw new Error("local semantic RC commit SHA must equal the exact main tip");
  }
}

async function git(
  root: string,
  args: readonly string[],
  executable: ExecutableIdentity,
  environment: GitChildEnvironment
): Promise<string> {
  try {
    return await invokeBoundExecutable(executable, "Git", () => Promise.resolve(execFileSync(
      executable.path,
      ["-C", root, ...args],
      {
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"]
      }
    ).trim()));
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed`, { cause: error });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseSoloSemanticRcOptions(process.argv.slice(2));
  runSoloSemanticRc(options).then((target) => {
    process.stdout.write(`${canonicalize(target)}\n`);
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
