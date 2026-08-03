import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rm, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, resolve, sep } from "node:path";

export interface CanonicalSetupStateRead {
  value: unknown;
  raw: string;
  digest: string;
}

export interface SetupExecutionLock {
  release(): Promise<void>;
}

export interface SetupExecutionLockDiagnosis {
  status: "absent" | "regular-stale" | "symlink-or-nonregular";
  path: string;
  relativePath: "state/setup-execution.lock";
  setupHold: boolean;
  maintenanceHold: boolean;
  automaticRemovalAllowed: false;
  requiresManualReview: boolean;
}

const stateSegments = [".claude", "claude-code-skillsets", "state"] as const;
const installLockName = "install-lock.json";
const executionLockName = "setup-execution.lock";

const objectKeyOrders = [
  ["schemaVersion", "approval", "statuses", "managedInstallReceipts"],
  ["schemaVersion", "runs"],
  ["approval", "statuses", "managedInstallReceipts"],
  ["preview", "previewDigest"],
  [
    "language", "platform", "goal", "selectedDomainIds", "domainPriority", "observedAt",
    "decisionIndexDigest", "catalogExpiresAt", "planKind", "selectionBasis", "smallestHonestProfile",
    "broadCoverageComplete", "coverageIncomplete", "directCapabilityIds", "inferredCapabilityIds",
    "relatedCapabilityIds", "uncoveredCapabilityIds", "candidates", "marketplaceIdentities", "commands",
    "executionOrder", "statePaths", "stateOperations", "statePublisher", "claudeExecutableIdentity",
    "riskDisclosures"
  ],
  [
    "candidateId", "sourceId", "skillPath", "pluginName", "marketplaceId", "marketplaceSource",
    "scope", "installArgv", "stateReasons", "capabilities", "revisionBinding", "disclosures"
  ],
  ["capabilityId", "evidenceId", "support"],
  ["permissions", "license", "trust", "dependencies", "authentication", "cost"],
  ["status", "evidence"],
  ["id", "source"],
  ["kind", "candidateId", "argv"],
  ["phase", "candidateId", "kind", "path"],
  [
    "tool", "runtimeIdentity", "argvTemplate", "commandTemplate", "snapshotPlaceholder",
    "snapshotEncoding", "dynamicValueSource"
  ],
  [
    "tool", "runtimeIdentity", "argvTemplate", "commandTemplate", "snapshotPlaceholder",
    "expectedPriorDigestPlaceholder", "snapshotEncoding", "dynamicValueSource"
  ],
  ["executablePath", "version", "sha256"],
  ["candidateId", "status"],
  [
    "managedBy", "decisionPlanDigest", "pluginName", "marketplaceId", "marketplaceSource", "scope",
    "preInstallVersion", "postInstallVersion", "versionStatus", "observedAt", "installCommandDigest"
  ]
] as const;

const keyOrderBySignature = new Map(
  objectKeyOrders.map((order) => [[...order].sort().join("\0"), order] as const)
);

export function canonicalSetupStateJson(value: unknown): string {
  const serialized = JSON.stringify(orderSetupStateValue(value), null, 2);
  if (serialized === undefined) throw new Error("Setup state must be JSON-serializable");
  return `${serialized}\n`;
}

export function setupStateRawDigest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function readCanonicalSetupInstallLock(): Promise<CanonicalSetupStateRead | undefined> {
  const path = setupInstallLockPath();
  try {
    await assertRegularFileWithoutSymlinks(path);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
  const raw = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Existing setup install lock is not valid JSON");
  }
  if (canonicalSetupStateJson(value) !== raw) {
    throw new Error("Existing setup install lock is not canonical JSON");
  }
  return { value, raw, digest: setupStateRawDigest(raw) };
}

export async function readRequiredCanonicalSetupInstallLock(): Promise<CanonicalSetupStateRead> {
  const read = await readCanonicalSetupInstallLock();
  if (read === undefined) throw new Error("Canonical setup install lock is missing");
  return read;
}

