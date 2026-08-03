import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { validateObservationEvidence } from "../../src/contracts/observation.js";
import { validateReviewerRegistry } from "../../src/contracts/review-ledger.js";
import { validateOfficialMarketplaceSelection } from "../../src/discovery/official-marketplace.js";
import { hasPrivilegedReviewerAuthority } from "../../src/research/reviewer-authority.js";

interface Triad { sourceId: string; receiptId: string; snapshotId: string; }
interface Context {
  asOf: string;
  privateRcAt: string | null;
  upstreamObservations: Array<{ providerId: string; snapshotId: string; observedAt: string; headCommit: string }>;
}
interface TagRef { name: string; type: string; object: string; }
interface TagDetails { target: string; annotation: ReadonlyMap<string, string>; }

const approvedPrefix = "registry-approved/";
const rootTagName = "registry-approved/r01";
const gitOutputMaxBuffer = 64 * 1024 * 1024;
const evidenceRoot = "research/evidence/";
const evidenceArtifactsRoot = "research/evidence/artifacts/";
const observationEvidenceRoot = "research/observation-evidence/";
const observationEvidencePath = /^research\/observation-evidence\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/u;
const researchBatchSurfaces = [
  "manifests/decision-candidate-evidence.yaml",
  "research/review-queue.json",
  "manifests/complete-v1-providers",
  "manifests/source-reviews",
  "manifests/conflicts",
  "manifests/provider-selections",
  "research/review-source-extensions.json",
  "research/evidence",
  "research/observation-evidence",
  "research/marketplaces",
  "research/official-marketplace-review-backlog.json",
  "research/current-evaluation-context.json"
] as const;
const requiredPublicBaselinePaths = [
  "research/review-source-extensions.json",
  "research/current-evaluation-context.json",
  "manifests/decision-candidate-evidence.yaml"
] as const;

export type ResearchApprovalMode = "changed-batch" | "pre-approval-candidate";

export function assertExtensionAppendOnly(options: {
  base: string;
  root?: string;
  approvalMode?: ResearchApprovalMode;
  approvedRegistryTagObject?: string;
} = { base: "" }): void {
  const root = resolve(options.root ?? process.cwd());
  if (!options.base) throw new Error("--base is required");
  if (!gitSucceeds(root, ["merge-base", "--is-ancestor", options.base, "HEAD"])) {
    throw new Error("--base must be an ancestor of HEAD");
  }
  assertRequiredPublicBaseline(root, options.base);
  const prior = readJsonAt<{ triads: Triad[] }>(root, options.base, "research/review-source-extensions.json");
  const current = readJson<{ triads: Triad[] }>(join(root, "research/review-source-extensions.json"));
  assertSortedUniqueTriads(prior.triads, "prior extension triads");
  assertSortedUniqueTriads(current.triads, "current extension triads");
  const currentByKey = new Map(current.triads.map((triad) => [triadKey(triad), triad]));
  for (const triad of prior.triads) {
    const actual = currentByKey.get(triadKey(triad));
    if (actual === undefined || JSON.stringify(actual) !== JSON.stringify(triad)) {
      throw new Error(`review-source extension triad was deleted, reassigned, or rewritten: ${triadKey(triad)}`);
    }
  }
  assertStablePriorTriadRecords(root, options.base, prior.triads);
  assertStableObservationEvidence(root, options.base);
  assertOfficialMarketplaceSelectionAppendOnly(root, options.base);
  const evidenceArtifacts = assertStableEvidence(root, options.base);
  const decisionArtifacts = assertStableDecisionEvidenceManifest(root, options.base);
  assertNoUnreferencedEvidenceArtifacts(root, new Set([...evidenceArtifacts, ...decisionArtifacts]));
  assertMonotonicContext(root, options.base);

  const batchChanged = hasResearchBatchChanges({ root, base: options.base });
  // A protected operator input authenticates a tag chain only for a new research batch.
  // A pre-anchor base must still contain every mandatory public baseline path. Once
  // r01 exists, a changed batch must also present the operator-provided tag object.
  if (batchChanged && (options.approvedRegistryTagObject !== undefined
    || process.env.APPROVED_REGISTRY_TAG_OBJECT !== undefined
    || hasApprovalAnchor(root))) {
    assertApprovedTagChain(
      root,
      options.base,
      options.approvalMode ?? "changed-batch",
      options.approvedRegistryTagObject
    );
  }
}

