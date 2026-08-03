import { describe, expect, it } from "vitest";
import {
  SUPPORTED_RUNTIMES,
  type CompletePackManifest,
  type ConflictGroupManifest,
  type ProviderManifest
} from "../../src/model/complete-v1.js";

describe("external-only complete-v1 types", () => {
  it("defines Claude Code and Codex in deterministic runtime order", () => {
    expect(SUPPORTED_RUNTIMES).toEqual(["claude-code", "codex"]);
  });

  it("has no owned strategy or global platform role on the provider contract", () => {
    const provider: ProviderManifest = {
      schemaVersion: 2, id: "external-provider", capabilityIds: ["capability-a"], sourceReviewId: "review-a",
      permissions: { filesystem: [], commands: [], network: [], externalData: [] }, version: "1.0.0", status: "stable", trustTier: "trusted",
      runtimeContracts: [{ runtime: "claude-code", packaging: "native-plugin", runtimeVersionRange: ">=1.0.0", platforms: ["darwin"], marketplaceId: "catalog", marketplaceSource: "https://github.com/example/catalog", pluginId: "provider", reviewedCommit: "a".repeat(40), artifacts: [{ path: "skills/provider/SKILL.md", sha256: "a".repeat(64) }] }]
    };
    expect(provider).not.toHaveProperty("installStrategy");
    expect(provider).not.toHaveProperty("platforms");
  });

  it("binds conflicts to one capability target without a global preferred provider", () => {
    const conflict: ConflictGroupManifest = { schemaVersion: 2, id: "conflict-a", capabilityId: "capability-a", runtime: "claude-code", platform: "darwin", mode: "mutually-exclusive", providerIds: ["external-provider"], rationale: { ko: "x", en: "x" } };
    expect(conflict).not.toHaveProperty("preferredProviderId");
  });

  it("defines complete packs as broker routes with a closed external-provider contract", () => {
    const pack: CompletePackManifest = {
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
      scenarios: [],
      replacesPackIds: [],
      version: "0.1.0",
      status: "draft"
    };

    expect(pack).not.toHaveProperty("runtimeBundle");
    expect(pack).not.toHaveProperty("ownedSkillIds");
    expect(pack).not.toHaveProperty("trustRequirement");
  });
});
