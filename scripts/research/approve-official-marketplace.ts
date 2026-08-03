import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parse } from "yaml";

import { assertArtifactsCurrent, writeArtifacts } from "../../src/cli.js";
import { validateDecisionCandidateEvidence } from "../../src/contracts/decision.js";
import {
  validateResearchCollectionReceipt,
  validateResearchSnapshot,
  validateResearchSourceConfig
} from "../../src/contracts/complete-v1.js";
import { validateSourceObservation } from "../../src/contracts/observation.js";
import {
  loadOfficialMarketplaceSelection,
  officialMarketplaceCandidateIdentity
} from "../../src/discovery/official-marketplace.js";
import { loadDecisionIndex, loadDecisionManifests } from "../../src/decision/repository.js";
import { generateAll } from "../../src/generate/all.js";
import { resolveLatestEffectiveSourceObservation } from "../../src/research/source-observation.js";
import { compareCodePointStrings, verifyResearchSnapshot } from "../../src/research/snapshot.js";
import { materializeDecisionResearch } from "./materialize-decision-research.js";
import { prepareCatalogDelivery, type CatalogDeliveryResult } from "./refresh-catalog.js";
import {
  approveOfficialMarketplaceObservation,
  type ApprovedOfficialMarketplaceObservation
} from "./stage-official-marketplace.js";
import { assertExtensionAppendOnly, hasResearchBatchChanges } from "./assert-extension-append-only.js";
import { assertOfficialListingClaimsAppendOnlyAtRef } from "./assert-official-listing-claims-append-only.js";
import { assertReviewLedgerAppendOnly } from "./assert-review-ledger-append-only.js";

const execFileAsync = promisify(execFile);

export interface OfficialMarketplaceApprovalWorkflowInput {
  root: string;
  baseSha: string;
  expectedHeadSha: string;
  approvedRegistryTagObject: string;
  approvedAt: string;
  approvedBy: string;
  reason: string;
  candidateAdditions: readonly { name: string; expectedIdentity: string }[];
  verify?: (input: { root: string; asOf: string }) => Promise<void>;
}

export interface OfficialMarketplaceApprovalWorkflowResult {
  approval: ApprovedOfficialMarketplaceObservation;
  delivery: CatalogDeliveryResult;
}

type TrackedWorktreeEntry =
  | { kind: "file"; bytes: Buffer; mode: number }
  | { kind: "symlink"; target: string };

interface CleanWorktreeSnapshot {
  tracked: ReadonlyMap<string, TrackedWorktreeEntry>;
}

interface GitVisibleWorktreeSnapshot {
  status: Buffer;
  entries: ReadonlyMap<string, TrackedWorktreeEntry>;
}

/** Completes a typed marketplace approval and its updateable manager delivery as one operator workflow. */
export async function runOfficialMarketplaceApprovalWorkflow(
  input: OfficialMarketplaceApprovalWorkflowInput
): Promise<OfficialMarketplaceApprovalWorkflowResult> {
  const root = resolve(input.root);
  assertApprovalInputs(input);
  await assertExpectedHead(root, input.expectedHeadSha);
  const snapshot = await snapshotCleanWorktree(root);
  try {
    assertApprovalTrustGates(root, input);
    const previousDecisionIndexRaw = await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index.json"),
      "utf8"
    );
    const candidateRebindings = await assertManualOfficialEvidenceStableForApproval(root, input.approvedAt);
    const approval = await approveOfficialMarketplaceObservation({
      root,
      approvedAt: input.approvedAt,
      approvedBy: input.approvedBy,
      reason: input.reason,
      candidateAdditions: input.candidateAdditions,
      candidateRebindings
    });
    await materializeDecisionResearch({ root, asOf: input.approvedAt, checkOnly: false });
    await writeArtifacts(root, await generateAll(root));
    const delivery = await prepareCatalogDelivery({ root, previousDecisionIndexRaw });
    if (delivery.changed) await writeArtifacts(root, await generateAll(root));
    assertApprovalTrustGates(root, input);
    await assertExpectedHead(root, input.expectedHeadSha);
    const approvedWorktree = await snapshotGitVisibleWorktree(root);
    await (input.verify ?? verifyApprovedCatalog)({ root, asOf: input.approvedAt });
    assertApprovalTrustGates(root, input);
    await assertExpectedHead(root, input.expectedHeadSha);
    await assertGitVisibleWorktreeUnchanged(root, approvedWorktree);
    return { approval, delivery };
  } catch (error) {
    try {
      await restoreCleanWorktree(root, snapshot);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Official marketplace approval rollback failed");
    }
    throw error;
  }
}

