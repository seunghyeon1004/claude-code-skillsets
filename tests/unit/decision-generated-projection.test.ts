import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { loadDecisionManifests } from "../../src/decision/repository.js";
import { generateDecisionIndex, projectGeneratedDecisionCandidates } from "../../src/generate/decision-index.js";
import type { TargetReviewEvidence } from "../../src/model/complete-v1.js";
import type { DecisionCandidateProjection } from "../../src/model/decision.js";
import type { ReviewLedgerEvent } from "../../src/model/review-ledger.js";
import { hashReviewEvent, serializeReviewLedgerJsonl } from "../../src/research/review-ledger.js";
import { loadResearchRepository } from "../../src/research/repository.js";
import { inheritedEvidenceDigest } from "../../src/research/review-state.js";
import { deepFreezeRepositoryData } from "../../src/repository/deep-freeze-data.js";
import { materializeDecisionResearch } from "../../scripts/research/materialize-decision-research.js";
import {
  SHOPIFY_CAPABILITY_EVIDENCE,
  SHOPIFY_COMMIT,
  SHOPIFY_REPOSITORY,
  SHOPIFY_SKILL_PATH,
  SHOPIFY_SNAPSHOT_SHA256,
  SHOPIFY_TEST_REVIEW_ID,
  SHOPIFY_TEST_SNAPSHOT_ID,
  SHOPIFY_TEST_SOURCE_ID,
  installShopifyResearchSource,
  shopifyDependenciesField,
  shopifyExecutableSurfaceField,
  shopifyLicenseFieldEvidence,
  shopifyOwnershipField,
  shopifyPermissionsField,
  shopifyTrustField
} from "../helpers/shopify-decision-fixture.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];
const fixtureAsOf = "2026-08-03T02:30:05Z";
const sourceId = SHOPIFY_TEST_SOURCE_ID;
const repositoryUrl = SHOPIFY_REPOSITORY;
const commit = SHOPIFY_COMMIT;
const snapshotId = SHOPIFY_TEST_SNAPSHOT_ID;
const skillPath = SHOPIFY_SKILL_PATH;
const reviewId = SHOPIFY_TEST_REVIEW_ID;
const snapshotContentSha256 = SHOPIFY_SNAPSHOT_SHA256;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("generated decision candidate projection", () => {
  it("rejects structurally valid but unrooted repositories", async () => {
    const root = await authenticatedFixtureRoot();
    const repository = await loadDecisionManifests(root);
    const research = await loadResearchRepository(root);

    expect(() => projectGeneratedDecisionCandidates({
      repository: structuredClone(repository),
      research: structuredClone(research),
      observedThrough: fixtureAsOf
    })).toThrow(/root-authenticated/u);
  });

  it("keeps authenticated repository graphs immutable after loading", async () => {
    const root = await authenticatedFixtureRoot();
    const repository = await loadDecisionManifests(root);
    const research = await loadResearchRepository(root);
    const input = { repository, research, observedThrough: fixtureAsOf };
    const before = projectGeneratedDecisionCandidates(input);
    const candidateEvidence = repository.candidateEvidence.find(({ candidateId }) =>
      candidateId === "shopify-ai-toolkit-codex")!;
    const shopifyEvidence = repository.candidateEvidence.filter(({ candidateId }) =>
      candidateId === "shopify-ai-toolkit-codex");
    const state = research.materializedReviewState.find((item) => item.decisionId === reviewId)!;
    const compatibility = research.evidence.find(({ id }) =>
      id === "shopify-ai-toolkit-codex-darwin") as TargetReviewEvidence;
    const shopifySource = research.sourceConfigs.find((item) => item.sourceId === sourceId)!;
    const shopifySnapshot = research.snapshots.find((item) => item.id === snapshotId)!;
    const shopifyObservation = research.observationEvidence.find((item) => item.sourceId === sourceId)!;
    const productionManifest = parse(await readFile(join(projectRoot, "manifests", "decision-candidate-evidence.yaml"), "utf8")) as {
      candidates: Array<{ id: string; permissions: { value?: string[] } }>;
    };
    const productionShopifyCandidate = productionManifest.candidates.find(({ id }) => id === "shopify-ai-toolkit")!;

    expect(shopifySource.repository).toBe(repositoryUrl);
    expect(shopifySnapshot).toMatchObject({ inspectedCommit: commit, contentSha256: snapshotContentSha256 });
    expect(shopifySnapshot.entries.filter(({ kind }) => kind === "skill-file")).toHaveLength(20);
    expect(shopifySnapshot.entries.filter(({ kind }) => kind === "repository-record")).toEqual([
      { kind: "repository-record", address: ".", sourceUrl: repositoryUrl },
      {
        kind: "repository-record",
        address: "README.md#link/0",
        sourceUrl: "https://github.com/Shopify/shopify-ai-toolkit"
      }
    ]);
    expect(shopifySnapshot.countMetrics.map(({ kind, independentlyCountedTotal }) => [kind, independentlyCountedTotal]))
      .toEqual([
        ["marketplace-entry", 1],
        ["plugin-manifest", 1],
        ["repository-record", 2],
        ["skill-file", 20]
      ]);
    expect(shopifyObservation).toMatchObject({
      inspectedCommit: commit,
      blobs: expect.arrayContaining([
        expect.objectContaining({
          path: SHOPIFY_SKILL_PATH,
          contentSha256: "919d2cd97d2f85015f95a9054647dd59b4ab094c8eea6ae8b52db429406c0abf"
        }),
        expect.objectContaining({
          path: "LICENSE",
          contentSha256: "75c4e0e960d7639e5974c0b10a420f738b8011ac08742d3bbb13cca849fda9f4"
        })
      ])
    });
    expect(shopifyEvidence.map(({ capabilityId, support, sourceBlobs }) => ({ capabilityId, support, sourceBlobs })))
      .toEqual(SHOPIFY_CAPABILITY_EVIDENCE.map(({ capabilityId, support, sourceBlobs }) => ({
        capabilityId,
        support,
        sourceBlobs
      })));
    expect(candidateEvidence.candidate.permissions.value).toEqual(productionShopifyCandidate.permissions.value);
    expect(JSON.stringify({ shopifySource, shopifySnapshot, shopifyObservation, shopifyEvidence })).not.toMatch(/discord/iu);

    expect(Object.isFrozen(repository)).toBe(true);
    expect(Object.isFrozen(repository.candidateEvidence)).toBe(true);
    expect(Object.isFrozen(candidateEvidence.candidate)).toBe(true);
    expect(Object.isFrozen(candidateEvidence.candidate.providedCapabilityIds)).toBe(true);
    expect(Object.isFrozen(research)).toBe(true);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(compatibility)).toBe(true);
    expect(Object.isFrozen(compatibility.scope)).toBe(true);
    expect(() => (repository.candidateEvidence as typeof repository.candidateEvidence).push(candidateEvidence)).toThrow(TypeError);
    expect(() => (candidateEvidence.candidate.providedCapabilityIds as string[]).push("forged-capability")).toThrow(TypeError);
    expect(() => Object.assign(candidateEvidence, { current: false })).toThrow(TypeError);
    expect(() => Object.assign(state, { reason: "blocked" })).toThrow(TypeError);
    expect(() => Object.assign(compatibility, { reviewedCommit: "f".repeat(40) })).toThrow(TypeError);
    expect(() => Object.assign(compatibility.scope, { platform: "linux" })).toThrow(TypeError);

    expect(projectGeneratedDecisionCandidates(input)).toEqual(before);
  });

  it("rejects data outside the acyclic plain-object repository graph", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => deepFreezeRepositoryData({ nested: new Map([["key", "value"]]) })).toThrow(/plain objects/u);
    expect(() => deepFreezeRepositoryData({ nested: new Set(["value"]) })).toThrow(/plain objects/u);
    expect(() => deepFreezeRepositoryData({ nested: () => "mutable behavior" })).toThrow(/data values/u);
    expect(() => deepFreezeRepositoryData({ nested: new (class MutableRecord {})() })).toThrow(/plain objects/u);
    expect(() => deepFreezeRepositoryData({ nested: new (class MutableArray extends Array {})() })).toThrow(/plain objects/u);
    expect(() => deepFreezeRepositoryData(cycle)).toThrow(/acyclic/u);
  });

  it("projects exact reviewed Codex and nonofficial Claude targets from a real repository", async () => {
    const root = await authenticatedFixtureRoot();
    const index = JSON.parse(await generateDecisionIndex(root)) as { candidates: DecisionCandidateProjection[] };

    for (const runtime of ["codex", "claude-code"] as const) {
      expect(index.candidates.find((candidate) => candidate.id === `shopify-ai-toolkit-${runtime}`)).toMatchObject({
        runtime,
        state: "eligible-with-disclosures",
        stateReasons: expect.arrayContaining([
          "exact-path-approved",
          "evidence-current",
          `target-verified:${runtime}/darwin`,
          `target-unknown:${runtime}/linux`,
          `target-unknown:${runtime}/win32`
        ])
      });
    }
  });

  it.each([
    ["review", (evidence: MutableCompatibilityEvidence) => { evidence.reviewId = "wrong-review"; }],
    ["provider", (evidence: MutableCompatibilityEvidence) => { evidence.providerId = "wrong-provider"; }],
    ["commit", (evidence: MutableCompatibilityEvidence) => { evidence.reviewedCommit = "f".repeat(40); }],
    ["runtime", (evidence: MutableCompatibilityEvidence) => { evidence.scope.runtime = "claude-code"; }],
    ["future observation", (evidence: MutableCompatibilityEvidence) => { evidence.observedAt = "2026-07-28T00:00:01Z"; }]
  ] as const)("holds a Codex target with mismatched %s evidence", async (_label, mutate) => {
    const root = await authenticatedFixtureRoot({ mutateCodexEvidence: mutate });
    const index = JSON.parse(await generateDecisionIndex(root)) as { candidates: DecisionCandidateProjection[] };
    const candidate = index.candidates.find(({ id }) => id === "shopify-ai-toolkit-codex");

    expect(candidate).toMatchObject({
      state: "held",
      stateReasons: expect.arrayContaining(["target-unknown:codex/darwin"])
    });
  });
});

