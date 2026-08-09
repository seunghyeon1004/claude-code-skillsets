import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeCliRunner,
  authenticateSetupApprovalBinding,
  executeAndPublishApprovedSetupCandidates,
  executeApprovedSetupCandidates,
  evaluateSetupDecisionFixture,
  evaluateSetupCases,
  exitCodeForSummary,
  parseClaudeMarketplaceList,
  parseClaudePluginList,
  parseClaudeVersion,
  runSetupEvaluationCli,
  setupApprovalPreviewDigest,
  type ModelOutput,
  type ModelRequest,
  type ModelRunner,
  type ToolCall,
  type SetupApprovalBinding,
  type SetupApprovalPreview,
  type SetupDecisionFixture,
  type SetupEvaluationCase,
  type SetupExecutionFixture,
  type SetupPreviewCandidate
} from "../../src/evaluate/setup.js";
import {
  validateSetupDecisionScenarioManifest,
  type SetupDecisionScenario
} from "../../src/contracts/setup-scenario.js";
import {
  decisionRoutingIndexDigest,
  decisionIndexDigest,
  isAuthenticatedDecisionIndex,
  loadInstalledDecisionIndex,
  loadPluginDecisionIndex,
  loadPluginDecisionBoundary,
  loadPluginDecisionIndexSet
} from "../../src/decision/index-loader.js";
import * as decisionIndexLoader from "../../src/decision/index-loader.js";
import type { DecisionRoutingIndex } from "../../src/model/decision.js";
import YAML from "yaml";
import { createApprovedOfficialDecisionIndexFixture } from "../helpers/official-marketplace-fixture.js";

const temporaryDirectories: string[] = [];
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const pluginRoot = join(projectRoot, "plugins", "skillset-manager");
const claude21198FixtureRoot = join(projectRoot, "tests", "fixtures", "claude-2-1-198");
let approvedDecisionIndexRaw: Promise<string> | undefined;
const isolatedDecisionIndexSets = new WeakMap<
  object,
  Awaited<ReturnType<typeof loadPluginDecisionIndexSet>>
