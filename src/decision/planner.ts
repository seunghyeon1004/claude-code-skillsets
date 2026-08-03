import type { DomainId } from "../model/complete-v1.js";
import type {
  DecisionCandidateProjection,
  DecisionExcludedCandidate,
  DecisionIndex,
  DecisionPlan,
  DecisionStarterRoute,
  IntentProfile
} from "../model/decision.js";
import { isRootDecisionIndex } from "./repository.js";
import { targetVerifiedReason } from "./eligibility.js";
import { decisionCatalogHoldReason, isDecisionCatalogCurrent } from "./freshness.js";
import { goalContainsReviewedPhrase, routeIntent } from "./intent-router.js";
import { normalizeGoalForRouting, normalizePhrase } from "./normalize.js";

export interface BuildDecisionPlanInput {
  goal?: string;
  domainIds?: DomainId[];
  domainPriority?: DomainId[];
  runtime: "claude-code" | "codex";
  platform: "darwin" | "linux" | "win32";
  asOf: string;
}

export interface AuthenticatedDecisionPlan {
  readonly index: DecisionIndex;
  readonly input: Readonly<{
    runtime: "claude-code" | "codex";
    platform: "darwin" | "linux" | "win32";
    asOf: string;
  }>;
}

interface DecisionPlanAuthentication {
  readonly index: DecisionIndex;
  readonly input: AuthenticatedDecisionPlan["input"];
  readonly primary: DecisionCandidateProjection | null;
  readonly complement: DecisionCandidateProjection | null;
  readonly planSnapshot: string;
}

const authenticatedPlans = new WeakMap<DecisionPlan, DecisionPlanAuthentication>();

/** Builds a non-executing plan from only currently eligible candidates. */
export function buildDecisionPlan(index: DecisionIndex, input: BuildDecisionPlanInput): DecisionPlan {
  const selection = selectProfiles(index.profiles, input);
  const required = requiredCapabilities(selection.profiles);
  const excludedCandidates = excludedCandidatesFor(index, input, required);
  if (selection.requiresDomainPrioritySelection || selection.profiles.length === 0) {
    return authenticatedPlan(
      index,
      input,
      heldPlan(index, input, selection.domainIds, [], selection.requiresDomainPrioritySelection, selection.holdReasons, excludedCandidates)
    );
  }
  if (!isDecisionCatalogCurrent(index.observedThrough, index.catalogExpiresAt, input.asOf)) {
    return authenticatedPlan(
      index,
      input,
      heldPlan(
        index,
        input,
        selection.domainIds,
        required,
        false,
        [decisionCatalogHoldReason(index.observedThrough, index.catalogExpiresAt, input.asOf)],
        excludedCandidates
      )
    );
  }

  const eligible = index.candidates.filter((candidate) => isEligibleCandidate(candidate, input));
  const starterRouteCandidateIds = new Set(index.starterRoutes?.flatMap((route) => route.orderedCandidateIds) ?? []);
  const completeCandidates = eligible.filter((candidate) => !starterRouteCandidateIds.has(candidate.id));
  const completePlan = selection.profiles.length === 1
    ? planOneDomain(index, input, selection.profiles[0]!, completeCandidates, excludedCandidates)
    : planTwoDomains(index, input, selection.profiles, completeCandidates, excludedCandidates);
  if (completePlan.status === "eligible-with-disclosures") {
    return authenticatedPlan(index, input, completePlan);
  }

  const starterPlan = starterPartialPlan(
    index,
    input,
    selection,
    eligible,
    completePlan,
    excludedCandidates
  );
  return authenticatedPlan(index, input, starterPlan ?? completePlan);
}

function authenticatedPlan(
  index: DecisionIndex,
  input: BuildDecisionPlanInput,
  plan: DecisionPlan
): DecisionPlan {
  registerDecisionPlan(index, input, plan);
  return plan;
}

/** Returns a frozen public view while planner-owned authentication details remain private. */
export function authenticatedDecisionPlanFor(plan: DecisionPlan): AuthenticatedDecisionPlan | undefined {
  const authentication = authenticatedPlans.get(plan);
  if (authentication === undefined
    || authentication.primary !== plan.primary
    || authentication.complement !== plan.complement
    || authentication.planSnapshot !== decisionPlanSnapshot(plan)
    || !isRootDecisionIndex(authentication.index)) {
    return undefined;
  }
  return Object.freeze({
    index: authentication.index,
    input: Object.freeze({
      runtime: authentication.input.runtime,
      platform: authentication.input.platform,
      asOf: authentication.input.asOf
    })
  });
}

