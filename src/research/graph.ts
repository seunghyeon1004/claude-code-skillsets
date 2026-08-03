import type { CompleteV1Repository } from "../manifest/complete-v1-repository.js";
import { SUPPORTED_RUNTIMES, type Platform, type ProviderSelectionManifest } from "../model/complete-v1.js";
import { evaluateProviderTargetEligibility } from "./governance.js";
import { deriveP04CapabilityRoles, P04_WAVE_COVERAGE, p04WavesFor, validateP04CapabilityCoverage } from "./coverage.js";
import { validateResearchQueueGraph } from "./queue.js";
import type { ResearchRepository } from "./repository.js";
import { compareCodePointStrings } from "./snapshot.js";

const platformOrder: readonly Platform[] = ["darwin", "linux", "win32"];
const graphValidatedRepositories = new WeakSet<ResearchRepository>();

export interface ResearchGraphCatalog {
  completeV1: CompleteV1Repository;
  platforms: ReadonlySet<Platform>;
  expectedCensusSnapshotIds: readonly string[];
  enforceP04Coverage?: boolean;
}

export function validateResearchGraph(repository: ResearchRepository, catalog: ResearchGraphCatalog): ResearchRepository {
  if (!arraysEqual(repository.census.snapshotIds, catalog.expectedCensusSnapshotIds)) {
    throw new Error("research/census.json:/snapshotIds must equal the complete P03 census order");
  }
  const capabilityIds = new Set(catalog.completeV1.catalog.capabilityIds);
  validateProviderBindings(repository);
  if (repository.queue.candidates.length > 0 || repository.queue.capabilitySearch.length > 0) {
    validateResearchQueueGraph(repository, capabilityIds);
    assertSixTargetSearchCells(repository, capabilityIds, catalog.platforms);
  }
  const selections = repository.providerSelections ?? [];
  if (selections.length > 0) {
    assertSixTargetSelectionCells(selections, capabilityIds, catalog.platforms);
    const capabilityRoles = selections.some(({ disposition }) => disposition === "alternate")
      ? new Map(deriveP04CapabilityRoles(catalog.completeV1).map((role) => [role.capabilityId, role]))
      : undefined;
    validateSelections(repository, selections, capabilityRoles);
    if (catalog.enforceP04Coverage) {
      const actualCapabilityRoles = deriveP04CapabilityRoles(catalog.completeV1);
      validateP04CapabilityCoverage({
        capabilityIds: actualCapabilityRoles.map(({ capabilityId }) => capabilityId),
        requiredCapabilityIds: actualCapabilityRoles.filter(({ requiredByPackIds }) => requiredByPackIds.length > 0).map(({ capabilityId }) => capabilityId),
        waves: p04WavesFor(actualCapabilityRoles, P04_WAVE_COVERAGE),
        searches: repository.queue.capabilitySearch,
        selections,
        platforms: orderedPlatforms(catalog.platforms)
      });
    }
  }
  validateConflicts(repository);
  graphValidatedRepositories.add(repository);
  return repository;
}

export function assertResearchGraphValidated(repository: ResearchRepository): void {
  if (!graphValidatedRepositories.has(repository)) {
    throw new Error("research reports require a graph-validated research repository");
  }
}

function assertSixTargetSearchCells(
  repository: ResearchRepository,
  capabilityIds: ReadonlySet<string>,
  platforms: ReadonlySet<Platform>
): void {
  assertTargetOrder(repository.queue.capabilitySearch.map((cell) => targetKey(cell.capabilityId, cell)), "research/review-queue.json");
  for (const capabilityId of [...capabilityIds].sort(compareCodePointStrings)) {
    for (const runtime of SUPPORTED_RUNTIMES) for (const platform of orderedPlatforms(platforms)) {
      const count = repository.queue.capabilitySearch.filter((cell) => cell.capabilityId === capabilityId && cell.runtime === runtime && cell.platform === platform).length;
      if (count !== 1) throw new Error(`research/review-queue.json: capability ${capabilityId} must have one ${runtime}/${platform} search cell`);
    }
  }
}

