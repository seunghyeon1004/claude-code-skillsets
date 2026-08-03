import { cp, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { prepareCodexHandoff } from "../../src/decision/codex-preview.js";
import * as indexLoader from "../../src/decision/index-loader.js";
import {
  DECISION_CATALOG_FRESHNESS_MS,
  buildDecisionIntentFixtures,
  decisionIndexDigest
} from "../../src/decision/index-loader.js";
import * as plannerModule from "../../src/decision/planner.js";
import { buildDecisionPlan } from "../../src/decision/planner.js";
import { loadDecisionIndex, loadDecisionManifests } from "../../src/decision/repository.js";
import { runDiscoveryCli } from "../../src/discovery/cli.js";
import { evaluateSetupDecisionFixture } from "../../src/evaluate/setup.js";
import { generateDecisionIndex } from "../../src/generate/decision-index.js";
import type { DecisionIndex, DecisionPlan } from "../../src/model/decision.js";
import { hashReviewEvent, serializeReviewLedgerJsonl } from "../../src/research/review-ledger.js";
import { inheritedEvidenceDigest } from "../../src/research/review-state.js";
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
interface MutableAuthenticatedDecisionPlan {
  index: unknown;
  input: {
    runtime: "claude-code" | "codex";
    platform: "darwin" | "linux" | "win32";
    asOf: string;
  };
  primary?: DecisionPlan["primary"];
  complement?: DecisionPlan["complement"];
  planSnapshot?: string;
}

const plannerQueries = plannerModule as unknown as {
  authenticatedDecisionPlanFor(plan: DecisionPlan): MutableAuthenticatedDecisionPlan | undefined;
};

interface MutableCodexInstall {
  repository: string;
  commit: string;
  skillPath: string;
  reviewDecisionId: string;
  compatibilityEvidence: string;
  targetPlatform: "darwin" | "linux" | "win32";
}

interface MutableCodexCandidate {
  id: string;
  sourceId: string;
  skillPath: string;
  providedCapabilityIds: string[];
  capabilityEvidenceIds: string[];
  codexInstall: MutableCodexInstall;
  [key: string]: unknown;
}

interface MutableCandidateEvidence {
  id: string;
  candidate: MutableCodexCandidate;
  [key: string]: unknown;
}

interface MutableDecisionIndex {
  catalogVersion: string;
  observedThrough: string;
  catalogExpiresAt: string;
  profiles: DecisionIndex["profiles"];
  candidates: MutableCodexCandidate[];
  candidateEvidence: MutableCandidateEvidence[];
  intentFixtures: DecisionIndex["intentFixtures"];
  digest: string;
  [key: string]: unknown;
}

interface MutableReviewEvent {
  baseline: {
    snapshotId: string;
    inspectedCommit: string;
    contentSha256: string;
    pathBlobSha: string | null;
    inheritedEvidenceDigest: string;
  };
  expiresAt: string;
  eventHash: string;
  [key: string]: unknown;
}

interface MutableCompatibilityEvidence {
  scope: { runtime: string; platform: string; capabilityId: string | null };
  reviewedCommit: string;
  outcome: string;
  [key: string]: unknown;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("prepareCodexHandoff", () => {
  it("retains the zero-byte evidence sentinels required by isolated Codex fixtures", async () => {
    for (const path of [
      join(projectRoot, "research", "evidence", ".gitkeep"),
      join(projectRoot, "research", "evidence", "artifacts", ".gitkeep")
    ]) {
      const stat = await lstat(path);
      expect(stat.isFile()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);
      expect(stat.size).toBe(0);
    }
  });

  it("holds arbitrary mutable plans even when their strings look eligible", () => {
    expect(prepareCodexHandoff(fabricatedCodexPlan())).toMatchObject({
      status: "held",
      executionStatus: "not-executed",
      candidates: [],
      holdReasons: ["decision-plan-loader-authentication-required"]
    });
  });

  it("authenticates the current generated epoch and keeps held Shopify non-installing", async () => {
    const [artifact, materializedState, index] = await Promise.all([
      readFile(join(projectRoot, "generated", "decision-index.json"), "utf8")
        .then((value) => JSON.parse(value) as DecisionIndex),
      readFile(join(projectRoot, "research", "materialized-review-state.json"), "utf8")
        .then((value) => JSON.parse(value) as { asOf: string }),
      loadDecisionIndex(projectRoot)
    ]);

    expect(index).toEqual(artifact);
    expect(index.observedThrough).toBe(materializedState.asOf);
    const shopify = index.candidates.find(({ id }) => id === "shopify-ai-toolkit");
    expect(shopify).toMatchObject({ state: "held" });
    expect(shopify).not.toHaveProperty("codexInstall");
    expect(shopify).not.toHaveProperty("claudeInstall");

    const setup = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds: ["commerce"],
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    });
    expect(setup).toMatchObject({
      status: "held",
      executionStatus: "not-executed",
      candidates: [],
      commandReceipts: [],
      installReceipts: []
    });
    expect(setup.commands.filter(({ kind }) => kind === "install")).toHaveLength(0);
  });

  it("keeps authentication setters private and holds a handcrafted plan using a loaded candidate", async () => {
    expect(indexLoader).not.toHaveProperty("authenticateRootDecisionIndex");
    expect(indexLoader).not.toHaveProperty("authenticateDecisionPlan");
    expect(plannerModule).not.toHaveProperty("registerDecisionPlan");
    expect(plannerQueries.authenticatedDecisionPlanFor).toBeTypeOf("function");

    const loadedPlan = await loadAuthenticatedCodexPlan();
    const handcrafted = {
      ...loadedPlan,
      primary: loadedPlan.primary,
      complement: loadedPlan.complement
    };

    expect(plannerQueries.authenticatedDecisionPlanFor(handcrafted)).toBeUndefined();
    expect(prepareCodexHandoff(handcrafted)).toMatchObject({
      status: "held",
      holdReasons: ["decision-plan-loader-authentication-required"]
    });
  });

  it("emits a non-executing installer preview only for a root-loaded exact review", async () => {
    const plan = await loadAuthenticatedCodexPlan();
    const output = JSON.stringify(prepareCodexHandoff(plan));

    expect(output).not.toMatch(/claude plugin/i);
    expect(output).toContain('"executionStatus":"not-executed"');
    expect(output).toContain("$skill-installer");
    expect(JSON.parse(output)).toMatchObject({
      status: "eligible-with-disclosures",
      candidates: [{
        repository: SHOPIFY_REPOSITORY,
        commit: SHOPIFY_COMMIT,
        skillPath: SHOPIFY_SKILL_PATH,
        reviewDecisionId: SHOPIFY_TEST_REVIEW_ID
      }]
    });
  });

  it("keeps actual Codex broker, CLI, handoff, and Claude setup boundaries aligned", async () => {
    const { index, plan } = await loadAuthenticatedCodexContext();
    const stdout: string[] = [];
    const exitCode = await runDiscoveryCli([
      "decision-plan", "--runtime", "codex", "--platform", "darwin", "--as-of", fixtureAsOf,
      "--domain", "commerce"
    ], "/authenticated-fixture", {
      loadDecisionIndex: async () => index,
      writeStdout: (value) => stdout.push(value),
      writeStderr: () => undefined
    });
    const setup = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds: ["commerce"],
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: fixtureAsOf },
      riskAcknowledged: true
    });

    expect(exitCode).toBe(0);
    const handoff = prepareCodexHandoff(plan);
    expect(JSON.parse(stdout.join(""))).toEqual(handoff);
    expect(handoff).toMatchObject({
      status: "eligible-with-disclosures",
      executionStatus: "not-executed",
      candidates: [expect.objectContaining({ reviewDecisionId: SHOPIFY_TEST_REVIEW_ID })]
    });
    expect(setup).toMatchObject({
      status: "held",
      executionStatus: "not-executed",
      candidates: [],
      commandReceipts: [],
      installReceipts: []
    });
  });

  it.each([
    ["commit", (index: MutableDecisionIndex) => {
      index.candidates[0]!.codexInstall.commit = "f".repeat(40);
    }, /commit/i],
    ["path", (index: MutableDecisionIndex) => {
      index.candidates[0]!.codexInstall.skillPath = "skills/shopify-admin/SKILL.md";
    }, /skillPath|path/i],
    ["decision", (index: MutableDecisionIndex) => {
      index.candidates[0]!.codexInstall.reviewDecisionId = "different-approved-decision";
    }, /review.*decision|decision.*review/i],
    ["target", (index: MutableDecisionIndex) => {
      index.candidates[0]!.codexInstall.targetPlatform = "linux";
    }, /target.*platform|platform.*target/i],
    ["description", (index: MutableDecisionIndex) => {
      index.candidates[0]!.description = "tampered ranking description";
    }, /display name|description/i],
    ["relative traversal", (index: MutableDecisionIndex) => {
      index.candidates[0]!.skillPath = "../outside/SKILL.md";
      index.candidates[0]!.codexInstall.skillPath = "../outside/SKILL.md";
    }, /repository-relative|skillPath/i],
    ["absolute path", (index: MutableDecisionIndex) => {
      index.candidates[0]!.skillPath = "/tmp/outside/SKILL.md";
      index.candidates[0]!.codexInstall.skillPath = "/tmp/outside/SKILL.md";
    }, /repository-relative|skillPath/i]
  ])("rejects loader data with a mismatched %s", async (_caseName, mutate, expected) => {
    await expect(loadAuthenticatedCodexPlan({ mutateIndex: mutate })).rejects.toThrow(expected);
  });

  it("rejects a stale review even when the candidate and index digest were recomputed", async () => {
    await expect(loadAuthenticatedCodexPlan({
      mutateReview: (event) => {
        event.expiresAt = "2026-07-28T23:59:59Z";
      }
    })).rejects.toThrow(/stale|expired/i);
  });

  it.each([
    ["current path blob", {
      mutateReview: (event: MutableReviewEvent) => {
        event.baseline.pathBlobSha = "f".repeat(40);
      }
    }, /path.*blob|exact.*review/i],
    ["inherited sensitive evidence", {
      mutateReview: (event: MutableReviewEvent) => {
        event.baseline.inheritedEvidenceDigest = "f".repeat(64);
      }
    }, /inherited|exact.*review/i],
    ["unresolved compatibility evidence", {
      mutateIndex: (index: MutableDecisionIndex) => {
        index.candidates[0]!.codexInstall.compatibilityEvidence = "missing-compatibility-evidence";
      }
    }, /compatibility.*evidence|evidence.*compatibility/i],
    ["wrong compatibility platform", {
      mutateCompatibilityEvidence: (evidence: MutableCompatibilityEvidence) => {
        evidence.scope.platform = "linux";
      }
    }, /compatibility.*platform|platform.*compatibility/i],
    ["wrong compatibility commit", {
      mutateCompatibilityEvidence: (evidence: MutableCompatibilityEvidence) => {
        evidence.reviewedCommit = "f".repeat(40);
      }
    }, /compatibility.*commit|commit.*compatibility/i],
    ["failed compatibility evidence", {
      mutateCompatibilityEvidence: (evidence: MutableCompatibilityEvidence) => {
        evidence.outcome = "failed";
      }
    }, /compatibility.*passed|passed.*compatibility/i],
    ["tampered compatibility artifact", {
      compatibilityArtifact: "{\"fixture\":\"tampered\"}\n"
    }, /artifact.*SHA-256|SHA-256.*artifact/i]
  ])("rejects loader data without %s", async (_caseName, options, expected) => {
    await expect(loadAuthenticatedCodexPlan(options)).rejects.toThrow(expected);
  });

  it("holds a plan at the exact review expiry inside the catalog window", async () => {
    const plan = await loadAuthenticatedCodexPlan({ asOf: "2026-08-06T00:00:00Z" });

    expect(plan).toMatchObject({
      status: "held",
      primary: null,
      excludedCandidates: [expect.objectContaining({
        state: "held",
        stateReasons: expect.arrayContaining(["review-expired"])
      })]
    });
    expect(prepareCodexHandoff(plan)).toMatchObject({
      status: "held",
      candidates: [],
      holdReasons: expect.arrayContaining(["decision-plan-not-eligible", "no-planned-candidates"])
    });
  });

  it("holds Codex handoff before the catalog observation window", async () => {
    const plan = await loadAuthenticatedCodexPlan({ asOf: "2026-07-28T23:59:59Z" });

    expect(prepareCodexHandoff(plan)).toMatchObject({
      status: "held",
      candidates: [],
      holdReasons: expect.arrayContaining([
        "catalog-not-current",
        "decision-plan-as-of-not-current"
      ])
    });
  });

  it("does not let a returned authentication view rewrite an expiry-bound input", async () => {
    const plan = await loadAuthenticatedCodexPlan({ asOf: "2026-08-06T00:00:00Z" });
    const authentication = plannerQueries.authenticatedDecisionPlanFor(plan)!;

    expect(Object.getOwnPropertyNames(authentication).sort()).toEqual(["index", "input"]);
    expect(Object.isFrozen(authentication)).toBe(true);
    expect(Object.isFrozen(authentication.index)).toBe(true);
    expect(Object.isFrozen(authentication.input)).toBe(true);
    expect(Reflect.set(authentication.input, "asOf", "2026-07-29T00:00:00Z")).toBe(false);
    expect(Reflect.set(authentication, "input", {
      ...authentication.input,
      asOf: "2026-07-29T00:00:00Z"
    })).toBe(false);
    expect(authentication.input.asOf).toBe("2026-08-06T00:00:00Z");

    expect(prepareCodexHandoff(plan)).toMatchObject({
      status: "held",
      candidates: [],
      holdReasons: expect.arrayContaining(["decision-plan-not-eligible", "no-planned-candidates"])
    });
  });

  it("does not expose selection or snapshots that can re-authenticate a rewritten plan", async () => {
    const plan = await loadAuthenticatedCodexPlan();
    const authentication = plannerQueries.authenticatedDecisionPlanFor(plan)!;
    plan.primary = structuredClone(plan.primary);

    expect(Reflect.set(authentication, "primary", plan.primary)).toBe(false);
    expect(Reflect.set(authentication, "complement", plan.complement)).toBe(false);
    expect(Reflect.set(authentication, "planSnapshot", decisionPlanSnapshotForTest(plan))).toBe(false);
    expect(plannerQueries.authenticatedDecisionPlanFor(plan)).toBeUndefined();
    expect(prepareCodexHandoff(plan)).toMatchObject({
      status: "held",
      holdReasons: ["decision-plan-loader-authentication-required"]
    });
  });

  it("binds complete-plan classifications into the private plan snapshot", async () => {
    const plan = await loadAuthenticatedCodexPlan();

    plan.directCapabilityIds.push("forged-capability");

    expect(plannerQueries.authenticatedDecisionPlanFor(plan)).toBeUndefined();
    expect(prepareCodexHandoff(plan)).toMatchObject({
      status: "held",
      holdReasons: ["decision-plan-loader-authentication-required"]
    });
  });

  it("holds a branded plan if its selected candidate identity no longer matches the loaded review", async () => {
    const plan = await loadAuthenticatedCodexPlan();
    plan.primary = structuredClone(plan.primary);
    plan.primary!.codexInstall!.commit = "f".repeat(40);

    expect(prepareCodexHandoff(plan)).toMatchObject({
      status: "held",
      candidates: [],
      holdReasons: ["decision-plan-loader-authentication-required"]
    });
  });
});

