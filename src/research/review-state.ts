import { createHash } from "node:crypto";
import {
  compareRfc3339Timestamps,
  parseStrictRfc3339Timestamp
} from "../contracts/review-ledger.js";
import type { ObservationEvidence, SourceDiff, SourceObservation } from "../model/observation.js";
import type { ReviewDisposition, ReviewLedgerEvent, ReviewerRegistry } from "../model/review-ledger.js";
import { canonicalize } from "./canonical-json.js";
import { verifyReviewLedger } from "./review-ledger.js";
import type { ReviewStateObservation } from "./source-observation.js";
import { compareCodePointStrings } from "./snapshot.js";

export type MaterializedReviewReason = "not-reviewed" | "current" | "blocked" | "stale" | "stale-evidence";

export interface MaterializedReviewState {
  sourceId: string;
  skillPath: string | null;
  state: ReviewDisposition;
  reason: MaterializedReviewReason;
  decisionId: string | null;
  invalidatedDecisionId: string | null;
  snapshotId: string;
  inspectedCommit: string;
  observedAt: string;
  changeStatus: SourceDiff["status"];
}

export interface MaterializeReviewStateInput {
  observations: readonly ReviewStateObservation[];
  diffs: readonly SourceDiff[];
  ledger: readonly ReviewLedgerEvent[];
  reviewers: ReviewerRegistry;
  asOf: string;
}

export type { ReviewStateObservation } from "./source-observation.js";

/**
 * Produces current derived decisions. It receives the as-of instant explicitly and
 * never reads the wall clock, so equal inputs always produce equal output.
 */
export function materializeReviewState(input: MaterializeReviewStateInput): MaterializedReviewState[] {
  const asOf = parseUtc(input.asOf);
  // Historical append authority is checked at append time; materialization verifies structure only.
  const ledger = verifyReviewLedger({
    base: input.ledger,
    head: input.ledger,
    baseReviewers: input.reviewers,
    changedPaths: []
  });
  const diffBySource = new Map(input.diffs.map((diff) => [diff.sourceId, diff]));
  const leaves = new Map(ledger.leaves.map((event) => [targetKey(event.target.sourceId, event.target.skillPath), event]));
  const states: MaterializedReviewState[] = [];

  for (const observation of [...input.observations].sort(compareObservation)) {
    const diff = diffBySource.get(observation.source.sourceId);
    if (diff === undefined) throw new Error(`source ${observation.source.sourceId} has no current diff`);
    const sourceDecision = leaves.get(targetKey(observation.source.sourceId, null));
    const pathDecisions = ledger.leaves
      .filter((event) => event.target.sourceId === observation.source.sourceId && event.target.skillPath !== null)
      .sort((left, right) => compareCodePointStrings(left.target.skillPath!, right.target.skillPath!));
    const targets: Array<{ skillPath: string | null; decision: ReviewLedgerEvent | undefined }> = [];
    if (sourceDecision !== undefined || pathDecisions.length === 0) {
      targets.push({ skillPath: null, decision: sourceDecision });
    }
    targets.push(...pathDecisions.map((decision) => ({ skillPath: decision.target.skillPath, decision })));

    for (const target of targets) {
      states.push(materializeTarget({
        observation,
        diff,
        sourceDecision,
        decision: target.decision,
        skillPath: target.skillPath,
        asOf
      }));
    }
  }

  return states.sort((left, right) => compareCodePointStrings(left.sourceId, right.sourceId)
    || compareNullablePath(left.skillPath, right.skillPath));
}

/** Returns the inherited evidence digest for a source or an exact target path. */
export function inheritedEvidenceDigest(
  evidence: ObservationEvidence | undefined,
  skillPath?: string
): string | undefined {
  if (evidence === undefined) return undefined;
  const fields = inheritedSensitiveFields(evidence, skillPath);
  if (fields.some((field) => field.status === "unknown")) return undefined;
  const manifestBlobs = evidence.blobs
    .filter(({ path }) => isManifestPath(path) && (skillPath === undefined || governsSkillPath(path, skillPath)))
    .sort((left, right) => compareCodePointStrings(left.path, right.path));
  if (manifestBlobs.some(({ readStatus }) => readStatus !== "observed")) return undefined;
  return createHash("sha256").update(canonicalize({
    manifests: manifestBlobs.map(({ path, gitBlobSha, contentSha256 }) => ({ path, gitBlobSha, contentSha256 })),
    fields
  }), "utf8").digest("hex");
}

/** Verifies the same exact-path freshness predicate used by review-state materialization. */
export function isExactReviewDecisionCurrent(
  decision: ReviewLedgerEvent,
  observation: ReviewStateObservation,
  skillPath: string,
  asOf: string
): boolean {
  return !exactDecisionIsStale(decision, observation, skillPath, parseUtc(asOf));
}

function materializeTarget(input: {
  observation: ReviewStateObservation;
  diff: SourceDiff;
  sourceDecision: ReviewLedgerEvent | undefined;
  decision: ReviewLedgerEvent | undefined;
  skillPath: string | null;
  asOf: ReturnType<typeof parseStrictRfc3339Timestamp>;
}): MaterializedReviewState {
  const { observation, diff, sourceDecision, decision, skillPath, asOf } = input;
  const base = stateBase(observation.source, observation, diff, skillPath);
  if (sourceDecision?.disposition === "blocked" || decision?.disposition === "blocked") {
    const blocked = sourceDecision?.disposition === "blocked" ? sourceDecision : decision!;
    return { ...base, state: "blocked", reason: "blocked", decisionId: blocked.id, invalidatedDecisionId: null };
  }
  if (decision === undefined) {
    return { ...base, state: "held", reason: "not-reviewed", decisionId: null, invalidatedDecisionId: null };
  }

  const stale = skillPath === null
    ? sourceDecisionIsStale(decision, observation, asOf)
    : exactDecisionIsStale(decision, observation, skillPath, asOf);
  if (stale) {
    return {
      ...base,
      state: "held",
      reason: decision.disposition === "approved" ? "stale" : "stale-evidence",
      decisionId: decision.id,
      invalidatedDecisionId: decision.id
    };
  }
  return {
    ...base,
    state: decision.disposition,
    reason: "current",
    decisionId: decision.id,
    invalidatedDecisionId: null
  };
}

