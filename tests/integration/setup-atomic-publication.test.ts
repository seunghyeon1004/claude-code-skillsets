import { execFile as execFileCallback } from "node:child_process";
import { access, chmod, cp, mkdtemp, readFile, rm, stat, symlink, writeFile, mkdir } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeSetupPublisherRuntimeIdentity,
  renderSetupStatePublisherCommand,
  verifySetupPublisherRuntimeIdentity
} from "../../src/decision/atomic-publisher.js";
import * as decisionIndexLoader from "../../src/decision/index-loader.js";
import {
  evaluateSetupDecisionFixture,
  executeAndPublishApprovedSetupCandidates
} from "../../src/evaluate/setup.js";
import { createApprovedOfficialDecisionIndexSetFixture } from "../helpers/official-marketplace-fixture.js";

const temporaryRoots: string[] = [];
const originalHome = process.env.HOME;
const execFile = promisify(execFileCallback);

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  process.env.HOME = originalHome;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("setup atomic state publisher", () => {
  it("executes the installed-skill Bash publisher contract with the same anchored durable result", async () => {
    const home = await temporaryHome();
    const snapshot = {
      schemaVersion: 1,
      approval: { previewDigest: "a".repeat(64) },
      statuses: [{ candidateId: "exa", status: "success" }],
      managedInstallReceipts: [{ pluginName: "exa", postInstallVersion: "1.0.0" }]
    };
    const command = renderSetupStatePublisherCommand(snapshot, await observeSetupPublisherRuntimeIdentity(), null);

    expect(command).not.toContain("<BASE64URL_CANONICAL_SETUP_SNAPSHOT>");
    await execFile("/bin/sh", ["-c", command], { env: { ...process.env, HOME: home } });

    expect(await readJson(lockPath(home))).toEqual(snapshot);
    expect((await stat(lockPath(home))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, ".claude", "claude-code-skillsets", "state"))).mode & 0o777).toBe(0o700);
  });

  it("compares the exact prior raw digest before replacing an existing setup snapshot", async () => {
    const home = await temporaryHome();
    const first = { schemaVersion: 1, writer: "first" };
    const second = { schemaVersion: 1, writer: "second" };
    await runPublisher(first, home);
    const before = await readFile(lockPath(home), "utf8");
    const identity = await observeSetupPublisherRuntimeIdentity();
    const stale = renderSetupStatePublisherCommand(second, identity, "0".repeat(64));

    await expect(execFile("/bin/sh", ["-c", stale], { env: { ...process.env, HOME: home } }))
      .rejects.toThrow();
    await expect(readFile(lockPath(home), "utf8")).resolves.toBe(before);
  });

  it("publishes the exact setup lock consumed by the production maintenance loader", async () => {
    const home = await temporaryHome();
    const bin = join(home, "bin");
    const fixture = await isolatedApprovedFixture();
    const index = fixture.index;
    const input = {
      language: "en" as const,
      domainIds: ["research-and-intelligence" as const],
      platform: "darwin" as const,
      timeProbe: { consent: "granted" as const, utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const approved = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaiting.approvalBinding
    });
    const candidate = awaiting.approvalBinding.preview.candidates[0]!;
    await withHome(home, () => executeAndPublishApprovedSetupCandidates({
      executionCapability: approved.executionCapability!,
      decisionIndex: index,
      observedAt: index.observedThrough,
      driver: {
        async executeCandidate() {
          return {
            marketplaceBeforeStdout: JSON.stringify([{
              installLocation: "/fixture/marketplaces/claude-plugins-official",
              name: candidate.marketplaceId,
              repo: candidate.marketplaceSource,
              source: "github"
            }]),
            cliVersionBeforeStdout: "2.1.198 (Claude Code)\n",
            installInvocation: { argv: candidate.installArgv, status: "success" },
            pluginListAfterStdout: JSON.stringify([{
              id: `${candidate.pluginName}@${candidate.marketplaceId}`,
              version: "1.0.0",
              scope: candidate.scope,
              enabled: true
            }]),
            cliVersionAfterStdout: "2.1.198 (Claude Code)\n",
            invocationTrace: [
              { argv: ["claude", "plugin", "marketplace", "list", "--json"], status: "success" },
              { argv: ["claude", "--version"], status: "success" },
              { argv: [...candidate.installArgv], status: "success" },
              { argv: ["claude", "plugin", "list", "--json"], status: "success" },
              { argv: ["claude", "--version"], status: "success" }
            ]
          };
        }
      }
    }));
    await mkdir(bin);
    const claude = join(bin, "claude");
    await writeFile(claude, `#!/bin/sh
case "$*" in
  "--version") printf '%s\\n' '2.1.198 (Claude Code)' ;;
  "plugin marketplace list --json") printf '%s\\n' '[{"installLocation":"/fixture/marketplaces/claude-plugins-official","name":"claude-plugins-official","repo":"anthropics/claude-plugins-official","source":"github"}]' ;;
  "plugin list --json") printf '%s\\n' '[{"id":"exa@claude-plugins-official","version":"1.0.0","scope":"user","enabled":true}]' ;;
  *) exit 64 ;;
esac
`, "utf8");
    await chmod(claude, 0o755);

    const { stdout } = await execFile(process.execPath, [
      "--import", "tsx", join(await prepareMaintenanceLoaderHarness(fixture), "src", "evaluate", "maintain-fixture-loader.ts"), "remove"
    ], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
    });
    expect(JSON.parse(stdout)).toMatchObject({
      action: "review-required-hold",
      operation: "remove",
      reasons: ["policy-owned review evidence is unavailable"]
    });
    expect(await readJson(lockPath(home))).toMatchObject({
      schemaVersion: 2,
      runs: [{
        approval: {
          preview: awaiting.approvalBinding.preview,
          previewDigest: awaiting.approvalBinding.previewDigest
        },
        managedInstallReceipts: [{ pluginName: "exa" }]
      }]
    });
    await expect(access(join(home, ".claude", "claude-code-skillsets", "state", "maintenance-observation.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("expires an issued capability against actual UTC before the initial publication", async () => {
    vi.useFakeTimers();
    const home = await temporaryHome();
    const { index } = await isolatedApprovedFixture();
    const approvedAt = secondsAfter(index.observedThrough, 1);
    vi.setSystemTime(new Date(approvedAt));
    const input = {
      language: "en" as const,
      domainIds: ["research-and-intelligence" as const],
      platform: "darwin" as const,
      timeProbe: { consent: "granted" as const, utcTimestamp: approvedAt },
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const approved = await evaluateSetupDecisionFixture(index, { ...input, approval: awaiting.approvalBinding });
    expect(approved.executionCapability).not.toBeNull();

    vi.setSystemTime(new Date(index.catalogExpiresAt));
    let calls = 0;
    await expect(withHome(home, () => executeAndPublishApprovedSetupCandidates({
      executionCapability: approved.executionCapability!,
      decisionIndex: index,
      observedAt: input.timeProbe.utcTimestamp,
      driver: { async executeCandidate() { calls += 1; return undefined; } }
    }))).rejects.toThrow(/expired|fresh approval/i);
    expect(calls).toBe(0);
    await expect(access(lockPath(home))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires fresh approval when the process-local capability lifetime elapses", async () => {
    vi.useFakeTimers();
    const home = await temporaryHome();
    const { index } = await isolatedApprovedFixture();
    const approvedAt = secondsAfter(index.observedThrough, 2);
    vi.setSystemTime(new Date(approvedAt));
    const input = {
      language: "ko" as const,
      domainIds: ["research-and-intelligence" as const],
      platform: "darwin" as const,
      timeProbe: { consent: "granted" as const, utcTimestamp: approvedAt },
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const approved = await evaluateSetupDecisionFixture(index, { ...input, approval: awaiting.approvalBinding });

    vi.setSystemTime(new Date(Date.parse(approvedAt) + 5 * 60_000));
    let calls = 0;
    await expect(withHome(home, () => executeAndPublishApprovedSetupCandidates({
      executionCapability: approved.executionCapability!,
      decisionIndex: index,
      observedAt: input.timeProbe.utcTimestamp,
      driver: { async executeCandidate() { calls += 1; return undefined; } }
    }))).rejects.toThrow(/expired|fresh approval/i);
    expect(calls).toBe(0);
    await expect(access(lockPath(home))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ignores a PATH-shadowed node and rejects a changed approved runtime identity", async () => {
    const home = await temporaryHome();
    const bin = join(home, "bin");
    const marker = join(home, "path-node-executed");
    await mkdir(bin);
    const fakeNode = join(bin, "node");
    await writeFile(fakeNode, `#!/bin/sh\nprintf x > '${marker}'\nexit 91\n`, "utf8");
    await chmod(fakeNode, 0o755);
    const identity = await observeSetupPublisherRuntimeIdentity();
    const command = renderSetupStatePublisherCommand({ state: "approved" }, identity, null);

    await execFile("/bin/sh", ["-c", command], {
      env: { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
    });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(verifySetupPublisherRuntimeIdentity({ ...identity, sha256: "0".repeat(64) }))
      .rejects.toThrow(/changed after approval/i);

    const staleHome = await temporaryHome();
    const staleCommand = renderSetupStatePublisherCommand(
      { state: "must-not-publish" },
      { ...identity, sha256: "0".repeat(64) },
      null
    );
    await expect(execFile("/bin/sh", ["-c", staleCommand], {
      env: { ...process.env, HOME: staleHome, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
    })).rejects.toThrow();
    await expect(access(lockPath(staleHome))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an attacker-controlled ancestor symlink without overwriting an outside victim", async () => {
    const home = await temporaryHome();
    const outside = join(home, "outside");
    const victim = join(outside, "claude-code-skillsets", "state", "install-lock.json");
    await mkdir(join(outside, "claude-code-skillsets", "state"), { recursive: true });
    await writeFile(victim, "outside-victim\n", "utf8");
    await symlink(outside, join(home, ".claude"));

    await expect(runPublisher({ state: "attacker-value" }, home)).rejects.toThrow();
    expect(await readFile(victim, "utf8")).toBe("outside-victim\n");
  });

  it("rejects a pre-existing lock symlink without overwriting an outside victim", async () => {
    const home = await temporaryHome();
    const directory = join(home, ".claude", "claude-code-skillsets", "state");
    const outside = join(home, "outside-lock.json");
    await mkdir(directory, { recursive: true });
    await writeFile(outside, "outside-victim\n", "utf8");
    await symlink(outside, lockPath(home));

    await expect(runPublisher({ state: "attacker-value" }, home)).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("outside-victim\n");
  });

  it("enforces the expected-prior-digest stale check before rename", async () => {
    const home = await temporaryHome();
    await runPublisher({ state: "current" }, home);
    const command = renderSetupStatePublisherCommand(
      { state: "must-not-publish" },
      await observeSetupPublisherRuntimeIdentity(),
      "0".repeat(64)
    );

    await expect(execFile("/bin/sh", ["-c", command], { env: { ...process.env, HOME: home } }))
      .rejects.toThrow(/expected-prior-digest stale check failed/i);
    expect(await readJson(lockPath(home))).toEqual({ state: "current" });
  });

  it("leaves one complete snapshot despite a same-user publisher race", async () => {
    const home = await temporaryHome();
    const values = Array.from({ length: 6 }, (_, index) => ({ schemaVersion: 1, writer: index }));

    const outcomes = await Promise.allSettled(values.map((value) => runPublisher(value, home)));
    expect(outcomes.filter(({ status }) => status === "fulfilled").length).toBeGreaterThan(0);

    const committed = await readJson(lockPath(home));
    expect(values).toContainEqual(committed);
  });

  it("rejects a non-JSON snapshot before it creates project state", async () => {
    const home = await temporaryHome();

    await expect(runPublisher(undefined, home)).rejects.toThrow(/JSON-serializable/i);
    await expect(readFile(lockPath(home), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function temporaryHome(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-setup-atomic-home-"));
  temporaryRoots.push(root);
  return root;
}

async function runPublisher(value: unknown, home: string): Promise<void> {
  const command = renderSetupStatePublisherCommand(value, await observeSetupPublisherRuntimeIdentity(), null);
  await execFile("/bin/sh", ["-c", command], { env: { ...process.env, HOME: home } });
}

async function withHome<T>(home: string, action: () => Promise<T>): Promise<T> {
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    return await action();
  } finally {
    process.env.HOME = previous;
  }
}

function lockPath(home: string): string {
  return join(home, ".claude", "claude-code-skillsets", "state", "install-lock.json");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function isolatedApprovedFixture() {
  const fixture = await createApprovedOfficialDecisionIndexSetFixture(process.cwd());
  temporaryRoots.push(fixture.root);
  vi.spyOn(decisionIndexLoader, "isAuthenticatedDecisionIndex")
    .mockImplementation((value) => value === fixture.index);
  vi.spyOn(decisionIndexLoader, "loadInstalledDecisionIndexSet").mockResolvedValue(fixture.indexSet);
  return fixture;
}

async function prepareMaintenanceLoaderHarness(
  fixture: Awaited<ReturnType<typeof createApprovedOfficialDecisionIndexSetFixture>>
): Promise<string> {
  const managerRoot = join(fixture.root, "plugins", "skillset-manager");
  await Promise.all([
    cp(join(process.cwd(), "src"), join(fixture.root, "src"), { recursive: true }),
    cp(join(process.cwd(), "schemas"), join(fixture.root, "schemas"), { recursive: true }),
    symlink(join(process.cwd(), "node_modules"), join(fixture.root, "node_modules"), "dir"),
    mkdir(join(managerRoot, "data"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(managerRoot, "data", "decision-index.json"), fixture.raw, "utf8"),
    writeFile(join(fixture.root, "package.json"), '{"type":"module"}\n', "utf8"),
    cp(
      join(process.cwd(), "plugins", "skillset-manager", "maintenance-policy.json"),
      join(managerRoot, "maintenance-policy.json")
    )
  ]);
  return fixture.root;
}

function secondsAfter(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString().replace(".000Z", "Z");
}
