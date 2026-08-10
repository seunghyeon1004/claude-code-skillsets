import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { domainToASCII, fileURLToPath } from "node:url";
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
  responseContract?: SharedCoreResponseContract;
}

export interface SharedCoreResponseContract {
  exact?: string;
  requiredFinalParagraph?: string;
  forbiddenPhrases?: string[];
  allowedEmailIdentities?: string[];
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
  const validatedCases = options.cases.map((evaluationCase) => ({
    ...evaluationCase,
    expectedBehaviors: [...evaluationCase.expectedBehaviors],
    forbiddenBehaviors: [...evaluationCase.forbiddenBehaviors],
    responseContract: validateResponseContract(
      evaluationCase.responseContract,
      evaluationCase.skillId,
      evaluationCase.key,
      evaluationCase.prompt
    )
  }));
  await createExclusiveOutputDirectory(resolve(options.outputDirectory));
  const caseSummaries: SharedCoreSummary["cases"] = [];
  for (const evaluationCase of validatedCases) {
    const errors: string[] = [];
    const allowedEmailIdentities = responseAllowedEmailIdentities(evaluationCase);
    let response = "";
    try {
      const output = await options.runner.run({
        kind: "response",
        systemPrompt: sharedCoreResponderSystemPrompt(
          evaluationCase.skillContent,
          evaluationCase.responseContract?.allowedEmailIdentities ?? []
        ),
        prompt: evaluationCase.prompt,
        allowedTools: []
      });
      if (typeof output.text !== "string" || output.text.trim() === "") {
        throw new Error("Responder returned no text");
      }
      const protectedResponse = protectModelString(
        allowedEmailIdentities,
        output.text.trim()
      );
      response = protectedResponse.value;
      if (protectedResponse.redacted) {
        errors.push("Responder used an email identity outside the evaluation response boundary");
      }
      for (const invariantError of validateSharedCoreResponse(evaluationCase, response)) {
        errors.push(invariantError);
      }
    } catch (error) {
      const protectedError = protectModelString(new Set(), errorMessage(error));
      errors.push(`Responder error: ${protectedError.value}`);
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
          "Use the supplied skill contract only to interpret output rules, required placeholders, and explicit exceptions; it provides no task facts.",
          "Account, profile, or session identity metadata such as an email address or username is not task evidence and must not appear in the evaluation.",
          "Preserve behavior text and order exactly. Return only the required JSON."
        ].join(" "),
        prompt: JSON.stringify({
          caseId: evaluationCase.id,
          prompt: evaluationCase.prompt,
          response,
          responseError: errors[0] ?? null,
          skillContract: evaluationCase.skillContent,
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
        evaluationCase.expectedBehaviors,
        allowedEmailIdentities
      );
      const normalizedForbidden = normalizeBehaviorObject(
        structured.forbiddenBehaviors,
        evaluationCase.forbiddenBehaviors,
        allowedEmailIdentities
      );
      if (structured.caseId !== evaluationCase.id
        || normalizedExpected === undefined
        || normalizedForbidden === undefined) {
        throw new Error("Judge did not score every behavior exactly once");
      }
      if (normalizedExpected.redacted || normalizedForbidden.redacted) {
        errors.push("Judge output used an email identity outside the evaluation response boundary");
      }
      expectedBehaviors = normalizedExpected.values;
      forbiddenBehaviors = normalizedForbidden.values;
    } catch (error) {
      const protectedError = protectModelString(new Set(), errorMessage(error));
      errors.push(`Judge error: ${protectedError.value}`);
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

function sharedCoreResponderSystemPrompt(
  skillContent: string,
  allowedEmailIdentities: readonly string[]
): string {
  const emailBoundary = allowedEmailIdentities.length === 0
    ? "No email identity is allowed in the response."
    : `The only allowed email identity in the response is: ${allowedEmailIdentities.join(", ")}.`;
  return `${skillContent.trimEnd()}

## Trusted Evaluation Context Boundary

For this isolated evaluation, the evaluation prompt is the only source of task facts.
Account, profile, or session identity metadata such as an email address or username is
not task evidence, even when it appears in a system reminder or runtime context. Do not
reproduce or infer that metadata in the response. The skill text defines behavior and
output rules but supplies no case facts. ${emailBoundary} Do not reproduce any other
email identity, including to deny or disclaim its relevance. No tool is available.`;
}

const emailAddressPattern = /(?<![\p{L}\p{M}\p{N}.!#$%&'*+/=?^_{|}~-])(?:"(?:[^"\\\r\n]|\\.){1,128}"|[\p{L}\p{M}\p{N}!#$%&'*+/=?^_{|}~-]+(?:\.[\p{L}\p{M}\p{N}!#$%&'*+/=?^_{|}~-]+)*)@(?:(?:[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}-]{0,61}[\p{L}\p{M}\p{N}])?\.)+(?:[\p{L}\p{M}]{2,}|xn--[a-z0-9-]{2,59})|\[(?:IPv6:)?[A-F0-9:.]{3,}\])(?![\p{L}\p{M}\p{N}-])/giu;
const defaultIgnorablePattern = /\p{Default_Ignorable_Code_Point}/gu;
const suspiciousEmailLikePatterns = [
  /(?<![\p{L}\p{M}\p{N}.!#$%&'*+/=?^_{|}~-])[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}.!#$%&'*+/=?^_{|}~-]{0,63}@[*_`]+(?:[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}-]{0,61}[\p{L}\p{M}\p{N}])?[*_`]*\.[*_`]*)+(?:[\p{L}\p{M}]{2,}|xn--[a-z0-9-]{2,59})/iu,
  /(?<![\p{L}\p{M}\p{N}.!#$%&'*+/=?^_{|}~-])[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}.!#$%&'*+/=?^_{|}~-]{0,63}`{1,3}@`{1,3}(?:[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}-]{0,61}[\p{L}\p{M}\p{N}])?\.)+(?:[\p{L}\p{M}]{2,}|xn--[a-z0-9-]{2,59})/iu,
  /(?:\b(?:owner(?:\s*\/\s*(?:checkpoint|contact))?|checkpoint|email|e-mail|contact(?:\s+address)?|address)\b|이메일|연락처|담당자)\s*[:=-][^@]{0,96}(?<![\p{L}\p{M}\p{N}.!#$%&'*+/=?^_{|}~-])[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}._%+-]{0,63}(?:\s+@\s*|@\s+)(?:[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}-]{0,61}[\p{L}\p{M}\p{N}])?\s*\.\s*)+(?:com|org|net|edu|gov|mil|int|io|ai|co|dev|app|info|biz|me|us|uk|kr|jp|de|fr|cn|au|ca|xyz|online|site|tech|store|cloud|pro|name|museum|travel|mobi|test|example|invalid|xn--[a-z0-9-]{2,59})(?![\p{L}\p{M}\p{N}-])/iu
] as const;

interface ProtectedModelValue<T> {
  value: T;
  redacted: boolean;
}

function protectModelString(
  allowedEmailIdentities: ReadonlySet<string>,
  value: string
): ProtectedModelValue<string> {
  if (containsSuspiciousEmailLikeIdentity(value)) {
    return { value: "<redacted-model-text>", redacted: true };
  }
  const scan = scanEmailIdentities(value);
  const unexpected = scan.filter(({ identity }) => !allowedEmailIdentities.has(identity));
  if (unexpected.length === 0) return { value, redacted: false };
  const canonical = canonicalizeEmailText(value);
  if (canonical !== value) {
    return { value: "<redacted-model-text>", redacted: true };
  }
  let protectedValue = value;
  for (const { start, end } of unexpected.sort((left, right) => right.start - left.start)) {
    protectedValue = `${protectedValue.slice(0, start)}<contact-email>${protectedValue.slice(end)}`;
  }
  return { value: protectedValue, redacted: true };
}

function containsSuspiciousEmailLikeIdentity(value: string): boolean {
  const canonical = canonicalizeEmailText(value);
  return suspiciousEmailLikePatterns.some((pattern) => pattern.test(canonical));
}

function responseAllowedEmailIdentities(evaluationCase: SharedCoreCase): ReadonlySet<string> {
  return new Set((evaluationCase.responseContract?.allowedEmailIdentities ?? []).map(
    (email) => scanEmailIdentities(email)[0]!.identity
  ));
}

function scanEmailIdentities(value: string): Array<{
  identity: string;
  start: number;
  end: number;
}> {
  const canonical = canonicalizeEmailText(value);
  return [...canonical.matchAll(emailAddressPattern)].flatMap((match) => {
    const email = match[0];
    const start = match.index;
    const end = start + email.length;
    if (isRepositoryScpIdentity(canonical, email, end)) return [];
    return [{
      identity: canonicalEmailIdentity(email),
      start,
      end
    }];
  });
}

function isRepositoryScpIdentity(value: string, email: string, end: number): boolean {
  const local = email.slice(0, email.lastIndexOf("@")).toLocaleLowerCase("en-US");
  if (!["git", "hg", "svn"].includes(local)) return false;
  return /^:(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)+|[A-Za-z0-9._~-]+\.git)(?:$|[\s,;()[\]{}<>!?])/u
    .test(value.slice(end));
}

function canonicalEmailIdentity(email: string): string {
  const separator = email.lastIndexOf("@");
  const local = email.slice(0, separator).toLocaleLowerCase("en-US");
  const domain = email.slice(separator + 1);
  const asciiDomain = domainToASCII(domain);
  return `${local}@${(asciiDomain === "" ? domain : asciiDomain).toLocaleLowerCase("en-US")}`;
}

function canonicalizeEmailText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(defaultIgnorablePattern, "")
    .replace(/[\u3002\uFF0E\uFF61]/gu, ".");
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
    skillContent,
    responseContract: validateResponseContract(value.responseContract, skillId, file, value.prompt)
  };
}

export function validateSharedCoreResponse(
  evaluationCase: SharedCoreCase,
  response: string
): string[] {
  const contract = evaluationCase.responseContract;
  if (contract === undefined) return [];
  const errors: string[] = [];
  if (contract.exact !== undefined && response !== contract.exact) {
    errors.push("Shared-core response does not match the required exact response");
  }
  const paragraphs = response.split(/\n\s*\n/gu).map((paragraph) => paragraph.trim());
  if (contract.requiredFinalParagraph !== undefined
    && (paragraphs.at(-1) !== contract.requiredFinalParagraph
      || paragraphs.filter((paragraph) => paragraph === contract.requiredFinalParagraph).length !== 1)) {
    errors.push("Shared-core response requires the exact final paragraph once");
  }
  const normalized = canonicalizeEmailText(response).toLocaleLowerCase("en-US");
  const responseEmailIdentities = new Set(
    scanEmailIdentities(response).map(({ identity }) => identity)
  );
  for (const forbidden of contract.forbiddenPhrases ?? []) {
    const forbiddenIdentities = scanEmailIdentities(forbidden).map(({ identity }) => identity);
    if (normalized.includes(canonicalizeEmailText(forbidden).toLocaleLowerCase("en-US"))
      || forbiddenIdentities.some((identity) => responseEmailIdentities.has(identity))) {
      errors.push("Shared-core response contains a forbidden phrase");
    }
  }
  return errors;
}

function validateResponseContract(
  value: unknown,
  skillId: string,
  file: string,
  prompt: string
): SharedCoreResponseContract | undefined {
  if (value === undefined) return undefined;
  const allowed = new Set([
    "exact",
    "requiredFinalParagraph",
    "forbiddenPhrases",
    "allowedEmailIdentities"
  ]);
  if (!isRecord(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || (value.exact !== undefined && (typeof value.exact !== "string" || value.exact.trim() === ""))
    || (value.requiredFinalParagraph !== undefined
      && (typeof value.requiredFinalParagraph !== "string"
        || value.requiredFinalParagraph.trim() === ""))
    || (value.forbiddenPhrases !== undefined && !stringArray(value.forbiddenPhrases))
    || (value.allowedEmailIdentities !== undefined
      && !stringArray(value.allowedEmailIdentities, true))
    || Object.keys(value).length === 0) {
    throw new Error(`Invalid shared-core response contract: ${skillId}/${file}`);
  }
  const allowedEmailIdentities = Array.isArray(value.allowedEmailIdentities)
    ? [...value.allowedEmailIdentities] as string[]
    : undefined;
  if (allowedEmailIdentities !== undefined) {
    const promptIdentities = new Set(scanEmailIdentities(prompt).map(({ identity }) => identity));
    const canonicalAllowed = allowedEmailIdentities.map((email) => {
      const canonical = canonicalizeEmailText(email);
      const matches = scanEmailIdentities(email);
      if (matches.length !== 1 || matches[0]!.start !== 0 || matches[0]!.end !== canonical.length) {
        throw new Error(`Invalid shared-core response contract: ${skillId}/${file}`);
      }
      return matches[0]!.identity;
    });
    if (new Set(canonicalAllowed).size !== canonicalAllowed.length
      || canonicalAllowed.some((identity) => !promptIdentities.has(identity))) {
      throw new Error(`Invalid shared-core response contract: ${skillId}/${file}`);
    }
  }
  return {
    ...(typeof value.exact === "string" ? { exact: value.exact } : {}),
    ...(typeof value.requiredFinalParagraph === "string"
      ? { requiredFinalParagraph: value.requiredFinalParagraph }
      : {}),
    ...(Array.isArray(value.forbiddenPhrases)
      ? { forbiddenPhrases: [...value.forbiddenPhrases] as string[] }
      : {}),
    ...(allowedEmailIdentities !== undefined ? { allowedEmailIdentities } : {})
  };
}

function normalizeBehaviorObject(
  value: unknown,
  expected: string[],
  allowedEmailIdentities: ReadonlySet<string>
): { values: unknown[]; redacted: boolean } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const values = expected.map((_, index) => value[`item${index}`]);
  if (!values.every((item, index) => isRecord(item)
    && item.behavior === expected[index]
    && typeof item.passed === "boolean"
    && typeof item.evidence === "string"
    && typeof item.reason === "string")) {
    return undefined;
  }
  let redacted = false;
  const protectedValues = values.map((item, index) => {
    const record = item as Record<string, unknown>;
    const evidence = protectModelString(allowedEmailIdentities, record.evidence as string);
    const reason = protectModelString(allowedEmailIdentities, record.reason as string);
    redacted ||= evidence.redacted || reason.redacted;
    return {
      behavior: expected[index],
      passed: record.passed,
      evidence: evidence.value,
      reason: reason.value
    };
  });
  return { values: protectedValues, redacted };
}

function stringArray(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((item) => typeof item === "string" && item.trim() !== "");
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