>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("setup semantic evaluator", () => {
  it("uses the authenticated canonical Claude executable instead of a PATH shadow", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "setup-claude-identity-")));
    temporaryDirectories.push(root);
    const approvedDirectory = join(root, "approved");
    const shadowDirectory = join(root, "shadow");
    await Promise.all([mkdir(approvedDirectory), mkdir(shadowDirectory)]);
    const approved = join(approvedDirectory, "claude");
    const shadow = join(shadowDirectory, "claude");
    await Promise.all([
      writeFile(approved, "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"result\",\"result\":\"approved\"}'\n"),
      writeFile(shadow, "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"result\",\"result\":\"shadow\"}'\n")
    ]);
    await Promise.all([chmod(approved, 0o755), chmod(shadow, 0o755)]);

    const previous = semanticClaudeEnvironment();
    process.env.PATH = `${shadowDirectory}:/usr/bin:/bin`;
    process.env.SEMANTIC_RC_CLAUDE_EXECUTABLE = approved;
    process.env.SEMANTIC_RC_CLAUDE_SHA256 = sha256Bytes(await readFile(approved));
    try {
      await expect(new ClaudeCliRunner(5_000).run({
        kind: "response",
        systemPrompt: "fixture",
        prompt: "fixture"
      })).resolves.toMatchObject({ text: "approved" });
    } finally {
      restoreSemanticClaudeEnvironment(previous);
    }
  });

  it("rejects an authenticated Claude executable replaced during a call", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "setup-claude-replacement-")));
    temporaryDirectories.push(root);
    const approved = join(root, "claude");
    await writeFile(
      approved,
      "#!/bin/sh\nprintf '#!/bin/sh\\nexit 99\\n' > \"$0\"\nprintf '%s\\n' '{\"type\":\"result\",\"result\":\"untrusted\"}'\n"
    );
    await chmod(approved, 0o755);

    const previous = semanticClaudeEnvironment();
    process.env.PATH = `${root}:/usr/bin:/bin`;
    process.env.SEMANTIC_RC_CLAUDE_EXECUTABLE = approved;
    process.env.SEMANTIC_RC_CLAUDE_SHA256 = sha256Bytes(await readFile(approved));
    try {
      await expect(new ClaudeCliRunner(5_000).run({
        kind: "response",
        systemPrompt: "fixture",
        prompt: "fixture"
      })).rejects.toThrow(/Claude.*(?:changed|identity|SHA-256)/i);
    } finally {
      restoreSemanticClaudeEnvironment(previous);
    }
  });

  it("rechecks the authenticated Claude executable when a call times out", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "setup-claude-timeout-replacement-")));
    temporaryDirectories.push(root);
    const approved = join(root, "claude");
    await writeFile(
      approved,
      "#!/bin/sh\nprintf '#!/bin/sh\\nexit 99\\n' > \"$0\"\nexec /bin/sleep 5\n"
    );
    await chmod(approved, 0o755);

    const previous = semanticClaudeEnvironment();
    process.env.PATH = `${root}:/usr/bin:/bin`;
    process.env.SEMANTIC_RC_CLAUDE_EXECUTABLE = approved;
    process.env.SEMANTIC_RC_CLAUDE_SHA256 = sha256Bytes(await readFile(approved));
    try {
      await expect(new ClaudeCliRunner(1_000).run({
        kind: "response",
        systemPrompt: "fixture",
        prompt: "fixture"
      })).rejects.toThrow(/Claude.*(?:changed|identity|SHA-256)/i);
    } finally {
      restoreSemanticClaudeEnvironment(previous);
    }
  });

  it("uses the identity-checking finalizer when the authenticated Claude spawn emits an error", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "setup-claude-spawn-error-")));
    temporaryDirectories.push(root);
    const approved = join(root, "claude");
    await writeFile(approved, "#!/definitely/missing/semantic-rc-interpreter\n", "utf8");
    await chmod(approved, 0o755);

    const previous = semanticClaudeEnvironment();
    process.env.PATH = `${root}:/usr/bin:/bin`;
    process.env.SEMANTIC_RC_CLAUDE_EXECUTABLE = approved;
    process.env.SEMANTIC_RC_CLAUDE_SHA256 = sha256Bytes(await readFile(approved));
    try {
      await expect(new ClaudeCliRunner(5_000).run({
        kind: "response",
        systemPrompt: "fixture",
        prompt: "fixture"
      })).rejects.toThrow(/ENOENT|spawn|no such/i);
    } finally {
      restoreSemanticClaudeEnvironment(previous);
    }
  });

  it("loads only a bounded canonical routing projection bound to the full decision index", async () => {
    const root = await routingPluginRoot();

    await expect(loadPluginDecisionBoundary(root)).resolves.toMatchObject({
      decisionIndex: { digest: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      routingIndex: {
        schemaVersion: 1,
        decisionIndexDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        digest: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
  });

  it("rejects an oversized, overlong, empty, symlinked, stale, or forged routing projection", async () => {
    const mutations: Array<[string, (root: string) => Promise<void>]> = [
      ["empty", async (root) => writeFile(routingIndexPath(root), "", "utf8")],
      ["oversized", async (root) => writeFile(routingIndexPath(root), " ".repeat(128 * 1024 + 1), "utf8")],
      ["overlong", async (root) => writeFile(routingIndexPath(root), "{}\n".repeat(2_001), "utf8")],
      ["stale full digest", async (root) => mutateRoutingIndex(root, (routing) => {
        routing.decisionIndexDigest = "a".repeat(64);
      })],
      ["forged profile", async (root) => mutateRoutingIndex(root, (routing) => {
        const first = routing.profiles[0] as { phrases: { en: string[] } };
        first.phrases.en[0] = "forged route";
      })]
    ];

    for (const [label, mutate] of mutations) {
      const root = await routingPluginRoot();
      await mutate(root);
      await expect(loadPluginDecisionBoundary(root), label).rejects.toThrow(/routing index/i);
    }

    const linkedRoot = await routingPluginRoot();
    const outsideRoot = await realpath(await mkdtemp(join(tmpdir(), "setup-routing-link-")));
    temporaryDirectories.push(outsideRoot);
    const outside = join(outsideRoot, "routing-index.json");
    await writeFile(outside, await readFile(routingIndexPath(linkedRoot), "utf8"), "utf8");
    await rm(routingIndexPath(linkedRoot));
    await import("node:fs/promises").then(({ symlink }) => symlink(outside, routingIndexPath(linkedRoot)));
    await expect(loadPluginDecisionBoundary(linkedRoot)).rejects.toThrow(/routing index/i);
  });

  it("uses a fresh response request and separate structured judge request per case", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingFakeRunner();
    const cases = await Promise.all([evaluationCase("case-one"), evaluationCase("case-two")]);

    const summary = await evaluateSetupCases({
      cases,
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    expect(summary.cases).toHaveLength(2);
    expect(runner.requests.map((request) => request.kind)).toEqual([
      "response",
      "judge",
      "response",
      "judge"
    ]);
    for (const request of runner.requests.filter((request) => request.kind === "response")) {
      expect(request.systemPrompt).toContain("SETUP SKILL ONLY");
      expect(request.systemPrompt).toContain("Trusted Evaluation Harness Binding");
      expect(request.systemPrompt).toContain(request.requiredRead?.path);
      expect(request.allowedTools).toEqual(["Read"]);
      expect(request.additionalDirectories).toEqual([
        request.requiredRead?.path.replace(/\/data\/routing-index\.json$/, "")
      ]);
      expect(request.jsonSchema).toBeUndefined();
      expect(request.prompt).not.toContain("Trusted Evaluation Harness Binding");
    }
    for (const request of runner.requests.filter((request) => request.kind === "judge")) {
      expect(request.systemPrompt).not.toContain("SETUP SKILL ONLY");
      expect(request.jsonSchema).toBeDefined();
    }

    const receipt = JSON.parse(
      await readFile(join(outputDirectory, "case-one.json"), "utf8")
    ) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      caseId: "case-one",
      passed: true,
      errors: [],
      trustedRead: {
        expectedStatus: "success",
        observedStatus: "success"
      }
    });
    expect(receipt.expectedBehaviors).toEqual([
      expect.objectContaining({ behavior: "does the required thing", passed: true })
    ]);
    expect(receipt.forbiddenBehaviors).toEqual([
      expect.objectContaining({ behavior: "does the forbidden thing", passed: true })
    ]);
    expect(JSON.parse(await readFile(join(outputDirectory, "summary.json"), "utf8"))).toEqual(
      summary
    );
  });

  it("preflights and Reads only the bounded routing index before invoking a responder", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingFakeRunner();
    const root = await routingPluginRoot();

    const summary = await evaluateSetupCases({
      cases: [{ ...await evaluationCase("routing-read"), fixturePluginRoot: root }],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    const response = runner.requests.find(({ kind }) => kind === "response")!;
    expect(response.requiredRead?.path).toBe(join(root, "data", "routing-index.json"));
    expect(response.systemPrompt).not.toContain("data/decision-index.json");
  });

  it("rejects an invalid routing index before any model request", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingFakeRunner();
    const root = await routingPluginRoot();
    await writeFile(routingIndexPath(root), " ".repeat(128 * 1024 + 1), "utf8");

    await expect(evaluateSetupCases({
      cases: [{ ...await evaluationCase("oversized-routing"), fixturePluginRoot: root }],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    })).rejects.toThrow(/routing index/i);
    expect(runner.requests).toEqual([]);
  });

  it("binds the judge schema to the exact case id and rubric behaviors", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingFakeRunner();
    const testCase = await evaluationCase("schema-bound-case");

    await evaluateSetupCases({
      cases: [testCase],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });

    const judgeRequest = runner.requests.find(({ kind }) => kind === "judge")!;
    expect(judgeRequest.jsonSchema).toEqual(exactJudgeSchema(testCase));
  });

  it("requires runner-owned catalog and lock Reads when recovery semantics are evaluated", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingFakeRunner();

    const summary = await evaluateSetupCases({
      cases: [await evaluationCase("resume-case")],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory,
      trustedAdditionalReadRelativePaths: [join("state", "install-lock.json")]
    });

    expect(summary.passed).toBe(true);
    const response = runner.requests.find(({ kind }) => kind === "response")!;
    expect(response.requiredReads).toHaveLength(2);
    expect(response.requiredReads?.map(({ path }) => path)).toEqual([
      join(response.additionalDirectories![0]!, "data", "routing-index.json"),
      join(response.additionalDirectories![0]!, "state", "install-lock.json")
    ]);
    expect(response.systemPrompt).toContain("install-lock.json");
  });

  it("returns a nonzero exit code when any expected or forbidden item fails", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new FailingFakeRunner();

    const summary = await evaluateSetupCases({
      cases: [await evaluationCase("failed-case")],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    expect(exitCodeForSummary(summary)).toBe(1);
    const receipt = JSON.parse(
      await readFile(join(outputDirectory, "failed-case.json"), "utf8")
    ) as {
      expectedBehaviors: Array<{ passed: boolean }>;
      forbiddenBehaviors: Array<{ passed: boolean }>;
    };
    expect(receipt.expectedBehaviors[0]?.passed).toBe(false);
    expect(receipt.forbiddenBehaviors[0]?.passed).toBe(false);
  });

  it("validates judge output against the same exact per-case behavior schema", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new MalformedJudgeFakeRunner();

    const summary = await evaluateSetupCases({
      cases: [await evaluationCase("malformed-case")],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(
      await readFile(join(outputDirectory, "malformed-case.json"), "utf8")
    ) as {
      errors: string[];
      expectedBehaviors: Array<{ passed: boolean }>;
      forbiddenBehaviors: Array<{ passed: boolean }>;
    };
    expect(receipt.errors.join(" ")).toMatch(
      /Judge result schema validation failed.*must be equal to constant/i
    );
    expect(receipt.expectedBehaviors.every((item) => !item.passed)).toBe(true);
    expect(receipt.forbiddenBehaviors.every((item) => !item.passed)).toBe(true);
  });

  it("rejects an unexpected root property in judge output", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new ExtraJudgePropertyFakeRunner("root");

    const summary = await evaluateSetupCases({
      cases: [await evaluationCase("extra-root")],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(
      await readFile(join(outputDirectory, "extra-root.json"), "utf8")
    ) as { errors: string[] };
    expect(receipt.errors.join(" ")).toMatch(
      /Judge result schema validation failed.*additional properties/i
    );
  });

  it("rejects an unexpected property in a judge behavior item", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new ExtraJudgePropertyFakeRunner("item");

    const summary = await evaluateSetupCases({
      cases: [await evaluationCase("extra-item")],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(
      await readFile(join(outputDirectory, "extra-item.json"), "utf8")
    ) as { errors: string[] };
    expect(receipt.errors.join(" ")).toMatch(
      /Judge result schema validation failed.*additional properties/i
    );
  });

  it("starts isolated Claude calls with the skill or judge prompt, never both", async () => {
    const calls: string[][] = [];
    const runner = new ClaudeCliRunner(5_000, async (args) => {
      calls.push(args);
      return args.includes("--json-schema")
        ? JSON.stringify({ structured_output: { caseId: "case-one" } })
        : [
            JSON.stringify({
              type: "assistant",
              message: {
                content: [{
                  type: "tool_use",
                  id: "read-1",
                  name: "Read",
                  input: { file_path: "/tmp/setup-fixture/data/decision-index.json" }
                }]
              }
            }),
            JSON.stringify({
              type: "user",
              message: {
                content: [{ type: "tool_result", tool_use_id: "read-1", content: "{}" }]
              }
            }),
            JSON.stringify({ type: "result", result: "candidate response" })
          ].join("\n");
    });

    await runner.run({
      kind: "response",
      systemPrompt: "SETUP SKILL ONLY",
      prompt: "CASE PROMPT",
      allowedTools: ["Read"],
      additionalDirectories: ["/tmp/setup-fixture"],
      requiredRead: {
        path: "/tmp/setup-fixture/data/decision-index.json",
        expectedStatus: "success"
      }
    });
    await runner.run({
      kind: "judge",
      systemPrompt: "JUDGE ONLY",
      prompt: "JUDGE PAYLOAD",
      jsonSchema: { type: "object" }
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--safe-mode");
    expect(calls[0]).toContain("--disable-slash-commands");
    expect(calls[0]).toContain("--no-session-persistence");
    expect(flagValue(calls[0] ?? [], "--tools")).toBe("Read");
    expect(flagValue(calls[0] ?? [], "--allowed-tools")).toBe("Read");
    expect(flagValue(calls[0] ?? [], "--add-dir")).toBe("/tmp/setup-fixture");
    expect(calls[0]).not.toContain("Bash");
    expect(calls[0]).not.toContain("Edit");
    expect(flagValue(calls[0] ?? [], "--output-format")).toBe("stream-json");
    expect(calls[0]).toContain("--verbose");
    expect(calls[0]).not.toContain("--append-system-prompt");
    expect(flagValue(calls[0] ?? [], "--system-prompt")).toBe("SETUP SKILL ONLY");
    expect(calls[0]?.slice(-2)).toEqual(["-p", "CASE PROMPT"]);
    expect(flagValue(calls[1] ?? [], "--system-prompt")).toBe("JUDGE ONLY");
    expect(flagValue(calls[1] ?? [], "--tools")).toBe("");
    expect(calls[1]).not.toContain("--add-dir");
    expect(calls[1]?.slice(-2)).toEqual(["-p", "JUDGE PAYLOAD"]);
  });

  it("fails closed when the required Read trace is missing or has the wrong result", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new MissingReadTraceFakeRunner();

    const summary = await evaluateSetupCases({
      cases: [await evaluationCase("trace-missing")],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(
      await readFile(join(outputDirectory, "trace-missing.json"), "utf8")
    ) as { errors: string[]; trustedRead: { observedStatus: string } };
    expect(receipt.errors.join(" ")).toMatch(/required trusted Read trace/i);
    expect(receipt.trustedRead.observedStatus).toBe("missing");
  });

  it("rejects reordered Reads and any non-exact Read input", async () => {
    for (const mode of ["swapped", "extra-input"] as const) {
      const outputDirectory = await temporaryDirectory();
      const root = await routingPluginRoot();
      const runner = new ReadTraceFakeRunner(mode);
      const summary = await evaluateSetupCases({
        cases: [{ ...await evaluationCase(`trace-${mode}`), fixturePluginRoot: root }],
        skillContent: "SETUP SKILL ONLY",
        runner,
        outputDirectory,
        trustedAdditionalReadRelativePaths: [join("state", "install-lock.json")]
      });

      expect(summary.passed, mode).toBe(false);
      const receipt = JSON.parse(
        await readFile(join(outputDirectory, `trace-${mode}.json`), "utf8")
      ) as { errors: string[] };
      expect(receipt.errors.join(" "), mode).toMatch(/required trusted Read trace/i);
    }
  });

  it("rejects duplicate stream tool-use IDs and duplicate tool results", async () => {
    for (const duplicate of ["tool-use", "tool-result"] as const) {
      const path = "/tmp/setup-fixture/data/routing-index.json";
      const toolUse = JSON.stringify({
        message: { content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: path } }] }
      });
      const toolResult = JSON.stringify({
        message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "{}" }] }
      });
      const stdout = duplicate === "tool-use"
        ? [toolUse, toolUse, toolResult, JSON.stringify({ type: "result", result: "response" })].join("\n")
        : [toolUse, toolResult, toolResult, JSON.stringify({ type: "result", result: "response" })].join("\n");
      const runner = new ClaudeCliRunner(5_000, async () => stdout);

      await expect(runner.run({
        kind: "response",
        systemPrompt: "SETUP SKILL ONLY",
        prompt: "CASE PROMPT",
        allowedTools: ["Read"],
        additionalDirectories: ["/tmp/setup-fixture"],
        requiredRead: { path, expectedStatus: "success" }
      }), duplicate).rejects.toThrow(/duplicate.*tool|tool.*duplicate/i);
    }
  });

  it("returns nonzero from the real CLI path when a fake judge fails a case", async () => {
    const outputDirectory = await temporaryDirectory();
    let stdout = "";

    const exitCode = await runSetupEvaluationCli(
      ["--output-dir", outputDirectory],
      {
        runner: new FailingFakeRunner(),
        stdout: { write: (value) => { stdout += value; } }
      }
    );

    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/"passed": false/);
    const summary = JSON.parse(
      await readFile(join(outputDirectory, "summary.json"), "utf8")
    ) as { passed: boolean; cases: unknown[] };
    expect(summary.passed).toBe(false);
    expect(summary.cases).toHaveLength(9);
  });
});

