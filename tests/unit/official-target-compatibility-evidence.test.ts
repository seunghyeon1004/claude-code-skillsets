import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadDecisionManifests } from "../../src/decision/repository.js";
import { generateDecisionIndex } from "../../src/generate/decision-index.js";
import { canonicalize } from "../../src/research/canonical-json.js";
import {
  createAuthenticatedSourceObservationLoader,
  loadResearchRepository
} from "../../src/research/repository.js";
import { computeSnapshotContentSha256 } from "../../src/research/snapshot.js";
import type { ResearchSnapshot } from "../../src/model/complete-v1.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("official target compatibility evidence", () => {
  it("rejects a tampered source snapshot digest", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    manifest.officialTargetCompatibilityEvidence[0]!.snapshot.marketplaceEntrySourceCommit = "0".repeat(40);
    await writeManifest(root, manifest);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/snapshot digest mismatch/i);
  });

  it("rejects a rehashed marketplace source commit that diverges from the validated entry", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    const evidence = manifest.officialTargetCompatibilityEvidence[0]!;
    evidence.snapshot.marketplaceEntrySourceCommit = "0".repeat(40);
    refreshEvidenceDigest(evidence);
    await writeManifest(root, manifest);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/marketplace.*source commit|source commit.*marketplace/i);
  });

  it("rejects a candidate/source identity mismatch before generation", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    manifest.officialTargetCompatibilityEvidence[0]!.candidateId = "fabricated-candidate";
    await writeManifest(root, manifest);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/candidate does not exist/i);
  });

  it("rejects a rehashed artifact with an attacker source URL", async () => {
    const root = await createFixtureRoot();
    await rewriteArtifact(root, (artifact) => {
      artifact.candidate.officialBaseline.sourceUrl = "https://github.com/attacker/Shopify-AI-Toolkit.git";
    });

    await expect(loadDecisionManifests(root)).rejects.toThrow(/officialBaseline binding mismatch/i);
  });

  it("rejects a base evidence artifact that injects a candidate revision ID", async () => {
    const root = await createFixtureRoot();
    await rewriteArtifact(root, (artifact) => {
      artifact.candidate.candidateRevisionId = "shopify-ai-toolkit-revision-attacker";
    });

    await expect(loadDecisionManifests(root)).rejects.toThrow(/candidate.*binding mismatch|candidate revision/i);
  });

  it("rejects a modified artifact without the declared artifact hash", async () => {
    const root = await createFixtureRoot();
    const artifact = await readArtifact(root);
    artifact.capabilities[0]!.claim = "attacker rewrite";
    await writeFile(artifactPath(root), JSON.stringify(artifact));

    await expect(loadDecisionManifests(root)).rejects.toThrow(/artifact SHA-256 mismatch/i);
  });

  it("rejects an official capability artifact symlink even when the target bytes match", async () => {
    const root = await createFixtureRoot();
    const path = artifactPath(root);
    const outside = await mkdtemp(join(tmpdir(), "official-target-artifact-outside-"));
    temporaryRoots.push(outside);
    const outsideArtifact = join(outside, "artifact.json");
    await writeFile(outsideArtifact, await readFile(path));
    await rm(path);
    await symlink(outsideArtifact, path);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/artifact|escapes repository root|symlink/i);
  });

  it("loads immutable upstream source metadata without vendored source blobs", async () => {
    const root = await createFixtureRoot();
    await rm(join(root, "research", "evidence", "artifacts", "shopify-ai-toolkit-556811e94dd45c795abe5c0b1bf6b5a4b098149d", "source-blobs"), {
      recursive: true,
      force: true
    });

    const repository = await loadDecisionManifests(root);
    const candidate = repository.candidateEvidence.find(({ candidate }) => candidate.id === "shopify-ai-toolkit")!.candidate;
    expect(candidate.officialBaseline?.sourceBlobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "README.md",
        contentSha256: "af1b941c36d5c18a0a2d72046776c177d6c7694c7fc28ef1d1c224532ebac8f9",
        immutableRawUrl: "https://raw.githubusercontent.com/Shopify/Shopify-AI-Toolkit/556811e94dd45c795abe5c0b1bf6b5a4b098149d/README.md"
      }),
      expect.objectContaining({
        path: "LICENSE",
        contentSha256: "75c4e0e960d7639e5974c0b10a420f738b8011ac08742d3bbb13cca849fda9f4",
        immutableRawUrl: "https://raw.githubusercontent.com/Shopify/Shopify-AI-Toolkit/556811e94dd45c795abe5c0b1bf6b5a4b098149d/LICENSE"
      })
    ]));
    for (const sourceBlob of candidate.officialBaseline?.sourceBlobs ?? []) {
      expect(sourceBlob).not.toHaveProperty("assetPath");
    }
  });

  it("rejects an immutable raw URL that is not derived from repository, commit, and path", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    const candidate = manifest.candidates[0]!;
    const baseline = candidate.officialBaseline as { sourceBlobs: Array<Record<string, unknown>> };
    baseline.sourceBlobs[0]!.immutableRawUrl = "https://raw.githubusercontent.com/attacker/repository/0000000000000000000000000000000000000000/README.md";
    await writeManifest(root, manifest);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/immutable raw URL/i);
  });

  it("rejects a rehashed artifact and evidence whose source blob hash diverges from the candidate baseline", async () => {
    const root = await createFixtureRoot();
    await rewriteArtifact(root, (artifact) => {
      const [readme, admin] = artifact.sourceBlobs;
      readme!.immutableRawUrl = admin!.immutableRawUrl;
      readme!.contentSha256 = admin!.contentSha256;
    });

    await expect(loadDecisionManifests(root)).rejects.toThrow(/immutable official source blob binding/i);
  });

  it("rejects a replayed official inference outside the authenticated catalog epoch", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    const evidence = manifest.officialTargetCompatibilityEvidence[0]!;
    evidence.observedAt = "2026-07-20T00:00:00Z";
    evidence.reviewedAt = "2026-07-20T00:00:00Z";
    evidence.expiresAt = "2026-07-28T00:00:00Z";
    refreshEvidenceDigest(evidence);
    await writeManifest(root, manifest);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/catalog epoch|replay|timestamp/i);
  });

  it("rejects a future official inference even when its digests are recomputed", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    const evidence = manifest.officialTargetCompatibilityEvidence[0]!;
    evidence.observedAt = "2026-07-30T00:00:00Z";
    evidence.reviewedAt = "2026-07-30T00:00:00Z";
    evidence.expiresAt = "2026-08-08T00:00:00Z";
    refreshEvidenceDigest(evidence);
    await writeManifest(root, manifest);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/catalog epoch|future|timestamp/i);
  });

  it("rejects an official inference whose validity exceeds catalog freshness", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    const evidence = manifest.officialTargetCompatibilityEvidence[0]!;
    evidence.expiresAt = "2026-08-08T00:00:00Z";
    refreshEvidenceDigest(evidence);
    await writeManifest(root, manifest);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/nine days|freshness|ttl|validity/i);
  });

  it("rejects replaying a pinned marketplace receipt into a later catalog epoch", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    const evidence = manifest.officialTargetCompatibilityEvidence[0]!;
    evidence.observedAt = "2026-08-10T00:00:00Z";
    evidence.reviewedAt = "2026-08-10T00:00:00Z";
    evidence.expiresAt = "2026-08-19T00:00:00Z";
    refreshEvidenceDigest(evidence);
    await writeManifest(root, manifest);
    const statePath = join(root, "research", "materialized-review-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as { asOf: string };
    state.asOf = "2026-08-10T00:00:00Z";
    await writeFile(statePath, JSON.stringify(state));
    const claimsPath = join(root, "manifests", "official-listing-capability-claims.yaml");
    const claims = parse(await readFile(claimsPath, "utf8")) as {
      compatibilityAttestation: { observedAt: string; reviewedAt: string; expiresAt: string };
    };
    claims.compatibilityAttestation.observedAt = "2026-08-10T00:00:00Z";
    claims.compatibilityAttestation.reviewedAt = "2026-08-10T00:00:00Z";
    claims.compatibilityAttestation.expiresAt = "2026-08-19T00:00:00Z";
    await writeFile(claimsPath, JSON.stringify(claims));

    await expect(loadDecisionManifests(root)).rejects.toThrow(/pinned source receipt|receipt.*freshness|replay/i);
  });

  it("rejects an older tampered current-epoch materialization without a candidate revision", async () => {
    const root = await createFixtureRoot();
    await expect(loadDecisionManifests(root)).resolves.toBeDefined();
    const observationsPath = join(root, "research", "source-observations.json");
    const observations = JSON.parse(await readFile(observationsPath, "utf8")) as {
      observations: Array<{ sourceId: string; observedAt: string }>;
    };
    const official = observations.observations.find(({ sourceId }) => sourceId === "anthropic-plugins-official")!;
    official.observedAt = new Date(Date.parse(official.observedAt) - 1_000).toISOString().replace(".000Z", "Z");
    await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/source observation|materialization|materialized/i);
  });

  it("revalidates source configuration after a successful request", async () => {
    const root = await createFixtureRoot();
    await expect(loadDecisionManifests(root)).resolves.toBeDefined();
    const path = join(root, "research", "sources", "anthropic-plugins-official.json");
    const source = JSON.parse(await readFile(path, "utf8")) as { repository: string };
    source.repository = "https://github.com/attacker/claude-plugins-official";
    await writeFile(path, `${JSON.stringify(source, null, 2)}\n`);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/repository|source configuration|snapshot provenance/i);
  });

  it("revalidates an existing receipt and its bound snapshot after a successful request", async () => {
    const root = await createFixtureRoot();
    await expect(loadDecisionManifests(root)).resolves.toBeDefined();
    const receiptPath = join(root, "research", "receipts", "2026-07-23-anthropic-plugins-official.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { observedAt: string };
    receipt.observedAt = "2026-07-23T09:08:13Z";
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/receipt does not bind|snapshot provenance/i);
  });

  it("rejects forged receipt provenance for every owned triad in the full repository", async () => {
    const root = await createFixtureRoot();
    const path = join(root, "research", "receipts", "2026-07-23-anthropic-skills.json");
    const receipt = JSON.parse(await readFile(path, "utf8")) as { inspectedCommit: string };
    receipt.inspectedCommit = "0".repeat(40);
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);

    await expect(loadResearchRepository(root)).rejects.toThrow(/receipt|snapshot provenance|source binding/i);
  });

  it("revalidates snapshot bytes after a successful request", async () => {
    const root = await createFixtureRoot();
    await expect(loadDecisionManifests(root)).resolves.toBeDefined();
    const snapshotPath = join(root, "research", "snapshots", "2026-07-23-anthropic-plugins-official.json");
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as { entries: Array<{ address: string }> };
    snapshot.entries[0]!.address = "attacker/SKILL.md";
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/snapshot|contentSha256|digest/i);
  });

  it("rejects a rehashed snapshot with a forged repository-relative path", async () => {
    const root = await createFixtureRoot();
    const snapshotPath = join(root, "research", "snapshots", "2026-07-23-anthropic-plugins-official.json");
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as ResearchSnapshot;
    snapshot.entries[0]!.address = "../attacker/SKILL.md";
    snapshot.contentSha256 = computeSnapshotContentSha256(snapshot.entries);
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const receiptPath = join(root, "research", "receipts", "2026-07-23-anthropic-plugins-official.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { snapshotContentSha256: string };
    receipt.snapshotContentSha256 = snapshot.contentSha256;
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/repository-relative|marketplace-entry address|snapshot/i);
  });

  it("discovers a newer receipt added after a successful request", async () => {
    const root = await createFixtureRoot();
    await expect(loadDecisionManifests(root)).resolves.toBeDefined();
    const receiptPath = join(root, "research", "receipts", "2026-07-23-anthropic-plugins-official.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
      id: string;
      observedAt: string;
    };
    receipt.id = "2026-07-24-anthropic-plugins-official";
    receipt.observedAt = "2026-07-24T09:08:12Z";
    await writeFile(
      join(root, "research", "receipts", "2026-07-24-anthropic-plugins-official.json"),
      `${JSON.stringify(receipt, null, 2)}\n`
    );

    await expect(loadDecisionManifests(root)).rejects.toThrow(/receipt does not bind|collection receipt|triad/i);
  });

  it("rejects a self-consistent newer source observation that no census or review index owns", async () => {
    const root = await createFixtureRoot();
    const snapshotPath = join(root, "research", "snapshots", "2026-07-23-anthropic-plugins-official.json");
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
      id: string;
      observedAt: string;
    };
    snapshot.id = "2026-07-24-anthropic-plugins-official";
    snapshot.observedAt = "2026-07-24T09:08:12Z";
    await writeFile(
      join(root, "research", "snapshots", `${snapshot.id}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`
    );
    const receiptPath = join(root, "research", "receipts", "2026-07-23-anthropic-plugins-official.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
      id: string;
      snapshotId: string;
      observedAt: string;
    };
    receipt.id = snapshot.id;
    receipt.snapshotId = snapshot.id;
    receipt.observedAt = snapshot.observedAt;
    await writeFile(
      join(root, "research", "receipts", `${receipt.id}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`
    );
    const observationsPath = join(root, "research", "source-observations.json");
    const observations = JSON.parse(await readFile(observationsPath, "utf8")) as {
      observations: Array<{ sourceId: string; latestEvidenceId: string; observedAt: string }>;
    };
    const official = observations.observations.find(({ sourceId }) => sourceId === "anthropic-plugins-official")!;
    official.latestEvidenceId = `legacy-${snapshot.id}`;
    official.observedAt = snapshot.observedAt;
    await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/not owned|triad|census|review-source/i);
  });

  it("allows one source config to own a later triad and authenticates its newest receipt", async () => {
    const root = await createFixtureRoot();
    const sourceId = "anthropic-plugins-official";
    const nextId = "2026-07-24-anthropic-plugins-official";
    const nextObservedAt = "2026-07-24T09:08:12Z";
    const snapshotPath = join(root, "research", "snapshots", "2026-07-23-anthropic-plugins-official.json");
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as ResearchSnapshot;
    snapshot.id = nextId;
    snapshot.observedAt = nextObservedAt;
    await writeFile(
      join(root, "research", "snapshots", `${nextId}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`
    );
    const receiptPath = join(root, "research", "receipts", "2026-07-23-anthropic-plugins-official.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
      id: string;
      snapshotId: string;
      observedAt: string;
    };
    receipt.id = nextId;
    receipt.snapshotId = nextId;
    receipt.observedAt = nextObservedAt;
    await writeFile(
      join(root, "research", "receipts", `${nextId}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`
    );
    const extensionsPath = join(root, "research", "review-source-extensions.json");
    const extensions = JSON.parse(await readFile(extensionsPath, "utf8")) as {
      triads: Array<{ sourceId: string; receiptId: string; snapshotId: string }>;
    };
    extensions.triads.push({ sourceId, receiptId: nextId, snapshotId: nextId });
    await writeFile(extensionsPath, `${JSON.stringify(extensions, null, 2)}\n`);
    const observationsPath = join(root, "research", "source-observations.json");
    const observations = JSON.parse(await readFile(observationsPath, "utf8")) as {
      observations: Array<{ sourceId: string; latestEvidenceId: string; observedAt: string }>;
    };
    const official = observations.observations.find((item) => item.sourceId === sourceId)!;
    official.latestEvidenceId = `legacy-${nextId}`;
    official.observedAt = nextObservedAt;
    await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);

    await expect(createAuthenticatedSourceObservationLoader(root)(sourceId)).resolves.toMatchObject({
      receipt: { id: nextId },
      snapshot: { id: nextId },
      materialized: { latestEvidenceId: `legacy-${nextId}` }
    });
  });

  it("rejects source, receipt, and snapshot filenames that do not match their record IDs", async () => {
    for (const [directory, id] of [
      ["sources", "anthropic-plugins-official"],
      ["receipts", "2026-07-23-anthropic-plugins-official"],
      ["snapshots", "2026-07-23-anthropic-plugins-official"]
    ] as const) {
      const root = await createFixtureRoot();
      await rename(
        join(root, "research", directory, `${id}.json`),
        join(root, "research", directory, `renamed-${id}.json`)
      );

      await expect(createAuthenticatedSourceObservationLoader(root)("anthropic-plugins-official"))
        .rejects.toThrow(/filename|record ID|canonical path/i);
    }
  });

  it("rejects duplicate source, receipt, and snapshot identities in direct record roots", async () => {
    const sourceRoot = await createFixtureRoot();
    await cp(
      join(sourceRoot, "research", "sources", "anthropic-plugins-official.json"),
      join(sourceRoot, "research", "sources", "duplicate-official-source.json")
    );
    await expect(loadDecisionManifests(sourceRoot)).rejects.toThrow(/source.*sorted and unique|duplicate.*source|source ID/i);

    const receiptRoot = await createFixtureRoot();
    await cp(
      join(receiptRoot, "research", "receipts", "2026-07-23-anthropic-plugins-official.json"),
      join(receiptRoot, "research", "receipts", "duplicate-official-receipt.json")
    );
    await expect(loadDecisionManifests(receiptRoot)).rejects.toThrow(/receipt.*sorted and unique|duplicate.*receipt|receipt ID/i);

    const snapshotRoot = await createFixtureRoot();
    await cp(
      join(snapshotRoot, "research", "snapshots", "2026-07-23-anthropic-plugins-official.json"),
      join(snapshotRoot, "research", "snapshots", "duplicate-official-snapshot.json")
    );
    await expect(loadDecisionManifests(snapshotRoot)).rejects.toThrow(/snapshot.*sorted and unique|duplicate.*snapshot|snapshot ID/i);
  });

  it("discovers observation evidence added after a successful request", async () => {
    const root = await createFixtureRoot();
    await expect(loadDecisionManifests(root)).resolves.toBeDefined();
    await writeFile(join(root, "research", "observation-evidence", "attacker.json"), "{}\n");

    await expect(loadDecisionManifests(root)).rejects.toThrow(/observation-evidence|\.gitkeep|JSON records/i);
  });

  it("revalidates source-related review backlog input after a successful request", async () => {
    const root = await createFixtureRoot();
    await expect(loadDecisionManifests(root)).resolves.toBeDefined();
    const backlogPath = join(root, "research", "source-review-backlog.json");
    const backlog = JSON.parse(await readFile(backlogPath, "utf8")) as {
      candidates: Array<Record<string, unknown>>;
    };
    const observations = JSON.parse(await readFile(
      join(root, "research", "source-observations.json"),
      "utf8"
    )) as { observations: Array<{ sourceId: string; representativePaths: string[] }> };
    const official = observations.observations.find(({ sourceId }) => sourceId === "anthropic-plugins-official")!;
    backlog.candidates.push({
      id: "source-review-anthropic-plugins-official",
      sourceId: "anthropic-plugins-official",
      sourceRepository: "https://github.com/anthropics/claude-plugins-official",
      status: "review-required",
      snapshotId: "2026-07-23-anthropic-plugins-official",
      observedAt: "2026-07-23T09:08:12Z",
      inspectedCommit: "e3e378cbbb205673a5d7254ded32679cafa6179d",
      snapshotContentSha256: "355696da746e58e1e197be509236d8f8e6a7c5f8f7437c1a71ff32896c866c05",
      representativeSkillPaths: official.representativePaths,
      domainClassifications: [],
      reclassification: "next-research-observation"
    });
    await writeFile(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/unexpected or delegated source|candidate IDs/i);
  });

  it("rejects forged nondelegated backlog provenance", async () => {
    const root = await createFixtureRoot();
    const backlogPath = join(root, "research", "source-review-backlog.json");
    const backlog = JSON.parse(await readFile(backlogPath, "utf8")) as {
      candidates: Array<{ observedAt: string }>;
    };
    backlog.candidates[0]!.observedAt = "2026-07-23T09:08:13Z";
    await writeFile(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/latest immutable snapshot provenance/i);
  });

  it("rejects a compatibility catalog epoch symlink that escapes the canonical root", async () => {
    const root = await createFixtureRoot();
    const statePath = join(root, "research", "materialized-review-state.json");
    const outside = await mkdtemp(join(tmpdir(), "official-target-epoch-outside-"));
    temporaryRoots.push(outside);
    const outsideState = join(outside, "materialized-review-state.json");
    await cp(statePath, outsideState);
    await rm(statePath);
    await symlink(outsideState, statePath);

    await expect(loadDecisionManifests(root)).rejects.toThrow(/materialized-review-state|escapes repository root|symlink/i);
  });

  it("shares one immutable authentication surface per request and re-fingerprints a new request", async () => {
    const root = await createFixtureRoot();
    const loadObservation = createAuthenticatedSourceObservationLoader(root);
    await expect(loadObservation("anthropic-plugins-official")).resolves.toMatchObject({
      source: { sourceId: "anthropic-plugins-official" }
    });
    await writeFile(join(root, "research", "census.json"), "{}\n");

    await expect(loadObservation("anthropic-skills")).resolves.toMatchObject({
      source: { sourceId: "anthropic-skills" }
    });
    await expect(createAuthenticatedSourceObservationLoader(root)("anthropic-skills"))
      .rejects.toThrow(/census|research census/i);
  });

  it("isolates authenticated surface cache entries by canonical root", async () => {
    const firstRoot = await createFixtureRoot();
    const secondRoot = await createFixtureRoot();
    const first = await createAuthenticatedSourceObservationLoader(firstRoot)("anthropic-plugins-official");
    const second = await createAuthenticatedSourceObservationLoader(secondRoot)("anthropic-plugins-official");

    expect(second.source).not.toBe(first.source);
    expect(second.snapshot).not.toBe(first.snapshot);
  });

  it("evicts the oldest authenticated surface after the bounded root limit", async () => {
    const roots = await Promise.all(Array.from({ length: 5 }, () => createFixtureRoot()));
    const first = await createAuthenticatedSourceObservationLoader(roots[0]!)("anthropic-plugins-official");
    for (const root of roots.slice(1)) {
      await createAuthenticatedSourceObservationLoader(root)("anthropic-plugins-official");
    }
    const reloaded = await createAuthenticatedSourceObservationLoader(roots[0]!)("anthropic-plugins-official");

    expect(reloaded.source).not.toBe(first.source);
    expect(reloaded.snapshot).not.toBe(first.snapshot);
  });

  it("rejects a research directory symlink that escapes the canonical root", async () => {
    const root = await createFixtureRoot();
    await expect(loadDecisionManifests(root)).resolves.toBeDefined();
    const outside = await mkdtemp(join(tmpdir(), "official-target-receipts-outside-"));
    temporaryRoots.push(outside);
    await cp(join(root, "research", "receipts"), outside, { recursive: true });
    await rm(join(root, "research", "receipts"), { recursive: true });
    await symlink(outside, join(root, "research", "receipts"), "dir");

    await expect(loadDecisionManifests(root)).rejects.toThrow(/escapes repository root|symlink/i);
  });

  it("holds the candidate when the official target evidence is missing", async () => {
    const root = await createFixtureRoot();
    const manifest = await readManifest(root);
    manifest.officialTargetCompatibilityEvidence = [];
    await writeManifest(root, manifest);

    const index = JSON.parse(await generateDecisionIndex(root)) as {
      candidates: Array<{ id: string; state: string; stateReasons: string[] }>;
    };
    expect(index.candidates.find(({ id }) => id === "shopify-ai-toolkit")).toMatchObject({
      state: "held",
      stateReasons: expect.arrayContaining(["target-unknown:claude-code/darwin"])
    });
  });
});