export function assertOfficialMarketplaceSelectionAppendOnly(root: string, base: string): void {
  const marketplaceRoot = "research/marketplaces";
  const pointerPath = `${marketplaceRoot}/official-marketplace-current.json`;
  const priorHasPointer = gitSucceeds(root, ["cat-file", "-e", `${base}:${pointerPath}`]);
  if (!priorHasPointer && !existsSync(join(root, pointerPath))) return;
  const priorPaths = git(root, ["ls-tree", "-r", "--name-only", base, "--", marketplaceRoot])
    .split("\n")
    .filter((path) => path.length > 0 && path !== pointerPath);

  for (const path of priorPaths) {
    assertStablePath(root, base, path, "issued official marketplace artifact or selection record");
  }

  const current = validateOfficialMarketplaceSelection(root);
  if (!priorHasPointer) return;

  const priorPointer = readJsonAt<{ selection?: unknown }>(root, base, pointerPath);
  if (typeof priorPointer.selection !== "string" || priorPointer.selection.length === 0) {
    throw new Error("issued official marketplace pointer has no canonical selection path");
  }
  if (!current.chain.includes(priorPointer.selection)) {
    throw new Error("official marketplace selection chain does not retain the issued current selection");
  }
}

export function hasResearchBatchChanges(options: { base: string; root?: string }): boolean {
  const root = resolve(options.root ?? process.cwd());
  if (!options.base) throw new Error("--base is required");
  if (!gitSucceeds(root, ["merge-base", "--is-ancestor", options.base, "HEAD"])) {
    throw new Error("--base must be an ancestor of HEAD");
  }
  assertRequiredPublicBaseline(root, options.base);
  const prior = readJsonAt<{ triads: Triad[] }>(root, options.base, "research/review-source-extensions.json");
  const current = readJson<{ triads: Triad[] }>(join(root, "research/review-source-extensions.json"));
  return hasResearchBatchChangesAt(root, options.base, prior, current);
}

export function hasProtectedResearchBatchSurfaceChanges(root: string, from: string, to: string): boolean {
  return researchBatchSurfaces.some((surface) => git(root, ["diff", "--name-only", from, to, "--", surface]).length > 0);
}

function hasResearchBatchChangesAt(
  root: string,
  base: string,
  priorExtensions: { triads: Triad[] },
  currentExtensions: { triads: Triad[] }
): boolean {
  return researchBatchSurfaces.some((surface) => {
    return git(root, ["diff", "--name-only", base, "--", surface]).length > 0;
  }) || JSON.stringify(priorExtensions.triads) !== JSON.stringify(currentExtensions.triads);
}

function assertStablePriorTriadRecords(root: string, base: string, triads: readonly Triad[]): void {
  for (const triad of triads) {
    assertStableRecordById(root, base, "research/sources", "sourceId", triad.sourceId);
    assertStableRecordById(root, base, "research/receipts", "id", triad.receiptId);
    assertStableRecordById(root, base, "research/snapshots", "id", triad.snapshotId);
  }
}

function assertStableObservationEvidence(root: string, base: string): void {
  const priorPaths = git(root, ["ls-tree", "-r", "--name-only", base, "--", observationEvidenceRoot])
    .split("\n").filter(isObservationEvidenceRecordPath);
  const currentPaths = git(root, ["ls-files", "--", observationEvidenceRoot])
    .split("\n").filter((path) => path !== `${observationEvidenceRoot}.gitkeep` && path.length > 0);
  const priorIds = new Set<string>();
  for (const path of priorPaths) {
    const id = observationEvidenceId(path, readObservationEvidenceAt(root, base, path));
    if (priorIds.has(id)) throw new Error(`issued observation evidence records contain a duplicate id: ${id}`);
    priorIds.add(id);
    assertStablePath(root, base, path, "issued observation evidence record");
  }

  const currentIds = new Set<string>();
  const priorPathSet = new Set(priorPaths);
  for (const path of currentPaths) {
    const id = observationEvidenceId(path, readObservationEvidence(root, path));
    if (currentIds.has(id)) throw new Error(`current observation evidence records contain a duplicate id: ${id}`);
    currentIds.add(id);
    if (!priorPathSet.has(path) && priorIds.has(id)) {
      throw new Error(`new observation evidence record reuses an issued observation evidence id: ${id}`);
    }
  }
}

function isObservationEvidenceRecordPath(path: string): boolean {
  return path !== `${observationEvidenceRoot}.gitkeep` && path.startsWith(observationEvidenceRoot);
}

function observationEvidenceId(path: string, value: unknown): string {
  const match = path.match(observationEvidencePath);
  if (match?.[1] === undefined) throw new Error(`observation evidence path is not canonical: ${path}`);
  let evidence: ReturnType<typeof validateObservationEvidence>;
  try {
    evidence = validateObservationEvidence(value);
  } catch (error) {
    throw new Error(`observation evidence content is invalid: ${path}`, { cause: error });
  }
  if (evidence.id !== match[1]) throw new Error(`observation evidence path does not match its id: ${path}`);
  return evidence.id;
}