async function loadAuthenticatedCodexPlan(options: {
  mutateIndex?: (index: MutableDecisionIndex) => void;
  mutateReview?: (event: MutableReviewEvent) => void;
  mutateCompatibilityEvidence?: (evidence: MutableCompatibilityEvidence) => void;
  compatibilityArtifact?: string;
  asOf?: string;
} = {}): Promise<DecisionPlan> {
  return (await loadAuthenticatedCodexContext(options)).plan;
}

async function loadAuthenticatedCodexContext(options: {
  mutateIndex?: (index: MutableDecisionIndex) => void;
  mutateReview?: (event: MutableReviewEvent) => void;
  mutateCompatibilityEvidence?: (evidence: MutableCompatibilityEvidence) => void;
  compatibilityArtifact?: string;
  asOf?: string;
} = {}): Promise<{ index: DecisionIndex; plan: DecisionPlan }> {
  const root = await mkdtemp(join(tmpdir(), "codex-preview-"));
  temporaryRoots.push(root);
  await Promise.all([
    cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
  ]);
  const index = JSON.parse(await generateDecisionIndex(root)) as MutableDecisionIndex;
  await resetHistoricalFixtureEpoch(root);
  index.observedThrough = fixtureAsOf;
  index.catalogExpiresAt = new Date(Date.parse(fixtureAsOf) + DECISION_CATALOG_FRESHNESS_MS)
    .toISOString().replace(".000Z", "Z");
  index.intentFixtures = buildDecisionIntentFixtures(index.profiles, fixtureAsOf);
  await installValidatedCodexResearchFixture(root);
  const skillPath = SHOPIFY_SKILL_PATH;
  const shopifyCandidate = index.candidates.find(({ id }) => id === "shopify-ai-toolkit")!;
  const {
    candidateRevisionId: _candidateRevisionId,
    claudeInstall: _claudeInstall,
    officialBaseline: _officialBaseline,
    ...candidateWithoutClaudeInstall
  } = shopifyCandidate;
  const candidate: MutableCodexCandidate = {
    ...candidateWithoutClaudeInstall,
    displayName: "Shopify AI Toolkit",
    description: "Reviewed Shopify CLI workflows for store and catalog operations.",
    sourceId: SHOPIFY_TEST_SOURCE_ID,
    runtime: "codex",
    skillPath,
    state: "eligible-with-disclosures",
    stateReasons: ["exact-path-approved", "evidence-current", "target-verified:codex/darwin"],
    providedCapabilityIds: SHOPIFY_CAPABILITY_EVIDENCE.map(({ capabilityId }) => capabilityId),
    capabilityEvidenceIds: [],
    revisionBinding: "exact",
    permissions: shopifyPermissionsField(),
    license: { status: "observed", value: "MIT", evidence: [shopifyLicenseFieldEvidence()] },
    trust: shopifyTrustField(),
    dependencies: shopifyDependenciesField(),
    eligibility: {
      reviewExpiresAt: "2026-08-06T00:00:00Z",
      targetExpiresAt: { darwin: "2026-08-06T00:00:00Z" }
    },
    ranking: {
      targetEvidenceAt: { darwin: "2026-07-28T00:00:00Z" },
      reviewedAt: "2026-07-28T00:00:00Z"
    },
    codexInstall: {
      repository: SHOPIFY_REPOSITORY,
      commit: SHOPIFY_COMMIT,
      skillPath,
      reviewDecisionId: SHOPIFY_TEST_REVIEW_ID,
      compatibilityEvidence: "shopify-ai-toolkit-codex-darwin",
      targetPlatform: "darwin"
    }
  };
  const candidateEvidence: MutableCandidateEvidence[] = SHOPIFY_CAPABILITY_EVIDENCE.map((capability, position) => ({
    id: `shopify-ai-toolkit-test-evidence-${position + 1}`,
    candidateId: candidate.id,
    capabilityId: capability.capabilityId,
    kind: "observation",
    current: true,
    support: capability.support,
    reference: capability.reference,
    contentSha256: capability.contentSha256,
    sourceBlobs: capability.sourceBlobs,
    candidate: structuredClone(candidate)
  }));
  candidate.capabilityEvidenceIds = candidateEvidence.map((evidence) => evidence.id);
  for (const evidence of candidateEvidence) evidence.candidate = structuredClone(candidate);
  index.candidates = [candidate];
  index.candidateEvidence = candidateEvidence;
  await writeCodexCandidateManifest(root, candidate, candidateEvidence);
  options.mutateIndex?.(index);
  for (const evidence of index.candidateEvidence) {
    evidence.candidate = structuredClone(index.candidates[0]!);
  }
  refreshIndexDigest(index);

  const observation = JSON.parse(await readFile(
    join(root, "research", "observation-evidence", "shopify-ai-toolkit-test-observation.json"),
    "utf8"
  )) as { blobs: Array<{ path: string; gitBlobSha: string }>; fields: Record<string, unknown> };
  const pathBlobSha = observation.blobs.find(({ path }) => path === skillPath)!.gitBlobSha;
  const inheritedDigest = inheritedEvidenceDigest(observation as never, skillPath)!;
  const event: MutableReviewEvent = {
    sequence: 1,
    id: SHOPIFY_TEST_REVIEW_ID,
    previousEventHash: null,
    target: { sourceId: candidate.sourceId, skillPath },
    disposition: "approved",
    supersedes: null,
    baseline: {
      snapshotId: SHOPIFY_TEST_SNAPSHOT_ID,
      inspectedCommit: SHOPIFY_COMMIT,
      contentSha256: SHOPIFY_SNAPSHOT_SHA256,
      pathBlobSha,
      inheritedEvidenceDigest: inheritedDigest
    },
    reasonCode: "codex-reviewed",
    reason: { ko: "Codex reviewed", en: "Codex reviewed" },
    reviewedSensitiveFields: {
      license: candidate.license,
      permissions: candidate.permissions,
      ownership: shopifyOwnershipField(),
      trust: candidate.trust,
      dependencies: candidate.dependencies,
      executableSurface: shopifyExecutableSurfaceField()
    },
    runtimeEvidence: [{ runtime: "codex", compatibility: "verified", evidenceIds: ["shopify-ai-toolkit-codex-darwin"] }],
    reviewerId: "seunghyeon1004",
    reviewedAt: "2026-07-28T00:00:00Z",
    expiresAt: "2026-08-06T00:00:00Z",
    eventHash: ""
  };
  options.mutateReview?.(event);
  event.eventHash = hashReviewEvent(event as never);
  const compatibilityEvidencePath = join(root, "research", "evidence", "codex-darwin-compatibility.json");
  const compatibilityArtifactPath = join(
    root,
    "research",
    "evidence",
    "artifacts",
    "codex-darwin-compatibility.json"
  );
  const compatibilityEvidence = JSON.parse(await readFile(compatibilityEvidencePath, "utf8")) as MutableCompatibilityEvidence;
  options.mutateCompatibilityEvidence?.(compatibilityEvidence);

  await mkdir(join(root, "generated"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "research", "review-ledger.jsonl"), serializeReviewLedgerJsonl([event] as never)),
    writeFile(compatibilityEvidencePath, JSON.stringify(compatibilityEvidence)),
    options.compatibilityArtifact === undefined
      ? Promise.resolve()
      : writeFile(compatibilityArtifactPath, options.compatibilityArtifact)
  ]);
  await materializeDecisionResearch({
    root,
    asOf: fixtureAsOf,
    checkOnly: false
  });
  index.catalogVersion = (await loadDecisionManifests(root)).digest;
  refreshIndexDigest(index);
  await writeFile(join(root, "generated", "decision-index.json"), `${JSON.stringify(index)}\n`);

  const loaded = await loadDecisionIndex(root);
  const plan = buildDecisionPlan(loaded, {
    runtime: "codex",
    platform: "darwin",
    asOf: options.asOf ?? fixtureAsOf,
    domainIds: ["commerce"]
  });
  return { index: loaded, plan };
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

