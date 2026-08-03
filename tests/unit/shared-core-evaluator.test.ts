import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateSharedCoreCases,
  loadSharedCoreCases,
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
        expectedBehaviors: { required: string[]; properties: Record<string, { properties: { behavior: { const: string } } }> };
        forbiddenBehaviors: { required: string[]; properties: Record<string, { properties: { behavior: { const: string } } }> };
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
