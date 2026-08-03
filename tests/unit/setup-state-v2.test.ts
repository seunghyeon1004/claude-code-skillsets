import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  decisionIndexDigest,
  loadPluginDecisionIndexSet
} from "../../src/decision/index-loader.js";
import {
  SETUP_STATE_PUBLISHER_PROGRAM,
  SETUP_STATE_SNAPSHOT_PLACEHOLDER,
  legacySetupStatePublisherCommandTemplate
} from "../../src/decision/atomic-publisher.js";
import {
  evaluateSetupDecisionFixture,
  executeApprovedSetupCandidates,
  parseSetupInstallLock,
  setupApprovalPreviewDigest,
  type SetupApprovalBinding,
  type SetupInstallRun,
  type SetupPreviewCandidate
} from "../../src/evaluate/setup.js";
import type { DomainId } from "../../src/model/complete-v1.js";
import type { DecisionIndex } from "../../src/model/decision.js";
import { canonicalSetupStateJson } from "../../src/state/setup-state.js";
import { createApprovedOfficialDecisionIndexSetFixture } from "../helpers/official-marketplace-fixture.js";

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("cumulative setup state v2", () => {
  it("authenticates v1 as one legacy run and v2 as ordered globally unique runs", async () => {
    const { indexSet } = await approvedIndexSetFixture();
    const first = await successfulRun(indexSet.current, "research-and-intelligence");
    const second = await successfulRun(indexSet.current, "software-engineering");

    expect(await parseSetupInstallLock({ schemaVersion: 1, ...first }, indexSet)).toMatchObject({
      sourceSchemaVersion: 1,
      completedRunDigests: [first.approval.previewDigest],
      receipts: [{ pluginName: "exa" }]
    });
    const parsed = await parseSetupInstallLock({ schemaVersion: 2, runs: [first, second] }, indexSet);
    expect(parsed.sourceSchemaVersion).toBe(2);
    expect(parsed.runs).toEqual([first, second]);
    expect(parsed.receipts.map(({ pluginName }) => pluginName)).toEqual([
      "exa",
      "feature-dev",
      "superpowers"
    ]);
    await expect(parseSetupInstallLock({ schemaVersion: 2, runs: [first, structuredClone(first)] }, indexSet))
      .rejects.toThrow(/duplicate setup run|duplicate managed receipt/i);
  });

  it("fails closed for a persisted approval preview that predates starter coverage and unknown disclosures", async () => {
    const { indexSet } = await approvedIndexSetFixture();
    const first = await successfulRun(indexSet.current, "research-and-intelligence");
    const legacyPreview = structuredClone(first) as unknown as {
      approval: { preview: Record<string, unknown>; previewDigest: string };
      managedInstallReceipts: Array<{ decisionPlanDigest: string }>;
    };
    delete legacyPreview.approval.preview.planKind;
    delete (legacyPreview.approval.preview.candidates as Array<{ disclosures: Record<string, unknown> }>)[0]!
      .disclosures.authentication;
    legacyPreview.approval.previewDigest = setupApprovalPreviewDigest(
      legacyPreview.approval.preview as unknown as SetupApprovalBinding["preview"]
    );
    for (const receipt of legacyPreview.managedInstallReceipts) {
      receipt.decisionPlanDigest = legacyPreview.approval.previewDigest;
    }

    await expect(parseSetupInstallLock({ schemaVersion: 2, runs: [legacyPreview] }, indexSet))
      .rejects.toThrow(/starter|approval|preview|executable/i);
  });

  it("authenticates a completed run with its preserved historical decision index after the current catalog changes", async () => {
    const { indexSet } = await approvedIndexSetFixture();
    const oldIndex = indexSet.current;
    const first = asLegacyPublisherRun(await successfulRun(oldIndex, "research-and-intelligence"));
    const root = await mkdtemp(join(process.cwd(), ".tmp-setup-index-history-"));
    roots.push(root);
    const data = join(root, "data");
    const history = join(data, "decision-index-history");
    await mkdir(history, { recursive: true });
    const { digest: _oldDigest, ...newWithoutDigest } = structuredClone(oldIndex);
    newWithoutDigest.catalogVersion = "f".repeat(64);
    const newIndex = { ...newWithoutDigest, digest: decisionIndexDigest(newWithoutDigest) };
    await Promise.all([
      writeFile(join(data, "decision-index.json"), `${JSON.stringify(newIndex, null, 2)}\n`, "utf8"),
      writeFile(join(history, `${oldIndex.digest}.json`), `${JSON.stringify(oldIndex, null, 2)}\n`, "utf8")
    ]);

    const set = await loadPluginDecisionIndexSet(root);
    expect(set.current.digest).toBe(newIndex.digest);
    await expect(parseSetupInstallLock({ schemaVersion: 2, runs: [first] }, set)).resolves.toMatchObject({
      completedRunDigests: [first.approval.previewDigest],
      receipts: [{ pluginName: "exa" }]
    });
  });

  it("fails closed when a changed catalog omits, misnames, or symlinks its required history", async () => {
    const { indexSet } = await approvedIndexSetFixture();
    const oldIndex = indexSet.current;
    const first = await successfulRun(oldIndex, "research-and-intelligence");
    const currentRaw = `${JSON.stringify(oldIndex, null, 2)}\n`;
    const { digest: _oldDigest, ...newWithoutDigest } = structuredClone(oldIndex);
    newWithoutDigest.catalogVersion = "e".repeat(64);
    const newIndex = { ...newWithoutDigest, digest: decisionIndexDigest(newWithoutDigest) };

    const missingRoot = await historyFixtureRoot(newIndex);
    const missingSet = await loadPluginDecisionIndexSet(missingRoot);
    await expect(parseSetupInstallLock({ schemaVersion: 2, runs: [first] }, missingSet))
      .rejects.toThrow(/not preserved.*history/i);

    const misnamedRoot = await historyFixtureRoot(newIndex);
    const misnamedHistory = join(misnamedRoot, "data", "decision-index-history");
    await mkdir(misnamedHistory);
    await writeFile(join(misnamedHistory, `${"0".repeat(64)}.json`), currentRaw, "utf8");
    await expect(loadPluginDecisionIndexSet(misnamedRoot)).rejects.toThrow(/filename.*digest/i);

    const symlinkRoot = await historyFixtureRoot(newIndex);
    const symlinkHistory = join(symlinkRoot, "data", "decision-index-history");
    await mkdir(symlinkHistory);
    await symlink(
      join(symlinkRoot, "data", "decision-index.json"),
      join(symlinkHistory, `${oldIndex.digest}.json`)
    );
    await expect(loadPluginDecisionIndexSet(symlinkRoot)).rejects.toThrow(/noncanonical filename or entry/i);
  });

  it("lets maintenance authenticate and select a receipt from its matching v2 run", async () => {
    const { indexSet } = await approvedIndexSetFixture();
    const first = await successfulRun(indexSet.current, "research-and-intelligence");
    const second = await successfulRun(indexSet.current, "software-engineering");
    const home = await mkdtemp(join(process.cwd(), ".tmp-setup-state-v2-maintain-"));
    roots.push(home);
    const state = join(home, ".claude", "claude-code-skillsets", "state");
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "install-lock.json"), canonicalSetupStateJson({
      schemaVersion: 2,
      runs: [first, second]
    }), "utf8");

    const harness = await maintenanceProbeHarness(indexSet.current);
    const { stdout } = await execFile(process.execPath, [
      "--import",
      "tsx",
      join(harness, "tests", "helpers", "setup-state-v2-maintain-probe.ts"),
      "feature-dev"
    ], { cwd: harness, env: { ...process.env, HOME: home } });
    expect(JSON.parse(stdout)).toMatchObject({
      action: "review-required-hold",
      operation: "update",
      reasons: ["managed install version is unknown; maintenance requires an observed semver"],
      commands: []
    });
  });
});

