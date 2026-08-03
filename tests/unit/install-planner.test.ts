import { describe, expect, it } from "vitest";
import {
  normalizeMarketplaceList,
  planInstall,
  verifyMarketplaceIdentity,
  verifyReviewedExternalVersion,
  type InstallIndex
} from "../../src/installer/plan.js";

describe("marketplace list normalization", () => {
  it("normalizes the real github marketplace shape", () => {
    expect(normalizeMarketplaceList([{
      name: "claude-plugins-official",
      source: "github",
      repo: "anthropics/claude-plugins-official",
      installLocation: "/Users/example/.claude/plugins/marketplaces/claude-plugins-official"
    }])).toEqual([{
      id: "claude-plugins-official",
      source: "anthropics/claude-plugins-official"
    }]);
  });

  it("normalizes the real git marketplace shape", () => {
    expect(normalizeMarketplaceList([{
      name: "claude-code-plugins-plus",
      source: "git",
      url: "https://github.com/example/claude-code-plugins-plus.git",
      installLocation: "/Users/example/.claude/plugins/marketplaces/claude-code-plugins-plus"
    }])).toEqual([{
      id: "claude-code-plugins-plus",
      source: "https://github.com/example/claude-code-plugins-plus.git"
    }]);
  });

  it("requires a top-level array", () => {
    expect(() => normalizeMarketplaceList({ marketplaces: [] })).toThrow(
      /marketplace list.*array/i
    );
  });

  it("rejects unsupported source kinds", () => {
    expect(() => normalizeMarketplaceList([{
      name: "local-marketplace",
      source: "directory",
      path: "/tmp/local-marketplace",
      installLocation: "/Users/example/.claude/plugins/marketplaces/local-marketplace"
    }])).toThrow(/unsupported.*marketplace.*source.*directory/i);
  });

  it.each([
    ["missing name", {
      source: "github",
      repo: "example/trusted-tools",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }],
    ["github missing repo", {
      name: "trusted-tools",
      source: "github",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }],
    ["github with git identity field", {
      name: "trusted-tools",
      source: "github",
      repo: "example/trusted-tools",
      url: "https://github.com/example/trusted-tools.git",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }],
    ["git missing url", {
      name: "trusted-tools",
      source: "git",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }],
    ["git with github identity field", {
      name: "trusted-tools",
      source: "git",
      url: "https://github.com/example/trusted-tools.git",
      repo: "example/trusted-tools",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }],
    ["unexpected metadata", {
      name: "trusted-tools",
      source: "github",
      repo: "example/trusted-tools",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools",
      metadata: "not-part-of-the-cli-shape"
    }]
  ])("rejects malformed discriminated entries: %s", (_label, entry) => {
    expect(() => normalizeMarketplaceList([entry])).toThrow(/invalid.*marketplace.*entry/i);
  });

  it.each([
    ["unsafe ID", {
      name: "trusted-tools;touch-pwned",
      source: "github",
      repo: "example/trusted-tools",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }],
    ["unsafe github source", {
      name: "trusted-tools",
      source: "github",
      repo: "example/trusted-tools;touch-pwned",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }],
    ["unsafe git source", {
      name: "trusted-tools",
      source: "git",
      url: "https://github.com/example/trusted-tools.git?x=$(touch-pwned)",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }]
  ])("rejects %s", (_label, entry) => {
    expect(() => normalizeMarketplaceList([entry])).toThrow(/unsafe.*marketplace/i);
  });

  it("rejects duplicate IDs even when their sources are identical", () => {
    const entry = {
      name: "trusted-tools",
      source: "github",
      repo: "example/trusted-tools",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    };

    expect(() => normalizeMarketplaceList([entry, { ...entry }])).toThrow(
      /duplicate marketplace ID.*trusted-tools/i
    );
  });

  it("rejects duplicate IDs whose sources conflict", () => {
    expect(() => normalizeMarketplaceList([{
      name: "trusted-tools",
      source: "github",
      repo: "example/trusted-tools",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }, {
      name: "trusted-tools",
      source: "git",
      url: "https://github.com/attacker/trusted-tools.git",
      installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
    }])).toThrow(/trusted-tools.*source conflict/i);
  });
});

