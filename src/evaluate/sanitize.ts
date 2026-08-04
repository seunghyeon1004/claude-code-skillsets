import { readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  hasExactRequiredBranchProtectionChecks,
  requiredCheckBindings
} from "../governance/branch-protection.js";
import {
  assertCanonicalExistingDirectory,
  createExclusiveOutputDirectory,
  writeExclusiveOutputFile
} from "../safety/safe-output.js";
import {
  containsSensitiveText,
  sanitizeReceiptValue,
  sensitiveReceiptKeyPattern
} from "./redact.js";

export { sanitizeReceiptValue } from "./redact.js";

export async function sanitizeReceiptTree(source: string, destination: string): Promise<void> {
  const resolvedSource = await assertCanonicalExistingDirectory(resolve(source), "Source receipt tree");
  const resolvedDestination = resolve(destination);
  if (resolvedSource === resolvedDestination) {
    throw new Error("Source and destination receipt trees must be different");
  }
  const relativeDestination = relative(resolvedSource, resolvedDestination);
  if (relativeDestination !== ""
    && relativeDestination !== ".."
    && !relativeDestination.startsWith(`..${sep}`)
    && !isAbsolute(relativeDestination)) {
    throw new Error("Destination receipt tree must not be inside the source tree");
  }

  await createExclusiveOutputDirectory(resolvedDestination);
  await sanitizeDirectory(resolvedSource, resolvedSource, resolvedDestination);
  await verifySanitizedReceiptTree(resolvedDestination);
}

async function sanitizeDirectory(root: string, source: string, destination: string): Promise<void> {
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await createExclusiveOutputDirectory(destinationPath);
      await sanitizeDirectory(root, sourcePath, destinationPath);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const value = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
      const sanitized = sanitizeReceiptValue(value);
      await writeExclusiveOutputFile(
        destinationPath,
        `${JSON.stringify(projectReceiptForUpload(sanitized), null, 2)}\n`
      );
    } else {
      throw new Error(`Unsupported entry in source receipt tree: ${relative(root, sourcePath)}`);
    }
  }
}

export async function verifySanitizedReceiptTree(directory: string): Promise<void> {
  const root = resolve(directory);
  await verifyDirectory(root, root);
}

async function verifyDirectory(root: string, directory: string): Promise<void> {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await verifyDirectory(root, path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new Error(`Unsupported entry in sanitized receipt tree: ${relative(root, path)}`);
    }

    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    assertSafeStringsAndKeys(value, relative(root, path));
    assertProjectedReceipt(value, relative(root, path));
  }
}

