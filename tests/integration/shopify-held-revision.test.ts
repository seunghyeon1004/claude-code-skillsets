import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import { validateDecisionCandidateEvidence } from "../../src/contracts/decision.js";
import { validateResearchEvidence } from "../../src/contracts/complete-v1.js";
import { candidateRevisionDigest } from "../../src/decision/candidate-revisions.js";
import { buildDecisionPlan } from "../../src/decision/planner.js";
import { decisionIndexDigest } from "../../src/decision/index-loader.js";
import { loadDecisionIndex, loadDecisionManifests } from "../../src/decision/repository.js";
import { evaluateSetupDecisionFixture } from "../../src/evaluate/setup.js";
import { generateDecisionIndex } from "../../src/generate/decision-index.js";
import type { DecisionCandidateEvidenceManifest, DecisionIndex } from "../../src/model/decision.js";
import { canonicalize } from "../../src/research/canonical-json.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const revisionId = "shopify-ai-toolkit-revision-0e06bc35611e";
const sourceCommit = "0e06bc35611e505e372de7f8cdf265e6d6dbc311";
const marketplaceCommit = "909649d9b178d142201000c76715b5fc952818e3";
const marketplaceManifestSha256 = "d580b5d2fa473fdbfc8792ece117f6a3a92d4bb12356ab17beb2f3cc5f7b0316";
const observedArtifactPath =
  "research/marketplaces/claude-plugins-official-909649d9b178d142201000c76715b5fc952818e3.json";
