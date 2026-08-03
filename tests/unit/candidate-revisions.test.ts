import { describe, expect, it } from "vitest";

import { validateDecisionCandidateEvidence } from "../../src/contracts/decision.js";
import {
  candidateRevisionDigest,
  resolveCandidateRevisionProjection
} from "../../src/decision/candidate-revisions.js";
import {
  officialMarketplaceCandidateIdentity,
  type OfficialMarketplacePlugin,
  type OfficialMarketplaceSelection
} from "../../src/discovery/official-marketplace.js";
import type {
  CandidateRevision,
  DecisionCandidateEvidenceManifest
} from "../../src/model/decision.js";
import type { ObservedMarketplaceIdentityEvidence } from "../../src/model/complete-v1.js";
import type { ObservationEvidence } from "../../src/model/observation.js";
import type { ReviewerRegistry } from "../../src/model/review-ledger.js";

const oldMarketplaceCommit = "1".repeat(40);
const newMarketplaceCommit = "2".repeat(40);
const nextMarketplaceCommit = "3".repeat(40);
const oldSourceCommit = "4".repeat(40);
const newSourceCommit = "5".repeat(40);
const oldArtifactPath = "claude-plugins-official-old.json";
const newArtifactPath = "claude-plugins-official-new.json";
const nextArtifactPath = "claude-plugins-official-next.json";
const oldArtifactSha = "6".repeat(64);
const newArtifactSha = "7".repeat(64);
const nextArtifactSha = "8".repeat(64);
const auditArtifactPath = "research/evidence/artifacts/shopify-new.json";
const auditArtifactSha = "9".repeat(64);
const revisionId = "shopify-ai-toolkit-revision-new";
const observationId = "anthropic-marketplace-new";

const reviewers: ReviewerRegistry = {
  schemaVersion: 3,
  reviewers: [{ id: "maintainer", roles: ["maintainer"] }]
};

