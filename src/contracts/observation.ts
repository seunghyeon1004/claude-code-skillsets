import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import {
  MAX_OBSERVATION_BLOB_BYTES,
  MAX_OBSERVATION_SOURCE_BYTES,
  OBSERVATION_FIELD_NAMES,
  isAllowedObservationPath,
  isSafeRepositoryRelativePath,
  type ObservationEvidence,
  type SourceDiff,
  type SourceObservation
} from "../model/observation.js";

const require = createRequire(import.meta.url);
const observationEvidenceSchema = require("../../schemas/v3/observation-evidence.schema.json") as object;
const sourceObservationSchema = require("../../schemas/v3/source-observation.schema.json") as object;
const sourceDiffSchema = require("../../schemas/v3/source-diff.schema.json") as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateObservationEvidenceSchema = ajv.compile<ObservationEvidence>(observationEvidenceSchema);
const validateSourceObservationSchema = ajv.compile<SourceObservation>(sourceObservationSchema);
const validateSourceDiffSchema = ajv.compile<SourceDiff>(sourceDiffSchema);

export function validateObservationEvidence(value: unknown): ObservationEvidence {
  if (!validateObservationEvidenceSchema(value)) throwInvalid("observation evidence", validateObservationEvidenceSchema.errors);
  const semanticErrors = observationEvidenceErrors(value);
  if (semanticErrors.length > 0) throw new Error(`Invalid observation evidence:\n${semanticErrors.join("\n")}`);
  return value;
}

export function validateSourceObservation(value: unknown): SourceObservation {
  if (!validateSourceObservationSchema(value)) throwInvalid("source observation", validateSourceObservationSchema.errors);
  const semanticErrors = sourceObservationErrors(value);
  if (semanticErrors.length > 0) throw new Error("Invalid source observation:\n" + semanticErrors.join("\n"));
  return value;
}

export function validateSourceDiff(value: unknown): SourceDiff {
  if (!validateSourceDiffSchema(value)) throwInvalid("source diff", validateSourceDiffSchema.errors);
  return value;
}

function observationEvidenceErrors(value: ObservationEvidence): string[] {
  const errors: string[] = [];
  const blobsByPath = new Map<string, ObservationEvidence["blobs"][number]>();
  let previousPath: string | undefined;
  let observedBytes = 0;
  for (const blob of value.blobs) {
    if (!isSafeRepositoryRelativePath(blob.path)) {
      errors.push("blobs." + blob.path + ": path must be a safe repository-relative path");
    }
    if (previousPath !== undefined && compareCodePointStrings(previousPath, blob.path) >= 0) {
      errors.push(`blobs: paths must be code-point sorted and unique (${blob.path})`);
    }
    previousPath = blob.path;
    blobsByPath.set(blob.path, blob);
    if (blob.readStatus === "observed" && blob.contentSha256 === undefined) {
      errors.push(`blobs.${blob.path}: observed blobs require contentSha256`);
    }
    if (blob.readStatus === "unknown" && blob.contentSha256 !== undefined) {
      errors.push(`blobs.${blob.path}: unknown blobs must not have contentSha256`);
    }
    if (blob.readStatus === "observed") {
      if (!isAllowedObservationPath(blob.path)) {
        errors.push(`blobs.${blob.path}: observed blobs must use the collection allowlist`);
      }
      if (!Number.isSafeInteger(blob.byteSize) || blob.byteSize > MAX_OBSERVATION_BLOB_BYTES) {
        errors.push(`blobs.${blob.path}: observed blobs must not exceed 256 KiB`);
      } else {
        observedBytes += blob.byteSize;
      }
    }
  }
  if (observedBytes > MAX_OBSERVATION_SOURCE_BYTES) {
    errors.push("blobs: observed content must not exceed 4 MiB in total");
  }

  for (const fieldName of OBSERVATION_FIELD_NAMES) {
    const field = value.fields[fieldName];
    if (field.status === "observed" && field.evidence.length === 0) {
      errors.push(`fields.${fieldName}: observed fields require direct evidence`);
    }
    if (field.status !== "observed" && field.evidence.length > 0) {
      errors.push(`fields.${fieldName}: non-observed fields must not retain direct evidence`);
    }
    let previousEvidence: string | undefined;
    for (const evidence of field.evidence) {
      const key = `${evidence.path}\0${evidence.contentSha256}`;
      if (previousEvidence !== undefined && compareCodePointStrings(previousEvidence, key) >= 0) {
        errors.push(`fields.${fieldName}: evidence must be code-point sorted and unique`);
      }
      previousEvidence = key;
      const blob = blobsByPath.get(evidence.path);
      if (blob?.readStatus !== "observed" || blob.contentSha256 !== evidence.contentSha256) {
        errors.push(`fields.${fieldName}: evidence must reference an observed blob with its direct content SHA-256`);
      }
    }
  }
  return errors.sort(compareCodePointStrings);
}

function sourceObservationErrors(value: SourceObservation): string[] {
  const errors: string[] = [];
  for (const path of value.representativePaths) {
    if (!isSafeRepositoryRelativePath(path)) {
      errors.push("representativePaths." + path + ": path must be a safe repository-relative path");
    }
  }
  for (const fieldName of OBSERVATION_FIELD_NAMES) {
    for (const evidence of value.fields[fieldName].evidence) {
      if (!isSafeRepositoryRelativePath(evidence.path)) {
        errors.push("fields." + fieldName + "." + evidence.path + ": path must be a safe repository-relative path");
      }
    }
  }
  return errors.sort(compareCodePointStrings);
}

function throwInvalid(kind: string, errors: ErrorObject[] | null | undefined): never {
  const detail = (errors ?? [])
    .slice()
    .sort((left, right) => compareCodePointStrings(`${left.instancePath}:${left.keyword}`, `${right.instancePath}:${right.keyword}`))
    .map((error) => `${error.instancePath || "/"}: ${error.message ?? error.keyword}`)
    .join("\n");
  throw new Error(`Invalid ${kind}:${detail.length === 0 ? "" : `\n${detail}`}`);
}

function compareCodePointStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
