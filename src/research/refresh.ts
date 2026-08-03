import { isAbsolute, relative, resolve } from "node:path";

export interface RefreshRequest {
  observedAt: string;
  baseSha: string;
  baseCatalogDigest: string;
  stagingRoot: string;
}

export interface RefreshResult {
  changed: boolean;
  baseDigest: string;
  resultDigest: string;
  changedPaths: string[];
}

export interface RefreshSource {
  id: string;
  collect(input: { observedAt: string; stagingRoot: string }): Promise<void>;
}

export interface CatalogRefreshAdapters {
  createStagingRoot(parent: string): Promise<string>;
  removeStagingRoot(stagingRoot: string): Promise<void>;
  prepareStaging(stagingRoot: string): Promise<void>;
  generateCatalog(input: { stagingRoot: string; observedAt: string }): Promise<void>;
  digestCatalog(stagingRoot: string): Promise<string>;
  prepareCandidate(input: {
    stagingRoot: string;
    resultDigest: string;
  }): Promise<RefreshCandidate>;
  runReleaseGates(input: { stagingRoot: string; observedAt: string }): Promise<void>;
  readRemoteMain(): Promise<{ sha: string; catalogDigest: string }>;
  publishValidatedArtifacts(input: {
    stagingRoot: string;
    resultDigest: string;
    candidate: RefreshCandidate;
  }): Promise<void>;
}

export interface RefreshCandidate {
  changedPaths: readonly string[];
  publish: boolean;
}

export interface RefreshCatalogInput {
  request: RefreshRequest;
  sources: readonly RefreshSource[];
  adapters: CatalogRefreshAdapters;
}

const SHA1 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class RefreshBaseChangedError extends Error {
  public constructor() {
    super("Remote main changed while the catalog refresh was staging; refusing to publish.");
  }
}

export async function refreshCatalog(input: RefreshCatalogInput): Promise<RefreshResult> {
  assertRequest(input.request);
  assertSources(input.sources);

  const stagingRoot = await input.adapters.createStagingRoot(input.request.stagingRoot);
  try {
    assertStagingRoot(stagingRoot, input.request.stagingRoot);
    await input.adapters.prepareStaging(stagingRoot);
    for (const source of input.sources) {
      await source.collect({ observedAt: input.request.observedAt, stagingRoot });
    }
    await input.adapters.generateCatalog({ stagingRoot, observedAt: input.request.observedAt });

    const resultDigest = await input.adapters.digestCatalog(stagingRoot);
    assertDigest(resultDigest, "staged catalog digest");
    if (resultDigest === input.request.baseCatalogDigest) {
      return unchangedResult(input.request.baseCatalogDigest);
    }

    const candidate = await input.adapters.prepareCandidate({ stagingRoot, resultDigest });
    assertCandidate(candidate);
    if (!candidate.publish) {
      return changedResult(input.request.baseCatalogDigest, resultDigest, candidate.changedPaths);
    }

    await input.adapters.runReleaseGates({ stagingRoot, observedAt: input.request.observedAt });

    const remote = await input.adapters.readRemoteMain();
    assertRemoteState(remote);
    if (remote.sha !== input.request.baseSha || remote.catalogDigest !== input.request.baseCatalogDigest) {
      throw new RefreshBaseChangedError();
    }

    await input.adapters.publishValidatedArtifacts({ stagingRoot, resultDigest, candidate });
    return changedResult(input.request.baseCatalogDigest, resultDigest, candidate.changedPaths);
  } finally {
    await input.adapters.removeStagingRoot(stagingRoot);
  }
}

export function catalogRefreshBranchName(baseCatalogDigest: string, githubRunId: string): string {
  assertDigest(baseCatalogDigest, "base catalog digest");
  if (!/^[1-9][0-9]*$/u.test(githubRunId)) {
    throw new Error("GitHub run ID must be a positive decimal integer");
  }
  return `automation/catalog-refresh-${baseCatalogDigest.slice(0, 8)}-${githubRunId}`;
}

function unchangedResult(baseDigest: string): RefreshResult {
  return { changed: false, baseDigest, resultDigest: baseDigest, changedPaths: [] };
}

function changedResult(baseDigest: string, resultDigest: string, changedPaths: readonly string[]): RefreshResult {
  return { changed: true, baseDigest, resultDigest, changedPaths: [...changedPaths] };
}

function assertRequest(request: RefreshRequest): void {
  if (!RFC3339_UTC.test(request.observedAt)) throw new Error("observedAt must be an RFC3339 UTC timestamp");
  if (!SHA1.test(request.baseSha)) throw new Error("baseSha must be a lowercase Git commit SHA");
  assertDigest(request.baseCatalogDigest, "base catalog digest");
  if (request.stagingRoot.length === 0 || request.stagingRoot.includes("\0")) {
    throw new Error("stagingRoot must be a non-empty path");
  }
}

function assertSources(sources: readonly RefreshSource[]): void {
  if (sources.length === 0) throw new Error("A catalog refresh requires at least one source");
  const ids = new Set<string>();
  for (const source of sources) {
    if (!SOURCE_ID.test(source.id)) throw new Error(`Invalid refresh source ID: ${source.id}`);
    if (ids.has(source.id)) throw new Error(`Duplicate refresh source ID: ${source.id}`);
    if (typeof source.collect !== "function") throw new Error(`Refresh source ${source.id} must define collect`);
    ids.add(source.id);
  }
}

function assertStagingRoot(stagingRoot: string, parent: string): void {
  const relation = relative(resolve(parent), resolve(stagingRoot));
  if (stagingRoot.length === 0
    || stagingRoot.includes("\0")
    || relation.length === 0
    || relation === ".."
    || relation.startsWith("../")
    || relation.startsWith("..\\")
    || isAbsolute(relation)) {
    throw new Error("Refresh staging root must be a unique child directory");
  }
}

function assertRemoteState(state: { sha: string; catalogDigest: string }): void {
  if (!SHA1.test(state.sha)) throw new Error("Remote main SHA must be a lowercase Git commit SHA");
  assertDigest(state.catalogDigest, "remote catalog digest");
}

function assertDigest(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function assertCandidate(candidate: RefreshCandidate): void {
  if (typeof candidate.publish !== "boolean") throw new Error("Refresh candidate publish flag must be a boolean");
  assertChangedPaths(candidate.changedPaths);
}

function assertChangedPaths(paths: readonly string[]): void {
  if (paths.length === 0) throw new Error("A changed catalog refresh must publish at least one path");
  const unique = new Set<string>();
  for (const path of paths) {
    if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new Error(`Invalid published path: ${path}`);
    }
    if (unique.has(path)) throw new Error(`Duplicate published path: ${path}`);
    unique.add(path);
  }
}
