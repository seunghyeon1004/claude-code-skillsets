import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { DomainId } from "../model/complete-v1.js";

const require = createRequire(import.meta.url);
const schema = require("../../schemas/v3/setup-decision-scenarios.schema.json") as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile<SetupDecisionScenarioManifest>(schema);

export interface SetupDecisionScenarioManifest {
  schemaVersion: 1;
  recommendationData: "plugin-owned-decision-index";
  scenarios: SetupDecisionScenario[];
}

export interface SetupDecisionScenario {
  id: string;
  input: {
    language: "ko" | "en";
    goal?: string;
    domainIds?: DomainId[];
    domainPriority?: DomainId[];
    timeProbe: "pending" | "granted" | "granted-at-expiry" | "refused";
    riskAcknowledged: boolean;
    approval: "none" | "current" | "changed-digest";
  };
  expected: {
    state: string;
    executionStatus: "not-executed" | "executed" | "failed";
    commandStatuses: Array<"success" | "failure" | "skipped">;
    receiptCandidateIds: string[];
    publicationPhases: Array<"initial-approved-lock" | "candidate-success" | "final-failure-or-skipped">;
    oldApprovalState: string | null;
    approvalValid: boolean;
  };
}

/** Validates the actual-index setup scenario corpus before it drives the production decision path. */
export function validateSetupDecisionScenarioManifest(value: unknown): SetupDecisionScenarioManifest {
  if (!validate(value)) {
    throw new Error(`Invalid setup decision scenario manifest:\n${formatErrors(validate.errors).join("\n")}`);
  }
  const ids = new Set<string>();
  for (const scenario of value.scenarios) {
    if (ids.has(scenario.id)) throw new Error(`Invalid setup decision scenario manifest:\n/scenarios: duplicate ID ${scenario.id}`);
    ids.add(scenario.id);
  }
  return value;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || "/"}: ${error.message ?? "invalid"}`);
}