describe("candidate revision contract", () => {
  it("validates an exact append-only tail and projects only its current records", () => {
    const fixture = exactFixture();
    const manifestSha256 = "c".repeat(64);
    const revision = fixture.manifest.candidateRevisions![0]!;
    revision.candidate.officialBaseline!.marketplaceManifestSha256 = manifestSha256;
    revision.approval.marketplaceManifestSha256 = manifestSha256;
    fixture.manifest.evidence.find(({ candidateRevisionId }) => candidateRevisionId === revision.id)!
      .contentSha256 = manifestSha256;
    fixture.context.selection.marketplaceManifestSha256ByPath[newArtifactPath] = manifestSha256;
    revision.approval.digest = candidateRevisionDigest(revision);

    expect(validateDecisionCandidateEvidence(fixture.manifest)).toEqual(fixture.manifest);
    const projection = resolveCandidateRevisionProjection(fixture.manifest, fixture.context);

    expect(projection.quarantinedCandidateIds).toEqual([]);
    expect(projection.candidates).toEqual([expect.objectContaining({
      id: "shopify-ai-toolkit",
      candidateRevisionId: revisionId,
      capabilityEvidenceIds: ["shopify-new-capability"],
      providedCapabilityIds: ["operate-stores-and-marketplaces"]
    })]);
    expect(projection.evidence.map(({ id }) => id)).toEqual(["shopify-new-capability"]);
    expect(projection.officialTargetCompatibilityEvidence.map(({ id }) => id)).toEqual([
      "shopify-new-claude-code-darwin"
    ]);
  });

  it("rejects generated install fields, forks, digest tampering, and unauthorized reviewers", () => {
    const generatedField = exactFixture();
    Object.assign(generatedField.manifest.candidateRevisions![0]!.candidate, {
      claudeInstall: { sourceId: "forged" }
    });
    expect(() => validateDecisionCandidateEvidence(generatedField.manifest)).toThrow(/claudeInstall|additional propert/i);

    const fork = exactFixture();
    const second = structuredClone(fork.manifest.candidateRevisions![0]!);
    second.id = "shopify-ai-toolkit-revision-fork";
    second.candidate.candidateRevisionId = second.id;
    second.approval.digest = candidateRevisionDigest(second);
    fork.manifest.candidateRevisions!.push(second);
    expect(() => resolveCandidateRevisionProjection(fork.manifest, fork.context)).toThrow(/previousRevisionId|fork|tail/i);

    const tampered = exactFixture();
    tampered.manifest.candidateRevisions![0]!.candidate.stateReasons.push("tampered-after-approval");
    expect(() => resolveCandidateRevisionProjection(tampered.manifest, tampered.context)).toThrow(/digest/i);

    const unauthorized = exactFixture();
    unauthorized.manifest.candidateRevisions![0]!.approval.reviewerId = "author";
    unauthorized.manifest.candidateRevisions![0]!.approval.digest = candidateRevisionDigest(
      unauthorized.manifest.candidateRevisions![0]!
    );
    expect(() => resolveCandidateRevisionProjection(unauthorized.manifest, unauthorized.context)).toThrow(/reviewer|authority/i);
  });

  it("requires a revision review to bind the latest observation within the catalog epoch", () => {
    const beforeObservation = exactFixture();
    beforeObservation.manifest.candidateRevisions![0]!.approval.reviewedAt = "2026-08-01T23:59:59Z";
    beforeObservation.manifest.candidateRevisions![0]!.approval.digest = candidateRevisionDigest(
      beforeObservation.manifest.candidateRevisions![0]!
    );
    expect(() => resolveCandidateRevisionProjection(beforeObservation.manifest, beforeObservation.context))
      .toThrow(/review timestamp|observation/i);

    const staleObservation = exactFixture();
    staleObservation.context.latestObservationEvidenceIdBySource = {
      "anthropic-plugins-official": "newer-observation"
    };
    expect(() => resolveCandidateRevisionProjection(staleObservation.manifest, staleObservation.context))
      .toThrow(/observation.*binding/i);

    const afterCatalogEpoch = exactFixture();
    afterCatalogEpoch.context.asOf = "2026-08-02T23:59:59Z";
    expect(() => resolveCandidateRevisionProjection(afterCatalogEpoch.manifest, afterCatalogEpoch.context))
      .toThrow(/review timestamp|catalog asOf/i);
  });

  it("quarantines unreviewed official drift without retaining install, coverage, evidence, compatibility, or routes", () => {
    const fixture = exactFixture();
    delete fixture.manifest.candidateRevisions;
    fixture.manifest.evidence = fixture.manifest.evidence.filter((item) => item.candidateRevisionId === undefined);
    fixture.manifest.officialTargetCompatibilityEvidence = fixture.manifest.officialTargetCompatibilityEvidence!
      .filter((item) => item.candidateRevisionId === undefined);
    fixture.context.selection = selection({
      state: "review-required",
      approvedPath: oldArtifactPath,
      approvedSha: oldArtifactSha,
      approvedMarketplaceCommit: oldMarketplaceCommit,
      approvedSourceCommit: oldSourceCommit,
      observedPath: newArtifactPath,
      observedSha: newArtifactSha,
      observedMarketplaceCommit: newMarketplaceCommit,
      observedSourceCommit: newSourceCommit
    });

    const projection = resolveCandidateRevisionProjection(fixture.manifest, fixture.context);
    const candidate = projection.candidates[0]!;

    expect(projection.quarantinedCandidateIds).toEqual(["shopify-ai-toolkit"]);
    expect(candidate).toMatchObject({
      state: "held",
      providedCapabilityIds: [],
      capabilityEvidenceIds: [],
      revisionBinding: "unavailable"
    });
    expect(candidate.stateReasons).toContain("source-drift:unreviewed");
    expect(candidate).not.toHaveProperty("officialBaseline");
    expect(candidate).not.toHaveProperty("claudeInstall");
    expect(projection.evidence).toEqual([]);
    expect(projection.officialTargetCompatibilityEvidence).toEqual([]);
  });

  it("returns an exact held rebind to quarantine on the next observed pin", () => {
    const fixture = exactFixture();
    fixture.context.selection = selection({
      state: "review-required",
      approvedPath: newArtifactPath,
      approvedSha: newArtifactSha,
      approvedMarketplaceCommit: newMarketplaceCommit,
      approvedSourceCommit: newSourceCommit,
      observedPath: nextArtifactPath,
      observedSha: nextArtifactSha,
      observedMarketplaceCommit: nextMarketplaceCommit,
      observedSourceCommit: "a".repeat(40)
    });
    fixture.context.selection.artifactSha256ByPath[oldArtifactPath] = oldArtifactSha;

    const projection = resolveCandidateRevisionProjection(fixture.manifest, fixture.context);

    expect(projection.quarantinedCandidateIds).toEqual(["shopify-ai-toolkit"]);
    expect(projection.candidates[0]!.stateReasons).toEqual(expect.arrayContaining([
      "source-drift:unreviewed",
      `source-drift:${newSourceCommit}->${"a".repeat(40)}`
    ]));
    expect(projection.evidence).toEqual([]);
  });

  it("does not quarantine a base candidate when only an unrelated marketplace entry changed", () => {
    const fixture = exactFixture();
    delete fixture.manifest.candidateRevisions;
    fixture.manifest.evidence = fixture.manifest.evidence.filter((item) => item.candidateRevisionId === undefined);
    fixture.manifest.officialTargetCompatibilityEvidence = fixture.manifest.officialTargetCompatibilityEvidence!
      .filter((item) => item.candidateRevisionId === undefined);
    fixture.context.selection = selection({
      state: "review-required",
      approvedPath: oldArtifactPath,
      approvedSha: oldArtifactSha,
      approvedMarketplaceCommit: oldMarketplaceCommit,
      approvedSourceCommit: oldSourceCommit,
      observedPath: newArtifactPath,
      observedSha: newArtifactSha,
      observedMarketplaceCommit: newMarketplaceCommit,
      observedSourceCommit: oldSourceCommit
    });
    fixture.context.selection.selectedChanges = [{ name: "exa", status: "changed" }];

    const projection = resolveCandidateRevisionProjection(fixture.manifest, fixture.context);

    expect(projection.quarantinedCandidateIds).toEqual([]);
    expect(projection.candidates[0]!.capabilityEvidenceIds).toEqual(["shopify-old-capability"]);
    expect(projection.evidence.map(({ id }) => id)).toEqual(["shopify-old-capability"]);
  });

  it.each([
    ["description", (plugin: OfficialMarketplacePlugin) => { plugin.description += " changed"; }],
    ["github repo", (plugin: OfficialMarketplacePlugin) => {
      if (typeof plugin.source === "string" || plugin.source.source !== "github") throw new Error("expected github source");
      plugin.source.repo = "attacker/Shopify-AI-Toolkit";
    }],
    ["github commit", (plugin: OfficialMarketplacePlugin) => {
      if (typeof plugin.source === "string" || plugin.source.source !== "github") throw new Error("expected github source");
      plugin.source.commit = "b".repeat(40);
    }],
    ["source pin", (plugin: OfficialMarketplacePlugin) => { plugin.sourcePin.sha = "c".repeat(40); }]
  ] as const)("quarantines exact %s identity drift even when the install pin can appear unchanged", (_label, mutate) => {
    const fixture = baseOnlyFixture();
    const observed = fixture.context.selection.observedArtifact.plugins[0]!;
    mutate(observed);

    const projection = resolveCandidateRevisionProjection(fixture.manifest, fixture.context);

    expectQuarantined(projection);
  });

  it.each([
    [
      "url path",
      { source: "url", url: "https://example.test/plugin.git", path: "skills/one", sha: oldSourceCommit },
      { source: "url", url: "https://example.test/plugin.git", path: "skills/two", sha: oldSourceCommit }
    ],
    [
      "git-subdir path",
      { source: "git-subdir", url: "https://example.test/plugin.git", path: "skills/one", ref: "main", sha: oldSourceCommit },
      { source: "git-subdir", url: "https://example.test/plugin.git", path: "skills/two", ref: "main", sha: oldSourceCommit }
    ],
    [
      "git-subdir ref",
      { source: "git-subdir", url: "https://example.test/plugin.git", path: "skills/one", ref: "main", sha: oldSourceCommit },
      { source: "git-subdir", url: "https://example.test/plugin.git", path: "skills/one", ref: "release", sha: oldSourceCommit }
    ],
    ["relative path", "./plugins/shopify", "./plugins/shopify-renamed"]
  ] as const)("quarantines exact %s coordinate drift", (_label, approvedSource, observedSource) => {
    const fixture = baseOnlyFixture();
    const approved = fixture.context.selection.approvedArtifact.plugins[0]!;
    const observed = fixture.context.selection.observedArtifact.plugins[0]!;
    approved.source = structuredClone(approvedSource) as OfficialMarketplacePlugin["source"];
    observed.source = structuredClone(observedSource) as OfficialMarketplacePlugin["source"];
    if (typeof approvedSource === "string") {
      approved.sourcePin = { kind: "marketplace-commit", sha: oldMarketplaceCommit };
      observed.sourcePin = { kind: "marketplace-commit", sha: oldMarketplaceCommit };
      fixture.manifest.candidates[0]!.officialBaseline!.sourceUrl = approved.provenance.jsonPointer.includes("plugins")
        ? fixture.context.selection.approvedArtifact.provenance.repository
        : "unreachable";
      fixture.manifest.candidates[0]!.officialBaseline!.sourceCommit = oldMarketplaceCommit;
    } else {
      approved.sourcePin = { kind: "external-sha", sha: oldSourceCommit };
      observed.sourcePin = { kind: "external-sha", sha: oldSourceCommit };
      fixture.manifest.candidates[0]!.officialBaseline!.sourceUrl = approvedSource.url;
      fixture.manifest.candidates[0]!.officialBaseline!.sourceCommit = oldSourceCommit;
    }

    const projection = resolveCandidateRevisionProjection(fixture.manifest, fixture.context);

    expectQuarantined(projection);
  });
});