function assertSixTargetSelectionCells(
  selections: readonly ProviderSelectionManifest[],
  capabilityIds: ReadonlySet<string>,
  platforms: ReadonlySet<Platform>
): void {
  assertTargetOrder(selections.map((cell) => targetKey(cell.capabilityId, cell)), "manifests/provider-selections");
  for (const capabilityId of [...capabilityIds].sort(compareCodePointStrings)) {
    for (const runtime of SUPPORTED_RUNTIMES) for (const platform of orderedPlatforms(platforms)) {
      const count = selections.filter((cell) => cell.capabilityId === capabilityId && cell.runtime === runtime && cell.platform === platform).length;
      if (count !== 1) throw new Error(`manifests/provider-selections: capability ${capabilityId} must have one ${runtime}/${platform} selection cell`);
    }
  }
}

function orderedPlatforms(platforms: ReadonlySet<Platform>): readonly Platform[] {
  return platformOrder.filter((platform) => platforms.has(platform));
}

function assertTargetOrder(keys: readonly string[], path: string): void {
  if (!keys.every((key, index) => index === 0 || compareCodePointStrings(keys[index - 1]!, key) < 0)) {
    throw new Error(`${path}: capability target cells must be code-point sorted and unique`);
  }
}

function validateSelections(
  repository: ResearchRepository,
  selections: readonly ProviderSelectionManifest[],
  capabilityRoles: ReadonlyMap<string, { requiredByPackIds: readonly string[]; recommendedByPackIds: readonly string[] }> | undefined
): void {
  const searches = new Map(repository.queue.capabilitySearch.map((search) => [search.id, search]));
  const providers = new Map(repository.providers.map((provider) => [provider.id, provider]));
  const reviews = new Map(repository.sourceReviews.map((review) => [review.id, review]));
  for (const selection of selections) {
    const search = searches.get(selection.searchRecordId);
    if (search === undefined || search.capabilityId !== selection.capabilityId || search.runtime !== selection.runtime || search.platform !== selection.platform) {
      throw new Error(`${selection.id}: selection must bind its exact capability target search cell`);
    }
    if (!hasPassedSearchEvidence(repository, search)) {
      throw new Error(`${selection.id}: terminal disposition requires passed search evidence for its exact target cell`);
    }
    if (selection.disposition === "alternate") {
      const role = capabilityRoles?.get(selection.capabilityId);
      if (role === undefined || role.requiredByPackIds.length > 0 || role.recommendedByPackIds.length === 0) {
        throw new Error(`${selection.id}: alternate requires a recommended-only capability`);
      }
    }
    const routes = [selection.preferredProviderId, ...selection.alternateProviderIds].filter((id): id is string => id !== undefined);
    for (const providerId of routes) {
      const provider = providers.get(providerId);
      const review = provider === undefined ? undefined : reviews.get(provider.sourceReviewId);
      if (provider === undefined || review === undefined || !search.candidateIds.includes(review.candidateId)
        || !evaluateProviderTargetEligibility({ provider, review, evidence: repository.evidence, capabilityId: selection.capabilityId, target: selection, context: repository.context, snapshots: repository.snapshots }).eligible) {
        throw new Error(`${selection.id}: provider ${providerId} is not eligible for this exact target`);
      }
    }
    if (selection.disposition === "rejected") {
      if (search.candidateIds.length === 0 || selection.terminalReviewIds.length === 0) throw new Error(`${selection.id}: rejected requires target candidates and terminal reviews`);
      const terminalReviews = selection.terminalReviewIds.map((id) => {
        const review = reviews.get(id);
        if (review === undefined) throw new Error(`${selection.id}: terminal review ${id} does not exist`);
        const provider = providers.get(review.providerId);
        if (provider === undefined || provider.sourceReviewId !== review.id) {
          throw new Error(`${selection.id}: terminal review ${id} must bind an owned provider`);
        }
        return review;
      });
      const requiredTerminalReviewIds = new Set<string>();
      for (const candidateId of search.candidateIds) {
        const candidateReview = terminalReviews.find((review) => review.candidateId === candidateId && review.capabilityTargetReviews.some((item) => item.capabilityId === selection.capabilityId && item.runtime === selection.runtime && item.platform === selection.platform && (item.decision === "rejected" || item.decision === "revoked")));
        if (candidateReview === undefined) throw new Error(`${selection.id}: every target candidate needs a rejected or revoked terminal review`);
        requiredTerminalReviewIds.add(candidateReview.id);
        const candidateProviders = repository.providers.filter((provider) => reviews.get(provider.sourceReviewId)?.candidateId === candidateId);
        for (const provider of candidateProviders) {
          const providerReview = reviews.get(provider.sourceReviewId)!;
          if (evaluateProviderTargetEligibility({ provider, review: providerReview, evidence: repository.evidence, capabilityId: selection.capabilityId, target: selection, context: repository.context, snapshots: repository.snapshots }).eligible) {
            throw new Error(`${selection.id}: rejected target cell still has an eligible provider`);
          }
        }
      }
      if (requiredTerminalReviewIds.size !== selection.terminalReviewIds.length) {
        throw new Error(`${selection.id}: terminal reviews must bind exactly one rejected or revoked review per target candidate`);
      }
    }
    if (selection.disposition === "unavailable" && (search.candidateIds.length !== 0 || selection.terminalReviewIds.length !== 0)) {
      throw new Error(`${selection.id}: unavailable is only valid for a no-candidate target cell`);
    }
  }
}

