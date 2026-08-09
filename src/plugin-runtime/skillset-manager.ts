import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, realpathSync } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  loadInstalledDecisionBoundary,
  loadInstalledDecisionIndexSet
} from "../decision/index-loader.js";
import type { PluginDecisionBoundary } from "../decision/index-loader.js";
import {
  buildSetupReviewSummary,
  buildSetupDiscoveryCandidates,
  evaluateSetupDecisionFixture,
  executeAndPublishApprovedSetupCandidates,
  parseSetupInstallLock,
  type SetupCandidateExecutionFixture,
  type SetupDecisionFixture,
  type SetupExecutionDriver,
  type SetupPreviewCandidate
} from "../evaluate/setup.js";
import { COMPLETE_V1_DOMAIN_IDS, type DomainId, type Platform } from "../model/complete-v1.js";
import {
  exactEnabledPluginVersion,
  parseClaudeMarketplaceList21198,
  parseClaudePluginList21198,
  parseClaudeVersion21198,
  CLAUDE_CODE_VERSION
} from "../runtime/claude-2-1-198.js";
import {
  inspectSetupExecutionLock,
  readCanonicalSetupInstallLock
} from "../state/setup-state.js";
import type { SetupPublisherRuntimeIdentity } from "../decision/atomic-publisher.js";

const execFile = promisify(execFileCallback);
const RISK_ACKNOWLEDGEMENT = "I acknowledge every listed setup risk disclosure for this exact preview.";
const MAX_GOAL_LENGTH = 512;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const runtimePath = fileURLToPath(import.meta.url);

export interface RuntimeRequest {
  schemaVersion: 2;
  language: "ko" | "en";
  platform: Platform;
  observedAt: string;
  claudeProbeConsent: "granted";
  decisionIndexDigest: string;
  routingIndexDigest: string;
  goal?: string;
  domainIds?: DomainId[];
}

interface RuntimeRiskAcknowledgement {
  statement: typeof RISK_ACKNOWLEDGEMENT;
  disclosures: string[];
  digest: string;
}

interface ParsedSetupArguments {
  command: "preview" | "approval-object" | "execute";
  request: RuntimeRequest;
  requestArgument: string;
  approvedPreviewDigest?: string;
  riskAcknowledgementDigest?: string;
  approvedClaudeIdentity?: SetupPublisherRuntimeIdentity;
}

interface ParsedDoctorArguments {
  command: "doctor-state";
}

type ParsedArguments = ParsedSetupArguments | ParsedDoctorArguments;

interface CommandObservation {
  success: boolean;
  stdout: string;
  invoked: boolean;
}

