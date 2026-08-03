import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

import {
  classifyOfficialMarketplacePlugin,
  configuredOfficialMarketplaceCandidateNames,
  isSelectedOfficialMarketplaceCandidate,
  loadOfficialMarketplaceSelection,
  officialMarketplaceCandidateIdentity,
  officialMarketplaceSelectedChanges,
  officialMarketplaceSourceCoordinate,
  type OfficialMarketplaceBaseline,
  validateOfficialMarketplaceArtifact
} from "../../src/discovery/official-marketplace.js";

const repository = "https://github.com/anthropics/claude-plugins-official";
const manifestPath = ".claude-plugin/marketplace.json";

export interface StagedOfficialMarketplaceObservation {
  state: "current" | "review-required";
  artifactPath: string;
  selectionPath: string;
  claimsRenewed: boolean;
}

export interface ApprovedOfficialMarketplaceObservation {
  state: "current";
  selectionPath: string;
  approvedBy: string;
}

/** Promotes typed pin drift, exact reviewed candidate rebinds, or exact additions; automatic refresh never calls this. */
export async function approveOfficialMarketplaceObservation(input: {
  root: string;
  approvedAt: string;
  approvedBy: string;
  reason: string;
  candidateAdditions?: readonly { name: string; expectedIdentity: string }[];
  candidateRebindings?: readonly { name: string; expectedIdentity: string }[];
}): Promise<ApprovedOfficialMarketplaceObservation> {
  if (!isUtcSeconds(input.approvedAt) || input.approvedBy.trim().length === 0 || input.reason.trim().length === 0) {
    throw new Error("Official marketplace approval requires an exact epoch, approver, and reason");
  }
  const root = resolve(input.root);
  const marketplaceRoot = join(root, "research", "marketplaces");
  const previous = loadOfficialMarketplaceSelection(root);
  if (previous.state !== "review-required" || Date.parse(input.approvedAt) <= Date.parse(previous.observedAt)) {
    throw new Error("Official marketplace approval requires a newer review-required observation");
  }
  const approvedByName = new Map(previous.approvedArtifact.plugins.map((plugin) => [plugin.name, plugin]));
  const observedByName = new Map(previous.observedArtifact.plugins.map((plugin) => [plugin.name, plugin]));
  const additions = new Map<string, string>();
  for (const addition of input.candidateAdditions ?? []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(addition.name)
      || addition.expectedIdentity.length === 0 || additions.has(addition.name)) {
      throw new Error("Official marketplace candidate additions must be unique exact identities");
    }
    additions.set(addition.name, addition.expectedIdentity);
  }
  const rebindings = new Map<string, string>();
  for (const rebind of input.candidateRebindings ?? []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(rebind.name)
      || rebind.expectedIdentity.length === 0 || rebindings.has(rebind.name)) {
      throw new Error("Official marketplace candidate rebindings must be unique exact identities");
    }
    rebindings.set(rebind.name, rebind.expectedIdentity);
  }
  for (const change of previous.selectedChanges) {
    const before = approvedByName.get(change.name);
    const after = observedByName.get(change.name);
    if (change.status === "added") {
      const expectedIdentity = additions.get(change.name);
      if (after === undefined || expectedIdentity !== officialMarketplaceCandidateIdentity(after)) {
        throw new Error(`Official marketplace candidate addition identity does not match: ${change.name}`);
      }
      additions.delete(change.name);
      continue;
    }
    if (change.status === "missing" || before === undefined || after === undefined) {
      throw new Error(`Typed official marketplace approval cannot approve a missing candidate: ${change.name}`);
    }
    const reviewedRebind = rebindings.get(change.name);
    if (reviewedRebind !== undefined) {
      if (reviewedRebind !== officialMarketplaceCandidateIdentity(after)) {
        throw new Error(`Official marketplace candidate rebind identity does not match: ${change.name}`);
      }
      rebindings.delete(change.name);
    }
    if ((before.description !== after.description
      || JSON.stringify(officialMarketplaceSourceCoordinate(before))
        !== JSON.stringify(officialMarketplaceSourceCoordinate(after)))
      && reviewedRebind === undefined) {
      throw new Error(`Official marketplace candidate coordinate or rebind identity does not match: ${change.name}`);
    }
  }
  if (additions.size > 0 || rebindings.size > 0) {
    throw new Error("Official marketplace candidate approvals do not match the review-held change set");
  }

  const pointerPath = join(marketplaceRoot, "official-marketplace-current.json");
  const pointerBefore = await readFile(pointerPath);
  const pointer = await currentPointer(marketplaceRoot, pointerBefore, previous.chain[0]!);
  const artifactSha256 = sha256(await readFile(join(marketplaceRoot, previous.observedArtifactPath)));
  const selectionName = `official-marketplace-selections/${compactTimestamp(input.approvedAt)}-${previous.observedArtifact.provenance.inspectedCommit.slice(0, 12)}.json`;
  const selection = {
    schemaVersion: 1,
    observedAt: input.approvedAt,
    state: "current",
    approvedArtifact: previous.observedArtifactPath,
    approvedArtifactSha256: artifactSha256,
    observedArtifact: previous.observedArtifactPath,
    observedArtifactSha256: artifactSha256,
    protectedCandidates: previous.protectedCandidateNames,
    previousSelection: pointer.selection,
    previousSelectionSha256: pointer.selectionSha256,
    transition: "approval",
    approval: {
      approvedAt: input.approvedAt,
      approvedBy: input.approvedBy,
      reason: input.reason
    }
  } as const;
  const selectionBytes = Buffer.from(`${JSON.stringify(selection, null, 2)}\n`);
  const claimsUpdate = await renderCompatibilityAttestation(
    root,
    input.approvedAt,
    previous.observedArtifactPath,
    previous.observedArtifact,
    true
  );
  const pointerAfter = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    selection: selectionName,
    selectionSha256: sha256(selectionBytes)
  }, null, 2)}\n`);
  const backlogPath = join(root, "research", "official-marketplace-review-backlog.json");
  const backlogBefore = await readOptionalFile(backlogPath);
  const backlogAfter = renderInventoryBacklog({
    observedAt: input.approvedAt,
    state: "current",
    approved: previous.observedArtifact,
    observed: previous.observedArtifact,
    protectedCandidateNames: previous.protectedCandidateNames,
    selectedChanges: []
  });

  await writeImmutable(join(marketplaceRoot, selectionName), selectionBytes, "official marketplace approval selection");
  await publishSelectionTransaction({
    pointerPath,
    pointerBefore,
    pointerAfter,
    pointerConflictMessage: "Official marketplace pointer changed during approval",
    claimsUpdate,
    backlogPath,
    backlogBefore,
    backlogAfter
  });
  loadOfficialMarketplaceSelection(root);
  return { state: "current", selectionPath: selectionName, approvedBy: input.approvedBy };
}

/** Appends an observed official manifest without advancing reviewed evidence. */
export async function stageOfficialMarketplaceObservation(input: {
  root: string;
  observedAt: string;
  inspectedCommit: string;
  manifestBytes: Buffer;
}): Promise<StagedOfficialMarketplaceObservation> {
  if (!isUtcSeconds(input.observedAt) || !/^[0-9a-f]{40}$/u.test(input.inspectedCommit)) {
    throw new Error("Official marketplace observation requires an exact UTC epoch and commit");
  }
  const root = resolve(input.root);
  const marketplaceRoot = join(root, "research", "marketplaces");
  const previous = loadOfficialMarketplaceSelection(root);
  const artifact = materializeArtifact(input.inspectedCommit, input.manifestBytes);
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const artifactName = `claude-plugins-official-${input.inspectedCommit}.json`;
  const artifactPath = join(marketplaceRoot, artifactName);
  await mkdir(marketplaceRoot, { recursive: true });
  await writeImmutable(artifactPath, artifactBytes, "official marketplace artifact");

  const protectedCandidateNames = [...new Set([
    ...previous.protectedCandidateNames,
    ...configuredOfficialMarketplaceCandidateNames(root)
  ])].sort(compare);
  const selectedChanges = officialMarketplaceSelectedChanges(
    previous.approvedArtifact,
    artifact,
    protectedCandidateNames,
    previous.protectedCandidateNames
  );
  const state = selectedChanges.length === 0 ? "current" : "review-required";
  const previousPointerPath = join(marketplaceRoot, "official-marketplace-current.json");
  const previousPointerBytes = await readFile(previousPointerPath);
  const previousPointer = await currentPointer(marketplaceRoot, previousPointerBytes, previous.chain[0]!);

  const selectionName = `official-marketplace-selections/${compactTimestamp(input.observedAt)}-${input.inspectedCommit.slice(0, 12)}.json`;
  const selection = {
    schemaVersion: 1,
    observedAt: input.observedAt,
    state,
    approvedArtifact: previous.approvedArtifactPath,
    approvedArtifactSha256: sha256(await readFile(join(marketplaceRoot, previous.approvedArtifactPath))),
    observedArtifact: artifactName,
    observedArtifactSha256: sha256(artifactBytes),
    protectedCandidates: protectedCandidateNames,
    previousSelection: previousPointer.selection,
    previousSelectionSha256: previousPointer.selectionSha256,
    transition: "observation",
    approval: null
  } as const;
  const selectionBytes = Buffer.from(`${JSON.stringify(selection, null, 2)}\n`);
  const claimsUpdate = state === "current"
    ? await renderCompatibilityAttestation(root, input.observedAt, artifactName, artifact, false)
    : undefined;
  const pointerAfter = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    selection: selectionName,
    selectionSha256: sha256(selectionBytes)
  }, null, 2)}\n`);
  const backlogPath = join(root, "research", "official-marketplace-review-backlog.json");
  const backlogBefore = await readOptionalFile(backlogPath);
  const backlogAfter = renderInventoryBacklog({
    observedAt: input.observedAt,
    state,
    approved: previous.approvedArtifact,
    observed: artifact,
    protectedCandidateNames,
    selectedChanges
  });
  await mkdir(join(marketplaceRoot, "official-marketplace-selections"), { recursive: true });
  await writeImmutable(join(marketplaceRoot, selectionName), selectionBytes, "official marketplace selection");
  await publishSelectionTransaction({
    pointerPath: previousPointerPath,
    pointerBefore: previousPointerBytes,
    pointerAfter,
    pointerConflictMessage: "Official marketplace pointer changed during observation staging",
    claimsUpdate,
    backlogPath,
    backlogBefore,
    backlogAfter
  });

  loadOfficialMarketplaceSelection(root);
  return { state, artifactPath: artifactName, selectionPath: selectionName, claimsRenewed: state === "current" };
}

