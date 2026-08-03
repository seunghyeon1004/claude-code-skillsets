import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateMaintainCases,
  loadMaintainCases,
  runMaintainEvaluationCli
} from "../../src/evaluate/maintain.js";
import type { ModelOutput, ModelRequest, ModelRunner } from "../../src/evaluate/setup.js";

const temporaryDirectories: string[] = [];
let defaultCases: ReturnType<typeof loadMaintainCases> | undefined;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("maintain semantic evaluator", () => {
  it("binds the loader-produced plan and all evidence outcomes with no execution tools", async () => {
    const outputDirectory = await temporaryDirectory();
    const cases = await loadDefaultMaintainCases();
    const runner = new PassingRunner();

    const summary = await evaluateMaintainCases({
      cases: [cases[0]!],
      skillContent: "MAINTAIN SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    const response = runner.requests[0]!;
    expect(response.systemPrompt).toContain("MAINTAIN SKILL ONLY");
    expect(response.systemPrompt).toMatch(/loader-produced sanitized maintenance plan.*every required evidence outcome/is);
    expect(response.systemPrompt).toMatch(/untrusted user text/is);
    expect(response.allowedTools).toEqual(["Read"]);
    expect(response.additionalDirectories).toEqual([cases[0]!.fixturePluginRoot]);
    expect(response.requiredRead?.path).toBe(
      join(cases[0]!.fixturePluginRoot, "data", "maintenance-plan.json")
    );
    expect(response.requiredReads?.map((read) => read.path)).toEqual([
      join(cases[0]!.fixturePluginRoot, "data", "maintenance-plan.json"),
      join(cases[0]!.fixturePluginRoot, "data", "maintenance-evidence.json")
    ]);
  });

  it("rejects a sensitive response without persisting the secret in the receipt", async () => {
    const outputDirectory = await temporaryDirectory();
    const cases = await loadDefaultMaintainCases();

    const summary = await evaluateMaintainCases({
      cases: [cases[0]!],
      skillContent: "MAINTAIN SKILL ONLY",
      runner: new SensitiveResponseRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = await readFile(join(outputDirectory, `${cases[0]!.id}.json`), "utf8");
    expect(receipt).not.toContain("CANARY_MAINTAIN_TOKEN_7K9Q");
    expect(receipt).toMatch(/sensitive data/i);
  });

  it("sanitizes responder and judge exceptions before persisting receipt errors", async () => {
    const outputDirectory = await temporaryDirectory();
    const cases = await loadDefaultMaintainCases();

    const summary = await evaluateMaintainCases({
      cases: [cases[0]!],
      skillContent: "MAINTAIN SKILL ONLY",
      runner: new SensitiveErrorRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = await readFile(join(outputDirectory, `${cases[0]!.id}.json`), "utf8");
    expect(receipt).not.toContain("CANARY_RESPONDER_TOKEN_7K9Q");
    expect(receipt).not.toContain("CANARY_JUDGE_CREDENTIAL_7K9Q");
    expect(receipt).not.toContain("/Users/alice/private/maintain-state.json");
    expect(receipt).toContain("[redacted]");
    expect(receipt).toContain("[home]/");
  });

  it("loads three normal and two boundary cases", async () => {
    const cases = await loadDefaultMaintainCases();
    expect(cases).toHaveLength(5);
    expect(cases.filter((evaluationCase) => evaluationCase.caseType === "normal")).toHaveLength(3);
    expect(cases.filter((evaluationCase) => evaluationCase.caseType === "boundary")).toHaveLength(2);
  });

  it("returns nonzero for a failed judge", async () => {
    const outputDirectory = await temporaryDirectory();
    let stdout = "";
    const exitCode = await runMaintainEvaluationCli(["--output-dir", outputDirectory], {
      cases: await loadDefaultMaintainCases(),
      runner: new FailingJudgeRunner(),
      stdout: { write: (value) => { stdout += value; } }
    });

    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/"passed": false/);
  });

  it("runs the actual CLI dependency path with default isolated evaluation cases", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingRunner();
    let stdout = "";

    const exitCode = await runMaintainEvaluationCli(["--output-dir", outputDirectory], {
      runner,
      stdout: { write: (value) => { stdout += value; } }
    });

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/"passed": true/);
    expect(runner.requests.filter(({ kind }) => kind === "response")).toHaveLength(5);
  });
});

class PassingRunner implements ModelRunner {
  readonly requests: ModelRequest[] = [];

  async run(request: ModelRequest): Promise<ModelOutput> {
    this.requests.push(request);
    if (request.kind === "response") return responseWithRequiredRead(request, "## Maintenance Preview\n\nNo commands run.");
    return { structured: judgeResult(request, true) };
  }
}

class SensitiveResponseRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(
        request,
        "## Maintenance Preview\n\ntoken=CANARY_MAINTAIN_TOKEN_7K9Q"
      );
    }
    return { structured: judgeResult(request, true) };
  }
}

class SensitiveErrorRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      throw new Error("token=CANARY_RESPONDER_TOKEN_7K9Q at /Users/alice/private/maintain-state.json");
    }
    throw new Error("credential=CANARY_JUDGE_CREDENTIAL_7K9Q at /Users/alice/private/maintain-state.json");
  }
}

class FailingJudgeRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") return responseWithRequiredRead(request, "## Maintenance Preview");
    return { structured: judgeResult(request, false) };
  }
}

function responseWithRequiredRead(request: ModelRequest, text: string): ModelOutput {
  if (request.requiredReads === undefined || request.requiredReads.length !== 2) {
    throw new Error("maintain request omitted required reads");
  }
  return {
    text,
    toolCalls: request.requiredReads.map((read) => ({
      name: "Read",
      input: { file_path: read.path },
      completed: true,
      success: read.expectedStatus === "success"
    }))
  };
}

function judgeResult(request: ModelRequest, passed: boolean): unknown {
  const payload = JSON.parse(request.prompt) as {
    caseId: string;
    expectedBehaviors: string[];
    forbiddenBehaviors: string[];
  };
  const receipt = (behavior: string) => ({
    behavior,
    passed,
    evidence: passed ? "behavior satisfied" : "behavior missing",
    reason: passed ? "satisfied" : "missing"
  });
  return {
    caseId: payload.caseId,
    expectedBehaviors: behaviorObject(payload.expectedBehaviors, receipt),
    forbiddenBehaviors: behaviorObject(payload.forbiddenBehaviors, receipt)
  };
}

function behaviorObject<T>(behaviors: string[], receipt: (behavior: string) => T): Record<string, T> {
  return Object.fromEntries(behaviors.map((behavior, index) => [`item${index}`, receipt(behavior)]));
}

async function temporaryDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "maintain-evaluator-")));
  temporaryDirectories.push(root);
  return join(root, "output");
}

function loadDefaultMaintainCases() {
  defaultCases ??= loadMaintainCases();
  return defaultCases;
}
