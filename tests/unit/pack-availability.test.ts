import { describe, expect, it } from "vitest";
import { derivePackAvailability } from "../../src/catalog/availability.js";
import type {
  CompletePackManifest,
  ProviderManifest,
  ProviderSelectionManifest,
  ProviderTargetEligibility
} from "../../src/model/complete-v1.js";

const target = { runtime: "claude-code", platform: "darwin" } as const;
const failureReasons = ["revoked", "deleted", "license-changed", "incompatible-update"] as const;

type TestInstalledHealth = {
  bindings: Array<{ capabilityId: string; providerId: string }>;
  failures: Array<{
    runtime: "claude-code";
    platform: "darwin";
    providerId: string;
    reason: (typeof failureReasons)[number];
  }>;
};

interface TestInput {
  pack: CompletePackManifest;
  selections: ProviderSelectionManifest[];
  providers: ProviderManifest[];
  eligibility: ProviderTargetEligibility[];
  target: typeof target;
  installed: TestInstalledHealth | null;
}

function pack(overrides: Partial<CompletePackManifest> = {}): CompletePackManifest {
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
    requiredCapabilityIds: ["required-a", "required-b"],
    recommendedCapabilityIds: ["recommended-a"],
    optionalCapabilityIds: ["optional-a"],
    platforms: ["darwin", "linux", "win32"],
    minimumProviderTrust: "trusted",
    assuranceProfile: "standard",
    scenarios: [],
    replacesPackIds: [],
    version: "0.1.0",
    status: "draft",
    ...overrides
  } as CompletePackManifest;
}

function provider(
  id: string,
  trustTier: ProviderManifest["trustTier"] = "trusted",
  overrides: Partial<ProviderManifest> = {}
): ProviderManifest {
  const capabilityId = id.replace(/^provider-/, "").replace(/^alternate-/, "");
  return {
    schemaVersion: 2,
    id,
    capabilityIds: [capabilityId],
    sourceReviewId: `review-${id}`,
    permissions: { filesystem: [], commands: [], network: [], externalData: [] },
    version: "1.0.0",
    status: "stable",
    trustTier,
    runtimeContracts: [{
      runtime: "claude-code",
      packaging: "agent-skill",
      runtimeVersionRange: ">=1.0.0",
      platforms: ["darwin"],
      repositoryUrl: `https://github.com/example/${id}`,
      subdirectory: "skills/availability",
      ref: "v1.0.0",
      reviewedCommit: "a".repeat(40),
      artifacts: [{ path: "skills/availability/SKILL.md", sha256: "b".repeat(64) }]
    }],
    ...overrides
  };
}

function selection(
  capabilityId: string,
  overrides: Partial<ProviderSelectionManifest> = {}
): ProviderSelectionManifest {
  return {
    schemaVersion: 2,
    id: `selection-${capabilityId}`,
    capabilityId,
    ...target,
    searchRecordId: `search-${capabilityId}`,
    disposition: "selected",
    preferredProviderId: `provider-${capabilityId}`,
    alternateProviderIds: [],
    terminalReviewIds: [],
    decisionReasons: ["trialed"],
    releaseEvidence: "trialed-p04",
    ...overrides
  };
}

function eligibility(
  providerId: string,
  capabilityId: string,
  overrides: Partial<ProviderTargetEligibility> = {}
): ProviderTargetEligibility {
  return {
    providerId,
    capabilityId,
    target: { ...target },
    eligible: true,
    assuranceProfiles: ["standard", "high-impact"],
    evidenceIds: [],
    reasonCodes: [],
    ...overrides
  };
}