function readObservationEvidence(root: string, path: string): unknown {
  try {
    return readJson<unknown>(join(root, path));
  } catch (error) {
    throw new Error(`observation evidence content is invalid: ${path}`, { cause: error });
  }
}

function readObservationEvidenceAt(root: string, ref: string, path: string): unknown {
  try {
    return readJsonAt<unknown>(root, ref, path);
  } catch (error) {
    throw new Error(`observation evidence content is invalid at ${ref}: ${path}`, { cause: error });
  }
}

function assertStableRecordById(root: string, base: string, directory: string, field: string, id: string): void {
  const path = findRecordPathAt(root, base, directory, field, id);
  if (path === undefined) throw new Error(`${directory}: prior record is missing for ${field} ${id}`);
  assertStablePath(root, base, path, "issued source, receipt, or snapshot path");
}

function assertStableEvidence(root: string, base: string): Set<string> {
  const priorPaths = git(root, ["ls-tree", "-r", "--name-only", base, "--", "research/evidence"])
    .split("\n").filter(isEvidenceRecordPath);
  const priorIds = new Set<string>();
  const priorArtifacts = new Set<string>();
  for (const path of priorPaths) {
    assertStablePath(root, base, path, "issued evidence record");
    const evidence = readJsonAt<Record<string, unknown>>(root, base, path);
    if (typeof evidence.id !== "string" || evidence.id.length === 0) {
      throw new Error(`issued evidence record has no canonical id: ${path}`);
    }
    priorIds.add(evidence.id);
    for (const artifactPath of artifactReferences(evidence)) {
      assertStablePath(root, base, artifactPath, "issued evidence artifact");
      assertSafeTrackedArtifact(root, artifactPath, base);
      priorArtifacts.add(artifactPath);
    }
  }
  const currentPaths = git(root, ["ls-files", "--", "research/evidence"])
    .split("\n").filter(isEvidenceRecordPath);
  const currentIds = new Set<string>();
  const currentArtifacts = new Set<string>();
  for (const path of currentPaths) {
    const evidence = readJson<Record<string, unknown>>(join(root, path));
    if (typeof evidence.id !== "string" || evidence.id.length === 0 || currentIds.has(evidence.id)) {
      throw new Error(`current evidence records contain a duplicate or invalid id: ${path}`);
    }
    currentIds.add(evidence.id);
    const isNewRecord = !priorPaths.includes(path);
    if (isNewRecord && priorIds.has(evidence.id)) {
      throw new Error(`new evidence record reuses an issued evidence id: ${evidence.id}`);
    }
    for (const artifactPath of artifactReferences(evidence)) {
      assertSafeTrackedArtifact(root, artifactPath);
      if (isNewRecord && priorArtifacts.has(artifactPath)) {
        throw new Error(`new evidence record reuses an issued evidence artifact: ${artifactPath}`);
      }
      currentArtifacts.add(artifactPath);
    }
  }
  return currentArtifacts;
}

function assertStableDecisionEvidenceManifest(root: string, base: string): Set<string> {
  const path = "manifests/decision-candidate-evidence.yaml";
  const prior = readYamlAt(root, base, path);
  const current = readYaml(join(root, path));
  const priorManifest = assertDecisionEvidenceManifest(prior, "prior decision evidence manifest");
  const currentManifest = assertDecisionEvidenceManifest(current, "current decision evidence manifest");
  if (currentManifest.schemaVersion !== priorManifest.schemaVersion) {
    throw new Error("decision evidence manifest schemaVersion was rewritten");
  }
  assertAppendOnlyDecisionRecords(priorManifest.candidates, currentManifest.candidates, "candidate");
  const addedRevisions = assertAppendOnlyDecisionRecords(
    priorManifest.candidateRevisions ?? [],
    currentManifest.candidateRevisions ?? [],
    "candidate revision"
  );
  assertCandidateRevisionBaseAuthority(root, base, addedRevisions);
  assertAppendOnlyDecisionRecords(priorManifest.evidence, currentManifest.evidence, "evidence");
  assertAppendOnlyDecisionRecords(
    priorManifest.officialTargetCompatibilityEvidence ?? [],
    currentManifest.officialTargetCompatibilityEvidence ?? [],
    "official target compatibility evidence"
  );
  const priorArtifacts = new Set(artifactReferences(priorManifest));
  const currentArtifacts = new Set(artifactReferences(currentManifest));
  assertNoNewDecisionRecordReusesPriorArtifact(
    priorManifest.candidates,
    currentManifest.candidates,
    priorArtifacts,
    "candidate"
  );
  assertNoNewDecisionRecordReusesPriorArtifact(
    priorManifest.candidateRevisions ?? [],
    currentManifest.candidateRevisions ?? [],
    priorArtifacts,
    "candidate revision"
  );
  assertNoNewDecisionRecordReusesPriorArtifact(
    priorManifest.evidence,
    currentManifest.evidence,
    priorArtifacts,
    "evidence"
  );
  assertNoNewDecisionRecordReusesPriorArtifact(
    priorManifest.officialTargetCompatibilityEvidence ?? [],
    currentManifest.officialTargetCompatibilityEvidence ?? [],
    priorArtifacts,
    "official target compatibility evidence"
  );
  for (const artifactPath of priorArtifacts) {
    assertSafeTrackedArtifact(root, artifactPath, base);
    assertStablePath(root, base, artifactPath, "issued decision evidence artifact");
  }
  for (const artifactPath of currentArtifacts) assertSafeTrackedArtifact(root, artifactPath);
  return currentArtifacts;
}

