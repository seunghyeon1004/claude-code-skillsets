import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { valid } from "semver";
import { decideUpdate, type UpdateCandidate } from "../trust/update-policy.js";
import { loadInstalledDecisionIndexSet } from "../decision/index-loader.js";
import {
  parseSetupInstallLock as parseAuthenticatedSetupInstallLock
} from "../evaluate/setup.js";
import {
  exactEnabledPluginVersion,
  parseClaudeMarketplaceList21198,
  parseClaudePluginList21198,
  parseClaudeVersion21198
} from "../runtime/claude-2-1-198.js";
import type { ManagedInstallReceipt } from "../model/decision.js";
import type { TrustTier } from "../model/manifest.js";
import { assertSafeId, assertSafeMarketplace } from "../safety/command-fields.js";
import {
  inspectSetupExecutionLock,
  readRequiredCanonicalSetupInstallLock
} from "../state/setup-state.js";

export type MaintenanceAction =
  | "compatible-update-preview"
  | "review-required-hold"
  | "blocked-notice"
  | "removal-preview";

export type MaintenanceOperation = "update" | "remove";

export interface ObservedPluginIdentity {
  pluginName: string;
  marketplaceId: string;
  marketplaceSource: string;
  scope: ManagedInstallReceipt["scope"];
  version: string;
}

export interface ObservedUpdateCandidate {
  identity: ObservedPluginIdentity;
  trustTier: TrustTier;
  licenseChanged: boolean;
  permissionsChanged: boolean;
  ownershipChanged: boolean;
}

export interface MaintenanceReviewEvidence {
  decision: "approved" | "rejected";
  decisionId: string;
  evidenceDigest: string;
  reviewedAt: string;
  expiresAt: string;
}

export interface MaintenanceSyntaxEvidence {
  claudeVersion: string;
  source: "official-claude-cli-help";
  sourceDigest: string;
  claudeExecutableSha256: string;
  command: string;
  verificationCommand: "claude plugin list --json";
}

export interface CurrentMaintenanceObservation {
  observedAt: string;
  claudeVersion: string;
  claudeExecutableSha256: string;
}

/**
 * A public data view is intentionally not a capability. The state can only be
 * planned while its private WeakMap record remains in this module.
 */
export interface LoadedMaintenanceState {
  operation: MaintenanceOperation;
  receipt: ManagedInstallReceipt;
  receiptPath: string;
  installed: ObservedPluginIdentity;
  update: ObservedUpdateCandidate | null;
  review: MaintenanceReviewEvidence | null;
  syntax: MaintenanceSyntaxEvidence | null;
  currentObservation: CurrentMaintenanceObservation;
}

export interface MaintenanceRequest {
  operation?: MaintenanceOperation;
  state?: LoadedMaintenanceState;
}

export interface ApprovalChallenge {
  nonce: string;
  epoch: number;
  expiresAt: string;
}

export interface MaintenancePreview {
  operation: "remove";
  currentIdentity: ObservedPluginIdentity;
  nextIdentity: null;
  receiptPath: string;
  receiptDigest: string;
  review: MaintenanceReviewEvidence;
  syntax: MaintenanceSyntaxEvidence;
  commands: string[];
  verificationCommand: "claude plugin list --json";
  approval: ApprovalChallenge;
  stateChanges: string[];
}

export interface MaintenancePlan {
  action: MaintenanceAction;
  operation: MaintenanceOperation;
  reasons: string[];
  commands: string[];
  stateChanges: string[];
  requiresFreshApproval: boolean;
  /** SHA-256 of the preview, including a random single-use challenge. */
  approvalBinding: string | null;
  /** No current Claude Code update transaction adapter proves restoration. */
  preservesPriorIdentityOnFailure: false;
  preview: MaintenancePreview | null;
}

export interface ApprovalConsumption {
  accepted: boolean;
  reason: "consumed" | "not-issued" | "binding-mismatch" | "expired" | "superseded" | "already-consumed";
  consumedAt: string | null;
}

interface LoadedMaintenanceStateRecord {
  readonly state: LoadedMaintenanceState;
  readonly generation: number;
}

interface IssuedApprovalRecord {
  readonly binding: string;
  readonly expiresAt: string;
  readonly generation: number;
  consumed: boolean;
}

