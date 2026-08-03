import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTestTimeout } from "../../vitest.config.js";
import { buildDecisionIntentFixtures } from "../../src/decision/index-loader.js";
import { decisionIndexDigest } from "../../src/decision/index-loader.js";
import { normalizeGoalForRouting } from "../../src/decision/normalize.js";
import { buildDecisionPlan } from "../../src/decision/planner.js";
import { loadDecisionIndex } from "../../src/decision/repository.js";
import type { DomainId } from "../../src/model/complete-v1.js";
import type {
  DecisionCandidateProjection,
  DecisionIndex,
  DecisionIntentFixture,
  DecisionPlan,
  DecisionState,
} from "../../src/model/decision.js";
import { createApprovedOfficialDecisionIndexSetFixture } from "../helpers/official-marketplace-fixture.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type SetupDecisionStatus =
  | "awaiting-domain-selection"
  | "awaiting-domain-priority"
  | "awaiting-probe-consent"
  | "held"
  | "blocked"
  | "awaiting-risk-acknowledgement"
  | "awaiting-approval"
  | "executed"
  | "execution-failed";

interface SetupDecisionFixture {
  language: "ko" | "en";
  goal?: string;
  domainIds?: DomainId[];
  domainPriority?: DomainId[];
  platform: DecisionIntentFixture["platform"];
  timeProbe: { consent: "granted"; utcTimestamp: string };
  riskAcknowledged: true;
}

interface SetupParityPlan {
  status: SetupDecisionStatus;
  holdReason: string | null;
  holdReasons: string[];
  decisionPlan: DecisionPlan | null;
  domainIds: DomainId[];
  candidates: DecisionPlan["primary"][];
  excludedCandidates: DecisionPlan["excludedCandidates"];
  approvalBinding: {
    preview: {
      selectedDomainIds: DomainId[];
      decisionIndexDigest: string;
      candidates: unknown[];
      executionOrder: string[];
      statePublisher: null | object;
    };
  };
  approvalValid: boolean;
  executionCapability: null | object;
  requiresDomainPrioritySelection: boolean;
  requiresSeparateApproval: true;
  executionStatus: "not-executed" | "executed" | "failed";
  commandReceipts: unknown[];
  installReceipts: unknown[];
}

type SetupDecisionEvaluator = (
  index: DecisionIndex,
  fixture: SetupDecisionFixture
) => Promise<SetupParityPlan>;

type SurfaceParityClassification = "exact-plan";