describe("decision-index setup fixture evaluator", () => {
  it("schema-validates the nine authorized setup scenarios and rejects unused keys", async () => {
    const manifest = YAML.parse(await readFile(
      join(projectRoot, "tests", "fixtures", "setup-evaluations", "decision-scenarios.yaml"),
      "utf8"
    )) as unknown;

    const validated = validateSetupDecisionScenarioManifest(manifest);
    expect(validated.scenarios).toHaveLength(9);
    expect(() => validateSetupDecisionScenarioManifest({
      ...validated,
      unusedScenarioManifestKey: true
    })).toThrow(/additional properties/i);
    expect(() => validateSetupDecisionScenarioManifest({
      ...validated,
      scenarios: [{ ...validated.scenarios[0]!, unusedScenarioKey: true }, ...validated.scenarios.slice(1)]
    })).toThrow(/additional properties/i);
  });

  it("table-drives all nine journey scenarios through the actual schema-validated plugin index", async () => {
    const scenarioManifest = validateSetupDecisionScenarioManifest(YAML.parse(await readFile(
      join(projectRoot, "tests", "fixtures", "setup-evaluations", "decision-scenarios.yaml"),
      "utf8"
    )) as unknown);
    const pluginIndex = await setupEligibleDecisionIndex();
    authenticateTestIndex(pluginIndex);

    expect(scenarioManifest.scenarios).toHaveLength(9);
    for (const scenario of scenarioManifest.scenarios) {
      const plan = await evaluateAuthorizedScenario(pluginIndex, scenario);
      expect(plan.status, scenario.id).toBe(scenario.expected.state);
      expect(plan.executionStatus, scenario.id).toBe(scenario.expected.executionStatus);
      expect(plan.commandReceipts.map(({ status }) => status), scenario.id).toEqual(scenario.expected.commandStatuses);
      expect(plan.installReceipts.map(({ pluginName }) => pluginName), scenario.id).toEqual(scenario.expected.receiptCandidateIds);
      expect(plan.statePublications.map(({ phase }) => phase), scenario.id).toEqual(scenario.expected.publicationPhases);
      expect(plan.approvalValid, scenario.id).toBe(scenario.expected.approvalValid);
    }
  });

  it("parses sanitized real Claude Code 2.1.198 marketplace and plugin list shapes", async () => {
    expect(parseClaudeVersion("2.1.198 (Claude Code)\n")).toBe("2.1.198");
    expect(parseClaudeMarketplaceList(await readFile(
      join(claude21198FixtureRoot, "marketplace-list-mixed.json"),
      "utf8"
    ))).toEqual([
      {
        id: "community-marketplace",
        source: "https://github.com/example/community-marketplace.git"
      },
      {
        id: "claude-plugins-official",
        source: "anthropics/claude-plugins-official"
      }
    ]);
    expect(parseClaudePluginList(await readFile(
      join(claude21198FixtureRoot, "plugin-list.json"),
      "utf8"
    ))).toEqual([
      {
        pluginName: "versioned-plugin",
        marketplaceId: "claude-plugins-official",
        version: "3.3.8",
        versionStatus: "observed-semver",
        scope: "user",
        enabled: true
      },
      {
        pluginName: "unversioned-plugin",
        marketplaceId: "claude-plugins-official",
        version: null,
        versionStatus: "unknown",
        scope: "user",
        enabled: true
      },
      {
        pluginName: "opaque-version-plugin",
        marketplaceId: "claude-plugins-official",
        version: null,
        versionStatus: "unknown",
        scope: "user",
        enabled: true
      },
      {
        pluginName: "disabled-plugin",
        marketplaceId: "claude-plugins-official",
        version: "1.0.0",
        versionStatus: "observed-semver",
        scope: "user",
        enabled: false
      }
    ]);
  });

  it.each([
    ["version without the Claude Code suffix", () => parseClaudeVersion("2.1.198\n")],
    ["invalid marketplace JSON", () => parseClaudeMarketplaceList("{}")],
    ["unsupported marketplace source", () => parseClaudeMarketplaceList(
      '[{"name":"claude-plugins-official","source":"directory","path":"/tmp/marketplace","installLocation":"/tmp/marketplace"}]'
    )],
    ["duplicate marketplace identity", () => parseClaudeMarketplaceList(
      '[{"name":"claude-plugins-official","source":"github","repo":"anthropics/claude-plugins-official","installLocation":"/Users/example/.claude/plugins/marketplaces/claude-plugins-official"},{"name":"claude-plugins-official","source":"github","repo":"anthropics/claude-plugins-official","installLocation":"/Users/example/.claude/plugins/marketplaces/claude-plugins-official"}]'
    )],
    ["ambiguous composite plugin ID", () => parseClaudePluginList(
      '[{"id":"shopify-ai-toolkit@claude-plugins-official@other","version":"1.2.3","scope":"user","enabled":true}]'
    )],
    ["invalid plugin enabled status", () => parseClaudePluginList(
      '[{"id":"shopify-ai-toolkit@claude-plugins-official","version":"1.2.3","scope":"user","enabled":"yes"}]'
    )],
    ["duplicate installed plugin identity", () => parseClaudePluginList(
      '[{"id":"shopify-ai-toolkit@claude-plugins-official","version":"1.2.3","scope":"user","enabled":true},{"id":"shopify-ai-toolkit@claude-plugins-official","version":"1.2.4","scope":"user","enabled":false}]'
    )]
  ])("rejects malformed Claude 2.1.198 raw output: %s", (_label, parse) => {
    expect(parse).toThrow();
  });

  it("does not persist responder or judge exception secrets in setup semantic receipts", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner: ModelRunner = {
      async run(): Promise<ModelOutput> {
        throw new Error("Authorization: Bearer setup-secret-token /Users/alice/private/token");
      }
    };

    const summary = await evaluateSetupCases({
      cases: [await evaluationCase("sanitized-exception")],
      skillContent: "SETUP SKILL ONLY",
      runner,
      outputDirectory
    });
    expect(summary.passed).toBe(false);
    const receipt = await readFile(join(outputDirectory, "sanitized-exception.json"), "utf8");
    expect(receipt).toContain("[redacted]");
    expect(receipt).not.toContain("setup-secret-token");
    expect(receipt).not.toContain("/Users/alice/");
  });

  it("routes goal and ambiguity before it asks for probe consent", async () => {
    const index = await loadInstalledDecisionIndex();

    const goal = await evaluateSetupDecisionFixture(index, {
      language: "ko",
      goal: "쇼핑몰 상품 홍보",
      platform: "darwin",
      timeProbe: { consent: "pending" }
    });
    const ambiguous = await evaluateSetupDecisionFixture(index, {
      language: "en",
      goal: "unindexed goal",
      platform: "darwin",
      timeProbe: { consent: "pending" }
    });

    expect(goal).toMatchObject({
      status: "awaiting-probe-consent",
      domainIds: ["commerce"],
      executionStatus: "not-executed"
    });
    expect(ambiguous).toMatchObject({
      status: "awaiting-domain-selection",
      decisionPlan: null,
      approvalBinding: {
        preview: {
          observedAt: null,
          candidates: [],
          statePublisher: null
        }
      },
      executionCapability: null,
      executionStatus: "not-executed"
    });
  });

  it("fails the marketplace-before phase for malformed, duplicate, conflicting, wrong-source, and wrong-marketplace rows", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const expected = probeRows();
    const cases = [
      [{ id: "bad;id", source: "anthropics/claude-plugins-official" }],
      [...expected, expected[0]!],
      [...expected, { id: "claude-plugins-official", source: "attacker/marketplace" }],
      [{ id: "claude-plugins-official", source: "another/marketplace" }],
      [{ id: "another-marketplace", source: "anthropics/claude-plugins-official" }]
    ];

    const awaiting = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
      riskAcknowledged: true
    });
    for (const marketplaceBefore of cases) {
      const execution = successfulExecution(awaiting.approvalBinding);
      execution.candidates[0]!.marketplaceBeforeStdout = marketplaceStdout(marketplaceBefore);
      const plan = await evaluateSetupDecisionFixture(index, {
        language: "en",
        domainIds: ["research-and-intelligence"],
        platform: "darwin",
        timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
        riskAcknowledged: true,
        approval: awaiting.approvalBinding,
        execution
      });
      expect(plan).toMatchObject({ status: "execution-failed", executionStatus: "failed" });
      expect(plan.commandReceipts[0]?.phases).toEqual([
        { phase: "marketplace-before", status: "failure" },
        { phase: "cli-version-before", status: "skipped" },
        { phase: "install", status: "skipped" },
        { phase: "plugin-list-after", status: "skipped" },
        { phase: "cli-version-after", status: "skipped" }
      ]);
    }
  });

  it("binds the canonical complete preview and rejects every changed field including later UTC", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const input: SetupDecisionFixture = {
      language: "ko" as const,
      goal: "시장 조사",
      platform: "darwin" as const,
      timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);

    expect(awaiting).toMatchObject({ status: "awaiting-approval", approvalValid: false });
    for (const approval of mutatedApprovals(awaiting.approvalBinding)) {
      const plan = await evaluateSetupDecisionFixture(index, { ...input, approval });
      expect(plan).toMatchObject({ status: "awaiting-approval", approvalValid: false });
    }
    const later = await evaluateSetupDecisionFixture(index, {
      ...input,
      timeProbe: consentedProbe({ utcTimestamp: secondsAfter(index.observedThrough, 1) }),
      approval: awaiting.approvalBinding
    });
    expect(later).toMatchObject({ status: "awaiting-approval", approvalValid: false });
  });

  it("keeps a genuine broad-complete plan executable while binding empty starter coverage fields", async () => {
    const index = await setupBroadCompleteDecisionIndex();
    authenticateTestIndex(index);
    const input: SetupDecisionFixture = {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);

    expect(awaiting.approvalBinding.preview).toMatchObject({
      planKind: "complete",
      broadCoverageComplete: true,
      coverageIncomplete: false,
      smallestHonestProfile: null,
      directCapabilityIds: [],
      inferredCapabilityIds: [],
      relatedCapabilityIds: [],
      uncoveredCapabilityIds: []
    });
    const approved = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaiting.approvalBinding
    });
    expect(approved).toMatchObject({ status: "awaiting-approval", approvalValid: true });
    expect(approved.executionCapability).not.toBeNull();
  });

  it("binds an authenticated starter partial, its exact selection basis, and every unknown disclosure", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const profile = index.profiles.find(({ domainId }) => domainId === "research-and-intelligence")!;
    const goal = profile.phrases.en[0]!;
    const goalInput: SetupDecisionFixture = {
      language: "en",
      goal,
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    };
    const goalPlan = await evaluateSetupDecisionFixture(index, goalInput);

    expect(goalPlan).toMatchObject({ status: "awaiting-approval" });
    expect(goalPlan.approvalBinding.preview).toMatchObject({
      goal,
      selectedDomainIds: ["research-and-intelligence"],
      planKind: "starter-partial",
      selectionBasis: "goal-match",
      smallestHonestProfile: {
        en: expect.any(String),
        ko: expect.any(String)
      },
      broadCoverageComplete: false,
      coverageIncomplete: true,
      directCapabilityIds: ["source-discovery-and-web-research"],
      inferredCapabilityIds: [],
      relatedCapabilityIds: expect.arrayContaining(["verify-sources-and-claims"]),
      uncoveredCapabilityIds: expect.arrayContaining(["verify-sources-and-claims"])
    });
    expect(goalPlan.approvalBinding.preview.candidates[0]!.disclosures).toMatchObject({
      authentication: { status: "unknown", evidence: [] },
      cost: { status: "unknown", evidence: [] }
    });
    expect(goalPlan.approvalBinding.preview.riskDisclosures).toEqual(expect.arrayContaining([
      "authentication:unknown",
      "cost:unknown",
      "capability-relevance-only:not-supported"
    ]));
    expect(authenticateSetupApprovalBinding(goalPlan.approvalBinding, index)).toEqual(
      goalPlan.approvalBinding.preview
    );

    const explicitPlan = await evaluateSetupDecisionFixture(index, {
      ...goalInput,
      goal: undefined,
      domainIds: ["research-and-intelligence"]
    });
    expect(explicitPlan.approvalBinding.preview).toMatchObject({
      goal: null,
      selectedDomainIds: ["research-and-intelligence"],
      selectionBasis: "explicit-domain"
    });
    expect(authenticateSetupApprovalBinding(explicitPlan.approvalBinding, index)).toEqual(
      explicitPlan.approvalBinding.preview
    );
  });

  it("fails closed for altered starter fields, mixed selection input, and ineligible starter setup contexts", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const input: SetupDecisionFixture = {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const tampered = structuredClone(awaiting.approvalBinding);
    tampered.preview.coverageIncomplete = false;
    (tampered.preview.candidates[0]!.disclosures.authentication as unknown as { status: string }).status = "observed";
    tampered.previewDigest = setupApprovalPreviewDigest(tampered.preview);
    expect(() => authenticateSetupApprovalBinding(tampered, index)).toThrow(/starter|approval|candidate|plan|invalid executable/i);

    const mixed = await evaluateSetupDecisionFixture(index, {
      ...input,
      goal: index.profiles.find(({ domainId }) => domainId === "research-and-intelligence")!.phrases.en[0]!
    });
    expect(mixed).toMatchObject({ status: "held", approvalValid: false, executionCapability: null });

    const multiDomain = await evaluateSetupDecisionFixture(index, {
      ...input,
      domainIds: ["research-and-intelligence", "software-engineering"]
    });
    expect(multiDomain).toMatchObject({ status: "held", approvalValid: false, executionCapability: null });

    const nonDarwin = await evaluateSetupDecisionFixture(index, { ...input, platform: "linux" });
    expect(nonDarwin).toMatchObject({ status: "held", approvalValid: false, executionCapability: null });

    const expired = await evaluateSetupDecisionFixture(index, {
      ...input,
      timeProbe: { consent: "granted", utcTimestamp: index.catalogExpiresAt }
    });
    expect(expired).toMatchObject({ status: "held", approvalValid: false, executionCapability: null });

    const withoutRoutes = structuredClone(index);
    delete withoutRoutes.starterRoutes;
    const { digest: _digest, ...withoutDigest } = withoutRoutes;
    withoutRoutes.digest = decisionIndexDigest(withoutDigest);
    const absentRoute = await evaluateSetupDecisionFixture(withoutRoutes, input);
    expect(absentRoute).toMatchObject({ status: "held", approvalValid: false, executionCapability: null });
  });

  it("binds every byte of the standard Bash publisher command into approval", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const input: SetupDecisionFixture = {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const publisher = awaiting.approvalBinding.preview.statePublisher!;
    const originalDigest = setupApprovalPreviewDigest(awaiting.approvalBinding.preview);
    const changed = structuredClone(awaiting.approvalBinding);
    changed.preview.statePublisher!.commandTemplate += " ";
    changed.previewDigest = setupApprovalPreviewDigest(changed.preview);

    expect(originalDigest).toBe(awaiting.approvalBinding.previewDigest);
    expect(isAbsolute(publisher.runtimeIdentity.executablePath)).toBe(true);
    expect(publisher.runtimeIdentity.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(publisher.runtimeIdentity.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(publisher.argvTemplate[0]).toBe(publisher.runtimeIdentity.executablePath);
    expect(publisher.commandTemplate).not.toMatch(/^node\s+-e\b/);
    expect(publisher.commandTemplate).not.toContain("<SHELL_QUOTED_ABSOLUTE_NODE_PATH>");
    expect(changed.previewDigest).not.toBe(originalDigest);
    expect(await evaluateSetupDecisionFixture(index, { ...input, approval: changed })).toMatchObject({
      status: "awaiting-approval",
      approvalValid: false,
      executionCapability: null
    });
  });

  it("does not let a self-hashed preview mint a durable execution capability", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const input: SetupDecisionFixture = {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const forged = structuredClone(awaiting.approvalBinding);
    forged.preview.goal = "never routed or approved";
    forged.preview.selectedDomainIds = ["legal-risk-and-compliance"];
    forged.preview.domainPriority = ["legal-risk-and-compliance"];
    forged.preview.catalogExpiresAt = "2099-01-01T00:00:00Z";
    forged.previewDigest = setupApprovalPreviewDigest(forged.preview);

    const forgedPlan = await evaluateSetupDecisionFixture(index, { ...input, approval: forged });
    expect(forgedPlan).toMatchObject({ approvalValid: false, executionCapability: null });

    const home = await temporaryProjectHome();
    const previousHome = process.env.HOME;
    try {
      process.env.HOME = home;
      let calls = 0;
      await expect(executeAndPublishApprovedSetupCandidates({
        executionCapability: forged as never,
        decisionIndex: index,
        observedAt: "2026-07-29T12:00:00Z",
        driver: { async executeCandidate() { calls += 1; return undefined; } }
      })).rejects.toThrow(/not issued/i);
      expect(calls).toBe(0);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("issues receipts only after every per-candidate phase succeeds and models final failure state", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const input: SetupDecisionFixture = {
      language: "en" as const,
      domainIds: ["research-and-intelligence"],
      platform: "darwin" as const,
      timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const success = successfulExecution(awaiting.approvalBinding);

    const executed = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaiting.approvalBinding,
      execution: success
    });
    expect(executed).toMatchObject({ status: "executed", executionStatus: "executed" });
    expect(executed.installReceipts).toHaveLength(1);
    expect(executed.installReceipts[0]).toMatchObject({
      pluginName: awaiting.approvalBinding.preview.candidates[0]!.pluginName,
      marketplaceId: "claude-plugins-official",
      marketplaceSource: "anthropics/claude-plugins-official",
      scope: "user",
      preInstallVersion: null,
      postInstallVersion: "1.0.0",
      versionStatus: "observed-semver",
      decisionPlanDigest: awaiting.approvalBinding.previewDigest
    });
    expect(executed.statePublications.map(({ phase }) => phase)).toEqual([
      "initial-approved-lock",
      "candidate-success"
    ]);

    for (const broken of brokenExecutions(awaiting.approvalBinding)) {
      const failed = await evaluateSetupDecisionFixture(index, {
        ...input,
        approval: awaiting.approvalBinding,
        execution: broken
      });
      expect(failed).toMatchObject({ status: "execution-failed", executionStatus: "failed" });
      expect(failed.installReceipts).toEqual([]);
      expect(failed.statePublications.map(({ phase }) => phase)).toEqual([
        "initial-approved-lock",
        "final-failure-or-skipped"
      ]);
      expect(failed.statePublications.at(-1)?.operations.map(({ kind }) => kind)).toEqual([
        "prepare-temporary",
        "write-temporary",
        "sync-temporary",
        "atomic-rename",
        "sync-directory"
      ]);
    }

  });

  it("rejects a null version field or disabled post-install identity before a receipt", async () => {
    const candidate = syntheticPreviewCandidate("post-install-version-boundary");
    const successful = successfulCandidateExecution(candidate);
    const invalidPluginLists = [
      JSON.stringify([{
        id: `${candidate.pluginName}@${candidate.marketplaceId}`,
        version: null,
        scope: candidate.scope,
        enabled: true,
      }]),
      JSON.stringify([{
        id: `${candidate.pluginName}@${candidate.marketplaceId}`,
        version: "1.0.0",
        scope: candidate.scope,
        enabled: false,
      }])
    ];

    for (const pluginListAfterStdout of invalidPluginLists) {
      const result = executeApprovedSetupCandidates({
        approvalPreviewDigest: "a".repeat(64),
        candidates: [candidate],
        execution: {
          candidates: [{ ...successful, pluginListAfterStdout }]
        },
        observedAt: "2026-07-29T12:00:00Z"
      });

      expect(result.executionStatus).toBe("failed");
      expect(result.commandReceipts).toEqual([expect.objectContaining({
        status: "installed-but-unverified",
        phases: expect.arrayContaining([{ phase: "plugin-list-after", status: "failure" }])
      })]);
      expect(result.installReceipts).toEqual([]);
      expect(result.statePublications.map(({ phase }) => phase)).toEqual([
        "initial-approved-lock",
        "final-failure-or-skipped"
      ]);
    }
  });

  it("records an enabled plugin with no semver without claiming revision binding", () => {
    const candidate = syntheticPreviewCandidate("unknown-version-plugin");
    const execution = successfulCandidateExecution(candidate);
    execution.pluginListAfterStdout = pluginListStdout(candidate, "unknown");

    const result = executeApprovedSetupCandidates({
      approvalPreviewDigest: "a".repeat(64),
      candidates: [candidate],
      execution: { candidates: [execution] },
      observedAt: "2026-07-29T12:00:00Z"
    });

    expect(result.executionStatus).toBe("executed");
    expect(result.installReceipts).toEqual([expect.objectContaining({
      postInstallVersion: null,
      versionStatus: "unknown"
    })]);
  });

  it("fails a durable candidate whose invocation trace is only an approved prefix", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const input: SetupDecisionFixture = {
      language: "en",
      domainIds: ["software-engineering"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const approved = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaiting.approvalBinding
    });
    const candidate = approved.approvalBinding.preview.candidates[0]!;
    const execution = successfulCandidateExecution(candidate);
    execution.invocationTrace = execution.invocationTrace!.slice(0, 1);
    const home = await temporaryProjectHome();
    const previousHome = process.env.HOME;
    try {
      process.env.HOME = home;
      const result = await executeAndPublishApprovedSetupCandidates({
        executionCapability: approved.executionCapability!,
        decisionIndex: index,
        observedAt: index.observedThrough,
        driver: { async executeCandidate() { return execution; } }
      });
      expect(result).toMatchObject({
        executionStatus: "failed",
        commandReceipts: [{
          status: "failure",
          invocationTrace: [{
            argv: ["claude", "plugin", "marketplace", "list", "--json"],
            status: "success"
          }]
        }, { status: "skipped", invocationTrace: [] }],
        installReceipts: []
      });
      const lock = JSON.parse(await readFile(
        join(home, ".claude", "claude-code-skillsets", "state", "install-lock.json"),
        "utf8"
      )) as { runs: Array<{ statuses: Array<{ status: string }> }> };
      expect(lock.runs[0]!.statuses).toEqual([
        { candidateId: candidate.candidateId, status: "failure" },
        { candidateId: approved.approvalBinding.preview.candidates[1]!.candidateId, status: "skipped" }
      ]);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("keeps first-failure and second-skipped as an isolated executor contract", () => {
    const first = syntheticPreviewCandidate("synthetic-first");
    const second = syntheticPreviewCandidate("synthetic-second");
    const execution: SetupExecutionFixture = {
      candidates: [
        {
          marketplaceBeforeStdout: marketplaceStdout(probeRows()),
          cliVersionBeforeStdout: claudeVersionStdout(),
          installInvocation: { argv: first.installArgv, status: "failure" },
          pluginListAfterStdout: pluginListStdout(first, "1.0.0"),
          cliVersionAfterStdout: claudeVersionStdout()
        },
        {
          marketplaceBeforeStdout: marketplaceStdout(probeRows()),
          cliVersionBeforeStdout: claudeVersionStdout(),
          installInvocation: { argv: second.installArgv, status: "success" },
          pluginListAfterStdout: pluginListStdout(second, "1.0.0"),
          cliVersionAfterStdout: claudeVersionStdout()
        }
      ]
    };

    const result = executeApprovedSetupCandidates({
      approvalPreviewDigest: "a".repeat(64),
      candidates: [first, second],
      execution,
      observedAt: "2026-07-29T12:00:00Z"
    });

    expect(result.executionStatus).toBe("failed");
    expect(result.commandReceipts.map(({ status }) => status)).toEqual(["failure", "skipped"]);
    expect(result.installReceipts).toEqual([]);
    expect(result.statePublications.map(({ phase }) => phase)).toEqual([
      "initial-approved-lock",
      "final-failure-or-skipped"
    ]);
  });

  it("never validates approval or issues capability from a caller-owned self-consistent index", async () => {
    const authenticated = await loadInstalledDecisionIndex();
    const repeated = await loadInstalledDecisionIndex();
    expect(repeated).toBe(authenticated);
    expect(isAuthenticatedDecisionIndex(authenticated)).toBe(true);
    expect(Object.isFrozen(authenticated)).toBe(true);
    expect(Object.isFrozen(authenticated.candidates[0]!)).toBe(true);

    const attackerIndex = await setupEligibleDecisionIndex();
    expect(isAuthenticatedDecisionIndex(attackerIndex)).toBe(false);
    expect(isAuthenticatedDecisionIndex(await loadPluginDecisionIndex(pluginRoot))).toBe(false);

    const input: SetupDecisionFixture = {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: attackerIndex.observedThrough }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(attackerIndex, input);
    const rejected = await evaluateSetupDecisionFixture(attackerIndex, {
      ...input,
      approval: awaiting.approvalBinding
    });

    expect(rejected).toMatchObject({
      status: "awaiting-approval",
      approvalValid: false,
      executionCapability: null
    });
  });

  it("issues at most one capability for the same approval object or structural clone", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const approvedAt = secondsAfter(index.observedThrough, 1);
    const input: SetupDecisionFixture = {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: approvedAt }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const first = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaiting.approvalBinding
    });
    const sameObjectReplay = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaiting.approvalBinding
    });
    const clonedReplay = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: structuredClone(awaiting.approvalBinding)
    });

    expect(first).toMatchObject({ approvalValid: true });
    expect(first.executionCapability).not.toBeNull();
    for (const replay of [sameObjectReplay, clonedReplay]) {
      expect(replay).toMatchObject({
        status: "awaiting-approval",
        approvalValid: false,
        executionCapability: null
      });
    }
  });

  it("requires an evaluator-issued single-use capability and the exact isolated installed fixture", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const approvedAt = secondsAfter(index.observedThrough, 2);
    const awaiting = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: approvedAt }),
      riskAcknowledged: true
    });
    const approved = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: approvedAt }),
      riskAcknowledged: true,
      approval: awaiting.approvalBinding
    });
    const capability = approved.executionCapability;
    expect(capability).not.toBeNull();
    const home = await temporaryProjectHome();
    const previousHome = process.env.HOME;
    const calls: string[] = [];
    try {
      process.env.HOME = home;
      await expect(executeAndPublishApprovedSetupCandidates({
        executionCapability: {} as never,
        decisionIndex: index,
        observedAt: approvedAt,
        driver: {
          async executeCandidate() {
            throw new Error("must not run with a mismatched index");
          }
        }
      })).rejects.toThrow(/not issued/i);
      await expect(readFile(join(home, ".claude", "claude-code-skillsets", "state", "install-lock.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(executeAndPublishApprovedSetupCandidates({
        executionCapability: capability!,
        decisionIndex: structuredClone(index),
        observedAt: approvedAt,
        driver: {
          async executeCandidate() {
            throw new Error("must not run with a caller-owned index clone");
          }
        }
      })).rejects.toThrow(/exact authenticated decision index/i);
      await expect(readFile(join(home, ".claude", "claude-code-skillsets", "state", "install-lock.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(executeAndPublishApprovedSetupCandidates({
        executionCapability: capability!,
        decisionIndex: index,
        observedAt: secondsAfter(approvedAt, 1),
        driver: {
          async executeCandidate() {
            throw new Error("must not run with a later timestamp");
          }
        }
      })).rejects.toThrow("exact approved strict UTC timestamp");
      await expect(readFile(join(home, ".claude", "claude-code-skillsets", "state", "install-lock.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      const executed = await executeAndPublishApprovedSetupCandidates({
        executionCapability: capability!,
        decisionIndex: index,
        observedAt: approvedAt,
        driver: {
          async executeCandidate(candidate) {
            calls.push(candidate.candidateId);
            return successfulCandidateExecution(candidate);
          }
        },
      });
      expect(executed.executionStatus).toBe("executed");
      expect(calls).toEqual(["exa"]);
      await expect(readFile(
        join(home, ".claude", "claude-code-skillsets", "state", "install-lock.json"),
        "utf8"
      )).resolves.toContain(approved.approvalBinding.previewDigest);
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("uses one approval-bound phase order and publishes only approved operations", async () => {
    const index = await setupEligibleDecisionIndex();
    authenticateTestIndex(index);
    const input: SetupDecisionFixture = {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: consentedProbe({ utcTimestamp: index.observedThrough }),
      riskAcknowledged: true
    };
    const awaiting = await evaluateSetupDecisionFixture(index, input);
    const candidate = awaiting.approvalBinding.preview.candidates[0]!;

    expect(awaiting.approvalBinding.preview.commands).toEqual([
      { kind: "time-probe", candidateId: null, argv: ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"] },
      { kind: "marketplace-before", candidateId: candidate.candidateId, argv: ["claude", "plugin", "marketplace", "list", "--json"] },
      { kind: "cli-version-before", candidateId: candidate.candidateId, argv: ["claude", "--version"] },
      { kind: "install", candidateId: candidate.candidateId, argv: candidate.installArgv },
      { kind: "plugin-list-after", candidateId: candidate.candidateId, argv: ["claude", "plugin", "list", "--json"] },
      { kind: "cli-version-after", candidateId: candidate.candidateId, argv: ["claude", "--version"] }
    ]);
    expect(awaiting.approvalBinding.preview.statePaths).toEqual([
      "state/install-lock.json",
      "state/setup-execution.lock"
    ]);
    expect(awaiting.approvalBinding.preview.riskDisclosures).toContain(
      "execution-lock:stale-requires-doctor-review"
    );
    expect(awaiting.approvalBinding.preview.stateOperations[0]).toEqual({
      phase: "execution-lock-acquire",
      candidateId: null,
      kind: "acquire-execution-lock",
      path: "state/setup-execution.lock"
    });
    expect(awaiting.approvalBinding.preview.stateOperations.at(-1)).toEqual({
      phase: "execution-lock-release",
      candidateId: null,
      kind: "release-execution-lock",
      path: "state/setup-execution.lock"
    });
    expect(awaiting.approvalBinding.preview.stateOperations).toContainEqual({
      phase: "final-failure-or-skipped",
      candidateId: null,
      kind: "atomic-rename",
      path: "state/install-lock.json"
    });
    expect(awaiting.approvalBinding.preview.stateOperations).toContainEqual({
      phase: "initial-approved-lock",
      candidateId: null,
      kind: "write-temporary",
      path: "state/install-lock.json"
    });

    const succeeded = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaiting.approvalBinding,
      execution: successfulExecution(awaiting.approvalBinding)
    });
    expect(succeeded.commandReceipts[0]?.phases).toEqual([
      { phase: "marketplace-before", status: "success" },
      { phase: "cli-version-before", status: "success" },
      { phase: "install", status: "success" },
      { phase: "plugin-list-after", status: "success" },
      { phase: "cli-version-after", status: "success" }
    ]);
    for (const publication of succeeded.statePublications) {
      for (const operation of publication.operations) {
        expect(awaiting.approvalBinding.preview.stateOperations).toContainEqual(operation);
      }
    }

    const failed = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaiting.approvalBinding,
      execution: brokenExecutions(awaiting.approvalBinding)[0]!
    });
    for (const publication of failed.statePublications) {
      for (const operation of publication.operations) {
        expect(awaiting.approvalBinding.preview.stateOperations).toContainEqual(operation);
      }
    }
  });
});

