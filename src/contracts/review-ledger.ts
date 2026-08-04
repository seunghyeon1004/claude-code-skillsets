import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { BranchProtectionReceipt, ReviewLedgerEvent, ReviewerRegistry } from "../model/review-ledger.js";
import { hasExactRequiredBranchProtectionChecks } from "../governance/branch-protection.js";

const require = createRequire(import.meta.url);
const reviewLedgerEventSchema = require("../../schemas/v3/review-ledger-event.schema.json") as object;
const reviewerRegistrySchema = require("../../schemas/v3/reviewer-registry.schema.json") as object;
const branchProtectionReceiptSchema = require("../../schemas/v3/branch-protection-receipt.schema.json") as object;

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;
const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

export interface Rfc3339Timestamp {
  epochSeconds: number;
  fractionalSecond: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", { type: "string", validate: isStrictRfc3339Timestamp });
const validateReviewLedgerEventSchema = ajv.compile<ReviewLedgerEvent>(reviewLedgerEventSchema);
const validateReviewerRegistrySchema = ajv.compile<ReviewerRegistry>(reviewerRegistrySchema);
const validateBranchProtectionReceiptSchema = ajv.compile<BranchProtectionReceipt>(branchProtectionReceiptSchema);

export function validateReviewLedgerEvent(value: unknown): ReviewLedgerEvent {
  const event = validateContract("review ledger event", validateReviewLedgerEventSchema, value);
  assertStrictRepositoryRelativePath(event.target.skillPath, "target skillPath");
  for (const field of Object.values(event.reviewedSensitiveFields)) {
    for (const [index, reference] of field.evidence.entries()) {
      assertStrictRepositoryRelativePath(reference.path, `review evidence path ${index + 1}`);
    }
  }
  return event;
}

export function validateReviewerRegistry(value: unknown): ReviewerRegistry {
  const registry = validateContract("reviewer registry", validateReviewerRegistrySchema, value);
  const ids = new Set<string>();
  for (const reviewer of registry.reviewers) {
    if (ids.has(reviewer.id)) throw new Error(`Invalid reviewer registry: duplicate reviewer ID ${reviewer.id}`);
    ids.add(reviewer.id);
    if (new Set(reviewer.roles).size !== reviewer.roles.length) {
      throw new Error(`Invalid reviewer registry: duplicate role for ${reviewer.id}`);
    }
  }
  return registry;
}

export function validateBranchProtectionReceipt(value: unknown): BranchProtectionReceipt {
  const receipt = validateContract("branch protection receipt", validateBranchProtectionReceiptSchema, value);
  if (receipt.repository.split("/", 1)[0] !== receipt.repositoryOwnerLogin) {
    throw new Error("Invalid branch protection receipt: repository owner login must match repository");
  }
  if (!hasExactRequiredBranchProtectionChecks(receipt.requiredChecks)) {
    throw new Error("Invalid branch protection receipt: required checks must bind to GitHub Actions exactly");
  }
  return receipt;
}

/** Accepts only nonempty repository-relative paths made of non-dot, non-control segments. */
export function isStrictRepositoryRelativePath(value: string): boolean {
  return value.length > 0
    && !CONTROL_CHARACTER.test(value)
    && !value.includes("\\")
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** Parses the strict RFC3339 timestamp profile used by review records and receipts. */
export function parseStrictRfc3339Timestamp(value: string): Rfc3339Timestamp {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (match === null) throw new Error("timestamp must be strict RFC3339");

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionalSecond = "", offset] = match;
  if (offset === undefined) throw new Error("timestamp must be strict RFC3339");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59) {
    throw new Error("timestamp must be a real strict RFC3339 date-time");
  }

  const offsetSeconds = offset === "Z" ? 0 : offsetToSeconds(offset);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return { epochSeconds: date.getTime() / 1000 - offsetSeconds, fractionalSecond };
}

export function compareRfc3339Timestamps(left: Rfc3339Timestamp, right: Rfc3339Timestamp): number {
  if (left.epochSeconds !== right.epochSeconds) return left.epochSeconds - right.epochSeconds;
  const length = Math.max(left.fractionalSecond.length, right.fractionalSecond.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = left.fractionalSecond.charCodeAt(index) || 48;
    const rightDigit = right.fractionalSecond.charCodeAt(index) || 48;
    if (leftDigit !== rightDigit) return leftDigit - rightDigit;
  }
  return 0;
}

function validateContract<T>(kind: string, validator: ValidateFunction<T>, value: unknown): T {
  if (!validator(value)) {
    const errors = (validator.errors ?? []).map(formatError).join("; ");
    throw new Error(`Invalid ${kind}: ${errors}`);
  }
  return value;
}

function formatError(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
}

function assertStrictRepositoryRelativePath(value: string | null, label: string): void {
  if (value !== null && !isStrictRepositoryRelativePath(value)) {
    throw new Error(`Invalid review ledger event: ${label} must be a strict repository-relative path`);
  }
}

function isStrictRfc3339Timestamp(value: string): boolean {
  try {
    parseStrictRfc3339Timestamp(value);
    return true;
  } catch {
    return false;
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function offsetToSeconds(offset: string): number {
  const hour = Number(offset.slice(1, 3));
  const minute = Number(offset.slice(4, 6));
  if (hour > 23 || minute > 59 || offset === "-00:00") {
    throw new Error("timestamp offset must be a known strict RFC3339 offset");
  }
  const seconds = hour * 60 * 60 + minute * 60;
  return offset.startsWith("+") ? seconds : -seconds;
}