function assertSafeStringsAndKeys(value: unknown, receiptPath: string): void {
  if (typeof value === "string") {
    if (containsSensitiveText(value)) {
      throw new Error(`Unsafe sanitized receipt content detected in ${receiptPath}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertSafeStringsAndKeys(item, receiptPath);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (sensitiveReceiptKeyPattern.test(key) && item !== "[redacted]") {
        throw new Error(`Sensitive receipt key ${JSON.stringify(key)} is not redacted in ${receiptPath}`);
      }
      assertSafeStringsAndKeys(item, receiptPath);
    }
  }
}


function projectReceiptForUpload(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new Error("Unsupported semantic receipt shape for sanitized upload");
  }
  if (value.schemaVersion === 3) return projectBranchProtectionReceipt(value);
  if (value.schemaVersion === 5 && value.receiptType === "local-semantic-rc-target") {
    return projectLocalSemanticRcTargetReceipt(value);
  }
  if (value.schemaVersion !== 1 || typeof value.passed !== "boolean") {
    throw new Error("Unsupported semantic receipt shape for sanitized upload");
  }
  if (Array.isArray(value.cases)) {
    const cases = value.cases.map((item) => projectSummaryCase(item));
    return {
      schemaVersion: 1,
      receiptType: "summary",
      passed: value.passed,
      cases,
      counts: {
        cases: cases.length,
        casesPassed: cases.filter(({ passed }) => passed).length
      }
    };
  }
  if (
    typeof value.caseId === "string"
    && isCaseType(value.caseType)
    && Array.isArray(value.expectedBehaviors)
    && Array.isArray(value.forbiddenBehaviors)
    && Array.isArray(value.errors)
  ) {
    assertSafeReceiptIdentifier(value.caseId, "caseId");
    const expectedPassed = countPassedBehaviors(value.expectedBehaviors, "expectedBehaviors");
    const forbiddenPassed = countPassedBehaviors(value.forbiddenBehaviors, "forbiddenBehaviors");
    const projected: Record<string, unknown> = {
      schemaVersion: 1,
      receiptType: "case"
    };
    if (typeof value.key === "string") {
      assertSafeReceiptIdentifier(value.key, "key");
      projected.key = value.key;
    }
    projected.caseId = value.caseId;
    if (typeof value.skillId === "string") {
      assertSafeReceiptIdentifier(value.skillId, "skillId");
      projected.skillId = value.skillId;
    }
    projected.caseType = value.caseType;
    projected.passed = value.passed;
    projected.counts = {
      expectedBehaviors: value.expectedBehaviors.length,
      expectedBehaviorsPassed: expectedPassed,
      forbiddenBehaviors: value.forbiddenBehaviors.length,
      forbiddenBehaviorsPassed: forbiddenPassed,
      errors: value.errors.length
    };
    return projected;
  }
  throw new Error("Unsupported semantic receipt shape for sanitized upload");
}

function projectBranchProtectionReceipt(value: Record<string, unknown>): Record<string, unknown> {
  if (
    value.directPushesDisabled !== true
    || value.forcePushesDisabled !== true
    || value.deletionsDisabled !== true
    || !hasExactRequiredBranchProtectionChecks(value.requiredChecks)
    || value.minimumApprovals !== 0
    || value.dismissesStaleReviews !== true
    || value.requiresCodeOwnerReview !== false
    || value.governanceMode !== "solo-maintainer"
    || value.humanReviewGuarantee !== "not-guaranteed"
  ) {
    throw new Error("Unsupported branch protection receipt shape for sanitized upload");
  }
  const repositoryMetadata = projectRepositoryMetadata(value);
  return {
    schemaVersion: 3,
    receiptType: "branch-protection",
    ...repositoryMetadata,
    directPushesDisabled: value.directPushesDisabled,
    forcePushesDisabled: value.forcePushesDisabled,
    deletionsDisabled: value.deletionsDisabled,
    requiredChecks: requiredCheckBindings(),
    minimumApprovals: value.minimumApprovals,
    dismissesStaleReviews: value.dismissesStaleReviews,
    requiresCodeOwnerReview: value.requiresCodeOwnerReview,
    governanceMode: value.governanceMode,
    humanReviewGuarantee: value.humanReviewGuarantee
  };
}

function projectLocalSemanticRcTargetReceipt(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.commitSha !== "string"
    || !/^[0-9a-f]{40}$/u.test(value.commitSha)
    || value.executionMode !== "subscription-claude-cli-fixture-read-only"
    || value.humanReviewGuarantee !== "not-guaranteed") {
    throw new Error("Unsupported local semantic RC target receipt shape for sanitized upload");
  }
  return {
    schemaVersion: 5,
    receiptType: "local-semantic-rc-target",
    commitSha: value.commitSha,
    executionMode: value.executionMode,
    humanReviewGuarantee: value.humanReviewGuarantee
  };
}

function projectSummaryCase(value: unknown): Record<string, string | boolean> {
  if (!isRecord(value) || typeof value.passed !== "boolean") {
    throw new Error("Unsupported semantic summary case for sanitized upload");
  }
  const projected: Record<string, string | boolean> = {};
  if (typeof value.key === "string") {
    assertSafeReceiptIdentifier(value.key, "summary key");
    projected.key = value.key;
  }
  if (typeof value.caseId === "string") {
    assertSafeReceiptIdentifier(value.caseId, "summary caseId");
    projected.caseId = value.caseId;
  }
  if (isCaseType(value.caseType)) {
    projected.caseType = value.caseType;
  }
  if (projected.key === undefined && projected.caseId === undefined) {
    throw new Error("Sanitized summary case requires a key or caseId");
  }
  projected.passed = value.passed;
  return projected;
}

function countPassedBehaviors(value: unknown[], field: string): number {
  let passed = 0;
  for (const item of value) {
    if (!isRecord(item) || typeof item.passed !== "boolean") {
      throw new Error(`Unsupported ${field} result for sanitized upload`);
    }
    if (item.passed) {
      passed += 1;
    }
  }
  return passed;
}

function assertProjectedReceipt(value: unknown, receiptPath: string): void {
  if (!isRecord(value)) {
    throw unsupportedProjectedShape(receiptPath);
  }
  if (value.schemaVersion === 3 && value.receiptType === "branch-protection") {
    assertExactKeys(
      value,
      ["schemaVersion", "receiptType", "repositoryId", "repositoryOwnerType", "commitSha", "directPushesDisabled", "forcePushesDisabled", "deletionsDisabled", "requiredChecks", "minimumApprovals", "dismissesStaleReviews", "requiresCodeOwnerReview", "governanceMode", "humanReviewGuarantee"],
      receiptPath
    );
    if (
      value.directPushesDisabled !== true
      || value.forcePushesDisabled !== true
      || value.deletionsDisabled !== true
      || !hasExactRequiredBranchProtectionChecks(value.requiredChecks)
      || value.minimumApprovals !== 0
      || value.dismissesStaleReviews !== true
      || value.requiresCodeOwnerReview !== false
      || value.governanceMode !== "solo-maintainer"
      || value.humanReviewGuarantee !== "not-guaranteed"
      || !hasValidSanitizedRepositoryEvidence(value)
    ) {
      throw unsupportedProjectedShape(receiptPath);
    }
    return;
  }
  if (value.schemaVersion === 5 && value.receiptType === "local-semantic-rc-target") {
    assertExactKeys(
      value,
      ["schemaVersion", "receiptType", "commitSha", "executionMode", "humanReviewGuarantee"],
      receiptPath
    );
    if (typeof value.commitSha !== "string"
      || !/^[0-9a-f]{40}$/u.test(value.commitSha)
      || value.executionMode !== "subscription-claude-cli-fixture-read-only"
      || value.humanReviewGuarantee !== "not-guaranteed") {
      throw unsupportedProjectedShape(receiptPath);
    }
    return;
  }
  if (value.schemaVersion !== 1) throw unsupportedProjectedShape(receiptPath);
  if (value.receiptType === "case") {
    const optional = [
      ...(value.key === undefined ? [] : ["key"]),
      ...(value.skillId === undefined ? [] : ["skillId"])
    ];
    assertExactKeys(value, [
      "schemaVersion", "receiptType", ...optional, "caseId", "caseType", "passed", "counts"
    ], receiptPath);
    if (
      typeof value.caseId !== "string"
      || !isCaseType(value.caseType)
      || typeof value.passed !== "boolean"
      || !isRecord(value.counts)
    ) {
      throw unsupportedProjectedShape(receiptPath);
    }
    assertSafeReceiptIdentifier(value.caseId, "caseId");
    for (const identifier of [value.key, value.skillId]) {
      if (identifier !== undefined) {
        if (typeof identifier !== "string") {
          throw unsupportedProjectedShape(receiptPath);
        }
        assertSafeReceiptIdentifier(identifier, "case identifier");
      }
    }
    assertCountRecord(value.counts, [
      "expectedBehaviors",
      "expectedBehaviorsPassed",
      "forbiddenBehaviors",
      "forbiddenBehaviorsPassed",
      "errors"
    ], receiptPath);
    return;
  }
  if (value.receiptType === "summary") {
    assertExactKeys(
      value,
      ["schemaVersion", "receiptType", "passed", "cases", "counts"],
      receiptPath
    );
    if (!Array.isArray(value.cases) || typeof value.passed !== "boolean" || !isRecord(value.counts)) {
      throw unsupportedProjectedShape(receiptPath);
    }
    for (const item of value.cases) {
      assertProjectedSummaryCase(item, receiptPath);
    }
    assertCountRecord(value.counts, ["cases", "casesPassed"], receiptPath);
    return;
  }
  throw unsupportedProjectedShape(receiptPath);
}

function projectRepositoryMetadata(value: Record<string, unknown>): Record<string, unknown> {
  if (!hasValidRawRepositoryEvidence(value)) {
    throw new Error("Unsupported branch protection repository metadata for sanitized upload");
  }
  return {
    repositoryId: value.repositoryId,
    repositoryOwnerType: value.repositoryOwnerType,
    commitSha: value.commitSha
  };
}

function hasValidRawRepositoryEvidence(value: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value.repositoryId)
    && (value.repositoryId as number) > 0
    && typeof value.repositoryOwnerLogin === "string"
    && /^[A-Za-z0-9_.-]+$/u.test(value.repositoryOwnerLogin)
    && (value.repositoryOwnerType === "User" || value.repositoryOwnerType === "Organization")
    && typeof value.commitSha === "string"
    && /^[0-9a-f]{40}$/u.test(value.commitSha);
}

function hasValidSanitizedRepositoryEvidence(value: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value.repositoryId)
    && (value.repositoryId as number) > 0
    && (value.repositoryOwnerType === "User" || value.repositoryOwnerType === "Organization")
    && typeof value.commitSha === "string"
    && /^[0-9a-f]{40}$/u.test(value.commitSha);
}

function assertProjectedSummaryCase(value: unknown, receiptPath: string): void {
  if (!isRecord(value) || typeof value.passed !== "boolean") {
    throw unsupportedProjectedShape(receiptPath);
  }
  const allowed = [
    ...(value.key === undefined ? [] : ["key"]),
    ...(value.caseId === undefined ? [] : ["caseId"]),
    ...(value.caseType === undefined ? [] : ["caseType"]),
    "passed"
  ];
  assertExactKeys(value, allowed, receiptPath);
  if (value.key === undefined && value.caseId === undefined) {
    throw unsupportedProjectedShape(receiptPath);
  }
  for (const identifier of [value.key, value.caseId]) {
    if (identifier !== undefined) {
      if (typeof identifier !== "string") {
        throw unsupportedProjectedShape(receiptPath);
      }
      assertSafeReceiptIdentifier(identifier, "summary identifier");
    }
  }
  if (value.caseType !== undefined && !isCaseType(value.caseType)) {
    throw unsupportedProjectedShape(receiptPath);
  }
}

function assertCountRecord(
  value: Record<string, unknown>,
  keys: string[],
  receiptPath: string
): void {
  assertExactKeys(value, keys, receiptPath);
  if (keys.some((key) => !Number.isInteger(value[key]) || (value[key] as number) < 0)) {
    throw unsupportedProjectedShape(receiptPath);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: string[],
  receiptPath: string
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw unsupportedProjectedShape(receiptPath);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCaseType(value: unknown): value is "normal" | "boundary" {
  return value === "normal" || value === "boundary";
}

function assertSafeReceiptIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Unsafe sanitized receipt ${field}: ${JSON.stringify(value)}`);
  }
}

function unsupportedProjectedShape(receiptPath: string): Error {
  return new Error(`Unsupported sanitized receipt shape in ${receiptPath}`);
}

if (process.argv[1] !== undefined && basename(process.argv[1]) === "sanitize.ts") {
  const operation = process.argv[2];
  if (operation === "--verify") {
    const directory = process.argv[3];
    if (directory === undefined || process.argv[4] !== undefined) {
      throw new Error("Usage: npm run eval:sanitize:verify -- <directory>");
    }
    await verifySanitizedReceiptTree(resolve(directory));
  } else if (operation !== undefined && process.argv[3] !== undefined && process.argv[4] === undefined) {
    await sanitizeReceiptTree(resolve(operation), resolve(process.argv[3]));
  } else {
    throw new Error("Usage: npm run eval:sanitize -- <source> <destination>");
  }
}
