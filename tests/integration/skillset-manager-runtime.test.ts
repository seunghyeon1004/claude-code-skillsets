import { execFile as execFileCallback } from "node:child_process";
import { access, chmod, cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decisionIndexDigest,
  loadPluginDecisionBoundary,
  loadPluginDecisionIndex
} from "../../src/decision/index-loader.js";
import * as decisionIndexLoader from "../../src/decision/index-loader.js";
import { buildSetupReviewSummary, evaluateSetupDecisionFixture } from "../../src/evaluate/setup.js";
import { generateRoutingIndex } from "../../src/generate/routing-index.js";
import {
  assertRuntimeRequestDecisionBoundary,
  validateRuntimeRequest,
  type RuntimeRequest
} from "../../src/plugin-runtime/skillset-manager.js";
import { createApprovedOfficialDecisionIndexFixture } from "../helpers/official-marketplace-fixture.js";

const execFile = promisify(execFileCallback);
const projectRoot = process.cwd();
const sourcePluginRoot = join(projectRoot, "plugins", "skillset-manager");
const temporaryRoots: string[] = [];
const decisionBoundaryByRoot = new Map<string, ReturnType<typeof loadPluginDecisionBoundary>>();
let approvedDecisionIndexRaw: Promise<string> | undefined;

interface RuntimeResult {
  command: "preview" | "execute" | "doctor-state" | "approval-object";
  status: string;
  plan: {
    domainIds: string[];
    candidates: Array<{ id: string }>;
  };
  approval: {
    previewDigest: string;
    preview: {
      candidates: unknown[];
      commands: Array<{ kind: string; candidateId: string | null; argv: string[] }>;
      claudeExecutableIdentity: {
        executablePath: string;
        version: string;
        sha256: string;
      } | null;
    };
  };
  riskAcknowledgement: { digest: string; disclosures: string[] };
  reviewSummary?: string;
  discoveryCandidates?: Array<{
    candidateId: string;
    displayName?: string;
    sourceId: string;
    domainIds: string[];
    state: string;
    stateReasons: string[];
    evidenceSupport: Array<"direct" | "inferred" | "related">;
    installable: false;
  }>;
  approvalObjectAccess?: { argv: string[] };
  approvedExecution?: { argv: string[] };
  execution?: {
    executionStatus: "executed" | "failed" | "already-executed";
    commandReceipts: Array<{
      status: string;
      invocationTrace: Array<{ argv: string[]; status: string }>;
    }>;
    installReceipts: unknown[];
  };
  executionLock?: {
    status: "absent" | "regular-stale" | "symlink-or-nonregular";
    path: string;
    relativePath: string;
    setupHold: boolean;
    maintenanceHold: boolean;
    automaticRemovalAllowed: boolean;
    requiresManualReview: boolean;
  };
  setupReconciliation?: {
    status: "clean" | "installed-but-unverified" | "unreadable";
    possibleInstalledResidue: boolean;
    automaticRetryAllowed: boolean;
    automaticRemovalAllowed: boolean;
    candidates: Array<{
      candidateId: string;
      pluginName: string;
      marketplaceId: string;
      scope: string;
      installArgv: string[];
      status: string;
    }>;
    manualReconciliation: {
      approvalRequired: boolean;
      observeArgv: string[];
      nextSteps: string[];
    } | null;
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  decisionBoundaryByRoot.clear();
  approvedDecisionIndexRaw = undefined;
});

