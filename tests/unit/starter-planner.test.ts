import { describe, expect, it } from "vitest";
import { buildDecisionPlan, type BuildDecisionPlanInput } from "../../src/decision/planner.js";
import type {
  CandidateCapabilityEvidence,
  DecisionCandidateProjection,
  DecisionIndex,
  DecisionStarterRoute,
  IntentProfile
} from "../../src/model/decision.js";

describe("starter-partial decision planning", () => {
  it("prefers a genuine complete candidate over an authenticated starter-route candidate", () => {
    const starter = candidate("starter", ["commerce-core", "commerce-required"]);
    const complete = candidate("complete", ["commerce-core", "commerce-required"]);
    const plan = buildDecisionPlan(index({
      candidates: [starter, complete],
      routes: [route({ orderedCandidateIds: ["starter"] })]
    }), input());

    expect(plan).toMatchObject({
      status: "eligible-with-disclosures",
      planKind: "complete",
      primary: { id: "complete" },
      complement: null,
      broadCoverageComplete: true,
      smallestHonestProfile: null,
      directCapabilityIds: [],
      inferredCapabilityIds: [],
      relatedCapabilityIds: []
    });
  });

  it("returns an ordered, evidence-classified starter partial when no complete plan exists", () => {
    const plan = buildDecisionPlan(partialIndex(), input());

    expect(plan).toMatchObject({
      status: "eligible-with-disclosures",
      planKind: "starter-partial",
      selectionBasis: "explicit-domain",
      primary: { id: "starter-primary" },
      complement: { id: "starter-complement" },
      smallestHonestProfile: { ko: "매출을 확인합니다.", en: "Checks revenue." },
      broadCoverageComplete: false,
      coverageIncomplete: true,
      directCapabilityIds: ["commerce-core"],
      inferredCapabilityIds: ["commerce-required"],
      relatedCapabilityIds: ["commerce-related"],
      uncoveredCapabilityIds: ["commerce-related", "commerce-gap"]
    });
  });

  it("records an unambiguous reviewed goal match as the starter selection basis", () => {
    const plan = buildDecisionPlan(partialIndex(), {
      ...input(),
      domainIds: undefined,
      goal: "commerce goal"
    });

    expect(plan).toMatchObject({
      status: "eligible-with-disclosures",
      planKind: "starter-partial",
      selectionBasis: "goal-match",
      domainIds: ["commerce"]
    });
  });

  it.each([
    ["two selected domains", partialIndex({ profiles: [commerceProfile(), videoProfile()] }), {
      ...input(), domainIds: ["commerce", "video-and-audio"]
    }],
    ["ambiguous goal", partialIndex({ profiles: [commerceProfile(), {
      ...videoProfile(),
      phrases: { ko: ["공통"], en: ["commerce goal"] }
    }] }), {
      ...input(), domainIds: undefined, goal: "commerce goal"
    }],
    ["unmatched goal", partialIndex(), { ...input(), domainIds: undefined, goal: "unmatched goal" }],
    ["Codex", partialIndex(), { ...input(), runtime: "codex" as const }],
    ["Linux", partialIndex(), { ...input(), platform: "linux" as const }],
    ["expired catalog", partialIndex({ catalogExpiresAt: "2026-07-28T00:00:00Z" }), input()]
  ] satisfies Array<[string, DecisionIndex, BuildDecisionPlanInput]>)("does not return a starter partial for %s", (_label, fixture, planInput) => {
    const plan = buildDecisionPlan(fixture, planInput);

    expect(plan).toMatchObject({ status: "held", planKind: "complete", primary: null, complement: null });
    expect(plan.smallestHonestProfile).toBeNull();
  });

  it("holds when no route exists and no complete candidate plan exists", () => {
    const primary = candidate("starter-primary", ["commerce-core"]);
    const plan = buildDecisionPlan(index({ candidates: [primary] }), input());

    expect(plan).toMatchObject({ status: "held", planKind: "complete", primary: null, complement: null });
  });

  it.each(["held", "stale", "expired"] as const)("omits a %s route candidate and recomputes the partial coverage", (kind) => {
    const fixture = partialIndex();
    const primary = fixture.candidates.find(({ id }) => id === "starter-primary")!;
    if (kind === "held") {
      primary.state = "held";
      primary.stateReasons = ["held"];
    } else if (kind === "stale") {
      primary.stateReasons = ["eligible", "stale", "target-verified:claude-code/darwin"];
    } else {
      primary.eligibility = {
        reviewExpiresAt: "2026-07-29T00:00:00Z",
        targetExpiresAt: { darwin: "2026-08-01T00:00:00Z" }
      };
    }

    const plan = buildDecisionPlan(fixture, input());

    expect(plan).toMatchObject({
      status: "eligible-with-disclosures",
      planKind: "starter-partial",
      primary: { id: "starter-complement" },
      complement: null,
      directCapabilityIds: [],
      inferredCapabilityIds: ["commerce-required"],
      relatedCapabilityIds: ["commerce-related"],
      uncoveredCapabilityIds: ["commerce-core", "commerce-related", "commerce-gap"]
    });
    expect([plan.primary?.id, plan.complement?.id]).not.toContain(primary.id);
  });

  it("uses only current evidence and excludes a complement that no longer adds an association", () => {
    const fixture = partialIndex();
    fixture.candidateEvidence.find(({ id }) => id === "primary-direct-core")!.current = false;
    fixture.candidateEvidence.find(({ id }) => id === "complement-inferred-required")!.current = false;
    fixture.candidateEvidence.find(({ id }) => id === "complement-related")!.current = false;

    const plan = buildDecisionPlan(fixture, input());

    expect(plan).toMatchObject({
      status: "eligible-with-disclosures",
      planKind: "starter-partial",
      primary: { id: "starter-primary" },
      complement: null,
      directCapabilityIds: [],
      inferredCapabilityIds: ["commerce-core"],
      relatedCapabilityIds: [],
      uncoveredCapabilityIds: ["commerce-required", "commerce-related", "commerce-gap"]
    });
  });

  it("holds with the full starter taxonomy uncovered when no current route association survives", () => {
    const fixture = partialIndex();
    for (const candidate of fixture.candidates) {
      candidate.state = "held";
      candidate.stateReasons = ["held"];
    }

    const plan = buildDecisionPlan(fixture, input());

    expect(plan).toMatchObject({
      status: "held",
      planKind: "complete",
      broadCoverageComplete: false,
      primary: null,
      complement: null,
      directCapabilityIds: [],
      inferredCapabilityIds: [],
      relatedCapabilityIds: [],
      uncoveredCapabilityIds: ["commerce-core", "commerce-required", "commerce-related", "commerce-gap"]
    });
  });

  it("holds a related-only route instead of selecting it as an executable starter partial", () => {
    const fixture = partialIndex();
    const starterRoute = fixture.starterRoutes![0]!;
    starterRoute.directEvidenceIds = [];
    starterRoute.inferredEvidenceIds = [];
    starterRoute.relatedEvidenceIds = ["complement-related"];

    const plan = buildDecisionPlan(fixture, input());

    expect(plan).toMatchObject({
      status: "held",
      planKind: "complete",
      primary: null,
      complement: null,
      directCapabilityIds: [],
      inferredCapabilityIds: [],
      relatedCapabilityIds: []
    });
    expect(plan.uncoveredCapabilityIds).toEqual([
      "commerce-related",
      "commerce-gap"
    ]);
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

function partialIndex(options: {
  profiles?: IntentProfile[];
  catalogExpiresAt?: string;
} = {}): DecisionIndex {
  const primary = candidate("starter-primary", ["commerce-core"]);
  const complement = candidate("starter-complement", ["commerce-required", "commerce-related"]);
  return index({
    ...options,
    candidates: [primary, complement],
    routes: [route({ orderedCandidateIds: [primary.id, complement.id] })],
    evidence: [
      evidence("primary-direct-core", primary.id, "commerce-core", "direct"),
      evidence("primary-inferred-core", primary.id, "commerce-core", "inferred"),
      evidence("complement-inferred-required", complement.id, "commerce-required", "inferred"),
      evidence("complement-related", complement.id, "commerce-related", "related")
    ]
  });
}

function index(options: {
  candidates: DecisionCandidateProjection[];
  profiles?: IntentProfile[];
  routes?: DecisionStarterRoute[];
  evidence?: CandidateCapabilityEvidence[];
  catalogExpiresAt?: string;
}): DecisionIndex {
  const evidence = options.evidence ?? [];
  const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
  for (const candidate of options.candidates) {
    candidate.capabilityEvidenceIds = evidence
      .filter((item) => item.candidateId === candidate.id)
      .map((item) => item.id);
  }
  return {
    schemaVersion: 3,
    catalogVersion: "test-catalog",
    observedThrough: "2026-07-29T00:00:00Z",
    catalogExpiresAt: options.catalogExpiresAt ?? "2026-08-07T00:00:00Z",
    profiles: options.profiles ?? [commerceProfile()],
    candidates: options.candidates,
    candidateEvidence: evidence.map((item) => ({
      ...item,
      candidate: candidateById.get(item.candidateId)!
    })),
    intentFixtures: [],
    ...(options.routes === undefined ? {} : { starterRoutes: options.routes }),
    digest: "0".repeat(64)
  };
}

function commerceProfile(): IntentProfile {
  return {
    id: "commerce",
    domainId: "commerce",
    phrases: { ko: ["상거래 목표"], en: ["commerce goal"] },
    coreCapabilityId: "commerce-core",
    requiredCapabilityIds: ["commerce-required"]
  };
}

function videoProfile(): IntentProfile {
  return {
    id: "video",
    domainId: "video-and-audio",
    phrases: { ko: ["영상 목표"], en: ["video goal"] },
    coreCapabilityId: "video-core",
    requiredCapabilityIds: ["video-required"]
  };
}

function route(options: Pick<DecisionStarterRoute, "orderedCandidateIds">): DecisionStarterRoute {
  return {
    domainId: "commerce",
    kind: "starter-partial",
    orderedCandidateIds: options.orderedCandidateIds,
    smallestHonestProfile: { ko: "매출을 확인합니다.", en: "Checks revenue." },
    directEvidenceIds: ["primary-direct-core"],
    inferredEvidenceIds: ["primary-inferred-core", "complement-inferred-required"],
    relatedEvidenceIds: ["complement-related"],
    unsupportedCapabilityIds: ["commerce-related", "commerce-gap"],
    broadCoverageComplete: false
  };
}

function candidate(id: string, providedCapabilityIds: string[]): DecisionCandidateProjection {
  return {
    id,
    sourceId: `${id}-source`,
    skillPath: `skills/${id}/SKILL.md`,
    runtime: "claude-code",
    state: "eligible-with-disclosures",
    stateReasons: ["eligible", "target-verified:claude-code/darwin"],
    providedCapabilityIds,
    capabilityEvidenceIds: [],
    revisionBinding: "exact",
    permissions: { status: "observed", value: [], evidence: [] },
    license: { status: "observed", value: "MIT", evidence: [] },
    trust: { status: "observed", value: "reviewed", evidence: [] },
    dependencies: { status: "observed", value: [], evidence: [] }
  };
}

function evidence(
  id: string,
  candidateId: string,
  capabilityId: string,
  support: NonNullable<CandidateCapabilityEvidence["support"]>
): CandidateCapabilityEvidence {
  return {
    id,
    candidateId,
    capabilityId,
    kind: "official-listing",
    current: true,
    reference: "marketplace#/plugins/1/description",
    contentSha256: "a".repeat(64),
    support,
    listingExcerpt: "commerce",
    listingExcerptSha256: "b".repeat(64)
  };
}