class PassingFakeRunner implements ModelRunner {
  readonly requests: ModelRequest[] = [];

  async run(request: ModelRequest): Promise<ModelOutput> {
    this.requests.push(request);
    if (request.kind === "response") {
      return responseWithRequiredRead(request, `response to ${request.prompt}`);
    }
    return { structured: passingJudgeResult(request) };
  }
}

class FailingFakeRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(request, "unsafe response");
    }
    const payload = judgePayload(request);
    return {
      structured: {
        caseId: payload.caseId,
        expectedBehaviors: behaviorObject(payload.expectedBehaviors, (behavior) => ({
          behavior,
          passed: false,
          evidence: "required behavior missing",
          reason: "missing"
        })),
        forbiddenBehaviors: behaviorObject(payload.forbiddenBehaviors, (behavior) => ({
          behavior,
          passed: false,
          evidence: "forbidden behavior present",
          reason: "present"
        }))
      }
    };
  }
}

class MalformedJudgeFakeRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(request, "some response");
    }
    const result = passingJudgeResult(request) as {
      expectedBehaviors: Record<string, Record<string, unknown>>;
    };
    result.expectedBehaviors.item0!.behavior = "changed behavior";
    return {
      structured: result
    };
  }
}

class ExtraJudgePropertyFakeRunner implements ModelRunner {
  constructor(private readonly placement: "root" | "item") {}

  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(request, "schema test response");
    }
    const result = passingJudgeResult(request) as {
      unexpected?: string;
      expectedBehaviors: Record<string, Record<string, unknown>>;
    };
    if (this.placement === "root") {
      result.unexpected = "must be rejected";
    } else {
      result.expectedBehaviors.item0!.unexpected = "must be rejected";
    }
    return { structured: result };
  }
}

class MissingReadTraceFakeRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return { text: "response without a tool trace", toolCalls: [] };
    }
    return { structured: passingJudgeResult(request) };
  }
}

class ReadTraceFakeRunner implements ModelRunner {
  constructor(private readonly mode: "swapped" | "extra-input") {}

  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "judge") return { structured: passingJudgeResult(request) };
    const reads = request.requiredReads ?? [];
    const toolCalls: ToolCall[] = reads.map((requiredRead) => ({
      name: "Read",
      input: { file_path: requiredRead.path },
      completed: true,
      success: requiredRead.expectedStatus === "success"
    }));
    if (this.mode === "swapped") toolCalls.reverse();
    else toolCalls[0]!.input = { ...toolCalls[0]!.input, offset: 1 };
    return { text: "response with invalid trace", toolCalls };
  }
}

function passingJudgeResult(request: ModelRequest): unknown {
  const payload = judgePayload(request);
  return {
    caseId: payload.caseId,
    expectedBehaviors: behaviorObject(payload.expectedBehaviors, (behavior) => ({
      behavior,
      passed: true,
      evidence: "clear evidence",
      reason: "satisfied"
    })),
    forbiddenBehaviors: behaviorObject(payload.forbiddenBehaviors, (behavior) => ({
      behavior,
      passed: true,
      evidence: "behavior absent",
      reason: "avoided"
    }))
  };
}

