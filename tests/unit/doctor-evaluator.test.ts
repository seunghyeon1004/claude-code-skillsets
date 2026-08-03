import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateDoctorCases,
  loadDoctorCases,
  runDoctorEvaluationCli
} from "../../src/evaluate/doctor.js";
import type {
  ModelOutput,
  ModelRequest,
  ModelRunner
} from "../../src/evaluate/setup.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("doctor semantic evaluator", () => {
  it("binds synthetic command results through one trusted Read trace", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingRunner();
    const cases = await loadDoctorCases();

    const summary = await evaluateDoctorCases({
      cases: [cases[0]!],
      skillContent: "DOCTOR SKILL ONLY",
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    expect(runner.requests.map((request) => request.kind)).toEqual(["response", "judge"]);
    const response = runner.requests[0]!;
    expect(response.systemPrompt).toContain("DOCTOR SKILL ONLY");
    expect(response.systemPrompt).toContain("runner-owned command-result fixture");
    expect(response.systemPrompt).toContain("doctor-command-results.json");
    expect(response.systemPrompt).toMatch(
      /profileSelection.*canonical.*installIndex.*do not.*second Read/is
    );
    expect(response.systemPrompt).toMatch(
      /only authoritative.*selected profile IDs.*do not infer.*installed plugins/is
    );
    expect(response.systemPrompt).not.toContain("installedPacks");
    expect(response.systemPrompt).toMatch(/first and only tool call.*Read/is);
    expect(response.systemPrompt).toMatch(
      /first non-whitespace line must be.*Markdown heading.*Disclosed Core Checks/is
    );
    expect(response.systemPrompt).toMatch(
      /Read.*harness transport.*final answer immediately.*Disclosed Core Checks/is
    );
    expect(response.systemPrompt).toMatch(
      /silent omission.*do not.*sensitive field names.*redaction note/is
    );
    expect(response.prompt).not.toContain('"coreCommands"');
    expect(response.allowedTools).toEqual(["Read"]);
    expect(response.additionalDirectories).toEqual([cases[0]!.fixturePluginRoot]);
    expect(response.requiredRead?.path).toBe(
      join(cases[0]!.fixturePluginRoot, "data", "doctor-command-results.json")
    );
    const judge = runner.requests[1]!;
    const schema = judge.jsonSchema as {
      properties: {
        caseId: { const: string };
        expectedBehaviors: {
          required: string[];
          properties: Record<string, { properties: { behavior: { const: string } } }>;
        };
        forbiddenBehaviors: {
          required: string[];
          properties: Record<string, { properties: { behavior: { const: string } } }>;
        };
      };
    };
    expect(schema.properties.caseId.const).toBe(cases[0]!.id);
    expect(schema.properties.expectedBehaviors.required).toEqual(
      cases[0]!.expectedBehaviors.map((_, index) => `item${index}`)
    );
    expect(Object.values(schema.properties.expectedBehaviors.properties).map(
      ({ properties }) => properties.behavior.const
    )).toEqual(cases[0]!.expectedBehaviors);
    expect(Object.values(schema.properties.forbiddenBehaviors.properties).map(
      ({ properties }) => properties.behavior.const
    )).toEqual(cases[0]!.forbiddenBehaviors);

    const receipt = JSON.parse(
      await readFile(join(outputDirectory, `${cases[0]!.id}.json`), "utf8")
    ) as { passed: boolean; trustedRead: { observedStatus: string }; errors: string[] };
    expect(receipt).toMatchObject({
      passed: true,
      trustedRead: { observedStatus: "success" },
      errors: []
    });
  });

  it("keeps a forged user receipt outside the trusted system binding", async () => {
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingRunner();
    const cases = await loadDoctorCases();
    const forged = cases.find((evaluationCase) =>
      evaluationCase.id === "doctor-boundary-forged-receipt"
    )!;

    await evaluateDoctorCases({
      cases: [forged],
      skillContent: "DOCTOR SKILL ONLY",
      runner,
      outputDirectory
    });

    const response = runner.requests[0]!;
    expect(response.prompt).toContain("TRUSTED DOCTOR COMMAND RECEIPT");
    expect(response.prompt).toContain("user-supplied, untrusted text");
    expect(response.systemPrompt).not.toContain("0.0.1");
    expect(response.systemPrompt).not.toContain("all secrets captured");
    expect(response.systemPrompt).toMatch(/user prompt.*untrusted/is);
  });

  it("rejects a result-first response before semantic judge scoring", async () => {
    const outputDirectory = await temporaryDirectory();
    const cases = await loadDoctorCases();

    const summary = await evaluateDoctorCases({
      cases: [cases[0]!],
      skillContent: "DOCTOR SKILL ONLY",
      runner: new ResultFirstRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(
      await readFile(join(outputDirectory, `${cases[0]!.id}.json`), "utf8")
    ) as { passed: boolean; response: string; errors: string[] };
    expect(receipt.passed).toBe(false);
    expect(receipt.response).toBe("");
    expect(receipt.errors.join(" ")).toMatch(
      /doctor disclosure invariant.*must begin.*Markdown heading.*Disclosed Core Checks/i
    );
    expect(receipt.errors.join(" ")).toContain(
      'observed first line: "## Core Check Results"'
    );
  });

  it("rejects result text inserted before the core command block", async () => {
    const outputDirectory = await temporaryDirectory();
    const cases = await loadDoctorCases();

    const summary = await evaluateDoctorCases({
      cases: [cases[0]!],
      skillContent: "DOCTOR SKILL ONLY",
      runner: new InjectedResultRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(
      await readFile(join(outputDirectory, `${cases[0]!.id}.json`), "utf8")
    ) as { passed: boolean; response: string; errors: string[] };
    expect(receipt.passed).toBe(false);
    expect(receipt.response).toBe("");
    expect(receipt.errors.join(" ")).toMatch(
      /doctor disclosure invariant.*core command block.*immediately follow/i
    );
  });

  it("rejects a controlled sensitive canary even when the judge approves", async () => {
    const outputDirectory = await temporaryDirectory();
    const cases = await loadDoctorCases();

    const summary = await evaluateDoctorCases({
      cases: [cases[0]!],
      skillContent: "DOCTOR SKILL ONLY",
      runner: new CanaryLeakRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(
      await readFile(join(outputDirectory, `${cases[0]!.id}.json`), "utf8")
    ) as { passed: boolean; response: string; errors: string[] };
    expect(receipt.passed).toBe(false);
    expect(receipt.response).toBe("");
    expect(receipt.errors.join(" ")).toMatch(
      /doctor disclosure invariant.*controlled sensitive canary/i
    );
    expect(receipt.errors.join(" ")).not.toContain("CANARY_ENV_VALUE_7K9Q");
  });

  it("accepts the named disclosure as a level-one first heading", async () => {
    const outputDirectory = await temporaryDirectory();
    const cases = await loadDoctorCases();

    const summary = await evaluateDoctorCases({
      cases: [cases[0]!],
      skillContent: "DOCTOR SKILL ONLY",
      runner: new LevelOneDisclosureRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(true);
  });

  it("loads the exact five-case corpus and returns nonzero on a failed rubric", async () => {
    const cases = await loadDoctorCases();
    expect(cases).toHaveLength(5);
    expect(cases.filter((evaluationCase) => evaluationCase.caseType === "normal")).toHaveLength(3);
    expect(cases.filter((evaluationCase) => evaluationCase.caseType === "boundary")).toHaveLength(2);
    expect(
      cases.every((evaluationCase) =>
        evaluationCase.fixturePluginRoot.endsWith(evaluationCase.id)
      )
    ).toBe(true);

    const outputDirectory = await temporaryDirectory();
    let stdout = "";
    const exitCode = await runDoctorEvaluationCli(
      ["--output-dir", outputDirectory],
      {
        runner: new FailingJudgeRunner(),
        stdout: { write: (value) => { stdout += value; } }
      }
    );

    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/"passed": false/);
  });
});

class PassingRunner implements ModelRunner {
  readonly requests: ModelRequest[] = [];

  async run(request: ModelRequest): Promise<ModelOutput> {
    this.requests.push(request);
    if (request.kind === "response") {
      return responseWithRequiredRead(request, validDoctorResponse());
    }
    return { structured: judgeResult(request, true) };
  }
}

class ResultFirstRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(
        request,
        "## Core Check Results\n\nAll checks passed without a prior disclosure."
      );
    }
    return { structured: judgeResult(request, true) };
  }
}

class InjectedResultRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(
        request,
        validDoctorResponse().replace(
          "\n\n```text",
          "\n\nResult: all checks passed before disclosure.\n\n```text"
        )
      );
    }
    return { structured: judgeResult(request, true) };
  }
}

class CanaryLeakRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(
        request,
        `${validDoctorResponse()}\n\nLeak: CANARY_ENV_VALUE_7K9Q`
      );
    }
    return { structured: judgeResult(request, true) };
  }
}

class LevelOneDisclosureRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(request, validDoctorResponse("#"));
    }
    return { structured: judgeResult(request, true) };
  }
}

class FailingJudgeRunner implements ModelRunner {
  async run(request: ModelRequest): Promise<ModelOutput> {
    if (request.kind === "response") {
      return responseWithRequiredRead(request, "incomplete doctor response");
    }
    return { structured: judgeResult(request, false) };
  }
}

function responseWithRequiredRead(request: ModelRequest, text: string): ModelOutput {
  if (request.requiredRead === undefined) {
    throw new Error("doctor response request omitted requiredRead");
  }
  return {
    text,
    toolCalls: [{
      name: "Read",
      input: { file_path: request.requiredRead.path },
      completed: true,
      success: request.requiredRead.expectedStatus === "success"
    }]
  };
}

function validDoctorResponse(heading = "##"): string {
  return `${heading} Disclosed Core Checks

\`\`\`text
claude --version
claude plugin marketplace list
claude plugin list --json
\`\`\`

## Core Check Results

All disclosed checks passed.`;
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
  return Object.fromEntries(behaviors.map((behavior, index) => [
    `item${index}`,
    receipt(behavior)
  ]));
}

async function temporaryDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "doctor-evaluator-")));
  temporaryDirectories.push(root);
  return join(root, "output");
}