describe("decision broker and setup surface parity", () => {
  it("authenticates the complete generated corpus and classifies every Claude fixture through setup", async () => {
    const index = await loadDecisionIndex(projectRoot);
    const expectedFixtures = buildDecisionIntentFixtures(index.profiles, index.observedThrough);
    expect(index.intentFixtures).toEqual(expectedFixtures);

    const evaluateSetupDecisionFixture = await loadSetupDecisionEvaluator();
    const observedStates = new Set<DecisionState>();
    const stateCounts = new Map<DecisionState, number>();
    const claudeClassifications = new Map<string, SurfaceParityClassification>();

    for (const fixture of index.intentFixtures) {
      const decisionPlan = buildPlanForFixture(index, fixture);
      expect([decisionPlan.primary, decisionPlan.complement].filter(Boolean).length, fixture.id).toBeLessThanOrEqual(2);
      expect(decisionPlan.executionStatus, fixture.id).toBe("not-executed");
      if (fixture.runtime !== "claude-code") continue;
      const setupPlan = await evaluateSetupDecisionFixture(index, setupFixtureFor(fixture));
      observedStates.add(decisionPlan.status);
      stateCounts.set(decisionPlan.status, (stateCounts.get(decisionPlan.status) ?? 0) + 1);
      claudeClassifications.set(fixture.id, classifySurfaceParity(fixture.id, decisionPlan, setupPlan));
    }

    expect(index.intentFixtures.filter(({ runtime }) => runtime === "claude-code")).toHaveLength(484);
    expect(index.candidates).toHaveLength(35);
    expect(index.candidates.every(({ state }) => state === "held")).toBe(true);
    expect(index.candidates.filter(({ claudeInstall }) => claudeInstall !== undefined)).toHaveLength(0);
    expect(index.starterRoutes).toHaveLength(20);
    expect(claudeClassifications.size).toBe(484);
    expect(new Set(claudeClassifications.values())).toEqual(new Set(["exact-plan"]));
    expect(observedStates).toEqual(new Set(["held"]));
    expect(stateCounts.get("held")).toBe(484);
  }, resolveTestTimeout(process.env.CI, 10_000, 60_000));

  it("keeps every approved Korean and English phrase on the same broker and setup route", async () => {
    const index = await isolatedApprovedIndex();
    const evaluateSetupDecisionFixture = await loadSetupDecisionEvaluator();
    expect(index.profiles).toHaveLength(20);

    for (const profile of index.profiles) {
      for (const language of ["ko", "en"] as const) {
        for (const goal of profile.phrases[language]) {
          const decisionPlan = buildDecisionPlan(index, {
            goal,
            runtime: "claude-code",
            platform: "darwin",
            asOf: index.observedThrough
          });
          const setupPlan = await evaluateSetupDecisionFixture(index, {
            language,
            goal,
            platform: "darwin",
            timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
            riskAcknowledged: true
          });

          expect(decisionPlan.domainIds, `${language}:${goal}`).toEqual([profile.domainId]);
          expect(setupPlan.decisionPlan, `${language}:${goal}`).toEqual(decisionPlan);
          expect(setupPlan.status, `${language}:${goal}`).toBe(expectedSetupStatus(decisionPlan));
        }
      }
    }
  });

  it("normalizes punctuation before bounded Korean particle removal across both surfaces", async () => {
    const index = await isolatedApprovedIndex();
    const evaluateSetupDecisionFixture = await loadSetupDecisionEvaluator();
    const goal = "시장을, 조사하고 근거를 검증해.";
    const decisionPlan = buildDecisionPlan(index, {
      goal,
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    });
    const setupPlan = await evaluateSetupDecisionFixture(index, {
      language: "ko",
      goal,
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    });

    expect(normalizeGoalForRouting(goal)).toBe("시장 조사 근거 검증해");
    expect(decisionPlan).toMatchObject({
      domainIds: ["research-and-intelligence"],
      status: "eligible-with-disclosures",
      primary: { id: "exa" },
      complement: null
    });
    expect(setupPlan.decisionPlan).toEqual(decisionPlan);
    expect(setupPlan.status).toBe("awaiting-approval");
  });

  it("holds an equal-length tie on both broker and setup surfaces", async () => {
    const index = withTiePhrases(await loadDecisionIndex(projectRoot));
    const evaluateSetupDecisionFixture = await loadSetupDecisionEvaluator();
    const goal = "alpha route omega";
    const decisionPlan = buildDecisionPlan(index, {
      goal,
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    });
    const setupPlan = await evaluateSetupDecisionFixture(index, {
      language: "en",
      goal,
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    });

    expect(decisionPlan).toMatchObject({
      status: "held",
      domainIds: ["video-and-audio", "commerce"],
      holdReasons: ["domain-priority-required"]
    });
    expect(setupPlan).toMatchObject({
      status: "awaiting-domain-priority",
      domainIds: ["video-and-audio", "commerce"],
      holdReason: "domain-priority-required",
      requiresDomainPrioritySelection: true,
      decisionPlan
    });
    expect(setupPlan.candidates).toEqual([]);
    expect(setupPlan.approvalBinding.preview.executionOrder).toEqual([]);
  });

  it("does not strip whole Korean tokens or guess an unclassified goal", async () => {
    const index = await loadDecisionIndex(projectRoot);
    const evaluateSetupDecisionFixture = await loadSetupDecisionEvaluator();
    const goal = "과, 이메일.";
    const decisionPlan = buildDecisionPlan(index, {
      goal,
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    });
    const setupPlan = await evaluateSetupDecisionFixture(index, {
      language: "ko",
      goal,
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    });

    expect(normalizeGoalForRouting(goal)).toBe("과 이메일");
    expect(decisionPlan).toMatchObject({ status: "held", domainIds: [], holdReasons: ["domain-selection-required"] });
    expect(setupPlan).toMatchObject({
      status: "awaiting-domain-selection",
      domainIds: [],
      holdReason: "domain-selection-required",
      decisionPlan
    });
    expect(setupPlan.candidates).toEqual([]);
    expect(setupPlan.approvalBinding.preview.executionOrder).toEqual([]);
  });

  it("preserves broker plans before and after a three-domain priority selection", async () => {
    const index = await loadDecisionIndex(projectRoot);
    const evaluateSetupDecisionFixture = await loadSetupDecisionEvaluator();
    const domainIds: DomainId[] = ["commerce", "video-and-audio", "software-engineering"];
    const domainPriority: DomainId[] = ["video-and-audio", "commerce"];
    const common = {
      runtime: "claude-code" as const,
      platform: "darwin" as const,
      asOf: index.observedThrough
    };
    const heldPlan = buildDecisionPlan(index, { domainIds, ...common });
    const selectedPlan = buildDecisionPlan(index, { domainIds, domainPriority, ...common });
    const heldSetup = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds,
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    });
    const selectedSetup = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds,
      domainPriority,
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    });

    expect(heldPlan).toMatchObject({
      status: "held",
      domainIds,
      holdReasons: ["domain-priority-required"],
      requiresDomainPrioritySelection: true
    });
    expect(heldSetup).toMatchObject({
      status: "awaiting-domain-priority",
      holdReason: "domain-priority-required",
      decisionPlan: heldPlan,
      candidates: []
    });
    expect(selectedPlan.domainIds).toEqual(domainPriority);
    expect(selectedSetup.decisionPlan).toEqual(selectedPlan);
    expect(selectedSetup.domainIds).toEqual(domainPriority);
    expect(selectedSetup.candidates).toHaveLength(
      [selectedPlan.primary, selectedPlan.complement].filter(Boolean).length
    );
    expect(selectedSetup.candidates.length).toBeLessThanOrEqual(2);
  });

  it("keeps a blocked source visible but does not block an unrelated eligible selection", async () => {
    const index = withBlockedResearchCandidate(await isolatedApprovedIndex());
    const evaluateSetupDecisionFixture = await loadSetupDecisionEvaluator();
    const decisionPlan = buildDecisionPlan(index, {
      domainIds: ["research-and-intelligence"],
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    });
    const setupPlan = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds: ["research-and-intelligence"],
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    });

    expect(decisionPlan).toMatchObject({
      status: "eligible-with-disclosures",
      primary: { id: "exa" },
      excludedCandidates: [expect.objectContaining({
        candidateId: "blocked-research-candidate",
        sourceId: "blocked-research-source",
        state: "blocked",
        stateReasons: ["review-blocked"]
      })]
    });
    expect(setupPlan.decisionPlan).toEqual(decisionPlan);
    expect(setupPlan.status).toBe("awaiting-approval");
  });

  it.each([
    ["past", "past", "darwin", "catalog-not-current"],
    ["expired", "expired", "darwin", "catalog-expired"],
    ["unknown target", "current", "linux", "eligible-candidate-coverage-incomplete"]
  ] as const)("keeps %s time or target decision reasons through setup", async (_label, time, platform, holdReason) => {
    const index = await loadDecisionIndex(projectRoot);
    const asOf = time === "past"
      ? secondsBefore(index.observedThrough, 1)
      : time === "expired"
        ? index.catalogExpiresAt
        : index.observedThrough;
    const evaluateSetupDecisionFixture = await loadSetupDecisionEvaluator();
    const decisionPlan = buildDecisionPlan(index, {
      domainIds: ["commerce"],
      runtime: "claude-code",
      platform,
      asOf
    });
    const setupPlan = await evaluateSetupDecisionFixture(index, {
      language: "en",
      domainIds: ["commerce"],
      platform,
      timeProbe: { consent: "granted", utcTimestamp: asOf },
      riskAcknowledged: true
    });

    expect(decisionPlan).toMatchObject({ status: "held", holdReasons: [holdReason] });
    expect(setupPlan.decisionPlan).toEqual(decisionPlan);
    expect(setupPlan.holdReasons).toEqual(decisionPlan.holdReasons);
    expect(setupPlan.status).toBe("held");
  });
});

