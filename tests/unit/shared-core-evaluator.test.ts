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
    const unicodeEmail = "owner@예시.한국";
    const punycodeEmail = "owner@xn--vv4b11d.xn--3e0b707e";
    expect(validateSharedCoreResponse({
      ...quality,
      responseContract: { forbiddenPhrases: [unicodeEmail] }
    }, `Owner/checkpoint: ${punycodeEmail}`).join(" ")).toMatch(/forbidden phrase/i);
    expect(validateSharedCoreResponse({
      ...quality,
      responseContract: { requiredPhrases: ["kill -TERM 48122"] }
    }, "PID 48122 is running.").join(" ")).toMatch(/missing a required phrase/i);
  });

  it.each([
    [
      "an identity missing from the prompt",
      ["outside@example.test"],
      ""
    ],
    [
      "canonical duplicate identities",
      ["owner@예시.한국", "owner@xn--vv4b11d.xn--3e0b707e"],
      "Owner: owner@예시.한국"
    ],
    [
      "a malformed identity",
      ["not-an-email"],
      "Owner: not-an-email"
    ]
  ])("revalidates %s for programmatic evaluator callers", async (
    _label,
    allowedEmailIdentities,
    promptSuffix
  ) => {
    const [loaded] = await loadSharedCoreCases(projectRoot);
    const outputDirectory = await temporaryDirectory();
    const evaluationCase = {
      ...loaded!,
      prompt: `${loaded!.prompt}\n${promptSuffix}`,
      responseContract: { allowedEmailIdentities }
    };

    await expect(evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner: new PassingRunner(),
      outputDirectory
    })).rejects.toThrow(/invalid shared-core response contract/i);
  });

  it("uses isolated skill response calls and strict separate judge calls", async () => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingRunner();

    const summary = await evaluateSharedCoreCases({ cases, runner, outputDirectory });

    expect(summary.passed).toBe(true);
    expect(runner.requests.map(({ kind }) => kind)).toEqual(["response", "judge"]);
    expect(runner.requests[0]?.systemPrompt).toContain("# ");
    expect(runner.requests[0]?.prompt).toBe(cases[0]!.prompt);
    expect(runner.requests[0]?.allowedTools).toEqual([]);
    expect(runner.requests[0]?.systemPrompt).toMatch(
      /evaluation prompt.*only.*task facts/is
    );
    expect(runner.requests[0]?.systemPrompt).toMatch(
      /account.*profile.*session.*identity.*email.*not.*task evidence/is
    );
    expect(runner.requests[0]?.systemPrompt).toMatch(
      /no email identity.*allowed.*response/is
    );
    expect(runner.requests[1]?.systemPrompt).not.toBe(runner.requests[0]?.systemPrompt);
    expect(runner.requests[1]?.jsonSchema).toBeDefined();
    const schema = runner.requests[1]?.jsonSchema as {
      properties: {
        caseId: { const: string };
        expectedBehaviors: { required: string[]; properties: Record<string, { properties: { passed: { description: string } } }> };
        forbiddenBehaviors: { required: string[]; properties: Record<string, { properties: { passed: { description: string } } }> };
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
    expect(runner.requests[1]?.systemPrompt).toMatch(
      /account.*profile.*session.*identity.*email.*not.*task evidence/is
    );
    expect(runner.requests[1]?.systemPrompt).toMatch(
      /evidence.*reason.*no email identity.*allowed/is
    );
    expect(runner.requests[1]?.systemPrompt).toMatch(
      /rubric text.*case-contact.*without reconstructing an identity/is
    );
    const judgePayload = JSON.parse(runner.requests[1]?.prompt ?? "null") as {
      skillContract?: string;
    };
    expect(judgePayload.skillContract).toBe(cases[0]!.skillContent);
    expect(schema.properties.caseId.const).toBe(cases[0]!.id);
    expect(schema.properties.expectedBehaviors.required).toEqual(
      cases[0]!.expectedBehaviors.map((_, index) => `item${index}`)
    );
    expect(Object.values(schema.properties.expectedBehaviors.properties).every(
      ({ properties }) => !("behavior" in properties)
    )).toBe(true);
    expect(Object.values(schema.properties.forbiddenBehaviors.properties).every(
      ({ properties }) => !("behavior" in properties)
    )).toBe(true);
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

  it("fails closed and redacts response emails absent from the evaluation prompt", async () => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();
    const runner = new UnexpectedEmailRunner();

    const summary = await evaluateSharedCoreCases({ cases, runner, outputDirectory });

    expect(summary.passed).toBe(false);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).not.toContain("owner+fixture@example.test");
    expect(receiptText).toContain("<contact-email>");
    const receipt = JSON.parse(receiptText) as { response: string; errors: string[] };
    expect(receipt.response).toContain("Owner/checkpoint: <contact-email>");
    expect(receipt.errors.join(" ")).toMatch(/email identity.*outside.*response boundary/i);
    expect(runner.judgePrompt).not.toContain("owner+fixture@example.test");
    expect(runner.judgePrompt).toContain("<contact-email>");
  });

  it("removes a case-forbidden contact identity from responder and judge inputs", async () => {
    const cases = await loadSharedCoreCases(projectRoot);
    const evaluationCase = cases.find(
      ({ key }) => key === "handoff-continuity--04-boundary-loophole"
    )!;
    const forbiddenContact = evaluationCase.responseContract!.forbiddenPhrases![0]!;
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingRunner(false, "kill -TERM 48122");

    const summary = await evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    const responder = runner.requests.find(({ kind }) => kind === "response")!;
    const judge = runner.requests.find(({ kind }) => kind === "judge")!;
    expect(responder.prompt).not.toContain(forbiddenContact);
    expect(responder.prompt).toContain("<case-contact>");
    expect(judge.prompt).not.toContain(forbiddenContact);
    expect(judge.prompt).toContain("<case-contact>");
    expect(JSON.stringify(judge.jsonSchema)).not.toContain(forbiddenContact);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).toContain(forbiddenContact);
  });

  it("preserves trusted prompt text when no identity requires replacement", async () => {
    const [loaded] = await loadSharedCoreCases(projectRoot);
    const prompt = `${loaded!.prompt}\nLiteral fullwidth marker: Ａ`;
    const evaluationCase = { ...loaded!, prompt };
    const outputDirectory = await temporaryDirectory();
    const runner = new PassingRunner();

    const summary = await evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    expect(runner.requests.find(({ kind }) => kind === "response")?.prompt).toBe(prompt);
  });

  it("preserves an email identity supplied by the evaluation prompt", async () => {
    const cases = await loadSharedCoreCases(projectRoot);
    const loaded = cases.find(({ key }) => key === "handoff-continuity--02-normal-variation")!;
    const suppliedEmail = "owner+fixture@example.test";
    const evaluationCase = {
      ...loaded,
      prompt: `${loaded.prompt}\nOwner/checkpoint assignment: \`${suppliedEmail}\`; this exact address is owner evidence.`,
      responseContract: { allowedEmailIdentities: [suppliedEmail] }
    };
    const outputDirectory = await temporaryDirectory();
    const runner = new UnexpectedEmailRunner(`Owner/checkpoint: ${suppliedEmail}`);

    const summary = await evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner,
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).toContain(suppliedEmail);
    expect(receiptText).not.toContain("<contact-email>");
    expect(runner.responseSystemPrompt).toContain(suppliedEmail);
    expect(runner.responseSystemPrompt).toMatch(/only allowed email identity/is);
  });

  it.each([
    "owner_@example.test",
    "owner*@example.test",
    '"owner.name"@example.test',
    "owner@[192.0.2.1]"
  ])("preserves the explicitly supplied email identity %s", async (suppliedEmail) => {
    const [loaded] = await loadSharedCoreCases(projectRoot);
    const evaluationCase = {
      ...loaded!,
      prompt: `${loaded!.prompt}\nOwner contact: ${suppliedEmail}`,
      responseContract: { allowedEmailIdentities: [suppliedEmail] }
    };
    const outputDirectory = await temporaryDirectory();
    const response = `Owner/checkpoint: ${suppliedEmail}`;

    const summary = await evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner: new UnexpectedEmailRunner(response),
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    const receipt = JSON.parse(receiptText) as { response: string };
    expect(receipt.response).toBe(response);
    expect(receiptText).not.toContain("<contact-email>");
    expect(receiptText).not.toContain("<redacted-model-text>");
  });

  it("treats Unicode and IDNA domain forms as the same supplied identity", async () => {
    const [loaded] = await loadSharedCoreCases(projectRoot);
    const unicodeEmail = "owner@예시.한국";
    const asciiEmail = "owner@xn--vv4b11d.xn--3e0b707e";
    const evaluationCase = {
      ...loaded!,
      prompt: `${loaded!.prompt}\nOwner contact: ${unicodeEmail}`,
      responseContract: { allowedEmailIdentities: [unicodeEmail] }
    };
    const outputDirectory = await temporaryDirectory();

    const summary = await evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner: new UnexpectedEmailRunner(`Owner/checkpoint: ${asciiEmail}`),
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).toContain(asciiEmail);
    expect(receiptText).not.toContain("<contact-email>");
  });

  it("fails closed and redacts unexpected email identities from judge output", async () => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();

    const summary = await evaluateSharedCoreCases({
      cases,
      runner: new UnexpectedJudgeEmailRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).not.toContain("judge+fixture@example.test");
    expect(receiptText).toContain("<contact-email>");
    const receipt = JSON.parse(receiptText) as { errors: string[] };
    expect(receipt.errors.join(" ")).toMatch(/judge output.*email identity.*outside.*response boundary/i);
  });

  it.each([
    ["fullwidth", "Owner/checkpoint: owner＋tag＠ｅxample．com", "<redacted-model-text>"],
    ["zero-width", "Owner/checkpoint: owner\u200b@\u200bexample.com", "<redacted-model-text>"],
    ["IDNA dot-equivalent", "Owner/checkpoint: owner@example。test", "<redacted-model-text>"],
    ["colon suffix", "Owner/checkpoint: owner@example.test:즉시", "<contact-email>"],
    ["unicode", "Owner/checkpoint: 사용자@예시.한국", "<contact-email>"]
  ])("fails closed on an unexpected %s email identity", async (_label, response, placeholder) => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();

    const summary = await evaluateSharedCoreCases({
      cases,
      runner: new UnexpectedEmailRunner(response),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).not.toContain(response);
    expect(receiptText).toContain(placeholder);
  });

  it("redacts a case-forbidden prompt email even when the response obfuscates it", async () => {
    const cases = await loadSharedCoreCases(projectRoot);
    const evaluationCase = cases.find(
      ({ key }) => key === "handoff-continuity--04-boundary-loophole"
    )!;
    const outputDirectory = await temporaryDirectory();
    const response = "Owner/checkpoint: alerts＠example．test";

    const summary = await evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner: new UnexpectedEmailRunner(response),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).not.toContain(response);
    expect(receiptText).toContain("<redacted-model-text>");
  });

  it.each([
    ["quoted local part", 'Owner/checkpoint: "owner.name"@example.test', "<contact-email>"],
    ["domain literal", "Owner/checkpoint: owner@[192.0.2.1]", "<contact-email>"],
    ["whitespace-separated", "Owner/checkpoint: owner @ example . test", "<redacted-model-text>"],
    ["multiline whitespace-separated", "Owner/contact:\nowner @ example . test", "<redacted-model-text>"],
    ["described whitespace-separated", "Owner/checkpoint: same operator (owner @ example.com), immediately", "<redacted-model-text>"],
    ["Markdown-separated", "Owner/checkpoint: owner**@**example.com", "<redacted-model-text>"],
    ["balanced backtick", "Owner/checkpoint: alice`@`example.com", "<redacted-model-text>"]
  ])("fails closed on a visually reconstructable %s identity", async (
    _label,
    response,
    placeholder
  ) => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();

    const summary = await evaluateSharedCoreCases({
      cases,
      runner: new UnexpectedEmailRunner(response),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).not.toContain(response);
    expect(receiptText).toContain(placeholder);
  });

  it("preserves a prompt-supplied matrix expression with a spaced at operator", async () => {
    const [loaded] = await loadSharedCoreCases(projectRoot);
    const expression = "Owner/checkpoint: verify left @ right.transpose";
    const evaluationCase = {
      ...loaded!,
      prompt: `${loaded!.prompt}\nVerified expression: ${expression}`
    };
    const outputDirectory = await temporaryDirectory();

    const summary = await evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner: new UnexpectedEmailRunner(expression),
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).toContain(expression);
    expect(receiptText).not.toContain("<redacted-model-text>");
  });

  it("does not classify package versions or SSH repository syntax as email identities", async () => {
    const [loaded] = await loadSharedCoreCases(projectRoot);
    const repository = "git@github.com:owner/repo";
    const cases = [{
      ...loaded!,
      prompt: `${loaded!.prompt}\nRepository: ${repository}`
    }];
    const outputDirectory = await temporaryDirectory();
    const response = `Dependencies: package@1.2.3. Repository: ${repository}.`;

    const summary = await evaluateSharedCoreCases({
      cases,
      runner: new UnexpectedEmailRunner(response),
      outputDirectory
    });

    expect(summary.passed).toBe(true);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).toContain(response);
    expect(receiptText).not.toContain("<contact-email>");
  });

  it("snapshots a direct caller contract before the first async boundary", async () => {
    const [loaded] = await loadSharedCoreCases(projectRoot);
    const injectedEmail = "late-mutation@example.test";
    const allowedEmailIdentities: string[] = [];
    const forbiddenPhrases = ["original-forbidden"];
    const evaluationCase = {
      ...loaded!,
      responseContract: { allowedEmailIdentities, forbiddenPhrases }
    };
    const outputDirectory = await temporaryDirectory();

    const evaluation = evaluateSharedCoreCases({
      cases: [evaluationCase],
      runner: new UnexpectedEmailRunner(`Owner/checkpoint: ${injectedEmail}`),
      outputDirectory
    });
    allowedEmailIdentities.push(injectedEmail);
    forbiddenPhrases.push("late-forbidden");
    const summary = await evaluation;

    expect(summary.passed).toBe(false);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).not.toContain(injectedEmail);
    expect(receiptText).toContain("<contact-email>");
  });

  it("redacts unexpected email identities from responder transport errors", async () => {
    const cases = (await loadSharedCoreCases(projectRoot)).slice(0, 1);
    const outputDirectory = await temporaryDirectory();

    const summary = await evaluateSharedCoreCases({
      cases,
      runner: new ThrowingResponderRunner(),
      outputDirectory
    });

    expect(summary.passed).toBe(false);
    const receiptText = await readFile(summary.cases[0]!.receiptPath, "utf8");
    expect(receiptText).not.toContain("transport+fixture@example.test");
    expect(receiptText).toContain("<contact-email>");
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

  constructor(
    private readonly extraProperty = false,
    private readonly response = "Evidence-backed response"
  ) {}

  async run(request: SharedCoreModelRequest): Promise<{ text?: string; structured?: unknown }> {
    this.requests.push(request);
    if (request.kind === "response") {
      return { text: this.response };
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

class UnexpectedEmailRunner implements SharedCoreModelRunner {
  judgePrompt = "";
  responseSystemPrompt = "";

  constructor(private readonly response = "Owner/checkpoint: owner+fixture@example.test") {}

  async run(request: SharedCoreModelRequest): Promise<{ text?: string; structured?: unknown }> {
    if (request.kind === "response") {
      this.responseSystemPrompt = request.systemPrompt;
      return { text: this.response };
    }
    this.judgePrompt = request.prompt;
    const payload = JSON.parse(request.prompt) as {
      caseId: string;
      expectedBehaviors: string[];
      forbiddenBehaviors: string[];
    };
    return {
      structured: {
        caseId: payload.caseId,
        expectedBehaviors: behaviorObject(payload.expectedBehaviors),
        forbiddenBehaviors: behaviorObject(payload.forbiddenBehaviors)
      }
    };
  }
}

class UnexpectedJudgeEmailRunner implements SharedCoreModelRunner {
  async run(request: SharedCoreModelRequest): Promise<{ text?: string; structured?: unknown }> {
    if (request.kind === "response") return { text: "Evidence-backed response" };
    const payload = JSON.parse(request.prompt) as {
      caseId: string;
      expectedBehaviors: string[];
      forbiddenBehaviors: string[];
    };
    return {
      structured: {
        caseId: payload.caseId,
        expectedBehaviors: behaviorObject(
          payload.expectedBehaviors,
          "judge+fixture@example.test"
        ),
        forbiddenBehaviors: behaviorObject(payload.forbiddenBehaviors)
      }
    };
  }
}

class ThrowingResponderRunner implements SharedCoreModelRunner {
  async run(request: SharedCoreModelRequest): Promise<{ text?: string; structured?: unknown }> {
    if (request.kind === "response") {
      throw new Error("transport+fixture@example.test");
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
        forbiddenBehaviors: behaviorObject(payload.forbiddenBehaviors)
      }
    };
  }
}

function behavior(_value: string, evidence = "response") {
  return { passed: true, evidence, reason: "satisfied" };
}

function behaviorObject(
  values: string[],
  evidence = "response"
): Record<string, ReturnType<typeof behavior>> {
  return Object.fromEntries(values.map((value, index) => [
    `item${index}`,
    behavior(value, evidence)
  ]));
}

async function temporaryDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "shared-core-evaluator-")));
  temporaryDirectories.push(root);
  return join(root, "output");
}