interface MaintenancePolicy {
  readonly cli: {
    readonly version: "2.1.198";
    readonly sourceDigest: string;
  };
  readonly reviews: readonly PolicyReview[];
}

interface PolicyReview extends MaintenanceReviewEvidence {
  readonly operation: MaintenanceOperation;
  readonly currentIdentity: ObservedPluginIdentity;
  readonly nextIdentity: ObservedPluginIdentity | null;
}

const execFile = promisify(execFileCallback);
const loadedMaintenanceStates = new WeakMap<LoadedMaintenanceState, LoadedMaintenanceStateRecord>();
const issuedApprovals = new WeakMap<MaintenancePlan, IssuedApprovalRecord>();
let approvalEpoch = 0;
let latestLoadedGeneration = 0;

const setupLockPath = "state/install-lock.json";
const policyPath = fileURLToPath(new URL("../../plugins/skillset-manager/maintenance-policy.json", import.meta.url));
const pluginRoot = fileURLToPath(new URL("../../plugins/skillset-manager", import.meta.url));
const maintenancePolicyDigest = "2d62b8d4cc53db22a0fd66ee9a16c0b464bb8770902ab4fc1ed35cd714284b2a";
const expectedClaudeVersion = "2.1.198";
const digestPattern = /^[0-9a-f]{64}$/;
const utcTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const approvalLifetimeMilliseconds = 5 * 60 * 1000;

class MaintenanceReviewHold extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * Loads the one internally anchored user state location. It intentionally has
 * no root, state-path, policy-path, clock, or command override in the public API.
 */
export async function loadMaintenanceState(
  operation: MaintenanceOperation = "update",
  pluginName?: string
): Promise<LoadedMaintenanceState> {
  if (!isOperation(operation)) throw new Error("Maintenance operation is required");
  if (pluginName !== undefined) assertSafeId(pluginName, "managed plugin selection");
  const executionLock = await inspectSetupExecutionLock();
  if (executionLock.status !== "absent") {
    throw new MaintenanceReviewHold(
      `setup execution lock requires doctor review: ${executionLock.relativePath} (${executionLock.status})`
    );
  }
  const policy = await loadPinnedPolicy();
  const decisionIndexes = await loadInstalledDecisionIndexSet();
  const receipt = selectManagedReceipt(
    await parseSetupInstallLock((await readRequiredCanonicalSetupInstallLock()).value, decisionIndexes),
    pluginName
  );
  if (receipt.versionStatus === "unknown") {
    throw new MaintenanceReviewHold(
      "managed install version is unknown; maintenance requires an observed semver"
    );
  }
  const { currentObservation: runtime, installed } = await observeCurrentClaudeRuntime(receipt);
  const policyReview = resolvePolicyReview(policy, operation, installed);
  const review = policyReview === null ? null : reviewEvidenceView(policyReview);
  const update = operation === "update" && policyReview?.nextIdentity !== null && policyReview?.nextIdentity !== undefined
    ? deepFreeze({
      identity: policyReview.nextIdentity,
      trustTier: "trusted" as const,
      licenseChanged: false,
      permissionsChanged: false,
      ownershipChanged: false
    })
    : null;
  const syntax = policy.cli.version === runtime.claudeVersion
    ? deepFreeze({
      claudeVersion: policy.cli.version,
      source: "official-claude-cli-help" as const,
      sourceDigest: policy.cli.sourceDigest,
      claudeExecutableSha256: runtime.claudeExecutableSha256,
      command: commandFor(operation, installed),
      verificationCommand: "claude plugin list --json" as const
    })
    : null;
  const loaded = deepFreeze({
    operation,
    receipt,
    receiptPath: setupLockPath,
    installed,
    update,
    review,
    syntax,
    currentObservation: runtime
  });
  loadedMaintenanceStates.set(loaded, { state: loaded, generation: ++latestLoadedGeneration });
  return loaded;
}

/** Returns false for JSON, spread, or structuredClone reconstructions. */
export function isLoadedMaintenanceState(value: unknown): value is LoadedMaintenanceState {
  if (!isRecord(value)) return false;
  const candidate = value as unknown as LoadedMaintenanceState;
  return loadedMaintenanceStates.get(candidate)?.state === candidate;
}

