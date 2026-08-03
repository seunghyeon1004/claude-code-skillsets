import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DomainManifest,
  ExternalSourceManifest,
  LocalPluginManifest,
  PackManifest,
  PackTrustRequirement,
  PluginDependency,
  ReleaseStatus,
  RiskLevel,
  TrustTier
} from "../../src/model/manifest.js";

describe("PackManifest", () => {
  it("represents a complete outcome pack", () => {
    const pack: PackManifest = {
      id: "repository-to-implementation-plan",
      domain: "software-engineering",
      categories: ["repository-analysis", "planning"],
      outcome: { ko: "검증 가능한 구현 계획", en: "A verifiable implementation plan" },
      targetUsers: ["software-developer"],
      whenToUse: ["기존 저장소의 변경 계획이 필요할 때"],
      whenNotToUse: ["구현이 이미 완료되어 검증만 필요할 때"],
      inputs: ["repository", "requested-change"],
      outputs: ["implementation-plan"],
      workflow: ["workspace-context", "intent-to-brief", "plan-and-checkpoints"],
      requiredPlugins: ["shared-core"],
      recommendedPlugins: [],
      optionalPlugins: [],
      tools: ["git"],
      languages: ["ko", "en"],
      regions: ["global"],
      riskLevel: "standard",
      trustRequirements: "trusted",
      licenses: ["Apache-2.0"],
      evaluationCases: ["tests/evaluations/repository-plan.yaml"],
      maintainers: ["seunghyeon1004"],
      version: "0.1.0",
      status: "draft"
    };
    const domain: DomainManifest = {
      id: "software-engineering",
      name: { ko: "소프트웨어 엔지니어링", en: "Software Engineering" },
      description: { ko: "개발 업무", en: "Software development work" },
      categories: ["repository-analysis", "planning"],
      languages: ["ko", "en"],
      regions: ["global"],
      maintainers: ["seunghyeon1004"],
      version: "0.1.0",
      status: "draft"
    };
    const dependency: PluginDependency = {
      name: "shared-core",
      version: "^0.1.0",
      reason: { ko: "공용 워크플로", en: "Shared workflow" }
    };
    const plugin: LocalPluginManifest = {
      id: "skillset-manager",
      source: "./plugins/skillset-manager",
      version: "0.1.0",
      status: "draft",
      requiredDependencies: [dependency],
      recommendedDependencies: [],
      optionalDependencies: []
    };
    const externalSource: ExternalSourceManifest = {
      id: "trusted-tools",
      name: { ko: "신뢰 도구", en: "Trusted Tools" },
      homepage: "https://example.com",
      repository: "https://github.com/example/tools",
      license: "Apache-2.0",
      trustTier: "trusted",
      status: "stable",
      marketplace: "trusted-tools",
      marketplaceSource: "example/trusted-tools-marketplace",
      version: "1.0.0",
      permissions: { filesystem: [], commands: [], network: [], externalData: [] },
      requiredDependencies: [],
      updatePolicy: "compatible-patch",
      reviewedAt: "2026-07-22"
    };

    expect(pack.id).toBe("repository-to-implementation-plan");
    expect([domain.id, plugin.id, externalSource.id]).toEqual([
      "software-engineering",
      "skillset-manager",
      "trusted-tools"
    ]);
    expectTypeOf<TrustTier>().toEqualTypeOf<
      "verified" | "trusted" | "community" | "blocked"
    >();
    expectTypeOf<PackTrustRequirement>().toEqualTypeOf<
      "verified" | "trusted" | "community"
    >();
    expectTypeOf<RiskLevel>().toEqualTypeOf<
      "standard" | "review-required" | "expert-required"
    >();
    expectTypeOf<ReleaseStatus>().toEqualTypeOf<
      "draft" | "beta" | "stable" | "deprecated" | "blocked"
    >();
  });
});
