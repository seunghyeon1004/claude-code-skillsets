import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ManagedInstallReceipt } from "../../src/model/decision.js";
import { createApprovedOfficialDecisionIndexFixture } from "./official-marketplace-fixture.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const execFile = promisify(execFileCallback);
let approvedDecisionIndexRaw: Promise<string> | undefined;

export interface FixtureIdentity {
  pluginName: string;
  marketplaceId: string;
  marketplaceSource: string;
  scope: "user" | "project" | "local";
  version: string;
}

export interface MaintenanceFixtureOptions {
  operation?: "update" | "remove";
  installed?: FixtureIdentity;
  receipt?: ManagedInstallReceipt;
  /** Deliberately malformed persisted receipt for loader boundary tests. */
  rawManagedReceipt?: unknown;
  state?: Record<string, unknown>;
  claudeVersion?: string;
}

/** Writes only the fixed HOME state consumed by the production loader. */
export async function writeMaintenanceFixture(
  root: string,
  options: MaintenanceFixtureOptions = {}
): Promise<void> {
  const installed = options.installed ?? identity();
  const homeRoot = join(root, "home", ".claude", "claude-code-skillsets");
  const approvedRaw = await eligibleDecisionIndexRaw();
  const publisherRoot = join(root, "setup-publisher-harness");
  await Promise.all([
    cp(join(projectRoot, "src"), join(publisherRoot, "src"), { recursive: true }),
    cp(join(projectRoot, "schemas"), join(publisherRoot, "schemas"), { recursive: true }),
    mkdir(join(publisherRoot, "plugins", "skillset-manager", "data"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      join(publisherRoot, "plugins", "skillset-manager", "data", "decision-index.json"),
      approvedRaw,
      "utf8"
    ),
    cp(
      join(projectRoot, "plugins", "skillset-manager", "maintenance-policy.json"),
      join(publisherRoot, "plugins", "skillset-manager", "maintenance-policy.json")
    ),
    writeFile(join(root, "fixture-decision-index.json"), approvedRaw, "utf8")
  ]);
  await execFile(process.execPath, [
    "--import", "tsx", join(publisherRoot, "src", "evaluate", "setup-fixture-publisher.ts"),
    "anthropics/claude-plugins-official", installed.version
  ], { cwd: publisherRoot, env: { ...process.env, HOME: join(root, "home") } });
  const lockPath = join(homeRoot, "state", "install-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    runs: Array<{
      approval: { previewDigest: string };
      managedInstallReceipts: ManagedInstallReceipt[];
    }>;
    [key: string]: unknown;
  };
  const run = lock.runs[0]!;
  const actualReceipt = run.managedInstallReceipts[0]!;
  if (options.receipt !== undefined) {
    run.managedInstallReceipts = [{
      ...options.receipt,
      decisionPlanDigest: options.receipt.decisionPlanDigest === "a".repeat(64)
        ? actualReceipt.decisionPlanDigest
        : options.receipt.decisionPlanDigest,
      installCommandDigest: options.receipt.installCommandDigest === "b".repeat(64)
        ? actualReceipt.installCommandDigest
        : options.receipt.installCommandDigest,
      observedAt: options.receipt.observedAt === "2026-07-29T00:00:00Z"
        ? actualReceipt.observedAt
        : options.receipt.observedAt
    }];
  }
  if (options.rawManagedReceipt !== undefined) {
    run.managedInstallReceipts = [options.rawManagedReceipt as ManagedInstallReceipt];
  }
  Object.assign(lock, options.state);

  await mkdir(join(root, "bin"), { recursive: true });
  const claudeScript = `#!/usr/bin/env node
const args = JSON.stringify(process.argv.slice(2));
if (args === JSON.stringify(["--version"])) {
  process.stdout.write(${JSON.stringify(`${options.claudeVersion ?? "2.1.198"} (Claude Code)\n`)});
} else if (args === JSON.stringify(["plugin", "marketplace", "list", "--json"])) {
  process.stdout.write(${JSON.stringify(`${JSON.stringify([{
    installLocation: "/fixture/marketplaces/trusted-marketplace",
    name: installed.marketplaceId,
    repo: installed.marketplaceSource,
    source: "github"
  }])}\n`)});
} else if (args === JSON.stringify(["plugin", "list", "--json"])) {
  process.stdout.write(${JSON.stringify(`${JSON.stringify([{
    id: `${installed.pluginName}@${installed.marketplaceId}`,
    version: installed.version,
    scope: installed.scope,
    enabled: true,
  }])}\n`)});
} else {
  process.stderr.write("unexpected claude fixture arguments\\n");
  process.exitCode = 64;
}

`;
  await Promise.all([
    writeJson(lockPath, lock),
    writeFile(join(root, "bin", "claude"), claudeScript, "utf8")
  ]);
  await chmod(join(root, "bin", "claude"), 0o755);
}

