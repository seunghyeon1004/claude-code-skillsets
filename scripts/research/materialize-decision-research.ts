import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  validateResearchCollectionReceipt,
  validateResearchSnapshot,
  validateResearchSourceConfig,
  validateSourceReviewBacklog
} from "../../src/contracts/complete-v1.js";
import { validateObservationEvidence } from "../../src/contracts/observation.js";
import { validateReviewerRegistry } from "../../src/contracts/review-ledger.js";
import type {
  ResearchCollectionReceipt,
  ResearchSnapshot,
  ResearchSourceConfig,
  SourceReviewBacklog
} from "../../src/model/complete-v1.js";
import type { ObservationEvidence, SourceDiff, SourceObservation } from "../../src/model/observation.js";
import type { ReviewerRegistry } from "../../src/model/review-ledger.js";
import { parseReviewLedgerJsonl } from "../../src/research/review-ledger.js";
import { materializeReviewState, type MaterializedReviewState } from "../../src/research/review-state.js";
import { materializeSourceDiff, baselineSourceDiff } from "../../src/research/source-diff.js";
import { materializeSourceObservationContexts } from "../../src/research/source-observation.js";
import { verifyResearchSnapshot } from "../../src/research/snapshot.js";

export interface DecisionResearchMaterializationInput {
  root: string;
  asOf: string;
  checkOnly: boolean;
}

/** Re-materializes the three decision projections from the repository inputs. */
export async function materializeDecisionResearch(input: DecisionResearchMaterializationInput): Promise<void> {
  const [sourceConfigs, collectionReceipts, snapshots, sourceReviewBacklog, observationEvidence, ledgerContent, reviewers] = await Promise.all([
    loadRecords(input.root, "research/sources", validateResearchSourceConfig),
    loadRecords(input.root, "research/receipts", validateResearchCollectionReceipt),
    loadRecords(input.root, "research/snapshots", (value) => verifyResearchSnapshot(validateResearchSnapshot(value))),
    loadJson(input.root, "research/source-review-backlog.json", validateSourceReviewBacklog),
    loadOptionalRecords(input.root, "research/observation-evidence", validateObservationEvidence),
    readFile(join(input.root, "research/review-ledger.jsonl"), "utf8"),
    loadJson(input.root, "governance/reviewers.json", validateReviewerRegistry)
  ]);

  const contexts = materializeSourceObservationContexts({
    sourceConfigs,
    collectionReceipts,
    snapshots,
    observationEvidence,
    sourceReviewBacklog
  });
  const observations = contexts.map(({ source }) => source);
  const diffs = contexts.map(({ source, evidence, previousEvidence }) => evidence === undefined
    ? baselineSourceDiff({ sourceId: source.sourceId, currentEvidenceId: source.latestEvidenceId })
    : materializeSourceDiff({ current: evidence, previous: previousEvidence }));
  const states = materializeReviewState({
    observations: contexts,
    diffs,
    ledger: parseReviewLedgerJsonl(ledgerContent),
    reviewers,
    asOf: input.asOf
  });

  const outputs: Array<{ path: string; value: unknown }> = [
    { path: "research/source-observations.json", value: { schemaVersion: 3, observations } },
    { path: "research/source-diffs.json", value: { schemaVersion: 3, diffs } },
    { path: "research/materialized-review-state.json", value: { schemaVersion: 3, asOf: input.asOf, states } }
  ];

  for (const output of outputs) {
    const serialized = `${JSON.stringify(output.value, null, 2)}\n`;
    const destination = join(input.root, output.path);
    if (input.checkOnly) {
      const current = await readFile(destination, "utf8");
      if (current !== serialized) {
        throw new Error(`${output.path} is stale; run npm run research:materialize-decision -- --as-of ${input.asOf}`);
      }
    } else {
      await writeFile(destination, serialized, "utf8");
    }
  }
}

function parseArguments(argumentsList: readonly string[]): { checkOnly: boolean; asOf: string } {
  let checkOnly = false;
  let asOf: string | undefined;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]!;
    if (argument === "--check") {
      checkOnly = true;
      continue;
    }
    if (argument === "--as-of") {
      asOf = argumentsList[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (asOf === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(asOf)) {
    throw new Error("--as-of <RFC3339 UTC> is required");
  }
  return { checkOnly, asOf };
}

async function loadJson<T>(root: string, path: string, validate: (value: unknown) => T): Promise<T> {
  return validate(JSON.parse(await readFile(join(root, path), "utf8")) as unknown);
}

async function loadRecords<T>(root: string, directory: string, validate: (value: unknown) => T): Promise<T[]> {
  const filenames = (await readdir(join(root, directory)))
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  return Promise.all(filenames.map(async (filename) => loadJson(root, `${directory}/${filename}`, validate)));
}

async function loadOptionalRecords<T>(root: string, directory: string, validate: (value: unknown) => T): Promise<T[]> {
  try {
    return await loadRecords(root, directory, validate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function main(args: readonly string[]): Promise<void> {
  const { checkOnly, asOf } = parseArguments(args);
  await materializeDecisionResearch({ root: process.cwd(), asOf, checkOnly });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export type { MaterializedReviewState, ObservationEvidence, ReviewerRegistry, SourceDiff, SourceObservation };