async function successfulRun(
  index: DecisionIndex,
  domainId: DomainId
): Promise<SetupInstallRun> {
  const observedAt = index.observedThrough;
  const awaiting = await evaluateSetupDecisionFixture(index, {
    language: "en",
    domainIds: [domainId],
    platform: "darwin",
    timeProbe: { consent: "granted", utcTimestamp: observedAt },
    riskAcknowledged: true
  });
  if (awaiting.approvalBinding.preview.candidates.length === 0) {
    throw new Error(`Domain ${domainId} has no executable test route`);
  }
  const execution = executeApprovedSetupCandidates({
    approvalPreviewDigest: awaiting.approvalBinding.previewDigest,
    candidates: awaiting.approvalBinding.preview.candidates,
    execution: {
      candidates: awaiting.approvalBinding.preview.candidates.map(successfulCandidateExecution)
    },
    observedAt
  });
  return {
    approval: structuredClone(awaiting.approvalBinding as SetupApprovalBinding),
    statuses: execution.commandReceipts.map(({ candidateId, status }) => ({ candidateId, status })),
    managedInstallReceipts: execution.installReceipts.map((receipt) => ({ ...receipt }))
  };
}

function asLegacyPublisherRun(run: SetupInstallRun): SetupInstallRun {
  const legacy = structuredClone(run);
  const runtimeIdentity = legacy.approval.preview.statePublisher?.runtimeIdentity;
  if (runtimeIdentity === undefined) throw new Error("Test run is missing its state publisher");
  legacy.approval.preview.statePublisher = {
    tool: "Bash",
    runtimeIdentity,
    argvTemplate: [
      runtimeIdentity.executablePath,
      "-e",
      SETUP_STATE_PUBLISHER_PROGRAM,
      Buffer.from(`${JSON.stringify(runtimeIdentity, null, 2)}\n`, "utf8").toString("base64url"),
      SETUP_STATE_SNAPSHOT_PLACEHOLDER
    ],
    commandTemplate: legacySetupStatePublisherCommandTemplate(runtimeIdentity),
    snapshotPlaceholder: SETUP_STATE_SNAPSHOT_PLACEHOLDER,
    snapshotEncoding: "canonical-json-base64url",
    dynamicValueSource: "verified-setup-snapshot-only"
  };
  legacy.approval.preview.statePaths = ["state/install-lock.json"];
  legacy.approval.preview.stateOperations = legacy.approval.preview.stateOperations.filter(
    ({ path }) => path !== "state/setup-execution.lock"
  );
  legacy.approval.preview.riskDisclosures = legacy.approval.preview.riskDisclosures.filter(
    (disclosure) => disclosure !== "execution-lock:stale-requires-doctor-review"
  );
  legacy.approval.previewDigest = setupApprovalPreviewDigest(legacy.approval.preview);
  legacy.managedInstallReceipts = legacy.managedInstallReceipts.map((receipt) => ({
    ...receipt,
    decisionPlanDigest: legacy.approval.previewDigest
  }));
  return legacy;
}