function baseOnlyFixture(): ReturnType<typeof exactFixture> {
  const fixture = exactFixture();
  delete fixture.manifest.candidateRevisions;
  fixture.manifest.evidence = fixture.manifest.evidence.filter((item) => item.candidateRevisionId === undefined);
  fixture.manifest.officialTargetCompatibilityEvidence = fixture.manifest.officialTargetCompatibilityEvidence!
    .filter((item) => item.candidateRevisionId === undefined);
  fixture.context.selection = selection({
    state: "review-required",
    approvedPath: oldArtifactPath,
    approvedSha: oldArtifactSha,
    approvedMarketplaceCommit: oldMarketplaceCommit,
    approvedSourceCommit: oldSourceCommit,
    observedPath: newArtifactPath,
    observedSha: newArtifactSha,
    observedMarketplaceCommit: oldMarketplaceCommit,
    observedSourceCommit: oldSourceCommit
  });
  return fixture;
}

function expectQuarantined(projection: ReturnType<typeof resolveCandidateRevisionProjection>): void {
  expect(projection.quarantinedCandidateIds).toEqual(["shopify-ai-toolkit"]);
  expect(projection.candidates[0]).toMatchObject({
    state: "held",
    providedCapabilityIds: [],
    capabilityEvidenceIds: []
  });
  expect(projection.candidates[0]).not.toHaveProperty("claudeInstall");
  expect(projection.evidence).toEqual([]);
  expect(projection.officialTargetCompatibilityEvidence).toEqual([]);
}