function registerDecisionPlan(
  index: DecisionIndex,
  input: BuildDecisionPlanInput,
  plan: DecisionPlan
): void {
  if (!isRootDecisionIndex(index)
    || (plan.primary !== null && !index.candidates.includes(plan.primary))
    || (plan.complement !== null && !index.candidates.includes(plan.complement))
    || plan.provenanceDigest !== index.digest) {
    return;
  }
  authenticatedPlans.set(plan, Object.freeze({
    index,
    input: Object.freeze({ runtime: input.runtime, platform: input.platform, asOf: input.asOf }),
    primary: plan.primary,
    complement: plan.complement,
    planSnapshot: decisionPlanSnapshot(plan)
  }));
}

function selectProfiles(
  profiles: readonly IntentProfile[],
  input: BuildDecisionPlanInput
): ProfileSelection {
  const explicitDomains = uniqueDomains(input.domainIds ?? []);
  if (explicitDomains.length > 2) {
    const priority = uniqueDomains(input.domainPriority ?? [])
      .filter((domainId) => explicitDomains.includes(domainId));
    if (priority.length === 2) {
      const selected = priority.flatMap((domainId) => {
        const profile = profiles.find((candidate) => candidate.domainId === domainId);
        return profile === undefined ? [] : [profile];
      });
      if (selected.length === 2) {
        return {
          profiles: selected,
          domainIds: priority,
          requiresDomainPrioritySelection: false,
          holdReasons: [],
          selectionBasis: "explicit-domain",
          starterEligible: false
        };
      }
    }
    return {
      profiles: [],
      domainIds: explicitDomains,
      requiresDomainPrioritySelection: true,
      holdReasons: ["domain-priority-required"],
      selectionBasis: "explicit-domain",
      starterEligible: false
    };
  }
  if (explicitDomains.length > 0) {
    const selected = explicitDomains.flatMap((domainId) => {
      const profile = profiles.find((candidate) => candidate.domainId === domainId);
      return profile === undefined ? [] : [profile];
    });
    return {
      profiles: selected,
      domainIds: explicitDomains,
      requiresDomainPrioritySelection: selected.length !== explicitDomains.length,
      holdReasons: selected.length === explicitDomains.length ? [] : ["domain-selection-required"],
      selectionBasis: "explicit-domain",
      starterEligible: input.domainIds?.length === 1 && selected.length === 1 && explicitDomains.length === 1
    };
  }
  if (input.goal === undefined || input.goal.trim().length === 0) {
    return {
      profiles: [],
      domainIds: [],
      requiresDomainPrioritySelection: false,
      holdReasons: ["domain-selection-required"],
      selectionBasis: "goal-match",
      starterEligible: false
    };
  }
  const route = routeIntent(profiles, input.goal);
  return {
    profiles: route.resolution === "matched" ? route.profiles : [],
    domainIds: route.domainIds,
    requiresDomainPrioritySelection: route.resolution === "ambiguous" || route.domainIds.length > 2,
    holdReasons: route.resolution === "matched"
      ? []
      : [route.resolution === "ambiguous" ? "domain-priority-required" : "domain-selection-required"],
    selectionBasis: "goal-match",
    starterEligible: route.resolution === "matched" && route.domainIds.length === 1 && route.profiles.length === 1
  };
}