interface DecisionEvidenceManifest {
  schemaVersion: unknown;
  candidates: Record<string, unknown>[];
  candidateRevisions?: Record<string, unknown>[];
  evidence: Record<string, unknown>[];
  officialTargetCompatibilityEvidence?: Record<string, unknown>[];
}

function assertDecisionEvidenceManifest(value: unknown, label: string): DecisionEvidenceManifest {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !Array.isArray(value.evidence)) {
    throw new Error(`${label} is malformed`);
  }
  const candidates = value.candidates.map((record, index) => assertDecisionRecord(record, `${label} candidate ${index}`));
  const candidateRevisions = value.candidateRevisions === undefined
    ? undefined
    : Array.isArray(value.candidateRevisions)
      ? value.candidateRevisions.map((record, index) =>
        assertDecisionRecord(record, `${label} candidate revision ${index}`))
      : undefined;
  if (value.candidateRevisions !== undefined && candidateRevisions === undefined) {
    throw new Error(`${label} candidate revisions are malformed`);
  }
  const evidence = value.evidence.map((record, index) => assertDecisionRecord(record, `${label} evidence ${index}`));
  const official = value.officialTargetCompatibilityEvidence === undefined
    ? undefined
    : Array.isArray(value.officialTargetCompatibilityEvidence)
      ? value.officialTargetCompatibilityEvidence.map((record, index) =>
        assertDecisionRecord(record, `${label} official target compatibility evidence ${index}`))
      : undefined;
  if (value.officialTargetCompatibilityEvidence !== undefined && official === undefined) {
    throw new Error(`${label} official target compatibility evidence is malformed`);
  }
  return {
    schemaVersion: value.schemaVersion,
    candidates,
    candidateRevisions,
    evidence,
    officialTargetCompatibilityEvidence: official
  };
}

function assertDecisionRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`issued decision evidence manifest was rewritten: ${label} has no canonical id`);
  }
  return value;
}

/** Existing records are semantically immutable; only new top-level records may be appended. */
function assertAppendOnlyDecisionRecords(
  prior: readonly Record<string, unknown>[],
  current: readonly Record<string, unknown>[],
  label: string
): Record<string, unknown>[] {
  assertUniqueRecordIds(prior, `prior ${label}`);
  assertUniqueRecordIds(current, `current ${label}`);
  if (current.length < prior.length) throw new Error(`issued decision ${label} record was deleted`);
  for (const [index, priorRecord] of prior.entries()) {
    const currentRecord = current[index];
    if (currentRecord?.id !== priorRecord.id) {
      throw new Error(`issued decision ${label} record was reordered, deleted, or reassigned: ${priorRecord.id}`);
    }
    if (stableValue(priorRecord) !== stableValue(currentRecord)) {
      throw new Error(`issued decision ${label} record was rewritten: ${priorRecord.id}`);
    }
  }
  const additions = current.slice(prior.length);
  const additionIds = additions.map((record) => record.id as string);
  if (!additionIds.every((id, index) => index === 0 || additionIds[index - 1]! < id)) {
    throw new Error(`new decision ${label} records must be code-point sorted and unique append-only additions`);
  }
  return additions;
}