function exactFixture(): {
  manifest: DecisionCandidateEvidenceManifest;
  context: Parameters<typeof resolveCandidateRevisionProjection>[1];
} {
  const baseCandidate = candidate({
    sourceCommit: oldSourceCommit,
    artifactPath: oldArtifactPath,
    artifactSha: oldArtifactSha,
    evidenceIds: ["shopify-old-capability"]
  });
  const revisionCandidate = {
    ...candidate({
      sourceCommit: newSourceCommit,
      artifactPath: newArtifactPath,
      artifactSha: newArtifactSha,
      evidenceIds: ["shopify-new-capability"]
    }),
    candidateRevisionId: revisionId
  };
  const revision: CandidateRevision = {
    id: revisionId,
    candidateId: "shopify-ai-toolkit",
    previousRevisionId: null,
    candidate: revisionCandidate,
    approval: {
      kind: "exact-candidate-rebind",
      disposition: "held",
      reviewerId: "maintainer",
      reviewedAt: "2026-08-03T00:00:00Z",
      sourceCommit: newSourceCommit,
      marketplaceManifestSha256: newArtifactSha,
      candidateIdentity: officialMarketplaceCandidateIdentity(
        marketplace(newMarketplaceCommit, newArtifactSha, newSourceCommit).plugins[0]!
      ),
      observedArtifactPath: `research/marketplaces/${newArtifactPath}`,
      observedArtifactSha256: newArtifactSha,
      observationEvidenceId: observationId,
      evidenceArtifactPath: auditArtifactPath,
      evidenceArtifactSha256: auditArtifactSha,
      evidenceIds: ["shopify-new-capability"],
      digest: "0".repeat(64)
    }
  };
  revision.approval.digest = candidateRevisionDigest(revision);
  const manifest: DecisionCandidateEvidenceManifest = {
    schemaVersion: 3,
    candidates: [baseCandidate],
    candidateRevisions: [revision],
    evidence: [
      capabilityEvidence("shopify-old-capability", oldArtifactPath, oldArtifactSha),
      {
        ...capabilityEvidence("shopify-new-capability", newArtifactPath, newArtifactSha),
        candidateRevisionId: revisionId,
        artifactPath: auditArtifactPath,
        artifactSha256: auditArtifactSha
      }
    ],
    officialTargetCompatibilityEvidence: [
      compatibilityEvidence("shopify-old-claude-code-darwin", oldSourceCommit),
      {
        ...compatibilityEvidence("shopify-new-claude-code-darwin", newSourceCommit),
        candidateRevisionId: revisionId
      }
    ]
  };
  const observation = observationEvidence();
  const observedMarketplaceEvidence: ObservedMarketplaceIdentityEvidence = {
    schemaVersion: 3,
    id: "shopify-observed-marketplace-binding",
    reviewId: "shopify-rebind-review",
    providerId: "anthropic-plugins-official",
    kind: "marketplace-identity",
    observationEvidenceId: observation.id,
    reviewedCommit: newMarketplaceCommit,
    observedArtifactPath: `research/marketplaces/${newArtifactPath}`,
    observedArtifactSha256: newArtifactSha,
    scope: { runtime: null, platform: null, capabilityId: null },
    observedAt: observation.observedAt,
    artifactPath: auditArtifactPath,
    artifactSha256: auditArtifactSha,
    outcome: "passed",
    summary: "Exact held candidate rebind; not an install or safety approval."
  };
  return {
    manifest,
    context: {
      selection: selection({
        state: "current",
        approvedPath: newArtifactPath,
        approvedSha: newArtifactSha,
        approvedMarketplaceCommit: newMarketplaceCommit,
        approvedSourceCommit: newSourceCommit,
        observedPath: newArtifactPath,
        observedSha: newArtifactSha,
        observedMarketplaceCommit: newMarketplaceCommit,
        observedSourceCommit: newSourceCommit
      }),
      asOf: "2026-08-03T00:00:00Z",
      reviewers,
      observationEvidence: [observation],
      latestObservationEvidenceIdBySource: {
        "anthropic-plugins-official": observation.id
      },
      observedMarketplaceEvidence: [observedMarketplaceEvidence],
      artifactSha256ByPath: { [auditArtifactPath]: auditArtifactSha }
    }
  };
}