function planOneDomain(
  index: DecisionIndex,
  input: BuildDecisionPlanInput,
  profile: IntentProfile,
  eligible: readonly DecisionCandidateProjection[],
  excludedCandidates: readonly DecisionExcludedCandidate[]
): DecisionPlan {
  const required = requiredCapabilities([profile]);
  const primary = eligible
    .filter((candidate) => candidate.providedCapabilityIds.includes(profile.coreCapabilityId))
    .sort((left, right) => compareCandidateForRequired(left, right, profile.requiredCapabilityIds, [profile], input))[0];
  if (primary === undefined) {
    return heldPlan(index, input, [profile.domainId], required, false, ["eligible-candidate-coverage-incomplete"], excludedCandidates);
  }

  const remaining = missingCapabilities(profile.requiredCapabilityIds, [primary]);
  if (remaining.length === 0) {
    return eligiblePlan(index, input, [profile.domainId], primary, null, excludedCandidates);
  }
  const complements = eligible
    .filter((candidate) => candidate.id !== primary.id && coversAll(candidate, remaining))
    .sort((left, right) => compareCandidateForRequired(left, right, remaining, [profile], input));
  const complement = complements[0];
  if (complement === undefined) {
    const bestDiagnosticComplement = eligible
      .filter((candidate) => candidate.id !== primary.id)
      .sort((left, right) => compareCandidateForRequired(left, right, remaining, [profile], input))[0];
    return heldPlan(
      index,
      input,
      [profile.domainId],
      missingCapabilities(required, bestDiagnosticComplement === undefined ? [primary] : [primary, bestDiagnosticComplement]),
      false,
      ["eligible-candidate-coverage-incomplete"],
      excludedCandidates
    );
  }
  if (complements[1] !== undefined
    && compareCandidateMeaningful(complement, complements[1], remaining, [profile], input) === 0) {
    return heldPlan(index, input, [profile.domainId], [], false, ["candidate-selection-tie"], excludedCandidates);
  }
  return eligiblePlan(index, input, [profile.domainId], primary, complement, excludedCandidates);
}

function planTwoDomains(
  index: DecisionIndex,
  input: BuildDecisionPlanInput,
  profiles: readonly IntentProfile[],
  eligible: readonly DecisionCandidateProjection[],
  excludedCandidates: readonly DecisionExcludedCandidate[]
): DecisionPlan {
  const required = requiredCapabilities(profiles);
  const options: DecisionCandidateProjection[][] = [];
  for (let index = 0; index < eligible.length; index += 1) {
    options.push([eligible[index]!]);
    for (let complementIndex = index + 1; complementIndex < eligible.length; complementIndex += 1) {
      options.push([eligible[index]!, eligible[complementIndex]!]);
    }
  }
  const complete = options
    .filter((candidates) => missingCapabilities(required, candidates).length === 0)
    .sort((left, right) => compareCandidateSets(left, right, profiles, input));
  const selected = complete[0];
  if (selected === undefined) {
    const bestAllowedSet = options.slice().sort((left, right) =>
      missingCapabilities(required, left).length - missingCapabilities(required, right).length
      || compareCandidateSets(left, right, profiles, input)
    )[0] ?? [];
    return heldPlan(
      index,
      input,
      profiles.map(({ domainId }) => domainId),
      missingCapabilities(required, bestAllowedSet),
      false,
      ["eligible-candidate-coverage-incomplete"],
      excludedCandidates
    );
  }

  const ordered = orderCandidatesForProfiles(selected, profiles);
  return eligiblePlan(
    index,
    input,
    profiles.map(({ domainId }) => domainId),
    ordered[0]!,
    ordered[1] ?? null,
    excludedCandidates
  );
}

interface ProfileSelection {
  profiles: IntentProfile[];
  domainIds: DomainId[];
  requiresDomainPrioritySelection: boolean;
  holdReasons: string[];
  selectionBasis: "explicit-domain" | "goal-match";
  starterEligible: boolean;
}

interface StarterAssociation {
  candidateId: string;
  capabilityId: string;
  support: "direct" | "inferred" | "related";
  current: boolean;
}