function input(overrides: Partial<TestInput> = {}): TestInput {
  const currentPack = overrides.pack ?? pack();
  const capabilityIds = [
    ...currentPack.requiredCapabilityIds,
    ...currentPack.recommendedCapabilityIds,
    ...currentPack.optionalCapabilityIds
  ];
  const selections = capabilityIds.map((capabilityId) => selection(capabilityId)).reverse();
  const providers = capabilityIds.map((capabilityId) => provider(`provider-${capabilityId}`)).reverse();
  const records = capabilityIds.map((capabilityId) => eligibility(`provider-${capabilityId}`, capabilityId)).reverse();
  return {
    pack: currentPack,
    selections,
    providers,
    eligibility: records,
    target,
    installed: null,
    ...overrides
  };
}

function derive(overrides: Partial<TestInput> = {}) {
  return derivePackAvailability(input(overrides));
}

function replaceSelection(
  selections: readonly ProviderSelectionManifest[],
  capabilityId: string,
  overrides: Partial<ProviderSelectionManifest>
): ProviderSelectionManifest[] {
  return selections.map((current) => current.capabilityId === capabilityId
    ? selection(capabilityId, { ...current, ...overrides })
    : current
  );
}

function replaceEligibility(
  records: readonly ProviderTargetEligibility[],
  providerId: string,
  capabilityId: string,
  overrides: Partial<ProviderTargetEligibility>
): ProviderTargetEligibility[] {
  return records.map((current) => current.providerId === providerId && current.capabilityId === capabilityId
    ? eligibility(providerId, capabilityId, { ...current, ...overrides })
    : current
  );
}