interface MutableCompatibilityEvidence {
  reviewId: string;
  providerId: string;
  reviewedCommit: string;
  scope: { runtime: "claude-code" | "codex"; platform: "darwin"; capabilityId: null };
  [key: string]: unknown;
}

async function authenticatedFixtureRoot(options: {
  mutateCodexEvidence?: (evidence: MutableCompatibilityEvidence) => void;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "generated-decision-projection-"));
  temporaryRoots.push(root);
  await Promise.all([
    cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
  ]);
  await resetHistoricalFixtureEpoch(root);
  await installResearchEvidence(root, options);
  await installCandidateManifests(root);
  await writeReviewLedger(root);
  await materializeDecisionResearch({ root, asOf: fixtureAsOf, checkOnly: false });
  return root;
}

async function resetHistoricalFixtureEpoch(root: string): Promise<void> {
  const path = join(root, "manifests", "decision-candidate-evidence.yaml");
  const manifest = parse(await readFile(path, "utf8")) as {
    candidates: Array<{ id: string }>;
    candidateRevisions?: Array<{ candidateId: string }>;
    evidence: Array<{ candidateId: string }>;
    officialTargetCompatibilityEvidence?: Array<{ candidateId: string }>;
  };
  manifest.candidates = manifest.candidates.filter(({ id }) => id !== "shopify-ai-toolkit");
  manifest.candidateRevisions = manifest.candidateRevisions?.filter(
    ({ candidateId }) => candidateId !== "shopify-ai-toolkit"
  );
  manifest.evidence = manifest.evidence.filter(({ candidateId }) => candidateId !== "shopify-ai-toolkit");
  manifest.officialTargetCompatibilityEvidence = manifest.officialTargetCompatibilityEvidence?.filter(
    ({ candidateId }) => candidateId !== "shopify-ai-toolkit"
  );
  await writeFile(path, stringify(manifest, { lineWidth: 0 }));
}

