import { describe, expect, it } from "vitest";
import { normalizePhrase } from "../../src/decision/normalize.js";
import { buildDecisionPlan, type BuildDecisionPlanInput } from "../../src/decision/planner.js";
import type {
  DecisionCandidateProjection,
  DecisionIndex,
  IntentProfile
} from "../../src/model/decision.js";

describe("decision plan engine", () => {
  it("normalizes NFKC, case, punctuation, and whitespace before intent matching", () => {
    expect(normalizePhrase("  VIDEO\u3000editing,  YouTube Shorts! ")).toBe("video editing youtube shorts");
  });

  it("uses the longest matching phrase", () => {
    const plan = buildDecisionPlan(index([
      profile("commerce-short", "commerce", ["product promotion"], "commerce-core", ["commerce-required"]),
      profile("commerce-long", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required"])
    ], [candidate("commerce-full", ["commerce-core", "commerce-required"])]), {
      ...input(),
      domainIds: undefined,
      goal: "Ecommerce product promotion"
    });

    expect(plan).toMatchObject({ domainIds: ["commerce"], status: "eligible-with-disclosures" });
  });

  it("asks for a domain selection when equally-long phrases conflict", () => {
    const plan = buildDecisionPlan(index([
      profile("commerce-conflict", "commerce", ["shared phrase"], "commerce-core", ["commerce-required"]),
      profile("video-conflict", "video-and-audio", ["shared phrase"], "video-core", ["video-required"])
    ], [candidate("commerce-full", ["commerce-core", "commerce-required"])]), {
      ...input(),
      domainIds: undefined,
      goal: "shared phrase"
    });

    expect(plan).toMatchObject({
      status: "held",
      primary: null,
      complement: null,
      requiresDomainPrioritySelection: true
    });
  });

  it("adds a complement only when it closes required coverage", () => {
    const plan = buildDecisionPlan(indexWithRedundantSecondCandidate(), input());

    expect(plan.primary).not.toBeNull();
    expect(plan.primary!.id).toBe("commerce-full");
    expect(plan.complement).toBeNull();
    expect(plan.status).toBe("eligible-with-disclosures");
  });

  it("does not let a relevance-only candidate satisfy ordinary planner coverage", () => {
    const plan = buildDecisionPlan(index([
      profile("commerce", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required"])
    ], [candidate("commerce-related-only", [])]), input());

    expect(plan).toMatchObject({
      status: "held",
      coverageIncomplete: true,
      primary: null,
      complement: null,
      uncoveredCapabilityIds: ["commerce-core", "commerce-required"]
    });
  });

  it("holds a two-domain plan when two candidates do not cover both profiles", () => {
    const plan = buildDecisionPlan(incompletePairIndex(), twoDomainInput());

    expect(plan).toMatchObject({
      status: "held",
      coverageIncomplete: true,
      primary: null,
      complement: null
    });
    expect(plan.uncoveredCapabilityIds).toEqual(expect.arrayContaining(["commerce-required", "video-required"]));
  });

  it("reports the best allowed set's uncovered capabilities instead of the aggregate eligible union", () => {
    const plan = buildDecisionPlan(threeCandidateAggregateIndex(), twoDomainInput());

    expect(plan).toMatchObject({
      status: "held",
      coverageIncomplete: true,
      primary: null,
      complement: null
    });
    expect(plan.uncoveredCapabilityIds).toEqual(["video-required"]);
  });

  it("reports the best allowed complement's uncovered capabilities for an incomplete single domain", () => {
    const plan = buildDecisionPlan(singleDomainAggregateIndex(), input());

    expect(plan).toMatchObject({
      status: "held",
      coverageIncomplete: true,
      primary: null,
      complement: null
    });
    expect(plan.uncoveredCapabilityIds).toEqual(["commerce-required-c"]);
  });

  it("uses the requested platform verification marker when selecting eligible candidates", () => {
    const fixture = index([
      profile("commerce", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required"])
    ], [
      candidate("darwin-full", ["commerce-core", "commerce-required"], ["darwin"]),
      candidate("linux-full", ["commerce-core", "commerce-required"], ["linux"])
    ]);

    expect(buildDecisionPlan(fixture, { ...input(), platform: "darwin" })).toMatchObject({
      status: "eligible-with-disclosures",
      primary: expect.objectContaining({ id: "darwin-full" })
    });
    expect(buildDecisionPlan(fixture, { ...input(), platform: "linux" })).toMatchObject({
      status: "eligible-with-disclosures",
      primary: expect.objectContaining({ id: "linux-full" })
    });
    expect(buildDecisionPlan(fixture, { ...input(), platform: "win32" })).toMatchObject({
      status: "held",
      primary: null,
      complement: null,
      coverageIncomplete: true
    });
  });

  it("requires a priority selection and emits no plan for more than two domains", () => {
    const plan = buildDecisionPlan(indexWithRedundantSecondCandidate(), {
      ...input(),
      domainIds: ["commerce", "video-and-audio", "software-engineering"]
    });

    expect(plan).toMatchObject({
      status: "held",
      primary: null,
      complement: null,
      requiresDomainPrioritySelection: true
    });
  });

  it.each([
    ["ecommerce product promotion", "commerce"],
    ["VIDEO editing, YouTube Shorts!", "video-and-audio"]
  ] as const)("keeps the %s regression goal in %s", (goal, domainId) => {
    const plan = buildDecisionPlan(regressionIndex(), { ...input(), domainIds: undefined, goal });

    expect(plan).toMatchObject({
      domainIds: [domainId],
      status: "eligible-with-disclosures",
      coverageIncomplete: false
    });
  });

  it("uses shared Korean goal normalization instead of a setup-only particle workaround", () => {
    const commerce = profile(
      "commerce",
      "commerce",
      ["ecommerce product promotion"],
      "commerce-core",
      ["commerce-required"]
    );
    commerce.phrases.ko = ["쇼핑몰 운영"];

    const plan = buildDecisionPlan(index([commerce], [candidate("commerce-full", ["commerce-core", "commerce-required"])]), {
      ...input(),
      domainIds: undefined,
      goal: "쇼핑몰을 운영하고 싶어요"
    });

    expect(plan).toMatchObject({
      status: "eligible-with-disclosures",
      domainIds: ["commerce"],
      holdReasons: [],
      excludedCandidates: []
    });
  });

  it("holds a plan before the catalog observation and exposes its current candidate reason", () => {
    const pending = candidate("commerce-pending", ["commerce-core", "commerce-required"], []);
    pending.state = "held";
    pending.stateReasons = ["target-unknown:claude-code/darwin"];
    const plan = buildDecisionPlan(index([
      profile("commerce", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required"])
    ], [pending]), {
      ...input(),
      asOf: "2026-07-28T23:59:59Z"
    });

    expect(plan).toMatchObject({
      status: "held",
      holdReasons: ["catalog-not-current"],
      excludedCandidates: [{
        candidateId: "commerce-pending",
        sourceId: "commerce-pending-source",
        state: "held",
        stateReasons: ["target-unknown:claude-code/darwin"]
      }]
    });
  });

  it("does not let a blocked candidate poison an unrelated eligible source", () => {
    const blocked = candidate("commerce-blocked", ["commerce-core", "commerce-required"]);
    blocked.sourceId = "blocked-source";
    blocked.state = "blocked";
    blocked.stateReasons = ["review-blocked"];
    const allowed = candidate("commerce-allowed", ["commerce-core", "commerce-required"]);
    allowed.sourceId = "allowed-source";
    const plan = buildDecisionPlan(index([
      profile("commerce", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required"])
    ], [blocked, allowed]), input());

    expect(plan).toMatchObject({
      status: "eligible-with-disclosures",
      primary: { id: "commerce-allowed" },
      holdReasons: [],
      excludedCandidates: [{
        candidateId: "commerce-blocked",
        sourceId: "blocked-source",
        state: "blocked",
        stateReasons: ["review-blocked"]
      }]
    });
  });

  it("does not match reviewed phrases inside a larger token", () => {
    const plan = buildDecisionPlan(index([
      profile("data", "data-and-analytics", ["data analysis"], "data-core", ["data-required"])
    ], [candidate("data-full", ["data-core", "data-required"])]), {
      ...input(),
      domainIds: undefined,
      goal: "metadata analysis migration"
    });

    expect(plan).toMatchObject({
      status: "held",
      domainIds: [],
      holdReasons: ["domain-selection-required"]
    });
  });

  it("holds a candidate after its authenticated target or review expiry", () => {
    const expiring = candidate("commerce-expiring", ["commerce-core", "commerce-required"]);
    expiring.eligibility = {
      reviewExpiresAt: "2026-07-30T00:00:00Z",
      targetExpiresAt: { darwin: "2026-07-31T00:00:00Z" }
    };
    const fixture = index([
      profile("commerce", "commerce", ["commerce"], "commerce-core", ["commerce-required"])
    ], [expiring]);

    expect(buildDecisionPlan(fixture, {
      ...input(),
      asOf: "2026-07-29T23:59:59Z"
    }).status).toBe("eligible-with-disclosures");
    expect(buildDecisionPlan(fixture, {
      ...input(),
      asOf: "2026-07-30T00:00:00Z"
    })).toMatchObject({
      status: "held",
      primary: null,
      holdReasons: ["eligible-candidate-coverage-incomplete"],
      excludedCandidates: [expect.objectContaining({
        candidateId: "commerce-expiring",
        stateReasons: expect.arrayContaining(["review-expired"])
      })]
    });
  });

  it("uses authenticated target and review recency before stable IDs", () => {
    const older = candidate("alpha", ["commerce-core", "commerce-required"]);
    older.ranking = {
      targetEvidenceAt: { darwin: "2026-07-27T00:00:00Z" },
      reviewedAt: "2026-07-27T00:00:00Z"
    };
    const newer = candidate("zeta", ["commerce-core", "commerce-required"]);
    newer.ranking = {
      targetEvidenceAt: { darwin: "2026-07-28T00:00:00Z" },
      reviewedAt: "2026-07-28T00:00:00Z"
    };

    const plan = buildDecisionPlan(index([
      profile("commerce", "commerce", ["commerce"], "commerce-core", ["commerce-required"])
    ], [older, newer]), { ...input(), goal: "commerce" });

    expect(plan.primary?.id).toBe("zeta");
  });

  it("uses authenticated display name and description overlap before stable IDs", () => {
    const alpha = candidate("alpha", ["commerce-core", "commerce-required"]);
    alpha.displayName = "Generic toolkit";
    alpha.description = "Unrelated operational utilities";
    const zeta = candidate("zeta", ["commerce-core", "commerce-required"]);
    zeta.displayName = "Commerce toolkit";
    zeta.description = "Commerce growth and promotion workflows";

    const plan = buildDecisionPlan(index([
      profile("commerce", "commerce", ["commerce"], "commerce-core", ["commerce-required"])
    ], [alpha, zeta]), { ...input(), goal: "commerce growth" });

    expect(plan.primary?.id).toBe("zeta");
  });

  it("does not add a complement when meaningful ranking signals are tied", () => {
    const primary = candidate("primary", ["commerce-core", "commerce-required-a"]);
    const alpha = candidate("alpha", ["commerce-required-b"]);
    const zeta = candidate("zeta", ["commerce-required-b"]);
    const fixture = index([
      profile("commerce", "commerce", ["commerce"], "commerce-core", ["commerce-required-a", "commerce-required-b"])
    ], [primary, alpha, zeta]);

    expect(buildDecisionPlan(fixture, input())).toMatchObject({
      status: "held",
      primary: null,
      complement: null,
      holdReasons: ["candidate-selection-tie"]
    });
  });
});

function input(): BuildDecisionPlanInput {
  return {
    domainIds: ["commerce"],
    runtime: "claude-code",
    platform: "darwin",
    asOf: "2026-07-29T00:00:00Z"
  };
}

function twoDomainInput(): BuildDecisionPlanInput {
  return { ...input(), domainIds: ["commerce", "video-and-audio"] };
}

function indexWithRedundantSecondCandidate(): DecisionIndex {
  return index([
    profile("commerce", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required-a", "commerce-required-b"])
  ], [
    candidate("commerce-full", ["commerce-core", "commerce-required-a", "commerce-required-b"]),
    candidate("commerce-redundant", ["commerce-required-a"])
  ]);
}

function incompletePairIndex(): DecisionIndex {
  return index([
    profile("commerce", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required"]),
    profile("video", "video-and-audio", ["video editing"], "video-core", ["video-required"])
  ], [
    candidate("commerce-core-only", ["commerce-core"]),
    candidate("video-core-only", ["video-core"])
  ]);
}

function threeCandidateAggregateIndex(): DecisionIndex {
  return index([
    profile("commerce", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required"]),
    profile("video", "video-and-audio", ["video editing"], "video-core", ["video-required"])
  ], [
    candidate("commerce-full", ["commerce-core", "commerce-required"]),
    candidate("video-core-only", ["video-core"]),
    candidate("video-required-only", ["video-required"])
  ]);
}

function singleDomainAggregateIndex(): DecisionIndex {
  return index([
    profile(
      "commerce",
      "commerce",
      ["ecommerce product promotion"],
      "commerce-core",
      ["commerce-required-a", "commerce-required-b", "commerce-required-c"]
    )
  ], [
    candidate("commerce-primary", ["commerce-core", "commerce-required-a"]),
    candidate("commerce-best-complement", ["commerce-required-b"]),
    candidate("commerce-third", ["commerce-required-c"])
  ]);
}

function regressionIndex(): DecisionIndex {
  return index([
    profile("commerce", "commerce", ["ecommerce product promotion"], "commerce-core", ["commerce-required"]),
    profile("video", "video-and-audio", ["video editing", "youtube shorts"], "video-core", ["video-required"])
  ], [
    candidate("commerce-full", ["commerce-core", "commerce-required"]),
    candidate("video-full", ["video-core", "video-required"])
  ]);
}

function index(profiles: IntentProfile[], candidates: DecisionCandidateProjection[]): DecisionIndex {
  return {
    schemaVersion: 3,
    catalogVersion: "test-catalog",
    observedThrough: "2026-07-29T00:00:00Z",
    catalogExpiresAt: "2026-08-07T00:00:00Z",
    profiles,
    candidates,
    candidateEvidence: [],
    intentFixtures: [],
    digest: "0".repeat(64)
  };
}

function profile(
  id: string,
  domainId: IntentProfile["domainId"],
  phrases: string[],
  coreCapabilityId: string,
  requiredCapabilityIds: string[]
): IntentProfile {
  return {
    id,
    domainId,
    phrases: { ko: ["\uac80\uc0c9 \ud14c\uc2a4\ud2b8"], en: phrases },
    coreCapabilityId,
    requiredCapabilityIds
  };
}

function candidate(
  id: string,
  providedCapabilityIds: string[],
  platforms: Array<"darwin" | "linux" | "win32"> = ["darwin"]
): DecisionCandidateProjection {
  return {
    id,
    sourceId: `${id}-source`,
    skillPath: "skills/example/SKILL.md",
    runtime: "claude-code",
    state: "eligible-with-disclosures",
    stateReasons: ["eligible", ...platforms.map((platform) => `target-verified:claude-code/${platform}`)],
    providedCapabilityIds,
    capabilityEvidenceIds: ["evidence-a"],
    revisionBinding: "exact",
    permissions: { status: "observed", value: [], evidence: [] },
    license: { status: "observed", value: "MIT", evidence: [] },
    trust: { status: "observed", value: "reviewed", evidence: [] },
    dependencies: { status: "observed", value: [], evidence: [] }
  };
}
