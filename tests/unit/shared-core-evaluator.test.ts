import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateSharedCoreCases,
  loadSharedCoreCases,
  validateSharedCoreResponse,
  type SharedCoreModelRequest,
  type SharedCoreModelRunner
} from "../../src/evaluate/shared-core.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })));
});

describe("shared-core live evaluator", () => {
  it("loads all five committed cases for every shared-core skill deterministically", async () => {
    const cases = await loadSharedCoreCases(projectRoot);

    expect(cases).toHaveLength(40);
    expect(new Set(cases.map(({ skillId }) => skillId)).size).toBe(8);
    expect(cases.filter(({ caseType }) => caseType === "normal")).toHaveLength(24);
    expect(cases.filter(({ caseType }) => caseType === "boundary")).toHaveLength(16);
    expect(cases.map(({ key }) => key)).toEqual(cases.map(({ key }) => key).sort());
  });

  it("enforces exact observations and explicit-approval holds deterministically", async () => {
    const cases = await loadSharedCoreCases(projectRoot);
    const quality = cases.find(({ key }) => key === "quality-verification--03-normal-minimal")!;
    const risk = cases.find(({ key }) => key === "risk-privacy-permissions--01-normal-primary")!;

    expect(validateSharedCoreResponse(quality, "Observed exit code: 0.")).toEqual([]);
    expect(validateSharedCoreResponse(quality, "Exit code: 0 - Pass.").join(" ")).toMatch(
      /exact response/i
    );
    const hold = "The external action remains on hold until this resolved scope receives explicit approval.";
    expect(validateSharedCoreResponse(risk, `Scoped plan.\n\n${hold}`)).toEqual([]);
    expect(validateSharedCoreResponse(risk, `${hold}\n\nI'll proceed unless you object.`).join(" ")).toMatch(
      /forbidden phrase/i
    );
    expect(validateSharedCoreResponse(risk, `${hold}\n\nNext: upload the minimized file.`).join(" ")).toMatch(
      /final paragraph/i
    );
    expect(validateSharedCoreResponse(risk, `${hold}\n\n${hold}`).join(" ")).toMatch(
      /final paragraph/i
    );
  });

  it("uses isolated skill response calls and strict separate judge calls", async () => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingRunner();

    const summary = await evaluateSharedCoreCases({ cases, runner, outputDirectory });

    expect(summary.passed).toBe(true);
    expect(runner.requests.map(({ kind }) => kind)).toEqual(["response", "judge"]);
    expect(runner.requests[0]?.systemPrompt).toContain("# ");
    expect(runner.requests[0]?.allowedTools).toEqual([]);
    expect(runner.requests[1]?.systemPrompt).not.toBe(runner.requests[0]?.systemPrompt);
    expect(runner.requests[1]?.jsonSchema).toBeDefined();
    const schema = runner.requests[1]?.jsonSchema as {
      properties: {
        caseId: { const: string };
        expectedBehaviors: { required: string[]; properties: Record<string, { properties: { behavior: { const: string }; passed: { description: string } } }> };
        forbiddenBehaviors: { required: string[]; properties: Record<string, { properties: { behavior: { const: string }; passed: { description: string } } }> };
      };
    };
    expect(runner.requests[1]?.systemPrompt).toMatch(
      /passed.*always means.*rubric item.*satisfied/is
    );
    expect(runner.requests[1]?.systemPrompt).toMatch(
      /expected.*performed or stated.*passed.*true/is
    );
    expect(runner.requests[1]?.systemPrompt).toMatch(
      /forbidden.*avoids.*passed.*true/is
    );
    expect(runner.requests[1]?.systemPrompt).toMatch(
      /prompt-supplied evidence.*do not credit.*fabricated identifiers/is
    );
    expect(runner.requests[1]?.systemPrompt).toMatch(
      /skill contract.*output rules.*(?:not|no) task facts/is
    );
    const judgePayload = JSON.parse(runner.requests[1]?.prompt ?? "null") as {
      skillContract?: string;
    };
    expect(judgePayload.skillContract).toBe(cases[0]!.skillContent);
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
    expect(Object.values(schema.properties.expectedBehaviors.properties).every(
      ({ properties }) => /true iff.*performed or stated/i.test(properties.passed.description)
    )).toBe(true);
    expect(Object.values(schema.properties.forbiddenBehaviors.properties).every(
      ({ properties }) => /true iff.*avoided/i.test(properties.passed.description)
    )).toBe(true);
  });

  it("fails closed when an injected runner returns an unexpected judge property", async () => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingRunner(true);

    const summary = await evaluateSharedCoreCases({ cases, runner, outputDirectory });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(await readFile(summary.cases[0]!.receiptPath, "utf8")) as {
      errors: string[];
    };
    expect(receipt.errors.join(" ")).toMatch(/schema validation.*additional properties/i);
  });

  it("preserves the response and labels a judge transport failure", async () => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();

    const summary = await evaluateSharedCoreCases({
      cases,
      runner: new FailingJudgeRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receipt = JSON.parse(await readFile(summary.cases[0]!.receiptPath, "utf8")) as {
      response: string;
      expectedBehaviors: unknown[];
      forbiddenBehaviors: unknown[];
      errors: string[];
    };
    expect(receipt.response).toBe("Evidence-backed response");
    expect(receipt.expectedBehaviors).toEqual([]);
    expect(receipt.forbiddenBehaviors).toEqual([]);
    expect(receipt.errors).toEqual(["Judge error: Claude exited 1: stderr empty"]);
  });

  it("refuses preexisting and symlinked output directories without truncating data", async () => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const root = await realpath(await mkdtemp(join(tmpdir(), "shared-core-output-victim-")));
    temporaryDirectories.push(root);
    const existing = join(root, "existing");
    await mkdir(existing);
    await writeFile(join(existing, "keep.txt"), "keep\n");
    await expect(evaluateSharedCoreCases({ cases, runner: new PassingRunner(), outputDirectory: existing }))
      .rejects.toThrow(/exist/i);
    await expect(readFile(join(existing, "keep.txt"), "utf8")).resolves.toBe("keep\n");

    const outside = join(root, "outside");
    const linked = join(root, "linked");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "linked-keep\n");
    await symlink(outside, linked);
    await expect(evaluateSharedCoreCases({ cases, runner: new PassingRunner(), outputDirectory: join(linked, "output") }))
      .rejects.toThrow(/symbolic link|symlink/i);
    await expect(readFile(join(outside, "keep.txt"), "utf8")).resolves.toBe("linked-keep\n");
  });
});

