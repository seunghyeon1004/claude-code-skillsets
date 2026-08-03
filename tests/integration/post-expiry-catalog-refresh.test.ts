import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inc } from "semver";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

import { writeArtifacts } from "../../src/cli.js";
import {
  validateResearchCollectionReceipt,
  validateResearchSnapshot
} from "../../src/contracts/complete-v1.js";
import {
  loadOfficialMarketplaceSelection,
  officialMarketplaceCandidateIdentity
} from "../../src/discovery/official-marketplace.js";
import { candidateRevisionDigest } from "../../src/decision/candidate-revisions.js";
import { buildDecisionPlan } from "../../src/decision/planner.js";
import { evaluateSetupDecisionFixture } from "../../src/evaluate/setup.js";
import { generateAll } from "../../src/generate/all.js";
import { verifyResearchSnapshot } from "../../src/research/snapshot.js";
import { canonicalize } from "../../src/research/canonical-json.js";
import { materializeDecisionResearch } from "../../scripts/research/materialize-decision-research.js";
import {
  parseOfficialMarketplaceApprovalArguments,
  runOfficialMarketplaceApprovalWorkflow
} from
  "../../scripts/research/approve-official-marketplace.js";
import { prepareCatalogDelivery } from "../../scripts/research/refresh-catalog.js";
import { stageOfficialMarketplaceObservation } from "../../scripts/research/stage-official-marketplace.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
const observedAt = addMilliseconds(loadOfficialMarketplaceSelection(projectRoot).observedAt, 10 * 86_400_000);
const latestFixtureApprovalAt = addMilliseconds(observedAt, 10_800_000);
const testWallClockAt = addMilliseconds(latestFixtureApprovalAt, 1_000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(testWallClockAt);
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("post-expiry catalog artifact rehearsal", () => {
  it("materializes a re-observed official epoch into an updateable manager catalog without external effects", async () => {
    const root = await fixtureRoot();
    const initialSelection = loadOfficialMarketplaceSelection(root);
    const initialManager = JSON.parse(await readFile(
      join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
      "utf8"
    )) as { version: string };
    const nextManagerVersion = inc(initialManager.version, "patch");
    expect(nextManagerVersion).not.toBeNull();
    const previousRaw = await readFile(join(root, "plugins", "skillset-manager", "data", "decision-index.json"), "utf8");
    const previousDigest = (JSON.parse(previousRaw) as { digest: string }).digest;
    const artifact = initialSelection.approvedArtifact;
    const manifestBytes = Buffer.from(`${JSON.stringify({
      plugins: artifact.plugins.map(({ name, description, source }) => ({ name, description, source }))
    })}\n`);

    const observation = await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: artifact.provenance.inspectedCommit,
      manifestBytes
    });
    expect(observation).toMatchObject({ state: "current", claimsRenewed: true });
    await writeOfficialObservation(root, artifact.provenance.inspectedCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    await writeArtifacts(root, await generateAll(root));
    const delivery = await prepareCatalogDelivery({ root, previousDecisionIndexRaw: previousRaw });
    expect(delivery).toEqual({
      changed: true,
      previousVersion: initialManager.version,
      nextVersion: nextManagerVersion
    });
    await writeArtifacts(root, await generateAll(root));

    const selection = loadOfficialMarketplaceSelection(root);
    expect(selection.observedAt).toBe(observedAt);
    expect(selection.chain).toHaveLength(initialSelection.chain.length + 1);
    const claimsRaw = await readFile(join(root, "manifests", "official-listing-capability-claims.yaml"), "utf8");
    expect(claimsRaw).toContain(`research/marketplaces/${observation.artifactPath}#/plugins/`);
    const indexRaw = await readFile(join(root, "generated", "decision-index.json"), "utf8");
    expect(await readFile(join(root, "plugins", "skillset-manager", "data", "decision-index.json"), "utf8")).toBe(indexRaw);
    const index = JSON.parse(indexRaw) as {
      observedThrough: string;
      catalogExpiresAt: string;
      starterRoutes: Array<{ domainId: string }>;
      candidates: Array<{ id: string; state: string; eligibility?: { targetExpiresAt?: { darwin?: string } } }>;
    };
    expect(index.observedThrough).toBe(observedAt);
    expect(index.catalogExpiresAt).toBe(addMilliseconds(observedAt, 9 * 86_400_000));
    expect(index.candidates.find(({ id }) => id === "exa")).toMatchObject({
      state: "eligible-with-disclosures",
      eligibility: { targetExpiresAt: { darwin: addMilliseconds(observedAt, 9 * 86_400_000) } }
    });
    expect(index.starterRoutes).toHaveLength(20);
    const catalogEn = await readFile(join(root, "generated", "catalog.en.md"), "utf8");
    expect(catalogEn.match(/\| Executable partial \|/gu)).toHaveLength(7);
    expect(catalogEn.match(/\| Pending\/discovery-only \|/gu)).toHaveLength(13);
    expect(await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index-history", `${previousDigest}.json`),
      "utf8"
    )).toBe(previousRaw);
    const manager = JSON.parse(await readFile(
      join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
      "utf8"
    )) as { version: string };
    const marketplace = JSON.parse(await readFile(join(root, ".claude-plugin", "marketplace.json"), "utf8")) as {
      plugins: Array<{ name: string; version: string }>;
    };
    expect(manager.version).toBe(nextManagerVersion);
    expect(marketplace.plugins.find(({ name }) => name === "skillset-manager")?.version)
      .toBe(nextManagerVersion);
  }, 20_000);

  it("materializes selected drift as review-held without inheriting the renewed epoch", async () => {
    const root = await fixtureRoot();
    const claimsBefore = await readFile(join(root, "manifests", "official-listing-capability-claims.yaml"), "utf8");
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    artifact.plugins.find(({ name }) => name === "exa")!.description += " changed";
    const changedCommit = "f".repeat(40);
    const observation = await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: changedCommit,
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    expect(observation).toMatchObject({ state: "review-required", claimsRenewed: false });
    expect(await readFile(join(root, "manifests", "official-listing-capability-claims.yaml"), "utf8")).toBe(claimsBefore);
    await writeOfficialObservation(root, changedCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    const generated = await generateAll(root);
    const index = JSON.parse(generated.decisionIndex) as Parameters<typeof evaluateSetupDecisionFixture>[0];
    const candidates = index.candidates as Array<{
      id: string;
      state: string;
      stateReasons: string[];
      claudeInstall?: unknown;
    }>;
    expect(candidates.find(({ id }) => id === "exa")).toMatchObject({
      state: "held",
      stateReasons: expect.arrayContaining(["official-marketplace-selection:review-required"])
    });
    expect(index.starterRoutes).toHaveLength(20);
    expect(index.starterRoutes?.some(({ orderedCandidateIds }) => orderedCandidateIds.includes("exa"))).toBe(false);
    expect(candidates.every(({ state }) => state === "held")).toBe(true);
    expect(candidates.every(({ claudeInstall }) => claudeInstall === undefined)).toBe(true);
    expect(generated.catalogEn.match(/\| Executable partial \|/gu)).toBeNull();
    expect(generated.catalogEn.match(/\| Pending\/discovery-only \|/gu)).toHaveLength(20);
    const setup = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: observedAt },
      riskAcknowledged: true
    });
    expect(setup).toMatchObject({
      status: "held",
      holdReason: "decision-plan-held"
    });
    expect(setup.commands).toEqual([
      { kind: "time-probe", candidateId: null, argv: ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"] }
    ]);
    expect(setup.commands.some(({ kind }) => kind === "install")).toBe(false);
  }, 20_000);

  it("promotes explicit approval through materialization, delivery history, versioning, and verification", async () => {
    const root = await fixtureRoot();
    const initialRaw = await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index.json"),
      "utf8"
    );
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    (artifact.plugins.find(({ name }) => name === "exa")!.source as { sha: string }).sha = "f".repeat(40);
    const approvalCommit = "e".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: approvalCommit,
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await writeOfficialObservation(root, approvalCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    await writeArtifacts(root, await generateAll(root));
    await prepareCatalogDelivery({ root, previousDecisionIndexRaw: initialRaw });
    await writeArtifacts(root, await generateAll(root));
    await commitFixture(root, "test: stage review-held approval candidate");

    const candidateRaw = await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index.json"),
      "utf8"
    );
    const candidateDigest = (JSON.parse(candidateRaw) as { digest: string }).digest;
    const candidateManager = JSON.parse(await readFile(
      join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
      "utf8"
    )) as { version: string };
    const expectedVersion = inc(candidateManager.version, "patch");
    const approvalAt = addMilliseconds(observedAt, 3_600_000);
    const verified: Array<{ root: string; asOf: string }> = [];

    const result = await runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: approvalAt,
      approvedBy: "reviewer:test",
      reason: "reviewed source pin promotion",
      candidateAdditions: [],
      verify: async (input) => {
        verified.push(input);
      }
    });

    expect(result).toMatchObject({
      approval: { state: "current", approvedBy: "reviewer:test" },
      delivery: {
        changed: true,
        previousVersion: candidateManager.version,
        nextVersion: expectedVersion
      }
    });
    expect(verified).toEqual([{ root, asOf: approvalAt }]);
    expect(loadOfficialMarketplaceSelection(root).state).toBe("current");
    const approvedIndex = JSON.parse((await generateAll(root)).decisionIndex) as {
      starterRoutes: Array<{ domainId: string }>;
      candidates: Array<{ id: string; state: string }>;
    };
    expect(approvedIndex.starterRoutes).toHaveLength(20);
    expect(approvedIndex.candidates.find(({ id }) => id === "exa")).toMatchObject({
      state: "eligible-with-disclosures"
    });
    expect(await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index-history", `${candidateDigest}.json`),
      "utf8"
    )).toBe(candidateRaw);
    expect(await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index.json"),
      "utf8"
    )).toBe(await readFile(join(root, "generated", "decision-index.json"), "utf8"));
    expect(JSON.parse(await readFile(
      join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
      "utf8"
    ))).toMatchObject({ version: expectedVersion });
  }, 60_000);

  it("rolls back every approval artifact when post-approval verification fails", async () => {
    const root = await fixtureRoot();
    const initialRaw = await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index.json"),
      "utf8"
    );
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    (artifact.plugins.find(({ name }) => name === "exa")!.source as { sha: string }).sha = "f".repeat(40);
    const approvalCommit = "c".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: approvalCommit,
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await writeOfficialObservation(root, approvalCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    await writeArtifacts(root, await generateAll(root));
    await prepareCatalogDelivery({ root, previousDecisionIndexRaw: initialRaw });
    await writeArtifacts(root, await generateAll(root));
    await commitFixture(root, "test: stage rollback candidate");

    const paths = [
      "research/marketplaces/official-marketplace-current.json",
      "manifests/official-listing-capability-claims.yaml",
      "research/official-marketplace-review-backlog.json",
      "generated/decision-index.json",
      "plugins/skillset-manager/.claude-plugin/plugin.json"
    ];
    const before = new Map(await Promise.all(paths.map(async (path) => [
      path,
      await readFile(join(root, path))
    ] as const)));
    const historyDirectory = join(root, "plugins", "skillset-manager", "data", "decision-index-history");
    const historyBefore = await directoryBytes(historyDirectory);

    await expect(runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "verification failure rollback",
      candidateAdditions: [],
      verify: async () => {
        throw new Error("forced post-approval verification failure");
      }
    })).rejects.toThrow(/forced post-approval verification failure/i);

    for (const [path, bytes] of before) {
      expect(await readFile(join(root, path))).toEqual(bytes);
    }
    expect(await directoryBytes(historyDirectory)).toEqual(historyBefore);
    expect(loadOfficialMarketplaceSelection(root).state).toBe("review-required");
    expect(await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");

    await expect(runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "verifier mutation must roll back",
      candidateAdditions: [],
      verify: async ({ root: verifiedRoot }) => {
        await writeFile(join(verifiedRoot, "verifier-injected.txt"), "unexpected verifier mutation\n");
      }
    })).rejects.toThrow(/verification.*worktree|snapshot/i);
    await expect(readFile(join(root, "verifier-injected.txt"))).rejects.toThrow();
    expect(loadOfficialMarketplaceSelection(root).state).toBe("review-required");
    expect(await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
  }, 60_000);

  it("refuses operator approval from a dirty worktree before changing selection state", async () => {
    const root = await fixtureRoot();
    const pointerPath = join(root, "research", "marketplaces", "official-marketplace-current.json");
    const pointerBefore = await readFile(pointerPath);
    await writeFile(join(root, "README.md"), "local operator change\n");

    await expect(runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "dirty worktree must fail closed",
      candidateAdditions: [],
      verify: async () => undefined
    })).rejects.toThrow(/clean worktree/i);

    expect(await readFile(pointerPath)).toEqual(pointerBefore);
  });

  it("requires exact base, HEAD, and non-future operator inputs before changing selection state", async () => {
    const root = await fixtureRoot();
    const pointerPath = join(root, "research", "marketplaces", "official-marketplace-current.json");
    const pointerBefore = await readFile(pointerPath);
    const trust = await approvalTrust(root);
    const common = {
      root,
      ...trust,
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "reject stale operator coordinates",
      candidateAdditions: [],
      verify: async () => undefined
    };

    await expect(runOfficialMarketplaceApprovalWorkflow({
      ...common,
      expectedHeadSha: "0".repeat(40)
    })).rejects.toThrow(/HEAD.*expected-head-sha/i);
    await expect(runOfficialMarketplaceApprovalWorkflow({
      ...common,
      baseSha: "0".repeat(40)
    })).rejects.toThrow(/base.*ancestor/i);
    await expect(runOfficialMarketplaceApprovalWorkflow({
      ...common,
      approvedAt: addMilliseconds(testWallClockAt, 1_000)
    })).rejects.toThrow(/not in the future/i);
    expect(await readFile(pointerPath)).toEqual(pointerBefore);
    expect(() => parseOfficialMarketplaceApprovalArguments([
      "--approved-at", common.approvedAt,
      "--approved-by", common.approvedBy,
      "--reason", common.reason
    ])).toThrow(/base-sha.*expected-head-sha.*approved-registry-tag-object/i);
  });

  it("rejects a fake registry approval tag object before manual approval", async () => {
    const root = await fixtureRoot();
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    const exa = artifact.plugins.find(({ name }) => name === "exa")!;
    if (typeof exa.source === "string") throw new Error("Exa fixture source must be pinned");
    exa.source.sha = "7".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: "6".repeat(40),
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await commitFixture(root, "test: stage candidate for fake anchor rejection");
    const pointerPath = join(root, "research", "marketplaces", "official-marketplace-current.json");
    const pointerBefore = await readFile(pointerPath);

    await expect(runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedRegistryTagObject: "0".repeat(40),
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "fake tag object must fail closed",
      candidateAdditions: [],
      verify: async () => undefined
    })).rejects.toThrow(/protected approved registry tag object/i);
    expect(await readFile(pointerPath)).toEqual(pointerBefore);
  });

  it("keeps approval review-held when the latest observation does not bind the observed commit", async () => {
    const root = await fixtureRoot();
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    (artifact.plugins.find(({ name }) => name === "exa")!.source as { sha: string }).sha = "f".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: "d".repeat(40),
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await commitFixture(root, "test: stage mismatched observation");

    await expect(runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "observation mismatch must fail closed",
      candidateAdditions: [],
      verify: async () => undefined
    })).rejects.toThrow("Latest official marketplace observation must exactly bind the review-held selection");
    expect(loadOfficialMarketplaceSelection(root).state).toBe("review-required");
  });

  it("rejects a matching materialized observation when a newer receipt binds another commit", async () => {
    const root = await fixtureRoot();
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    (artifact.plugins.find(({ name }) => name === "exa")!.source as { sha: string }).sha = "f".repeat(40);
    const selectedCommit = "b".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: selectedCommit,
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await writeOfficialObservation(root, selectedCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    await rewriteOfficialReceipt(root, addMilliseconds(observedAt, 7_200_000), "a".repeat(40));
    await commitFixture(root, "test: stage newer mismatched official receipt");

    await expect(generateAll(root)).rejects.toThrow(/officialBaseline source binding|latest effective/i);
    await expect(runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: addMilliseconds(observedAt, 10_800_000),
      approvedBy: "reviewer:test",
      reason: "newer receipt mismatch must fail closed",
      candidateAdditions: [],
      verify: async () => undefined
    })).rejects.toThrow(/latest.*official.*observation.*bind/i);
    expect(loadOfficialMarketplaceSelection(root).state).toBe("review-required");
  });

  it("rejects an approval timestamp older than the latest same-commit receipt", async () => {
    const root = await fixtureRoot();
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    const exa = artifact.plugins.find(({ name }) => name === "exa")!;
    if (typeof exa.source === "string") throw new Error("Exa fixture source must be pinned");
    exa.source.sha = "f".repeat(40);
    const selectedCommit = "5".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: selectedCommit,
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await writeOfficialObservation(root, selectedCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    await rewriteOfficialReceipt(root, addMilliseconds(observedAt, 7_200_000), selectedCommit);
    await commitFixture(root, "test: stage later same-commit official receipt");

    await expect(runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "approval must not predate latest receipt",
      candidateAdditions: [],
      verify: async () => undefined
    })).rejects.toThrow(/latest.*official.*observation.*bind/i);
    expect(loadOfficialMarketplaceSelection(root).state).toBe("review-required");
  });

  it("approves an exact held Shopify revision without treating it as an install safety approval", async () => {
    const root = await fixtureRoot();
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    const shopify = artifact.plugins.find(({ name }) => name === "shopify-ai-toolkit")!;
    if (typeof shopify.source === "string") throw new Error("Shopify fixture source must be pinned");
    shopify.source.sha = "8".repeat(40);
    const marketplaceCommit = "9".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: marketplaceCommit,
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await writeOfficialObservation(root, marketplaceCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    const revisionId = await installExactShopifyRevision(root, observedAt);
    const reviewersPath = join(root, "governance", "reviewers.json");
    const reviewersBytes = await readFile(reviewersPath);
    await rm(reviewersPath);
    try {
      await expect(generateAll(root)).rejects.toThrow(/governance\/reviewers|reviewers.*missing|required path/i);
    } finally {
      await writeFile(reviewersPath, reviewersBytes);
    }
    const revisionManifest = parse(await readFile(
      join(root, "manifests", "decision-candidate-evidence.yaml"),
      "utf8"
    )) as {
      officialTargetCompatibilityEvidence: Array<{
        candidateRevisionId?: string;
        observedAt: string;
        reviewedAt: string;
        expiresAt: string;
      }>;
    };
    const revisionCompatibility = revisionManifest.officialTargetCompatibilityEvidence
      .find(({ candidateRevisionId }) => candidateRevisionId === revisionId)!;
    const revisionObservation = JSON.parse(await readFile(
      join(root, "research", "evidence", "shopify-ai-toolkit-revision-reviewed-marketplace.json"),
      "utf8"
    )) as { observedAt: string };
    expect(revisionCompatibility).toMatchObject({
      observedAt,
      reviewedAt: revisionObservation.observedAt
    });
    expect(Date.parse(revisionCompatibility.expiresAt) - Date.parse(revisionObservation.observedAt))
      .toBeLessThanOrEqual(9 * 86_400_000);
    await bindShopifyCommerceRoute(root);
    const beforeApproval = JSON.parse((await generateAll(root)).decisionIndex) as {
      candidates: Array<{ id: string; state: string; candidateRevisionId?: string }>;
    };
    expect(beforeApproval.candidates.find(({ id }) => id === "shopify-ai-toolkit")).toMatchObject({
      state: "held",
      candidateRevisionId: revisionId
    });
    await writeArtifacts(root, await generateAll(root));
    await commitFixture(root, "test: bind exact held Shopify revision");
    const candidateRaw = await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index.json"),
      "utf8"
    );
    const candidateDigest = (JSON.parse(candidateRaw) as { digest: string }).digest;
    const candidateVersion = (JSON.parse(await readFile(
      join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
      "utf8"
    )) as { version: string }).version;
    const expectedVersion = inc(candidateVersion, "patch");
    expect(expectedVersion).not.toBeNull();

    const result = await runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "approve exact held Shopify marketplace revision",
      candidateAdditions: []
    });

    expect(result).toMatchObject({
      approval: { state: "current" },
      delivery: { changed: true, previousVersion: candidateVersion, nextVersion: expectedVersion }
    });
    const generated = await generateAll(root);
    const afterApproval = JSON.parse(generated.decisionIndex) as Parameters<typeof evaluateSetupDecisionFixture>[0] & {
      candidates: Array<{
        id: string;
        state: string;
        candidateRevisionId?: string;
      }>;
    };
    expect(afterApproval.candidates.find(({ id }) => id === "shopify-ai-toolkit")).toEqual(expect.objectContaining({
      state: "held",
      candidateRevisionId: revisionId
    }));
    expect(afterApproval.starterRoutes).toHaveLength(20);
    expect(afterApproval.starterRoutes?.flatMap(({ orderedCandidateIds }) => orderedCandidateIds))
      .toContain("shopify-ai-toolkit");
    expect(afterApproval.candidates.find(({ id }) => id === "exa")).toMatchObject({ state: "eligible-with-disclosures" });
    expect(generated.catalogEn.match(/\| Executable partial \|/gu)).toHaveLength(7);
    expect(generated.catalogEn.match(/\| Pending\/discovery-only \|/gu)).toHaveLength(13);
    expect(generated.catalogEn).toMatch(
      /\| commerce \|[^\n]*\| shopify-ai-toolkit \(held\) \| Pending\/discovery-only \|/u
    );
    const commercePlan = buildDecisionPlan(afterApproval, {
      domainIds: ["commerce"],
      runtime: "claude-code",
      platform: "darwin",
      asOf: addMilliseconds(observedAt, 3_600_000)
    });
    expect(commercePlan).toMatchObject({ status: "held", primary: null, complement: null });
    expect([commercePlan.primary?.id, commercePlan.complement?.id]).not.toContain("shopify-ai-toolkit");
    const setup = await evaluateSetupDecisionFixture(afterApproval, {
      language: "en",
      domainIds: ["commerce"],
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: addMilliseconds(observedAt, 3_600_000) },
      riskAcknowledged: true
    });
    expect(setup.status).toBe("held");
    expect(setup.commands.some(({ kind }) => kind === "install")).toBe(false);
    expect(await readFile(
      join(root, "plugins", "skillset-manager", "data", "decision-index-history", `${candidateDigest}.json`),
      "utf8"
    )).toBe(candidateRaw);
    expect(JSON.parse(await readFile(
      join(root, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"),
      "utf8"
    ))).toMatchObject({ version: expectedVersion });
  }, 60_000);

  it("rejects an older tampered v3 materialization before using it for revision freshness", async () => {
    const root = await fixtureRoot();
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    const shopify = artifact.plugins.find(({ name }) => name === "shopify-ai-toolkit")!;
    if (typeof shopify.source === "string") throw new Error("Shopify fixture source must be pinned");
    shopify.source.sha = "8".repeat(40);
    const marketplaceCommit = "9".repeat(40);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: marketplaceCommit,
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await writeOfficialObservation(root, marketplaceCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    await installExactShopifyRevision(root, observedAt);
    const observationsPath = join(root, "research", "source-observations.json");
    const observations = JSON.parse(await readFile(observationsPath, "utf8")) as {
      observations: Array<{ sourceId: string; observedAt: string }>;
    };
    const official = observations.observations.find(({ sourceId }) => sourceId === "anthropic-plugins-official")!;
    official.observedAt = addMilliseconds(observedAt, -10 * 86_400_000);
    await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);

    await expect(generateAll(root)).rejects.toThrow(/source observation|materialization|materialized/i);
  });

  it.each([
    ["description", (plugin: { description: string; source: unknown }) => {
      plugin.description += " changed";
    }],
    ["coordinate", (plugin: { description: string; source: unknown }) => {
      (plugin.source as { url: string }).url = "https://github.com/Shopify/renamed-ai-toolkit.git";
    }],
    ["pin", (plugin: { description: string; source: unknown }) => {
      (plugin.source as { sha: string }).sha = "f".repeat(40);
    }]
  ])("keeps historical manual evidence held after exact latest-observation binding on %s drift", async (_label, mutate) => {
    const root = await fixtureRoot();
    const artifact = loadOfficialMarketplaceSelection(root).approvedArtifact;
    const shopify = artifact.plugins.find(({ name }) => name === "shopify-ai-toolkit")!;
    mutate(shopify);
    await stageOfficialMarketplaceObservation({
      root,
      observedAt,
      inspectedCommit: artifact.provenance.inspectedCommit,
      manifestBytes: Buffer.from(`${JSON.stringify({ plugins: artifact.plugins })}\n`)
    });
    await writeOfficialObservation(root, artifact.provenance.inspectedCommit);
    await materializeDecisionResearch({ root, asOf: observedAt, checkOnly: false });
    await commitFixture(root, `test: stage exact-observation manual ${_label} drift`);

    await expect(runOfficialMarketplaceApprovalWorkflow({
      root,
      ...(await approvalTrust(root)),
      approvedAt: addMilliseconds(observedAt, 3_600_000),
      approvedBy: "reviewer:test",
      reason: "manual evidence drift must remain held",
      candidateAdditions: [],
      verify: async () => undefined
    })).rejects.toThrow("Manual official evidence must be rebound before marketplace approval: shopify-ai-toolkit");
    expect(loadOfficialMarketplaceSelection(root).state).toBe("review-required");
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "post-expiry-catalog-"));
  temporaryRoots.push(root);
  for (const path of [".claude-plugin", "generated", "governance", "manifests", "plugins", "research"]) {
    await cp(join(projectRoot, path), join(root, path), { recursive: true });
  }
  await cp(
    join(projectRoot, "tests", "evaluations", "packs"),
    join(root, "tests", "evaluations", "packs"),
    { recursive: true }
  );
  const decisionPath = join(root, "manifests", "decision-candidate-evidence.yaml");
  const decision = parse(await readFile(decisionPath, "utf8")) as {
    candidateRevisions?: unknown;
    evidence: Array<{ candidateRevisionId?: string }>;
    officialTargetCompatibilityEvidence?: Array<{ candidateRevisionId?: string }>;
  };
  delete decision.candidateRevisions;
  decision.evidence = decision.evidence.filter(({ candidateRevisionId }) => candidateRevisionId === undefined);
  decision.officialTargetCompatibilityEvidence = decision.officialTargetCompatibilityEvidence?.filter(
    ({ candidateRevisionId }) => candidateRevisionId === undefined
  );
  await writeFile(decisionPath, stringify(decision, { lineWidth: 0 }));
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Approval Workflow Test"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "approval-workflow@example.test"], { cwd: root });
  await commitFixture(root, "test: seed approval workflow fixture");
  await execFileAsync("git", ["tag", "-a", "registry-approved/r01", "-m", "R01 root"], { cwd: root });
  return root;
}

