import { execFileSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalize } from "../../src/research/canonical-json.js";
import {
  createExclusiveOutputDirectory,
  writeExclusiveOutputFile
} from "../../src/safety/safe-output.js";

const commitPattern = /^[0-9a-f]{40}$/u;

export interface LocalSemanticRcTargetReceipt {
  schemaVersion: 5;
  receiptType: "local-semantic-rc-target";
  commitSha: string;
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

/**
 * Proves the local checkout is the exact clean main candidate before any
 * subscription-backed fixture evaluation is allowed to begin.
 */
export function verifyLocalSemanticRcTarget(input: {
  root: string;
  commitSha: string;
}): LocalSemanticRcTargetReceipt {
  const root = resolve(input.root);
  if (!commitPattern.test(input.commitSha)) throw new Error("commit SHA must be a 40-character lowercase object ID");
  if (git(root, ["branch", "--show-current"]) !== "main") {
    throw new Error("local semantic RC must run from the main branch");
  }
  if (git(root, ["status", "--porcelain", "--untracked-files=normal"]) !== "") {
    throw new Error("local semantic RC requires a clean working tree");
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  const mainTip = git(root, ["rev-parse", "refs/heads/main"]);
  if (head !== input.commitSha || mainTip !== input.commitSha) {
    throw new Error("local semantic RC commit SHA must equal the exact main tip");
  }
  return {
    schemaVersion: 5,
    receiptType: "local-semantic-rc-target",
    commitSha: input.commitSha,
    executionMode: "subscription-claude-cli-fixture-read-only",
    humanReviewGuarantee: "not-guaranteed"
  };
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

export async function runSoloSemanticRc(options: SoloSemanticRcOptions): Promise<LocalSemanticRcTargetReceipt> {
  const target = verifyLocalSemanticRcTarget(options);
  const root = await realpath(options.root);
  const artifactsRoot = join(root, ".rc-artifacts");
  const expectedOutput = join(artifactsRoot, target.commitSha);
  if (options.outputDirectory !== expectedOutput) {
    throw new Error(`local semantic RC output must be the canonical repo-owned exact-SHA directory ${expectedOutput}`);
  }
  if (!options.execute) return target;

  try {
    const metadata = await lstat(artifactsRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()
      || await realpath(artifactsRoot) !== artifactsRoot) {
      throw new Error("local semantic RC artifact root contains a symbolic link or is not canonical");
    }
  } catch (error) {
    if (!isMissingPath(error)) throw error;
    await createExclusiveOutputDirectory(artifactsRoot);
  }
  await createExclusiveOutputDirectory(expectedOutput);
  const raw = join(options.outputDirectory, "raw");
  const sanitized = join(options.outputDirectory, "sanitized");
  await createExclusiveOutputDirectory(raw);
  await createExclusiveOutputDirectory(join(raw, "governance"));
  await writeExclusiveOutputFile(
    join(raw, "governance", "local-semantic-rc-target.json"),
    `${canonicalize(target)}\n`
  );

  for (const args of [
    ["run", "eval:setup", "--", "--output-dir", join(raw, "setup")],
    ["run", "eval:maintain", "--", "--output-dir", join(raw, "maintain")],
    ["run", "eval:doctor", "--", "--output-dir", join(raw, "doctor")],
    ["run", "eval:shared-core", "--", "--output", join(raw, "shared-core")],
    ["run", "eval:sanitize", "--", raw, sanitized],
    ["run", "eval:sanitize:verify", "--", sanitized]
  ]) {
    execFileSync("npm", args, { cwd: options.root, stdio: "inherit" });
  }
  return target;
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function git(root: string, args: readonly string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