function assertApprovalInputs(input: OfficialMarketplaceApprovalWorkflowInput): void {
  if (!isUtcSeconds(input.approvedAt) || Date.parse(input.approvedAt) > Date.now()) {
    throw new Error("Official marketplace approvedAt must be an exact UTC-second timestamp that is not in the future");
  }
  for (const [label, value] of [
    ["baseSha", input.baseSha],
    ["expectedHeadSha", input.expectedHeadSha],
    ["approvedRegistryTagObject", input.approvedRegistryTagObject]
  ] as const) {
    if (!/^[a-f0-9]{40}$/u.test(value)) {
      throw new Error(`Official marketplace ${label} must be an exact 40-character lowercase Git object ID`);
    }
  }
}

async function assertExpectedHead(root: string, expectedHeadSha: string): Promise<void> {
  const actualHead = (await gitBytes(root, ["rev-parse", "HEAD"])).toString("utf8").trim();
  if (actualHead !== expectedHeadSha) {
    throw new Error("Official marketplace approval HEAD does not match --expected-head-sha");
  }
}

function assertApprovalTrustGates(root: string, input: OfficialMarketplaceApprovalWorkflowInput): void {
  if (!hasResearchBatchChanges({ root, base: input.baseSha })) {
    throw new Error("Official marketplace approval base must precede a protected review-held research batch");
  }
  assertExtensionAppendOnly({
    root,
    base: input.baseSha,
    approvalMode: "pre-approval-candidate",
    approvedRegistryTagObject: input.approvedRegistryTagObject
  });
  assertReviewLedgerAppendOnly({ root, base: input.baseSha });
  assertOfficialListingClaimsAppendOnlyAtRef({ root, base: input.baseSha });
}

async function snapshotCleanWorktree(root: string): Promise<CleanWorktreeSnapshot> {
  const status = await gitBytes(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status.length > 0) {
    throw new Error("Official marketplace approval requires a clean worktree");
  }
  const paths = splitNullTerminated(await gitBytes(root, ["ls-files", "-z"]));
  const tracked = new Map<string, TrackedWorktreeEntry>();
  for (const path of paths) {
    const absolute = join(root, path);
    const entry = await lstat(absolute);
    if (entry.isSymbolicLink()) {
      tracked.set(path, { kind: "symlink", target: await readlink(absolute) });
    } else if (entry.isFile()) {
      tracked.set(path, { kind: "file", bytes: await readFile(absolute), mode: entry.mode & 0o777 });
    } else {
      throw new Error(`Official marketplace approval cannot snapshot non-file tracked path: ${path}`);
    }
  }
  return { tracked };
}

async function snapshotGitVisibleWorktree(root: string): Promise<GitVisibleWorktreeSnapshot> {
  const status = await gitBytes(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const paths = new Set([
    ...splitNullTerminated(await gitBytes(root, ["ls-files", "-z"])),
    ...splitNullTerminated(await gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
  ]);
  const entries = new Map<string, TrackedWorktreeEntry>();
  for (const path of [...paths].sort()) {
    const absolute = join(root, path);
    const entry = await lstat(absolute);
    if (entry.isSymbolicLink()) {
      entries.set(path, { kind: "symlink", target: await readlink(absolute) });
    } else if (entry.isFile()) {
      entries.set(path, { kind: "file", bytes: await readFile(absolute), mode: entry.mode & 0o777 });
    } else {
      throw new Error(`Official marketplace approval cannot verify non-file Git-visible path: ${path}`);
    }
  }
  return { status, entries };
}

async function assertGitVisibleWorktreeUnchanged(
  root: string,
  expected: GitVisibleWorktreeSnapshot
): Promise<void> {
  const actual = await snapshotGitVisibleWorktree(root);
  if (!actual.status.equals(expected.status)
    || actual.entries.size !== expected.entries.size
    || [...expected.entries].some(([path, entry]) => !sameWorktreeEntry(entry, actual.entries.get(path)))) {
    throw new Error("Official marketplace approval verification changed the approved worktree snapshot");
  }
}

function sameWorktreeEntry(
  expected: TrackedWorktreeEntry,
  actual: TrackedWorktreeEntry | undefined
): boolean {
  if (actual === undefined || expected.kind !== actual.kind) return false;
  if (expected.kind === "symlink") {
    return actual.kind === "symlink" && expected.target === actual.target;
  }
  return actual.kind === "file" && expected.mode === actual.mode && expected.bytes.equals(actual.bytes);
}

async function restoreCleanWorktree(root: string, snapshot: CleanWorktreeSnapshot): Promise<void> {
  const status = await gitBytes(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  for (const path of parsePorcelainPaths(status)) {
    const absolute = join(root, path);
    const previous = snapshot.tracked.get(path);
    await rm(absolute, { recursive: true, force: true });
    if (previous === undefined) continue;
    await mkdir(dirname(absolute), { recursive: true });
    if (previous.kind === "symlink") {
      await symlink(previous.target, absolute);
    } else {
      await writeFile(absolute, previous.bytes, { mode: previous.mode });
      await chmod(absolute, previous.mode);
    }
  }
  const remaining = await gitBytes(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (remaining.length > 0) {
    throw new Error("Official marketplace approval rollback did not restore a clean worktree");
  }
}

function parsePorcelainPaths(status: Buffer): string[] {
  const fields = splitNullTerminated(status, true);
  const paths = new Set<string>();
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index]!;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Official marketplace approval received malformed Git status output");
    }
    const statusCode = record.slice(0, 2);
    paths.add(record.slice(3));
    if (/[RC]/u.test(statusCode)) {
      const original = fields[index + 1];
      if (original === undefined) {
        throw new Error("Official marketplace approval received incomplete Git rename status");
      }
      paths.add(original);
      index += 1;
    }
  }
  return [...paths].sort();
}

function splitNullTerminated(bytes: Buffer, allowEmpty = false): string[] {
  const value = bytes.toString("utf8");
  if (value.length === 0) return [];
  if (!value.endsWith("\0")) throw new Error("Git returned a non-terminated path list");
  const fields = value.slice(0, -1).split("\0");
  if (!allowEmpty && fields.some((field) => field.length === 0)) {
    throw new Error("Git returned an empty tracked path");
  }
  return fields;
}

async function gitBytes(root: string, args: readonly string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
    env: childEnvironment()
  });
  return Buffer.from(stdout);
}