export async function runSkillsetManagerRuntime(argv: readonly string[]): Promise<unknown> {
  const parsed = parseArguments(argv);
  if (parsed.command === "doctor-state") {
    return {
      schemaVersion: 1,
      command: "doctor-state",
      executionLock: await inspectSetupExecutionLock(),
      setupReconciliation: await diagnoseSetupReconciliation()
    };
  }
  if (parsed.command === "execute" && parsed.approvedPreviewDigest === undefined) {
    throw new Error("Approved preview digest is required for execute");
  }
  if (parsed.command === "execute" && parsed.riskAcknowledgementDigest === undefined) {
    throw new Error("Risk acknowledgement digest is required for execute");
  }
  const boundary = await loadInstalledDecisionBoundary();
  assertRuntimeRequestDecisionBoundary(parsed.request, boundary);
  const index = boundary.decisionIndex;
  const claudeExecutableIdentity = parsed.command === "preview"
    ? await observeClaudeExecutableIdentityFromPath()
    : parsed.approvedClaudeIdentity;
  if (claudeExecutableIdentity === undefined) {
    throw new Error("Approved Claude executable identity is required for execute");
  }
  const fixture = setupFixture(parsed.request, false, claudeExecutableIdentity);
  const previewPlan = await evaluateSetupDecisionFixture(index, fixture);
  const acknowledgement = riskAcknowledgementFor(
    previewPlan.approvalBinding.previewDigest,
    previewPlan.approvalBinding.preview.riskDisclosures
  );
  const executable = isExecutablePreview(previewPlan);
  const discoveryCandidates = buildSetupDiscoveryCandidates(
    index,
    previewPlan.requiresDomainPrioritySelection ? [] : previewPlan.domainIds,
    previewPlan.candidates
  );

  if (parsed.command === "preview") {
    return {
      schemaVersion: 1,
      command: "preview",
      status: previewPlan.status,
      holdReason: previewPlan.holdReason,
      holdReasons: previewPlan.holdReasons,
      discoveryCandidates,
      approval: { previewDigest: previewPlan.approvalBinding.previewDigest },
      reviewSummary: buildSetupReviewSummary(
        previewPlan.approvalBinding,
        boundary.routingIndex.digest,
        discoveryCandidates
      ),
      riskAcknowledgement: acknowledgement,
      ...(executable ? {
        approvalObjectAccess: {
          availability: "on-demand",
          argv: approvalObjectArgv(
            parsed.requestArgument,
            previewPlan.approvalBinding.previewDigest,
            claudeExecutableIdentity
          )
        },
        approvedExecution: {
          approvalBoundary: "separate-exact-Bash-tool-call",
          argv: approvedExecutionArgv(
            parsed.requestArgument,
            previewPlan.approvalBinding.previewDigest,
            acknowledgement.digest,
            claudeExecutableIdentity
          )
        }
      } : {})
    };
  }

  if (parsed.command === "approval-object") {
    if (parsed.approvedPreviewDigest !== previewPlan.approvalBinding.previewDigest) {
      throw new Error("Approved preview digest mismatch");
    }
    await verifyClaudeExecutableFileIdentity(claudeExecutableIdentity);
    return {
      schemaVersion: 1,
      command: "approval-object",
      plan: serializablePlan(previewPlan),
      approval: previewPlan.approvalBinding
    };
  }

  if (!executable) {
    throw new Error(`Setup route is not executable: ${previewPlan.status}${previewPlan.holdReason === null ? "" : ` (${previewPlan.holdReason})`}`);
  }
  if (parsed.approvedPreviewDigest !== previewPlan.approvalBinding.previewDigest) {
    throw new Error("Approved preview digest mismatch");
  }
  if (parsed.riskAcknowledgementDigest !== acknowledgement.digest) {
    throw new Error("Risk acknowledgement digest mismatch");
  }
  const approvalFixture = setupFixture(parsed.request, true, claudeExecutableIdentity);
  const awaitingApproval = await evaluateSetupDecisionFixture(index, approvalFixture);
  if (awaitingApproval.status !== "awaiting-approval"
    || awaitingApproval.approvalBinding.previewDigest !== parsed.approvedPreviewDigest) {
    throw new Error("Approved setup preview changed before execution");
  }
  const approved = await evaluateSetupDecisionFixture(index, {
    ...approvalFixture,
    approval: awaitingApproval.approvalBinding
  });
  if (!approved.approvalValid || approved.executionCapability === null) {
    throw new Error("Exact setup approval did not issue a process-local execution capability");
  }
  const execution = await executeAndPublishApprovedSetupCandidates({
    executionCapability: approved.executionCapability,
    decisionIndex: index,
    observedAt: parsed.request.observedAt,
    driver: claudeExecutionDriver(claudeExecutableIdentity)
  });
  return {
    schemaVersion: 1,
    command: "execute",
    status: execution.executionStatus === "executed"
      ? "executed"
      : execution.executionStatus === "already-executed" ? "already-executed" : "execution-failed",
    approval: { previewDigest: awaitingApproval.approvalBinding.previewDigest },
    execution
  };
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const command = argv[0];
  if (command === "doctor-state") {
    if (argv.length !== 1) throw new Error("doctor-state accepts no flags");
    return { command };
  }
  if (command !== "preview" && command !== "approval-object" && command !== "execute") {
    throw new Error("Usage: runtime.mjs doctor-state | preview|approval-object|execute --request <base64url-canonical-request>");
  }
  const flags = parseFlags(argv.slice(1));
  if (command === "preview" && flags.size !== 1) {
    throw new Error("Preview accepts only --request");
  }
  if (command === "approval-object"
    && (flags.size !== 3 || flags.has("--risk-acknowledgement-digest"))) {
    throw new Error("Approval object requires only request, preview digest, and approved Claude identity");
  }
  if (command === "execute" && flags.size !== 4) {
    throw new Error("Execute requires exactly request, preview digest, risk acknowledgement, and approved Claude identity");
  }
  const requestRaw = requiredFlag(flags, "--request");
  const request = validateRuntimeRequest(parseRequest(requestRaw));
  const requestArgument = encodeRequest(request);
  return {
    command,
    request,
    requestArgument,
    ...(flags.get("--approved-preview-digest") === undefined
      ? {}
      : { approvedPreviewDigest: digestFlag(flags, "--approved-preview-digest") }),
    ...(flags.get("--risk-acknowledgement-digest") === undefined
      ? {}
      : { riskAcknowledgementDigest: digestFlag(flags, "--risk-acknowledgement-digest") }),
    ...(flags.get("--approved-claude-identity") === undefined
      ? {}
      : { approvedClaudeIdentity: identityFlag(flags, "--approved-claude-identity") })
  };
}