describe("installed skillset-manager runtime", () => {
  it("requires a schema-v2 request bound to both installed routing and decision digests", async () => {
    const pluginRoot = await copyPlugin();
    const boundary = await loadPluginDecisionBoundary(pluginRoot);
    const valid: RuntimeRequest = {
      schemaVersion: 2,
      language: "en",
      platform: "darwin",
      observedAt: boundary.decisionIndex.observedThrough,
      claudeProbeConsent: "granted",
      domainIds: [boundary.decisionIndex.profiles[0]!.domainId],
      decisionIndexDigest: boundary.decisionIndex.digest,
      routingIndexDigest: boundary.routingIndex.digest
    };

    expect(validateRuntimeRequest(valid)).toEqual(valid);
    expect(() => validateRuntimeRequest({ ...valid, schemaVersion: 1 })).toThrow(/schema|binding/i);
    expect(() => validateRuntimeRequest({
      ...valid,
      decisionIndexDigest: undefined
    })).toThrow(/schema|binding|digest/i);
    expect(() => assertRuntimeRequestDecisionBoundary({
      ...valid,
      routingIndexDigest: "a".repeat(64)
    }, boundary)).toThrow(/routing.*digest|binding/i);
    expect(() => assertRuntimeRequestDecisionBoundary({
      ...valid,
      decisionIndexDigest: "b".repeat(64)
    }, boundary)).toThrow(/decision.*digest|binding/i);
  });

  it("exposes both authenticated catalog digests in the bounded runtime review summary", async () => {
    const pluginRoot = await copyPlugin();
    const boundary = await loadPluginDecisionBoundary(pluginRoot);
    const plan = await evaluateSetupDecisionFixture(boundary.decisionIndex, {
      language: "en",
      platform: "darwin",
      domainIds: [boundary.decisionIndex.profiles[0]!.domainId],
      timeProbe: { consent: "pending" }
    });

    const summary = buildSetupReviewSummary(plan.approvalBinding, boundary.routingIndex.digest);
    expect(summary).toContain(`decisionIndexDigest: ${boundary.decisionIndex.digest}`);
    expect(summary).toContain(`routingIndexDigest: ${boundary.routingIndex.digest}`);
  });

  it("diagnoses the anchored execution lock without deleting or trusting PID state", async () => {
    const pluginRoot = await copyPlugin();
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const absentHome = await temporaryDirectory("skillset-runtime-doctor-absent-");
    await expect(runRuntime(runtimePath, ["doctor-state"], {
      ...process.env,
      HOME: absentHome
    })).resolves.toMatchObject({
      command: "doctor-state",
      executionLock: {
        status: "absent",
        relativePath: "state/setup-execution.lock",
        setupHold: false,
        maintenanceHold: false,
        automaticRemovalAllowed: false,
        requiresManualReview: false
      }
    });

    const staleHome = await temporaryDirectory("skillset-runtime-doctor-stale-");
    const staleState = join(staleHome, ".claude", "claude-code-skillsets", "state");
    await mkdir(staleState, { recursive: true });
    await writeFile(executionLockPath(staleHome), '{"pid":999999}\n', "utf8");
    const stale = await runRuntime(runtimePath, ["doctor-state"], {
      ...process.env,
      HOME: staleHome
    });
    expect(stale).toMatchObject({
      executionLock: {
        status: "regular-stale",
        path: executionLockPath(staleHome),
        setupHold: true,
        maintenanceHold: true,
        automaticRemovalAllowed: false,
        requiresManualReview: true
      }
    });
    await expect(readFile(executionLockPath(staleHome), "utf8")).resolves.toBe('{"pid":999999}\n');

    const unsafeHome = await temporaryDirectory("skillset-runtime-doctor-unsafe-");
    const unsafeState = join(unsafeHome, ".claude", "claude-code-skillsets", "state");
    const outside = join(unsafeHome, "outside-lock");
    await mkdir(unsafeState, { recursive: true });
    await writeFile(outside, "outside\n", "utf8");
    await symlink(outside, executionLockPath(unsafeHome));
    await expect(runRuntime(runtimePath, ["doctor-state"], {
      ...process.env,
      HOME: unsafeHome
    })).resolves.toMatchObject({
      executionLock: {
        status: "symlink-or-nonregular",
        setupHold: true,
        maintenanceHold: true,
        automaticRemovalAllowed: false,
        requiresManualReview: true
      }
    });
    await expect(readFile(outside, "utf8")).resolves.toBe("outside\n");
  });

  it("ships a deterministic bundle and rejects an unapproved execute", async () => {
    await execFile("npm", ["run", "check:manager-runtime"], { cwd: projectRoot });
    const pluginRoot = await copyPlugin();
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const bundle = await readFile(runtimePath, "utf8");
    expect(bundle.length).toBeGreaterThan(1_000);
    expect(bundle).not.toMatch(/src\/decision\/repository|src\/contracts\/complete-v1|schemas\/v2/u);
    expect(bundle).not.toMatch(/Usage: npm run eval:sanitize|sanitizeReceiptTree|verifySanitizedReceiptTree/u);

    const route = await executableRoute(runtimePath, pluginRoot);
    await expect(runRuntime(runtimePath, ["execute", "--request", route.request], route.env))
      .rejects.toThrow(/requires exactly request, preview digest, risk acknowledgement, and approved Claude identity/i);
  });

  it("binds a consented Claude executable identity into preview, approval, and absolute execution", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-claude-identity-");
    const approvedBin = join(home, "approved-bin");
    const replacementBin = join(home, "replacement-bin");
    await Promise.all([mkdir(approvedBin), mkdir(replacementBin)]);
    const approvedClaude = join(approvedBin, "claude");
    const replacementClaude = join(replacementBin, "claude");
    const approvedMarker = join(home, "approved-marker.txt");
    const replacementMarker = join(home, "replacement-marker.txt");
    await writeFakeClaude(approvedClaude);
    await writeFakeClaude(replacementClaude);
    await writeFile(replacementClaude, "#!/bin/sh\nexit 88\n", "utf8");
    await chmod(replacementClaude, 0o755);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const index = await decisionIndex(pluginRoot);
    const request = await requestArgument(pluginRoot, {
      schemaVersion: 1,
      language: "en",
      platform: "darwin",
      observedAt: index.observedThrough,
      domainIds: ["research-and-intelligence"]
    });
    const previewEnv = {
      ...process.env,
      HOME: home,
      PATH: `${approvedBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: approvedMarker
    };
    const preview = await withApprovalObject(
      runtimePath,
      await runRuntime(runtimePath, ["preview", "--request", request], previewEnv),
      previewEnv
    );
    expect(preview.approval.preview.claudeExecutableIdentity).toMatchObject({
      executablePath: await realpath(approvedClaude),
      version: "2.1.198",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
    expect(preview.riskAcknowledgement.disclosures).toContain("claude-executable:local-binary-trust-required");

    const candidate = preview.approval.preview.candidates[0] as {
      pluginName: string;
      marketplaceId: string;
    };
    await expect(runRuntime(runtimePath, preview.approvedExecution!.argv.slice(2), {
      ...previewEnv,
      PATH: `${replacementBin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_PLUGIN_ID: `${candidate.pluginName}@${candidate.marketplaceId}`,
      FAKE_CLAUDE_MARKER: approvedMarker,
      REPLACEMENT_CLAUDE_MARKER: replacementMarker
    })).resolves.toMatchObject({ status: "executed" });
    expect(await readFile(approvedMarker, "utf8")).toMatch(/plugin marketplace list --json/);
    await expect(access(replacementMarker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails before an install phase when the approved Claude executable bytes change", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-claude-mutation-");
    const bin = join(home, "bin");
    await mkdir(bin);
    const claudePath = join(bin, "claude");
    const marker = join(home, "claude-marker.txt");
    await writeFakeClaude(claudePath);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const route = await routeForDomain(runtimePath, pluginRoot, "research-and-intelligence", {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker
    });
    await writeFile(claudePath, `${await readFile(claudePath, "utf8")}\n# changed after approval\n`, "utf8");
    await chmod(claudePath, 0o755);

    await expect(runFailedRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker
    })).resolves.toMatchObject({ status: "execution-failed" });
    expect((await readFile(marker, "utf8")).trim().split("\n")).toEqual(["--version"]);
  });

  it("fails approval-object closed when the approved Claude executable bytes change", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-approval-object-mutation-");
    const bin = join(home, "bin");
    await mkdir(bin);
    const claudePath = join(bin, "claude");
    const marker = join(home, "claude-marker.txt");
    await writeFakeClaude(claudePath);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const index = await decisionIndex(pluginRoot);
    const request = await requestArgument(pluginRoot, {
      schemaVersion: 1,
      language: "en",
      platform: "darwin",
      observedAt: index.observedThrough,
      domainIds: ["software-engineering"]
    });
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker
    };
    const preview = await runRuntime(runtimePath, ["preview", "--request", request], env);
    expect(preview.approvalObjectAccess).toMatchObject({ argv: expect.any(Array) });
    await writeFile(claudePath, `${await readFile(claudePath, "utf8")}\n# replaced after preview\n`, "utf8");
    await chmod(claudePath, 0o755);

    await expect(runRuntime(runtimePath, preview.approvalObjectAccess!.argv.slice(2), env))
      .rejects.toThrow(/Claude executable identity changed after approval/i);
    expect((await readFile(marker, "utf8")).trim().split("\n")).toEqual(["--version"]);
  });

  it("matches the root evaluator for every Complete v1 profile", async () => {
    const pluginRoot = await copyPlugin();
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const index = await loadPluginDecisionIndex(pluginRoot);
    vi.spyOn(decisionIndexLoader, "isAuthenticatedDecisionIndex")
      .mockImplementation((value) => value === index);
    const env = await fakeClaudeEnvironment();
    const referenceRoute = await routeForDomain(runtimePath, pluginRoot, "software-engineering", env);
    const claudeExecutableIdentity = referenceRoute.preview.approval.preview.claudeExecutableIdentity;
    if (claudeExecutableIdentity === null) throw new Error("Executable reference route omitted Claude identity");

    for (const { domainId } of index.profiles) {
      const input = {
        language: "en" as const,
        platform: "darwin" as const,
        domainIds: [domainId],
        timeProbe: { consent: "granted" as const, utcTimestamp: index.observedThrough }
      };
      const bundledPreview = await runRuntime(runtimePath, ["preview", "--request", await requestArgument(pluginRoot, {
        schemaVersion: 1,
        language: input.language,
        platform: input.platform,
        observedAt: index.observedThrough,
        domainIds: input.domainIds
      })], env);
      const rootPlan = await evaluateSetupDecisionFixture(index, {
        ...input,
        claudeExecutableIdentity
      });

      expect({
        status: bundledPreview.status,
        previewDigest: bundledPreview.approval.previewDigest
      }).toEqual({
        status: rootPlan.status,
        previewDigest: rootPlan.approvalBinding.previewDigest
      });

      if (bundledPreview.approvalObjectAccess === undefined) {
        expect(rootPlan.candidates).toEqual([]);
        expect(bundledPreview).not.toHaveProperty("plan");
        expect(bundledPreview.approvedExecution).toBeUndefined();
        continue;
      }

      const bundledPlan = await withApprovalObject(runtimePath, bundledPreview, env);
      expect({
        domainIds: bundledPlan.plan.domainIds,
        candidateIds: bundledPlan.plan.candidates.map(({ id }) => id)
      }).toEqual({
        domainIds: rootPlan.domainIds,
        candidateIds: rootPlan.candidates.map(({ id }) => id)
      });
    }
  }, 30_000);

  it("keeps a two-domain genuine complete plan executable through the installed runtime", async () => {
    const pluginRoot = await copyPlugin();
    const index = await writeTwoDomainCompleteIndex(pluginRoot);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const env = await fakeClaudeEnvironment();
    const result = await runRuntime(runtimePath, ["preview", "--request", await requestArgument(pluginRoot, {
      schemaVersion: 1,
      language: "en",
      platform: "darwin",
      observedAt: index.observedThrough,
      domainIds: ["research-and-intelligence", "software-engineering"]
    })], env);

    expect(result).toMatchObject({
      status: "awaiting-risk-acknowledgement",
      approvedExecution: { argv: expect.any(Array) }
    });
    expect(result).not.toHaveProperty("plan");
    expect(result.approval).toEqual({ previewDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.approvalObjectAccess).toMatchObject({ argv: expect.any(Array) });
    expect(typeof result.reviewSummary).toBe("string");
    expect(Buffer.byteLength(result.reviewSummary!, "utf8")).toBeLessThanOrEqual(5 * 1024);
    expect(result.reviewSummary!.split("\n").length).toBeLessThanOrEqual(120);
    expect(result.reviewSummary).not.toContain("statePublisher");
    expect(result.reviewSummary).toContain("nodeStateWriter");
    for (const required of [
      "approvalPreviewDigest", "catalogExpiresAt", "candidates", "sources",
      "externalCommands", "evidenceLevels", "unknowns", "uncoveredCapabilities",
      "executableIdentities", "statePaths"
    ]) {
      expect(result.reviewSummary).toContain(required);
    }
    const serializedDefault = JSON.stringify(result);
    expect(Buffer.byteLength(`${JSON.stringify(result, null, 2)}\n`, "utf8"))
      .toBeLessThanOrEqual(8 * 1024);
    expect(serializedDefault).not.toContain('"approvalBinding"');
    expect(serializedDefault).not.toContain("statePublisher");
    const approvalObject = await runRuntime(
      runtimePath,
      result.approvalObjectAccess!.argv.slice(2),
      env
    );
    expect(approvalObject).toMatchObject({
      command: "approval-object",
      plan: {
        domainIds: ["research-and-intelligence", "software-engineering"],
        approvalPreviewDigest: result.approval.previewDigest
      },
      approval: {
        previewDigest: result.approval.previewDigest,
        preview: {
          candidates: [{ candidateId: "exa" }, { candidateId: "feature-dev" }],
          statePublisher: {
            runtimeIdentity: {
              executablePath: expect.any(String),
              version: expect.any(String),
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
            }
          }
        }
      }
    });
  });

  it("keeps the actual two-candidate software preview within the total default output bound", async () => {
    const pluginRoot = await copyPlugin();
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const env = await fakeClaudeEnvironment();
    const index = await decisionIndex(pluginRoot);
    const request = await requestArgument(pluginRoot, {
      schemaVersion: 1,
      language: "en",
      platform: "darwin",
      observedAt: index.observedThrough,
      domainIds: ["software-engineering"]
    });
    const result = await runRuntime(runtimePath, ["preview", "--request", request], env);

    expect(result.approval.preview).toBeUndefined();
    expect(result).not.toHaveProperty("plan");
    expect(result.approvalObjectAccess).toMatchObject({ argv: expect.any(Array) });
    expect(result.approvedExecution).toMatchObject({ argv: expect.any(Array) });
    expect(result.reviewSummary).toContain("feature-dev");
    expect(result.reviewSummary).toContain("superpowers");
    expect(Buffer.byteLength(`${JSON.stringify(result, null, 2)}\n`, "utf8"))
      .toBeLessThanOrEqual(8 * 1024);
  });

  it("previews from a plugin-only copy and executes exact Claude phases into a durable receipt", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-home-");
    const bin = join(home, "bin");
    await mkdir(bin);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const marker = join(home, "claude-invocations.txt");
    await writeFakeClaude(join(bin, "claude"));
    const previewEnv = {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker
    };
    const route = await executableRoute(runtimePath, pluginRoot, previewEnv);
    const candidate = route.preview.approval.preview.candidates[0] as {
      pluginName: string;
      marketplaceId: string;
      installArgv: string[];
    };
    const env = {
      ...previewEnv,
      FAKE_PLUGIN_ID: `${candidate.pluginName}@${candidate.marketplaceId}`,
    };
    await rm(marker, { force: true });

    const executed = await runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env);
    expect(executed).toMatchObject({
      command: "execute",
      status: "executed",
      execution: { executionStatus: "executed" }
    });
    expect(executed).not.toHaveProperty("plan");
    expect(executed).not.toHaveProperty("reviewSummary");
    expect(executed).not.toHaveProperty("riskAcknowledgement");
    const lock = JSON.parse(await readFile(
      join(home, ".claude", "claude-code-skillsets", "state", "install-lock.json"),
      "utf8"
    )) as Record<string, unknown>;
    expect(lock).toMatchObject({
      schemaVersion: 2,
      runs: [{
        approval: { previewDigest: route.preview.approval.previewDigest },
        statuses: [{ candidateId: candidate.pluginName, status: "success" }],
        managedInstallReceipts: [{
          pluginName: candidate.pluginName,
          marketplaceId: candidate.marketplaceId,
          scope: "user",
          postInstallVersion: null,
          versionStatus: "unknown"
        }]
      }]
    });
    expect((await readFile(marker, "utf8")).trim().split("\n")).toEqual([
      "plugin marketplace list --json",
      "--version",
      candidate.installArgv.slice(1).join(" "),
      "plugin list --json",
      "--version"
    ]);
    const approvedSemanticTrace = route.preview.approval.preview.commands
      .filter((command: { kind: string }) => command.kind !== "time-probe")
      .map((command: { argv: string[] }) => command.argv);
    expect(executed.execution?.commandReceipts[0]?.invocationTrace)
      .toHaveLength(approvedSemanticTrace.length);
    expect(executed.execution?.commandReceipts[0]?.invocationTrace.map(({ argv }) => argv))
      .toEqual(approvedSemanticTrace);
    const invocationCount = (await readFile(marker, "utf8")).trim().split("\n").length;
    await expect(runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env))
      .resolves.toMatchObject({
        command: "execute",
        status: "already-executed",
        execution: { executionStatus: "already-executed" }
      });
    expect((await readFile(marker, "utf8")).trim().split("\n")).toHaveLength(invocationCount);
  });

  it("persists install success followed by verification failure for read-only doctor reconciliation", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-unverified-home-");
    const bin = join(home, "bin");
    await mkdir(bin);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const marker = join(home, "claude-invocations.txt");
    await writeFakeClaude(join(bin, "claude"));
    const previewEnv = {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker
    };
    const route = await executableRoute(runtimePath, pluginRoot, previewEnv);
    const candidate = route.preview.approval.preview.candidates[0] as {
      candidateId: string;
      pluginName: string;
      marketplaceId: string;
      installArgv: string[];
    };
    await rm(marker, { force: true });

    const failed = await runFailedRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), {
      ...previewEnv,
      FAKE_PLUGIN_LIST_EXIT: "70"
    });
    expect(failed).toMatchObject({
      status: "execution-failed",
      execution: {
        executionStatus: "failed",
        commandReceipts: [{
          status: "installed-but-unverified",
          invocationTrace: [
            { argv: ["claude", "plugin", "marketplace", "list", "--json"], status: "success" },
            { argv: ["claude", "--version"], status: "success" },
            { argv: candidate.installArgv, status: "success" },
            { argv: ["claude", "plugin", "list", "--json"], status: "failure" }
          ]
        }],
        installReceipts: []
      }
    });
    const lock = JSON.parse(await readFile(lockPath(home), "utf8")) as {
      runs: Array<{
        statuses: Array<{ candidateId: string; status: string }>;
        managedInstallReceipts: unknown[];
      }>;
    };
    expect(lock.runs[0]).toMatchObject({
      statuses: [{ candidateId: candidate.candidateId, status: "installed-but-unverified" }],
      managedInstallReceipts: []
    });

    const diagnosis = await runRuntime(runtimePath, ["doctor-state"], {
      ...previewEnv,
      FAKE_PLUGIN_LIST_EXIT: undefined
    });
    expect(diagnosis.setupReconciliation).toEqual({
      status: "installed-but-unverified",
      possibleInstalledResidue: true,
      automaticRetryAllowed: false,
      automaticRemovalAllowed: false,
      candidates: [{
        candidateId: candidate.candidateId,
        pluginName: candidate.pluginName,
        marketplaceId: candidate.marketplaceId,
        scope: "user",
        installArgv: candidate.installArgv,
        status: "installed-but-unverified"
      }],
      manualReconciliation: {
        approvalRequired: true,
        observeArgv: ["claude", "plugin", "list", "--json"],
        nextSteps: expect.arrayContaining([
          expect.stringMatching(/separate.*approval/i),
          expect.stringMatching(/do not.*retry|never.*retry/i),
          expect.stringMatching(/do not.*remove|never.*remove/i)
        ])
      }
    });
    expect((await readFile(marker, "utf8")).trim().split("\n")).toEqual([
      "plugin marketplace list --json",
      "--version",
      candidate.installArgv.slice(1).join(" "),
      "plugin list --json"
    ]);
    await expect(runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), previewEnv))
      .rejects.toThrow(/partial|failed|installed-but-unverified|reconciliation/i);
    expect((await readFile(marker, "utf8")).trim().split("\n")).toHaveLength(4);
  });

  it("appends a non-overlapping second setup run while preserving the first run and replays without Claude", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-cumulative-home-");
    const bin = join(home, "bin");
    await mkdir(bin);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const marker = join(home, "claude-invocations.txt");
    const installed = join(home, "fake-installed-plugin.txt");
    await writeFakeClaude(join(bin, "claude"));
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker,
      FAKE_INSTALLED_PLUGIN: installed
    };
    const first = await routeForDomain(runtimePath, pluginRoot, "research-and-intelligence", env);
    const second = await routeForDomain(runtimePath, pluginRoot, "software-engineering", env);
    await rm(marker, { force: true });

    await runRuntime(runtimePath, first.preview.approvedExecution!.argv.slice(2), env);
    const firstLock = JSON.parse(await readFile(lockPath(home), "utf8")) as {
      runs: Array<Record<string, unknown>>;
    };
    const firstRun = structuredClone(firstLock.runs[0]);
    await writeFile(lockPath(home), `${JSON.stringify({
      schemaVersion: 1,
      ...firstRun
    }, null, 2)}\n`, "utf8");

    await runRuntime(runtimePath, second.preview.approvedExecution!.argv.slice(2), env);
    const secondLock = JSON.parse(await readFile(lockPath(home), "utf8")) as {
      schemaVersion: number;
      runs: Array<{
        approval: { previewDigest: string };
        statuses: Array<{ status: string }>;
        managedInstallReceipts: Array<{ pluginName: string }>;
      }>;
    };
    expect(secondLock.schemaVersion).toBe(2);
    expect(secondLock.runs).toHaveLength(2);
    expect(secondLock.runs[0]).toEqual(firstRun);
    expect(secondLock.runs[1]).toMatchObject({
      approval: { previewDigest: second.preview.approval.previewDigest }
    });
    expect(secondLock.runs[1]!.statuses.every(({ status }) => status === "success")).toBe(true);
    expect(secondLock.runs[0]!.managedInstallReceipts[0]!.pluginName).toBe(
      (first.preview.approval.preview.candidates[0] as { pluginName: string }).pluginName
    );

    const invocationCount = (await readFile(marker, "utf8")).trim().split("\n").length;
    await expect(runRuntime(runtimePath, second.preview.approvedExecution!.argv.slice(2), env))
      .resolves.toMatchObject({ status: "already-executed" });
    expect((await readFile(marker, "utf8")).trim().split("\n")).toHaveLength(invocationCount);
  });

  it("allows exactly one concurrent runtime process to enter the Claude driver", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-concurrent-home-");
    const bin = join(home, "bin");
    await mkdir(bin);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const marker = join(home, "claude-invocations.txt");
    await writeFakeClaude(join(bin, "claude"));
    const previewEnv = {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker,
      FAKE_CLAUDE_DELAY: "0.2"
    };
    const route = await routeForDomain(runtimePath, pluginRoot, "research-and-intelligence", previewEnv);
    const candidate = route.preview.approval.preview.candidates[0] as {
      pluginName: string;
      marketplaceId: string;
    };
    const env = {
      ...previewEnv,
      FAKE_PLUGIN_ID: `${candidate.pluginName}@${candidate.marketplaceId}`
    };
    await rm(marker, { force: true });

    const outcomes = await Promise.allSettled([
      runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env),
      runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env)
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringMatching(/execution lock.*doctor/i) })
    });
    expect((await readFile(marker, "utf8")).trim().split("\n")).toHaveLength(5);
    await expect(access(executionLockPath(home))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on a stale execution lock and preserves it for doctor review", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-stale-lock-home-");
    const bin = join(home, "bin");
    const state = join(home, ".claude", "claude-code-skillsets", "state");
    await Promise.all([mkdir(bin, { recursive: true }), mkdir(state, { recursive: true })]);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const marker = join(home, "claude-invocations.txt");
    await writeFakeClaude(join(bin, "claude"));
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker
    };
    const route = await routeForDomain(runtimePath, pluginRoot, "research-and-intelligence", env);
    await rm(marker, { force: true });
    await writeFile(executionLockPath(home), "stale-lock\n", "utf8");

    await expect(runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env))
      .rejects.toThrow(/execution lock.*doctor/i);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(executionLockPath(home), "utf8")).resolves.toBe("stale-lock\n");
  });

  it("holds malformed, partial, and globally duplicate prior runs before invoking Claude", async () => {
    const pluginRoot = await copyPlugin();
    const home = await temporaryDirectory("skillset-runtime-invalid-state-home-");
    const bin = join(home, "bin");
    await mkdir(bin);
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const marker = join(home, "claude-invocations.txt");
    const installed = join(home, "fake-installed-plugin.txt");
    await writeFakeClaude(join(bin, "claude"));
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      FAKE_CLAUDE_MARKER: marker,
      FAKE_INSTALLED_PLUGIN: installed
    };
    const route = await routeForDomain(runtimePath, pluginRoot, "research-and-intelligence", env);
    await rm(marker, { force: true });
    await runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env);
    const original = JSON.parse(await readFile(lockPath(home), "utf8")) as {
      runs: Array<{
        statuses: Array<{ candidateId: string; status: string }>;
        managedInstallReceipts: unknown[];
      }>;
    };
    const attempts: unknown[] = [
      { schemaVersion: 2, runs: "not-an-array" },
      {
        schemaVersion: 2,
        runs: [{
          ...original.runs[0],
          statuses: original.runs[0]!.statuses.map((status) => ({ ...status, status: "failure" }))
        }]
      },
      { schemaVersion: 2, runs: [original.runs[0], structuredClone(original.runs[0])] },
      {
        schemaVersion: 1,
        ...original.runs[0],
        managedInstallReceipts: [
          ...original.runs[0]!.managedInstallReceipts,
          ...original.runs[0]!.managedInstallReceipts
        ]
      }
    ];
    const invocationCount = (await readFile(marker, "utf8")).trim().split("\n").length;

    for (const state of attempts) {
      await writeFile(lockPath(home), `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await expect(runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env))
        .rejects.toThrow(/install lock|setup run|duplicate|partial|canonical/i);
      expect((await readFile(marker, "utf8")).trim().split("\n")).toHaveLength(invocationCount);
    }

    await writeFile(lockPath(home), JSON.stringify(original), "utf8");
    await expect(runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env))
      .rejects.toThrow(/canonical JSON/i);
    expect((await readFile(marker, "utf8")).trim().split("\n")).toHaveLength(invocationCount);

    const outside = join(home, "outside-lock.json");
    await writeFile(outside, "outside-victim\n", "utf8");
    await rm(lockPath(home));
    await symlink(outside, lockPath(home));
    await expect(runRuntime(runtimePath, route.preview.approvedExecution!.argv.slice(2), env))
      .rejects.toThrow(/regular file|symbolic link/i);
    expect(await readFile(outside, "utf8")).toBe("outside-victim\n");
    expect((await readFile(marker, "utf8")).trim().split("\n")).toHaveLength(invocationCount);
  });

  it("rejects preview, acknowledgement, and held-route mismatches before invoking Claude", async () => {
    const pluginRoot = await copyPlugin();
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const route = await executableRoute(runtimePath, pluginRoot);
    const executableArgs = route.preview.approvedExecution!.argv.slice(2);

    await expect(runRuntime(runtimePath, replaceFlag(executableArgs, "--approved-preview-digest", "0".repeat(64)), route.env))
      .rejects.toThrow(/preview digest mismatch/i);
    await expect(runRuntime(runtimePath, replaceFlag(executableArgs, "--risk-acknowledgement-digest", "0".repeat(64)), route.env))
      .rejects.toThrow(/acknowledgement digest mismatch/i);

    const held = await heldRoute(runtimePath, pluginRoot, route.env);
    const approvedClaudeIdentity = flagValue(executableArgs, "--approved-claude-identity")!;
    await expect(runRuntime(runtimePath, [
      "execute",
      "--request",
      held.request,
      "--approved-preview-digest",
      held.preview.approval.previewDigest,
      "--risk-acknowledgement-digest",
      held.preview.riskAcknowledgement.digest,
      "--approved-claude-identity",
      approvedClaudeIdentity
    ], route.env)).rejects.toThrow(/not executable|held/i);
  });

  it("holds a related-only route without emitting approvedExecution", async () => {
    const pluginRoot = await copyPlugin();
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const env = await fakeClaudeEnvironment();
    const index = await decisionIndex(pluginRoot);
    const request = await requestArgument(pluginRoot, {
      schemaVersion: 1,
      language: "en",
      platform: "darwin",
      observedAt: index.observedThrough,
      domainIds: ["commerce"]
    });

    const preview = await runRuntime(runtimePath, ["preview", "--request", request], env);

    expect(preview).toMatchObject({
      command: "preview",
      status: "held"
    });
    expect(preview).not.toHaveProperty("plan");
    expect(preview.approvedExecution).toBeUndefined();
    expect(preview.approvalObjectAccess).toBeUndefined();
  });

  it("shows current held route candidates as non-installable discovery without approval authority", async () => {
    const pluginRoot = await copyCurrentPlugin();
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const env = await fakeClaudeEnvironment();
    const index = await decisionIndex(pluginRoot);

    for (const [domainId, candidateId] of [
      ["video-and-audio", "runway-api"],
      ["marketing-and-growth", "windsor-ai"]
    ] as const) {
      const preview = await runRuntime(runtimePath, ["preview", "--request", await requestArgument(pluginRoot, {
        schemaVersion: 1,
        language: "en",
        platform: "darwin",
        observedAt: index.observedThrough,
        domainIds: [domainId]
      })], env);

      expect(preview.discoveryCandidates).toEqual([
        expect.objectContaining({
          candidateId,
          sourceId: "anthropic-plugins-official",
          domainIds: [domainId],
          state: "held",
          evidenceSupport: ["related"],
          installable: false
        })
      ]);
      expect(preview.discoveryCandidates?.[0]?.stateReasons).toContain("individual-safety-review:not-complete");
      expect(preview.reviewSummary).toContain("discovery-only; not approval-bound; installable:false");
      expect(preview.reviewSummary).toContain(candidateId);
      expect(preview.approvedExecution).toBeUndefined();
      expect(preview.approvalObjectAccess).toBeUndefined();
    }
  });

  it("keeps a current zero-route domain discovery-empty while preserving capability gaps", async () => {
    const pluginRoot = await copyCurrentPlugin();
    const runtimePath = join(pluginRoot, "runtime.mjs");
    const env = await fakeClaudeEnvironment();
    const index = await decisionIndex(pluginRoot);
    const preview = await runRuntime(runtimePath, ["preview", "--request", await requestArgument(pluginRoot, {
      schemaVersion: 1,
      language: "en",
      platform: "darwin",
      observedAt: index.observedThrough,
      domainIds: ["software-engineering"]
    })], env);

    expect(preview.discoveryCandidates).toEqual([]);
    expect(preview.reviewSummary).toContain("discoveryCandidates: []");
    expect(preview.reviewSummary).toContain("uncoveredCapabilities:");
    expect(preview.reviewSummary).toContain("analyze-repository-context");
    expect(preview.approvedExecution).toBeUndefined();
  });
});

async function copyPlugin(): Promise<string> {
  const root = await temporaryDirectory("skillset-plugin-copy-");
  const pluginRoot = join(root, "skillset-manager");
  await cp(sourcePluginRoot, pluginRoot, { recursive: true });
  const decisionRaw = await eligibleDecisionIndexRaw();
  await Promise.all([
    writeFile(join(pluginRoot, "data", "decision-index.json"), decisionRaw, "utf8"),
    writeFile(join(pluginRoot, "data", "routing-index.json"), generateRoutingIndex(JSON.parse(decisionRaw)), "utf8")
  ]);
  return pluginRoot;
}

async function copyCurrentPlugin(): Promise<string> {
  const root = await temporaryDirectory("skillset-current-plugin-copy-");
  const pluginRoot = join(root, "skillset-manager");
  await cp(sourcePluginRoot, pluginRoot, { recursive: true });
  return pluginRoot;
}

async function eligibleDecisionIndexRaw(): Promise<string> {
  approvedDecisionIndexRaw ??= createApprovedOfficialDecisionIndexFixture(projectRoot).then(({ root, raw }) => {
    temporaryRoots.push(root);
    return raw;
  });
  return approvedDecisionIndexRaw;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  temporaryRoots.push(root);
  return root;
}

async function decisionIndex(pluginRoot: string): Promise<{
  observedThrough: string;
  profiles: Array<{ domainId: string }>;
}> {
  return JSON.parse(await readFile(join(pluginRoot, "data", "decision-index.json"), "utf8")) as {
    observedThrough: string;
    profiles: Array<{ domainId: string }>;
  };
}

async function executableRoute(
  runtimePath: string,
  pluginRoot: string,
  env?: NodeJS.ProcessEnv
): Promise<{
  request: string;
  preview: RuntimeResult & { approval: { previewDigest: string; preview: { candidates: unknown[] } } };
  env: NodeJS.ProcessEnv;
}> {
  const runtimeEnv = env ?? await fakeClaudeEnvironment();
  const index = await decisionIndex(pluginRoot);
  for (const { domainId } of index.profiles) {
    const request = await requestArgument(pluginRoot, {
      schemaVersion: 1,
      language: "en",
      platform: "darwin",
      observedAt: index.observedThrough,
      domainIds: [domainId]
    });
    const preview = await runRuntime(runtimePath, ["preview", "--request", request], runtimeEnv);
    if (preview.approvedExecution !== undefined) {
      return { request, preview: await withApprovalObject(runtimePath, preview, runtimeEnv), env: runtimeEnv };
    }
  }
  throw new Error("Fixture decision index has no executable official route");
}

async function fakeClaudeEnvironment(): Promise<NodeJS.ProcessEnv> {
  const home = await temporaryDirectory("skillset-runtime-default-claude-");
  const bin = join(home, "bin");
  const marker = join(home, "claude-marker.txt");
  await mkdir(bin);
  await writeFakeClaude(join(bin, "claude"));
  return {
    ...process.env,
    HOME: home,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    FAKE_CLAUDE_MARKER: marker
  };
}

async function routeForDomain(
  runtimePath: string,
  pluginRoot: string,
  domainId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  request: string;
  preview: RuntimeResult & { approval: { previewDigest: string; preview: { candidates: unknown[] } } };
}> {
  const index = await decisionIndex(pluginRoot);
  const request = await requestArgument(pluginRoot, {
    schemaVersion: 1,
    language: "en",
    platform: "darwin",
    observedAt: index.observedThrough,
    domainIds: [domainId]
  });
  const preview = await runRuntime(runtimePath, ["preview", "--request", request], env);
  if (preview.approvedExecution === undefined) throw new Error(`Domain ${domainId} is not executable`);
  return { request, preview: await withApprovalObject(runtimePath, preview, env) };
}

async function withApprovalObject(
  runtimePath: string,
  preview: RuntimeResult,
  env: NodeJS.ProcessEnv
): Promise<RuntimeResult> {
  if (preview.approvalObjectAccess === undefined) return preview;
  const full = await runRuntime(runtimePath, preview.approvalObjectAccess.argv.slice(2), env);
  return { ...preview, plan: full.plan, approval: full.approval };
}

async function heldRoute(
  runtimePath: string,
  pluginRoot: string,
  env: NodeJS.ProcessEnv
): Promise<{ request: string; preview: RuntimeResult }> {
  const index = await decisionIndex(pluginRoot);
  const request = await requestArgument(pluginRoot, {
    schemaVersion: 1,
    language: "en",
    platform: "linux",
    observedAt: index.observedThrough,
    domainIds: [index.profiles[0]!.domainId]
  });
  const preview = await runRuntime(runtimePath, ["preview", "--request", request], env);
  if (preview.approvedExecution !== undefined || preview.status !== "held") {
    throw new Error("Non-darwin starter route must be held");
  }
  return { request, preview };
}

async function writeTwoDomainCompleteIndex(pluginRoot: string) {
  const index = structuredClone(await loadPluginDecisionIndex(pluginRoot));
  index.starterRoutes = index.starterRoutes?.filter(({ domainId }) =>
    domainId !== "research-and-intelligence" && domainId !== "software-engineering"
  );
  const exa = index.candidates.find(({ id }) => id === "exa")!;
  const featureDev = index.candidates.find(({ id }) => id === "feature-dev")!;
  for (const capabilityId of ["verify-sources-and-claims", "synthesize-cited-evidence"]) {
    if (!exa.providedCapabilityIds.includes(capabilityId)) exa.providedCapabilityIds.push(capabilityId);
  }
  for (const capabilityId of ["turn-requirements-into-specifications", "test-and-debug-software"]) {
    if (!featureDev.providedCapabilityIds.includes(capabilityId)) featureDev.providedCapabilityIds.push(capabilityId);
  }
  const debuggingEvidence = index.candidateEvidence.find(({ candidateId, capabilityId }) =>
    candidateId === "superpowers" && capabilityId === "test-and-debug-software"
  )!;
  const featureDevEvidence = index.candidateEvidence.find(({ candidateId }) => candidateId === "feature-dev")!;
  debuggingEvidence.candidateId = "feature-dev";
  debuggingEvidence.reference = featureDevEvidence.reference;
  debuggingEvidence.contentSha256 = featureDevEvidence.contentSha256;
  debuggingEvidence.listingExcerpt = featureDevEvidence.listingExcerpt;
  debuggingEvidence.listingExcerptSha256 = featureDevEvidence.listingExcerptSha256;
  if (!featureDev.capabilityEvidenceIds.includes(debuggingEvidence.id)) {
    featureDev.capabilityEvidenceIds.push(debuggingEvidence.id);
  }
  index.candidates.splice(index.candidates.findIndex(({ id }) => id === "superpowers"), 1);
  for (const evidence of index.candidateEvidence) {
    if (evidence.candidateId === "exa" && evidence.capabilityId !== "source-discovery-and-web-research") {
      evidence.support = "inferred";
    }
    if (evidence.candidateId === "feature-dev" && evidence.capabilityId === "turn-requirements-into-specifications") {
      evidence.support = "inferred";
    }
    evidence.candidate = structuredClone(index.candidates.find(({ id }) => id === evidence.candidateId)!);
  }
  const { digest: _digest, ...withoutDigest } = index;
  index.digest = decisionIndexDigest(withoutDigest);
  await Promise.all([
    writeFile(join(pluginRoot, "data", "decision-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8"),
    writeFile(join(pluginRoot, "data", "routing-index.json"), generateRoutingIndex(index), "utf8")
  ]);
  decisionBoundaryByRoot.delete(pluginRoot);
  return index;
}

async function requestArgument(pluginRoot: string, value: unknown): Promise<string> {
  let boundaryPromise = decisionBoundaryByRoot.get(pluginRoot);
  if (boundaryPromise === undefined) {
    boundaryPromise = loadPluginDecisionBoundary(pluginRoot);
    decisionBoundaryByRoot.set(pluginRoot, boundaryPromise);
  }
  const boundary = await boundaryPromise;
  const request = value !== null && typeof value === "object" && !Array.isArray(value)
    ? {
      ...(value as Record<string, unknown>),
      schemaVersion: 2,
      claudeProbeConsent: "granted",
      decisionIndexDigest: boundary.decisionIndex.digest,
      routingIndexDigest: boundary.routingIndex.digest
    }
    : value;
  return Buffer.from(`${JSON.stringify(request, null, 2)}\n`, "utf8").toString("base64url");
}

async function runRuntime(
  runtimePath: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<RuntimeResult> {
  const { stdout } = await execFile(process.execPath, [runtimePath, ...args], {
    cwd: join(runtimePath, ".."),
    env,
    maxBuffer: 4 * 1024 * 1024
  });
  return JSON.parse(stdout) as RuntimeResult;
}

function replaceFlag(args: string[], flag: string, value: string): string[] {
  const copy = [...args];
  const index = copy.indexOf(flag);
  if (index < 0 || copy[index + 1] === undefined) throw new Error(`Missing fixture flag ${flag}`);
  copy[index + 1] = value;
  return copy;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

async function runFailedRuntime(
  runtimePath: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<RuntimeResult> {
  try {
    await runRuntime(runtimePath, args, env);
  } catch (error) {
    if (error !== null && typeof error === "object" && "stdout" in error) {
      return JSON.parse(String(error.stdout)) as RuntimeResult;
    }
    throw error;
  }
  throw new Error("Expected runtime process to fail");
}

async function writeFakeClaude(path: string): Promise<void> {
  await writeFile(path, `#!/bin/sh
if [ -n "$FAKE_CLAUDE_DELAY" ]; then sleep "$FAKE_CLAUDE_DELAY"; fi
printf '%s\\n' "$*" >> "$FAKE_CLAUDE_MARKER"
case "$*" in
  "plugin marketplace list --json")
    printf '%s\\n' '[{"installLocation":"/fixture/marketplaces/claude-plugins-official","name":"claude-plugins-official","repo":"anthropics/claude-plugins-official","source":"github"}]'
    ;;
  "--version") printf '%s\\n' '2.1.198 (Claude Code)' ;;
  "plugin install "*"@claude-plugins-official --scope user")
    plugin_id="$3"
    if [ -n "$FAKE_INSTALLED_PLUGIN" ]; then printf '%s\\n' "$plugin_id" > "$FAKE_INSTALLED_PLUGIN"; fi
    ;;
  "plugin list --json")
    if [ -n "$FAKE_PLUGIN_LIST_EXIT" ]; then exit "$FAKE_PLUGIN_LIST_EXIT"; fi
    plugin_id="$FAKE_PLUGIN_ID"
    if [ -n "$FAKE_INSTALLED_PLUGIN" ] && [ -f "$FAKE_INSTALLED_PLUGIN" ]; then plugin_id="$(cat "$FAKE_INSTALLED_PLUGIN")"; fi
    printf '[{"id":"%s","version":"unknown","scope":"user","enabled":true}]\\n' "$plugin_id"
    ;;
  *) exit 64 ;;
esac
`, "utf8");
  await chmod(path, 0o755);
}

function lockPath(home: string): string {
  return join(home, ".claude", "claude-code-skillsets", "state", "install-lock.json");
}

function executionLockPath(home: string): string {
  return join(home, ".claude", "claude-code-skillsets", "state", "setup-execution.lock");
}