async function eligibleDecisionIndexRaw(): Promise<string> {
  approvedDecisionIndexRaw ??= createApprovedOfficialDecisionIndexFixture(projectRoot).then(async ({ root, raw }) => {
    await rm(root, { recursive: true, force: true });
    return raw;
  });
  return approvedDecisionIndexRaw;
}

/**
 * Creates an isolated copied module with fixture-only policy evidence. Production
 * source has no path override and cannot reach this policy.
 */
export async function prepareMaintenancePolicyHarness(root: string): Promise<string> {
  const harnessRoot = join(root, "maintenance-harness");
  await cp(join(projectRoot, "src"), join(harnessRoot, "src"), { recursive: true });
  await cp(join(projectRoot, "schemas"), join(harnessRoot, "schemas"), { recursive: true });
  const policyPath = join(harnessRoot, "plugins", "skillset-manager", "maintenance-policy.json");
  await mkdir(dirname(policyPath), { recursive: true });
  await mkdir(join(harnessRoot, "plugins", "skillset-manager", "data"), { recursive: true });
  await cp(
    join(root, "fixture-decision-index.json"),
    join(harnessRoot, "plugins", "skillset-manager", "data", "decision-index.json")
  );
  await writeFile(policyPath, `${JSON.stringify(fixturePolicy(), null, 2)}\n`, "utf8");
  const digest = createHash("sha256").update(await readFile(policyPath)).digest("hex");
  const modulePath = join(harnessRoot, "src", "lifecycle", "maintain.ts");
  const source = await readFile(modulePath, "utf8");
  const patched = source.replace(
    /const maintenancePolicyDigest = "[0-9a-f]{64}";/,
    `const maintenancePolicyDigest = "${digest}";`
  );
  if (patched === source) throw new Error("Fixture policy harness could not replace the policy digest");
  await writeFile(modulePath, patched, "utf8");
  return modulePath;
}

export function identity(overrides: Partial<FixtureIdentity> = {}): FixtureIdentity {
  return {
    pluginName: "exa",
    marketplaceId: "claude-plugins-official",
    marketplaceSource: "anthropics/claude-plugins-official",
    scope: "user",
    version: "1.0.0",
    ...overrides
  };
}

export function receipt(
  installed = identity(),
  overrides: Partial<ManagedInstallReceipt> = {}
): ManagedInstallReceipt {
  return {
    managedBy: "claude-code-skillsets",
    decisionPlanDigest: "a".repeat(64),
    pluginName: installed.pluginName,
    marketplaceId: installed.marketplaceId,
    marketplaceSource: installed.marketplaceSource,
    scope: installed.scope,
    preInstallVersion: null,
    postInstallVersion: installed.version,
    versionStatus: "observed-semver",
    observedAt: "2026-07-29T00:00:00Z",
    installCommandDigest: "b".repeat(64),
    ...overrides
  };
}

export function reviewPolicyId(operation: "update" | "remove"): string {
  return operation === "update"
    ? "managed-exa-update-1.0.0-to-1.1.0-v1"
    : "managed-exa-remove-1.0.0-v1";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixturePolicy(): unknown {
  const current = identity();
  return {
    schemaVersion: 1,
    kind: "skillset-manager-maintenance-policy-v1",
    cli: {
      version: "2.1.198",
      syntaxEvidence: {
        kind: "official-claude-cli-help-v1",
        source: "https://docs.anthropic.com/en/docs/claude-code/cli-reference",
        digest: "31ed0d5289fc6d6cf0e03af89f36cc22d0518ffc0e291283001817bd8a0abf5c"
      },
      verificationCommand: "claude plugin list --json"
    },
    transactionAdapters: { update: null, remove: null },
    reviews: [
      {
        id: reviewPolicyId("update"),
        operation: "update",
        decision: "approved",
        evidenceDigest: "f32a3afc54d8666ac281ea9ec012678d358a786c522a77360a4d490dca062ea7",
        currentIdentity: current,
        nextIdentity: identity({ version: "1.1.0" }),
        reviewedAt: "2026-07-29T00:00:00Z",
        expiresAt: "2030-07-29T00:00:00Z"
      },
      {
        id: reviewPolicyId("remove"),
        operation: "remove",
        decision: "approved",
        evidenceDigest: "1a5b68c5f598e5b58d2f0ce99734ba3f360102de3f8a9a00a2ce1d9b6b2510e4",
        currentIdentity: current,
        nextIdentity: null,
        reviewedAt: "2026-07-29T00:00:00Z",
        expiresAt: "2030-07-29T00:00:00Z"
      }
    ]
  };
}