async function assertManualOfficialEvidenceStableForApproval(
  root: string,
  approvedAt: string
): Promise<Array<{ name: string; expectedIdentity: string }>> {
  const selection = loadOfficialMarketplaceSelection(root);
  if (selection.state !== "review-required") {
    throw new Error("Official marketplace operator approval requires a review-held selection");
  }
  const source = validateResearchSourceConfig(JSON.parse(await readFile(
    join(root, "research", "sources", "anthropic-plugins-official.json"),
    "utf8"
  )) as unknown);
  const observationsDocument = JSON.parse(await readFile(
    join(root, "research", "source-observations.json"),
    "utf8"
  )) as unknown;
  if (!isRecord(observationsDocument) || observationsDocument.schemaVersion !== 3
    || !Array.isArray(observationsDocument.observations)) {
    throw new Error("research/source-observations.json: invalid materialized source observations");
  }
  const latestObservations = observationsDocument.observations
    .map(validateSourceObservation)
    .filter(({ sourceId }) => sourceId === source.sourceId);
  const receipts = await Promise.all((await readdir(join(root, "research", "receipts")))
    .filter((name) => name.endsWith(".json"))
    .sort(compareCodePointStrings)
    .map(async (name) => validateResearchCollectionReceipt(JSON.parse(await readFile(
      join(root, "research", "receipts", name),
      "utf8"
    )) as unknown)));
  const receipt = receipts
    .filter(({ sourceId }) => sourceId === source.sourceId)
    .sort((left, right) => compareCodePointStrings(right.observedAt, left.observedAt)
      || compareCodePointStrings(right.id, left.id))[0];
  if (latestObservations.length !== 1 || receipt === undefined) {
    throw new Error("Latest official marketplace observation must resolve exactly once");
  }
  const snapshot = verifyResearchSnapshot(validateResearchSnapshot(JSON.parse(await readFile(
    join(root, "research", "snapshots", `${receipt.snapshotId}.json`),
    "utf8"
  )) as unknown));
  const effective = resolveLatestEffectiveSourceObservation({
    source,
    receipt,
    snapshot,
    materialized: latestObservations[0]!
  });
  if (effective.repository !== selection.observedArtifact.provenance.repository
    || effective.inspectedCommit !== selection.observedArtifact.provenance.inspectedCommit
    || Date.parse(effective.observedAt) > Date.parse(approvedAt)) {
    throw new Error("Latest official marketplace observation must exactly bind the review-held selection");
  }
  const manual = validateDecisionCandidateEvidence(parse(await readFile(
    join(root, "manifests", "decision-candidate-evidence.yaml"),
    "utf8"
  )) as unknown);
  const approved = new Map(selection.approvedArtifact.plugins.map((plugin) => [plugin.name, plugin]));
  const observed = new Map(selection.observedArtifact.plugins.map((plugin) => [plugin.name, plugin]));
  const projected = new Map((await loadDecisionManifests(root)).candidates.map((candidate) => [candidate.id, candidate]));
  const revisions = new Map((manual.candidateRevisions ?? []).map((revision) => [revision.id, revision]));
  const candidateRebindings: Array<{ name: string; expectedIdentity: string }> = [];
  for (const candidate of manual.candidates) {
    if (candidate.officialBaseline === undefined) continue;
    const before = approved.get(candidate.officialBaseline.pluginName);
    const after = observed.get(candidate.officialBaseline.pluginName);
    const beforeIdentity = before === undefined ? undefined : officialMarketplaceCandidateIdentity(before);
    const afterIdentity = after === undefined ? undefined : officialMarketplaceCandidateIdentity(after);
    if (beforeIdentity !== afterIdentity) {
      const current = projected.get(candidate.id);
      const revision = current?.candidateRevisionId === undefined
        ? undefined
        : revisions.get(current.candidateRevisionId);
      if (afterIdentity !== undefined
        && current?.state === "held"
        && revision?.approval.disposition === "held"
        && revision.approval.candidateIdentity === afterIdentity
        && revision.approval.observedArtifactPath
          === `research/marketplaces/${selection.observedArtifactPath}`
        && revision.approval.observedArtifactSha256 === selection.observedArtifactSha256
        && current.officialBaseline?.reference.startsWith(
          `research/marketplaces/${selection.observedArtifactPath}#/plugins/`
        ) === true
        && Date.parse(revision.approval.reviewedAt) <= Date.parse(approvedAt)) {
        candidateRebindings.push({ name: candidate.id, expectedIdentity: afterIdentity });
        continue;
      }
      throw new Error(
        `Manual official evidence must be rebound before marketplace approval: ${candidate.id}`
      );
    }
  }
  return candidateRebindings;
}