function sourceDecisionIsStale(
  decision: ReviewLedgerEvent,
  observation: ReviewStateObservation,
  asOf: ReturnType<typeof parseStrictRfc3339Timestamp>
): boolean {
  return isExpired(decision, asOf)
    || decision.baseline.snapshotId !== observation.snapshotId
    || decision.baseline.inspectedCommit !== observation.source.inspectedCommit
    || decision.baseline.contentSha256 !== observation.snapshotContentSha256;
}

function exactDecisionIsStale(
  decision: ReviewLedgerEvent,
  observation: ReviewStateObservation,
  skillPath: string,
  asOf: ReturnType<typeof parseStrictRfc3339Timestamp>
): boolean {
  if (isExpired(decision, asOf) || decision.baseline.pathBlobSha === null) return true;
  const evidence = observation.evidence;
  const pathBlob = evidence?.blobs.find((blob) => blob.path === skillPath);
  if (pathBlob?.readStatus !== "observed" || pathBlob.gitBlobSha !== decision.baseline.pathBlobSha) return true;
  if (inheritedEvidenceDigest(evidence, skillPath) !== decision.baseline.inheritedEvidenceDigest) return true;
  return !reviewedFieldsMatchCurrent(decision, evidence, skillPath);
}

function reviewedFieldsMatchCurrent(
  decision: ReviewLedgerEvent,
  evidence: ObservationEvidence | undefined,
  skillPath: string
): boolean {
  if (evidence === undefined) return false;
  const fields = inheritedSensitiveFields(evidence, skillPath);
  const pairs = [
    [decision.reviewedSensitiveFields.license, fields[0]!],
    [decision.reviewedSensitiveFields.permissions, fields[1]!],
    [decision.reviewedSensitiveFields.ownership, fields[2]!],
    [decision.reviewedSensitiveFields.dependencies, fields[3]!],
    [decision.reviewedSensitiveFields.executableSurface, fields[4]!]
  ] as const;
  return pairs.every(([reviewed, current]) => reviewed.status === current.status
    && sameEvidence(reviewed.evidence, current.evidence));
}

function stateBase(
  source: SourceObservation,
  observation: ReviewStateObservation,
  diff: SourceDiff,
  skillPath: string | null
): Omit<MaterializedReviewState, "state" | "reason" | "decisionId" | "invalidatedDecisionId"> {
  return {
    sourceId: source.sourceId,
    skillPath,
    snapshotId: observation.snapshotId,
    inspectedCommit: source.inspectedCommit,
    observedAt: source.observedAt,
    changeStatus: diff.status
  };
}

function isExpired(
  event: ReviewLedgerEvent,
  asOf: ReturnType<typeof parseStrictRfc3339Timestamp>
): boolean {
  return compareRfc3339Timestamps(parseStrictRfc3339Timestamp(event.expiresAt), asOf) <= 0;
}

function parseUtc(value: string) {
  if (!value.endsWith("Z")) throw new Error("asOf must be an explicit RFC3339 UTC timestamp");
  return parseStrictRfc3339Timestamp(value);
}

function isManifestPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return base === "package.json" || base === "plugin.json" || base === "marketplace.json"
    || base === "manifest.json" || /^manifest\.(?:json|ya?ml)$/u.test(base);
}

function governsSkillPath(evidencePath: string, skillPath: string): boolean {
  const separator = evidencePath.lastIndexOf("/");
  const evidenceDirectory = separator === -1 ? "" : evidencePath.slice(0, separator);
  const scope = evidenceDirectory === ".claude-plugin"
    ? ""
    : evidenceDirectory.endsWith("/.claude-plugin")
      ? evidenceDirectory.slice(0, -"/.claude-plugin".length)
      : evidenceDirectory;
  return scope === "" || skillPath.startsWith(`${scope}/`);
}

function inheritedSensitiveFields(evidence: ObservationEvidence, skillPath?: string) {
  const fields = [
    evidence.fields.license,
    evidence.fields.permissions,
    evidence.fields.ownership,
    evidence.fields.dependencies,
    evidence.fields.executableSurface
  ];
  if (skillPath === undefined) return fields;
  return fields.map((field) => {
    if (field.status !== "observed") return field;
    const directEvidence = field.evidence.filter((item) => governsSkillPath(item.path, skillPath));
    return directEvidence.length === 0
      ? { status: "unknown" as const, evidence: [] }
      : { ...field, evidence: directEvidence };
  });
}

function sameEvidence(
  left: readonly { path: string; contentSha256: string }[],
  right: readonly { path: string; contentSha256: string }[]
): boolean {
  const key = (item: { path: string; contentSha256: string }) => `${item.path}\u0000${item.contentSha256}`;
  const sortedLeft = left.map(key).sort(compareCodePointStrings);
  const sortedRight = right.map(key).sort(compareCodePointStrings);
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function targetKey(sourceId: string, skillPath: string | null): string {
  return `${sourceId}\u0000${skillPath ?? ""}`;
}

function compareObservation(left: ReviewStateObservation, right: ReviewStateObservation): number {
  return compareCodePointStrings(left.source.sourceId, right.source.sourceId);
}

function compareNullablePath(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : -1;
  return right === null ? 1 : compareCodePointStrings(left, right);
}