function candidate(input: {
  sourceCommit: string;
  artifactPath: string;
  artifactSha: string;
  evidenceIds: string[];
}) {
  return {
    id: "shopify-ai-toolkit",
    sourceId: "anthropic-plugins-official",
    skillPath: null,
    runtime: "claude-code" as const,
    state: "held" as const,
    stateReasons: ["marketplace-listed", "individual-safety-review:not-complete"],
    providedCapabilityIds: ["operate-stores-and-marketplaces"],
    capabilityEvidenceIds: input.evidenceIds,
    revisionBinding: "unavailable" as const,
    permissions: { status: "unknown" as const, evidence: [] },
    license: { status: "unknown" as const, evidence: [] },
    trust: { status: "unknown" as const, evidence: [] },
    dependencies: { status: "unknown" as const, evidence: [] },
    officialBaseline: {
      reference: `research/marketplaces/${input.artifactPath}#/plugins/0`,
      marketplaceManifestSha256: input.artifactSha,
      pluginName: "shopify-ai-toolkit",
      sourceUrl: "https://github.com/Shopify/Shopify-AI-Toolkit.git",
      sourceCommit: input.sourceCommit,
      sourceBlobs: []
    }
  };
}

function capabilityEvidence(id: string, artifactPath: string, artifactSha: string) {
  return {
    id,
    candidateId: "shopify-ai-toolkit",
    capabilityId: "operate-stores-and-marketplaces",
    kind: "official-baseline" as const,
    current: true,
    reference: `research/marketplaces/${artifactPath}#/plugins/0`,
    contentSha256: artifactSha,
    support: "direct" as const,
    sourceBlobs: []
  };
}

