import { describe, expect, it } from "vitest";
import {
  validateCompletePack,
  validateConflictGroup,
  validateProvider,
  validateProviderSelection,
  validateResearchEvidence
} from "../../src/contracts/complete-v1.js";

const sha1 = "a".repeat(40);
const sha256 = "b".repeat(64);

function provider() {
  return { schemaVersion: 2, id: "external-catalog", capabilityIds: ["repository-context-analysis"], sourceReviewId: "external-catalog-review", permissions: { filesystem: [], commands: [], network: [], externalData: [] }, version: "1.0.0", status: "stable", trustTier: "trusted", runtimeContracts: [{ runtime: "claude-code", packaging: "native-plugin", runtimeVersionRange: ">=1.0.0", platforms: ["darwin"], marketplaceId: "official-marketplace", marketplaceSource: "https://github.com/example/marketplace", pluginId: "catalog-tools", reviewedCommit: sha1, artifacts: [{ path: "skills/catalog/SKILL.md", sha256 }] }, { runtime: "codex", packaging: "agent-skill", runtimeVersionRange: ">=1.0.0", platforms: ["darwin"], repositoryUrl: "https://github.com/example/catalog", subdirectory: "skills/catalog", ref: "v1.0.0", reviewedCommit: sha1, artifacts: [{ path: "skills/catalog/SKILL.md", sha256 }] }] };
}

function pack() {
  return {
    schemaVersion: 2,
    id: "repository-to-implementation-plan",
    domainId: "software-engineering",
    categoryIds: ["repository-context"],
    outcome: { ko: "구현 계획", en: "Implementation plan" },
    inputs: ["repository"],
    outputs: ["implementation plan"],
    completionCriteria: ["plan names affected files"],
    routingProfileId: "software-engineering",
    requiredCapabilityIds: ["repository-context-analysis"],
    recommendedCapabilityIds: [],
    optionalCapabilityIds: [],
    platforms: ["darwin", "linux", "win32"],
    minimumProviderTrust: "trusted",
    assuranceProfile: "high-impact",
    scenarios: [
      { id: "repository-to-implementation-plan-normal", type: "normal", path: "tests/evaluations/packs/repository-to-implementation-plan/normal.yaml" },
      { id: "repository-to-implementation-plan-boundary", type: "boundary", path: "tests/evaluations/packs/repository-to-implementation-plan/boundary.yaml" },
      { id: "repository-to-implementation-plan-refusal", type: "refusal", path: "tests/evaluations/packs/repository-to-implementation-plan/refusal.yaml" }
    ],
    replacesPackIds: [],
    version: "0.1.0",
    status: "draft"
  };
}

describe("external-only contracts", () => {
  it("accepts an immutable dual-runtime provider", () => expect(validateProvider(provider())).toEqual(provider()));
  it.each(["https://user:token@github.com/example/catalog", "http://github.com/example/catalog", "https://github.com/example/catalog/", "https://github.com/example/%2e%2e/catalog", "https://github.com/example/../catalog"]) ("rejects unsafe source identity %s", (repositoryUrl) => {
    const value = provider();
    (value.runtimeContracts[1] as Record<string, unknown>).repositoryUrl = repositoryUrl;
    expect(() => validateProvider(value)).toThrow();
  });
  it("rejects traversal, wildcard ranges, and out-of-order runtime contracts", () => {
    const value = provider();
    value.runtimeContracts.reverse();
    value.runtimeContracts[0]!.runtimeVersionRange = "*";
    value.runtimeContracts[0]!.artifacts[0]!.path = "skills/%2e%2e/escape";
    expect(() => validateProvider(value)).toThrow();
  });
  it("requires code-point sorted unique target contract sets", () => {
    const value = provider();
    value.runtimeContracts[0]!.platforms = ["linux", "darwin"];
    (value as unknown as { permissions: { commands: string[] } }).permissions.commands = ["z", "a"];
    expect(() => validateProvider(value)).toThrow("code-point sorted and unique");
    expect(() => validateConflictGroup({ schemaVersion: 2, id: "conflict-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin", mode: "mutually-exclusive", providerIds: ["z-provider", "a-provider"], rationale: { ko: "x", en: "x" } })).toThrow("code-point sorted and unique");
  });
  it("requires target-only selection dispositions", () => {
    expect(validateProviderSelection({ schemaVersion: 2, id: "selection-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin", searchRecordId: "search-a", disposition: "selected", preferredProviderId: "external-catalog", alternateProviderIds: [], terminalReviewIds: [], decisionReasons: ["trialed"], releaseEvidence: "trialed-p04" }).disposition).toBe("selected");
    expect(() => validateProviderSelection({ schemaVersion: 2, id: "selection-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin", searchRecordId: "search-a", disposition: "selected", alternateProviderIds: [], terminalReviewIds: [], decisionReasons: ["not trialed"], releaseEvidence: "pending-p11" })).toThrow();
  });
  it("requires exact evidence scopes and structured high-impact review independence", () => {
    const value = { schemaVersion: 2, id: "evidence-a", reviewId: "review-a", providerId: "provider-a", snapshotId: "snapshot-a", reviewedCommit: sha1, kind: "semantic-smoke", scope: { runtime: "claude-code", platform: "darwin", capabilityId: "capability-a" }, caseId: "normal-case", caseClass: "normal", observedAt: "2026-07-23T05:39:45Z", artifactPath: "research/evidence/artifacts/evidence-a.json", artifactSha256: sha256, outcome: "passed", summary: "passed" };
    expect(validateResearchEvidence(value)).toEqual(value);
    expect(() => validateResearchEvidence({ ...value, scope: { runtime: null, platform: null, capabilityId: null } })).toThrow();
  });
  it("does not allow global conflict preference", () => {
    expect(validateConflictGroup({ schemaVersion: 2, id: "conflict-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin", mode: "mutually-exclusive", providerIds: ["external-catalog"], rationale: { ko: "x", en: "x" } }).runtime).toBe("claude-code");
  });

  it("accepts broker-routed packs and rejects local-provider fields", () => {
    expect(validateCompletePack(pack())).toEqual(pack());
    for (const legacyField of ["runtimeBundle", "ownedSkillIds", "trustRequirement"] as const) {
      expect(() => validateCompletePack({ ...pack(), [legacyField]: legacyField === "ownedSkillIds" ? [] : "legacy" })).toThrow();
    }
  });

  it("requires trusted as the complete-pack minimum provider trust", () => {
    expect(() => validateCompletePack({ ...pack(), minimumProviderTrust: "verified" })).toThrow(
      /minimumProviderTrust/
    );
  });
});