function renderInventoryBacklog(input: {
  observedAt: string;
  state: "current" | "review-required";
  approved: OfficialMarketplaceBaseline;
  observed: OfficialMarketplaceBaseline;
  protectedCandidateNames: readonly string[];
  selectedChanges: readonly { name: string; status: "added" | "changed" | "missing" }[];
}): Buffer {
  const approved = new Map(input.approved.plugins.map((plugin) => [plugin.name, plugin]));
  const observed = new Map(input.observed.plugins.map((plugin) => [plugin.name, plugin]));
  const selectedChanges = new Map(input.selectedChanges.map((change) => [change.name, change.status]));
  const inventoryChanges = [...new Set([...approved.keys(), ...observed.keys()])].sort(compare).flatMap((name) => {
    const before = approved.get(name);
    const after = observed.get(name);
    const selectedStatus = selectedChanges.get(name);
    if (before !== undefined && after !== undefined
      && officialMarketplaceCandidateIdentity(before) === officialMarketplaceCandidateIdentity(after)
      && selectedStatus === undefined) return [];
    return [{
      name,
      status: selectedStatus ?? (before === undefined ? "added" : after === undefined ? "missing" : "changed"),
      selected: isSelectedOfficialMarketplaceCandidate(name),
      protected: input.protectedCandidateNames.includes(name),
      approved: before === undefined ? null : reviewCandidate(before),
      observed: after === undefined ? null : reviewCandidate(after)
    }];
  });
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    observedAt: input.observedAt,
    selectionState: input.state,
    approvedCommit: input.approved.provenance.inspectedCommit,
    observedCommit: input.observed.provenance.inspectedCommit,
    inventoryChanges
  }, null, 2)}\n`);
}

function reviewCandidate(plugin: OfficialMarketplaceBaseline["plugins"][number]): unknown {
  return {
    name: plugin.name,
    description: plugin.description,
    candidateIdentity: officialMarketplaceCandidateIdentity(plugin),
    sourceCoordinate: officialMarketplaceSourceCoordinate(plugin),
    sourcePin: plugin.sourcePin,
    classificationDomainIds: classifyOfficialMarketplacePlugin(plugin)
  };
}

function materializeArtifact(inspectedCommit: string, manifestBytes: Buffer): OfficialMarketplaceBaseline {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Official marketplace manifest is not valid JSON");
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
    throw new Error("Official marketplace manifest must contain plugins");
  }
  const plugins = manifest.plugins.map((value, index) => {
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.description !== "string"
      || !(typeof value.source === "string" || isRecord(value.source))) {
      throw new Error(`Official marketplace manifest plugin ${index} is invalid`);
    }
    return {
      name: value.name,
      description: value.description,
      source: structuredClone(value.source),
      provenance: { jsonPointer: `/plugins/${index}` }
    };
  });
  return validateOfficialMarketplaceArtifact({
    schemaVersion: 1,
    marketplace: "claude-plugins-official",
    provenance: {
      repository,
      inspectedCommit,
      manifestPath,
      manifestSha256: sha256(manifestBytes),
      sourceUrl: `https://raw.githubusercontent.com/anthropics/claude-plugins-official/${inspectedCommit}/${manifestPath}`
    },
    plugins
  });
}