interface CompatibilityEvidence {
  candidateId: string;
  observedAt: string;
  reviewedAt: string;
  expiresAt: string;
  evidenceDigest: string;
  snapshot: {
    marketplaceEntrySourceCommit: string;
    digest: string;
  } & Record<string, unknown>;
  [key: string]: unknown;
}

interface ManifestDocument {
  candidates: Array<Record<string, unknown> & { officialBaseline?: Record<string, unknown> }>;
  candidateRevisions?: unknown[];
  evidence: Array<{
    candidateRevisionId?: string;
    artifactSha256?: string;
    sourceBlobs: Array<{ path: string; contentSha256: string }>;
  }>;
  officialTargetCompatibilityEvidence: Array<CompatibilityEvidence & { candidateRevisionId?: string }>;
}

interface ArtifactDocument {
  candidate: {
    candidateRevisionId?: string;
    officialBaseline: {
      sourceUrl: string;
    };
  };
  sourceBlobs: Array<{
    path: string;
    immutableRawUrl: string;
    contentSha256: string;
  }>;
  capabilities: Array<{
    claim: string;
    sourceBlobs: Array<{
      path: string;
      immutableRawUrl: string;
      contentSha256: string;
    }>;
  }>;
}

async function createFixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "official-target-compatibility-"));
  temporaryRoots.push(root);
  await Promise.all([
    cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
  ]);
  await rm(join(root, "research", "observation-evidence"), { recursive: true, force: true });
  await mkdir(join(root, "research", "observation-evidence"));
  await writeFile(join(root, "research", "observation-evidence", ".gitkeep"), "");
  await Promise.all([
    cp(
      join(projectRoot, "tests", "fixtures", "research-epoch-2026-07-29", "source-observations.json"),
      join(root, "research", "source-observations.json")
    ),
    cp(
      join(projectRoot, "tests", "fixtures", "research-epoch-2026-07-29", "materialized-review-state.json"),
      join(root, "research", "materialized-review-state.json")
    ),
    cp(
      join(projectRoot, "tests", "fixtures", "research-epoch-2026-07-29", "source-diffs.json"),
      join(root, "research", "source-diffs.json")
    )
  ]);
  const historicalSelection = "official-marketplace-selections/20260729T000000Z-e3e378c.json";
  const historicalSelectionBytes = await readFile(join(root, "research", "marketplaces", historicalSelection));
  await writeFile(join(root, "research", "marketplaces", "official-marketplace-current.json"), `${JSON.stringify({
    schemaVersion: 1,
    selection: historicalSelection,
    selectionSha256: createHash("sha256").update(historicalSelectionBytes).digest("hex")
  }, null, 2)}\n`);
  await removeRevisionBoundResearchEvidence(root, join(root, "research", "evidence"));
  const manifest = await readManifest(root);
  delete manifest.candidateRevisions;
  manifest.evidence = manifest.evidence.filter(({ candidateRevisionId }) => candidateRevisionId === undefined);
  manifest.officialTargetCompatibilityEvidence = manifest.officialTargetCompatibilityEvidence.filter(
    ({ candidateRevisionId }) => candidateRevisionId === undefined
  );
  await writeManifest(root, manifest);
  return root;
}

