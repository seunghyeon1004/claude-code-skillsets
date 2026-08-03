import { describe, expect, it } from "vitest";
import { validateProvider, validateProviderSelection, validateSourceReview } from "../../src/contracts/complete-v1.js";
import { HARD_GATE_IDS, SCORE_CRITERIA, type CapabilityCollectionManifest, type CatalogContract, type ProviderManifest, type ProviderSelectionManifest, type ScoreCriterionId, type SourceReviewManifest } from "../../src/model/complete-v1.js";
import type { DomainManifest, PermissionDeclaration } from "../../src/model/manifest.js";
import type { InstallIndex } from "../../src/model/install-index.js";
import type { CompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import type { DiscoveryIndex } from "../../src/discovery/broker.js";
import { prepareReviewedInstallPreview, type ReviewedPrepareRepository } from "../../src/discovery/prepare.js";

const domainId = "software-engineering" as const;
const providerId = "reviewed-catalog";
const reviewId = "reviewed-catalog-review";
const capabilityId = "repository-context-analysis";
const pluginId = "catalog-tools";
const reviewedCommit = "0123456789abcdef0123456789abcdef01234567";
const repositoryUrl = "https://github.com/example/catalog-tools";
const selectedPath = "skills/catalog/SKILL.md";
const marketplaceId = "official-marketplace";
const marketplaceSource = "https://github.com/example/marketplace";

describe("prepareReviewedInstallPreview", () => {
  it("returns a command preview only for a selected provider anchored to review, discovery provenance, and generated profile", () => {
    const fixture = reviewedFixture();

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.providerIds).toEqual([providerId]);
    expect(result.profileIds).toEqual(["software-engineering-reviewed"]);
    expect(result.plan.operations).toEqual([
      {
        kind: "marketplace-add",
        command: "claude plugin marketplace add https://github.com/example/marketplace --scope user",
        marketplace: marketplaceId,
        marketplaceSource
      },
      {
        kind: "verify-marketplace",
        command: "claude plugin marketplace list --json",
        marketplace: marketplaceId,
        marketplaceSource
      },
      {
        kind: "install",
        command: "claude plugin install catalog-tools@official-marketplace --scope user",
        pluginId,
        marketplace: marketplaceId
      },
      {
        kind: "verify-version",
        command: "claude plugin list --json",
        pluginId,
        marketplace: marketplaceId,
        reviewedVersion: "1.0.0"
      }
    ]);
  });

  it("uses formal-contract-valid provider, review, and selected-provider fixtures", () => {
    const fixture = reviewedFixture();

    expect(validateProvider(fixture.input.repository.providers[0])).toEqual(fixture.input.repository.providers[0]);
    expect(validateSourceReview(fixture.input.repository.sourceReviews[0])).toEqual(fixture.input.repository.sourceReviews[0]);
    expect(validateProviderSelection(fixture.input.repository.providerSelections[0])).toEqual(
      fixture.input.repository.providerSelections[0]
    );
  });

  it("holds an unreviewed raw discovery candidate instead of turning it into an install operation", () => {
    const fixture = reviewedFixture();
    fixture.input.repository.sourceReviews = [];

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Selected provider reviewed-catalog has no source review reviewed-catalog-review."]
    });
  });

  it("holds when the provider selection is not explicitly selected", () => {
    const fixture = reviewedFixture();
    fixture.input.repository.providerSelections[0]!.disposition = "alternate";

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["No selected provider selection targets domain software-engineering for claude-code/darwin."]
    });
  });

  it("holds a selected provider selection that violates the no-terminal-review contract", () => {
    const fixture = reviewedFixture();
    fixture.input.repository.providerSelections[0]!.terminalReviewIds = [reviewId];

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Selected provider selection catalog-selection must not include terminal reviews."]
    });
  });

  it("holds an otherwise selected provider when its source review is missing a mandatory hard gate", () => {
    const fixture = reviewedFixture();
    fixture.input.repository.sourceReviews[0]!.capabilityTargetReviews[0]!.hardGates = [];

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Source review reviewed-catalog-review is not eligible for repository-context-analysis on claude-code/darwin."]
    });
  });

  it("holds a selection whose reviewed commit is not represented by the discovered candidate", () => {
    const fixture = reviewedFixture();
    fixture.input.discoveryIndex.contracts[0]!.observations[0]!.observedCommit = "f".repeat(40);
    fixture.input.discoveryIndex.contracts[0]!.observed.observedCommit = "f".repeat(40);

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Source review reviewed-catalog-review has no discovery observation matching its reviewed repository, path, commit, and snapshot."]
    });
  });

  it("holds when the reviewed snapshot is not the snapshot of the matching discovery observation", () => {
    const fixture = reviewedFixture();
    fixture.input.repository.sourceReviews[0]!.snapshotIds = ["different-snapshot"];

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Source review reviewed-catalog-review has no discovery observation matching its reviewed repository, path, commit, and snapshot."]
    });
  });

  it("holds when a review path and runtime artifact do not point to the same discovery observation", () => {
    const fixture = reviewedFixture();
    fixture.input.repository.sourceReviews[0]!.selectedPaths.push("skills/other/SKILL.md");
    fixture.input.repository.providers[0]!.runtimeContracts[0]!.artifacts = [{
      path: "skills/other/SKILL.md",
      sha256: "1".repeat(64)
    }];

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Source review reviewed-catalog-review has no discovery observation matching its reviewed repository, path, commit, and snapshot."]
    });
  });

  it("holds a profile that names the reviewed plugin but has no selected capability purpose anchor", () => {
    const fixture = reviewedFixture();
    fixture.input.installIndex.domains[0]!.purposeIds.push("unlinked-purpose");
    fixture.input.installIndex.profiles[0]!.purposeIds = ["unlinked-purpose"];

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Generated profile software-engineering-reviewed purpose unlinked-purpose is not anchored to a selected provider capability."]
    });
  });

  it("holds when the reviewed observed version differs from provider and generated plugin versions", () => {
    const fixture = reviewedFixture();
    fixture.input.repository.sourceReviews[0]!.observedVersion = "1.0.1";

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Source review reviewed-catalog-review observed version does not match provider reviewed-catalog version 1.0.0."]
    });
  });

  it("holds when generated external reviewedVersion differs from the reviewed provider version", () => {
    const fixture = reviewedFixture();
    fixture.input.installIndex.plugins[0]!.reviewedVersion = "1.0.1";

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Generated plugin catalog-tools does not preserve the reviewed version 1.0.0 for provider reviewed-catalog."]
    });
  });

  it("holds when a generated domain profile would add an unanchored plugin", () => {
    const fixture = reviewedFixture();
    fixture.input.installIndex.profiles[0]!.requiredPlugins.push("raw-plugin");
    fixture.input.installIndex.plugins.push({
      ...fixture.input.installIndex.plugins[0]!,
      id: "raw-plugin",
      installCommand: "claude plugin install raw-plugin@official-marketplace --scope user"
    });

    const result = prepareReviewedInstallPreview(fixture.input);

    expect(result).toEqual({
      status: "held",
      domainId,
      reasons: ["Generated profile software-engineering-reviewed includes plugin raw-plugin without an eligible reviewed selected-provider anchor."]
    });
  });
});