describe("installation planner", () => {
  it("installs only broker plugins when production has research-pending purpose metadata", () => {
    const index = fixtureIndex();
    index.profiles = [];
    index.domains[0]!.profileIds = [];
    index.researchPendingPacks = [{
      id: "repository-to-implementation-plan",
      domainId: "software-engineering",
      labels: { ko: "계획", en: "Plan" },
      state: "research-pending"
    }];
    index.plugins = index.plugins.filter(({ id }) => id === "shared-core");
    index.plugins.push({
      id: "skillset-manager",
      name: { ko: "스킬셋 관리자", en: "Skillset manager" },
      version: "0.1.0",
      source: "./plugins/skillset-manager",
      marketplace: "claude-code-skillsets",
      trustTier: "verified",
      permissions: emptyPermissions(),
      requiredDependencies: [{ id: "shared-core", marketplace: "claude-code-skillsets", version: "^0.1.0" }],
      installCommand: "claude plugin install skillset-manager@claude-code-skillsets --scope user",
      kind: "local"
    });

    const plan = planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["git"],
      level: "custom-max",
      optionalPlugins: ["github-tools"]
    }, index);

    expect(plan.required).toEqual(["shared-core", "skillset-manager"]);
    expect(plan.recommended).toEqual([]);
    expect(plan.optional).toEqual([]);
  });

  it("rejects an injected purpose profile when research is pending", () => {
    const index = fixtureIndex();
    index.researchPendingPacks = [{
      id: "repository-to-implementation-plan",
      domainId: "software-engineering",
      labels: { ko: "계획", en: "Plan" },
      state: "research-pending"
    }];

    expect(() => planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["git"],
      level: "essential",
      optionalPlugins: []
    }, index)).toThrow(/purpose profiles require complete P04B/i);
  });

  it("includes only explicitly selected optional plugins", () => {
    const plan = planInstall(
      {
        domains: ["software-engineering"],
        purposes: ["repository-planning"],
        tools: ["github"],
        level: "custom-max",
        optionalPlugins: ["github-tools"]
      },
      fixtureIndex()
    );

    expect(plan.required).toEqual(["shared-core"]);
    expect(plan.recommended).toEqual(["repository-to-implementation-plan"]);
    expect(plan.optional).toEqual(["github-tools"]);
    expect(plan.commands).toEqual([
      "claude plugin install shared-core@claude-code-skillsets --scope user",
      "claude plugin install repository-to-implementation-plan@claude-code-skillsets --scope user",
      "claude plugin marketplace add example/trusted-tools-marketplace --scope user",
      "claude plugin marketplace list --json",
      "claude plugin install github-tools@trusted-tools --scope user",
      "claude plugin list --json"
    ]);
    expect(plan.operations.map(({ kind }) => kind)).toEqual([
      "install", "install", "marketplace-add", "verify-marketplace", "install", "verify-version"
    ]);
  });

  it("resolves essential and recommended levels without optional plugins", () => {
    const essential = planInstall(
      {
        domains: ["software-engineering"],
        purposes: ["repository-planning"],
        tools: ["github"],
        level: "essential",
        optionalPlugins: ["github-tools"]
      },
      fixtureIndex()
    );
    const recommended = planInstall(
      {
        domains: ["software-engineering"],
        purposes: ["repository-planning"],
        tools: ["github"],
        level: "recommended",
        optionalPlugins: ["github-tools"]
      },
      fixtureIndex()
    );

    expect(essential).toMatchObject({
      required: ["shared-core"],
      recommended: [],
      optional: []
    });
    expect(recommended).toMatchObject({
      required: ["shared-core"],
      recommended: ["repository-to-implementation-plan"],
      optional: []
    });
  });

  it("does not add available optional plugins without an explicit custom-max selection", () => {
    const plan = planInstall(
      {
        domains: ["software-engineering"],
        purposes: ["repository-planning"],
        tools: ["github"],
        level: "custom-max",
        optionalPlugins: []
      },
      fixtureIndex()
    );

    expect(plan.optional).toEqual([]);
    expect(plan.commands).toEqual([
      "claude plugin install shared-core@claude-code-skillsets --scope user",
      "claude plugin install repository-to-implementation-plan@claude-code-skillsets --scope user"
    ]);
  });

  it("deduplicates plugins and orders dependencies before dependents", () => {
    const index = fixtureIndex();
    index.profiles.push({
      id: "duplicate-roots",
      labels: { ko: "중복 루트", en: "Duplicate roots" },
      domainIds: ["software-engineering"],
      purposeIds: ["repository-planning"],
      toolIds: ["github"],
      requiredPlugins: ["repository-to-implementation-plan", "shared-core"],
      recommendedPlugins: [],
      optionalPlugins: [],
      executables: [],
      version: "0.1.0",
      status: "beta"
    });

    const plan = planInstall(
      {
        domains: ["software-engineering"],
        purposes: ["repository-planning"],
        tools: ["github"],
        level: "essential",
        optionalPlugins: []
      },
      index
    );

    expect(plan.required).toEqual(["shared-core", "repository-to-implementation-plan"]);
    expect(plan.commands).toHaveLength(2);
  });

  it("rejects blocked sources and warns for community sources", () => {
    const blockedIndex = fixtureIndex();
    blockedIndex.plugins.find((plugin) => plugin.id === "github-tools")!.trustTier = "blocked";

    expect(() => planInstall(
      {
        domains: ["software-engineering"],
        purposes: ["repository-planning"],
        tools: ["github"],
        level: "custom-max",
        optionalPlugins: ["github-tools"]
      },
      blockedIndex
    )).toThrow("Blocked plugin source: github-tools@trusted-tools");

    const communityIndex = fixtureIndex();
    communityIndex.plugins.find((plugin) => plugin.id === "github-tools")!.trustTier = "community";

    expect(planInstall(
      {
        domains: ["software-engineering"],
        purposes: ["repository-planning"],
        tools: ["github"],
        level: "custom-max",
        optionalPlugins: ["github-tools"]
      },
      communityIndex
    ).warnings).toEqual(["Community source requires review: github-tools@trusted-tools"]);
  });

  it("matches purpose when profiles share the same domain and tool", () => {
    const index = fixtureIndex();
    index.profiles.push({
      id: "incident-response",
      labels: { ko: "장애 대응", en: "Incident response" },
      domainIds: ["software-engineering"],
      purposeIds: ["incident-response"],
      toolIds: ["github"],
      requiredPlugins: ["github-tools"],
      recommendedPlugins: [],
      optionalPlugins: [],
      executables: [{ name: "gh", impact: "required" }],
      version: "0.1.0",
      status: "beta"
    });

    const plan = planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["github"],
      level: "essential",
      optionalPlugins: []
    }, index);

    expect(plan.required).toEqual(["shared-core"]);
    expect(plan.required).not.toContain("github-tools");
  });

  it("rejects an unsatisfied required dependency range", () => {
    const index = fixtureIndex();
    const dependency = index.plugins
      .find((plugin) => plugin.id === "repository-to-implementation-plan")!
      .requiredDependencies[0]!;
    dependency.version = "^2.0.0";

    expect(() => planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["github"],
      level: "recommended",
      optionalPlugins: []
    }, index)).toThrow(/repository-to-implementation-plan.*shared-core.*\^2\.0\.0.*0\.1\.0/i);
  });

  it("accepts a required dependency with no version range", () => {
    const index = fixtureIndex();
    const dependency = index.plugins
      .find((plugin) => plugin.id === "repository-to-implementation-plan")!
      .requiredDependencies[0]!;
    delete dependency.version;

    const plan = planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["github"],
      level: "recommended",
      optionalPlugins: []
    }, index);

    expect(plan.required).toContain("shared-core");
    expect(plan.recommended).toContain("repository-to-implementation-plan");
  });

  it("rejects a dependency marketplace that differs from its target", () => {
    const index = fixtureIndex();
    const dependency = index.plugins
      .find((plugin) => plugin.id === "repository-to-implementation-plan")!
      .requiredDependencies[0]!;
    dependency.marketplace = "wrong-marketplace";

    expect(() => planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["github"],
      level: "recommended",
      optionalPlugins: []
    }, index)).toThrow(/shared-core.*wrong-marketplace.*claude-code-skillsets/i);
  });

  it("does not register an external marketplace whose detected ID and source match exactly", () => {
    const plan = planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["github"],
      level: "custom-max",
      optionalPlugins: ["github-tools"],
      registeredMarketplaces: [{
        id: "trusted-tools",
        source: "example/trusted-tools-marketplace"
      }]
    }, fixtureIndex());

    expect(plan.commands).not.toContain(
      "claude plugin marketplace add example/trusted-tools-marketplace --scope user"
    );
    expect(plan.commands.slice(-3)).toEqual([
      "claude plugin marketplace list --json",
      "claude plugin install github-tools@trusted-tools --scope user",
      "claude plugin list --json"
    ]);
  });

  it("hard fails when a detected marketplace reuses the reviewed ID with another source", () => {
    expect(() => planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["github"],
      level: "custom-max",
      optionalPlugins: ["github-tools"],
      registeredMarketplaces: [{
        id: "trusted-tools",
        source: "attacker/malicious-marketplace"
      }]
    }, fixtureIndex())).toThrow(
      /marketplace.*trusted-tools.*source conflict.*attacker\/malicious-marketplace.*example\/trusted-tools-marketplace/i
    );
  });

  it("verifies exact marketplace identity from the post-registration JSON result", () => {
    expect(() => verifyMarketplaceIdentity(
      "trusted-tools",
      "example/trusted-tools-marketplace",
      [{
        name: "trusted-tools",
        source: "github",
        repo: "attacker/malicious-marketplace",
        installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
      }]
    )).toThrow(/trusted-tools.*source conflict/i);
    expect(() => verifyMarketplaceIdentity(
      "trusted-tools",
      "example/trusted-tools-marketplace",
      [{
        name: "trusted-tools",
        source: "github",
        repo: "example/trusted-tools-marketplace",
        installLocation: "/Users/example/.claude/plugins/marketplaces/trusted-tools"
      }]
    )).not.toThrow();
    expect(() => verifyMarketplaceIdentity(
      "trusted-tools",
      "example/trusted-tools-marketplace",
      []
    )).toThrow(/trusted-tools.*missing/i);
  });

  it("fails external verification when installed version differs from reviewed version", () => {
    const plugin = fixtureIndex().plugins.find(({ id }) => id === "github-tools")!;

    expect(() => verifyReviewedExternalVersion(plugin, [{
      id: "github-tools",
      marketplace: "trusted-tools",
      version: "1.3.0"
    }])).toThrow(/github-tools.*reviewed.*1\.2\.0.*installed.*1\.3\.0/i);
    expect(() => verifyReviewedExternalVersion(plugin, [{
      id: "github-tools",
      marketplace: "trusted-tools",
      version: "1.2.0"
    }])).not.toThrow();
  });

  it("rejects an unsafe runtime marketplace registration source independently of commands", () => {
    const index = fixtureIndex();
    index.plugins.find(({ id }) => id === "github-tools")!.marketplaceSource =
      "example/trusted-tools;touch-pwned";

    expect(() => planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["github"],
      level: "custom-max",
      optionalPlugins: ["github-tools"]
    }, index)).toThrow(/unsafe.*marketplace.*source/i);
  });

  it("rejects unsafe runtime identifiers even when an injected command matches them", () => {
    const index = fixtureIndex();
    const plugin = index.plugins[0]!;
    plugin.id = "shared-core;touch-pwned";
    plugin.installCommand =
      "claude plugin install shared-core;touch-pwned@claude-code-skillsets --scope user";
    index.profiles[0]!.requiredPlugins = [plugin.id];

    expect(() => planInstall({
      domains: ["software-engineering"],
      purposes: ["repository-planning"],
      tools: ["github"],
      level: "essential",
      optionalPlugins: []
    }, index)).toThrow(/unsafe.*plugin.*id/i);
  });
});