function behaviorObject<T>(behaviors: string[], receipt: (behavior: string) => T): Record<string, T> {
  return Object.fromEntries(behaviors.map((behavior, index) => [
    `item${index}`,
    receipt(behavior)
  ]));
}

function judgePayload(request: ModelRequest): {
  caseId: string;
  expectedBehaviors: string[];
  forbiddenBehaviors: string[];
} {
  return JSON.parse(request.prompt) as {
    caseId: string;
    expectedBehaviors: string[];
    forbiddenBehaviors: string[];
  };
}

async function evaluationCase(id: string): Promise<SetupEvaluationCase> {
  return {
    id,
    caseType: "normal",
    prompt: `prompt for ${id}`,
    expectedBehaviors: ["does the required thing"],
    forbiddenBehaviors: ["does the forbidden thing"],
    fixturePluginRoot: await routingPluginRoot()
  };
}

async function routingPluginRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "setup-routing-index-")));
  temporaryDirectories.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  const decisionRaw = await readFile(join(pluginRoot, "data", "decision-index.json"), "utf8");
  await writeFile(join(root, "data", "decision-index.json"), decisionRaw, "utf8");
  const decisionIndex = JSON.parse(decisionRaw) as {
    digest: string;
    catalogVersion: string;
    observedThrough: string;
    catalogExpiresAt: string;
    profiles: DecisionRoutingIndex["profiles"];
  };
  const withoutDigest: Omit<DecisionRoutingIndex, "digest"> = {
    schemaVersion: 1 as const,
    decisionIndexDigest: decisionIndex.digest,
    catalogVersion: decisionIndex.catalogVersion,
    observedThrough: decisionIndex.observedThrough,
    catalogExpiresAt: decisionIndex.catalogExpiresAt,
    profiles: structuredClone(decisionIndex.profiles)
  };
  await writeFile(routingIndexPath(root), `${JSON.stringify({
    ...withoutDigest,
    digest: decisionRoutingIndexDigest(withoutDigest)
  }, null, 2)}\n`, "utf8");
  return root;
}