/** Stable receipt digest used in an explicit removal preview. */
export function managedInstallReceiptDigest(receipt: ManagedInstallReceipt): string {
  return createHash("sha256").update(stableValue(receipt)).digest("hex");
}

/**
 * Produces only a preview or a hold. It never invokes a maintenance command or
 * writes a receipt. Compatible updates hold until a real transaction adapter is
 * implemented and pinned by policy.
 */
export function planMaintenance(request: MaintenanceRequest | unknown): MaintenancePlan {
  const requestedOperation = requestedOperationFor(request);
  const state = isRecord(request) ? request.state : undefined;
  if (!isLoadedMaintenanceState(state)) {
    if (requestedOperation === undefined) throw new Error("Maintenance operation is required");
    return reviewHold(requestedOperation, "project-state-loader-authentication-required");
  }

  const loaded = loadedMaintenanceStates.get(state)!.state;
  if (requestedOperation !== undefined && requestedOperation !== loaded.operation) {
    return reviewHold(requestedOperation, "requested operation does not match the loaded state");
  }
  const ownershipReason = ownershipFailure(loaded.receipt, loaded.installed);
  if (ownershipReason !== undefined) return reviewHold(loaded.operation, ownershipReason);
  if (loaded.review === null) return reviewHold(loaded.operation, "policy-owned review evidence is unavailable");
  if (loaded.review.decision !== "approved") {
    return reviewHold(loaded.operation, `policy review decision is ${loaded.review.decision}`);
  }
  if (!isUtcTimestamp(loaded.currentObservation.observedAt)) {
    return reviewHold(loaded.operation, "current maintenance observation time is invalid");
  }
  if (Date.parse(loaded.currentObservation.observedAt) >= Date.parse(loaded.review.expiresAt)) {
    return reviewHold(loaded.operation, "policy review is stale at the current observation time");
  }
  if (loaded.syntax === null) {
    return reviewHold(loaded.operation, "current Claude CLI version does not match the plugin maintenance policy");
  }

  if (loaded.operation === "remove") return removalPreview(loaded);
  if (loaded.update === null) return reviewHold(loaded.operation, "missing observed update candidate");
  if (!sameIdentityExceptVersion(loaded.installed, loaded.update.identity)) {
    return reviewHold(loaded.operation, "update candidate identity differs from the managed installation");
  }
  if (loaded.installed.version === loaded.update.identity.version) {
    return reviewHold(loaded.operation, "next version equals current version");
  }

  const decision = decideUpdate(updateCandidate(loaded.installed, loaded.update));
  if (decision.action === "block") return blockedNotice(loaded.operation, decision.reasons);
  if (decision.action === "review") return reviewHold(loaded.operation, ...decision.reasons);
  return reviewHold(
    loaded.operation,
    "no executable Claude CLI transaction adapter proves update restoration",
    ...decision.reasons
  );
}

/**
 * Public safe facade for callers that only know the requested operation. Loader
 * failures never default to update and never expose a command-bearing fallback.
 */
export async function safelyPlanMaintenance(
  operation: MaintenanceOperation,
  pluginName?: string
): Promise<MaintenancePlan> {
  if (!isOperation(operation)) throw new Error("Maintenance operation is required");
  try {
    return planMaintenance({ operation, state: await loadMaintenanceState(operation, pluginName) });
  } catch (error) {
    if (error instanceof MaintenanceReviewHold) return reviewHold(operation, error.reason);
    return reviewHold(operation, "project-maintenance-state-unavailable");
  }
}

/** Records one explicit approval challenge consumption; it does not execute anything. */
export function consumeMaintenanceApproval(
  plan: MaintenancePlan,
  approvalBinding: string
): ApprovalConsumption {
  const issued = issuedApprovals.get(plan);
  if (issued === undefined) return { accepted: false, reason: "not-issued", consumedAt: null };
  if (approvalBinding !== issued.binding) return { accepted: false, reason: "binding-mismatch", consumedAt: null };
  if (issued.generation !== latestLoadedGeneration) return { accepted: false, reason: "superseded", consumedAt: null };
  const observedAt = new Date().toISOString();
  if (Date.parse(observedAt) >= Date.parse(issued.expiresAt)) {
    return { accepted: false, reason: "expired", consumedAt: null };
  }
  if (issued.consumed) return { accepted: false, reason: "already-consumed", consumedAt: null };
  issued.consumed = true;
  return { accepted: true, reason: "consumed", consumedAt: observedAt };
}