class PassingRunner implements SharedCoreModelRunner {
  requests: SharedCoreModelRequest[] = [];

  constructor(private readonly extraProperty = false) {}

  async run(request: SharedCoreModelRequest): Promise<{ text?: string; structured?: unknown }> {
    this.requests.push(request);
    if (request.kind === "response") {
      return { text: "Evidence-backed response" };
    }
    const payload = JSON.parse(request.prompt) as {
      caseId: string;
      expectedBehaviors: string[];
      forbiddenBehaviors: string[];
    };
    return {
      structured: {
        caseId: payload.caseId,
        expectedBehaviors: behaviorObject(payload.expectedBehaviors),
        forbiddenBehaviors: behaviorObject(payload.forbiddenBehaviors),
        ...(this.extraProperty ? { unexpected: true } : {})
      }
    };
  }
}

class FailingJudgeRunner implements SharedCoreModelRunner {
  async run(request: SharedCoreModelRequest): Promise<{ text?: string; structured?: unknown }> {
    if (request.kind === "response") {
      return { text: "Evidence-backed response" };
    }
    throw new Error("Claude exited 1: stderr empty");
  }
}

function behavior(value: string) {
  return { behavior: value, passed: true, evidence: "response", reason: "satisfied" };
}

function behaviorObject(values: string[]): Record<string, ReturnType<typeof behavior>> {
  return Object.fromEntries(values.map((value, index) => [`item${index}`, behavior(value)]));
}

async function temporaryDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "shared-core-evaluator-")));
  temporaryDirectories.push(root);
  return join(root, "output");
}