function starterPartialPlan(
  index: DecisionIndex,
  input: BuildDecisionPlanInput,
  selection: ProfileSelection,
  eligible: readonly DecisionCandidateProjection[],
  completePlan: DecisionPlan,
  excludedCandidates: readonly DecisionExcludedCandidate[]
): DecisionPlan | undefined {
  if (!selection.starterEligible
    || selection.profiles.length !== 1
    || selection.domainIds.length !== 1
    || input.runtime !== "claude-code"
    || input.platform !== "darwin") {
    return undefined;
  }

  const profile = selection.profiles[0]!;
  const route = index.starterRoutes?.find((candidate) => candidate.domainId === profile.domainId);
  if (route === undefined) return undefined;

  const associations = starterAssociations(index, route);
  const fullCapabilityIds = starterCapabilityUniverse(route, associations);
  const eligibleById = new Map(eligible.map((candidate) => [candidate.id, candidate]));
  const selected: DecisionCandidateProjection[] = [];
  const associatedCapabilityIds = new Set<string>();
  for (const candidateId of route.orderedCandidateIds.slice(0, 2)) {
    const candidate = eligibleById.get(candidateId);
    if (candidate === undefined) continue;
    const candidateCapabilityIds = uniqueStrings(associations
      .filter((association) => association.current
        && association.candidateId === candidate.id
        && association.support !== "related")
      .map((association) => association.capabilityId));
    if (candidateCapabilityIds.length === 0
      || (selected.length > 0 && !candidateCapabilityIds.some((capabilityId) => !associatedCapabilityIds.has(capabilityId)))) {
      continue;
    }
    selected.push(candidate);
    for (const capabilityId of candidateCapabilityIds) associatedCapabilityIds.add(capabilityId);
  }

  if (selected.length === 0) {
    return heldPlan(
      index,
      input,
      [profile.domainId],
      fullCapabilityIds,
      false,
      completePlan.holdReasons,
      excludedCandidates
    );
  }

  const selectedCandidateIds = new Set(selected.map(({ id }) => id));
  const current = associations.filter((association) => association.current && selectedCandidateIds.has(association.candidateId));
  const directCapabilityIds = uniqueStrings(current
    .filter((association) => association.support === "direct")
    .map((association) => association.capabilityId));
  const inferredCapabilityIds = uniqueStrings(current
    .filter((association) => association.support === "inferred" && !directCapabilityIds.includes(association.capabilityId))
    .map((association) => association.capabilityId));
  const relatedCapabilityIds = uniqueStrings(current
    .filter((association) => association.support === "related")
    .map((association) => association.capabilityId));
  const supportedCapabilityIds = new Set([...directCapabilityIds, ...inferredCapabilityIds]);
  const uncoveredCapabilityIds = fullCapabilityIds.filter((capabilityId) => !supportedCapabilityIds.has(capabilityId));

  return {
    status: "eligible-with-disclosures",
    goal: input.goal ?? null,
    domainIds: [profile.domainId],
    primary: selected[0]!,
    complement: selected[1] ?? null,
    planKind: "starter-partial",
    selectionBasis: selection.selectionBasis,
    smallestHonestProfile: { ...route.smallestHonestProfile },
    broadCoverageComplete: false,
    coverageIncomplete: true,
    directCapabilityIds,
    inferredCapabilityIds,
    relatedCapabilityIds,
    uncoveredCapabilityIds,
    holdReasons: [],
    excludedCandidates: copyExcludedCandidates(excludedCandidates),
    requiresDomainPrioritySelection: false,
    executionStatus: "not-executed",
    provenanceDigest: index.digest
  };
}

function starterAssociations(index: DecisionIndex, route: DecisionStarterRoute): StarterAssociation[] {
  const evidenceById = new Map(index.candidateEvidence.map((evidence) => [evidence.id, evidence]));
  return [
    { support: "direct" as const, evidenceIds: route.directEvidenceIds },
    { support: "inferred" as const, evidenceIds: route.inferredEvidenceIds },
    { support: "related" as const, evidenceIds: route.relatedEvidenceIds ?? [] }
  ].flatMap(({ support, evidenceIds }) => evidenceIds.flatMap((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return evidence === undefined || evidence.support !== support
      ? []
      : [{
        candidateId: evidence.candidateId,
        capabilityId: evidence.capabilityId,
        support,
        current: evidence.current
      }];
  }));
}

function starterCapabilityUniverse(route: DecisionStarterRoute, associations: readonly StarterAssociation[]): string[] {
  return uniqueStrings([
    ...associations.map((association) => association.capabilityId),
    ...route.unsupportedCapabilityIds
  ]);
}

function requiredCapabilities(profiles: readonly IntentProfile[]): string[] {
  return uniqueStrings(profiles.flatMap((profile) => [profile.coreCapabilityId, ...profile.requiredCapabilityIds]));
}