async function installResearchEvidence(
  root: string,
  options: { mutateCodexEvidence?: (evidence: MutableCompatibilityEvidence) => void }
): Promise<void> {
  await mkdir(join(root, "research", "observation-evidence"), { recursive: true });
  await Promise.all([
    unlink(join(root, "research", "evidence", ".gitkeep")),
    unlink(join(root, "research", "evidence", "artifacts", ".gitkeep"))
  ]);
  await installShopifyResearchSource(root);

  const artifact = `${JSON.stringify({ fixture: "exact runtime compatibility" })}\n`;
  const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
  for (const runtime of ["codex", "claude-code"] as const) {
    const evidence: MutableCompatibilityEvidence = {
      schemaVersion: 2,
      id: `shopify-ai-toolkit-${runtime}-darwin`,
      reviewId,
      providerId: sourceId,
      snapshotId,
      observedAt: "2026-07-28T00:00:00Z",
      artifactPath: `research/evidence/artifacts/shopify-ai-toolkit-${runtime}-darwin.json`,
      artifactSha256,
      outcome: "passed",
      summary: `Validated ${runtime} compatibility on darwin.`,
      kind: "compatibility",
      scope: { runtime, platform: "darwin", capabilityId: null },
      reviewedCommit: commit
    };
    if (runtime === "codex") options.mutateCodexEvidence?.(evidence);
    await Promise.all([
      writeFile(join(root, "research", "evidence", `shopify-ai-toolkit-${runtime}-darwin.json`), JSON.stringify(evidence)),
      writeFile(join(root, "research", "evidence", "artifacts", `shopify-ai-toolkit-${runtime}-darwin.json`), artifact)
    ]);
  }
}

