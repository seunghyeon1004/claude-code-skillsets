import type { ResearchSnapshot } from "../model/complete-v1.js";

export function snapshotAttestsRepositoryPath(
  snapshot: ResearchSnapshot,
  repository: string,
  path: string
): boolean {
  return snapshotAttestsRepository(snapshot, repository) && snapshotAttestsPath(snapshot, path);
}

export function snapshotAttestsRepository(snapshot: ResearchSnapshot, repository: string): boolean {
  return snapshot.sourceUrl === repository
    && snapshot.entries.some((entry) =>
      entry.kind === "repository-record" && entry.address === "." && entry.sourceUrl === repository);
}

export function snapshotAttestsPath(snapshot: ResearchSnapshot, path: string): boolean {
  const expected = canonicalRepositoryRelativePosixSegments(path);
  if (expected === undefined) return false;
  return snapshot.entries.some((entry) => {
    if (entry.kind !== "skill-file" && entry.kind !== "plugin-manifest") return false;
    if (entry.address === path) return true;
    if (expected.length === 0) return false;
    const entryPath = entry.address.split("#", 1)[0]!;
    const entrySegments = canonicalRepositoryRelativePosixSegments(entryPath);
    return entrySegments !== undefined && hasSegmentPrefix(expected, entrySegments);
  });
}

export function snapshotReferencesOriginalRepository(snapshot: ResearchSnapshot, repository: string): boolean {
  return snapshot.entries.some((entry) =>
    entry.kind === "repository-record" && entry.address !== "." && entry.sourceUrl === repository);
}

export function isPathWithinRepositoryPath(parent: string, child: string): boolean {
  const parentSegments = canonicalRepositoryRelativePosixSegments(parent);
  const childSegments = canonicalRepositoryRelativePosixSegments(child);
  return parentSegments !== undefined && childSegments !== undefined && hasSegmentPrefix(parentSegments, childSegments);
}

export function isCanonicalRepositoryRelativePosixPath(path: string): boolean {
  return path !== "." && canonicalRepositoryRelativePosixSegments(path) !== undefined;
}

export function canonicalRepositoryRelativePosixSegments(path: string): string[] | undefined {
  if (path === ".") return [];
  if (path.length === 0 || path.includes("\0") || path !== path.normalize("NFC") || path.startsWith("/")
    || path.includes("\\") || /^[A-Za-z]:\//u.test(path)) {
    return undefined;
  }
  const segments = path.split("/");
  return segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ? undefined
    : segments;
}

function hasSegmentPrefix(parent: readonly string[], child: readonly string[]): boolean {
  return child.length >= parent.length && parent.every((segment, index) => child[index] === segment);
}