function removalPreview(loaded: LoadedMaintenanceState): MaintenancePlan {
  const review = loaded.review!;
  const syntax = loaded.syntax!;
  const approval = deepFreeze({
    nonce: randomBytes(32).toString("hex"),
    epoch: ++approvalEpoch,
    expiresAt: new Date(Date.now() + approvalLifetimeMilliseconds).toISOString()
  });
  const commands = [syntax.command, syntax.verificationCommand];
  const preview = deepFreeze({
    operation: "remove" as const,
    currentIdentity: loaded.installed,
    nextIdentity: null,
    receiptPath: loaded.receiptPath,
    receiptDigest: managedInstallReceiptDigest(loaded.receipt),
    review,
    syntax,
    commands,
    verificationCommand: syntax.verificationCommand,
    approval,
    stateChanges: [
      `Remove the managed receipt ${loaded.receiptPath} only after ${syntax.verificationCommand} confirms ${pluginLabel(loaded.installed)} is absent.`,
      "This preview makes no restore, preservation, or transaction-atomicity claim."
    ]
  });
  const approvalBinding = previewDigest(preview);
  const plan = deepFreeze({
    action: "removal-preview" as const,
    operation: "remove" as const,
    reasons: ["managed installation identity exactly matches its project-issued receipt"],
    commands: [...commands],
    stateChanges: [...preview.stateChanges],
    requiresFreshApproval: true,
    approvalBinding,
    preservesPriorIdentityOnFailure: false as const,
    preview
  });
  issuedApprovals.set(plan, {
    binding: approvalBinding,
    expiresAt: approval.expiresAt,
    generation: loadedMaintenanceStates.get(loaded)!.generation,
    consumed: false
  });
  return plan;
}

function reviewHold(operation: MaintenanceOperation, ...reasons: string[]): MaintenancePlan {
  return deepFreeze({
    action: "review-required-hold" as const,
    operation,
    reasons,
    commands: [],
    stateChanges: [],
    requiresFreshApproval: false,
    approvalBinding: null,
    preservesPriorIdentityOnFailure: false as const,
    preview: null
  });
}

function blockedNotice(operation: MaintenanceOperation, reasons: string[]): MaintenancePlan {
  return deepFreeze({
    action: "blocked-notice" as const,
    operation,
    reasons,
    commands: [],
    stateChanges: [],
    requiresFreshApproval: false,
    approvalBinding: null,
    preservesPriorIdentityOnFailure: false as const,
    preview: null
  });
}

function requestedOperationFor(value: unknown): MaintenanceOperation | undefined {
  return isRecord(value) && isOperation(value.operation) ? value.operation : undefined;
}

interface ParsedSetupInstallLock {
  receipts: ManagedInstallReceipt[];
}

async function parseSetupInstallLock(
  value: unknown,
  decisionIndexes: Awaited<ReturnType<typeof loadInstalledDecisionIndexSet>>
): Promise<ParsedSetupInstallLock> {
  const parsed = await parseAuthenticatedSetupInstallLock(value, decisionIndexes);
  if (parsed.completedRunDigests.length !== parsed.runs.length) {
    throw new Error("Canonical setup install lock contains a partial or failed setup run");
  }
  return { receipts: parsed.receipts };
}

export function assertCanonicalManagedReceiptOrder(
  executionOrder: readonly { candidateId: string; pluginName: string }[],
  statuses: ReadonlyMap<string, "success" | "failure" | "skipped">,
  receipts: readonly Pick<ManagedInstallReceipt, "pluginName">[]
): void {
  const successfulOrder = executionOrder
    .filter(({ candidateId }) => statuses.get(candidateId) === "success")
    .map(({ pluginName }) => pluginName);
  if (receipts.length !== successfulOrder.length
    || receipts.some((receipt, index) => receipt.pluginName !== successfulOrder[index])) {
    throw new Error("Canonical setup lock managed receipts do not match successful execution order");
  }
}