function reviewedFixture(): {
  input: {
    selectedDomainId: typeof domainId;
    discoveryIndex: DiscoveryIndex;
    repository: ReviewedPrepareRepository;
    installIndex: InstallIndex;
  };
} {
  const permissions: PermissionDeclaration = {
    filesystem: [],
    commands: [],
    network: [],
    externalData: []
  };
  const domain: DomainManifest = {
    id: domainId,
    name: { ko: "소프트웨어 엔지니어링", en: "Software Engineering" },
    description: { ko: "테스트", en: "Tests" },
    categories: ["software-development"],
    languages: ["ko", "en"],
    regions: ["global"],
    maintainers: ["private-v1"],
    version: "1.0.0",
    status: "stable"
  };
  const capability: CapabilityCollectionManifest = {
    schemaVersion: 2,
    domainId,
    capabilities: [{
      id: capabilityId,
      ownerDomainId: domainId,
      categoryIds: ["software-development"],
      outcome: { ko: "저장소 분석", en: "Repository analysis" },
      status: "stable"
    }]
  };
  const completeV1: CompleteV1Repository = {
    catalog: {
      schemaVersion: 2,
      releaseTarget: "complete-private-v1",
      domainIds: [domainId],
      categoryIds: ["software-development"],
      capabilityIds: [capabilityId],
      initialPackIds: [],
      replacements: []
    } satisfies CatalogContract,
    domains: [domain],
    categoryCollections: [{
      schemaVersion: 2,
      domainId,
      categories: [{
        id: "software-development",
        name: { ko: "개발", en: "Development" },
        description: { ko: "개발", en: "Development" },
        status: "stable"
      }]
    }],
    capabilityCollections: [capability],
    packs: []
  };
  const provider: ProviderManifest = {
    schemaVersion: 2,
    id: providerId,
    capabilityIds: [capabilityId],
    sourceReviewId: reviewId,
    permissions,
    version: "1.0.0",
    status: "stable",
    trustTier: "trusted",
    runtimeContracts: [{
      runtime: "claude-code",
      packaging: "native-plugin",
      runtimeVersionRange: ">=1.0.0",
      platforms: ["darwin"],
      marketplaceId,
      marketplaceSource,
      pluginId,
      reviewedCommit,
      artifacts: [{ path: selectedPath, sha256: "0".repeat(64) }]
    }]
  };
  const sourceReview: SourceReviewManifest = {
    schemaVersion: 2,
    id: reviewId,
    providerId,
    candidateId: "catalog-candidate",
    searchRecordIds: ["catalog-search"],
    snapshotIds: ["catalog-snapshot"],
    discoveryTier: "A",
    originalRepository: repositoryUrl,
    selectedPaths: [selectedPath],
    reviewedCommit,
    reviewedAt: "2026-07-27T00:00:00Z",
    marketplaceIdentity: { id: marketplaceId, source: marketplaceSource },
    observedVersion: "1.0.0",
    licenseConclusion: "usable",
    lastMeaningfulChange: "2026-07-26",
    surfaces: { skills: [selectedPath], commands: [], agents: [], hooks: [], mcpServers: [], scripts: [], binaries: [] },
    permissions,
    secretFlows: [],
    compatibility: [{ runtime: "claude-code", runtimeVersionRange: ">=1.0.0", platforms: ["darwin"] }],
    linkedDomainIds: [domainId],
    linkedCategoryIds: ["software-development"],
    linkedPackIds: ["repository-to-implementation-plan"],
    capabilityIds: [capabilityId],
    removalStrategy: "remove plugin",
    evidenceIds: ["catalog-evidence"],
    capabilityTargetReviews: [{
      runtime: "claude-code",
      platform: "darwin",
      capabilityId,
      decision: "eligible",
      assuranceProfiles: ["high-impact", "standard"],
      hardGates: HARD_GATE_IDS.map((id) => ({ id, passed: true, evidenceRefs: ["catalog-evidence"] })),
      evidenceIds: ["catalog-evidence"],
      scoreCriteria: (Object.keys(SCORE_CRITERIA) as ScoreCriterionId[])
        .sort()
        .map((id) => ({ id, evidenceRefs: ["catalog-evidence"] })),
      score: {
        outcomeFitAndDepth: 10,
        securityAndTransparency: 10,
        maintenanceAndUpdateability: 10,
        nativeInstallability: 10,
        documentationAndEvaluation: 10
      },
      decisionReasons: ["reviewed"]
    }],
    updatePolicy: "review before update",
    nextReviewDate: "2026-08-27"
  };
  const selection: ProviderSelectionManifest = {
    schemaVersion: 2,
    id: "catalog-selection",
    capabilityId,
    runtime: "claude-code",
    platform: "darwin",
    searchRecordId: "catalog-search",
    disposition: "selected",
    preferredProviderId: providerId,
    alternateProviderIds: [],
    terminalReviewIds: [],
    decisionReasons: ["reviewed selection"],
    releaseEvidence: "trialed-p04"
  };
  const discoveryIndex: DiscoveryIndex = {
    status: "held",
    sourceCount: 1,
    contractCount: 1,
    visibleCandidateCount: 1,
    classifiedCount: 1,
    unclassifiedCount: 0,
    geminiOnlyCount: 0,
    provenance: {
      digest: "provenance",
      classifierVersion: "test",
      observedFrom: "2026-07-27T00:00:00Z",
      observedThrough: "2026-07-27T00:00:00Z",
      observedCommits: [reviewedCommit],
      snapshotDigests: [{ snapshotId: "catalog-snapshot", sha256: "0".repeat(64) }],
      taxonomyFileDigests: []
    },
    sources: [],
    contracts: [{
      status: "discovered-unreviewed",
      visibility: "default",
      canonicalOriginalSource: { repositoryUrl, resolution: "snapshot-root", evidence: [repositoryUrl] },
      observed: {
        repositoryUrl,
        selectedSkillPath: selectedPath,
        snapshotId: "catalog-snapshot",
        observedCommit: reviewedCommit,
        observedAt: "2026-07-27T00:00:00Z",
        snapshotDigest: "0".repeat(64)
      },
      observations: [{
        repositoryUrl,
        selectedSkillPath: selectedPath,
        snapshotId: "catalog-snapshot",
        observedCommit: reviewedCommit,
        observedAt: "2026-07-27T00:00:00Z",
        snapshotDigest: "0".repeat(64)
      }],
      skillSlug: "catalog",
      lineageEvidence: [],
      lineageEvidenceTotal: 0,
      platformEvidence: {
        claudeCode: { state: "unknown", evidence: [] },
        codex: { state: "unknown", evidence: [] },
        gemini: { state: "unknown", evidence: [] }
      },
      collision: {
        disposition: "none",
        sameSlugCandidateCount: 1,
        observedRepositories: [repositoryUrl],
        reason: "single candidate"
      },
      provenanceDigest: "candidate-provenance",
      classification: {
        domainIds: [domainId],
        scores: [{ domainId, score: 100 }],
        reasons: [{ domainId, alias: "catalog", strength: "strong", scope: "skill-slug", score: 100 }]
      }
    }],
    domains: [{
      id: domainId,
      name: { ko: "소프트웨어 엔지니어링", en: "Software Engineering" },
      status: "held",
      candidateCount: 1,
      sourceCount: 1,
      candidates: []
    }]
  };
  const installIndex: InstallIndex = {
    schemaVersion: 1,
    indexFingerprint: `sha256:${"0".repeat(64)}`,
    marketplace: { id: "claude-code-skillsets", source: "seunghyeon1004/claude-code-skillsets" },
    domains: [{
      id: domainId,
      name: { ko: "소프트웨어 엔지니어링", en: "Software Engineering" },
      description: { ko: "테스트", en: "Tests" },
      purposeIds: ["software-development"],
      profileIds: ["software-engineering-reviewed"]
    }],
    profiles: [{
      id: "software-engineering-reviewed",
      labels: { ko: "검토된 개발", en: "Reviewed engineering" },
      domainIds: [domainId],
      purposeIds: ["software-development"],
      toolIds: [],
      requiredPlugins: [pluginId],
      recommendedPlugins: [],
      optionalPlugins: [],
      executables: [],
      version: "1.0.0",
      status: "stable"
    }],
    availability: [],
    researchPendingPacks: [],
    executables: [],
    plugins: [{
      id: pluginId,
      name: { ko: "카탈로그", en: "Catalog" },
      version: "1.0.0",
      source: repositoryUrl,
      marketplace: marketplaceId,
      trustTier: "trusted",
      permissions,
      requiredDependencies: [],
      installCommand: "claude plugin install catalog-tools@official-marketplace --scope user",
      kind: "external",
      license: "Apache-2.0",
      marketplaceSource,
      marketplaceAddCommand: "claude plugin marketplace add https://github.com/example/marketplace --scope user",
      reviewedVersion: "1.0.0",
      versionPinSupported: false,
      verificationCommand: "claude plugin list --json"
    }]
  };

  return {
    input: {
      selectedDomainId: domainId,
      discoveryIndex,
      repository: {
        completeV1,
        providers: [provider],
        sourceReviews: [sourceReview],
        providerSelections: [selection]
      },
      installIndex
    }
  };
}
