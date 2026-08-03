import { validateSourceDiff } from "../contracts/observation.js";
import {
  isObservationManifestPath,
  type BlobEvidence,
  type ObservationEvidence,
  type ObservationFieldName,
  type SensitiveFieldEvidence,
  type SourceDiff,
  type SourceDiffStatus
} from "../model/observation.js";
import { compareCodePointStrings } from "./snapshot.js";

export interface MaterializeSourceDiffInput {
  current: ObservationEvidence;
  previous?: ObservationEvidence;
}

/** Classifies source changes only when both sides carry directly observed evidence. */
export function materializeSourceDiff(input: MaterializeSourceDiffInput): SourceDiff {
  const { current, previous } = input;
  if (previous === undefined) return baseline(current);

  const skillPaths = classifyBlobs(current.blobs, previous.blobs, (path) => path.endsWith("/SKILL.md") || path === "SKILL.md");
  const manifest = classifyBlobs(current.blobs, previous.blobs, isObservationManifestPath);
  const source = current.inspectedCommit === previous.inspectedCommit ? "unchanged" : "changed";
  const fields = {
    license: classifyField(current.fields.license, previous.fields.license),
    permissions: classifyField(current.fields.permissions, previous.fields.permissions),
    ownership: classifyField(current.fields.ownership, previous.fields.ownership),
    dependencies: classifyField(current.fields.dependencies, previous.fields.dependencies),
    executableSurface: classifyField(current.fields.executableSurface, previous.fields.executableSurface)
  } satisfies Record<ObservationFieldName, SourceDiffStatus>;
  const status = aggregateStatus([skillPaths, manifest, source, ...Object.values(fields)]);

  return validateSourceDiff({
    schemaVersion: 3,
    sourceId: current.sourceId,
    currentEvidenceId: current.id,
    previousEvidenceId: previous.id,
    status,
    skillPaths,
    manifest,
    source,
    fields
  });
}

export function baselineSourceDiff(input: {
  sourceId: string;
  currentEvidenceId: string;
}): SourceDiff {
  return validateSourceDiff({
    schemaVersion: 3,
    sourceId: input.sourceId,
    currentEvidenceId: input.currentEvidenceId,
    previousEvidenceId: null,
    status: "baseline",
    skillPaths: "baseline",
    manifest: "baseline",
    source: "baseline",
    fields: {
      license: "baseline",
      permissions: "baseline",
      ownership: "baseline",
      dependencies: "baseline",
      executableSurface: "baseline"
    }
  });
}

function baseline(current: ObservationEvidence): SourceDiff {
  return baselineSourceDiff({ sourceId: current.sourceId, currentEvidenceId: current.id });
}

function classifyBlobs(
  current: readonly BlobEvidence[],
  previous: readonly BlobEvidence[],
  matches: (path: string) => boolean
): SourceDiffStatus {
  const currentRelevant = current.filter(({ path }) => matches(path));
  const previousRelevant = previous.filter(({ path }) => matches(path));
  if ([...currentRelevant, ...previousRelevant].some(({ readStatus }) => readStatus !== "observed")) return "unknown";
  return sameBlobSet(currentRelevant, previousRelevant) ? "unchanged" : "changed";
}

function classifyField(
  current: SensitiveFieldEvidence,
  previous: SensitiveFieldEvidence
): SourceDiffStatus {
  if (current.status === "unknown" || previous.status === "unknown") return "unknown";
  return current.status === previous.status && sameEvidence(current.evidence, previous.evidence)
    ? "unchanged"
    : "changed";
}

function aggregateStatus(statuses: readonly SourceDiffStatus[]): SourceDiffStatus {
  if (statuses.includes("changed")) return "changed";
  if (statuses.includes("unknown")) return "unknown";
  return "unchanged";
}

function sameBlobSet(left: readonly BlobEvidence[], right: readonly BlobEvidence[]): boolean {
  const key = (blob: BlobEvidence) => `${blob.path}\u0000${blob.gitBlobSha}\u0000${blob.contentSha256 ?? ""}`;
  return sameSorted(left.map(key), right.map(key));
}

function sameEvidence(
  left: readonly { path: string; contentSha256: string }[],
  right: readonly { path: string; contentSha256: string }[]
): boolean {
  const key = (value: { path: string; contentSha256: string }) => `${value.path}\u0000${value.contentSha256}`;
  return sameSorted(left.map(key), right.map(key));
}

function sameSorted(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort(compareCodePointStrings);
  const sortedRight = [...right].sort(compareCodePointStrings);
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}
