import { createHash } from "node:crypto";
import type {
  ResearchSnapshot,
  ResearchSnapshotEntry,
  SnapshotEntryKind
} from "../model/complete-v1.js";

export const SNAPSHOT_ENTRY_KINDS = [
  "marketplace-entry",
  "plugin-manifest",
  "repository-record",
  "skill-file"
] as const satisfies readonly SnapshotEntryKind[];

export function canonicalizeSnapshotEntries(
  entries: readonly ResearchSnapshotEntry[]
): ResearchSnapshotEntry[] {
  return entries
    .map(({ kind, address, sourceUrl }) => ({ kind, address, sourceUrl }))
    .sort(compareSnapshotEntries);
}

export function snapshotContentBytes(entries: readonly ResearchSnapshotEntry[]): Buffer {
  const projected = canonicalizeSnapshotEntries(entries).map(({ kind, address, sourceUrl }) =>
    ({ kind, address, sourceUrl })
  );
  return Buffer.from(`${JSON.stringify(projected)}\n`, "utf8");
}

export function computeSnapshotContentSha256(entries: readonly ResearchSnapshotEntry[]): string {
  return createHash("sha256").update(snapshotContentBytes(entries)).digest("hex");
}

export function verifyResearchSnapshot(snapshot: ResearchSnapshot): ResearchSnapshot {
  const entryCounts = new Map<SnapshotEntryKind, number>();
  const entryIdentities = new Set<string>();

  for (const entry of snapshot.entries) {
    assertSnapshotEntryKind(entry.kind, "entry");
    assertSnapshotEntryAddress(entry);

    const identity = `${entry.kind}\u0000${entry.address}`;
    if (entryIdentities.has(identity)) {
      throw new Error(`Duplicate research snapshot kind-address identity: ${entry.kind} ${entry.address}`);
    }
    entryIdentities.add(identity);
    entryCounts.set(entry.kind, (entryCounts.get(entry.kind) ?? 0) + 1);
  }

  const metricsByKind = new Map<SnapshotEntryKind, number>();
  for (const metric of snapshot.countMetrics) {
    assertSnapshotEntryKind(metric.kind, "count metric");
    assertCountMetric(metric);

    if (!entryCounts.has(metric.kind)) {
      throw new Error(`Unrepresented count metric kind: ${metric.kind}`);
    }
    if (metricsByKind.has(metric.kind)) {
      throw new Error(`Duplicate count metric kind: ${metric.kind}`);
    }
    metricsByKind.set(metric.kind, metric.independentlyCountedTotal);
  }

  for (const [kind, entryCount] of entryCounts) {
    const independentlyCountedTotal = metricsByKind.get(kind);
    if (independentlyCountedTotal === undefined) {
      throw new Error(`Missing count metric for represented kind: ${kind}`);
    }
    if (independentlyCountedTotal !== entryCount) {
      throw new Error(
        `Count metric independentlyCountedTotal for ${kind} is ${independentlyCountedTotal}; expected ${entryCount}`
      );
    }
  }

  const actualContentSha256 = computeSnapshotContentSha256(snapshot.entries);
  if (snapshot.contentSha256 !== actualContentSha256) {
    throw new Error(
      `Research snapshot content SHA-256 does not match canonical entries: expected ${actualContentSha256}, received ${snapshot.contentSha256}`
    );
  }

  return snapshot;
}

export function compareCodePointStrings(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);

  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftCharacters[index]!.codePointAt(0)!;
    const rightPoint = rightCharacters[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) {
      return leftPoint < rightPoint ? -1 : 1;
    }
  }

  return leftCharacters.length === rightCharacters.length
    ? 0
    : (leftCharacters.length < rightCharacters.length ? -1 : 1);
}

function compareSnapshotEntries(left: ResearchSnapshotEntry, right: ResearchSnapshotEntry): number {
  return compareCodePointStrings(left.kind, right.kind)
    || compareCodePointStrings(left.address, right.address)
    || compareNullableCodePointStrings(left.sourceUrl, right.sourceUrl);
}

function compareNullableCodePointStrings(left: string | null, right: string | null): number {
  if (left === null) {
    return right === null ? 0 : -1;
  }
  return right === null ? 1 : compareCodePointStrings(left, right);
}