function selectManagedReceipt(
  lock: ParsedSetupInstallLock,
  pluginName: string | undefined
): ManagedInstallReceipt {
  const matches = pluginName === undefined
    ? lock.receipts
    : lock.receipts.filter((receipt) => receipt.pluginName === pluginName);
  if (matches.length !== 1) {
    throw new Error(pluginName === undefined
      ? "Maintenance requires exactly one managed receipt or an exact plugin selection"
      : "Maintenance plugin selection does not resolve to exactly one managed receipt");
  }
  return matches[0]!;
}

function parseIdentity(value: unknown, field: string): ObservedPluginIdentity {
  if (!isRecord(value) || !hasExactKeys(value, ["pluginName", "marketplaceId", "marketplaceSource", "scope", "version"])
    || typeof value.pluginName !== "string" || typeof value.marketplaceId !== "string"
    || typeof value.marketplaceSource !== "string" || !isScope(value.scope)
    || typeof value.version !== "string" || valid(value.version) === null) {
    throw new Error(`Invalid ${field}`);
  }
  assertSafeId(value.pluginName, `${field} plugin name`);
  assertSafeMarketplace(value.marketplaceId, `${field} marketplace ID`);
  return deepFreeze({
    pluginName: value.pluginName,
    marketplaceId: value.marketplaceId,
    marketplaceSource: canonicalMarketplaceSource(value.marketplaceSource),
    scope: value.scope,
    version: value.version
  });
}

async function loadPinnedPolicy(): Promise<MaintenancePolicy> {
  await assertNoSymlinkAncestors(policyPath);
  const bytes = await readFile(policyPath);
  if (createHash("sha256").update(bytes).digest("hex") !== maintenancePolicyDigest) {
    throw new Error("Plugin maintenance policy digest does not match the tracked policy");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Plugin maintenance policy is not valid JSON");
  }
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "kind", "cli", "transactionAdapters", "reviews"])
    || value.schemaVersion !== 1 || value.kind !== "skillset-manager-maintenance-policy-v1") {
    throw new Error("Invalid plugin maintenance policy");
  }
  if (!isRecord(value.cli) || !hasExactKeys(value.cli, ["version", "syntaxEvidence", "verificationCommand"])
    || value.cli.version !== expectedClaudeVersion || value.cli.verificationCommand !== "claude plugin list --json"
    || !isRecord(value.cli.syntaxEvidence) || !hasExactKeys(value.cli.syntaxEvidence, ["kind", "source", "digest"])
    || value.cli.syntaxEvidence.kind !== "official-claude-cli-help-v1"
    || value.cli.syntaxEvidence.source !== "https://docs.anthropic.com/en/docs/claude-code/cli-reference"
    || !isDigest(value.cli.syntaxEvidence.digest)) {
    throw new Error("Invalid pinned Claude CLI policy evidence");
  }
  if (!isRecord(value.transactionAdapters) || !hasExactKeys(value.transactionAdapters, ["update", "remove"])
    || value.transactionAdapters.update !== null || value.transactionAdapters.remove !== null || !Array.isArray(value.reviews)) {
    throw new Error("Invalid pinned maintenance transaction policy");
  }
  return deepFreeze({
    cli: { version: expectedClaudeVersion, sourceDigest: value.cli.syntaxEvidence.digest },
    reviews: value.reviews.map(parsePolicyReview)
  });
}

function parsePolicyReview(value: unknown): PolicyReview {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id", "operation", "decision", "evidenceDigest", "currentIdentity", "nextIdentity", "reviewedAt", "expiresAt"
  ]) || typeof value.id !== "string" || !safeEvidenceId(value.id) || !isOperation(value.operation)
    || (value.decision !== "approved" && value.decision !== "rejected") || !isDigest(value.evidenceDigest)
    || !isUtcTimestamp(value.reviewedAt) || !isUtcTimestamp(value.expiresAt)) {
    throw new Error("Invalid policy-owned maintenance review evidence");
  }
  const currentIdentity = parseIdentity(value.currentIdentity, "policy review current identity");
  const nextIdentity = value.nextIdentity === null ? null : parseIdentity(value.nextIdentity, "policy review next identity");
  if ((value.operation === "remove") !== (nextIdentity === null)) {
    throw new Error("Policy review next identity does not match its operation");
  }
  return deepFreeze({
    decision: value.decision,
    decisionId: value.id,
    evidenceDigest: value.evidenceDigest,
    reviewedAt: value.reviewedAt,
    expiresAt: value.expiresAt,
    operation: value.operation,
    currentIdentity,
    nextIdentity
  });
}