export async function acquireSetupExecutionLock(): Promise<SetupExecutionLock> {
  const directory = setupStateDirectory();
  await assertNoSymlinkAncestors(directory, true);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertNoSymlinkAncestors(directory, false);
  const project = join(homedir(), ".claude", "claude-code-skillsets");
  await assertRegularDirectory(project);
  await assertRegularDirectory(directory);
  await chmod(project, 0o700);
  await chmod(directory, 0o700);
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw new Error("Required setup execution lock flags are unavailable; run /skillset-manager:doctor");
  }
  const path = join(directory, executionLockName);
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Setup execution lock already exists; run /skillset-manager:doctor before retrying");
    }
    throw error;
  }
  const identity = await handle.stat();
  try {
    await handle.writeFile(canonicalSetupStateJson({
      pid: process.pid,
      nonce: randomBytes(32).toString("hex")
    }), "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    try {
      await removeExecutionLockAfterIdentityRecheck(path, identity);
    } catch (cleanupError) {
      throw new Error(
        "Setup execution lock identity changed during failed acquisition; preserved observed path for doctor review",
        { cause: new AggregateError([error, cleanupError]) }
      );
    }
    throw error;
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await handle.close();
      await removeExecutionLockAfterIdentityRecheck(path, identity);
    }
  };
}

export function setupInstallLockPath(): string {
  return join(setupStateDirectory(), installLockName);
}

export function setupExecutionLockPath(): string {
  return join(setupStateDirectory(), executionLockName);
}

/** Read-only doctor adapter. It never treats PID liveness as deletion authority. */
export async function inspectSetupExecutionLock(): Promise<SetupExecutionLockDiagnosis> {
  const path = setupExecutionLockPath();
  try {
    await assertNoSymlinkAncestors(path, false);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return lockDiagnosis("symlink-or-nonregular", path);
    }
    return lockDiagnosis("regular-stale", path);
  } catch (error) {
    if (isMissingPathError(error)) return lockDiagnosis("absent", path);
    return lockDiagnosis("symlink-or-nonregular", path);
  }
}

function setupStateDirectory(): string {
  return join(homedir(), ...stateSegments);
}

function lockDiagnosis(
  status: SetupExecutionLockDiagnosis["status"],
  path: string
): SetupExecutionLockDiagnosis {
  const hold = status !== "absent";
  return {
    status,
    path,
    relativePath: "state/setup-execution.lock",
    setupHold: hold,
    maintenanceHold: hold,
    automaticRemovalAllowed: false,
    requiresManualReview: hold
  };
}

/**
 * Rechecks the path identity immediately before pathname removal. Node does not
 * expose an inode-bound unlink here, so a same-user replacement after this
 * check remains possible; an observed mismatch always preserves that path.
 */
async function removeExecutionLockAfterIdentityRecheck(
  path: string,
  identity: { dev: number; ino: number }
): Promise<void> {
  let current;
  try {
    current = await lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error("Setup execution lock disappeared before identity-rechecked removal; run /skillset-manager:doctor");
    }
    throw error;
  }
  if (current.isSymbolicLink() || !current.isFile()
    || current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new Error("Setup execution lock identity mismatch before removal; observed path preserved; run /skillset-manager:doctor");
  }
  await rm(path);
}

function orderSetupStateValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderSetupStateValue);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  const order = keyOrderBySignature.get([...keys].sort().join("\0"));
  const orderedKeys = order === undefined ? [...keys].sort() : [...order];
  return Object.fromEntries(orderedKeys.map((key) => [key, orderSetupStateValue(value[key])]));
}

async function assertRegularFileWithoutSymlinks(path: string): Promise<void> {
  await assertNoSymlinkAncestors(path, false);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Existing setup install lock is not a regular file");
  }
}

async function assertRegularDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Setup state directory is not regular");
  }
}

async function assertNoSymlinkAncestors(path: string, allowMissing: boolean): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const segment of absolute.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) throw new Error("Setup state path contains a symbolic link");
      if (current !== absolute && !metadata.isDirectory()) {
        throw new Error("Setup state ancestor is not a directory");
      }
    } catch (error) {
      if (allowMissing && isMissingPathError(error)) return;
      throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