async function isolatedApprovedIndex(): Promise<DecisionIndex> {
  const fixture = await createApprovedOfficialDecisionIndexSetFixture(projectRoot);
  temporaryRoots.push(fixture.root);
  return fixture.index;
}

function secondsBefore(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) - seconds * 1_000).toISOString().replace(".000Z", "Z");
}

function buildPlanForFixture(index: DecisionIndex, fixture: DecisionIntentFixture): DecisionPlan {
  return buildDecisionPlan(index, {
    ...(fixture.goal === undefined ? { domainIds: fixture.domainIds, domainPriority: fixture.domainPriority } : { goal: fixture.goal }),
    runtime: fixture.runtime,
    platform: fixture.platform,
    asOf: fixture.asOf
  });
}

function setupFixtureFor(fixture: DecisionIntentFixture): SetupDecisionFixture {
  return {
    language: fixture.id.includes("-ko-") || /[\uac00-\ud7a3]/u.test(fixture.goal ?? "") ? "ko" : "en",
    ...(fixture.goal === undefined
      ? { domainIds: [...(fixture.domainIds ?? [])], domainPriority: [...(fixture.domainPriority ?? [])] }
      : { goal: fixture.goal }),
    platform: fixture.platform,
    timeProbe: { consent: "granted", utcTimestamp: fixture.asOf },
    riskAcknowledged: true
  };
}

