import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { materializeDecisionResearch } from "./materialize-decision-research.js";

export async function checkDecisionBrokerV1(input: { root: string }): Promise<void> {
  const root = resolve(input.root);
  const statePath = join(root, "research", "materialized-review-state.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as unknown;
  const asOf = materializationAsOf(state);
  await materializeDecisionResearch({ root, asOf, checkOnly: true });
}

export function materializationAsOf(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("research/materialized-review-state.json must provide schemaVersion 3 and a fixed asOf timestamp");
  }
  const document = value as Record<string, unknown>;
  const asOf = document.asOf;
  if (document.schemaVersion !== 3 || typeof asOf !== "string") {
    throw new Error("research/materialized-review-state.json must provide schemaVersion 3 and a fixed asOf timestamp");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(asOf) || !Number.isFinite(Date.parse(asOf))) {
    throw new Error("research/materialized-review-state.json asOf must be an explicit RFC3339 UTC timestamp");
  }
  return asOf;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void checkDecisionBrokerV1({ root: process.cwd() }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