function successfulCandidateExecution(candidate: SetupPreviewCandidate) {
  return {
    marketplaceBeforeStdout: JSON.stringify([{
      installLocation: "/fixture/marketplaces/claude-plugins-official",
      name: candidate.marketplaceId,
      repo: candidate.marketplaceSource,
      source: "github"
    }]),
    cliVersionBeforeStdout: "2.1.198 (Claude Code)\n",
    installInvocation: { argv: [...candidate.installArgv], status: "success" as const },
    pluginListAfterStdout: JSON.stringify([{
      id: `${candidate.pluginName}@${candidate.marketplaceId}`,
      version: "unknown",
      scope: candidate.scope,
      enabled: true
    }]),
    cliVersionAfterStdout: "2.1.198 (Claude Code)\n",
    invocationTrace: [
      { argv: ["claude", "plugin", "marketplace", "list", "--json"], status: "success" as const },
      { argv: ["claude", "--version"], status: "success" as const },
      { argv: [...candidate.installArgv], status: "success" as const },
      { argv: ["claude", "plugin", "list", "--json"], status: "success" as const },
      { argv: ["claude", "--version"], status: "success" as const }
    ]
  };
}

async function historyFixtureRoot(current: object): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-setup-index-history-boundary-"));
  roots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data", "decision-index.json"), `${JSON.stringify(current, null, 2)}\n`, "utf8");
  return root;
}

async function approvedIndexSetFixture() {
  const fixture = await createApprovedOfficialDecisionIndexSetFixture(process.cwd());
  roots.push(fixture.root);
  return fixture;
}

async function maintenanceProbeHarness(
  index: DecisionIndex
): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-setup-state-v2-maintain-harness-"));
  roots.push(root);
  await mkdir(join(root, "tests", "helpers"), { recursive: true });
  await Promise.all([
    cp(join(process.cwd(), "src"), join(root, "src"), { recursive: true }),
    cp(join(process.cwd(), "schemas"), join(root, "schemas"), { recursive: true }),
    cp(
      join(process.cwd(), "plugins", "skillset-manager"),
      join(root, "plugins", "skillset-manager"),
      { recursive: true }
    ),
    cp(
      join(process.cwd(), "tests", "helpers", "setup-state-v2-maintain-probe.ts"),
      join(root, "tests", "helpers", "setup-state-v2-maintain-probe.ts")
    )
  ]);
  await rm(join(root, "plugins", "skillset-manager", "data", "decision-index-history"), {
    recursive: true,
    force: true
  });
  await writeFile(
    join(root, "plugins", "skillset-manager", "data", "decision-index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8"
  );
  return root;
}