async function renderCompatibilityAttestation(
  root: string,
  observedAt: string,
  artifactName: string,
  artifact: OfficialMarketplaceBaseline,
  allowSourcePinChange: boolean
): Promise<{ path: string; previous: Buffer; next: Buffer }> {
  const claimsPath = join(root, "manifests", "official-listing-capability-claims.yaml");
  const previous = await readFile(claimsPath);
  const document = parseDocument(previous.toString("utf8"));
  if (!document.hasIn(["compatibilityAttestation"])) {
    throw new Error("Official listing claims have no compatibility attestation to renew");
  }
  document.setIn(["compatibilityAttestation", "observedAt"], observedAt);
  document.setIn(["compatibilityAttestation", "reviewedAt"], observedAt);
  document.setIn(
    ["compatibilityAttestation", "expiresAt"],
    new Date(Date.parse(observedAt) + 9 * 86_400_000).toISOString().replace(".000Z", "Z")
  );
  const claims = document.toJS() as unknown;
  if (!isRecord(claims) || !Array.isArray(claims.candidates)
    || !isRecord(claims.compatibilityAttestation)
    || !Array.isArray(claims.compatibilityAttestation.sourceUrls)) {
    throw new Error("Official listing claims cannot be rebound to the observed marketplace artifact");
  }
  const pluginByName = new Map(artifact.plugins.map((plugin, index) => [plugin.name, { plugin, index }]));
  for (const [index, candidate] of claims.candidates.entries()) {
    if (!isRecord(candidate) || typeof candidate.pluginName !== "string" || !isRecord(candidate.sourcePin)) {
      throw new Error("Official listing candidate claim is invalid during observation renewal");
    }
    const resolved = pluginByName.get(candidate.pluginName);
    if (resolved === undefined || (!allowSourcePinChange
      && JSON.stringify(candidate.sourcePin) !== JSON.stringify(resolved.plugin.sourcePin))) {
      throw new Error(`Official listing candidate changed during observation renewal: ${candidate.pluginName}`);
    }
    document.setIn(["candidates", index, "sourcePin"], resolved.plugin.sourcePin);
    document.setIn(
      ["candidates", index, "marketplaceReference"],
      `research/marketplaces/${artifactName}#/plugins/${resolved.index}`
    );
  }
  const marketplaceUrl = `${artifact.provenance.repository}/blob/${artifact.provenance.inspectedCommit}/${artifact.provenance.manifestPath}`;
  const sourceUrls = claims.compatibilityAttestation.sourceUrls.map((value) => {
    if (typeof value !== "string") throw new Error("Official compatibility source URL is invalid during renewal");
    return value.startsWith(`${repository}/blob/`) ? marketplaceUrl : value;
  });
  if (!sourceUrls.includes(marketplaceUrl)) sourceUrls.unshift(marketplaceUrl);
  document.setIn(["compatibilityAttestation", "sourceUrls"], [...new Set(sourceUrls)]);
  return { path: claimsPath, previous, next: Buffer.from(String(document)) };
}