async function removeRevisionBoundResearchEvidence(root: string, directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isFile())) {
    const path = join(directory, entry.name);
    if (!entry.name.endsWith(".json")) continue;
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (await hasCandidateRevisionBinding(root, value)) await rm(path);
  }
  for (const entry of entries.filter((item) => item.isDirectory())) {
    await removeRevisionBoundResearchEvidence(root, join(directory, entry.name));
  }
}

async function hasCandidateRevisionBinding(root: string, value: unknown): Promise<boolean> {
  if (!isRecord(value)) return false;
  if (typeof value.candidateRevisionId === "string") return true;
  if (isRecord(value.candidate) && typeof value.candidate.candidateRevisionId === "string") return true;
  if (typeof value.artifactPath !== "string"
    || !value.artifactPath.startsWith("research/evidence/artifacts/")) return false;
  const artifact = JSON.parse(await readFile(join(root, value.artifactPath), "utf8")) as unknown;
  return isRecord(artifact)
    && isRecord(artifact.candidate)
    && typeof artifact.candidate.candidateRevisionId === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readManifest(root: string): Promise<ManifestDocument> {
  return parse(await readFile(join(root, "manifests", "decision-candidate-evidence.yaml"), "utf8")) as ManifestDocument;
}

function artifactPath(root: string): string {
  return join(
    root,
    "research",
    "evidence",
    "artifacts",
    "shopify-ai-toolkit-556811e94dd45c795abe5c0b1bf6b5a4b098149d.json"
  );
}

async function readArtifact(root: string): Promise<ArtifactDocument> {
  return JSON.parse(await readFile(artifactPath(root), "utf8")) as ArtifactDocument;
}

async function rewriteArtifact(root: string, mutate: (artifact: ArtifactDocument) => void): Promise<void> {
  const artifact = await readArtifact(root);
  mutate(artifact);
  await writeFile(artifactPath(root), JSON.stringify(artifact));
  const manifest = await readManifest(root);
  const artifactSha256 = createHash("sha256").update(await readFile(artifactPath(root))).digest("hex");
  for (const item of manifest.evidence) item.artifactSha256 = artifactSha256;
  const researchEvidencePath = join(root, "research", "evidence", "shopify-ai-toolkit-official-source.json");
  const researchEvidence = JSON.parse(await readFile(researchEvidencePath, "utf8")) as {
    artifactSha256: string;
  };
  researchEvidence.artifactSha256 = artifactSha256;
  await Promise.all([
    writeManifest(root, manifest),
    writeFile(researchEvidencePath, `${JSON.stringify(researchEvidence, null, 2)}\n`)
  ]);
}

async function writeManifest(root: string, manifest: ManifestDocument): Promise<void> {
  await writeFile(join(root, "manifests", "decision-candidate-evidence.yaml"), JSON.stringify(manifest));
}

function refreshEvidenceDigest(evidence: CompatibilityEvidence): void {
  const snapshot: Record<string, unknown> = { ...evidence.snapshot };
  delete snapshot.digest;
  evidence.snapshot.digest = digest(snapshot);
  const value: Record<string, unknown> = { ...evidence };
  delete value.evidenceDigest;
  evidence.evidenceDigest = digest(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
