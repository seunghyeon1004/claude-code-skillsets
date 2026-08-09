import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SoloSemanticRcDependencies } from "../../scripts/release/run-solo-semantic-rc.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local sole-maintainer semantic RC", () => {
  it("binds a read-only fixture evaluation to the exact clean local main SHA", async () => {
    const root = await repository();
    const module = await import("../../scripts/release/run-solo-semantic-rc.js").catch(() => null);
    expect(module).not.toBeNull();
    const commitSha = git(root, ["rev-parse", "HEAD"]);

    await expect(module!.verifyLocalSemanticRcTarget(
      { root, commitSha },
      successfulDependencies(root)
    )).resolves.toEqual({
      schemaVersion: 6,
      receiptType: "local-semantic-rc-target",
      commitSha,
      routingIndexPath: "plugins/skillset-manager/data/routing-index.json",
      routingIndexByteLength: semanticData.routingByteLength,
      routingIndexBytesSha256: semanticData.routingBytesSha256,
      routingIndexDigest: semanticData.routingDigest,
      routingDecisionIndexDigest: semanticData.decisionDigest,
      catalogVersion: semanticData.catalogVersion,
      catalogObservedThrough: semanticData.observedThrough,
      catalogExpiresAt: semanticData.catalogExpiresAt,
      decisionIndexDigest: semanticData.decisionDigest,
      decisionIndexByteLength: semanticData.decisionByteLength,
      decisionIndexBytesSha256: semanticData.decisionBytesSha256,
      subscriptionAuthMode: "claude.ai",
      semanticHarnessStatus: "not-run",
      executableAvailability: "none",
      executionMode: "subscription-claude-cli-fixture-read-only",
      humanReviewGuarantee: "not-guaranteed"
    });

    await expect(module!.verifyLocalSemanticRcTarget(
      { root, commitSha: "a".repeat(40) },
      successfulDependencies(root)
    )).rejects.toThrow(/exact main tip/i);
    await writeFile(join(root, "dirty.txt"), "dirty\n");
    await expect(module!.verifyLocalSemanticRcTarget(
      { root, commitSha },
      successfulDependencies(root)
    )).rejects.toThrow(/clean/i);
  });

  it("rejects API and alternate-provider routing before resolving or invoking Claude", async () => {
    const root = await repository();
    const module = await import("../../scripts/release/run-solo-semantic-rc.js");
    let commitSha = git(root, ["rev-parse", "HEAD"]);
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY"
    ]) {
      let invoked = false;
      await expect(module.verifyLocalSemanticRcTarget({ root, commitSha }, {
        ...successfulDependencies(root),
        environment: { PATH: "/usr/bin:/bin", HOME: root, [key]: "configured" },
        resolveExecutable: async () => {
          invoked = true;
          throw new Error("must not resolve");
        }
      })).rejects.toThrow(new RegExp(key));
      expect(invoked).toBe(false);
    }
  });

  it("requires canonical Claude subscription auth and rejects every non-subscription status", async () => {
    const root = await repository();
    const module = await import("../../scripts/release/run-solo-semantic-rc.js");
    let commitSha = git(root, ["rev-parse", "HEAD"]);
    for (const status of [
      { loggedIn: false, authMethod: "claude.ai" },
      { loggedIn: true, authMethod: "apiKey" },
      { loggedIn: true, authMethod: "bedrock" },
      {
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        email: "redacted@example.test",
        orgId: "fixture-org",
        orgName: "Fixture Org",
        subscriptionType: "pro",
        extra: "untrusted"
      },
      "not-json"
    ]) {
      await expect(module.verifyLocalSemanticRcTarget({ root, commitSha }, {
        ...successfulDependencies(root),
        runClaudeAuthStatus: async (_executable, args) => {
          expect(args).toEqual(["auth", "status", "--json"]);
          return typeof status === "string" ? status : JSON.stringify(status);
        }
      })).rejects.toThrow(/subscription|auth status|claude\.ai/i);
    }

    const dependencies = successfulDependencies(root);
    dependencies.resolveExecutable = async (name) => {
      return join(root, "bin", name === "claude" ? "claude-link" : "npm");
    };
    await symlink(join(root, "bin", "claude"), join(root, "bin", "claude-link"));
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "add executable link"]);
    commitSha = git(root, ["rev-parse", "HEAD"]);
    let observedExecutable = "";
    dependencies.runClaudeAuthStatus = async (executable, args, environment) => {
      observedExecutable = executable;
      expect(args).toEqual(["auth", "status", "--json"]);
      expect(Object.keys(environment).sort()).toEqual([
        "HOME", "LANG", "LC_ALL", "NO_COLOR", "PATH", "TERM", "TMPDIR"
      ]);
      return claudeAiStatus();
    };
    await expect(module.verifyLocalSemanticRcTarget({ root, commitSha }, dependencies)).resolves.toBeDefined();
    expect(observedExecutable).toBe(join(root, "bin", "claude"));
  });

  it("fails authentication and routing integrity before creating any artifact", async () => {
    const root = await repository();
    const module = await import("../../scripts/release/run-solo-semantic-rc.js");
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    const outputDirectory = join(root, ".rc-artifacts", commitSha);

    await expect(module.runSoloSemanticRc({
      root,
      commitSha,
      outputDirectory,
      execute: true,
      approvedReadOnly: true
    }, {
      ...successfulDependencies(root),
      runClaudeAuthStatus: async () => JSON.stringify({
        ...JSON.parse(claudeAiStatus()),
        loggedIn: false
      })
    })).rejects.toThrow(/subscription|logged/i);
    await expect(access(join(root, ".rc-artifacts"))).rejects.toMatchObject({ code: "ENOENT" });

    const routingPath = join(root, "plugins", "skillset-manager", "data", "routing-index.json");
    const routing = JSON.parse(await readFile(routingPath, "utf8")) as Record<string, unknown>;
    await writeFile(routingPath, `${JSON.stringify({ ...routing, digest: "f".repeat(64) }, null, 2)}\n`);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "tampered routing"]);
    const tamperedSha = git(root, ["rev-parse", "HEAD"]);
    await expect(module.runSoloSemanticRc({
      root,
      commitSha: tamperedSha,
      outputDirectory: join(root, ".rc-artifacts", tamperedSha),
      execute: true,
      approvedReadOnly: true
    }, successfulDependencies(root))).rejects.toThrow(/routing.*digest/i);
    await expect(access(join(root, ".rc-artifacts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked routing input before authentication or artifact creation", async () => {
    const root = await repository();
    const module = await import("../../scripts/release/run-solo-semantic-rc.js");
    const routingPath = join(root, "plugins", "skillset-manager", "data", "routing-index.json");
    await rm(routingPath);
    await symlink(
      join(projectRoot, "plugins", "skillset-manager", "data", "routing-index.json"),
      routingPath
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "symlink routing input"]);
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    let authInvoked = false;

    await expect(module.runSoloSemanticRc({
      root,
      commitSha,
      outputDirectory: join(root, ".rc-artifacts", commitSha),
      execute: true,
      approvedReadOnly: true
    }, {
      ...successfulDependencies(root),
      runClaudeAuthStatus: async () => {
        authInvoked = true;
        return claudeAiStatus();
      }
    })).rejects.toThrow(/regular non-symlink/i);
    expect(authInvoked).toBe(false);
    await expect(access(join(root, ".rc-artifacts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("passes only the allowlisted environment to every evaluation child", async () => {
    const root = await repository();
    const module = await import("../../scripts/release/run-solo-semantic-rc.js");
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    const calls: Array<{ executable: string; args: string[]; environment: Record<string, string> }> = [];
    const dependencies = successfulDependencies(root);
    dependencies.runEvaluationCommand = async (executable, args, environment) => {
      calls.push({ executable, args: [...args], environment: { ...environment } });
    };

    await module.runSoloSemanticRc({
      root,
      commitSha,
      outputDirectory: join(root, ".rc-artifacts", commitSha),
      execute: true,
      approvedReadOnly: true
    }, dependencies);

    expect(calls).toHaveLength(7);
    for (const call of calls) {
      expect(call.executable).toBe(join(root, "bin", "tsx"));
      expect(Object.keys(call.environment).sort()).toEqual([
        "HOME", "LANG", "LC_ALL", "NO_COLOR", "PATH",
        "SEMANTIC_RC_CLAUDE_EXECUTABLE", "SEMANTIC_RC_CLAUDE_SHA256",
        "TERM", "TMPDIR"
      ]);
      expect(call.environment).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(call.environment.PATH?.split(":" )[0]).toBe(dirname(process.execPath));
      expect(call.environment.SEMANTIC_RC_CLAUDE_EXECUTABLE).toBe(join(root, "bin", "claude"));
      expect(call.environment.SEMANTIC_RC_CLAUDE_SHA256).toBe(sha256(
        await readFile(join(root, "bin", "claude"), "utf8")
      ));
      expect(call.args[0]).toMatch(/\/src\/evaluate\/(?:setup|setup-preview|maintain|doctor|shared-core|sanitize)\.ts$/u);
      expect(call.args).not.toContain("run");
    }
    const receipt = JSON.parse(await readFile(
      join(root, ".rc-artifacts", commitSha, "raw", "governance", "local-semantic-rc-target.json"),
      "utf8"
    )) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      schemaVersion: 6,
      commitSha,
      subscriptionAuthMode: "claude.ai",
      semanticHarnessStatus: "passed",
      executableAvailability: "none",
      routingIndexDigest: semanticData.routingDigest,
      decisionIndexDigest: semanticData.decisionDigest
    });
  });

  it("rejects replacement of the canonical tsx executable without falling back to PATH or npm", async () => {
    const root = await repository();
    const module = await import("../../scripts/release/run-solo-semantic-rc.js");
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    const dependencies = successfulDependencies(root);
    const approvedTsx = join(root, "bin", "tsx");
    let callCount = 0;
    dependencies.environment = {
      ...dependencies.environment,
      PATH: "/tmp/attacker-controlled:/usr/bin:/bin"
    };
    dependencies.runEvaluationCommand = async (executable, args) => {
      callCount += 1;
      expect(executable).toBe(approvedTsx);
      expect(args[0]).toBe(join(root, "src", "evaluate", "setup.ts"));
      await writeFile(approvedTsx, "#!/bin/sh\nexit 98\n");
    };

    await expect(module.runSoloSemanticRc({
      root,
      commitSha,
      outputDirectory: join(root, ".rc-artifacts", commitSha),
      execute: true,
      approvedReadOnly: true
    }, dependencies)).rejects.toThrow(/tsx.*(?:changed|identity|SHA-256)/i);
    expect(callCount).toBe(1);
  });

  it("requires explicit read-only approval before it can invoke local Claude CLI evaluations", async () => {
    const module = await import("../../scripts/release/run-solo-semantic-rc.js").catch(() => null);
    expect(module).not.toBeNull();

    expect(() => module!.parseSoloSemanticRcOptions([
      "--commit-sha", "a".repeat(40), "--output-dir", join(process.cwd(), ".rc-artifacts", "a".repeat(40)), "--execute"
    ])).toThrow(/approved-read-only/i);
    expect(module!.parseSoloSemanticRcOptions([
      "--commit-sha", "a".repeat(40), "--output-dir", join(process.cwd(), ".rc-artifacts", "a".repeat(40)), "--execute", "--approved-read-only"
    ])).toMatchObject({ execute: true, approvedReadOnly: true });

    const root = await repository();
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    let evaluationInvoked = false;
    await expect(module!.runSoloSemanticRc({
      root,
      commitSha,
      outputDirectory: join(root, ".rc-artifacts", commitSha),
      execute: true,
      approvedReadOnly: false
    }, {
      ...successfulDependencies(root),
      runEvaluationCommand: async () => {
        evaluationInvoked = true;
      }
    })).rejects.toThrow(/approved-read-only|read-only approval/i);
    expect(evaluationInvoked).toBe(false);
    await expect(access(join(root, ".rc-artifacts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ignores PATH git shadows and inherited GIT_* repository redirection", async () => {
    const root = await repository();
    const redirectedRoot = await repository();
    await writeFile(join(redirectedRoot, "tracked.txt"), "different repository\n");
    git(redirectedRoot, ["add", "."]);
    git(redirectedRoot, ["commit", "-q", "-m", "different candidate"]);
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    expect(git(redirectedRoot, ["rev-parse", "HEAD"])).not.toBe(commitSha);

    const shadowDirectory = await realpath(await mkdtemp(join(tmpdir(), "semantic-rc-git-shadow-")));
    roots.push(shadowDirectory);
    const marker = join(shadowDirectory, "git-shadow-invoked");
    await writeFile(
      join(shadowDirectory, "git"),
      `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexec /usr/bin/git "$@"\n`
    );
    await chmod(join(shadowDirectory, "git"), 0o755);

    const previous = {
      PATH: process.env.PATH,
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE
    };
    process.env.PATH = `${shadowDirectory}:/usr/bin:/bin`;
    process.env.GIT_DIR = join(redirectedRoot, ".git");
    process.env.GIT_WORK_TREE = redirectedRoot;
    try {
      const module = await import("../../scripts/release/run-solo-semantic-rc.js");
      await expect(module.verifyLocalSemanticRcTarget(
        { root, commitSha },
        successfulDependencies(root)
      )).resolves.toMatchObject({ commitSha });
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      restoreEnvironment("PATH", previous.PATH);
      restoreEnvironment("GIT_DIR", previous.GIT_DIR);
      restoreEnvironment("GIT_WORK_TREE", previous.GIT_WORK_TREE);
    }
  });

  it("revalidates the exact Git and decision-index snapshot before writing a passed receipt", async () => {
    const module = await import("../../scripts/release/run-solo-semantic-rc.js");
    const mutations: Array<[string, (root: string) => Promise<void>]> = [
      ["dirty worktree", async (root) => {
        await writeFile(join(root, "tracked.txt"), "mutated during semantic evaluation\n");
      }],
      ["advanced main tip", async (root) => {
        await writeFile(join(root, "tracked.txt"), "committed during semantic evaluation\n");
        git(root, ["add", "tracked.txt"]);
        git(root, ["commit", "-q", "-m", "advance during evaluation"]);
      }],
      ["hidden routing snapshot change", async (root) => {
        const relative = "plugins/skillset-manager/data/routing-index.json";
        git(root, ["update-index", "--assume-unchanged", relative]);
        await writeFile(join(root, relative), `${semanticData.routingRaw} `);
      }]
    ];

    for (const [label, mutate] of mutations) {
      const root = await repository();
      const commitSha = git(root, ["rev-parse", "HEAD"]);
      const outputDirectory = join(root, ".rc-artifacts", commitSha);
      let callCount = 0;
      const dependencies = successfulDependencies(root);
      dependencies.runEvaluationCommand = async () => {
        callCount += 1;
        if (callCount === 5) await mutate(root);
      };

      await expect(module.runSoloSemanticRc({
        root,
        commitSha,
        outputDirectory,
        execute: true,
        approvedReadOnly: true
      }, dependencies), label).rejects.toThrow(/clean|snapshot|routing|changed|main tip/i);
      await expect(access(join(
        outputDirectory,
        "raw",
        "governance",
        "local-semantic-rc-target.json"
      )), label).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects every output path except the canonical repo-owned exact-SHA directory without deleting data", async () => {
    const module = await import("../../scripts/release/run-solo-semantic-rc.js").catch(() => null);
    expect(module).not.toBeNull();
    const root = await repository();
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    const outside = await mkdtemp(join(tmpdir(), "semantic-rc-victim-"));
    roots.push(outside);
    const victim = join(outside, "keep.txt");
    await writeFile(victim, "keep\n");
    const invalid = [
      outside,
      join(root, "..", "victim"),
      root,
      homedir(),
      join(root, ".rc-artifacts", "b".repeat(40))
    ];
    for (const outputDirectory of invalid) {
      await expect(module!.runSoloSemanticRc({
        root,
        commitSha,
        outputDirectory,
        execute: true,
        approvedReadOnly: true
      })).rejects.toThrow(/canonical|output|exact.*SHA|repo-owned/i);
      await expect(readFile(victim, "utf8")).resolves.toBe("keep\n");
    }

    const linkedOutside = await mkdtemp(join(tmpdir(), "semantic-rc-linked-victim-"));
    roots.push(linkedOutside);
    await writeFile(join(linkedOutside, "keep.txt"), "linked-keep\n");
    await symlink(linkedOutside, join(root, ".rc-artifacts"));
    await expect(module!.runSoloSemanticRc({
      root,
      commitSha,
      outputDirectory: join(root, ".rc-artifacts", commitSha),
      execute: true,
      approvedReadOnly: true
    })).rejects.toThrow(/symbolic link|symlink/i);
    await expect(readFile(join(linkedOutside, "keep.txt"), "utf8")).resolves.toBe("linked-keep\n");
  });

  it("rejects a noncanonical raw CLI output path before creating the exact-SHA directory", async () => {
    const module = await import("../../scripts/release/run-solo-semantic-rc.js").catch(() => null);
    expect(module).not.toBeNull();
    const root = await repository();
    const commitSha = git(root, ["rev-parse", "HEAD"]);
    const exactOutput = join(root, ".rc-artifacts", commitSha);
    const parsed = module!.parseSoloSemanticRcOptions([
      "--root", root,
      "--commit-sha", commitSha,
      "--output-dir", exactOutput
    ]);
    expect(parsed.outputDirectory).toBe(exactOutput);
    await expect(module!.runSoloSemanticRc(parsed, successfulDependencies(root)))
      .resolves.toMatchObject({ commitSha });

    const result = spawnSync(
      join(projectRoot, "node_modules", ".bin", "tsx"),
      [
        join(projectRoot, "scripts", "release", "run-solo-semantic-rc.ts"),
        "--root", root,
        "--commit-sha", commitSha,
        "--output-dir", `${root}/.rc-artifacts/junk/../${commitSha}`,
        "--execute",
        "--approved-read-only"
      ],
      { encoding: "utf8" }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/canonical.*repo-owned.*exact-SHA|must be (?:a )?canonical/i);
    await expect(access(join(root, ".rc-artifacts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses no self-hosted runner, protected environment, special branch-protection token, or remote Claude call", async () => {
    const [packageJson, releaseGuide, script] = await Promise.all([
      readFile(join(projectRoot, "package.json"), "utf8"),
      readFile(join(projectRoot, "docs", "release", "github-free-staged-public.md"), "utf8"),
      readFile(join(projectRoot, "scripts", "release", "run-solo-semantic-rc.ts"), "utf8")
    ]);
    const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;

    expect(scripts["verify:solo-semantic-rc"]).toBe("tsx scripts/release/run-solo-semantic-rc.ts");
    expect(scripts["verify:private-rc-target"]).toBeUndefined();
    expect(script).toContain("--approved-read-only");
    expect(script).toContain('"setup.ts"');
    expect(script).toContain('"setup-preview.ts"');
    expect(script).toContain('"maintain.ts"');
    expect(script).toContain('"doctor.ts"');
    expect(script).toContain('"shared-core.ts"');
    expect(script).toContain('"sanitize.ts"');
    expect(script).not.toContain("npmExecutable");
    expect(script).not.toContain('["run", "eval:');
    expect(script).not.toMatch(/gh api|BRANCH_PROTECTION_READ_TOKEN|self-hosted|private-rc/i);
    const setupEvaluator = await readFile(join(projectRoot, "src", "evaluate", "setup.ts"), "utf8");
    expect(setupEvaluator).toContain('"--safe-mode"');
    expect(setupEvaluator).toContain('args.push("--tools", ...allowedTools)');
    expect(setupEvaluator).toContain('allowedTools: ["Read"]');
    expect(setupEvaluator).toContain("additionalDirectories: [evaluationCase.fixturePluginRoot]");
    expect(releaseGuide).toMatch(/local subscription Claude CLI[\s\S]*read-only fixture/i);
    expect(releaseGuide).toMatch(/human review is not guaranteed/i);
    await expect(readFile(join(projectRoot, ".github", "workflows", "private-rc.yml"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function repository(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "solo-semantic-rc-")));
  roots.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Semantic RC Test"]);
  git(root, ["config", "user.email", "semantic-rc@example.test"]);
  await Promise.all([
    mkdir(join(root, "plugins", "skillset-manager", "data"), { recursive: true }),
    mkdir(join(root, "bin"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(root, "tracked.txt"), "tracked\n"),
    writeFile(join(root, ".gitignore"), ".rc-artifacts\n"),
    writeFile(join(root, "plugins", "skillset-manager", "data", "decision-index.json"), semanticData.decisionRaw),
    writeFile(join(root, "plugins", "skillset-manager", "data", "routing-index.json"), semanticData.routingRaw),
    writeFile(join(root, "bin", "claude"), "#!/bin/sh\nexit 99\n"),
    writeFile(join(root, "bin", "tsx"), "#!/bin/sh\nexit 99\n")
  ]);
  await Promise.all([
    chmod(join(root, "bin", "claude"), 0o755),
    chmod(join(root, "bin", "tsx"), 0o755)
  ]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "candidate"]);
  return root;
}

function successfulDependencies(root: string): SoloSemanticRcDependencies {
  return {
    environment: {
      PATH: `${join(root, "bin")}:/usr/bin:/bin`,
      HOME: root,
      TMPDIR: tmpdir(),
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      NO_COLOR: "1",
      TERM: "xterm-256color"
    },
    tsxExecutablePath: join(root, "bin", "tsx"),
    resolveExecutable: async (name: string) => join(root, "bin", name),
    runClaudeAuthStatus: async () => claudeAiStatus(),
    runEvaluationCommand: async () => undefined
  };
}

const decisionRaw = await readFile(join(
  projectRoot, "plugins", "skillset-manager", "data", "decision-index.json"
), "utf8");
const routingRaw = await readFile(join(
  projectRoot, "plugins", "skillset-manager", "data", "routing-index.json"
), "utf8");
const decisionDocument = JSON.parse(decisionRaw) as {
  digest: string;
  catalogVersion: string;
  observedThrough: string;
  catalogExpiresAt: string;
};
const routingDocument = JSON.parse(routingRaw) as { digest: string };
const semanticData = {
  decisionDigest: decisionDocument.digest,
  decisionRaw,
  decisionByteLength: Buffer.byteLength(decisionRaw, "utf8"),
  decisionBytesSha256: sha256(decisionRaw),
  catalogVersion: decisionDocument.catalogVersion,
  observedThrough: decisionDocument.observedThrough,
  catalogExpiresAt: decisionDocument.catalogExpiresAt,
  routingDigest: routingDocument.digest,
  routingRaw,
  routingByteLength: Buffer.byteLength(routingRaw, "utf8"),
  routingBytesSha256: sha256(routingRaw)
};

function claudeAiStatus(): string {
  return JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    email: "redacted@example.test",
    orgId: "fixture-org",
    orgName: "Fixture Org",
    subscriptionType: "pro"
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}


function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