function routingIndexPath(root: string): string {
  return join(root, "data", "routing-index.json");
}

async function mutateRoutingIndex(
  root: string,
  mutate: (routing: {
    decisionIndexDigest: string;
    profiles: unknown[];
    digest: string;
  }) => void
): Promise<void> {
  const routing = JSON.parse(await readFile(routingIndexPath(root), "utf8")) as {
    decisionIndexDigest: string;
    profiles: unknown[];
    digest: string;
    [key: string]: unknown;
  };
  mutate(routing);
  const { digest: _digest, ...withoutDigest } = routing;
  routing.digest = decisionRoutingIndexDigest(withoutDigest as Parameters<typeof decisionRoutingIndexDigest>[0]);
  await writeFile(routingIndexPath(root), `${JSON.stringify(routing, null, 2)}\n`, "utf8");
}

function exactJudgeSchema(evaluationCase: SetupEvaluationCase): object {
  const behaviorObject = (behaviors: string[]) => ({
    type: "object",
    additionalProperties: false,
    required: behaviors.map((_, index) => `item${index}`),
    properties: Object.fromEntries(behaviors.map((behavior, index) => [`item${index}`, {
      type: "object",
      additionalProperties: false,
      required: ["behavior", "passed", "evidence", "reason"],
      properties: {
        behavior: { const: behavior },
        passed: { type: "boolean" },
        evidence: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      }
    }]))
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["caseId", "expectedBehaviors", "forbiddenBehaviors"],
    properties: {
      caseId: { const: evaluationCase.id },
      expectedBehaviors: behaviorObject(evaluationCase.expectedBehaviors),
      forbiddenBehaviors: behaviorObject(evaluationCase.forbiddenBehaviors)
    }
  };
}

function responseWithRequiredRead(request: ModelRequest, text: string): ModelOutput {
  if (request.requiredRead === undefined) {
    throw new Error("response request omitted requiredRead");
  }
  return {
    text,
    toolCalls: (request.requiredReads ?? [request.requiredRead]).map((requiredRead) => ({
      name: "Read",
      input: { file_path: requiredRead.path },
      completed: true,
      success: requiredRead.expectedStatus === "success"
    }))
  };
}

async function temporaryDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "setup-evaluator-")));
  temporaryDirectories.push(root);
  return join(root, "output");
}