function classifySurfaceParity(
  fixtureId: string,
  decisionPlan: DecisionPlan,
  setupPlan: SetupParityPlan
): SurfaceParityClassification {
  expect(setupPlan.requiresSeparateApproval, fixtureId).toBe(true);
  expect(setupPlan.executionStatus, fixtureId).toBe("not-executed");
  expect(setupPlan.commandReceipts, fixtureId).toEqual([]);
  expect(setupPlan.installReceipts, fixtureId).toEqual([]);

  expect(setupPlan.decisionPlan, fixtureId).toEqual(decisionPlan);
  expect(setupPlan.domainIds, fixtureId).toEqual(decisionPlan.domainIds);
  expect(setupPlan.candidates, fixtureId).toEqual(planCandidates(decisionPlan));
  expect(setupPlan.holdReasons, fixtureId).toEqual(decisionPlan.holdReasons);
  expect(setupPlan.excludedCandidates, fixtureId).toEqual(decisionPlan.excludedCandidates);
  expect(setupPlan.requiresDomainPrioritySelection, fixtureId)
    .toBe(decisionPlan.requiresDomainPrioritySelection);
  expect(setupPlan.approvalBinding.preview.selectedDomainIds, fixtureId)
    .toEqual(decisionPlan.domainIds);
  expect(setupPlan.approvalBinding.preview.decisionIndexDigest, fixtureId)
    .toBe(decisionPlan.provenanceDigest);
  expect(setupPlan.approvalBinding.preview.executionOrder, fixtureId)
    .toEqual(planCandidates(decisionPlan).map((candidate) => candidate.id));
  if (decisionPlan.status === "held") {
    expect(setupPlan.approvalBinding.preview.candidates, fixtureId).toEqual([]);
    expect(setupPlan.approvalBinding.preview.executionOrder, fixtureId).toEqual([]);
    expect(setupPlan.approvalBinding.preview.statePublisher, fixtureId).toBeNull();
    expect(setupPlan.approvalValid, fixtureId).toBe(false);
    expect(setupPlan.executionCapability, fixtureId).toBeNull();
  }
  expect(setupPlan.status, fixtureId).toBe(expectedSetupStatus(decisionPlan));
  return "exact-plan";
}

function withBlockedResearchCandidate(index: DecisionIndex): DecisionIndex {
  const clone = structuredClone(index);
  const original = clone.candidates.find(({ id }) => id === "exa");
  if (original === undefined) throw new Error("research fixture requires Exa candidate");
  const evidence = clone.candidateEvidence.filter(({ candidateId }) => candidateId === original.id);
  const blockedEvidenceIds = evidence.map((item) => `blocked-research-${item.id}`);
  const blocked: DecisionCandidateProjection = {
    ...original,
    id: "blocked-research-candidate",
    sourceId: "blocked-research-source",
    state: "blocked",
    stateReasons: ["review-blocked"],
    capabilityEvidenceIds: blockedEvidenceIds,
    claudeInstall: undefined
  };
  clone.candidates.push(blocked);
  for (const [position, item] of evidence.entries()) {
    clone.candidateEvidence.push({
      ...item,
      id: blockedEvidenceIds[position]!,
      candidateId: blocked.id,
      candidate: structuredClone(blocked)
    });
  }
  const { digest: _digest, ...withoutDigest } = clone;
  clone.digest = decisionIndexDigest(withoutDigest);
  return clone;
}

function withTiePhrases(index: DecisionIndex): DecisionIndex {
  const clone = structuredClone(index);
  const commerce = clone.profiles.find(({ domainId }) => domainId === "commerce")!;
  const video = clone.profiles.find(({ domainId }) => domainId === "video-and-audio")!;
  commerce.phrases.en = ["alpha route"];
  video.phrases.en = ["route omega"];
  clone.intentFixtures = buildDecisionIntentFixtures(clone.profiles, clone.observedThrough);
  const { digest: _digest, ...withoutDigest } = clone;
  clone.digest = decisionIndexDigest(withoutDigest);
  return clone;
}

function planCandidates(plan: DecisionPlan): NonNullable<DecisionPlan["primary"]>[] {
  return [plan.primary, plan.complement].filter((candidate): candidate is NonNullable<DecisionPlan["primary"]> =>
    candidate !== null
  );
}

function expectedSetupStatus(plan: DecisionPlan): SetupDecisionStatus {
  if (plan.requiresDomainPrioritySelection) return "awaiting-domain-priority";
  if (plan.holdReasons.length === 1 && plan.holdReasons[0] === "domain-selection-required") {
    return "awaiting-domain-selection";
  }
  switch (plan.status) {
    case "eligible-with-disclosures":
      return "awaiting-approval";
    case "held":
      return "held";
    case "blocked":
      return "blocked";
  }
}

async function loadSetupDecisionEvaluator(): Promise<SetupDecisionEvaluator> {
  const setupModule = await import("../../src/evaluate/setup.js") as {
    evaluateSetupDecisionFixture?: unknown;
  };
  if (typeof setupModule.evaluateSetupDecisionFixture !== "function") {
    throw new Error(
      "Task 7 integration must export evaluateSetupDecisionFixture for decision-surface parity"
    );
  }
  return setupModule.evaluateSetupDecisionFixture as SetupDecisionEvaluator;
}