async function approvalTrust(root: string): Promise<Pick<
  Parameters<typeof runOfficialMarketplaceApprovalWorkflow>[0],
  "baseSha" | "expectedHeadSha" | "approvedRegistryTagObject"
>> {
  return {
    baseSha: await git(root, ["rev-parse", "registry-approved/r01^{commit}"]),
    expectedHeadSha: await git(root, ["rev-parse", "HEAD"]),
    approvedRegistryTagObject: await git(root, ["rev-parse", "registry-approved/r01"])
  };
}

async function commitFixture(root: string, message: string): Promise<void> {
  await execFileAsync("git", ["add", "--all"], { cwd: root });
  await execFileAsync("git", ["commit", "--quiet", "--signoff", "-m", message], { cwd: root });
}

async function directoryBytes(root: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all((await readdir(root)).sort().map(async (name) => [
    name,
    (await readFile(join(root, name))).toString("base64")
  ])));
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd: root, encoding: "utf8" });
  return stdout.trim();
}

async function writeOfficialObservation(root: string, inspectedCommit: string): Promise<void> {
  const directory = join(root, "research", "observation-evidence");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "observation-20260808-anthropic-plugins-official.json"), `${JSON.stringify({
    schemaVersion: 3,
    id: "observation-20260808-anthropic-plugins-official",
    sourceId: "anthropic-plugins-official",
    observedAt,
    inspectedCommit,
    blobs: [],
    fields: Object.fromEntries(["license", "permissions", "ownership", "dependencies", "executableSurface"]
      .map((field) => [field, { status: "unknown", evidence: [] }]))
  }, null, 2)}\n`);
}

