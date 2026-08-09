import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import YAML from "yaml";
import { createExclusiveOutputDirectory, writeExclusiveOutputFile } from "../safety/safe-output.js";
import { ClaudeCliRunner } from "./setup.js";

export interface SharedCoreCase {
  key: string;
  id: string;
  skillId: string;
  caseType: "normal" | "boundary";
  prompt: string;
  expectedBehaviors: string[];
  forbiddenBehaviors: string[];
  skillContent: string;
}

export interface SharedCoreModelRequest {
  kind: "response" | "judge";
  systemPrompt: string;
  prompt: string;
  allowedTools?: string[];
  jsonSchema?: object;
}

export interface SharedCoreModelRunner {
  run(request: SharedCoreModelRequest): Promise<{ text?: string; structured?: unknown }>;
}

export interface SharedCoreSummary {
  schemaVersion: 1;
  passed: boolean;
  outputDirectory: string;
  cases: Array<{ key: string; passed: boolean; receiptPath: string }>;
}

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function loadSharedCoreCases(root = projectRoot): Promise<SharedCoreCase[]> {
  const evaluationsRoot = join(root, "tests", "evaluations", "shared-core");
  const skillIds = (await readdir(evaluationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const cases: SharedCoreCase[] = [];
  for (const skillId of skillIds) {
    const skillContent = await readFile(
      join(root, "plugins", "shared-core", "skills", skillId, "SKILL.md"),
      "utf8"
    );
    const files = (await readdir(join(evaluationsRoot, skillId), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name)
      .sort();
    for (const file of files) {
      const value = YAML.parse(await readFile(join(evaluationsRoot, skillId, file), "utf8")) as unknown;
      cases.push(validateCase(value, skillId, file, skillContent));
    }
  }
  return cases.sort((left, right) => left.key.localeCompare(right.key));
}

export async function evaluateSharedCoreCases(options: {
  cases: SharedCoreCase[];
  runner: SharedCoreModelRunner;
  outputDirectory: string;
}): Promise<SharedCoreSummary> {
  await createExclusiveOutputDirectory(resolve(options.outputDirectory));
  const caseSummaries: SharedCoreSummary["cases"] = [];
  for (const evaluationCase of options.cases) {
    const errors: string[] = [];
    let response = "";
    try {
      const output = await options.runner.run({
        kind: "response",
        systemPrompt: evaluationCase.skillContent,
        prompt: evaluationCase.prompt,
        allowedTools: []
      });
      if (typeof output.text !== "string" || output.text.trim() === "") {
        throw new Error("Responder returned no text");
      }
      response = output.text.trim();
    } catch (error) {
      errors.push(`Responder error: ${errorMessage(error)}`);
    }

    let expectedBehaviors: unknown[] = [];
    let forbiddenBehaviors: unknown[] = [];
    try {
      const judgeSchema = judgeSchemaFor(evaluationCase);
      const validateJudge = new Ajv2020({ allErrors: true }).compile(judgeSchema);
      const output = await options.runner.run({
        kind: "judge",
        systemPrompt: [
          "Score only the candidate response against every rubric item.",
          "passed always means that the rubric item is satisfied; it never means that a forbidden behavior occurred.",
          "For expected behaviors, the behavior must be clearly performed or stated for passed to be true.",
          "For forbidden behaviors, the candidate avoids the behavior if and only if passed is true.",
          "Use only prompt-supplied evidence and the candidate response; do not credit fabricated identifiers, paths, receipts, or results.",
          "Preserve behavior text and order exactly. Return only the required JSON."
        ].join(" "),
        prompt: JSON.stringify({
          caseId: evaluationCase.id,
          prompt: evaluationCase.prompt,
          response,
          expectedBehaviors: evaluationCase.expectedBehaviors,
          forbiddenBehaviors: evaluationCase.forbiddenBehaviors
        }),
        jsonSchema: judgeSchema
      });
      if (!validateJudge(output.structured)) {
        throw new Error(`Judge schema validation failed: ${(validateJudge.errors ?? [])
          .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
          .join("; ")}`);
      }
      const structured = output.structured as {
        caseId: string;
        expectedBehaviors: unknown;
        forbiddenBehaviors: unknown;
      };
      const normalizedExpected = normalizeBehaviorObject(
        structured.expectedBehaviors,
        evaluationCase.expectedBehaviors
      );
      const normalizedForbidden = normalizeBehaviorObject(
        structured.forbiddenBehaviors,
        evaluationCase.forbiddenBehaviors
      );
      if (structured.caseId !== evaluationCase.id
        || normalizedExpected === undefined
        || normalizedForbidden === undefined) {
        throw new Error("Judge did not score every behavior exactly once");
      }
      expectedBehaviors = normalizedExpected;
      forbiddenBehaviors = normalizedForbidden;
    } catch (error) {
      errors.push(`Judge error: ${errorMessage(error)}`);
    }
    const scored = [...expectedBehaviors, ...forbiddenBehaviors] as Array<{ passed?: unknown }>;
    const passed = errors.length === 0 && scored.length > 0 && scored.every(({ passed }) => passed === true);
    const receiptPath = join(options.outputDirectory, `${evaluationCase.key}.json`);
    await writeJson(receiptPath, {
      schemaVersion: 1,
      key: evaluationCase.key,
      caseId: evaluationCase.id,
      skillId: evaluationCase.skillId,
      caseType: evaluationCase.caseType,
      passed,
      response,
      expectedBehaviors,
      forbiddenBehaviors,
      errors
    });
    caseSummaries.push({ key: evaluationCase.key, passed, receiptPath });
  }
  const summary: SharedCoreSummary = {
    schemaVersion: 1,
    passed: caseSummaries.every(({ passed }) => passed),
    outputDirectory: options.outputDirectory,
    cases: caseSummaries
  };
  await writeJson(join(options.outputDirectory, "summary.json"), summary);
  return summary;
}

function judgeSchemaFor(evaluationCase: SharedCoreCase): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["caseId", "expectedBehaviors", "forbiddenBehaviors"],
    properties: {
      caseId: { const: evaluationCase.id },
      expectedBehaviors: exactBehaviorObjectSchema(evaluationCase.expectedBehaviors, "expected"),
      forbiddenBehaviors: exactBehaviorObjectSchema(evaluationCase.forbiddenBehaviors, "forbidden")
    }
  };
}

function exactBehaviorObjectSchema(
  behaviors: string[],
  kind: "expected" | "forbidden"
): object {
  const keys = behaviors.map((_, index) => `item${index}`);
  return {
    type: "object",
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(behaviors.map((behavior, index) => [`item${index}`, {
      type: "object",
      additionalProperties: false,
      required: ["behavior", "passed", "evidence", "reason"],
      properties: {
        behavior: { const: behavior },
        passed: {
          type: "boolean",
          description: kind === "expected"
            ? "True iff the expected behavior is clearly performed or stated."
            : "True iff the forbidden behavior is avoided; false iff it is performed, claimed, or endorsed."
        },
        evidence: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      }
    }]))
  };
}

function validateCase(value: unknown, skillId: string, file: string, skillContent: string): SharedCoreCase {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || (value.caseType !== "normal" && value.caseType !== "boundary")
    || typeof value.prompt !== "string"
    || !stringArray(value.expectedBehaviors)
    || !stringArray(value.forbiddenBehaviors)) {
    throw new Error(`Invalid shared-core evaluation: ${skillId}/${file}`);
  }
  return {
    key: `${skillId}--${file.replace(/\.yaml$/, "")}`,
    id: value.id,
    skillId,
    caseType: value.caseType,
    prompt: value.prompt,
    expectedBehaviors: value.expectedBehaviors,
    forbiddenBehaviors: value.forbiddenBehaviors,
    skillContent
  };
}

