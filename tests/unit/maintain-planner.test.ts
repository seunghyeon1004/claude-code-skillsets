import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import * as maintenance from "../../src/lifecycle/maintain.js";
import { setupApprovalPreviewDigest, type SetupApprovalPreview } from "../../src/evaluate/setup.js";
import type { ApprovalConsumption, MaintenancePlan } from "../../src/lifecycle/maintain.js";
import {
  identity,
  prepareMaintenancePolicyHarness,
  receipt,
  writeMaintenanceFixture
} from "../helpers/maintain-state-fixture.js";

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const probePath = join(projectRoot, "tests", "helpers", "maintain-runtime-probe.ts");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("maintenance planner", () => {
  it("does not expose an arbitrary-root loader and makes loader failures operation-specific holds", async () => {
    expect(maintenance.loadMaintenanceState).toHaveLength(0);
    expect(await maintenance.safelyPlanMaintenance("remove")).toMatchObject({
      action: "review-required-hold",
      operation: "remove",
      commands: []
    });
    expect(() => maintenance.planMaintenance({})).toThrow(/operation is required/i);
  });

  it("does not let self-authored review, syntax, atomicity, kind, source, or 64-hex fields mint authority", async () => {
    const root = await fixtureRoot({
      state: {
        reviewPolicyId: "attacker-review",
        review: { kind: "maintenance-review-v1", evidenceDigest: "c".repeat(64), decision: "approved" },
        syntax: { kind: "claude-cli-maintenance-syntax-v1", source: "official-claude-cli-help", sourceDigest: "d".repeat(64) },
        atomicity: { kind: "claude-cli-maintenance-transaction-v1", source: "attacker", sourceDigest: "e".repeat(64) }
      }
    });

    expect(await probe(root, "safe", "remove")).toMatchObject({
      action: "review-required-hold",
      operation: "remove",
      commands: [],
      approvalBinding: null
    });
  });

  it("rejects a symlink ancestor and a nonexistent RFC3339 calendar date through the safe hold", async () => {
    const symlinkRoot = await fixtureRoot();
    const claudeRoot = join(symlinkRoot, "home", ".claude");
    const redirected = join(symlinkRoot, "outside-claude");
    await mkdir(redirected);
    await rm(claudeRoot, { recursive: true, force: true });
    await symlink(redirected, claudeRoot);
    expect(await probe(symlinkRoot, "safe", "remove")).toMatchObject({
      action: "review-required-hold",
      operation: "remove",
      commands: []
    });

    const dateRoot = await fixtureRoot({ receipt: receipt(identity(), { observedAt: "2026-02-30T00:00:00Z" }) });
    expect(await probe(dateRoot, "safe", "update")).toMatchObject({
      action: "review-required-hold",
      operation: "update",
      commands: []
    });
  });

  it("holds an honestly recorded unknown setup version without replacing its receipt", async () => {
    const root = await fixtureRoot({
      receipt: receipt(identity(), { postInstallVersion: null, versionStatus: "unknown" })
    });
    const lockPath = join(root, "home", ".claude", "claude-code-skillsets", "state", "install-lock.json");
    const before = await readFile(lockPath, "utf8");

    expect(await probe(root, "safe", "update")).toMatchObject({
      action: "review-required-hold",
      operation: "update",
      reasons: ["managed install version is unknown; maintenance requires an observed semver"],
      commands: [],
      stateChanges: [],
      approvalBinding: null
    });
    await expect(readFile(lockPath, "utf8")).resolves.toBe(before);
  });

  it("rejects every noncanonical setup-lock byte representation before maintenance semantics", async () => {
    const canonicalRoot = await fixtureRoot({
      receipt: receipt(identity(), { postInstallVersion: null, versionStatus: "unknown" })
    });
    const canonicalPath = join(
      canonicalRoot,
      "home", ".claude", "claude-code-skillsets", "state", "install-lock.json"
    );
    const canonical = await readFile(canonicalPath, "utf8");
    const parsed = JSON.parse(canonical) as { schemaVersion: number; runs: unknown[] };
    const variants = [
      JSON.stringify(parsed),
      canonical.replaceAll("\n", "\r\n"),
      canonical.slice(0, -1),
      canonical.replace('  "schemaVersion": 2,', '  "schemaVersion": 2,\n  "schemaVersion": 2,'),
      `${JSON.stringify({ runs: parsed.runs, schemaVersion: parsed.schemaVersion }, null, 2)}\n`
    ];

    for (const [index, raw] of variants.entries()) {
      const root = await fixtureRoot({
        receipt: receipt(identity(), { postInstallVersion: null, versionStatus: "unknown" })
      });
      const lockPath = join(root, "home", ".claude", "claude-code-skillsets", "state", "install-lock.json");
      await writeFile(lockPath, raw, "utf8");
      expect(await probe(root, "safe", "update"), `variant ${index}`).toMatchObject({
        action: "review-required-hold",
        reasons: ["project-maintenance-state-unavailable"],
        commands: []
      });
    }
  });

  it("holds maintenance for stale or unsafe setup execution locks without deleting them", async () => {
    const root = await fixtureRoot();
    const lock = join(
      root,
      "home", ".claude", "claude-code-skillsets", "state", "setup-execution.lock"
    );
    await writeFile(lock, '{"pid":999999}\n', "utf8");
    expect(await probe(root, "safe", "remove")).toMatchObject({
      action: "review-required-hold",
      reasons: [expect.stringMatching(/setup execution lock.*doctor review.*regular-stale/i)],
      commands: []
    });
    await expect(readFile(lock, "utf8")).resolves.toBe('{"pid":999999}\n');

    await rm(lock);
    const outside = join(root, "outside-execution-lock");
    await writeFile(outside, "outside\n", "utf8");
    await symlink(outside, lock);
    expect(await probe(root, "safe", "update")).toMatchObject({
      action: "review-required-hold",
      reasons: [expect.stringMatching(/setup execution lock.*doctor review.*symlink-or-nonregular/i)],
      commands: []
    });
    await expect(readFile(outside, "utf8")).resolves.toBe("outside\n");
  });

  it("rejects inconsistent managed receipt version evidence", async () => {
    for (const rawManagedReceipt of [
      { ...receipt(), postInstallVersion: null, versionStatus: "observed-semver" },
      { ...receipt(), postInstallVersion: "1.0.0", versionStatus: "unknown" },
      { ...receipt(), postInstallVersion: "unknown", versionStatus: "unknown" }
    ]) {
      const root = await fixtureRoot({ rawManagedReceipt });
      expect(await probe(root, "safe", "update")).toMatchObject({
        action: "review-required-hold",
        reasons: ["project-maintenance-state-unavailable"],
        commands: []
      });
    }
  });

  it("rejects a managed receipt whose decision digest does not match setup approval", async () => {
    const root = await fixtureRoot({
      rawManagedReceipt: receipt(identity(), { decisionPlanDigest: "e".repeat(64) })
    });
    expect(await probe(root, "safe", "remove")).toMatchObject({
      action: "review-required-hold",
      operation: "remove",
      reasons: ["project-maintenance-state-unavailable"],
      commands: []
    });
  });

  it("requires managed receipts to follow the successful setup execution order", () => {
    const assertOrder = (maintenance as unknown as {
      assertCanonicalManagedReceiptOrder: (
        executionOrder: readonly { candidateId: string; pluginName: string }[],
        statuses: ReadonlyMap<string, "success" | "failure" | "skipped">,
        receipts: readonly { pluginName: string }[]
      ) => void;
    }).assertCanonicalManagedReceiptOrder;
    expect(typeof assertOrder).toBe("function");
    const statuses = new Map([
      ["first", "success"],
      ["second", "success"]
    ] as const);
    const candidates = [
      { candidateId: "first", pluginName: "plugin-alpha" },
      { candidateId: "second", pluginName: "plugin-beta" }
    ];
    expect(() => assertOrder(candidates, statuses, [
      { pluginName: "plugin-beta" },
      { pluginName: "plugin-alpha" }
    ])).toThrow(/order/i);
    expect(() => assertOrder(candidates, statuses, [
      { pluginName: "plugin-alpha" },
      { pluginName: "plugin-beta" }
    ])).not.toThrow();
  });

  it("rejects the legacy minimal lock even when its arbitrary digests agree", async () => {
    const root = await fixtureRoot();
    const lockPath = join(root, "home", ".claude", "claude-code-skillsets", "state", "install-lock.json");
    const arbitraryDigest = "a".repeat(64);
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: 1,
      approval: {
        decisionIndexDigest: arbitraryDigest,
        previewDigest: arbitraryDigest,
        observedAt: "2026-07-29T00:00:00Z"
      },
      statuses: [{ candidateId: "exa", status: "success" }],
      managedInstallReceipts: [receipt(identity(), { decisionPlanDigest: arbitraryDigest })]
    }, null, 2)}\n`, "utf8");

    expect(await probe(root, "safe", "remove")).toMatchObject({
      action: "review-required-hold",
      operation: "remove",
      reasons: ["project-maintenance-state-unavailable"],
      commands: []
    });
  });

  it("rejects a recomputed self-consistent lock that is not the current root decision", async () => {
    const root = await fixtureRoot();
    const lockPath = join(root, "home", ".claude", "claude-code-skillsets", "state", "install-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      runs: Array<{
        approval: { preview: SetupApprovalPreview; previewDigest: string };
        managedInstallReceipts: Array<{ decisionPlanDigest: string }>;
      }>;
    };
    const run = lock.runs[0]!;
    run.approval.preview.goal = "forged legal setup";
    run.approval.preview.selectedDomainIds = ["legal-risk-and-compliance"];
    run.approval.preview.domainPriority = [];
    run.approval.previewDigest = setupApprovalPreviewDigest(run.approval.preview);
    run.managedInstallReceipts[0]!.decisionPlanDigest = run.approval.previewDigest;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    expect(await probe(root, "safe", "update")).toMatchObject({
      action: "review-required-hold",
      operation: "update",
      reasons: ["project-maintenance-state-unavailable"],
      commands: []
    });
  });

  it("keeps production policy empty, so an otherwise shaped state is held", async () => {
    const root = await fixtureRoot({ operation: "remove" });
    expect(await probe(root, "safe", "remove", { productionModule: true })).toMatchObject({
      action: "review-required-hold",
      operation: "remove",
      commands: [],
      reasons: ["policy-owned review evidence is unavailable"]
    });
  });

  it("binds a separate actual Claude CLI observation and compares it to the fixed 2.1.198 policy", async () => {
    const root = await fixtureRoot({ operation: "remove", claudeVersion: "9.9.9" });
    expect(await probe(root, "plan", "remove")).toMatchObject({
      action: "review-required-hold",
      reasons: ["current Claude CLI version does not match the plugin maintenance policy"],
      commands: []
    });
  });

  it("holds when raw marketplace source or exact loaded plugin version drifts from the setup receipt", async () => {
    for (const installed of [
      identity({ marketplaceSource: "https://example.test/observed-drift" }),
      identity({ version: "1.1.0" })
    ]) {
      const root = await fixtureRoot({ operation: "remove", installed, receipt: receipt() });
      expect(await probe(root, "safe", "remove")).toMatchObject({
        action: "review-required-hold",
        operation: "remove",
        reasons: ["current installed identity does not exactly match the managed receipt"],
        commands: []
      });
    }
  });

  it("uses current observation time, not review-controlled asOf, for review expiry", async () => {
    const root = await fixtureRoot({ operation: "remove" });
    expect(await probe(root, "plan", "remove", { now: "2031-01-01T00:00:00Z" })).toMatchObject({
      action: "review-required-hold",
      reasons: ["policy review is stale at the current observation time"],
      commands: []
    });
  });

  it("holds a compatible update because no executable transaction restore adapter exists", async () => {
    const root = await fixtureRoot();
    expect(await probe(root, "plan")).toMatchObject({
      action: "review-required-hold",
      operation: "update",
      reasons: expect.arrayContaining(["no executable Claude CLI transaction adapter proves update restoration"]),
      commands: [],
      stateChanges: [],
      preservesPriorIdentityOnFailure: false,
      approvalBinding: null
    });
  });

  it("keeps a removal preview truthful and binds a random short-lived approval challenge", async () => {
    const root = await fixtureRoot({ operation: "remove" });
    const plan = await probe(root, "plan", "remove");

    expect(plan).toMatchObject({
      action: "removal-preview",
      operation: "remove",
      commands: [
        "claude plugin remove exa@claude-plugins-official --scope user",
        "claude plugin list --json"
      ],
      requiresFreshApproval: true,
      preservesPriorIdentityOnFailure: false
    });
    expect(plan.approvalBinding).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.preview?.approval).toMatchObject({ nonce: expect.stringMatching(/^[0-9a-f]{64}$/), epoch: expect.any(Number) });
    expect(plan.preview?.syntax).toMatchObject({
      claudeExecutableSha256: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
    expect(plan.stateChanges.join(" ")).toMatch(/no restore, preservation, or transaction-atomicity claim/i);
  });

  it("rejects approval replay, expiry, and approvals superseded by a fresh load", async () => {
    const root = await fixtureRoot({ operation: "remove" });
    const approvals = await probe<ApprovalProbe>(root, "approval", "remove");

    expect(approvals.first.approvalBinding).not.toBe(approvals.second.approvalBinding);
    expect(approvals.first.preview?.approval.epoch).not.toBe(approvals.second.preview?.approval.epoch);
    expect(approvals.firstAfterReload).toMatchObject({ accepted: false, reason: "superseded" });
    expect(approvals.secondFirstConsume).toMatchObject({ accepted: true, reason: "consumed" });
    expect(approvals.secondReplay).toMatchObject({ accepted: false, reason: "already-consumed" });

    const expiryRoot = await fixtureRoot({ operation: "remove" });
    expect(await probe(expiryRoot, "expiry", "remove")).toMatchObject({ accepted: false, reason: "expired" });
  });
});

async function fixtureRoot(options: Parameters<typeof writeMaintenanceFixture>[1] = {}): Promise<string> {
  const root = await mkdtemp(join(projectRoot, ".tmp-maintain-planner-"));
  temporaryRoots.push(root);
  await writeMaintenanceFixture(root, options);
  await prepareMaintenancePolicyHarness(root);
  return root;
}

async function probe<T = MaintenancePlan>(
  root: string,
  mode: "plan" | "safe" | "approval" | "expiry",
  operation?: "update" | "remove",
  options: { now?: string; productionModule?: boolean } = {}
): Promise<T> {
  const modulePath = options.productionModule
    ? join(root, "setup-publisher-harness", "src", "lifecycle", "maintain.ts")
    : join(root, "maintenance-harness", "src", "lifecycle", "maintain.ts");
  const { stdout } = await execFile(process.execPath, ["--import", "tsx", probePath, mode, operation ?? "update"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: join(root, "home"),
      PATH: `${join(root, "bin")}${delimiter}${process.env.PATH ?? ""}`,
      MAINTENANCE_MODULE_PATH: modulePath,
      ...(options.now === undefined ? {} : { MAINTENANCE_PROBE_NOW: options.now })
    }
  });
  return JSON.parse(stdout) as T;
}

interface ApprovalProbe {
  first: MaintenancePlan;
  second: MaintenancePlan;
  firstAfterReload: ApprovalConsumption;
  secondFirstConsume: ApprovalConsumption;
  secondReplay: ApprovalConsumption;
}