function resolvePolicyReview(
  policy: MaintenancePolicy,
  operation: MaintenanceOperation,
  installed: ObservedPluginIdentity
): PolicyReview | null {
  const matches = policy.reviews.filter((candidate) =>
    candidate.operation === operation && sameIdentity(candidate.currentIdentity, installed)
  );
  return matches.length === 1 ? matches[0]! : null;
}

function reviewEvidenceView(review: PolicyReview): MaintenanceReviewEvidence {
  return deepFreeze({
    decision: review.decision,
    decisionId: review.decisionId,
    evidenceDigest: review.evidenceDigest,
    reviewedAt: review.reviewedAt,
    expiresAt: review.expiresAt
  });
}

async function observeCurrentClaudeRuntime(receipt: ManagedInstallReceipt): Promise<{
  currentObservation: CurrentMaintenanceObservation;
  installed: ObservedPluginIdentity;
}> {
  const observedAt = new Date().toISOString();
  if (!isUtcTimestamp(observedAt)) throw new Error("Current maintenance observation time is invalid");
  const commandOptions = {
    encoding: "utf8" as const,
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  };
  const executable = await resolveClaudeExecutableIdentity();
  const [{ stdout: versionStdout }, { stdout: marketplaceStdout }, { stdout: pluginStdout }] = await Promise.all([
    execFile(executable.path, ["--version"], commandOptions),
    execFile(executable.path, ["plugin", "marketplace", "list", "--json"], commandOptions),
    execFile(executable.path, ["plugin", "list", "--json"], commandOptions)
  ]);
  await verifyClaudeExecutableIdentity(executable);
  const claudeVersion = observeClaudeVersion(versionStdout);
  const marketplaces = parseClaudeMarketplaceList21198(marketplaceStdout);
  const marketplace = marketplaces.filter((candidate) => candidate.id === receipt.marketplaceId);
  if (marketplace.length !== 1) throw new Error("Managed marketplace ID is not uniquely registered");
  const version = exactEnabledPluginVersion(parseClaudePluginList21198(pluginStdout), {
    pluginName: receipt.pluginName,
    marketplaceId: receipt.marketplaceId,
    scope: receipt.scope
  });
  if (version === null) throw new Error("Managed plugin is not currently enabled at its exact identity");
  if (version.versionStatus === "unknown" || version.version === null) {
    throw new MaintenanceReviewHold(
      "current plugin version is unknown; maintenance requires an observed semver"
    );
  }
  return deepFreeze({
    currentObservation: { observedAt, claudeVersion, claudeExecutableSha256: executable.sha256 },
    installed: {
      pluginName: receipt.pluginName,
      marketplaceId: receipt.marketplaceId,
      marketplaceSource: marketplace[0]!.source,
      scope: receipt.scope,
      version: version.version
    }
  });
}

interface ClaudeExecutableIdentity {
  path: string;
  sha256: string;
}