async function installExactShopifyRevision(root: string, reviewedAt: string): Promise<string> {
  const selection = loadOfficialMarketplaceSelection(root);
  const pluginIndex = selection.observedArtifact.plugins.findIndex(({ name }) => name === "shopify-ai-toolkit");
  const plugin = selection.observedArtifact.plugins[pluginIndex];
  if (plugin === undefined || typeof plugin.source === "string") {
    throw new Error("Shopify fixture must resolve a pinned external source");
  }
  const pluginSource = plugin.source;
  const manifestPath = join(root, "manifests", "decision-candidate-evidence.yaml");
  const manifest = parse(await readFile(manifestPath, "utf8")) as {
    candidates: Array<Record<string, unknown> & { id: string }>;
    candidateRevisions?: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown> & { id: string; candidateId: string }>;
    officialTargetCompatibilityEvidence: Array<Record<string, unknown> & {
      id: string;
      candidateId: string;
      snapshot: Record<string, unknown>;
      sourceUrls: string[];
    }>;
  };
  const baseCandidate = manifest.candidates.find(({ id }) => id === "shopify-ai-toolkit");
  if (baseCandidate === undefined) throw new Error("Shopify base candidate fixture is missing");
  const revisionId = "shopify-ai-toolkit-revision-reviewed-update";
  const reference = `research/marketplaces/${selection.observedArtifactPath}#/plugins/${pluginIndex}`;
  const oldBaseline = structuredClone(baseCandidate.officialBaseline) as Record<string, unknown>;
  const oldSourceCommit = String(oldBaseline.sourceCommit);
  const sourceBlobs = replaceCommit(structuredClone(oldBaseline.sourceBlobs), oldSourceCommit, pluginSource.sha);
  const baseline = {
    ...oldBaseline,
    reference,
    marketplaceManifestSha256: selection.observedArtifact.provenance.manifestSha256,
    pluginName: plugin.name,
    sourceUrl: externalSourceUrl(pluginSource),
    sourceCommit: pluginSource.sha,
    sourceBlobs
  };
  const baseEvidence = manifest.evidence.filter(({ candidateId }) => candidateId === "shopify-ai-toolkit");
  const idByOldId = new Map(baseEvidence.map(({ id }) => [id, `${id}-revision-reviewed-update`]));
  const auditArtifactPath = "research/evidence/artifacts/shopify-ai-toolkit-revision-reviewed-update.json";
  const oldArtifactPath = String(baseEvidence[0]!.artifactPath);
  let artifact = JSON.parse(await readFile(join(root, oldArtifactPath), "utf8")) as {
    candidate: Record<string, unknown>;
    capabilities: Array<Record<string, unknown> & { id: string }>;
  };
  artifact = replaceCommit(artifact, oldSourceCommit, pluginSource.sha);
  artifact.candidate = {
    ...artifact.candidate,
    candidateRevisionId: revisionId,
    officialBaseline: baseline
  };
  artifact.capabilities = artifact.capabilities.map((capability) => ({
    ...capability,
    id: idByOldId.get(capability.id) ?? capability.id
  }));
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(join(root, auditArtifactPath), artifactBytes);
  const auditArtifactSha256 = sha256(artifactBytes);
  const revisionEvidence = baseEvidence.map((evidence) => ({
    ...replaceCommit(structuredClone(evidence), oldSourceCommit, pluginSource.sha),
    id: idByOldId.get(evidence.id)!,
    candidateRevisionId: revisionId,
    reference,
    contentSha256: selection.observedArtifact.provenance.manifestSha256,
    artifactPath: auditArtifactPath,
    artifactSha256: auditArtifactSha256
  })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const candidate = {
    ...structuredClone(baseCandidate),
    candidateRevisionId: revisionId,
    capabilityEvidenceIds: revisionEvidence.map(({ id }) => id),
    officialBaseline: baseline
  };
  const observationEvidenceId = "observation-20260808-anthropic-plugins-official";
  const observedEvidence = {
    schemaVersion: 3,
    id: "shopify-ai-toolkit-revision-reviewed-marketplace",
    reviewId: "shopify-ai-toolkit-revision-reviewed-review",
    providerId: "anthropic-plugins-official",
    kind: "marketplace-identity",
    observationEvidenceId,
    reviewedCommit: selection.observedArtifact.provenance.inspectedCommit,
    observedArtifactPath: `research/marketplaces/${selection.observedArtifactPath}`,
    observedArtifactSha256: selection.observedArtifactSha256,
    scope: { runtime: null, platform: null, capabilityId: null },
    observedAt: reviewedAt,
    artifactPath: auditArtifactPath,
    artifactSha256: auditArtifactSha256,
    outcome: "passed",
    summary: "Exact held Shopify candidate rebind; not an install or safety approval."
  };
  await writeFile(
    join(root, "research", "evidence", "shopify-ai-toolkit-revision-reviewed-marketplace.json"),
    `${JSON.stringify(observedEvidence, null, 2)}\n`
  );
  const baseCompatibility = manifest.officialTargetCompatibilityEvidence
    .find(({ candidateId }) => candidateId === "shopify-ai-toolkit");
  if (baseCompatibility === undefined) throw new Error("Shopify compatibility fixture is missing");
  const marketplaceEntryUrl = `${selection.observedArtifact.provenance.repository}/blob/${selection.observedArtifact.provenance.inspectedCommit}/${selection.observedArtifact.provenance.manifestPath}`;
  const compatibility = structuredClone(baseCompatibility);
  compatibility.id = "shopify-ai-toolkit-claude-code-darwin-revision-reviewed-update";
  compatibility.candidateRevisionId = revisionId;
  compatibility.observedAt = reviewedAt;
  compatibility.reviewedAt = reviewedAt;
  compatibility.expiresAt = addMilliseconds(reviewedAt, 9 * 86_400_000);
  compatibility.snapshot = {
    ...compatibility.snapshot,
    id: "shopify-ai-toolkit-official-marketplace-revision-reviewed-update",
    marketplaceEntryUrl,
    marketplaceEntrySourceUrl: externalSourceUrl(pluginSource),
    marketplaceEntrySourceCommit: pluginSource.sha
  };
  compatibility.sourceUrls = compatibility.sourceUrls
    .map((url) => url.includes("/anthropics/claude-plugins-official/blob/")
      ? marketplaceEntryUrl
      : url.replace(oldSourceCommit, pluginSource.sha));
  compatibility.snapshot.digest = digestWithout(compatibility.snapshot, "digest");
  compatibility.evidenceDigest = digestWithout(compatibility, "evidenceDigest");
  const revision = {
    id: revisionId,
    candidateId: "shopify-ai-toolkit",
    previousRevisionId: null,
    candidate,
    approval: {
      kind: "exact-candidate-rebind",
      disposition: "held",
      reviewerId: "seunghyeon1004",
      reviewedAt,
      sourceCommit: pluginSource.sha,
      marketplaceManifestSha256: selection.observedArtifact.provenance.manifestSha256,
      candidateIdentity: officialMarketplaceCandidateIdentity(plugin),
      observedArtifactPath: `research/marketplaces/${selection.observedArtifactPath}`,
      observedArtifactSha256: selection.observedArtifactSha256,
      observationEvidenceId,
      evidenceArtifactPath: auditArtifactPath,
      evidenceArtifactSha256: auditArtifactSha256,
      evidenceIds: revisionEvidence.map(({ id }) => id),
      digest: "0".repeat(64)
    }
  };
  revision.approval.digest = candidateRevisionDigest(revision as never);
  manifest.candidateRevisions = [...(manifest.candidateRevisions ?? []), revision];
  manifest.evidence.push(...revisionEvidence);
  manifest.officialTargetCompatibilityEvidence.push(compatibility);
  await writeFile(manifestPath, stringify(manifest));
  return revisionId;
}

async function bindShopifyCommerceRoute(root: string): Promise<void> {
  const path = join(root, "manifests", "decision-starter-routes.yaml");
  const manifest = parse(await readFile(path, "utf8")) as {
    routes: Array<Record<string, unknown> & { domainId: string }>;
  };
  const route = manifest.routes.find(({ domainId }) => domainId === "commerce");
  if (route === undefined) throw new Error("Commerce route fixture is missing");
  route.orderedCandidateIds = ["shopify-ai-toolkit"];
  route.directEvidenceIds = [
    "shopify-ai-toolkit-catalog-listings",
    "shopify-ai-toolkit-store-operations"
  ];
  route.inferredEvidenceIds = ["shopify-ai-toolkit-promotion-revenue"];
  delete route.relatedEvidenceIds;
  route.unsupportedCapabilityIds = [
    "research-and-plan-commerce-products",
    "optimize-pricing-and-merchandising",
    "manage-inventory-orders-and-fulfillment",
    "manage-post-purchase-returns-and-reviews"
  ];
  await writeFile(path, stringify(manifest));
}

function digestWithout(value: Record<string, unknown>, key: string): string {
  const hashable = { ...value };
  delete hashable[key];
  return createHash("sha256").update(canonicalize(hashable)).digest("hex");
}

function replaceCommit<T>(value: T, before: string, after: string): T {
  return JSON.parse(JSON.stringify(value).replaceAll(before, after)) as T;
}

function externalSourceUrl(source: Exclude<
  ReturnType<typeof loadOfficialMarketplaceSelection>["observedArtifact"]["plugins"][number]["source"],
  string
>): string {
  return source.source === "github" ? `https://github.com/${source.repo}` : source.url;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function rewriteOfficialReceipt(root: string, observed: string, inspectedCommit: string): Promise<void> {
  const name = "2026-07-23-anthropic-plugins-official.json";
  const snapshotPath = join(root, "research", "snapshots", name);
  const receiptPath = join(root, "research", "receipts", name);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
    observedAt: string;
    inspectedCommit: string;
  };
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    observedAt: string;
    inspectedCommit: string;
  };
  snapshot.observedAt = observed;
  snapshot.inspectedCommit = inspectedCommit;
  receipt.observedAt = observed;
  receipt.inspectedCommit = inspectedCommit;
  const validatedSnapshot = verifyResearchSnapshot(validateResearchSnapshot(snapshot));
  const validatedReceipt = validateResearchCollectionReceipt(receipt);
  if (validatedReceipt.snapshotId !== validatedSnapshot.id
    || validatedReceipt.observedAt !== validatedSnapshot.observedAt
    || validatedReceipt.inspectedCommit !== validatedSnapshot.inspectedCommit
    || validatedReceipt.snapshotContentSha256 !== validatedSnapshot.contentSha256) {
    throw new Error("Test fixture did not create a valid official receipt/snapshot pair");
  }
  await Promise.all([
    writeFile(snapshotPath, `${JSON.stringify(validatedSnapshot, null, 2)}\n`),
    writeFile(receiptPath, `${JSON.stringify(validatedReceipt, null, 2)}\n`)
  ]);
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString().replace(".000Z", "Z");
}