function missingCapabilities(
  required: readonly string[],
  candidates: readonly DecisionCandidateProjection[]
): string[] {
  const covered = new Set(candidates.flatMap((candidate) => candidate.providedCapabilityIds));
  return required.filter((capabilityId) => !covered.has(capabilityId));
}

function coversAll(candidate: DecisionCandidateProjection, capabilities: readonly string[]): boolean {
  return capabilities.every((capabilityId) => candidate.providedCapabilityIds.includes(capabilityId));
}

function compareCandidateForRequired(
  left: DecisionCandidateProjection,
  right: DecisionCandidateProjection,
  required: readonly string[],
  profiles: readonly IntentProfile[],
  input: BuildDecisionPlanInput
): number {
  return compareCandidateMeaningful(left, right, required, profiles, input)
    || compareCodePointStrings(left.id, right.id)
    || compareCodePointStrings(left.sourceId, right.sourceId);
}

function compareCandidateMeaningful(
  left: DecisionCandidateProjection,
  right: DecisionCandidateProjection,
  required: readonly string[],
  profiles: readonly IntentProfile[],
  input: BuildDecisionPlanInput
): number {
  const leftRank = candidateRank(left, required, profiles, input);
  const rightRank = candidateRank(right, required, profiles, input);
  return rightRank.coverage - leftRank.coverage
    || rightRank.targetEvidenceAt - leftRank.targetEvidenceAt
    || rightRank.strongPhraseMatches - leftRank.strongPhraseMatches
    || rightRank.goalNameOverlap - leftRank.goalNameOverlap
    || rightRank.reviewedAt - leftRank.reviewedAt;
}

function compareCandidateSets(
  left: readonly DecisionCandidateProjection[],
  right: readonly DecisionCandidateProjection[],
  profiles: readonly IntentProfile[],
  input: BuildDecisionPlanInput
): number {
  if (left.length !== right.length) return left.length - right.length;
  const required = requiredCapabilities(profiles);
  const leftCoverage = left.reduce((total, candidate) => total + coverageCount(candidate, required), 0);
  const rightCoverage = right.reduce((total, candidate) => total + coverageCount(candidate, required), 0);
  if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage;
  const leftRank = aggregateCandidateRanks(left, required, profiles, input);
  const rightRank = aggregateCandidateRanks(right, required, profiles, input);
  return rightRank.targetEvidenceAt - leftRank.targetEvidenceAt
    || rightRank.strongPhraseMatches - leftRank.strongPhraseMatches
    || rightRank.goalNameOverlap - leftRank.goalNameOverlap
    || rightRank.reviewedAt - leftRank.reviewedAt
    || compareCodePointStrings(candidateSetKey(left), candidateSetKey(right));
}

function orderCandidatesForProfiles(
  candidates: readonly DecisionCandidateProjection[],
  profiles: readonly IntentProfile[]
): DecisionCandidateProjection[] {
  const firstCore = profiles[0]!.coreCapabilityId;
  return candidates.slice().sort((left, right) => {
    const leftCoversFirst = left.providedCapabilityIds.includes(firstCore) ? 1 : 0;
    const rightCoversFirst = right.providedCapabilityIds.includes(firstCore) ? 1 : 0;
    return rightCoversFirst - leftCoversFirst || compareCodePointStrings(left.id, right.id);
  });
}

function coverageCount(candidate: DecisionCandidateProjection, capabilities: readonly string[]): number {
  return capabilities.filter((capabilityId) => candidate.providedCapabilityIds.includes(capabilityId)).length;
}

interface CandidateRank {
  coverage: number;
  targetEvidenceAt: number;
  strongPhraseMatches: number;
  goalNameOverlap: number;
  reviewedAt: number;
}