function assertUniqueRecordIds(records: readonly Record<string, unknown>[], label: string): void {
  const ids = records.map((record) => record.id as string);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} records contain a duplicate id`);
}

function assertNoNewDecisionRecordReusesPriorArtifact(
  prior: readonly Record<string, unknown>[],
  current: readonly Record<string, unknown>[],
  priorArtifacts: ReadonlySet<string>,
  label: string
): void {
  for (const [index, record] of current.entries()) {
    const previous = prior[index];
    const previousReferences = previous === undefined ? new Set<string>() : new Set(artifactReferences(previous));
    for (const artifactPath of artifactReferences(record)) {
      if (!previousReferences.has(artifactPath) && priorArtifacts.has(artifactPath)) {
        throw new Error(`new decision ${label} record reuses an issued decision evidence artifact: ${artifactPath}`);
      }
    }
  }
}

function assertCandidateRevisionBaseAuthority(
  root: string,
  base: string,
  additions: readonly Record<string, unknown>[]
): void {
  if (additions.length === 0) return;
  if (git(root, ["diff", "--name-only", base, "--", "governance/reviewers.json"]).length > 0) {
    throw new Error("reviewer registry and candidate revisions cannot change in the same batch");
  }
  let baseReviewers: ReturnType<typeof validateReviewerRegistry>;
  try {
    baseReviewers = validateReviewerRegistry(readJsonAt(root, base, "governance/reviewers.json"));
  } catch (error) {
    throw new Error("candidate revisions require a valid base reviewer registry", { cause: error });
  }
  for (const revision of additions) {
    const approval = revision.approval;
    const reviewerId = isRecord(approval) && typeof approval.reviewerId === "string"
      ? approval.reviewerId
      : undefined;
    if (reviewerId === undefined || !hasPrivilegedReviewerAuthority(baseReviewers, reviewerId)) {
      throw new Error(`${String(revision.id)}: candidate revision requires base reviewer approval authority`);
    }
  }
}

function artifactReferences(value: unknown): string[] {
  const references: string[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (isRecord(item)) {
      for (const [key, child] of Object.entries(item)) {
        if ((key === "artifactPath" || key === "assetPath" || key === "evidenceArtifactPath")
          && typeof child === "string") references.push(child);
        visit(child);
      }
    }
  };
  visit(value);
  return references;
}

function assertStablePath(root: string, base: string, path: string, kind: string): void {
  const currentPaths = new Set(git(root, ["ls-files", "--", path]).split("\n").filter(Boolean));
  if (!currentPaths.has(path) || !existsSync(join(root, path))) throw new Error(`${kind} was deleted or renamed: ${path}`);
  const oldBlob = git(root, ["rev-parse", `${base}:${path}`]);
  const newBlob = git(root, ["hash-object", path]);
  if (oldBlob !== newBlob) throw new Error(`${kind} was rewritten: ${path}`);
}

function isEvidenceRecordPath(path: string): boolean {
  return path.startsWith(evidenceRoot) && !path.startsWith(evidenceArtifactsRoot) && path.endsWith(".json");
}

function assertSafeTrackedArtifact(root: string, artifactPath: string, base?: string): void {
  const artifactsRoot = resolve(root, evidenceArtifactsRoot);
  const absolute = resolve(root, artifactPath);
  if (!isCanonicalArtifactPath(artifactPath)
    || !isStrictDescendant(artifactsRoot, absolute)
    || !isTrackedRegularFile(root, artifactPath)
    || (base !== undefined && !isTrackedRegularFileAt(root, base, artifactPath))
    || !existsSync(absolute)) {
    throw new Error(`research evidence artifact path is unsafe, missing, untracked, or non-canonical: ${artifactPath}`);
  }
  const details = assertSafeArtifactPathComponents(root, absolute, artifactPath);
  if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1) {
    throw new Error(`research evidence artifact path is unsafe, missing, untracked, or non-canonical: ${artifactPath}`);
  }
  assertRealpathArtifactContainment(root, artifactsRoot, absolute, artifactPath);
}

function isCanonicalArtifactPath(path: string): boolean {
  return path.startsWith(evidenceArtifactsRoot)
    && path === posix.normalize(path)
    && !path.includes("\\")
    && !path.endsWith("/");
}

/**
 * Git tracks a leaf by path, but the worktree can replace any parent directory
 * with a symlink without changing that index entry. Inspect every component so
 * a tracked leaf cannot be redirected outside the evidence artifact root.
 */
function assertSafeArtifactPathComponents(root: string, absolute: string, artifactPath: string): NonNullable<ReturnType<typeof lstatSync>> {
  const components = relative(root, absolute).split(sep);
  if (components.length === 0 || components.some((component) => component.length === 0 || component === "..")) {
    throw new Error(`research evidence artifact path is unsafe, missing, untracked, or non-canonical: ${artifactPath}`);
  }
  let current = root;
  const rootDetails = lstatSync(current);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error(`research evidence artifact path is unsafe, missing, untracked, or non-canonical: ${artifactPath}`);
  }
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    const details = lstatSync(current);
    if (index === components.length - 1) return details;
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`research evidence artifact path is unsafe, missing, untracked, or non-canonical: ${artifactPath}`);
    }
  }
  throw new Error(`research evidence artifact path is unsafe, missing, untracked, or non-canonical: ${artifactPath}`);
}

function assertRealpathArtifactContainment(root: string, artifactsRoot: string, absolute: string, artifactPath: string): void {
  const realRoot = realpathSync(root);
  const realArtifactsRoot = realpathSync(artifactsRoot);
  const realArtifact = realpathSync(absolute);
  if (!isStrictDescendant(realRoot, realArtifactsRoot) || !isStrictDescendant(realArtifactsRoot, realArtifact)) {
    throw new Error(`research evidence artifact path is unsafe, missing, untracked, or non-canonical: ${artifactPath}`);
  }
}

function isStrictDescendant(parent: string, child: string): boolean {
  const descendant = relative(parent, child);
  return descendant.length > 0
    && descendant !== ".."
    && !descendant.startsWith(`..${sep}`)
    && !isAbsolute(descendant);
}

function isTrackedRegularFile(root: string, path: string): boolean {
  const entry = git(root, ["ls-files", "-s", "--", path]);
  return entry.startsWith("100644 ") || entry.startsWith("100755 ");
}

function isTrackedRegularFileAt(root: string, ref: string, path: string): boolean {
  const entry = git(root, ["ls-tree", "-r", "--format=%(objectmode) %(objecttype)", ref, "--", path]);
  return entry === "100644 blob" || entry === "100755 blob";
}

function trackedEvidenceArtifacts(root: string): string[] {
  return git(root, ["ls-files", "--", "research/evidence/artifacts"])
    .split("\n")
    .filter((path) => path.startsWith("research/evidence/artifacts/") && !path.endsWith("/.gitkeep") && !path.endsWith(".gitkeep"));
}

function assertNoUnreferencedEvidenceArtifacts(root: string, references: ReadonlySet<string>): void {
  for (const artifactPath of trackedEvidenceArtifacts(root)) {
    if (!references.has(artifactPath)) {
      throw new Error(`research evidence artifact is unreferenced: ${artifactPath}`);
    }
  }
}

function assertMonotonicContext(root: string, base: string): void {
  const priorContext = readJsonAt<Context>(root, base, "research/current-evaluation-context.json");
  const currentContext = readJson<Context>(join(root, "research/current-evaluation-context.json"));
  if (Date.parse(currentContext.asOf) < Date.parse(priorContext.asOf)) throw new Error("current evaluation context asOf must be monotonic");
  if (priorContext.privateRcAt !== null && (currentContext.privateRcAt === null || Date.parse(currentContext.privateRcAt) < Date.parse(priorContext.privateRcAt))) {
    throw new Error("current evaluation context privateRcAt must be monotonic");
  }
  const currentObservations = new Set(currentContext.upstreamObservations.map((value) => JSON.stringify(value)));
  if (currentObservations.size !== currentContext.upstreamObservations.length) throw new Error("current evaluation context observations must be unique");
  if (!priorContext.upstreamObservations.every((observation, index) => JSON.stringify(currentContext.upstreamObservations[index]) === JSON.stringify(observation))) {
    throw new Error("current evaluation context cannot delete, rewrite, or reorder a prior observation");
  }
  for (const [index, observation] of currentContext.upstreamObservations.entries()) {
    if (index > 0 && Date.parse(observation.observedAt) <= Date.parse(currentContext.upstreamObservations[index - 1]!.observedAt)) {
      throw new Error("current evaluation context observations must be strictly ordered by observedAt");
    }
  }
  const previousObservedAt = priorContext.upstreamObservations.at(-1)?.observedAt;
  for (const observation of currentContext.upstreamObservations.slice(priorContext.upstreamObservations.length)) {
    if (previousObservedAt !== undefined && Date.parse(observation.observedAt) <= Date.parse(previousObservedAt)) {
      throw new Error("new current evaluation context observations must be strictly later than the approved predecessor");
    }
  }
}

function assertApprovedTagChain(
  root: string,
  base: string,
  mode: ResearchApprovalMode,
  approvedRegistryTagObject?: string
): void {
  if (mode !== "changed-batch" && mode !== "pre-approval-candidate") {
    throw new Error(`unsupported research approval mode: ${String(mode)}`);
  }
  const expectedObject = approvedRegistryTagObject ?? process.env.APPROVED_REGISTRY_TAG_OBJECT;
  if (!expectedObject) throw new Error("APPROVED_REGISTRY_TAG_OBJECT is required when a research batch changes");
  const tags = approvedTags(root);
  const expected = tags.filter((tag) => tag.object === expectedObject);
  if (expected.length !== 1 || expected[0]!.type !== "tag") {
    throw new Error("protected approved registry tag object must name exactly one annotated registry-approved tag");
  }
  const byName = new Map(tags.map((tag) => [tag.name, tag]));
  const rootTag = byName.get(rootTagName);
  if (rootTag === undefined || rootTag.type !== "tag") throw new Error("registry-approved/r01 must be an annotated root approval tag");
  const invalidNames = tags.filter((tag) => tag.name !== rootTagName && !/^registry-approved\/research-\d{4}$/.test(tag.name));
  if (invalidNames.length > 0) throw new Error(`invalid approved registry tag name: ${invalidNames[0]!.name}`);

  const sequenced = tags.filter((tag) => /^registry-approved\/research-\d{4}$/.test(tag.name))
    .map((tag) => ({ ...tag, sequence: Number(tag.name.slice("registry-approved/research-".length)) }))
    .sort((left, right) => left.sequence - right.sequence);
  if (sequenced.some((tag, index) => tag.sequence !== index + 1)) throw new Error("approved registry tag sequence must begin at 0001 without gaps or reuse");
  const details = new Map(tags.map((tag) => [tag.name, readTagDetails(root, tag)]));
  assertChainLinks(root, rootTag, sequenced, details);

  const predecessor = expected[0]!;
  const predecessorSequence = predecessor.name === rootTagName
    ? 0
    : Number(predecessor.name.slice("registry-approved/research-".length));
  if (!Number.isInteger(predecessorSequence) || predecessorSequence < 0) throw new Error("protected approved tag is not a valid chain predecessor");
  const expectedPredecessorName = predecessorSequence === 0
    ? rootTagName
    : `registry-approved/research-${String(predecessorSequence).padStart(4, "0")}`;
  if (predecessor.name !== expectedPredecessorName) throw new Error("protected approved tag is not a chain predecessor");
  const predecessorDetails = details.get(predecessor.name)!;
  if (!gitSucceeds(root, ["merge-base", "--is-ancestor", predecessorDetails.target, base])) {
    throw new Error("--base must descend from the immediate approved registry predecessor target");
  }
  if (hasProtectedResearchBatchSurfaceChanges(root, predecessorDetails.target, base)) {
    throw new Error("approved registry predecessor descendants cannot change protected research batch surfaces");
  }
  if (!gitSucceeds(root, ["merge-base", "--is-ancestor", predecessorDetails.target, "HEAD"])) {
    throw new Error("approved registry predecessor target must be an ancestor of HEAD");
  }
  if (mode === "pre-approval-candidate") {
    const latest = sequenced.at(-1) ?? rootTag;
    if (latest.object !== predecessor.object) throw new Error("protected approved tag is stale; a later chain tag already exists");
    return;
  }
  const nextSequence = predecessorSequence + 1;
  const nextName = `registry-approved/research-${String(nextSequence).padStart(4, "0")}`;
  if (sequenced.some((tag) => tag.sequence > nextSequence)) throw new Error("protected approved tag is stale; a later chain tag already exists");
  const next = byName.get(nextName);
  if (next === undefined || next.type !== "tag") throw new Error(`missing annotated next approved registry tag: ${nextName}`);
  const nextDetails = details.get(nextName)!;
  const head = git(root, ["rev-parse", "HEAD"]);
  if (nextDetails.target !== head) throw new Error("next approved registry tag must target the reviewed batch HEAD");
  if (nextDetails.annotation.get("sequence") !== String(nextSequence)
    || nextDetails.annotation.get("previous-tag") !== predecessor.name
    || nextDetails.annotation.get("previous-tag-object") !== predecessor.object
    || nextDetails.annotation.get("batch-head") !== head) {
    throw new Error("next approved registry tag annotation must bind sequence, immediate predecessor, predecessor object, and batch HEAD");
  }
}

function assertChainLinks(
  root: string,
  rootTag: TagRef,
  sequenced: readonly (TagRef & { sequence: number })[],
  details: ReadonlyMap<string, TagDetails>
): void {
  let predecessor = rootTag;
  for (const tag of sequenced) {
    if (tag.type !== "tag") throw new Error(`approved registry chain tag must be annotated: ${tag.name}`);
    const detail = details.get(tag.name)!;
    const previous = details.get(predecessor.name)!;
    if (detail.annotation.get("sequence") !== String(tag.sequence)
      || detail.annotation.get("previous-tag") !== predecessor.name
      || detail.annotation.get("previous-tag-object") !== predecessor.object
      || detail.annotation.get("batch-head") !== detail.target) {
      throw new Error(`approved registry tag has an invalid chain annotation: ${tag.name}`);
    }
    if (!gitSucceeds(root, ["merge-base", "--is-ancestor", previous.target, detail.target])) {
      throw new Error(`approved registry tag target is not descended from its immediate predecessor: ${tag.name}`);
    }
    predecessor = tag;
  }
}

function hasApprovalAnchor(root: string): boolean {
  return approvedTags(root).some((tag) => tag.name === rootTagName);
}

function approvedTags(root: string): TagRef[] {
  return git(root, ["for-each-ref", "--format=%(refname:short) %(objecttype) %(objectname)", `refs/tags/${approvedPrefix}`])
    .split("\n").filter(Boolean).map((line) => {
      const [name, type, object] = line.split(" ");
      return { name: name!, type: type!, object: object! };
    });
}

function readTagDetails(root: string, tag: TagRef): TagDetails {
  if (tag.type !== "tag") throw new Error(`approved registry tag must be annotated: ${tag.name}`);
  const source = git(root, ["cat-file", "-p", tag.object]);
  const separator = source.indexOf("\n\n");
  if (separator === -1) throw new Error(`approved registry tag annotation is missing: ${tag.name}`);
  const headers = source.slice(0, separator).split("\n");
  const target = headers.find((line) => line.startsWith("object "))?.slice("object ".length);
  const type = headers.find((line) => line.startsWith("type "))?.slice("type ".length);
  const tagName = headers.find((line) => line.startsWith("tag "))?.slice("tag ".length);
  if (target === undefined || type !== "commit" || tagName !== tag.name) {
    throw new Error(`approved registry tag must directly annotate its commit target: ${tag.name}`);
  }
  const annotation = new Map<string, string>();
  for (const line of source.slice(separator + 2).split("\n").filter(Boolean)) {
    const index = line.indexOf(": ");
    if (index <= 0) continue;
    if (annotation.has(line.slice(0, index))) throw new Error(`approved registry tag annotation is malformed: ${tag.name}`);
    annotation.set(line.slice(0, index), line.slice(index + 2));
  }
  return { target, annotation };
}

function findRecordPathAt(root: string, base: string, directory: string, field: string, id: string): string | undefined {
  const paths = git(root, ["ls-tree", "-r", "--name-only", base, "--", directory]).split("\n").filter((path) => path.endsWith(".json"));
  return paths.find((path) => {
    const value = readJsonAt<Record<string, unknown>>(root, base, path);
    return value[field] === id;
  });
}

function assertSortedUniqueTriads(triads: readonly Triad[], label: string): void {
  const keys = triads.map(triadKey);
  if (!keys.every((key, index) => index === 0 || keys[index - 1]! < key)) {
    throw new Error(`${label} must be code-point sorted and unique`);
  }
}

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }
function readJsonAt<T>(root: string, ref: string, path: string): T { return JSON.parse(git(root, ["show", `${ref}:${path}`])) as T; }
function readYaml(path: string): unknown { return YAML.parse(readFileSync(path, "utf8")); }
function readYamlAt(root: string, ref: string, path: string): unknown { return YAML.parse(git(root, ["show", `${ref}:${path}`])); }
function triadKey(triad: Triad): string { return `${triad.sourceId}\u0000${triad.receiptId}\u0000${triad.snapshotId}`; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function gitSucceeds(root: string, args: string[]): boolean {
  try { execFileSync("git", args, { cwd: root, stdio: "ignore" }); return true; } catch { return false; }
}
function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: gitOutputMaxBuffer
    }).trim();
  }
  catch (error) { throw new Error(`git ${args.join(" ")} failed`, { cause: error }); }
}

function assertRequiredPublicBaseline(root: string, base: string): void {
  for (const path of requiredPublicBaselinePaths) {
    if (!gitSucceeds(root, ["cat-file", "-e", `${base}:${path}`])) {
      throw new Error(`required public baseline path is missing at --base: ${path}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseIndex = process.argv.indexOf("--base");
  const modeIndex = process.argv.indexOf("--approval-mode");
  const requestedMode = modeIndex === -1 ? process.env.REGISTRY_APPROVAL_MODE : process.argv[modeIndex + 1];
  const approvalMode = requestedMode === "pre-approval-candidate" ? requestedMode : "changed-batch";
  assertExtensionAppendOnly({
    base: baseIndex === -1 ? "" : process.argv[baseIndex + 1] ?? "",
    approvalMode
  });
}
