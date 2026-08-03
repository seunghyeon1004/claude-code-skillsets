import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, rm, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { validateObservationEvidence } from "../contracts/observation.js";
import {
  MAX_OBSERVATION_BLOB_BYTES,
  MAX_OBSERVATION_SOURCE_BYTES,
  OBSERVATION_FIELD_NAMES,
  isAllowedObservationPath,
  isObservationLicenseName,
  isObservationLockfileName,
  isObservationManifestPath,
  isObservationMcpConfigPath,
  isObservationScriptOrHookPath,
  isSafeRepositoryRelativePath,
  type BlobEvidence,
  type DirectEvidence,
  type GitTreeBlob,
  type ObservationEvidence,
  type ObservationFieldName,
  type ObservationFields,
  type SensitiveFieldEvidence
} from "../model/observation.js";

export {
  MAX_OBSERVATION_BLOB_BYTES as MAX_BLOB_BYTES,
  MAX_OBSERVATION_SOURCE_BYTES as MAX_SOURCE_BYTES
} from "../model/observation.js";

const SHA1_PATTERN = /^[a-f0-9]{40}$/u;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DEPENDENCY_KEYS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies"];
const OWNERSHIP_KEYS = ["author", "authors", "owner", "maintainers", "contributors"];
const SUPPORTED_NPM_LOCKFILE_VERSIONS = new Set([1, 2, 3]);
const SUPPORTED_PNPM_LOCKFILE_VERSIONS = new Set(["9.0"]);
const YARN_LOCKFILE_V1_HEADER = "# yarn lockfile v1";

export interface CollectObservationEvidenceInput {
  id: string;
  sourceId: string;
  observedAt: string;
  inspectedCommit: string;
  blobs: readonly GitTreeBlob[];
  readBlob(path: string): Promise<Buffer>;
}

export interface WriteObservationEvidenceInput {
  evidence: ObservationEvidence;
  stagingDirectory: string;
  beforeCommit?: () => Promise<void> | void;
}

interface ObservedBlob {
  evidence: BlobEvidence & { readStatus: "observed"; contentSha256: string };
  contents: Buffer;
}

export async function collectObservationEvidence(input: CollectObservationEvidenceInput): Promise<ObservationEvidence> {
  assertCollectionInput(input);
  const orderedBlobs = [...input.blobs].sort((left, right) => compareCodePointStrings(left.path, right.path));
  const evidence: BlobEvidence[] = [];
  const observed: ObservedBlob[] = [];
  let attemptedBytes = 0;

  for (const blob of orderedBlobs) {
    if (!isAllowedObservationPath(blob.path)
      || blob.byteSize > MAX_OBSERVATION_BLOB_BYTES
      || blob.byteSize > MAX_OBSERVATION_SOURCE_BYTES - attemptedBytes) {
      evidence.push({ ...blob, readStatus: "unknown" });
      continue;
    }

    attemptedBytes += blob.byteSize;
    try {
      const contents = await input.readBlob(blob.path);
      if (!Buffer.isBuffer(contents)) throw new Error(`${blob.path}: blob reader must return a Buffer`);
      if (contents.byteLength !== blob.byteSize) {
        throw new Error(`${blob.path}: Git tree byte size does not match the returned blob`);
      }
      const contentSha256 = createHash("sha256").update(contents).digest("hex");
      const observedEvidence = { ...blob, readStatus: "observed" as const, contentSha256 };
      evidence.push(observedEvidence);
      observed.push({ evidence: observedEvidence, contents });
    } catch (error) {
      if (isReadFailure(error)) {
        evidence.push({ ...blob, readStatus: "unknown" });
        continue;
      }
      throw error;
    }
  }

  return validateObservationEvidence({
    schemaVersion: 3,
    id: input.id,
    sourceId: input.sourceId,
    observedAt: input.observedAt,
    inspectedCommit: input.inspectedCommit,
    blobs: evidence,
    fields: deriveFields(observed)
  });
}