async function resolveClaudeExecutableIdentity(): Promise<ClaudeExecutableIdentity> {
  const pathValue = process.env.PATH;
  if (pathValue === undefined || pathValue === "") throw new Error("Claude executable PATH is unavailable");
  for (const directory of pathValue.split(delimiter)) {
    if (directory === "") continue;
    const candidate = resolve(directory, process.platform === "win32" ? "claude.exe" : "claude");
    try {
      await access(candidate, fsConstants.X_OK);
      const path = resolve(await realpath(candidate));
      const metadata = await lstat(path);
      if (!isAbsolute(path) || metadata.isSymbolicLink() || !metadata.isFile()) continue;
      return { path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") };
    } catch {
      continue;
    }
  }
  throw new Error("Claude executable is not one canonical executable on PATH");
}

async function verifyClaudeExecutableIdentity(expected: ClaudeExecutableIdentity): Promise<void> {
  const metadata = await lstat(expected.path);
  const sha256 = createHash("sha256").update(await readFile(expected.path)).digest("hex");
  if (metadata.isSymbolicLink() || !metadata.isFile() || sha256 !== expected.sha256) {
    throw new Error("Claude executable identity changed during maintenance observation");
  }
}

function observeClaudeVersion(stdout: string): string {
  const match = stdout.match(/^(\d+\.\d+\.\d+) \(Claude Code\)\n?$/);
  if (match?.[1] === undefined || valid(match[1]) === null) {
    throw new Error("Unexpected Claude Code version output");
  }
  return match[1] === expectedClaudeVersion ? parseClaudeVersion21198(stdout) : match[1];
}

function ownershipFailure(receipt: ManagedInstallReceipt, installed: ObservedPluginIdentity): string | undefined {
  if (
    receipt.pluginName !== installed.pluginName || receipt.marketplaceId !== installed.marketplaceId
    || receipt.marketplaceSource !== installed.marketplaceSource || receipt.scope !== installed.scope
    || receipt.postInstallVersion !== installed.version
  ) {
    return "current installed identity does not exactly match the managed receipt";
  }
  return undefined;
}

function updateCandidate(current: ObservedPluginIdentity, candidate: ObservedUpdateCandidate): UpdateCandidate {
  return {
    trustTier: candidate.trustTier,
    current: current.version,
    next: candidate.identity.version,
    licenseChanged: candidate.licenseChanged,
    permissionsChanged: candidate.permissionsChanged,
    ownershipChanged: candidate.ownershipChanged
  };
}

function sameIdentity(left: ObservedPluginIdentity, right: ObservedPluginIdentity): boolean {
  return left.pluginName === right.pluginName && left.marketplaceId === right.marketplaceId
    && left.marketplaceSource === right.marketplaceSource && left.scope === right.scope && left.version === right.version;
}

function sameIdentityExceptVersion(left: ObservedPluginIdentity, right: ObservedPluginIdentity): boolean {
  return left.pluginName === right.pluginName && left.marketplaceId === right.marketplaceId
    && left.marketplaceSource === right.marketplaceSource && left.scope === right.scope;
}

function commandFor(operation: MaintenanceOperation, identity: ObservedPluginIdentity): string {
  return `claude plugin ${operation} ${identity.pluginName}@${identity.marketplaceId} --scope ${identity.scope}`;
}

function pluginLabel(identity: ObservedPluginIdentity): string {
  return `${identity.pluginName}@${identity.marketplaceId} (${identity.version}, ${identity.marketplaceSource}, ${identity.scope})`;
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const absolute = resolve(path);
  let current: string = sep;
  for (const segment of absolute.split(sep).filter((segment) => segment !== "")) {
    current = join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error("Project-owned maintenance path contains a symlink");
  }
}

function canonicalMarketplaceSource(value: string): string {
  const repository = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (repository.test(value)) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Marketplace source is not canonical");
  }
  const canonical = `https://${parsed.hostname}${parsed.pathname}`;
  if (
    parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.port !== ""
    || parsed.search !== "" || parsed.hash !== "" || parsed.hostname === "" || value !== canonical
    || parsed.pathname === "/" || parsed.pathname.endsWith("/") || parsed.pathname.includes("//")
    || parsed.pathname.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Marketplace source is not canonical");
  }
  return canonical;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(utcTimestampPattern);
  if (match === null) return false;
  const [, year, month, day, hour, minute, second, fraction] = match;
  const milliseconds = Number((fraction ?? "").padEnd(3, "0") || "0");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), milliseconds));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day) && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute) && date.getUTCSeconds() === Number(second)
    && date.getUTCMilliseconds() === milliseconds;
}

function isScope(value: unknown): value is ManagedInstallReceipt["scope"] {
  return value === "user" || value === "project" || value === "local";
}

function isOperation(value: unknown): value is MaintenanceOperation {
  return value === "update" || value === "remove";
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}

function safeEvidenceId(value: string): boolean {
  return /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewDigest(preview: MaintenancePreview): string {
  return createHash("sha256").update(stableValue(preview)).digest("hex");
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}