async function currentPointer(
  marketplaceRoot: string,
  bytes: Buffer,
  expectedSelection: string
): Promise<{ selection: string; selectionSha256: string }> {
  const pointer = JSON.parse(bytes.toString("utf8")) as {
    schemaVersion?: unknown;
    selection?: unknown;
    selectionSha256?: unknown;
  };
  if (pointer.schemaVersion !== 1 || pointer.selection !== expectedSelection
    || typeof pointer.selectionSha256 !== "string"
    || sha256(await readFile(join(marketplaceRoot, expectedSelection))) !== pointer.selectionSha256) {
    throw new Error("Official marketplace current pointer changed after selection validation");
  }
  return { selection: expectedSelection, selectionSha256: pointer.selectionSha256 };
}

async function publishSelectionTransaction(input: {
  pointerPath: string;
  pointerBefore: Buffer;
  pointerAfter: Buffer;
  pointerConflictMessage: string;
  claimsUpdate?: { path: string; previous: Buffer; next: Buffer };
  backlogPath: string;
  backlogBefore?: Buffer;
  backlogAfter: Buffer;
}): Promise<void> {
  let claimsPublished = false;
  let backlogPublished = false;
  try {
    await assertUnchanged(input.pointerPath, input.pointerBefore, input.pointerConflictMessage);
    if (input.claimsUpdate !== undefined) {
      await atomicWrite(input.claimsUpdate.path, input.claimsUpdate.next);
      claimsPublished = true;
    }
    await atomicWrite(input.backlogPath, input.backlogAfter);
    backlogPublished = true;
    await assertUnchanged(input.pointerPath, input.pointerBefore, input.pointerConflictMessage);
    await atomicWrite(input.pointerPath, input.pointerAfter);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (backlogPublished) {
      try {
        await restoreFile(input.backlogPath, input.backlogBefore);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (claimsPublished && input.claimsUpdate !== undefined) {
      try {
        await atomicWrite(input.claimsUpdate.path, input.claimsUpdate.previous);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Official marketplace publication rollback failed");
    }
    throw error;
  }
}

async function readOptionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function restoreFile(path: string, previous: Buffer | undefined): Promise<void> {
  if (previous === undefined) {
    await rm(path, { force: true });
    return;
  }
  await atomicWrite(path, previous);
}

async function atomicWrite(path: string, bytes: Buffer): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function assertUnchanged(path: string, expected: Buffer, message: string): Promise<void> {
  if (!(await readFile(path)).equals(expected)) throw new Error(message);
}

async function writeImmutable(path: string, bytes: Buffer, label: string): Promise<void> {
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !Buffer.from(await readFile(path)).equals(bytes)) {
      throw new Error(`${label} path already exists with different bytes`, { cause: error });
    }
  }
}

function compactTimestamp(value: string): string {
  return value.replace(/[-:]/gu, "");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUtcSeconds(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