function assertSnapshotEntryKind(kind: string, context: string): asserts kind is SnapshotEntryKind {
  if (!(SNAPSHOT_ENTRY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unsupported research snapshot ${context} kind: ${kind}`);
  }
}

function assertSnapshotEntryAddress(entry: ResearchSnapshotEntry): void {
  if (entry.kind === "repository-record") {
    if (entry.address !== "." && !isMarkdownLinkRepositoryRecordAddress(entry.address)) {
      throw new Error(
        `Research snapshot repository-record address must be . or a repository-relative Markdown path plus #link/<zero-based-index>: ${entry.address}`
      );
    }
    return;
  }

  if (entry.kind === "marketplace-entry") {
    if (!isMarketplaceEntryAddress(entry.address)) {
      throw new Error(
        `Research snapshot marketplace-entry address must be a repository-relative path plus #/plugins/<zero-based-index>: ${entry.address}`
      );
    }
    return;
  }

  if (!isRepositoryRelativePosixFilePath(entry.address)) {
    throw new Error(`Research snapshot ${entry.kind} address must be a repository-relative POSIX file path: ${entry.address}`);
  }
}

function isMarkdownLinkRepositoryRecordAddress(address: string): boolean {
  const fragmentIndex = address.indexOf("#");
  if (fragmentIndex <= 0 || address.indexOf("#", fragmentIndex + 1) !== -1) {
    return false;
  }

  const markdownPath = address.slice(0, fragmentIndex);
  const fragment = address.slice(fragmentIndex + 1);
  return isRepositoryRelativePosixFilePath(markdownPath)
    && /\.(?:md|markdown)$/iu.test(markdownPath)
    && /^link\/(?:0|[1-9][0-9]*)$/u.test(fragment);
}

function isMarketplaceEntryAddress(address: string): boolean {
  const fragmentIndex = address.indexOf("#");
  if (fragmentIndex <= 0 || address.indexOf("#", fragmentIndex + 1) !== -1) {
    return false;
  }

  const marketplacePath = address.slice(0, fragmentIndex);
  const pointer = address.slice(fragmentIndex + 1);
  if (!isRepositoryRelativePosixFilePath(marketplacePath)) {
    return false;
  }

  const pointerTokens = parseRfc6901Pointer(pointer);
  return pointerTokens !== null
    && pointerTokens.length === 2
    && pointerTokens[0] === "plugins"
    && /^(?:0|[1-9][0-9]*)$/u.test(pointerTokens[1]!);
}

function isRepositoryRelativePosixFilePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.endsWith("/") || path.includes("\\") || path.includes("\0")) {
    return false;
  }

  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function parseRfc6901Pointer(pointer: string): string[] | null {
  if (!pointer.startsWith("/")) {
    return null;
  }

  const tokens: string[] = [];
  for (const token of pointer.slice(1).split("/")) {
    let decoded = "";
    for (let index = 0; index < token.length; index += 1) {
      const character = token[index]!;
      if (character !== "~") {
        decoded += character;
        continue;
      }

      const escaped = token[index + 1];
      if (escaped === "0") {
        decoded += "~";
      } else if (escaped === "1") {
        decoded += "/";
      } else {
        return null;
      }
      index += 1;
    }
    tokens.push(decoded);
  }

  return tokens;
}

function assertCountMetric(metric: ResearchSnapshot["countMetrics"][number]): void {
  const hasReportedCount = metric.reportedCount !== null;
  const hasReportedCountSourceUrl = metric.reportedCountSourceUrl !== null;
  if (hasReportedCount !== hasReportedCountSourceUrl) {
    throw new Error("Research snapshot reportedCount and reportedCountSourceUrl must both be null or both non-null");
  }

  if (metric.reportedCount !== null && (!Number.isInteger(metric.reportedCount) || metric.reportedCount < 0)) {
    throw new Error(`Research snapshot reportedCount must be a non-negative integer: ${metric.kind}`);
  }

  if (!Number.isInteger(metric.independentlyCountedTotal) || metric.independentlyCountedTotal < 0) {
    throw new Error(`Research snapshot independentlyCountedTotal must be a non-negative integer: ${metric.kind}`);
  }
}