export function parseOfficialMarketplaceApprovalArguments(args: readonly string[]): Omit<
  OfficialMarketplaceApprovalWorkflowInput,
  "root" | "verify"
> {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      "approved-at": { type: "string" },
      "approved-by": { type: "string" },
      "base-sha": { type: "string" },
      "expected-head-sha": { type: "string" },
      "approved-registry-tag-object": { type: "string" },
      reason: { type: "string" },
      "candidate-addition-json": { type: "string", multiple: true }
    }
  });
  const approvedAt = values["approved-at"];
  const approvedBy = values["approved-by"];
  const baseSha = values["base-sha"];
  const expectedHeadSha = values["expected-head-sha"];
  const approvedRegistryTagObject = values["approved-registry-tag-object"];
  const reason = values.reason;
  if (approvedAt === undefined || approvedBy === undefined || reason === undefined
    || baseSha === undefined || expectedHeadSha === undefined || approvedRegistryTagObject === undefined) {
    throw new Error(
      "Approval requires --approved-at, --approved-by, --reason, --base-sha, --expected-head-sha, and --approved-registry-tag-object"
    );
  }
  const candidateAdditions = (values["candidate-addition-json"] ?? []).map((raw, index) => {
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`--candidate-addition-json ${index + 1} must be valid JSON`);
    }
    if (!isRecord(value)
      || Object.keys(value).sort().join("\0") !== ["expectedIdentity", "name"].sort().join("\0")
      || typeof value.name !== "string"
      || typeof value.expectedIdentity !== "string") {
      throw new Error(`--candidate-addition-json ${index + 1} must contain only name and expectedIdentity`);
    }
    return { name: value.name, expectedIdentity: value.expectedIdentity };
  });
  return {
    baseSha,
    expectedHeadSha,
    approvedRegistryTagObject,
    approvedAt,
    approvedBy,
    reason,
    candidateAdditions
  };
}

export async function verifyApprovedCatalog(input: { root: string; asOf: string }): Promise<void> {
  await materializeDecisionResearch({ root: input.root, asOf: input.asOf, checkOnly: true });
  const artifacts = await generateAll(input.root);
  await assertArtifactsCurrent(input.root, artifacts);
  await loadDecisionIndex(input.root);
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.GH_TOKEN;
  delete environment.GITHUB_TOKEN;
  return environment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUtcSeconds(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString().replace(".000Z", "Z") === value;
}

async function main(args: readonly string[]): Promise<void> {
  const input = parseOfficialMarketplaceApprovalArguments(args);
  const result = await runOfficialMarketplaceApprovalWorkflow({
    root: process.cwd(),
    ...input
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
