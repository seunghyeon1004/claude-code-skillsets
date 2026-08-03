export const OBSERVATION_FIELD_NAMES = [
  "license",
  "permissions",
  "ownership",
  "dependencies",
  "executableSurface"
] as const;

export const MAX_OBSERVATION_BLOB_BYTES = 256 * 1024;
export const MAX_OBSERVATION_SOURCE_BYTES = 4 * 1024 * 1024;

const OBSERVATION_LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml"
]);

const DISALLOWED_EXECUTABLE_PATH_PREFIXES = ["bin/", "tools/", ".github/workflows/"];
const FORBIDDEN_REPOSITORY_PATH_CONTROL_BYTES = /[\0-\t\v-\x1f\x7f-\x9f]/u;

export function isSafeRepositoryRelativePath(path: string): boolean {
  return path.length > 0
    && !path.startsWith("/")
    && !path.endsWith("/")
    && !path.includes("\\")
    && !FORBIDDEN_REPOSITORY_PATH_CONTROL_BYTES.test(path)
    && !path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..");
}

export function isAllowedObservationPath(path: string): boolean {
  const base = basename(path);
  return isObservationManifestPath(path)
    || isObservationLicenseName(base.toLowerCase())
    || isObservationLockfileName(base.toLowerCase())
    || isObservationScriptOrHookPath(path)
    || isObservationMcpConfigPath(path)
    || base === "SKILL.md";
}

export function isObservationManifestPath(path: string): boolean {
  const base = basename(path).toLowerCase();
  return base === "package.json"
    || base === "plugin.json"
    || base === "marketplace.json"
    || base === "manifest.json"
    || /^manifest\.(?:json|ya?ml)$/u.test(base);
}

export function isObservationLicenseName(base: string): boolean {
  return /^(?:license|copying|notice)(?:[.-].+)?$/u.test(base);
}

export function isObservationLockfileName(base: string): boolean {
  return OBSERVATION_LOCKFILE_NAMES.has(base);
}

export function isObservationMcpConfigPath(path: string): boolean {
  if (isDisallowedExecutablePath(path)) return false;
  const base = basename(path).toLowerCase();
  return base === ".mcp.json"
    || base === "mcp.json"
    || /^mcp(?:[-_.][a-z0-9]+)*\.(?:json|ya?ml)$/u.test(base);
}

export function isObservationScriptOrHookPath(path: string): boolean {
  if (isDisallowedExecutablePath(path)) return false;
  const base = basename(path).toLowerCase();
  return path.startsWith("scripts/")
    || path.startsWith("hooks/")
    || path.startsWith(".githooks/")
    || path.startsWith(".husky/")
    || base.endsWith(".sh");
}

function isDisallowedExecutablePath(path: string): boolean {
  return DISALLOWED_EXECUTABLE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function basename(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? path : path.slice(separator + 1);
}

export type ObservationFieldName = typeof OBSERVATION_FIELD_NAMES[number];
export type ObservationReadStatus = "observed" | "unknown";
export type SensitiveFieldStatus = ObservationReadStatus | "not-applicable";

export interface GitTreeBlob {
  path: string;
  gitBlobSha: string;
  byteSize: number;
}

export interface BlobEvidence extends GitTreeBlob {
  readStatus: ObservationReadStatus;
  contentSha256?: string;
}

export interface DirectEvidence {
  path: string;
  contentSha256: string;
}

export interface SensitiveFieldEvidence {
  status: SensitiveFieldStatus;
  evidence: DirectEvidence[];
}

export type ObservationFields = Record<ObservationFieldName, SensitiveFieldEvidence>;

export interface ObservationEvidence {
  schemaVersion: 3;
  id: string;
  sourceId: string;
  observedAt: string;
  inspectedCommit: string;
  blobs: BlobEvidence[];
  fields: ObservationFields;
}

export interface SourceObservation {
  schemaVersion: 3;
  sourceId: string;
  latestEvidenceId: string;
  previousEvidenceId: string | null;
  observedAt: string;
  inspectedCommit: string;
  representativePaths: string[];
  provisionalDomainIds: string[];
  fields: ObservationFields;
}

export type SourceDiffStatus = "baseline" | "unchanged" | "changed" | "unknown";

export interface SourceDiff {
  schemaVersion: 3;
  sourceId: string;
  currentEvidenceId: string;
  previousEvidenceId: string | null;
  status: SourceDiffStatus;
  skillPaths: SourceDiffStatus;
  manifest: SourceDiffStatus;
  source: SourceDiffStatus;
  fields: Record<ObservationFieldName, SourceDiffStatus>;
}