async function writeCodexCandidateManifest(
  root: string,
  candidate: MutableCodexCandidate,
  evidence: MutableCandidateEvidence[]
): Promise<void> {
  const path = join(root, "manifests", "decision-candidate-evidence.yaml");
  const manifest = parse(await readFile(path, "utf8")) as {
    candidates: unknown[];
    evidence: unknown[];
  };
  const { eligibility: _eligibility, ranking: _ranking, ...manifestCandidate } = candidate;
  manifest.candidates = [manifestCandidate];
  manifest.evidence = evidence.map(({ candidate: _candidate, ...entry }) => entry);
  await writeFile(path, stringify(manifest, { lineWidth: 0 }));
}

async function installValidatedCodexResearchFixture(root: string): Promise<void> {
  const fixtureRoot = join(projectRoot, "tests", "fixtures", "decision-codex-evidence");
  await mkdir(join(root, "research", "observation-evidence"), { recursive: true });
  await Promise.all([
    unlink(join(root, "research", "evidence", ".gitkeep")),
    unlink(join(root, "research", "evidence", "artifacts", ".gitkeep")),
    cp(join(fixtureRoot, "compatibility-darwin.json"), join(root, "research", "evidence", "codex-darwin-compatibility.json")),
    cp(join(fixtureRoot, "compatibility-darwin.artifact.json"), join(root, "research", "evidence", "artifacts", "codex-darwin-compatibility.json"))
  ]);
  await installShopifyResearchSource(root);
}

