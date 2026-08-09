import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { generateAll, type GeneratedArtifacts } from "./generate/all.js";

export interface ArtifactFileOperations {
  mkdir(path: string): Promise<unknown>;
  rename(source: string, target: string): Promise<void>;
  rm(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface ArtifactPublicationWarning {
  code: "backup-cleanup-failed" | "temporary-cleanup-failed";
  path: string;
  reason: string;
}

export interface ArtifactPublicationResult {
  warnings: ArtifactPublicationWarning[];
}

export interface CliOperations {
  generate(root: string): Promise<GeneratedArtifacts>;
  publish(root: string, artifacts: GeneratedArtifacts): Promise<ArtifactPublicationResult>;
  writeStderr(message: string): void;
}

interface Publication {
  target: string;
  temporary: string;
  backup: string;
  content: string;
  backupActive: boolean;
  published: boolean;
}

interface CleanupFailure {
  kind: "backup" | "temporary";
  path: string;
  error: unknown;
}

const defaultFileOperations: ArtifactFileOperations = {
  mkdir: async (path) => mkdir(path, { recursive: true }),
  rename,
  rm: async (path) => rm(path, { force: true }),
  writeFile: async (path, content) => writeFile(path, content, { flag: "wx" })
};

const defaultCliOperations: CliOperations = {
  generate: async (root) => generateAll(root),
  publish: writeArtifacts,
  writeStderr: (message) => console.error(message)
};

export async function writeArtifacts(
  root: string,
  artifacts: GeneratedArtifacts,
  overrides: Partial<ArtifactFileOperations> = {}
): Promise<ArtifactPublicationResult> {
  const operations = { ...defaultFileOperations, ...overrides };
  const transactionId = randomUUID();
  const publications = artifactOutputs(root, artifacts).map(([target, content], index): Publication => ({
    target,
    content,
    temporary: `${target}.${transactionId}.${index}.tmp`,
    backup: `${target}.${transactionId}.${index}.bak`,
    backupActive: false,
    published: false
  }));
  let failure: unknown;

  try {
    for (const publication of publications) {
      await operations.mkdir(dirname(publication.target));
      await operations.writeFile(publication.temporary, publication.content);
    }

    for (const publication of publications) {
      try {
        await operations.rename(publication.target, publication.backup);
        publication.backupActive = true;
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
      await operations.rename(publication.temporary, publication.target);
      publication.published = true;
    }
  } catch (error) {
    const rollbackErrors = await rollback(publications, operations);
    failure = rollbackErrors.length === 0
      ? error
      : new AggregateError([error, ...rollbackErrors], "Artifact publication rollback failed");
  }

  const cleanupFailures = await cleanup(publications, operations, failure === undefined);
  if (failure !== undefined && cleanupFailures.length > 0) {
    failure = new AggregateError(
      [failure, ...cleanupFailures.map(({ error }) => error)],
      "Artifact publication cleanup failed"
    );
  }
  if (failure !== undefined) {
    throw failure;
  }

  return {
    warnings: cleanupFailures.map(({ kind, path, error }) => ({
      code: kind === "backup" ? "backup-cleanup-failed" : "temporary-cleanup-failed",
      path,
      reason: errorMessage(error)
    }))
  };
}

/** Verifies every generated publication target without mutating the worktree. */
export async function assertArtifactsCurrent(root: string, artifacts: GeneratedArtifacts): Promise<void> {
  for (const [target, expected] of artifactOutputs(root, artifacts)) {
    let actual: string;
    try {
      actual = await readFile(target, "utf8");
    } catch (error) {
      throw new Error(`Generated artifact is missing or unreadable: ${relative(root, target)}`, { cause: error });
    }
    if (actual !== expected) {
      throw new Error(`Generated artifact is stale: ${relative(root, target)}`);
    }
  }
}

async function rollback(
  publications: Publication[],
  operations: ArtifactFileOperations
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const publication of [...publications].reverse()) {
    if (publication.published) {
      try {
        await operations.rm(publication.target);
        publication.published = false;
      } catch (error) {
        errors.push(error);
      }
    }
    if (publication.backupActive) {
      try {
        await operations.rename(publication.backup, publication.target);
        publication.backupActive = false;
      } catch (error) {
        errors.push(error);
      }
    }
  }
  return errors;
}

async function cleanup(
  publications: Publication[],
  operations: ArtifactFileOperations,
  removeBackups: boolean
): Promise<CleanupFailure[]> {
  const paths = publications.flatMap((publication) => [
    { kind: "temporary" as const, path: publication.temporary },
    ...(removeBackups && publication.backupActive
      ? [{ kind: "backup" as const, path: publication.backup }]
      : [])
  ]);
  const results = await Promise.all(paths.map(async (cleanupPath): Promise<CleanupFailure | undefined> => {
    try {
      await operations.rm(cleanupPath.path);
      return undefined;
    } catch (error) {
      return { ...cleanupPath, error };
    }
  }));
  return results.filter((result): result is CleanupFailure => result !== undefined);
}

function artifactOutputs(root: string, artifacts: GeneratedArtifacts): readonly (readonly [string, string])[] {
  return [
    [join(root, ".claude-plugin", "marketplace.json"), artifacts.marketplace],
    [join(root, "generated", "catalog.ko.md"), artifacts.catalogKo],
    [join(root, "generated", "catalog.en.md"), artifacts.catalogEn],
    [join(root, "generated", "install-index.json"), artifacts.installIndex],
    [join(root, "plugins", "skillset-manager", "data", "install-index.json"), artifacts.installIndex],
    [join(root, "generated", "official-marketplace-index.json"), artifacts.officialMarketplaceIndex],
    [
      join(root, "plugins", "skillset-manager", "data", "official-marketplace-index.json"),
      artifacts.officialMarketplaceIndex
    ],
    [join(root, "generated", "decision-index.json"), artifacts.decisionIndex],
    [join(root, "plugins", "skillset-manager", "data", "decision-index.json"), artifacts.decisionIndex],
    [join(root, "generated", "routing-index.json"), artifacts.routingIndex],
    [join(root, "plugins", "skillset-manager", "data", "routing-index.json"), artifacts.routingIndex]
  ];
}

export async function run(
  command: string | undefined,
  root = process.cwd(),
  overrides: Partial<CliOperations> = {}
): Promise<number> {
  const operations = { ...defaultCliOperations, ...overrides };
  if (command !== "validate" && command !== "generate") {
    operations.writeStderr("Usage: tsx src/cli.ts validate|generate");
    return 2;
  }

  try {
    const artifacts = await operations.generate(root);
    if (command === "generate") {
      const result = await operations.publish(root, artifacts);
      for (const warning of result.warnings) {
        operations.writeStderr(formatWarning(warning));
      }
    }
    return 0;
  } catch (error) {
    operations.writeStderr(errorMessage(error));
    return 1;
  }
}

function formatWarning(warning: ArtifactPublicationWarning): string {
  const subject = warning.code === "backup-cleanup-failed" ? "preserved backup" : "temporary file";
  return `Warning [${warning.code}]: ${subject} ${warning.path}: ${warning.reason}`;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  process.exitCode = await run(process.argv[2]);
}