function normalizeBehaviorObject(value: unknown, expected: string[]): unknown[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const values = expected.map((_, index) => value[`item${index}`]);
  return values.every((item, index) => isRecord(item) && item.behavior === expected[index])
    ? values
    : undefined;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeExclusiveOutputFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseOutputDirectory(args: string[]): string {
  const index = args.indexOf("--output");
  if (index === -1 || args[index + 1] === undefined) {
    throw new Error("Usage: npm run eval:shared-core -- --output <directory>");
  }
  return resolve(args[index + 1]!);
}

export async function runSharedCoreEvaluationCli(
  args: string[],
  runner: SharedCoreModelRunner = new ClaudeCliRunner() as SharedCoreModelRunner
): Promise<SharedCoreSummary> {
  const requestedKeys = new Set(args.flatMap((value, index) =>
    value === "--case" && args[index + 1] !== undefined ? [args[index + 1]!] : []
  ));
  const cases = await loadSharedCoreCases();
  const selectedCases = requestedKeys.size === 0
    ? cases
    : cases.filter(({ key }) => requestedKeys.has(key));
  if (requestedKeys.size > 0 && selectedCases.length !== requestedKeys.size) {
    const found = new Set(selectedCases.map(({ key }) => key));
    throw new Error(`Unknown shared-core case: ${[...requestedKeys].filter((key) => !found.has(key)).sort().join(", ")}`);
  }
  return evaluateSharedCoreCases({
    cases: selectedCases,
    runner,
    outputDirectory: parseOutputDirectory(args)
  });
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runSharedCoreEvaluationCli(process.argv.slice(2)).then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = summary.passed ? 0 : 1;
  }).catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