describe("derivePackAvailability", () => {
  it("rejects a runtime-platform target absent from the pack contract", () => {
    expect(() => derive({ pack: pack({ platforms: ["linux"] }) })).toThrow(/pack target/i);
  });

  it("resolves a fully selected pack as available with code-point sorted provider output", () => {
    const result = derive();

    expect(result).toMatchObject({
      ...target,
      packId: "repository-to-implementation-plan",
      availability: "available",
      missingRequiredCapabilityIds: [],
      missingRecommendedCapabilityIds: [],
      actionRequiredIssues: []
    });
    expect(result.resolvedProviders).toEqual([
      { capabilityId: "optional-a", providerId: "provider-optional-a", role: "selected" },
      { capabilityId: "recommended-a", providerId: "provider-recommended-a", role: "selected" },
      { capabilityId: "required-a", providerId: "provider-required-a", role: "selected" },
      { capabilityId: "required-b", providerId: "provider-required-b", role: "selected" }
    ]);
  });

  it("keeps a recommended-only alternate disposition available when its preferred route is eligible", () => {
    const base = input();
    const result = derive({
      selections: replaceSelection(base.selections, "recommended-a", { disposition: "alternate" })
    });

    expect(result.availability).toBe("available");
    expect(result.missingRecommendedCapabilityIds).toEqual([]);
  });

  it.each(["rejected", "unavailable"] as const)("reports a %s recommended capability as an available-with-gaps diagnostic", (disposition) => {
    const base = input();
    const result = derive({
      selections: replaceSelection(base.selections, "recommended-a", {
        disposition,
        preferredProviderId: undefined,
        alternateProviderIds: [],
        terminalReviewIds: disposition === "rejected" ? ["terminal-recommended"] : [],
        releaseEvidence: "not-applicable"
      })
    });

    expect(result.availability).toBe("available-with-gaps");
    expect(result.missingRequiredCapabilityIds).toEqual([]);
    expect(result.missingRecommendedCapabilityIds).toEqual(["recommended-a"]);
  });

  it.each(["alternate", "rejected", "unavailable"] as const)("makes a required %s route unavailable", (disposition) => {
    const base = input();
    const result = derive({
      selections: replaceSelection(base.selections, "required-a", {
        disposition,
        preferredProviderId: disposition === "alternate" ? "provider-required-a" : undefined,
        alternateProviderIds: [],
        terminalReviewIds: disposition === "rejected" ? ["terminal-required"] : [],
        releaseEvidence: disposition === "alternate" ? "trialed-p04" : "not-applicable"
      })
    });

    expect(result.availability).toBe("unavailable");
    expect(result.missingRequiredCapabilityIds).toEqual(["required-a"]);
  });

  it("requires trusted provider status even when a supplied eligibility record claims eligible", () => {
    const base = input();
    const result = derive({
      providers: base.providers.map((current) => current.id === "provider-required-a"
        ? provider(current.id, "community")
        : current)
    });

    expect(result.availability).toBe("unavailable");
    expect(result.missingRequiredCapabilityIds).toEqual(["required-a"]);
  });

  it.each([
    ["non-publishable status", (current: ProviderManifest): ProviderManifest => provider(current.id, "trusted", { status: "draft" })],
    ["missing capability ownership", (current: ProviderManifest): ProviderManifest => provider(current.id, "trusted", { capabilityIds: [] })],
    ["missing exact runtime-platform contract", (current: ProviderManifest): ProviderManifest => ({
      ...current,
      runtimeContracts: current.runtimeContracts.map((contract) => ({ ...contract, platforms: ["linux"] }))
    })]
  ])("fails closed for %s despite stale target eligibility", (_name, mutate) => {
    const base = input();
    const result = derive({
      providers: base.providers.map((current) => current.id === "provider-required-a" ? mutate(current) : current)
    });

    expect(result.availability).toBe("unavailable");
    expect(result.missingRequiredCapabilityIds).toEqual(["required-a"]);
  });

  it("requires the pack assurance profile on the exact eligibility record", () => {
    const base = input({ pack: pack({ assuranceProfile: "high-impact" }) });
    const result = derive({
      pack: base.pack,
      selections: base.selections,
      providers: base.providers,
      eligibility: replaceEligibility(base.eligibility, "provider-required-a", "required-a", {
        assuranceProfiles: ["standard"]
      })
    });

    expect(result.availability).toBe("unavailable");
    expect(result.missingRequiredCapabilityIds).toEqual(["required-a"]);
  });

  it("preserves a healthy installed alternate rather than silently switching to the preferred provider", () => {
    const base = input();
    const result = derive({
      selections: replaceSelection(base.selections, "required-a", {
        alternateProviderIds: ["alternate-required-a"]
      }),
      providers: [...base.providers, provider("alternate-required-a")],
      eligibility: [...base.eligibility, eligibility("alternate-required-a", "required-a")],
      installed: {
        bindings: [{ capabilityId: "required-a", providerId: "alternate-required-a" }],
        failures: []
      }
    });

    expect(result.availability).toBe("available");
    expect(result.resolvedProviders).toContainEqual({
      capabilityId: "required-a", providerId: "alternate-required-a", role: "alternate"
    });
    expect(result.resolvedProviders).not.toContainEqual({
      capabilityId: "required-a", providerId: "provider-required-a", role: "selected"
    });
  });

  it.each(failureReasons)("surfaces an exact action-required diagnostic for an installed %s binding", (reason) => {
    const base = input();
    const result = derive({
      eligibility: replaceEligibility(base.eligibility, "provider-required-a", "required-a", { eligible: false }),
      installed: {
        bindings: [{ capabilityId: "required-a", providerId: "provider-required-a" }],
        failures: [{ ...target, providerId: "provider-required-a", reason }]
      }
    });

    expect(result.availability).toBe("action-required");
    expect(result.missingRequiredCapabilityIds).toEqual(["required-a"]);
    expect(result.actionRequiredIssues).toEqual([
      { capabilityId: "required-a", providerId: "provider-required-a", reason }
    ]);
  });

  it("gives an optional user-chosen alternate the same action-required precedence", () => {
    const base = input();
    const result = derive({
      selections: replaceSelection(base.selections, "optional-a", {
        alternateProviderIds: ["alternate-optional-a"]
      }),
      providers: [...base.providers, provider("alternate-optional-a")],
      eligibility: [
        ...base.eligibility,
        eligibility("alternate-optional-a", "optional-a", { eligible: false })
      ],
      installed: {
        bindings: [{ capabilityId: "optional-a", providerId: "alternate-optional-a" }],
        failures: [{ ...target, providerId: "alternate-optional-a", reason: "incompatible-update" }]
      }
    });

    expect(result.availability).toBe("action-required");
    expect(result.missingRequiredCapabilityIds).toEqual([]);
    expect(result.missingRecommendedCapabilityIds).toEqual([]);
    expect(result.actionRequiredIssues).toEqual([
      { capabilityId: "optional-a", providerId: "alternate-optional-a", reason: "incompatible-update" }
    ]);
  });

  it("keeps missing required and recommended diagnostics when action-required takes precedence", () => {
    const base = input();
    const selections = replaceSelection(base.selections, "recommended-a", {
      disposition: "unavailable",
      preferredProviderId: undefined,
      releaseEvidence: "not-applicable"
    });
    const result = derive({
      selections: replaceSelection(selections, "required-b", {
        disposition: "unavailable",
        preferredProviderId: undefined,
        releaseEvidence: "not-applicable"
      }),
      eligibility: replaceEligibility(base.eligibility, "provider-required-a", "required-a", { eligible: false }),
      installed: {
        bindings: [{ capabilityId: "required-a", providerId: "provider-required-a" }],
        failures: [{ ...target, providerId: "provider-required-a", reason: "revoked" }]
      }
    });

    expect(result.availability).toBe("action-required");
    expect(result.missingRequiredCapabilityIds).toEqual(["required-a", "required-b"]);
    expect(result.missingRecommendedCapabilityIds).toEqual(["recommended-a"]);
    expect(result.actionRequiredIssues).toEqual([
      { capabilityId: "required-a", providerId: "provider-required-a", reason: "revoked" }
    ]);
  });

  it("gives unavailable precedence over available-with-gaps without action-required", () => {
    const base = input();
    const selections = replaceSelection(base.selections, "recommended-a", {
      disposition: "unavailable",
      preferredProviderId: undefined,
      releaseEvidence: "not-applicable"
    });
    const result = derive({
      selections: replaceSelection(selections, "required-a", {
        disposition: "unavailable",
        preferredProviderId: undefined,
        releaseEvidence: "not-applicable"
      })
    });

    expect(result.availability).toBe("unavailable");
    expect(result.missingRequiredCapabilityIds).toEqual(["required-a"]);
    expect(result.missingRecommendedCapabilityIds).toEqual(["recommended-a"]);
  });

  it.each([
    ["duplicate capability bindings", (base: TestInput): Partial<TestInput> => ({
      installed: { bindings: [
        { capabilityId: "required-a", providerId: "provider-required-a" },
        { capabilityId: "required-a", providerId: "provider-required-a" }
      ], failures: [] }
    })],
    ["unlisted installed provider", (_base: TestInput): Partial<TestInput> => ({
      installed: { bindings: [{ capabilityId: "required-a", providerId: "unlisted-provider" }], failures: [] }
    })],
    ["ineligible installed binding without a failure", (base: TestInput): Partial<TestInput> => ({
      eligibility: replaceEligibility(base.eligibility, "provider-required-a", "required-a", { eligible: false }),
      installed: { bindings: [{ capabilityId: "required-a", providerId: "provider-required-a" }], failures: [] }
    })],
    ["failure unrelated to a pack binding", (_base: TestInput): Partial<TestInput> => ({
      installed: { bindings: [], failures: [{ ...target, providerId: "provider-not-in-pack", reason: "deleted" }] }
    })],
    ["duplicate provider failures", (_base: TestInput): Partial<TestInput> => ({
      installed: { bindings: [{ capabilityId: "required-a", providerId: "provider-required-a" }], failures: [
        { ...target, providerId: "provider-required-a", reason: "deleted" },
        { ...target, providerId: "provider-required-a", reason: "revoked" }
      ] }
    })],
    ["wrong-target installed failure", (_base: TestInput): Partial<TestInput> => ({
      installed: { bindings: [], failures: [{ runtime: "claude-code", platform: "darwin", providerId: "provider-required-a", reason: "deleted" }]
        .map((failure) => ({ ...failure, platform: "linux" as never })) as TestInstalledHealth["failures"] }
    })]
  ])("rejects invalid health input: %s", (_name, mutate) => {
    const base = input();
    expect(() => derive(mutate(base))).toThrow(/installed/i);
  });

  it("rejects an installed binding when eligibility exists only for another target", () => {
    const base = input();
    const records = replaceEligibility(base.eligibility, "provider-required-a", "required-a", {
      target: { runtime: "codex", platform: "darwin" }
    });
    expect(() => derive({
      eligibility: records,
      installed: { bindings: [{ capabilityId: "required-a", providerId: "provider-required-a" }], failures: [] }
    })).toThrow(/target/i);
  });

  it("rejects duplicate selection IDs even when their capability-target cells differ", () => {
    const base = input();
    expect(() => derive({
      selections: replaceSelection(base.selections, "required-b", { id: "selection-required-a" })
    })).toThrow(/duplicate selection/i);
  });

  it.each([
    ["selected route with terminal reviews", "required-a", {
      terminalReviewIds: ["terminal-selected"]
    }],
    ["alternate route with terminal reviews", "recommended-a", {
      disposition: "alternate" as const,
      terminalReviewIds: ["terminal-alternate"]
    }],
    ["rejected route without terminal reviews", "required-a", {
      disposition: "rejected" as const,
      preferredProviderId: undefined,
      alternateProviderIds: [],
      terminalReviewIds: [],
      releaseEvidence: "not-applicable" as const
    }],
    ["rejected route with trial evidence", "required-a", {
      disposition: "rejected" as const,
      preferredProviderId: undefined,
      alternateProviderIds: [],
      terminalReviewIds: ["terminal-rejected"],
      releaseEvidence: "trialed-p04" as const
    }],
    ["unavailable route with terminal reviews", "required-a", {
      disposition: "unavailable" as const,
      preferredProviderId: undefined,
      alternateProviderIds: [],
      terminalReviewIds: ["terminal-unavailable"],
      releaseEvidence: "not-applicable" as const
    }],
    ["unavailable route with trial evidence", "required-a", {
      disposition: "unavailable" as const,
      preferredProviderId: undefined,
      alternateProviderIds: [],
      terminalReviewIds: [],
      releaseEvidence: "trialed-p04" as const
    }]
  ])("rejects malformed terminal disposition tuple: %s", (_name, capabilityId, overrides) => {
    const base = input();
    expect(() => derive({
      selections: replaceSelection(base.selections, capabilityId, overrides)
    })).toThrow(/selection.*(terminal|trialed-p04|not-applicable)/i);
  });

  it.each([
    ["missing selection", /selection.*required-a/i, (base: TestInput): Partial<TestInput> => ({
      selections: base.selections.filter((current) => current.capabilityId !== "required-a")
    })],
    ["duplicate selection", /duplicate.*selection/i, (base: TestInput): Partial<TestInput> => ({
      selections: [...base.selections, selection("required-a")]
    })],
    ["duplicate provider", /duplicate.*provider/i, (base: TestInput): Partial<TestInput> => ({
      providers: [...base.providers, provider("provider-required-a")]
    })],
    ["duplicate eligibility", /duplicate.*eligibility/i, (base: TestInput): Partial<TestInput> => ({
      eligibility: [...base.eligibility, eligibility("provider-required-a", "required-a")]
    })],
    ["selected route without trial evidence", /trialed-p04/i, (base: TestInput): Partial<TestInput> => ({
      selections: replaceSelection(base.selections, "required-a", { releaseEvidence: "not-applicable" })
    })],
    ["selection for a different target", /selection.*target/i, (base: TestInput): Partial<TestInput> => ({
      selections: replaceSelection(base.selections, "required-a", { platform: "linux" })
    })]
  ])("rejects %s record input", (_name, expectedError, mutate) => {
    expect(() => derive(mutate(input()))).toThrow(expectedError);
  });
});