async function installCandidateManifests(root: string): Promise<void> {
  const path = join(root, "manifests", "decision-candidate-evidence.yaml");
  const manifest = parse(await readFile(path, "utf8")) as {
    candidates: DecisionCandidateProjection[];
    evidence: Array<Record<string, unknown>>;
  };
  for (const runtime of ["codex", "claude-code"] as const) {
    const id = `shopify-ai-toolkit-${runtime}`;
    const evidenceIds = SHOPIFY_CAPABILITY_EVIDENCE.map((_, index) => `${id}-capability-${index + 1}`);
    const candidate: DecisionCandidateProjection = {
      id,
      displayName: "Shopify AI Toolkit",
      description: "Reviewed Shopify CLI workflows for store and catalog operations.",
      sourceId,
      skillPath,
      runtime,
      state: "eligible-with-disclosures",
      stateReasons: ["exact-path-approved", "evidence-current"],
      providedCapabilityIds: SHOPIFY_CAPABILITY_EVIDENCE.map(({ capabilityId }) => capabilityId),
      capabilityEvidenceIds: evidenceIds,
      revisionBinding: "exact",
      permissions: shopifyPermissionsField(),
      license: { status: "observed", value: "MIT", evidence: [shopifyLicenseFieldEvidence()] },
      trust: shopifyTrustField(),
      dependencies: shopifyDependenciesField(),
      ...(runtime === "codex" ? {
        codexInstall: {
          repository: repositoryUrl,
          commit,
          skillPath,
          reviewDecisionId: reviewId,
          compatibilityEvidence: "shopify-ai-toolkit-codex-darwin",
          targetPlatform: "darwin" as const
        }
      } : {})
    };
    manifest.candidates.push(candidate);
    manifest.evidence.push(...SHOPIFY_CAPABILITY_EVIDENCE.map((capability, index) => ({
      id: evidenceIds[index],
      candidateId: id,
      capabilityId: capability.capabilityId,
      kind: "observation",
      current: true,
      support: capability.support,
      reference: capability.reference,
      contentSha256: capability.contentSha256,
      sourceBlobs: capability.sourceBlobs
    })));
  }
  await writeFile(path, stringify(manifest, { lineWidth: 0 }));
}

async function writeReviewLedger(root: string): Promise<void> {
  const observation = JSON.parse(await readFile(
    join(root, "research", "observation-evidence", "shopify-ai-toolkit-test-observation.json"),
    "utf8"
  )) as { blobs: Array<{ path: string; gitBlobSha: string }> };
  const event: ReviewLedgerEvent = {
    sequence: 1,
    id: reviewId,
    previousEventHash: null,
    target: { sourceId, skillPath },
    disposition: "approved",
    supersedes: null,
    baseline: {
      snapshotId,
      inspectedCommit: commit,
      contentSha256: snapshotContentSha256,
      pathBlobSha: observation.blobs.find((blob) => blob.path === skillPath)!.gitBlobSha,
      inheritedEvidenceDigest: inheritedEvidenceDigest(observation as never, skillPath)!
    },
    reasonCode: "exact-runtime-reviewed",
    reason: { ko: "Exact runtime reviewed", en: "Exact runtime reviewed" },
    reviewedSensitiveFields: {
      license: { status: "observed", value: "MIT", evidence: [shopifyLicenseFieldEvidence()] },
      permissions: shopifyPermissionsField(),
      ownership: shopifyOwnershipField(),
      trust: shopifyTrustField(),
      dependencies: shopifyDependenciesField(),
      executableSurface: shopifyExecutableSurfaceField()
    },
    runtimeEvidence: ["codex", "claude-code"].map((runtime) => ({
      runtime: runtime as "codex" | "claude-code",
      compatibility: "verified" as const,
      evidenceIds: [`shopify-ai-toolkit-${runtime}-darwin`]
    })),
    reviewerId: "seunghyeon1004",
    reviewedAt: "2026-07-28T00:00:00Z",
    expiresAt: "2026-08-06T00:00:00Z",
    eventHash: ""
  };
  event.eventHash = hashReviewEvent(event);
  await writeFile(join(root, "research", "review-ledger.jsonl"), serializeReviewLedgerJsonl([event]));
}
