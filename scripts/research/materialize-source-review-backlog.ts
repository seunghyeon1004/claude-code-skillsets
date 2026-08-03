import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateResearchCollectionReceipt, validateResearchSnapshot, validateResearchSourceConfig } from "../../src/contracts/complete-v1.js";
import { createDiscoveryTaxonomy } from "../../src/discovery/broker.js";
import { loadCompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import type { SourceReviewBacklog } from "../../src/model/complete-v1.js";
import { materializeSourceReviewCandidates } from "../../src/research/review-queue-materialization.js";
import { verifyResearchSnapshot } from "../../src/research/snapshot.js";

const root = process.cwd();
const destination = join(root, "research/source-review-backlog.json");
const checkOnly = process.argv.slice(2).includes("--check");

const [sourceConfigs, collectionReceipts, snapshots, complete] = await Promise.all([
  loadRecords("research/sources", validateResearchSourceConfig),
  loadRecords("research/receipts", validateResearchCollectionReceipt),
  loadRecords("research/snapshots", (value) => verifyResearchSnapshot(validateResearchSnapshot(value))),
  loadCompleteV1Repository(root)
]);
const backlog: SourceReviewBacklog = {
  schemaVersion: 2,
  candidates: materializeSourceReviewCandidates({
    sourceConfigs,
    collectionReceipts,
    snapshots,
    taxonomy: createDiscoveryTaxonomy(complete)
  })
};
const serialized = `${JSON.stringify(backlog, null, 2)}\n`;

if (checkOnly) {
  const current = await readFile(destination, "utf8");
  if (current !== serialized) {
    throw new Error("research/source-review-backlog.json is stale; run npm run research:materialize-source-review-backlog");
  }
} else {
  await writeFile(destination, serialized, "utf8");
}

async function loadRecords<T>(
  directory: string,
  validate: (value: unknown) => T
): Promise<T[]> {
  const filenames = (await readdir(join(root, directory)))
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  return Promise.all(filenames.map(async (filename) => validate(JSON.parse(
    await readFile(join(root, directory, filename), "utf8")
  ) as unknown)));
}