export async function writeObservationEvidenceToStaging(input: WriteObservationEvidenceInput): Promise<string> {
  const evidence = validateObservationEvidence(input.evidence);
  const stagingDirectory = resolve(input.stagingDirectory);
  let stagingStats: Awaited<ReturnType<typeof lstat>>;
  try {
    stagingStats = await lstat(stagingDirectory);
  } catch {
    throw new Error("Observation staging directory must already exist");
  }
  if (stagingStats.isSymbolicLink() || !stagingStats.isDirectory()) {
    throw new Error("Observation staging directory must be a regular directory");
  }

  const output = join(stagingDirectory, `${evidence.id}.json`);
  const temporary = join(stagingDirectory, `.${evidence.id}.${randomUUID()}.tmp`);
  let published = false;
  try {
    await writePrivateFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`);
    await assertPathDoesNotExist(output);
    await input.beforeCommit?.();
    await linkWithoutOverwrite(temporary, output);
    published = true;
    await unlink(temporary);
    return output;
  } catch (error) {
    await Promise.all([
      rm(temporary, { force: true }),
      published ? rm(output, { force: true }) : Promise.resolve()
    ]);
    throw error;
  }
}

function assertCollectionInput(input: CollectObservationEvidenceInput): void {
  if (!ID_PATTERN.test(input.id)) throw new Error("Observation id must be a kebab-case identifier");
  if (!ID_PATTERN.test(input.sourceId)) throw new Error("Observation sourceId must be a kebab-case identifier");
  if (!SHA1_PATTERN.test(input.inspectedCommit)) throw new Error("Observation inspectedCommit must be a Git commit SHA");
  if (!isRfc3339Utc(input.observedAt)) throw new Error("Observation observedAt must be an RFC3339 UTC timestamp");

  const paths = new Set<string>();
  for (const blob of input.blobs) {
    assertRepositoryRelativePath(blob.path);
    if (paths.has(blob.path)) throw new Error(`${blob.path}: duplicate Git tree path`);
    paths.add(blob.path);
    if (!SHA1_PATTERN.test(blob.gitBlobSha)) throw new Error(`${blob.path}: invalid Git blob SHA`);
    if (!Number.isSafeInteger(blob.byteSize) || blob.byteSize < 0) {
      throw new Error(`${blob.path}: Git tree byte size must be a non-negative safe integer`);
    }
  }
}

function deriveFields(observed: readonly ObservedBlob[]): ObservationFields {
  const fieldEvidence: Record<ObservationFieldName, DirectEvidence[]> = {
    license: [],
    permissions: [],
    ownership: [],
    dependencies: [],
    executableSurface: []
  };

  for (const { evidence, contents } of observed) {
    const directEvidence = { path: evidence.path, contentSha256: evidence.contentSha256 };
    const base = basename(evidence.path).toLowerCase();
    if (isObservationLicenseName(base)) fieldEvidence.license.push(directEvidence);
    if (isObservationScriptOrHookPath(evidence.path)) fieldEvidence.executableSurface.push(directEvidence);

    if (isObservationLockfileName(base) && hasValidatedLockfileDependencies(evidence.path, contents)) {
      fieldEvidence.dependencies.push(directEvidence);
    }

    if (isObservationMcpConfigPath(evidence.path) && isMcpConfiguration(parseStructuredObject(evidence.path, contents))) {
      fieldEvidence.executableSurface.push(directEvidence);
    }

    if (!isObservationManifestPath(evidence.path)) continue;
    const manifest = parseStructuredObject(evidence.path, contents);
    if (manifest === undefined) continue;
    if (hasValidLicense(manifest)) fieldEvidence.license.push(directEvidence);
    if (hasValidPermissions(manifest)) fieldEvidence.permissions.push(directEvidence);
    if (hasValidOwnership(manifest)) fieldEvidence.ownership.push(directEvidence);
    if (hasValidDependencies(manifest)) fieldEvidence.dependencies.push(directEvidence);
    if (hasValidScripts(manifest)) fieldEvidence.executableSurface.push(directEvidence);
  }

  return Object.fromEntries(OBSERVATION_FIELD_NAMES.map((fieldName) => [
    fieldName,
    normalizeFieldEvidence(fieldEvidence[fieldName])
  ])) as ObservationFields;
}

function normalizeFieldEvidence(evidence: DirectEvidence[]): SensitiveFieldEvidence {
  const unique = [...new Map(evidence.map((item) => [`${item.path}\0${item.contentSha256}`, item])).values()]
    .sort((left, right) => compareCodePointStrings(`${left.path}\0${left.contentSha256}`, `${right.path}\0${right.contentSha256}`));
  return unique.length === 0 ? { status: "unknown", evidence: [] } : { status: "observed", evidence: unique };
}

function parseStructuredObject(path: string, contents: Buffer): Record<string, unknown> | undefined {
  return hasYamlExtension(path) ? parseYamlObject(contents) : parseJsonObject(contents);
}

function parseJsonObject(contents: Buffer): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(decodeUtf8(contents));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseYamlObject(contents: Buffer): Record<string, unknown> | undefined {
  try {
    const document = parseDocument(decodeUtf8(contents));
    if (document.errors.length > 0) return undefined;
    const value: unknown = document.toJS();
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function hasYamlExtension(path: string): boolean {
  return /\.ya?ml$/iu.test(path);
}

function hasValidatedLockfileDependencies(path: string, contents: Buffer): boolean {
  switch (basename(path).toLowerCase()) {
    case "package-lock.json":
    case "npm-shrinkwrap.json":
      return hasNpmLockfileDependencies(parseJsonObject(contents));
    case "yarn.lock":
      return hasYarnLockfileDependencies(contents);
    case "pnpm-lock.yaml":
      return hasPnpmLockfileDependencies(parseYamlObject(contents));
    default:
      return false;
  }
}

function hasNpmLockfileDependencies(value: Record<string, unknown> | undefined): boolean {
  if (value === undefined || !isSupportedNpmLockfileVersion(value.lockfileVersion)) return false;
  return hasNpmPackageEntries(value.packages) || hasNpmDependencyEntries(value.dependencies);
}

function hasNpmPackageEntries(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).some(([path, packageEntry]) => path.startsWith("node_modules/")
    && isRecord(packageEntry)
    && isNonEmptyString(packageEntry.version));
}

function hasNpmDependencyEntries(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).some(([name, dependency]) => isNonEmptyString(name)
    && isRecord(dependency)
    && isNonEmptyString(dependency.version));
}

function hasPnpmLockfileDependencies(value: Record<string, unknown> | undefined): boolean {
  if (value === undefined || !isPnpmLockfileVersion(value.lockfileVersion) || !isRecord(value.packages)) return false;
  return Object.entries(value.packages).some(([name, packageEntry]) => isNonEmptyString(name)
    && isRecord(packageEntry)
    && hasPnpmPackageResolution(packageEntry.resolution));
}

function isPnpmLockfileVersion(value: unknown): boolean {
  return typeof value === "string" && SUPPORTED_PNPM_LOCKFILE_VERSIONS.has(value);
}

function hasPnpmPackageResolution(value: unknown): boolean {
  return isRecord(value) && ["integrity", "tarball", "directory", "repo", "commit"].some((key) => isNonEmptyString(value[key]));
}

function hasYarnLockfileDependencies(contents: Buffer): boolean {
  let text: string;
  try {
    text = decodeUtf8(contents);
  } catch {
    return false;
  }

  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  if (lines[0] !== YARN_LOCKFILE_V1_HEADER) return false;

  let packageHasVersion = false;
  let packageCount = 0;
  for (const rawLine of lines.slice(1)) {
    if (rawLine.length === 0) continue;
    if (!rawLine.startsWith(" ")) {
      if (packageCount > 0 && !packageHasVersion) return false;
      if (!rawLine.endsWith(":")) return false;
      const key = rawLine.slice(0, -1);
      if (!isYarnV1TopLevelEntry(key)) return false;
      packageHasVersion = false;
      packageCount += 1;
      continue;
    }
    if (packageCount === 0) return false;
    if (/^ {2}version "[^\r\n"]+"$/u.test(rawLine)) packageHasVersion = true;
  }
  return packageCount > 0 && packageHasVersion;
}

function isSupportedNpmLockfileVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && SUPPORTED_NPM_LOCKFILE_VERSIONS.has(value);
}

function isYarnV1TopLevelEntry(value: string): boolean {
  return value.split(",").every((rawSelector) => {
    const selector = rawSelector.trim();
    const unquoted = selector.startsWith("\"") && selector.endsWith("\"")
      ? selector.slice(1, -1)
      : selector;
    return unquoted.length > 1
      && !/[\0-\x1f\x7f-\x9f]/u.test(unquoted)
      && unquoted.lastIndexOf("@") > 0
      && unquoted.lastIndexOf("@") < unquoted.length - 1;
  });
}

function decodeUtf8(contents: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(contents);
}

function hasValidLicense(manifest: Record<string, unknown>): boolean {
  const keys = ["license", "licenses"].filter((key) => hasOwn(manifest, key));
  return keys.length > 0 && keys.every((key) => key === "license"
    ? isNonEmptyString(manifest[key])
    : isLicenseList(manifest[key]));
}

function hasValidPermissions(manifest: Record<string, unknown>): boolean {
  return hasOwn(manifest, "permissions") && isStringArray(manifest.permissions);
}

function hasValidOwnership(manifest: Record<string, unknown>): boolean {
  const keys = OWNERSHIP_KEYS.filter((key) => hasOwn(manifest, key));
  return keys.length > 0 && keys.every((key) => key === "author" || key === "owner"
    ? isPerson(manifest[key])
    : isPersonList(manifest[key]));
}

function hasValidDependencies(manifest: Record<string, unknown>): boolean {
  const keys = DEPENDENCY_KEYS.filter((key) => hasOwn(manifest, key));
  return keys.length > 0 && keys.every((key) => key === "bundledDependencies"
    ? isStringArray(manifest[key])
    : isStringRecord(manifest[key]));
}

function hasValidScripts(manifest: Record<string, unknown>): boolean {
  return hasOwn(manifest, "scripts") && isStringRecord(manifest.scripts);
}

function isMcpConfiguration(value: Record<string, unknown> | undefined): boolean {
  if (value === undefined || !hasOwn(value, "mcpServers") || !isRecord(value.mcpServers)) return false;
  const servers = Object.values(value.mcpServers);
  return servers.length > 0 && servers.every(isMcpServerConfiguration);
}

function isMcpServerConfiguration(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const command = value.command;
  const url = value.url;
  if (command !== undefined && !isNonEmptyString(command)) return false;
  if (url !== undefined && !isHttpUrl(url)) return false;
  if (!isNonEmptyString(command) && !isHttpUrl(url)) return false;
  return (!hasOwn(value, "args") || isStringArray(value.args))
    && (!hasOwn(value, "env") || isStringRecord(value.env))
    && (!hasOwn(value, "headers") || isStringRecord(value.headers));
}

function isHttpUrl(value: unknown): boolean {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLicenseList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && isNonEmptyString(item.type)
    && (!hasOwn(item, "url") || isNonEmptyString(item.url)));
}

function isPerson(value: unknown): boolean {
  return isNonEmptyString(value) || (isRecord(value)
    && isNonEmptyString(value.name)
    && (!hasOwn(value, "email") || isNonEmptyString(value.email))
    && (!hasOwn(value, "url") || isHttpUrl(value.url)));
}

function isPersonList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isPerson);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReadFailure(error: unknown): boolean {
  return !(error instanceof Error && /blob reader must return|Git tree byte size/.test(error.message));
}

function assertRepositoryRelativePath(path: string): void {
  if (!isSafeRepositoryRelativePath(path)) {
    throw new Error("Unsafe repository path: " + path);
  }
}

function isRfc3339Utc(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?Z$/u.exec(value);
  if (match === null) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
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

async function assertPathDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`Refusing to overwrite existing observation evidence: ${path}`);
}

async function linkWithoutOverwrite(source: string, destination: string): Promise<void> {
  await link(source, destination);
}

function compareCodePointStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
