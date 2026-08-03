import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
import type { ReviewLedgerEvent, ReviewerRegistry } from "../../src/model/review-ledger.js";
import { parseReviewLedgerJsonl } from "../../src/research/review-ledger.js";
import { materializeReviewState, type MaterializedReviewState } from "../../src/research/review-state.js";
import { baselineSourceDiff, materializeSourceDiff } from "../../src/research/source-diff.js";
import { materializeSourceObservationContexts } from "../../src/research/source-observation.js";
import { assertSourceReviewBacklog } from "../../src/research/source-review-backlog.js";
import { verifyResearchSnapshot } from "../../src/research/snapshot.js";
import { assertP03Immutable } from "./assert-p03-immutable.js";

/** The v1 bootstrap must be reproducible; it is not the current wall clock. */
export const DECISION_BROKER_V1_AS_OF = "2026-07-29T00:00:00Z";

export interface DecisionBrokerV1Migration {
  asOf: string;
  observations: SourceObservation[];
  diffs: SourceDiff[];
  states: MaterializedReviewState[];
  ledgerEvents: ReviewLedgerEvent[];
  files: Readonly<Record<DecisionResearchFile, string>>;
}

export type DecisionResearchFile =
  | "research/source-observations.json"
  | "research/source-diffs.json"
  | "research/materialized-review-state.json";

/**
 * Re-materializes v1 projections from immutable source records. It deliberately
 * never writes observations, review decisions, receipts, or snapshots.
 */
export async function migrateDecisionBrokerV1(input: { root: string }): Promise<DecisionBrokerV1Migration> {
  const root = resolve(input.root);
  assertP03Immutable({ root });
  const [sourceConfigs, collectionReceipts, snapshots, sourceReviewBacklog, observationEvidence, ledgerContent, reviewers] = await Promise.all([
    loadRecords(root, "research/sources", validateResearchSourceConfig),
    loadRecords(root, "research/receipts", validateResearchCollectionReceipt),
    loadRecords(root, "research/snapshots", (value) => verifyResearchSnapshot(validateResearchSnapshot(value))),
    loadJson(root, "research/source-review-backlog.json", validateSourceReviewBacklog),
    loadRecords(root, "research/observation-evidence", validateObservationEvidence),
    readFile(join(root, "research/review-ledger.jsonl"), "utf8"),
    loadJson(root, "governance/reviewers.json", validateReviewerRegistry)
  ]);

  assertInitialLegacyInventory(sourceConfigs, collectionReceipts, snapshots);
  assertSourceReviewBacklog({
    backlog: sourceReviewBacklog,
    sourceConfigs,
    collectionReceipts,
    snapshots
  });
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
  const ledgerEvents = parseReviewLedgerJsonl(ledgerContent);
  const states = materializeReviewState({
    observations: contexts,
    diffs,
    ledger: ledgerEvents,
    reviewers,
    asOf: DECISION_BROKER_V1_AS_OF
  });
  const files = {
    "research/source-observations.json": serialize({ schemaVersion: 3, observations }),
    "research/source-diffs.json": serialize({ schemaVersion: 3, diffs }),
    "research/materialized-review-state.json": serialize({
      schemaVersion: 3,
      asOf: DECISION_BROKER_V1_AS_OF,
      states
    })
  } satisfies Record<DecisionResearchFile, string>;

  return { asOf: DECISION_BROKER_V1_AS_OF, observations, diffs, states, ledgerEvents, files };
}

export async function writeDecisionBrokerV1Migration(input: { root: string; checkOnly: boolean }): Promise<DecisionBrokerV1Migration> {
  const migration = await migrateDecisionBrokerV1(input);
  for (const [path, content] of Object.entries(migration.files) as Array<[DecisionResearchFile, string]>) {
    const destination = join(resolve(input.root), path);
    if (input.checkOnly) {
      const current = await readFile(destination, "utf8");
      if (current !== content) throw new Error(`${path} is stale; run npm run research:migrate-decision-broker-v1`);
    } else {
      await writeFile(destination, content, "utf8");
    }
  }
  return migration;
}

function assertInitialLegacyInventory(
  sourceConfigs: readonly ResearchSourceConfig[],
  receipts: readonly ResearchCollectionReceipt[],
  snapshots: readonly ResearchSnapshot[]
): void {
  if (sourceConfigs.length !== 15 || receipts.length !== 15 || snapshots.length !== 15) {
    throw new Error("Decision Broker v1 migration requires the exact 15 legacy source/receipt/snapshot records");
  }
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function loadJson<T>(root: string, path: string, validate: (value: unknown) => T): Promise<T> {
  return validate(JSON.parse(await readFile(join(root, path), "utf8")) as unknown);
}

async function loadRecords<T>(root: string, directory: string, validate: (value: unknown) => T): Promise<T[]> {
  let filenames: string[];
  try {
    filenames = (await readdir(join(root, directory)))
      .filter((filename) => filename.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${directory}: required record root is missing`, { cause: error });
    }
    throw error;
  }
  return Promise.all(filenames.map(async (filename) => loadJson(root, `${directory}/${filename}`, validate)));
}

async function main(args: readonly string[]): Promise<void> {
  if (args.some((argument) => argument !== "--check")) {
    throw new Error("usage: migrate-decision-broker-v1.ts [--check]");
  }
  await writeDecisionBrokerV1Migration({ root: process.cwd(), checkOnly: args.includes("--check") });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