function fixtureIndex(): InstallIndex {
  return {
    schemaVersion: 1,
    indexFingerprint: `sha256:${"a".repeat(64)}`,
    marketplace: {
      id: "claude-code-skillsets",
      source: "seunghyeon1004/claude-code-skillsets"
    },
    domains: [{
      id: "software-engineering",
      name: { ko: "소프트웨어 엔지니어링", en: "Software Engineering" },
      description: { ko: "소프트웨어 개발", en: "Software development" },
      purposeIds: ["repository-planning"],
      profileIds: ["repository-planning"]
    }],
    profiles: [
      {
        id: "repository-planning",
        labels: { ko: "저장소 계획", en: "Repository planning" },
        domainIds: ["software-engineering"],
        purposeIds: ["repository-planning"],
        toolIds: ["github"],
        requiredPlugins: ["shared-core"],
        recommendedPlugins: ["repository-to-implementation-plan"],
        optionalPlugins: ["github-tools"],
        executables: [{ name: "git", impact: "required" }],
        version: "0.1.0",
        status: "beta"
      }
    ],
    availability: [],
    researchPendingPacks: [],
    executables: ["git"],
    plugins: [
      {
        id: "shared-core",
        name: { ko: "공용 코어", en: "Shared core" },
        version: "0.1.0",
        source: "./plugins/shared-core",
        marketplace: "claude-code-skillsets",
        trustTier: "trusted",
        permissions: emptyPermissions(),
        requiredDependencies: [],
        installCommand: "claude plugin install shared-core@claude-code-skillsets --scope user"
      },
      {
        id: "repository-to-implementation-plan",
        name: { ko: "저장소 구현 계획", en: "Repository implementation plan" },
        version: "0.1.0",
        source: "./plugins/repository-to-implementation-plan",
        marketplace: "claude-code-skillsets",
        trustTier: "trusted",
        permissions: emptyPermissions(),
        requiredDependencies: [{
          id: "shared-core",
          marketplace: "claude-code-skillsets",
          version: "^0.1.0"
        }],
        installCommand: "claude plugin install repository-to-implementation-plan@claude-code-skillsets --scope user"
      },
      {
        id: "github-tools",
        name: { ko: "GitHub 도구", en: "GitHub tools" },
        version: "1.2.0",
        kind: "external",
        license: "Apache-2.0",
        source: "https://github.com/example/github-tools",
        marketplace: "trusted-tools",
        marketplaceSource: "example/trusted-tools-marketplace",
        marketplaceAddCommand: "claude plugin marketplace add example/trusted-tools-marketplace --scope user",
        reviewedVersion: "1.2.0",
        versionPinSupported: false,
        verificationCommand: "claude plugin list --json",
        trustTier: "trusted",
        permissions: emptyPermissions(),
        requiredDependencies: [{
          id: "repository-to-implementation-plan",
          marketplace: "claude-code-skillsets",
          version: "^0.1.0"
        }],
        installCommand: "claude plugin install github-tools@trusted-tools --scope user"
      }
    ]
  };
}

function emptyPermissions() {
  return {
    filesystem: [],
    commands: [],
    network: [],
    externalData: []
  };
}