function hasPassedSearchEvidence(repository: ResearchRepository, search: { id: string; capabilityId: string; runtime: string; platform: string; searchEvidenceIds: readonly string[] }): boolean {
  return search.searchEvidenceIds.some((id) => repository.evidence.some((item) => item.id === id
    && item.kind === "search-evidence" && item.outcome === "passed" && item.searchRecordId === search.id
    && item.capabilityId === search.capabilityId && item.runtime === search.runtime && item.platform === search.platform));
}

function validateProviderBindings(repository: ResearchRepository): void {
  const reviews = new Map(repository.sourceReviews.map((review) => [review.id, review]));
  const candidates = new Map(repository.queue.candidates.map((candidate) => [candidate.id, candidate]));
  const snapshots = new Set(repository.snapshots.map(({ id }) => id));
  for (const provider of repository.providers) {
    const review = reviews.get(provider.sourceReviewId);
    if (review === undefined || review.providerId !== provider.id) throw new Error(`${provider.id}: source review binding is missing or mismatched`);
    const candidate = candidates.get(review.candidateId);
    if (candidate === undefined || !provider.capabilityIds.every((id) => candidate.capabilityIds.includes(id))) throw new Error(`${provider.id}: source review candidate binding is missing or mismatched`);
    if (!review.snapshotIds.every((id) => snapshots.has(id))) throw new Error(`${provider.id}: source review references an unknown snapshot`);
    for (const contract of provider.runtimeContracts) {
      const source = contract.packaging === "agent-skill" ? contract.repositoryUrl : contract.marketplaceSource;
      if (review.originalRepository !== source || review.reviewedCommit !== contract.reviewedCommit) throw new Error(`${provider.id}: reviewed repository or commit does not match runtime contract`);
      const compatibility = review.compatibility.find((item) => item.runtime === contract.runtime);
      if (compatibility === undefined || compatibility.runtimeVersionRange !== contract.runtimeVersionRange || !sameStrings(compatibility.platforms, contract.platforms)) throw new Error(`${provider.id}: runtime compatibility does not match runtime contract`);
      for (const artifact of contract.artifacts) {
        if (!review.selectedPaths.some((path) => artifact.path === path || artifact.path.startsWith(`${path}/`))) throw new Error(`${provider.id}: artifact is outside the reviewed selected subtree`);
      }
    }
  }
}

function validateConflicts(repository: ResearchRepository): void {
  for (const conflict of repository.conflicts) {
    for (const providerId of conflict.providerIds) {
      const provider = repository.providers.find((item) => item.id === providerId);
      if (provider === undefined || !provider.capabilityIds.includes(conflict.capabilityId)
        || !provider.runtimeContracts.some((contract) => contract.runtime === conflict.runtime && contract.platforms.includes(conflict.platform))) {
        throw new Error(`${conflict.id}: provider ${providerId} is not valid for the conflict target`);
      }
    }
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function targetKey(capabilityId: string, target: { runtime: string; platform: string }): string {
  return `${capabilityId}\u0000${target.runtime}\u0000${target.platform}`;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
