import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type {
  ResearchCollectionReceipt,
  ResearchSnapshot,
  ResearchSourceConfig
} from "../../src/model/complete-v1.js";
import {
  collectResearchSource,
  collectAndStageObservationEvidence,
  createGitCliTransport,
  GitCliTransport,
  main,
  resolveSafeOutputPath,
  type GitCommandRunner,
  writeSnapshotAndReceiptAtomically,
  type GitTreeTransport
} from "../../scripts/research/collect-github-tree.js";
import { computeSnapshotContentSha256 } from "../../src/research/snapshot.js";

const execFile = promisify(execFileCallback);
const sha = "1".repeat(40);

const validConfig: ResearchSourceConfig = {
  schemaVersion: 2,
  sourceId: "fixture",
  repository: "https://github.com/example/fixture",
  queryUrls: ["https://github.com/example/fixture"],
  reportedCountClaims: [],
  markdownIndexPaths: []
};

function publicationFixture(): { snapshot: ResearchSnapshot; receipt: ResearchCollectionReceipt } {
  const entries = [{
    kind: "repository-record" as const,
    address: ".",
    sourceUrl: "https://github.com/example/fixture"
  }];
  const snapshot: ResearchSnapshot = {
    schemaVersion: 2,
    id: "2026-07-23-fixture",
    sourceUrl: "https://github.com/example/fixture",
    queryUrls: ["https://github.com/example/fixture"],
    observedAt: "2026-07-23T06:00:00Z",
    inspectedRef: "refs/heads/main",
    inspectedCommit: sha,
    collectionMethod: "git-tree-and-marketplace-v1",
    toolVersion: "0.1.0",
    entries,
    countMetrics: [{
      kind: "repository-record",
      reportedCount: null,
      reportedCountSourceUrl: null,
      independentlyCountedTotal: 1
    }],
    contentSha256: computeSnapshotContentSha256(entries)
  };
  return {
    snapshot,
    receipt: {
      schemaVersion: 2,
      id: snapshot.id,
      sourceId: "fixture",
      snapshotId: snapshot.id,
      observedAt: snapshot.observedAt,
      inspectedCommit: snapshot.inspectedCommit,
      collectorVersion: snapshot.toolVersion,
      independentCounts: [{ kind: "repository-record", count: 1 }],
      snapshotContentSha256: snapshot.contentSha256
    }
  };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout;
}

async function localBareFixtureTransport(): Promise<GitTreeTransport> {
  const root = await mkdtemp(join(tmpdir(), "research-collector-"));
  const worktree = join(root, "worktree");
  const bare = join(root, "fixture.git");
  await mkdir(worktree);
  await runGit(worktree, ["init", "--initial-branch=main"]);
  await runGit(worktree, ["config", "user.email", "fixture@example.test"]);
  await runGit(worktree, ["config", "user.name", "Fixture"]);
  await mkdir(join(worktree, "skills", "example"), { recursive: true });
  await mkdir(join(worktree, ".claude-plugin"), { recursive: true });
  await writeFile(join(worktree, "skills", "example", "SKILL.md"), "# Fixture\n", "utf8");
  await writeFile(join(worktree, ".claude-plugin", "plugin.json"), "{}\n", "utf8");
  await writeFile(
    join(worktree, ".claude-plugin", "marketplace.json"),
    "{\"plugins\":[{\"source\":\"https://github.com/example/original\"}]}\n",
    "utf8"
  );
  await runGit(worktree, ["add", "."]);
  await runGit(worktree, ["commit", "-m", "fixture"]);
  const { stdout: commit } = await execFile("git", ["-C", worktree, "rev-parse", "HEAD"]);
  await runGit(root, ["init", "--bare", bare]);
  await runGit(worktree, ["remote", "add", "origin", bare]);
  await runGit(worktree, ["push", "origin", "HEAD:refs/heads/main"]);

  return {
    resolveHead: async () => ({ ref: "refs/heads/main", commit: commit.trim() }),
    listPaths: async (_repository, inspectedCommit) => (await execFile(
      "git", ["--git-dir", bare, "ls-tree", "-r", "--name-only", inspectedCommit]
    )).stdout.split("\n").filter(Boolean),
    listBlobs: async (_repository, inspectedCommit) => (await execFile(
      "git", ["--git-dir", bare, "ls-tree", "-r", "-l", inspectedCommit]
    )).stdout.split("\n").filter(Boolean).map((line) => {
      const match = /^\d{6} blob ([a-f0-9]{40}) +(\d+)\t(.+)$/u.exec(line);
      if (match === null) throw new Error(`invalid fixture blob entry: ${line}`);
      return { path: match[3]!, gitBlobSha: match[1]!, byteSize: Number(match[2]) };
    }),
    readBlob: async (_repository, inspectedCommit, path) => Buffer.from((await execFile(
      "git", ["--git-dir", bare, "show", `${inspectedCommit}:${path}`]
    )).stdout, "utf8"),
    dispose: vi.fn(async () => rm(root, { recursive: true, force: true }))
  };
}