function parseFlags(argv: readonly string[]): Map<string, string> {
  if (argv.length % 2 !== 0) throw new Error("Runtime flags require one value each");
  const allowed = new Set([
    "--request",
    "--approved-preview-digest",
    "--risk-acknowledgement-digest",
    "--approved-claude-identity"
  ]);
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !allowed.has(flag) || flags.has(flag)) {
      throw new Error("Runtime received an unknown, duplicate, or valueless flag");
    }
    flags.set(flag, value);
  }
  return flags;
}

function requiredFlag(flags: ReadonlyMap<string, string>, flag: string): string {
  const value = flags.get(flag);
  if (value === undefined || value.length === 0) throw new Error(`${flag} is required`);
  return value;
}

function digestFlag(flags: ReadonlyMap<string, string>, flag: string): string {
  const value = requiredFlag(flags, flag);
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${flag} must be a lowercase SHA-256 digest`);
  return value;
}

function identityFlag(flags: ReadonlyMap<string, string>, flag: string): SetupPublisherRuntimeIdentity {
  const encoded = requiredFlag(flags, flag);
  if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(encoded)) throw new Error(`${flag} must be bounded base64url`);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new Error(`${flag} must contain canonical JSON`);
  }
  if (!isRecord(value) || Object.keys(value).sort().join("\0") !== ["executablePath", "sha256", "version"].join("\0")) {
    throw new Error(`${flag} has an invalid executable identity`);
  }
  const identity = value as unknown as SetupPublisherRuntimeIdentity;
  assertClaudeExecutableIdentity(identity);
  if (Buffer.from(canonicalJson(identity), "utf8").toString("base64url") !== encoded) {
    throw new Error(`${flag} must contain canonical JSON`);
  }
  return identity;
}

function parseRequest(encoded: string): unknown {
  if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(encoded)) {
    throw new Error("Setup request must be bounded base64url");
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new Error("Setup request is not valid base64url JSON");
  }
}

export function validateRuntimeRequest(value: unknown): RuntimeRequest {
  if (!isRecord(value)) throw new Error("Setup request must be an object");
  const allowedKeys = new Set([
    "schemaVersion", "language", "platform", "observedAt", "claudeProbeConsent",
    "decisionIndexDigest", "routingIndexDigest", "goal", "domainIds"
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Setup request has an unknown field");
  }
  if (value.schemaVersion !== 2 || (value.language !== "ko" && value.language !== "en")
    || !isPlatform(value.platform) || !isStrictUtc(value.observedAt)
    || value.claudeProbeConsent !== "granted"
    || typeof value.decisionIndexDigest !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.decisionIndexDigest)
    || typeof value.routingIndexDigest !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.routingIndexDigest)) {
    throw new Error("Setup request has an invalid schema, language, platform, observedAt, or index binding");
  }
  const hasGoal = typeof value.goal === "string";
  const hasDomains = Array.isArray(value.domainIds);
  if (hasGoal === hasDomains) throw new Error("Setup request requires exactly one goal or domainIds selection");
  if (hasGoal) {
    const goal = value.goal as string;
    if (goal.length === 0 || goal.length > MAX_GOAL_LENGTH || /[\u0000-\u001f\u007f]/u.test(goal)) {
      throw new Error("Setup goal is empty, too long, or contains control characters");
    }
    return {
      schemaVersion: 2,
      language: value.language,
      platform: value.platform,
      observedAt: value.observedAt,
      claudeProbeConsent: "granted",
      decisionIndexDigest: value.decisionIndexDigest,
      routingIndexDigest: value.routingIndexDigest,
      goal
    };
  }
  const domainIds = value.domainIds as unknown[];
  if (domainIds.length < 1 || domainIds.length > 2
    || domainIds.some((domainId) => typeof domainId !== "string" || !isDomainId(domainId))
    || new Set(domainIds).size !== domainIds.length) {
    throw new Error("Setup request requires one or two unique Complete v1 domain IDs");
  }
  return {
    schemaVersion: 2,
    language: value.language,
    platform: value.platform,
    observedAt: value.observedAt,
    claudeProbeConsent: "granted",
    decisionIndexDigest: value.decisionIndexDigest,
    routingIndexDigest: value.routingIndexDigest,
    domainIds: domainIds as DomainId[]
  };
}

export function assertRuntimeRequestDecisionBoundary(
  request: RuntimeRequest,
  boundary: PluginDecisionBoundary
): void {
  if (request.decisionIndexDigest !== boundary.decisionIndex.digest) {
    throw new Error("Setup request decision index digest does not match the installed runtime boundary");
  }
  if (request.routingIndexDigest !== boundary.routingIndex.digest) {
    throw new Error("Setup request routing index digest does not match the installed runtime boundary");
  }
}

function setupFixture(
  request: RuntimeRequest,
  riskAcknowledged: boolean,
  claudeExecutableIdentity: SetupPublisherRuntimeIdentity
): SetupDecisionFixture {
  return {
    language: request.language,
    platform: request.platform,
    timeProbe: { consent: "granted", utcTimestamp: request.observedAt },
    claudeExecutableIdentity,
    riskAcknowledged,
    ...(request.goal === undefined ? { domainIds: request.domainIds } : { goal: request.goal })
  };
}

function approvedExecutionArgv(
  request: string,
  previewDigest: string,
  acknowledgementDigest: string,
  claudeExecutableIdentity: SetupPublisherRuntimeIdentity
): string[] {
  return [
    realpathSync(process.execPath),
    runtimePath,
    "execute",
    "--request",
    request,
    "--approved-preview-digest",
    previewDigest,
    "--risk-acknowledgement-digest",
    acknowledgementDigest,
    "--approved-claude-identity",
    Buffer.from(canonicalJson(claudeExecutableIdentity), "utf8").toString("base64url")
  ];
}

function approvalObjectArgv(
  request: string,
  previewDigest: string,
  claudeExecutableIdentity: SetupPublisherRuntimeIdentity
): string[] {
  return [
    realpathSync(process.execPath),
    runtimePath,
    "approval-object",
    "--request",
    request,
    "--approved-preview-digest",
    previewDigest,
    "--approved-claude-identity",
    Buffer.from(canonicalJson(claudeExecutableIdentity), "utf8").toString("base64url")
  ];
}

function riskAcknowledgementFor(previewDigest: string, disclosures: readonly string[]): RuntimeRiskAcknowledgement {
  const normalized = {
    schemaVersion: 1,
    previewDigest,
    statement: RISK_ACKNOWLEDGEMENT,
    disclosures: [...disclosures]
  };
  return {
    statement: RISK_ACKNOWLEDGEMENT,
    disclosures: [...disclosures],
    digest: sha256(canonicalJson(normalized))
  };
}

function serializablePlan(plan: Awaited<ReturnType<typeof evaluateSetupDecisionFixture>>): unknown {
  return {
    status: plan.status,
    holdReason: plan.holdReason,
    holdReasons: plan.holdReasons,
    decisionPlan: plan.decisionPlan,
    domainIds: plan.domainIds,
    candidates: plan.candidates,
    excludedCandidates: plan.excludedCandidates,
    commands: plan.commands,
    statePaths: plan.statePaths,
    approvalPreviewDigest: plan.approvalBinding.previewDigest,
    approvalValid: plan.approvalValid,
    requiresUnknownDisclosure: plan.requiresUnknownDisclosure,
    requiresRiskAcknowledgement: plan.requiresRiskAcknowledgement,
    requiresSeparateApproval: plan.requiresSeparateApproval,
    requiresDomainPrioritySelection: plan.requiresDomainPrioritySelection,
    executionStatus: plan.executionStatus,
    commandReceipts: plan.commandReceipts,
    installReceipts: plan.installReceipts,
    statePublications: plan.statePublications
  };
}

async function diagnoseSetupReconciliation(): Promise<unknown> {
  try {
    const lock = await readCanonicalSetupInstallLock();
    if (lock === undefined) return cleanSetupReconciliation();
    const parsed = await parseSetupInstallLock(lock.value, await loadInstalledDecisionIndexSet());
    const candidates = parsed.runs.flatMap((run) => run.statuses.flatMap((status) => {
      if (status.status !== "installed-but-unverified") return [];
      const candidate = run.approval.preview.candidates.find(
        ({ candidateId }) => candidateId === status.candidateId
      );
      if (candidate === undefined) return [];
      return [{
        candidateId: candidate.candidateId,
        pluginName: candidate.pluginName,
        marketplaceId: candidate.marketplaceId,
        scope: candidate.scope,
        installArgv: [...candidate.installArgv],
        status: "installed-but-unverified" as const
      }];
    }));
    if (candidates.length === 0) return cleanSetupReconciliation();
    return {
      status: "installed-but-unverified",
      possibleInstalledResidue: true,
      automaticRetryAllowed: false,
      automaticRemovalAllowed: false,
      candidates,
      manualReconciliation: {
        approvalRequired: true,
        observeArgv: ["claude", "plugin", "list", "--json"],
        nextSteps: [
          "Obtain separate current approval before running the exact read-only observeArgv.",
          "Compare each reported candidateId, marketplaceId, scope, and enabled state; do not retry installation automatically.",
          "If removal is desired, review supported removal syntax and obtain a separate exact approval; do not remove automatically."
        ]
      }
    };
  } catch {
    return {
      status: "unreadable",
      possibleInstalledResidue: true,
      automaticRetryAllowed: false,
      automaticRemovalAllowed: false,
      candidates: [],
      manualReconciliation: {
        approvalRequired: true,
        observeArgv: ["claude", "plugin", "list", "--json"],
        nextSteps: [
          "Keep setup and maintenance on hold and manually review the canonical setup state.",
          "Obtain separate current approval before any observation, retry, removal, or state repair."
        ]
      }
    };
  }
}

function cleanSetupReconciliation(): unknown {
  return {
    status: "clean",
    possibleInstalledResidue: false,
    automaticRetryAllowed: false,
    automaticRemovalAllowed: false,
    candidates: [],
    manualReconciliation: null
  };
}

function isExecutablePreview(plan: Awaited<ReturnType<typeof evaluateSetupDecisionFixture>>): boolean {
  const preview = plan.approvalBinding.preview;
  const common = preview.candidates.length >= 1
    && preview.candidates.length <= 2
    && (plan.status === "awaiting-risk-acknowledgement" || plan.status === "awaiting-approval");
  if (!common || plan.decisionPlan === null || plan.decisionPlan.selectionBasis !== preview.selectionBasis) return false;
  if (plan.decisionPlan.planKind === "complete") {
    return preview.broadCoverageComplete
      && !preview.coverageIncomplete
      && preview.smallestHonestProfile === null
      && preview.directCapabilityIds.length === 0
      && preview.inferredCapabilityIds.length === 0
      && preview.relatedCapabilityIds.length === 0
      && preview.uncoveredCapabilityIds.length === 0;
  }
  return plan.decisionPlan.planKind === "starter-partial"
    && preview.platform === "darwin"
    && preview.selectedDomainIds.length === 1
    && !preview.broadCoverageComplete
    && preview.coverageIncomplete;
}

function claudeExecutionDriver(identity: SetupPublisherRuntimeIdentity): SetupExecutionDriver {
  return {
    async executeCandidate(candidate) {
      return executeClaudeCandidate(candidate, identity);
    }
  };
}

async function executeClaudeCandidate(
  candidate: SetupPreviewCandidate,
  identity: SetupPublisherRuntimeIdentity
): Promise<SetupCandidateExecutionFixture> {
  const failedInstall = { argv: [...candidate.installArgv], status: "failure" as const };
  const fixture: SetupCandidateExecutionFixture = {
    marketplaceBeforeStdout: null,
    cliVersionBeforeStdout: null,
    installInvocation: failedInstall,
    pluginListAfterStdout: null,
    cliVersionAfterStdout: null,
    invocationTrace: []
  };
  assertLiteralInstallArgv(candidate);
  const invoke = async (args: readonly string[]): Promise<CommandObservation> => {
    const observation = await runApprovedClaude(identity, args);
    if (observation.invoked) {
      fixture.invocationTrace!.push({
        argv: ["claude", ...args],
        status: observation.success ? "success" : "failure"
      });
    }
    return observation;
  };

  const marketplace = await invoke(["plugin", "marketplace", "list", "--json"]);
  if (!marketplace.success) return fixture;
  fixture.marketplaceBeforeStdout = marketplace.stdout;
  try {
    const rows = parseClaudeMarketplaceList21198(marketplace.stdout);
    const matches = rows.filter((row) => row.id === candidate.marketplaceId);
    if (matches.length !== 1 || matches[0]!.source !== candidate.marketplaceSource) return fixture;
  } catch {
    return fixture;
  }

  const before = await invoke(["--version"]);
  if (!before.success) return fixture;
  fixture.cliVersionBeforeStdout = before.stdout;
  try {
    parseClaudeVersion21198(before.stdout);
  } catch {
    return fixture;
  }

  const install = await invoke(candidate.installArgv.slice(1));
  fixture.installInvocation = {
    argv: [...candidate.installArgv],
    status: install.success ? "success" : "failure"
  };
  if (!install.success) return fixture;

  const plugins = await invoke(["plugin", "list", "--json"]);
  if (!plugins.success) return fixture;
  fixture.pluginListAfterStdout = plugins.stdout;
  try {
    if (exactEnabledPluginVersion(parseClaudePluginList21198(plugins.stdout), candidate) === null) return fixture;
  } catch {
    return fixture;
  }

  const after = await invoke(["--version"]);
  if (!after.success) return fixture;
  fixture.cliVersionAfterStdout = after.stdout;
  try {
    parseClaudeVersion21198(after.stdout);
  } catch {
    return fixture;
  }
  return fixture;
}

function assertLiteralInstallArgv(candidate: SetupPreviewCandidate): void {
  const expected = [
    "claude",
    "plugin",
    "install",
    `${candidate.pluginName}@${candidate.marketplaceId}`,
    "--scope",
    "user"
  ];
  if (canonicalJson(candidate.installArgv) !== canonicalJson(expected)) {
    throw new Error("Setup candidate install argv is not the fixed approved literal command");
  }
}

async function runApprovedClaude(
  identity: SetupPublisherRuntimeIdentity,
  args: readonly string[]
): Promise<CommandObservation> {
  if (args.length < 1) throw new Error("Claude driver received an empty phase");
  let invoked = false;
  try {
    await verifyClaudeExecutableFileIdentity(identity);
    invoked = true;
    const { stdout } = await execFile(identity.executablePath, args, {
      env: process.env,
      shell: false,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf8"
    });
    await verifyClaudeExecutableFileIdentity(identity);
    if (args.length === 1 && args[0] === "--version"
      && parseClaudeVersion21198(stdout) !== identity.version) {
      return { success: false, stdout, invoked: true };
    }
    return { success: true, stdout, invoked: true };
  } catch {
    return { success: false, stdout: "", invoked };
  }
}

async function observeClaudeExecutableIdentityFromPath(): Promise<SetupPublisherRuntimeIdentity> {
  const pathValue = process.env.PATH;
  if (pathValue === undefined || pathValue.length === 0) throw new Error("Consented Claude probe found no PATH");
  for (const directory of pathValue.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, "claude");
    try {
      await access(candidate, fsConstants.X_OK);
      const before = await observeClaudeExecutableFile(candidate);
      const { stdout } = await execFile(before.executablePath, ["--version"], {
        env: process.env,
        shell: false,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8"
      });
      const version = parseClaudeVersion21198(stdout);
      const after = await observeClaudeExecutableFile(before.executablePath);
      if (before.executablePath !== after.executablePath || before.sha256 !== after.sha256) {
        throw new Error("Claude executable identity changed during consented probe");
      }
      return { executablePath: before.executablePath, version, sha256: before.sha256 };
    } catch (error) {
      if (isMissingExecutable(error)) continue;
      throw error;
    }
  }
  throw new Error("Consented Claude probe found no executable Claude CLI");
}

async function verifyClaudeExecutableFileIdentity(expected: SetupPublisherRuntimeIdentity): Promise<void> {
  assertClaudeExecutableIdentity(expected);
  try {
    const observed = await observeClaudeExecutableFile(expected.executablePath);
    if (observed.executablePath !== expected.executablePath || observed.sha256 !== expected.sha256) {
      throw new Error("mismatch");
    }
  } catch (error) {
    throw new Error("Claude executable identity changed after approval", { cause: error });
  }
}

async function observeClaudeExecutableFile(path: string): Promise<Pick<SetupPublisherRuntimeIdentity, "executablePath" | "sha256">> {
  const executablePath = resolve(await realpath(path));
  const metadata = await lstat(executablePath);
  if (!isAbsolute(executablePath) || resolve(executablePath) !== executablePath
    || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Claude executable path is not one canonical regular file");
  }
  return {
    executablePath,
    sha256: createHash("sha256").update(await readFile(executablePath)).digest("hex")
  };
}

function assertClaudeExecutableIdentity(value: SetupPublisherRuntimeIdentity): void {
  if (!isAbsolute(value.executablePath) || resolve(value.executablePath) !== value.executablePath
    || value.version !== CLAUDE_CODE_VERSION || !/^[0-9a-f]{64}$/u.test(value.sha256)) {
    throw new Error("Invalid approved Claude executable identity");
  }
}

function isMissingExecutable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "EACCES");
}

function encodeRequest(request: RuntimeRequest): string {
  return Buffer.from(canonicalJson(request), "utf8").toString("base64url");
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isDomainId(value: string): value is DomainId {
  return (COMPLETE_V1_DOMAIN_IDS as readonly string[]).includes(value);
}

function isPlatform(value: unknown): value is Platform {
  return value === "darwin" || value === "linux" || value === "win32";
}

function isStrictUtc(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPoint)) {
  try {
    const result = await runSkillsetManagerRuntime(process.argv.slice(2));
    process.stdout.write(canonicalJson(result));
    if (isRecord(result) && result.command === "execute" && result.status === "execution-failed") {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`skillset-manager runtime: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
