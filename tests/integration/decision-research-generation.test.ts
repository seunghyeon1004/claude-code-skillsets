import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { validateObservationEvidence, validateSourceObservation } from "../../src/contracts/observation.js";
import type { ObservationEvidence } from "../../src/model/observation.js";
import { loadResearchRepository } from "../../src/research/repository.js";
import { materializeSourceObservations, unknownFields } from "../../src/research/source-observation.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
let research!: Awaited<ReturnType<typeof loadResearchRepository>>;
let materializedAsOf!: string;

describe("decision research materialization", () => {
  beforeAll(async () => {
    const reviewState = JSON.parse(
      await readFile(`${repositoryRoot}/research/materialized-review-state.json`, "utf8")
    ) as { asOf?: unknown };
    if (typeof reviewState.asOf !== "string") throw new Error("Materialized review state must declare asOf");
    materializedAsOf = reviewState.asOf;
    execFileSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "scripts/research/materialize-decision-research.ts", "--check", "--as-of", materializedAsOf], {
      cwd: repositoryRoot,
      stdio: "pipe"
    });
    research = await loadResearchRepository(repositoryRoot);
  }, 20_000);

  it("keeps the generated projections byte-identical and loads them through the research repository", async () => {
    const [observations, diffs, reviewState] = await Promise.all([
      readFile(`${repositoryRoot}/research/source-observations.json`, "utf8"),
      readFile(`${repositoryRoot}/research/source-diffs.json`, "utf8"),
      readFile(`${repositoryRoot}/research/materialized-review-state.json`, "utf8")
    ]);

    expect(JSON.parse(observations)).toEqual({ schemaVersion: 3, observations: research.sourceObservations });
    expect(JSON.parse(diffs)).toEqual({ schemaVersion: 3, diffs: research.sourceDiffs });
    expect(JSON.parse(reviewState)).toEqual({
      schemaVersion: 3,
      asOf: materializedAsOf,
      states: research.materializedReviewState
    });
  });

  it("extends legacy snapshots only with directly backed v3 sensitive evidence", () => {
    expect(research.sourceObservations).toHaveLength(15);
    expect(research.sourceDiffs.every(({ status }) => status === "baseline")).toBe(true);
    const evidenceById = new Map(research.observationEvidence.map((evidence) => [evidence.id, evidence]));
    for (const observation of research.sourceObservations) {
      const evidence = evidenceById.get(observation.latestEvidenceId);
      if (evidence === undefined) {
        expect(observation.latestEvidenceId).toMatch(/^legacy-/u);
        expect(observation.fields).toEqual(unknownFields());
        continue;
      }
      expect(observation).toMatchObject({
        sourceId: evidence.sourceId,
        observedAt: evidence.observedAt,
        inspectedCommit: evidence.inspectedCommit
      });
      expect(observation.fields).toEqual(evidence.fields);
    }

    const nonOfficialSourceIds = research.sourceReviewBacklog.candidates.map(({ sourceId }) => sourceId);
    const initialStates = research.materializedReviewState.filter(({ sourceId }) => nonOfficialSourceIds.includes(sourceId));
    expect(initialStates).toHaveLength(14);
    expect(initialStates.every(({ state, reason, decisionId }) =>
      state === "held" && reason === "not-reviewed" && decisionId === null
    )).toBe(true);
  });

  it("materializes a controlled legacy source as unknown until exact v3 evidence exists", () => {
    const source = research.sourceConfigs[0];
    if (source === undefined) throw new Error("Migration fixture requires one source config");
    const receipt = research.collectionReceipts.find(({ sourceId }) => sourceId === source.sourceId);
    if (receipt === undefined) throw new Error("Migration fixture requires one collection receipt");
    const snapshot = research.snapshots.find(({ id }) => id === receipt.snapshotId);
    if (snapshot === undefined) throw new Error("Migration fixture receipt requires its snapshot");
    const input = {
      sourceConfigs: [source],
      collectionReceipts: [receipt],
      snapshots: [snapshot],
      observationEvidence: [] as ObservationEvidence[],
      sourceReviewBacklog: {
        ...research.sourceReviewBacklog,
        candidates: research.sourceReviewBacklog.candidates.filter(({ sourceId }) => sourceId === source.sourceId)
      }
    };
    const [legacy] = materializeSourceObservations(input);
    if (legacy === undefined) throw new Error("Migration fixture must materialize one source");

    expect(legacy).toMatchObject({
      sourceId: source.sourceId,
      latestEvidenceId: `legacy-${snapshot.id}`,
      previousEvidenceId: null,
      observedAt: snapshot.observedAt,
      inspectedCommit: snapshot.inspectedCommit,
      fields: unknownFields()
    });

    const directEvidence = { path: "LICENSE", contentSha256: "a".repeat(64) };
    const evidence: ObservationEvidence = {
      schemaVersion: 3,
      id: "observation-controlled-v3",
      sourceId: legacy.sourceId,
      observedAt: legacy.observedAt,
      inspectedCommit: legacy.inspectedCommit,
      blobs: [{
        path: directEvidence.path,
        gitBlobSha: "b".repeat(40),
        byteSize: 0,
        readStatus: "observed",
        contentSha256: directEvidence.contentSha256
      }],
      fields: unknownFields()
    };
    evidence.fields.license = { status: "observed", evidence: [directEvidence] };
    evidence.fields.permissions = { status: "not-applicable", evidence: [] };
    expect(validateObservationEvidence(evidence)).toEqual(evidence);

    const [observed] = materializeSourceObservations({
      ...input,
      observationEvidence: [evidence]
    });
    if (observed === undefined) throw new Error("Migration fixture must materialize v3 evidence");
    expect(observed).toMatchObject({
      latestEvidenceId: evidence.id,
      previousEvidenceId: null,
      observedAt: evidence.observedAt,
      inspectedCommit: evidence.inspectedCommit
    });
    expect(observed.fields).toEqual(evidence.fields);

    const missingHashBinding = structuredClone(evidence);
    missingHashBinding.blobs = [];
    expect(() => validateObservationEvidence(missingHashBinding)).toThrow(
      "fields.license: evidence must reference an observed blob with its direct content SHA-256"
    );
  });

  it("rejects a contract-valid forged tracked materialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "decision-research-forgery-"));
    try {
      await Promise.all(["research", "manifests", "governance"].map((path) => cp(
        join(repositoryRoot, path),
        join(root, path),
        { recursive: true }
      )));
      const observationsPath = join(root, "research", "source-observations.json");
      const document = JSON.parse(await readFile(observationsPath, "utf8")) as {
        observations: Array<{
          observedAt: string;
        }>;
      };
      const forged = document.observations[0];
      if (forged === undefined) throw new Error("Forgery fixture requires one materialized observation");
      forged.observedAt = new Date(Date.parse(forged.observedAt) + 1_000)
        .toISOString()
        .replace(".000Z", "Z");
      expect(() => validateSourceObservation(forged)).not.toThrow();
      await writeFile(observationsPath, `${JSON.stringify(document, null, 2)}\n`);

      await expect(loadResearchRepository(root)).rejects.toThrow(
        "research/source-observations.json: is not the current deterministic materialization"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