const observedArtifactSha256 = "347a0f33756f6f53117276b6f6e9c3333ffbedf284f39e4a4f66f3c7fb79841d";
const observationEvidenceId = "observation-20260803015057-anthropic-plugins-official";
const observedAt = "2026-08-03T01:50:57Z";
const artifactPath = `research/evidence/artifacts/shopify-ai-toolkit-${sourceCommit}.json`;
const sourceAuditPath = "research/audits/shopify-ai-toolkit-0e06bc35611e.md";
const marketplaceEvidencePath = "research/evidence/shopify-ai-toolkit-revision-0e06bc35611e-marketplace.json";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("production Shopify held candidate revision", () => {
  it("schema-validates an append-only exact C binding while preserving issued Shopify records", async () => {
    const manifest = await decisionManifest(projectRoot);
    expect(validateDecisionCandidateEvidence(manifest)).toEqual(manifest);

    expect(sha256(canonicalize(manifest.candidates.find(({ id }) => id === "shopify-ai-toolkit")))).toBe(
      "2eac418ace5e3196b1522e793c084e166a4e4e124726b4d895665be545f87ba2"
    );
    expect(manifest.evidence.filter(({ candidateId, candidateRevisionId }) =>
      candidateId === "shopify-ai-toolkit" && candidateRevisionId === undefined
    ).map(({ id, ...record }) => [id, sha256(canonicalize({ id, ...record }))])).toEqual([
      ["shopify-ai-toolkit-store-operations", "31a198be0b6e77be3b9bfcf94c37e54c0705739dbc050cafcf6b22087176e2c2"],
      ["shopify-ai-toolkit-catalog-listings", "a6c51d56415f37f9997c400952fed5e36e16151056cf05bf7c8f45d744eed089"],
      ["shopify-ai-toolkit-promotion-revenue", "b25b5c3f9d738f44c48f17766995bcbe69ecca4519c2fb013ca8bd73da710508"]
    ]);
    expect(sha256(canonicalize(manifest.officialTargetCompatibilityEvidence?.find(
      ({ id }) => id === "shopify-ai-toolkit-claude-code-darwin"
    )))).toBe("ff517c3a093e0b8f3b6ed4f009b573cb03bf1f9b93d568b78e22486010db7db8");
    expect(sha256(await readFile(join(projectRoot, "research/evidence/shopify-ai-toolkit-official-source.json")))).toBe(
      "48d58113526b52acd5c087b20ccce425630c9ba8c6f684bb5d26b3e5dca80e61"
    );
    expect(sha256(await readFile(join(projectRoot,
      "research/evidence/artifacts/shopify-ai-toolkit-556811e94dd45c795abe5c0b1bf6b5a4b098149d.json")))).toBe(
      "c40bb7bdb542da9ac5c121e0e2847af1ace09cedc7f898b63423eb39547c579d"
    );

    const revision = manifest.candidateRevisions?.find(({ id }) => id === revisionId);
    expect(revision).toBeDefined();
    expect(revision).toMatchObject({
      previousRevisionId: null,
      candidate: {
        id: "shopify-ai-toolkit",
        candidateRevisionId: revisionId,
        state: "held",
        revisionBinding: "exact",
        officialBaseline: {
          reference: `${observedArtifactPath}#/plugins/230`,
          marketplaceManifestSha256,
          sourceCommit
        }
      },
      approval: {
        disposition: "held",
        reviewerId: "seunghyeon1004",
        sourceCommit,
        marketplaceManifestSha256,
        observedArtifactPath,
        observedArtifactSha256,
        observationEvidenceId,
        evidenceArtifactPath: artifactPath
      }
    });
    expect(revision!.approval.digest).toBe(candidateRevisionDigest(revision!));

    const artifactBytes = await readFile(join(projectRoot, artifactPath));
    expect(revision!.approval.evidenceArtifactSha256).toBe(sha256(artifactBytes));
    const marketplaceEvidence = validateResearchEvidence(JSON.parse(await readFile(
      join(projectRoot, marketplaceEvidencePath), "utf8"
    )));
    expect(marketplaceEvidence).toMatchObject({
      schemaVersion: 3,
      providerId: "anthropic-plugins-official",
      observationEvidenceId,
      reviewedCommit: marketplaceCommit,
      observedArtifactPath,
      observedArtifactSha256,
      observedAt,
      artifactPath,
      artifactSha256: sha256(artifactBytes),
      outcome: "passed"
    });
  });

  it("binds portable current-C audit evidence and preserves exact telemetry and prompt-stash disclosures", async () => {
    const manifest = await decisionManifest(projectRoot);
    const revision = manifest.candidateRevisions?.find(({ id }) => id === revisionId);
    if (revision === undefined) throw new Error("production Shopify revision is missing");
    const artifactBytes = await readFile(join(projectRoot, artifactPath));
    const artifact = JSON.parse(artifactBytes.toString("utf8")) as {
      audit: Record<string, unknown>;
      disclosures: string[];
    };
    const auditBytes = await readFile(join(projectRoot, sourceAuditPath));
    const auditText = auditBytes.toString("utf8");

    expect(artifact.audit).toMatchObject({
      sourceAuditPath,
      sourceAuditSha256: sha256(auditBytes),
      marketplaceCommit,
      marketplaceManifestSha256,
      sourceCommit
    });
    expect(artifact.audit).not.toHaveProperty("implementationTemplatePath");
    expect(Object.values(artifact.audit).filter((value): value is string => typeof value === "string"))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/^\/tmp\//u)]));

    const exactTelemetryCategories = [
      "tool-skill-version",
      "model-client-version-when-supplied",
      "artifact-and-revision-identifiers"
    ];
    const promptStashDisclosures = [
      "local-prompt-stash:${TMPDIR:-/tmp}/shopify-ai-toolkit-telemetry-<uid>/<session>.prompt",
      "local-prompt-stash-mode:0600",
      "local-prompt-stash-retention:pruned-only-on-next-user-prompt-submit-after-24h",
      "local-prompt-stash-reuse:subsequent-shopify-skill-activation",
      "local-prompt-stash-delete-after-transmit:not-immediate"
    ];
    expect(revision.candidate.permissions.value).toEqual(expect.arrayContaining([
      ...exactTelemetryCategories,
      ...promptStashDisclosures
    ]));
    expect(artifact.disclosures).toEqual(expect.arrayContaining([
      ...exactTelemetryCategories.map((category) => `telemetry-data:${category}`),
      ...promptStashDisclosures
    ]));
    for (const category of [...exactTelemetryCategories, ...promptStashDisclosures]) {
      expect(auditText).toContain(category);
    }

    const portableEvidence = [artifactBytes.toString("utf8"), auditText, await readFile(
      join(projectRoot, marketplaceEvidencePath), "utf8"
    )].join("\n");
    expect(portableEvidence).not.toContain("/tmp/shopify-exact-source-audit-2026-08-03.md");
    expect(portableEvidence).not.toContain("/tmp/shopify-held-revision-implementation-template-2026-08-03.yaml");
    expect(portableEvidence).not.toContain("7217edcd2b0922a1f411e9c92b5b4e2eb6d43604");
    expect(portableEvidence).not.toContain("0e80bea852ccd95e7c0e62e391213479df51a62bad170cb51a30b2a414302eb4");
  });

  it("materializes held metadata but emits no Shopify install or approval command for Claude or Codex", async () => {
    const repository = await loadDecisionManifests(projectRoot);
    const candidate = repository.candidates.find(({ id }) => id === "shopify-ai-toolkit");
    expect(candidate).toMatchObject({
      candidateRevisionId: revisionId,
      state: "held",
      revisionBinding: "exact",
      stateReasons: expect.arrayContaining([
        "official-marketplace-selection:review-required",
        "source-drift:556811e94dd45c795abe5c0b1bf6b5a4b098149d->0e06bc35611e505e372de7f8cdf265e6d6dbc311",
        "privacy-telemetry-review:not-complete",
        "install-smoke:not-run",
        "authentication-review:not-complete",
        "cost-review:not-complete",
        "dependency-review:not-complete",
        "trust-review:not-complete",
        "dynamic-install-surface:shopify-cli-at-latest",
        "dynamic-install-surface:hermes-raw-main",
        "dynamic-install-surface:pi-git",
        "dynamic-install-surface:npx-skills-add"
      ])
    });
    expect(candidate).not.toHaveProperty("claudeInstall");
    expect(candidate).not.toHaveProperty("codexInstall");
    expect(candidate?.eligibility?.reviewExpiresAt ?? null).toBeNull();

    const index = JSON.parse(await generateDecisionIndex(projectRoot)) as DecisionIndex;
    expect(index.candidateEvidence.filter(({ candidateId }) => candidateId === candidate?.id)).toHaveLength(3);
    expect(index.starterRoutes?.find(({ domainId }) => domainId === "commerce")?.orderedCandidateIds)
      .toEqual(["windsor-ai"]);
    expect(index.candidates.find(({ id }) => id === "shopify-ai-toolkit")).toEqual(expect.objectContaining({
      state: "held",
      stateReasons: expect.arrayContaining([
        "official-marketplace-selection:review-required",
        "source-drift:556811e94dd45c795abe5c0b1bf6b5a4b098149d->0e06bc35611e505e372de7f8cdf265e6d6dbc311",
        "privacy-telemetry-review:not-complete",
        "install-smoke:not-run",
        "authentication-review:not-complete",
        "authentication-scopes-and-revocation:not-complete",
        "cost-review:not-complete",
        "dependency-review:not-complete",
        "trust-review:not-complete",
        "telemetry-default-on:queries-responses-errors-code-context-optional-prompt",
        "hooks:telemetry-activation",
        "mutation-surface:allow-mutations",
        "preview-store-and-browser-open:not-smoke-tested",
        "dynamic-install-surface:shopify-cli-at-latest",
        "dynamic-install-surface:hermes-raw-main",
        "dynamic-install-surface:pi-git",
        "dynamic-install-surface:npx-skills-add"
      ])
    }));
    expect(index.candidates.find(({ id }) => id === "shopify-ai-toolkit")).not.toHaveProperty("claudeInstall");
    expect(index.candidates.filter(({ claudeInstall }) => claudeInstall !== undefined)).toEqual([]);
    expect(index.candidates.find(({ id }) => id === "windsor-ai")?.stateReasons).toEqual(expect.arrayContaining([
      "marketplace-listed",
      "individual-safety-review:not-complete",
      "official-marketplace-selection:review-required",
      "revision-binding:unavailable",
      "compatibility-inference:official-source-bound",
      "target-verified:claude-code/darwin"
    ]));
    expect(buildDecisionPlan(index, {
      domainIds: ["commerce"], runtime: "codex", platform: "darwin", asOf: index.observedThrough
    })).toMatchObject({ status: "held", primary: null, complement: null });

    for (const riskAcknowledged of [false, true]) {
      const setup = await evaluateSetupDecisionFixture(index, {
        language: "en",
        domainIds: ["commerce"],
        platform: "darwin",
        timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
        riskAcknowledged
      });
      expect(setup).toMatchObject({
        status: "held",
        candidates: [],
        approvalValid: false,
        executionStatus: "not-executed"
      });
      expect(setup.commands).toEqual([
        { kind: "time-probe", candidateId: null, argv: ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"] }
      ]);
    }

    const [rootInstall, managerInstall] = await Promise.all([
      readFile(join(projectRoot, "generated/install-index.json"), "utf8"),
      readFile(join(projectRoot, "plugins/skillset-manager/data/install-index.json"), "utf8")
    ]);
    expect(rootInstall).toBe(managerInstall);
    expect(rootInstall).not.toContain("shopify-ai-toolkit");
  });

  it("rejects a digest-authenticated revision that tampers with the selected C artifact binding", async () => {
    const root = await fixtureRoot();
    const manifest = await decisionManifest(root);
    const revision = manifest.candidateRevisions?.find(({ id }) => id === revisionId);
    if (revision === undefined) throw new Error("production Shopify revision is missing");
    revision.approval.observedArtifactSha256 = "f".repeat(64);
    revision.approval.digest = candidateRevisionDigest(revision);
    await writeFile(join(root, "manifests/decision-candidate-evidence.yaml"), stringify(manifest, { lineWidth: 0 }));

    await expect(loadDecisionManifests(root)).rejects.toThrow(/observed artifact path or SHA|selection chain/i);
  });

  it("rejects a modified repository audit even when the capability artifact bytes are unchanged", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, sourceAuditPath), "tampered audit\n");

    await expect(loadDecisionManifests(root)).rejects.toThrow(/source audit SHA-256 mismatch/i);
  });

  it("rejects a forged held install binding even when the index digest is recomputed", async () => {
    const root = await fixtureRoot();
    const path = join(root, "generated", "decision-index.json");
    const index = JSON.parse(await readFile(path, "utf8")) as DecisionIndex;
    const shopify = index.candidates.find(({ id }) => id === "shopify-ai-toolkit");
    if (shopify === undefined) throw new Error("fixture Shopify candidate is missing");
    shopify.claudeInstall = {
      sourceId: "anthropic-plugins-official",
      pluginName: "shopify-ai-toolkit",
      marketplaceId: "claude-plugins-official",
      marketplaceSource: "anthropics/claude-plugins-official",
      scope: "user",
      argv: ["claude", "plugin", "install", "shopify-ai-toolkit@claude-plugins-official", "--scope", "user"]
    };
    for (const evidence of index.candidateEvidence.filter(({ candidateId }) => candidateId === shopify.id)) {
      evidence.candidate = structuredClone(shopify);
    }
    const { digest: _digest, ...withoutDigest } = index;
    index.digest = decisionIndexDigest(withoutDigest);
    await writeFile(path, `${JSON.stringify(index, null, 2)}\n`);

    await expect(loadDecisionIndex(root)).rejects.toThrow(/ineligible official candidate.*install binding/i);
  });
});

async function decisionManifest(root: string): Promise<DecisionCandidateEvidenceManifest> {
  return parse(await readFile(join(root, "manifests/decision-candidate-evidence.yaml"), "utf8")) as
    DecisionCandidateEvidenceManifest;
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shopify-held-revision-"));
  temporaryRoots.push(root);
  await Promise.all([
    cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true }),
    cp(join(projectRoot, "generated"), join(root, "generated"), { recursive: true })
  ]);
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