function compatibilityEvidence(id: string, sourceCommit: string) {
  const snapshot = {
    id: `${id}-snapshot`,
    sourceUrl: "https://github.com/anthropics/claude-plugins-official",
    marketplaceEntryUrl: `https://github.com/anthropics/claude-plugins-official/blob/${newMarketplaceCommit}/.claude-plugin/marketplace.json`,
    marketplaceEntrySourceUrl: "https://github.com/Shopify/Shopify-AI-Toolkit.git",
    marketplaceEntrySourceCommit: sourceCommit,
    digest: "a".repeat(64)
  };
  return {
    id,
    candidateId: "shopify-ai-toolkit",
    sourceId: "anthropic-plugins-official",
    runtime: "claude-code" as const,
    platform: "darwin" as const,
    compatibility: "verified" as const,
    kind: "official-source-bound-inference" as const,
    observedAt: "2026-08-03T00:00:00Z",
    reviewedAt: "2026-08-03T00:00:00Z",
    expiresAt: "2026-08-04T00:00:00Z",
    snapshot,
    sourceUrls: [
      snapshot.marketplaceEntryUrl,
      snapshot.marketplaceEntrySourceUrl,
      "https://code.claude.com/docs/en/overview"
    ],
    disclosures: [
      "compatibility-inference:not-install-smoke",
      "individual-safety-review:not-complete",
      "target-unknown:claude-code/linux"
    ],
    evidenceDigest: "b".repeat(64)
  };
}

function observationEvidence(): ObservationEvidence {
  return {
    schemaVersion: 3,
    id: observationId,
    sourceId: "anthropic-plugins-official",
    observedAt: "2026-08-03T00:00:00Z",
    inspectedCommit: newMarketplaceCommit,
    blobs: [],
    fields: {
      license: { status: "unknown", evidence: [] },
      permissions: { status: "unknown", evidence: [] },
      ownership: { status: "unknown", evidence: [] },
      dependencies: { status: "unknown", evidence: [] },
      executableSurface: { status: "unknown", evidence: [] }
    }
  };
}

function selection(input: {
  state: "current" | "review-required";
  approvedPath: string;
  approvedSha: string;
  approvedMarketplaceCommit: string;
  approvedSourceCommit: string;
  observedPath: string;
  observedSha: string;
  observedMarketplaceCommit: string;
  observedSourceCommit: string;
}): OfficialMarketplaceSelection {
  const approvedArtifact = marketplace(input.approvedMarketplaceCommit, input.approvedSha, input.approvedSourceCommit);
  const observedArtifact = marketplace(input.observedMarketplaceCommit, input.observedSha, input.observedSourceCommit);
  return {
    state: input.state,
    observedAt: "2026-08-03T00:00:00Z",
    approvedArtifactPath: input.approvedPath,
    approvedArtifactSha256: input.approvedSha,
    observedArtifactPath: input.observedPath,
    observedArtifactSha256: input.observedSha,
    approvedArtifact,
    observedArtifact,
    artifactByPath: {
      [input.approvedPath]: approvedArtifact,
      [input.observedPath]: observedArtifact
    },
    artifactObservedAtByPath: {
      [input.approvedPath]: "2026-08-03T00:00:00Z",
      [input.observedPath]: "2026-08-03T00:00:00Z"
    },
    approvedArtifactPaths: [oldArtifactPath, input.approvedPath],
    artifactSha256ByPath: {
      [oldArtifactPath]: oldArtifactSha,
      [input.approvedPath]: input.approvedSha,
      [input.observedPath]: input.observedSha
    },
    marketplaceManifestSha256ByPath: {
      [oldArtifactPath]: oldArtifactSha,
      [input.approvedPath]: input.approvedSha,
      [input.observedPath]: input.observedSha
    },
    selectedChanges: input.state === "review-required"
      ? [{ name: "shopify-ai-toolkit", status: "changed" }]
      : [],
    protectedCandidateNames: ["shopify-ai-toolkit"],
    chain: ["selection.json"]
  };
}

function marketplace(marketplaceCommit: string, manifestSha256: string, sourceCommit: string) {
  return {
    schemaVersion: 1 as const,
    marketplace: "claude-plugins-official" as const,
    provenance: {
      repository: "https://github.com/anthropics/claude-plugins-official",
      inspectedCommit: marketplaceCommit,
      manifestPath: ".claude-plugin/marketplace.json",
      manifestSha256,
      sourceUrl: `https://raw.githubusercontent.com/anthropics/claude-plugins-official/${marketplaceCommit}/.claude-plugin/marketplace.json`
    },
    plugins: [{
      name: "shopify-ai-toolkit",
      description: "Shopify tools",
      source: {
        source: "github" as const,
        repo: "Shopify/Shopify-AI-Toolkit",
        commit: sourceCommit,
        sha: sourceCommit
      },
      provenance: { jsonPointer: "/plugins/0" },
      sourcePin: { kind: "external-sha" as const, sha: sourceCommit }
    }]
  };
}