function refreshIndexDigest(index: MutableDecisionIndex): void {
  const { digest: _digest, ...withoutDigest } = index;
  index.digest = decisionIndexDigest(withoutDigest as never);
}

function decisionPlanSnapshotForTest(plan: DecisionPlan): string {
  return stableValueForTest({
    status: plan.status,
    goal: plan.goal,
    domainIds: plan.domainIds,
    primary: plan.primary,
    complement: plan.complement,
    plannedCandidateIds: [plan.primary?.id, plan.complement?.id].filter((id): id is string => id !== undefined),
    planKind: plan.planKind,
    selectionBasis: plan.selectionBasis,
    smallestHonestProfile: plan.smallestHonestProfile,
    broadCoverageComplete: plan.broadCoverageComplete,
    coverageIncomplete: plan.coverageIncomplete,
    directCapabilityIds: plan.directCapabilityIds,
    inferredCapabilityIds: plan.inferredCapabilityIds,
    relatedCapabilityIds: plan.relatedCapabilityIds,
    uncoveredCapabilityIds: plan.uncoveredCapabilityIds,
    holdReasons: plan.holdReasons,
    excludedCandidates: plan.excludedCandidates,
    requiresDomainPrioritySelection: plan.requiresDomainPrioritySelection,
    executionStatus: plan.executionStatus,
    provenanceDigest: plan.provenanceDigest
  });
}

function stableValueForTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValueForTest).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareCodePointsForTest)
      .map((key) => `${JSON.stringify(key)}:${stableValueForTest(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareCodePointsForTest(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftCharacters[index]!.codePointAt(0)!;
    const rightPoint = rightCharacters[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
  return leftCharacters.length === rightCharacters.length
    ? 0
    : (leftCharacters.length < rightCharacters.length ? -1 : 1);
}

function fabricatedCodexPlan(): DecisionPlan {
  const candidate = {
    id: "reviewed-codex-skill",
    sourceId: "reviewed-source",
    skillPath: "skills/reviewed/SKILL.md",
    runtime: "codex" as const,
    state: "eligible-with-disclosures" as const,
    stateReasons: ["exact-path-approved", "target-verified:codex/darwin", "evidence-current"],
    providedCapabilityIds: ["operate-stores-and-marketplaces"],
    capabilityEvidenceIds: ["reviewed-evidence"],
    revisionBinding: "exact" as const,
    permissions: { status: "observed" as const, value: [], evidence: [] },
    license: { status: "observed" as const, value: "MIT", evidence: [] },
    trust: { status: "observed" as const, value: "reviewed", evidence: [] },
    dependencies: { status: "observed" as const, value: [], evidence: [] },
    codexInstall: {
      repository: "https://github.com/example/reviewed-source",
      commit: "a".repeat(40),
      skillPath: "skills/reviewed/SKILL.md",
      reviewDecisionId: "reviewed-source-approved",
      compatibilityEvidence: "reviewed-source-approved:codex/darwin",
      targetPlatform: "darwin" as const
    }
  };
  return {
    status: "eligible-with-disclosures",
    goal: "commerce",
    domainIds: ["commerce"],
    primary: candidate,
    complement: null,
    planKind: "complete",
    selectionBasis: "explicit-domain",
    smallestHonestProfile: null,
    broadCoverageComplete: true,
    coverageIncomplete: false,
    directCapabilityIds: [],
    inferredCapabilityIds: [],
    relatedCapabilityIds: [],
    uncoveredCapabilityIds: [],
    holdReasons: [],
    excludedCandidates: [],
    requiresDomainPrioritySelection: false,
    executionStatus: "not-executed",
    provenanceDigest: "4".repeat(64)
  };
}