function candidateRank(
  candidate: DecisionCandidateProjection,
  required: readonly string[],
  profiles: readonly IntentProfile[],
  input: BuildDecisionPlanInput
): CandidateRank {
  const goal = input.goal ?? "";
  const relevantProfiles = profiles.filter((profile) =>
    candidate.providedCapabilityIds.includes(profile.coreCapabilityId)
  );
  const strongPhraseMatches = goal.length === 0 ? 0 : relevantProfiles
    .flatMap((profile) => [...profile.phrases.ko, ...profile.phrases.en])
    .filter((phrase) => goalContainsReviewedPhrase(goal, phrase)).length;
  const goalTokens = new Set(normalizeGoalForRouting(goal).split(" ").filter(Boolean));
  const candidateTokens = new Set(normalizePhrase(
    `${candidate.displayName ?? ""} ${candidate.description ?? ""}`
  ).split(" ").filter(Boolean));
  return {
    coverage: coverageCount(candidate, required),
    targetEvidenceAt: timestamp(candidate.ranking?.targetEvidenceAt[input.platform]),
    strongPhraseMatches,
    goalNameOverlap: [...goalTokens].filter((token) => candidateTokens.has(token)).length,
    reviewedAt: timestamp(candidate.ranking?.reviewedAt ?? undefined)
  };
}

function aggregateCandidateRanks(
  candidates: readonly DecisionCandidateProjection[],
  required: readonly string[],
  profiles: readonly IntentProfile[],
  input: BuildDecisionPlanInput
): CandidateRank {
  return candidates.map((candidate) => candidateRank(candidate, required, profiles, input))
    .reduce((total, rank) => ({
      coverage: total.coverage + rank.coverage,
      targetEvidenceAt: total.targetEvidenceAt + rank.targetEvidenceAt,
      strongPhraseMatches: total.strongPhraseMatches + rank.strongPhraseMatches,
      goalNameOverlap: total.goalNameOverlap + rank.goalNameOverlap,
      reviewedAt: total.reviewedAt + rank.reviewedAt
    }), { coverage: 0, targetEvidenceAt: 0, strongPhraseMatches: 0, goalNameOverlap: 0, reviewedAt: 0 });
}

function timestamp(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function eligiblePlan(
  index: DecisionIndex,
  input: BuildDecisionPlanInput,
  domainIds: DomainId[],
  primary: DecisionCandidateProjection,
  complement: DecisionCandidateProjection | null,
  excludedCandidates: readonly DecisionExcludedCandidate[]
): DecisionPlan {
  return {
    status: "eligible-with-disclosures",
    goal: input.goal ?? null,
    domainIds,
    primary,
    complement,
    planKind: "complete",
    selectionBasis: selectionBasisFor(input),
    smallestHonestProfile: null,
    broadCoverageComplete: true,
    coverageIncomplete: false,
    directCapabilityIds: [],
    inferredCapabilityIds: [],
    relatedCapabilityIds: [],
    uncoveredCapabilityIds: [],
    holdReasons: [],
    excludedCandidates: copyExcludedCandidates(excludedCandidates),
    requiresDomainPrioritySelection: false,
    executionStatus: "not-executed",
    provenanceDigest: index.digest
  };
}

function heldPlan(
  index: DecisionIndex,
  input: BuildDecisionPlanInput,
  domainIds: DomainId[],
  uncoveredCapabilityIds: string[],
  requiresDomainPrioritySelection: boolean,
  holdReasons: readonly string[],
  excludedCandidates: readonly DecisionExcludedCandidate[]
): DecisionPlan {
  return {
    status: "held",
    goal: input.goal ?? null,
    domainIds,
    primary: null,
    complement: null,
    planKind: "complete",
    selectionBasis: selectionBasisFor(input),
    smallestHonestProfile: null,
    broadCoverageComplete: false,
    coverageIncomplete: uncoveredCapabilityIds.length > 0,
    directCapabilityIds: [],
    inferredCapabilityIds: [],
    relatedCapabilityIds: [],
    uncoveredCapabilityIds: uniqueStrings(uncoveredCapabilityIds),
    holdReasons: uniqueStrings(holdReasons),
    excludedCandidates: copyExcludedCandidates(excludedCandidates),
    requiresDomainPrioritySelection,
    executionStatus: "not-executed",
    provenanceDigest: index.digest
  };
}

function selectionBasisFor(input: BuildDecisionPlanInput): "explicit-domain" | "goal-match" {
  return input.domainIds !== undefined && input.domainIds.length > 0 ? "explicit-domain" : "goal-match";
}

function uniqueDomains(domainIds: readonly DomainId[]): DomainId[] {
  return domainIds.filter((domainId, index) => domainIds.indexOf(domainId) === index);
}

function uniqueStrings(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function candidateSetKey(candidates: readonly DecisionCandidateProjection[]): string {
  return candidates.map(({ id, sourceId }) => `${id}\u0000${sourceId}`).sort(compareCodePointStrings).join("\u0001");
}

function isEligibleCandidate(candidate: DecisionCandidateProjection, input: BuildDecisionPlanInput): boolean {
  return candidate.runtime === input.runtime
    && candidate.state === "eligible-with-disclosures"
    && !candidate.stateReasons.some((reason) => reason === "review-blocked" || reason === "blocked" || reason === "stale"
      || reason === "stale-evidence" || reason === "expired" || reason === "review-stale")
    && candidate.stateReasons.includes(targetVerifiedReason(input.runtime, input.platform))
    && candidateExpiryReasons(candidate, input).length === 0;
}

function excludedCandidatesFor(
  index: DecisionIndex,
  input: BuildDecisionPlanInput,
  required: readonly string[]
): DecisionExcludedCandidate[] {
  if (required.length === 0) return [];
  return index.candidates
    .filter((candidate) => candidate.runtime === input.runtime
      && candidate.providedCapabilityIds.some((capabilityId) => required.includes(capabilityId))
      && !isEligibleCandidate(candidate, input))
    .map((candidate) => {
      const expiryReasons = candidateExpiryReasons(candidate, input);
      return {
      candidateId: candidate.id,
      sourceId: candidate.sourceId,
      state: expiryReasons.length > 0 ? "held" as const : candidate.state,
      stateReasons: uniqueStrings([...candidate.stateReasons, ...expiryReasons])
      };
    })
    .sort((left, right) => compareCodePointStrings(left.candidateId, right.candidateId)
      || compareCodePointStrings(left.sourceId, right.sourceId));
}

function candidateExpiryReasons(
  candidate: DecisionCandidateProjection,
  input: BuildDecisionPlanInput
): string[] {
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf)) return ["candidate-time-invalid"];
  const reasons: string[] = [];
  const reviewExpiresAt = candidate.eligibility?.reviewExpiresAt;
  if (reviewExpiresAt !== null && reviewExpiresAt !== undefined
    && (!Number.isFinite(Date.parse(reviewExpiresAt)) || asOf >= Date.parse(reviewExpiresAt))) {
    reasons.push("review-expired");
  }
  const targetExpiresAt = candidate.eligibility?.targetExpiresAt[input.platform];
  if (targetExpiresAt !== undefined
    && (!Number.isFinite(Date.parse(targetExpiresAt)) || asOf >= Date.parse(targetExpiresAt))) {
    reasons.push("target-evidence-expired");
  }
  return reasons;
}