function fixtureTransportFor(fault: "truncated-marketplace" | "duplicate-address" | "unresolved-commit"): GitTreeTransport {
  return {
    resolveHead: async () => ({ ref: "refs/heads/main", commit: fault === "unresolved-commit" ? "bad" : sha }),
    listPaths: async () => fault === "duplicate-address"
      ? ["skills/example/SKILL.md", "skills/example/SKILL.md"]
      : [".claude-plugin/marketplace.json"],
    listBlobs: async () => [],
    readBlob: async () => Buffer.from(fault === "truncated-marketplace" ? "{" : "{\"plugins\":[]}", "utf8"),
    dispose: vi.fn(async () => undefined)
  };
}

describe("research collector", () => {
  it("publishes no files when collection fails before the staging commit", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "observation-staging-"));
    const transport: GitTreeTransport = {
      resolveHead: async () => ({ ref: "refs/heads/main", commit: sha }),
      listPaths: async () => [],
      listBlobs: async () => [
        { path: "plugin.json", gitBlobSha: "b".repeat(40), byteSize: 2 },
        { path: "package.json", gitBlobSha: "not-a-git-blob", byteSize: 2 }
      ],
      readBlob: async () => Buffer.from("{}", "utf8"),
      dispose: vi.fn(async () => undefined)
    };
    try {
      await expect(collectAndStageObservationEvidence({
        config: validConfig,
        observationId: "2026-07-29-fixture",
        observedAt: "2026-07-29T00:00:00Z",
        stagingDirectory: outputRoot,
        transport
      })).rejects.toThrow(/git blob SHA/i);

      expect(await readdir(outputRoot)).toEqual([]);
      expect(transport.dispose).toHaveBeenCalledTimes(1);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("collects a closed tree at one immutable commit from a local bare Git fixture", async () => {
    const transport = await localBareFixtureTransport();

    const result = await collectResearchSource({
      config: validConfig,
      snapshotId: "2026-07-23-fixture",
      observedAt: "2026-07-23T06:00:00Z",
      toolVersion: "0.1.0",
      transport
    });

    expect(result.snapshot.inspectedCommit).toMatch(/^[a-f0-9]{40}$/u);
    expect(result.snapshot.entries.map(({ kind, address }) => [kind, address])).toEqual([
      ["marketplace-entry", ".claude-plugin/marketplace.json#/plugins/0"],
      ["plugin-manifest", ".claude-plugin/plugin.json"],
      ["repository-record", "."],
      ["skill-file", "skills/example/SKILL.md"]
    ]);
    expect(result.receipt.id).toBe(result.snapshot.id);
    expect(result.receipt.independentCounts).toEqual(
      result.snapshot.countMetrics.map(({ kind, independentlyCountedTotal: count }) => ({ kind, count }))
    );
    expect(transport.dispose).toHaveBeenCalledTimes(1);
  });

  it("collects a configured Markdown GitHub link as a repository record", async () => {
    const transport: GitTreeTransport = {
      resolveHead: async () => ({ ref: "refs/heads/main", commit: sha }),
      listPaths: async () => ["README.md"],
      listBlobs: async () => [],
      readBlob: async () => Buffer.from("See https://github.com/example/original.", "utf8"),
      dispose: vi.fn(async () => undefined)
    };
    const result = await collectResearchSource({
      config: { ...validConfig, markdownIndexPaths: ["README.md"] },
      snapshotId: "2026-07-23-fixture",
      observedAt: "2026-07-23T06:00:00Z",
      toolVersion: "0.1.0",
      transport
    });

    expect(result.snapshot.entries).toEqual([
      { kind: "repository-record", address: ".", sourceUrl: "https://github.com/example/fixture" },
      { kind: "repository-record", address: "README.md#link/0", sourceUrl: "https://github.com/example/original" }
    ]);
    expect(transport.dispose).toHaveBeenCalledTimes(1);
  });

  it("uses one exact shallow full-blob fetch and decodes NUL-delimited Unicode and newline paths", async () => {
    const commands: Array<{ args: readonly string[]; cwd: string | undefined }> = [];
    const runner: GitCommandRunner = async (args, cwd) => {
      commands.push({ args: [...args], cwd });
      if (args[0] === "ls-remote") {
        return Buffer.from(`ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`, "utf8");
      }
      if (args[0] === "ls-tree") {
        if (args.includes("-l")) {
          return Buffer.from(
            `160000 commit ${"c".repeat(40)}       -\tvendor/fixture${"\0"}040000 tree ${"d".repeat(40)}       -\tskills${"\0"}100644 blob ${sha} 7\tskills/한글/SKILL.md${"\0"}100644 blob ${"b".repeat(40)} 8\t.claude-plugin/marketplace.json${"\0"}100644 blob ${"d".repeat(40)} 9\tskills/new\nline/SKILL.md\0`,
            "utf8"
          );
        }
        return Buffer.from(`skills/한글/SKILL.md\0.claude-plugin/marketplace.json\0`, "utf8");
      }
      if (args[0] === "show") {
        return Buffer.from("fixture", "utf8");
      }
      return Buffer.alloc(0);
    };
    const transport = createGitCliTransport(validConfig.repository, runner);
    const { commit } = await transport.resolveHead(validConfig.repository);
    const paths = await transport.listPaths(validConfig.repository, commit);
    const blobs = await transport.listBlobs(validConfig.repository, commit);
    await transport.readBlob(validConfig.repository, commit, "skills/한글/SKILL.md");
    const cloneRoot = commands.find(({ args }) => args[0] === "init")?.cwd;
    await transport.dispose();

    expect(paths).toEqual(["skills/한글/SKILL.md", ".claude-plugin/marketplace.json"]);
    expect(blobs).toEqual([
      { path: "skills/한글/SKILL.md", gitBlobSha: sha, byteSize: 7 },
      { path: ".claude-plugin/marketplace.json", gitBlobSha: "b".repeat(40), byteSize: 8 },
      { path: "skills/new\nline/SKILL.md", gitBlobSha: "d".repeat(40), byteSize: 9 }
    ]);
    expect(commands.map(({ args }) => args)).toEqual([
      ["ls-remote", "--symref", validConfig.repository, "HEAD"],
      ["init"],
      ["remote", "add", "origin", validConfig.repository],
      ["fetch", "--depth=1", "--no-tags", "origin", sha],
      ["ls-tree", "-rz", "--name-only", sha],
      ["ls-tree", "-rz", "-l", sha],
      ["show", `${sha}:skills/한글/SKILL.md`]
    ]);
    const fetchCommands = commands.filter(({ args }) => args[0] === "fetch").map(({ args }) => args);
    expect(fetchCommands).toEqual([["fetch", "--depth=1", "--no-tags", "origin", sha]]);
    expect(fetchCommands.flat().some((argument) => argument.startsWith("--filter"))).toBe(false);
    expect(commands.some(({ args }) => args[0] === "checkout")).toBe(false);
    expect(commands.filter(({ args }) => args[0] === "show")).toHaveLength(1);
    expect(cloneRoot).toBeDefined();
    await expect(access(cloneRoot!)).rejects.toThrow();
  });

  it("disposes the temporary clone when the exact shallow full-blob fetch fails", async () => {
    const commands: Array<{ args: readonly string[]; cwd: string | undefined }> = [];
    const runner: GitCommandRunner = async (args, cwd) => {
      commands.push({ args: [...args], cwd });
      if (args[0] === "ls-remote") {
        return Buffer.from(`ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`, "utf8");
      }
      if (args[0] === "fetch") throw new Error("fixture fetch failed");
      return Buffer.alloc(0);
    };
    const transport = createGitCliTransport(validConfig.repository, runner);

    await expect(collectResearchSource({
      config: validConfig,
      snapshotId: "2026-07-23-fixture",
      observedAt: "2026-07-23T06:00:00Z",
      toolVersion: "0.1.0",
      transport
    })).rejects.toThrow("fixture fetch failed");

    const cloneRoot = commands.find(({ args }) => args[0] === "init")?.cwd;
    const fetchCommands = commands.filter(({ args }) => args[0] === "fetch").map(({ args }) => args);
    expect(fetchCommands).toEqual([["fetch", "--depth=1", "--no-tags", "origin", sha]]);
    expect(fetchCommands.flat().some((argument) => argument.startsWith("--filter"))).toBe(false);
    expect(commands.some(({ args }) => ["checkout", "ls-tree", "show"].includes(args[0] ?? ""))).toBe(false);
    expect(cloneRoot).toBeDefined();
    await expect(access(cloneRoot!)).rejects.toThrow();
  });

  it.each([
    ["truncated-marketplace", /invalid marketplace JSON/],
    ["duplicate-address", /duplicate/i],
    ["unresolved-commit", /unresolved commit/]
  ] as const)("fails closed and disposes exactly once: %s", async (fault, expected) => {
    const transport = fixtureTransportFor(fault);

    await expect(collectResearchSource({
      config: validConfig,
      snapshotId: "2026-07-23-fixture",
      observedAt: "2026-07-23T06:00:00Z",
      toolVersion: "0.1.0",
      transport
    })).rejects.toThrow(expected);
    expect(transport.dispose).toHaveBeenCalledTimes(1);
  });

  it("ships the exact 15 source configs and collector package script", async () => {
    const expectedSources = [
      ["anthropic-plugins-official", "https://github.com/anthropics/claude-plugins-official", []],
      ["anthropic-skills", "https://github.com/anthropics/skills", []],
      ["obra-superpowers", "https://github.com/obra/superpowers", []],
      ["wshobson-agents", "https://github.com/wshobson/agents", []],
      ["coreyhaines31-marketingskills", "https://github.com/coreyhaines31/marketingskills", []],
      ["deanpeters-product-manager-skills", "https://github.com/deanpeters/Product-Manager-Skills", []],
      ["daymade-claude-code-skills", "https://github.com/daymade/claude-code-skills", []],
      ["k-dense-scientific-agent-skills", "https://github.com/K-Dense-AI/scientific-agent-skills", []],
      ["huggingface-skills", "https://github.com/huggingface/skills", []],
      ["chengfeng-videocut-skills", "https://github.com/Agentchengfeng/chengfeng-videocut-skills", []],
      ["nexscope-ecommerce-skills", "https://github.com/nexscope-ai/eCommerce-Skills", []],
      ["kepano-obsidian-skills", "https://github.com/kepano/obsidian-skills", []],
      ["alirezarezvani-claude-skills", "https://github.com/alirezarezvani/claude-skills", []],
      ["jeremylongshore-plugins-plus-skills", "https://github.com/jeremylongshore/claude-code-plugins-plus-skills", []],
      ["composio-awesome-claude-skills", "https://github.com/ComposioHQ/awesome-claude-skills", ["README.md"]]
    ] as const;
    const repositoryRoot = join(import.meta.dirname, "..", "..");
    const sourceRoot = join(repositoryRoot, "research", "sources");
    const sourceFiles = await readdir(sourceRoot);

    expect(sourceFiles).toEqual(expectedSources.map(([sourceId]) => `${sourceId}.json`).sort());
    for (const [sourceId, repository, markdownIndexPaths] of expectedSources) {
      const value = {
        schemaVersion: 2,
        sourceId,
        repository,
        queryUrls: [repository],
        reportedCountClaims: [],
        markdownIndexPaths
      };
      expect(await readFile(join(sourceRoot, `${sourceId}.json`), "utf8")).toBe(`${JSON.stringify(value, null, 2)}\n`);
    }

    const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["research:collect"]).toBe("tsx scripts/research/collect-github-tree.ts");
  });

  it("rejects non-GitHub transports without invoking Git", () => {
    expect(() => new GitCliTransport("https://example.com/not-github")).toThrow(/HTTPS GitHub repository/);
  });

  it("rejects unsafe and pre-existing output paths before any network collection", async () => {
    const shared = [
      "--config", "research/sources/anthropic-skills.json",
      "--observed-at", "2026-07-23T06:00:00Z",
      "--receipt", "research/sources/anthropic-plugins-official.json"
    ];

    await expect(main([...shared, "--output", "../unsafe.json"])).rejects.toThrow(/unsafe output path/i);
    await expect(main([...shared, "--output", "research/sources/anthropic-skills.json"])).rejects.toThrow(/refusing to overwrite existing output/i);
  });

  it("rejects output and receipt paths with symlinked ancestors outside the real root", async () => {
    const root = await mkdtemp(join(tmpdir(), "research-output-root-"));
    const outside = await mkdtemp(join(tmpdir(), "research-output-outside-"));
    try {
      await mkdir(join(outside, "nested"));
      await symlink(outside, join(root, "linked"));

      await expect(resolveSafeOutputPath("linked/nested/snapshot.json", "output", root)).rejects.toThrow(/unsafe output path/i);
      await expect(resolveSafeOutputPath("linked/nested/receipt.json", "receipt", root)).rejects.toThrow(/unsafe receipt path/i);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("keeps a raced output sentinel intact and rolls back its unpublished peer", async () => {
    const root = await mkdtemp(join(tmpdir(), "research-publication-"));
    const output = join(root, "snapshot.json");
    const receiptPath = join(root, "receipt.json");
    const { snapshot, receipt } = publicationFixture();
    try {
      await expect(writeSnapshotAndReceiptAtomically(output, receiptPath, snapshot, receipt, {
        beforePublish: async () => writeFile(output, "sentinel\n", "utf8")
      })).rejects.toThrow(/EEXIST|exist/i);

      expect(await readFile(output, "utf8")).toBe("sentinel\n");
      await expect(access(receiptPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