async function temporaryProjectHome(): Promise<string> {
  const directory = await mkdtemp(join(projectRoot, ".tmp-setup-evaluator-home-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function setupEligibleDecisionIndex() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "setup-eligible-index-")));
  temporaryDirectories.push(root);
  const pluginRoot = join(root, "plugin");
  await mkdir(join(pluginRoot, "data"), { recursive: true });
  await writeFile(join(pluginRoot, "data", "decision-index.json"), await eligibleDecisionIndexRaw(), "utf8");
  const indexSet = await loadPluginDecisionIndexSet(pluginRoot);
  isolatedDecisionIndexSets.set(indexSet.current, indexSet);
  return indexSet.current;
}

async function eligibleDecisionIndexRaw(): Promise<string> {
  approvedDecisionIndexRaw ??= createApprovedOfficialDecisionIndexFixture(projectRoot).then(async ({ root, raw }) => {
    await rm(root, { recursive: true, force: true });
    return raw;
  });
  return approvedDecisionIndexRaw;
}

async function setupBroadCompleteDecisionIndex() {
  const index = structuredClone(await setupEligibleDecisionIndex());
  const exa = index.candidates.find(({ id }) => id === "exa")!;
  const promotedCapabilityIds = ["verify-sources-and-claims", "synthesize-cited-evidence"];
  exa.providedCapabilityIds.push(...promotedCapabilityIds);
  for (const evidence of index.candidateEvidence.filter(({ candidateId }) => candidateId === exa.id)) {
    if (promotedCapabilityIds.includes(evidence.capabilityId)) evidence.support = "inferred";
    evidence.candidate = structuredClone(exa);
  }
  index.starterRoutes = index.starterRoutes?.filter(({ domainId }) => domainId !== "research-and-intelligence");
  const { digest: _digest, ...withoutDigest } = index;
  index.digest = decisionIndexDigest(withoutDigest);
  return index;
}

function authenticateTestIndex(index: Awaited<ReturnType<typeof loadInstalledDecisionIndex>>) {
  const authentication = vi.spyOn(decisionIndexLoader, "isAuthenticatedDecisionIndex")
    .mockImplementation((value) => value === index);
  const indexSet = isolatedDecisionIndexSets.get(index);
  if (indexSet !== undefined) {
    vi.spyOn(decisionIndexLoader, "loadInstalledDecisionIndexSet").mockResolvedValue(indexSet);
  }
  return authentication;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

async function evaluateAuthorizedScenario(
  index: Awaited<ReturnType<typeof loadPluginDecisionIndex>>,
  scenario: SetupDecisionScenario
) {
  const fixture = scenarioFixture(index, scenario.input);
  const awaiting = await evaluateSetupDecisionFixture(index, fixture);
  if (scenario.input.approval === "none") {
    expect(scenario.expected.oldApprovalState, scenario.id).toBeNull();
    return awaiting;
  }

  if (scenario.input.approval === "changed-digest") {
    const oldApproval = mutateApproval(awaiting.approvalBinding, (preview) => {
      preview.decisionIndexDigest = "0".repeat(64);
    });
    const rejected = await evaluateSetupDecisionFixture(index, {
      ...fixture,
      approval: oldApproval
    });
    expect(rejected.status, scenario.id).toBe(scenario.expected.oldApprovalState);
    return rejected;
  }

  expect(scenario.expected.oldApprovalState, scenario.id).toBeNull();
  return evaluateSetupDecisionFixture(index, {
    ...fixture,
    approval: awaiting.approvalBinding
  });
}

function scenarioFixture(
  index: Awaited<ReturnType<typeof loadPluginDecisionIndex>>,
  input: SetupDecisionScenario["input"]
): SetupDecisionFixture {
  const timeProbe = input.timeProbe;
  return {
    language: input.language,
    goal: input.goal,
    domainIds: input.domainIds,
    domainPriority: input.domainPriority,
    platform: "darwin" as const,
    timeProbe: timeProbe === "pending"
      ? { consent: "pending" as const }
      : timeProbe === "refused"
        ? { consent: "refused" as const }
        : consentedProbe({
          utcTimestamp: timeProbe === "granted-at-expiry"
            ? index.catalogExpiresAt
            : index.observedThrough
        }),
    riskAcknowledged: input.riskAcknowledged
  };
}

function consentedProbe(input: { utcTimestamp: string }) {
  return {
    consent: "granted" as const,
    utcTimestamp: input.utcTimestamp
  };
}

function secondsAfter(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString().replace(".000Z", "Z");
}

function probeRows(): Array<{ id: string; source: string }> {
  return [{ id: "claude-plugins-official", source: "anthropics/claude-plugins-official" }];
}

function successfulExecution(binding: SetupApprovalBinding): SetupExecutionFixture {
  return {
    candidates: binding.preview.candidates.map((candidate) => ({
      marketplaceBeforeStdout: marketplaceStdout(probeRows()),
      cliVersionBeforeStdout: claudeVersionStdout(),
      installInvocation: { argv: candidate.installArgv, status: "success" as const },
      pluginListAfterStdout: pluginListStdout(candidate, "1.0.0"),
      cliVersionAfterStdout: claudeVersionStdout(),
      invocationTrace: candidateInvocationTrace(candidate.installArgv)
    }))
  };
}

function brokenExecutions(binding: SetupApprovalBinding): SetupExecutionFixture[] {
  const success = successfulExecution(binding);
  const candidate = success.candidates[0]!;
  return [
    { candidates: [{ ...candidate, cliVersionBeforeStdout: null }] },
    { candidates: [{ ...candidate, cliVersionAfterStdout: null }] },
    { candidates: [{ ...candidate, pluginListAfterStdout: "[]" }] },
    { candidates: [{ ...candidate, marketplaceBeforeStdout: marketplaceStdout([{ id: "wrong-marketplace", source: "anthropics/claude-plugins-official" }]) }] },
    { candidates: [{ ...candidate, pluginListAfterStdout: pluginListStdout({ ...binding.preview.candidates[0]!, pluginName: "wrong-plugin" }, "1.0.0") }] },
    { candidates: [{ ...candidate, pluginListAfterStdout: pluginListStdout({ ...binding.preview.candidates[0]!, scope: "project" }, "1.0.0") }] },
    { candidates: [{ ...candidate, installInvocation: { ...candidate.installInvocation, argv: ["claude", "plugin", "install", `${candidate.installInvocation.argv[3]};touch`, "--scope", "user"] } }] },
    { candidates: [{ ...candidate, installInvocation: { ...candidate.installInvocation, status: "success" as const }, pluginListAfterStdout: null }] }
  ];
}

function claudeVersionStdout(): string {
  return "2.1.198 (Claude Code)\n";
}

function marketplaceStdout(rows: Array<{ id: string; source: string }>): string {
  return JSON.stringify(rows.map(({ id, source }) => ({
    name: id,
    source: "github",
    repo: source,
    installLocation: `/Users/example/.claude/plugins/marketplaces/${id}`
  })));
}

function pluginListStdout(
  candidate: { pluginName: string; marketplaceId: string; scope: string },
  version: string
): string {
  return JSON.stringify([{
    id: `${candidate.pluginName}@${candidate.marketplaceId}`,
    version,
    scope: candidate.scope,
    enabled: true
  }]);
}

function successfulCandidateExecution(candidate: SetupPreviewCandidate) {
  return {
    marketplaceBeforeStdout: marketplaceStdout(probeRows()),
    cliVersionBeforeStdout: claudeVersionStdout(),
    installInvocation: { argv: [...candidate.installArgv], status: "success" as const },
    pluginListAfterStdout: pluginListStdout(candidate, "1.0.0"),
    cliVersionAfterStdout: claudeVersionStdout(),
    invocationTrace: candidateInvocationTrace(candidate.installArgv)
  };
}

function candidateInvocationTrace(installArgv: readonly string[]) {
  return [
    { argv: ["claude", "plugin", "marketplace", "list", "--json"], status: "success" as const },
    { argv: ["claude", "--version"], status: "success" as const },
    { argv: [...installArgv], status: "success" as const },
    { argv: ["claude", "plugin", "list", "--json"], status: "success" as const },
    { argv: ["claude", "--version"], status: "success" as const }
  ];
}

function twoCandidateApproval(binding: SetupApprovalBinding): SetupApprovalBinding {
  const approval = structuredClone(binding);
  const first = approval.preview.candidates[0]!;
  const second: SetupPreviewCandidate = {
    ...structuredClone(first),
    candidateId: `${first.candidateId}-complement`,
    pluginName: `${first.pluginName}-complement`,
    installArgv: ["claude", "plugin", "install", `${first.pluginName}-complement@claude-plugins-official`, "--scope", "user"],
    capabilities: first.capabilities.map((capability) => ({
      ...capability,
      evidenceId: `${capability.evidenceId}-complement`
    }))
  };
  approval.preview.candidates = [first, second];
  approval.preview.executionOrder = [first.candidateId, second.candidateId];
  approval.preview.marketplaceIdentities = [{ id: first.marketplaceId, source: first.marketplaceSource }];
  approval.preview.commands = [
    { kind: "time-probe", candidateId: null, argv: ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"] },
    ...approval.preview.candidates.flatMap((candidate) => [
      { kind: "marketplace-before" as const, candidateId: candidate.candidateId, argv: ["claude", "plugin", "marketplace", "list", "--json"] },
      { kind: "cli-version-before" as const, candidateId: candidate.candidateId, argv: ["claude", "--version"] },
      { kind: "install" as const, candidateId: candidate.candidateId, argv: [...candidate.installArgv] },
      { kind: "plugin-list-after" as const, candidateId: candidate.candidateId, argv: ["claude", "plugin", "list", "--json"] },
      { kind: "cli-version-after" as const, candidateId: candidate.candidateId, argv: ["claude", "--version"] }
    ])
  ];
  approval.preview.stateOperations = [
    {
      phase: "execution-lock-acquire",
      candidateId: null,
      kind: "acquire-execution-lock",
      path: "state/setup-execution.lock"
    },
    ...stateOperationsFor("initial-approved-lock", null, true),
    ...approval.preview.executionOrder.flatMap((candidateId) => stateOperationsFor("candidate-success", candidateId, false)),
    ...stateOperationsFor("final-failure-or-skipped", null, false),
    {
      phase: "execution-lock-release",
      candidateId: null,
      kind: "release-execution-lock",
      path: "state/setup-execution.lock"
    }
  ];
  approval.previewDigest = setupApprovalPreviewDigest(approval.preview);
  return approval;
}

function indexWithComplementCandidate(
  index: Awaited<ReturnType<typeof loadPluginDecisionIndex>>,
  preview: SetupPreviewCandidate
) {
  const next = structuredClone(index);
  const original = next.candidates.find((candidate) => candidate.id === preview.candidateId.replace(/-complement$/u, ""))!;
  const candidate = structuredClone(original);
  candidate.id = preview.candidateId;
  candidate.claudeInstall!.pluginName = preview.pluginName;
  candidate.claudeInstall!.argv[3] = `${preview.pluginName}@${preview.marketplaceId}`;
  candidate.capabilityEvidenceIds = original.capabilityEvidenceIds.map((id) => `${id}-complement`);
  next.candidates.push(candidate);
  for (const evidence of next.candidateEvidence.filter((item) => item.candidateId === original.id)) {
    next.candidateEvidence.push({
      ...structuredClone(evidence),
      id: `${evidence.id}-complement`,
      candidateId: candidate.id,
      candidate: structuredClone(candidate)
    });
  }
  const { digest: _digest, ...withoutDigest } = next;
  next.digest = decisionIndexDigest(withoutDigest);
  return next;
}

function stateOperationsFor(
  phase: "initial-approved-lock" | "candidate-success" | "final-failure-or-skipped",
  candidateId: string | null,
  initial: boolean
) {
  return [
    ...(initial ? [
      { phase, candidateId, kind: "prepare-directory" as const, path: "state" },
      { phase, candidateId, kind: "protect-directory" as const, path: "state" }
    ] : []),
    { phase, candidateId, kind: "prepare-temporary" as const, path: "state/install-lock.json" },
    { phase, candidateId, kind: "write-temporary" as const, path: "state/install-lock.json" },
    { phase, candidateId, kind: "sync-temporary" as const, path: "state/install-lock.json" },
    { phase, candidateId, kind: "atomic-rename" as const, path: "state/install-lock.json" },
    { phase, candidateId, kind: "sync-directory" as const, path: "state" }
  ];
}

function syntheticPreviewCandidate(candidateId: string): SetupPreviewCandidate {
  return {
    candidateId,
    sourceId: "synthetic-contract-fixture",
    skillPath: null,
    pluginName: candidateId,
    marketplaceId: "claude-plugins-official",
    marketplaceSource: "anthropics/claude-plugins-official",
    scope: "user",
    installArgv: ["claude", "plugin", "install", `${candidateId}@claude-plugins-official`, "--scope", "user"],
    stateReasons: [],
    capabilities: [],
    revisionBinding: "unavailable",
    disclosures: {
      permissions: { status: "unknown", evidence: [] },
      license: { status: "unknown", evidence: [] },
      trust: { status: "unknown", evidence: [] },
      dependencies: { status: "unknown", evidence: [] },
      authentication: { status: "unknown", evidence: [] },
      cost: { status: "unknown", evidence: [] }
    }
  };
}

function mutatedApprovals(binding: SetupApprovalBinding): SetupApprovalBinding[] {
  return [
    mutateApproval(binding, (preview) => { preview.language = "en"; }),
    mutateApproval(binding, (preview) => { preview.platform = "linux"; }),
    mutateApproval(binding, (preview) => { preview.goal = "changed goal"; }),
    mutateApproval(binding, (preview) => { preview.domainPriority = ["video-and-audio"]; }),
    mutateApproval(binding, (preview) => { preview.observedAt = "2026-07-29T12:00:01Z"; }),
    mutateApproval(binding, (preview) => { preview.catalogExpiresAt = "2026-08-08T00:00:00Z"; }),
    mutateApproval(binding, (preview) => { preview.candidates[0]!.pluginName = "wrong-plugin"; }),
    mutateApproval(binding, (preview) => {
      preview.candidates[0]!.capabilities.find(
        (capability) => capability.capabilityId === "verify-sources-and-claims"
      )!.support = "direct";
    }),
    mutateApproval(binding, (preview) => { preview.marketplaceIdentities[0]!.source = "attacker/marketplace"; }),
    mutateApproval(binding, (preview) => { preview.candidates[0]!.installArgv = ["wrong"]; }),
    mutateApproval(binding, (preview) => { preview.stateOperations[0]!.path = "/tmp/wrong"; }),
    mutateApproval(binding, (preview) => { preview.statePublisher!.commandTemplate = "node -e attacker"; }),
    mutateApproval(binding, (preview) => { preview.statePublisher!.runtimeIdentity.sha256 = "0".repeat(64); }),
    mutateApproval(binding, (preview) => { preview.statePublisher!.argvTemplate[0] = "/tmp/fake-node"; })
  ];
}

function mutateApproval(
  binding: SetupApprovalBinding,
  mutate: (preview: SetupApprovalPreview) => void
): SetupApprovalBinding {
  const approval = structuredClone(binding);
  mutate(approval.preview);
  approval.previewDigest = setupApprovalPreviewDigest(approval.preview);
  return approval;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function semanticClaudeEnvironment(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    SEMANTIC_RC_CLAUDE_EXECUTABLE: process.env.SEMANTIC_RC_CLAUDE_EXECUTABLE,
    SEMANTIC_RC_CLAUDE_SHA256: process.env.SEMANTIC_RC_CLAUDE_SHA256
  };
}

function restoreSemanticClaudeEnvironment(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