function copyExcludedCandidates(candidates: readonly DecisionExcludedCandidate[]): DecisionExcludedCandidate[] {
  return candidates.map((candidate) => ({ ...candidate, stateReasons: [...candidate.stateReasons] }));
}

function decisionPlanSnapshot(plan: DecisionPlan): string {
  return stableValue({
    status: plan.status,
    goal: plan.goal,
    domainIds: plan.domainIds,
    primary: plan.primary,
    complement: plan.complement,
    plannedCandidateIds: [plan.primary?.id, plan.complement?.id].filter((id): id is string => id !== undefined),
    planKind: plan.planKind,
    selectionBasis: plan.selectionBasis,
    smallestHonestProfile: plan.smallestHonestProfile,
    broadCoverageComplete: plan.broadCoverageComplete,
    coverageIncomplete: plan.coverageIncomplete,
    directCapabilityIds: plan.directCapabilityIds,
    inferredCapabilityIds: plan.inferredCapabilityIds,
    relatedCapabilityIds: plan.relatedCapabilityIds,
    uncoveredCapabilityIds: plan.uncoveredCapabilityIds,
    holdReasons: plan.holdReasons,
    excludedCandidates: plan.excludedCandidates,
    requiresDomainPrioritySelection: plan.requiresDomainPrioritySelection,
    executionStatus: plan.executionStatus,
    provenanceDigest: plan.provenanceDigest
  });
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(compareCodePointStrings)
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodePointStrings(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftCharacters[index]!.codePointAt(0)!;
    const rightPoint = rightCharacters[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
  return leftCharacters.length === rightCharacters.length
    ? 0
    : (leftCharacters.length < rightCharacters.length ? -1 : 1);
}
