import type {
  CapabilityTargetSearch,
  ResearchEvidence,
  ResearchQueue,
  ResearchQueueCandidate,
  RuntimeTarget,
  SourceReviewManifest
} from "../model/complete-v1.js";
import type { ResearchRepository } from "./repository.js";
import { compareCodePointStrings } from "./snapshot.js";

export interface ResearchQueueDiagnostic { path: string; fieldPath: string; message: string; }

export class ResearchQueueGraphError extends Error {
  constructor(readonly diagnostics: readonly ResearchQueueDiagnostic[]) {
    super(["Research queue graph validation failed:", ...diagnostics.map((item) => `${item.path}:${item.fieldPath}: ${item.message}`)].join("\n"));
    this.name = "ResearchQueueGraphError";
  }
}

const queuePath = "research/review-queue.json";

export function validateResearchQueueGraph(repository: ResearchRepository, capabilityIds: ReadonlySet<string>): ResearchQueue {
  const diagnostics: ResearchQueueDiagnostic[] = [];
  const add = (fieldPath: string, message: string) => diagnostics.push({ path: queuePath, fieldPath, message });
  assertQueueOrdering(repository.queue, add);
  const candidates = index(repository.queue.candidates, (id) => add("/candidates", `duplicate candidate ID: ${id}`));
  const searches = index(repository.queue.capabilitySearch, (id) => add("/capabilitySearch", `duplicate capability target search ID: ${id}`));
  const evidence = index(repository.evidence, (id) => add("/", `duplicate evidence ID: ${id}`));
  const reviews = index(repository.sourceReviews, (id) => add("/", `duplicate review ID: ${id}`));
  const membership = new Map<string, Map<string, number>>();

  for (const [searchIndex, search] of repository.queue.capabilitySearch.entries()) {
    const path = `/capabilitySearch/${searchIndex}`;
    if (!capabilityIds.has(search.capabilityId)) add(`${path}/capabilityId`, `unknown capability ID: ${search.capabilityId}`);
    const key = targetKey(search.capabilityId, search);
    const duplicate = repository.queue.capabilitySearch.findIndex((item) => targetKey(item.capabilityId, item) === key);
    if (duplicate !== searchIndex) add(path, `duplicate six-cell target search: ${key}`);
    const passedSearchEvidence = search.searchEvidenceIds.flatMap((id) => {
      const item = evidence.get(id);
      if (item?.kind !== "search-evidence" || item.outcome !== "passed" || item.searchRecordId !== search.id
        || item.capabilityId !== search.capabilityId || !sameTarget(item, search)) {
        add(`${path}/searchEvidenceIds`, `evidence ${id} must be passed search evidence for this exact target`);
        return [];
      }
      return [item];
    });
    for (const candidateId of search.candidateIds) {
      const candidate = candidates.get(candidateId);
      if (candidate === undefined) {
        add(`${path}/candidateIds`, `unknown candidate ID: ${candidateId}`);
        continue;
      }
      if (!candidate.capabilityIds.includes(search.capabilityId) || !candidate.targets.some((target) => sameTarget(target, search))) {
        add(`${path}/candidateIds`, `candidate ${candidateId} is not declared for this capability target`);
      }
      const memberships = membership.get(candidateId) ?? new Map<string, number>();
      memberships.set(key, (memberships.get(key) ?? 0) + 1);
      membership.set(candidateId, memberships);
    }
    if (search.candidateIds.length === 0 && passedSearchEvidence.length === 0) {
      add(`${path}/searchEvidenceIds`, "an empty target cell requires passed immutable no-candidate search evidence");
    }
  }
  for (const candidate of repository.queue.candidates) {
    for (const capabilityId of candidate.capabilityIds) {
      for (const target of candidate.targets) {
        const count = membership.get(candidate.id)?.get(targetKey(capabilityId, target)) ?? 0;
        if (count !== 1) add("/candidates", `candidate ${candidate.id} must occur once in its exact capability target search cell`);
      }
    }
  }
  validateReviewSearchBindings(repository.sourceReviews, searches, candidates, add);
  if (diagnostics.length > 0) throw new ResearchQueueGraphError(diagnostics.sort((left, right) => compareCodePointStrings(`${left.path}${left.fieldPath}${left.message}`, `${right.path}${right.fieldPath}${right.message}`)));
  return structuredClone(repository.queue);
}

function assertQueueOrdering(
  queue: ResearchQueue,
  add: (fieldPath: string, message: string) => void
): void {
  const candidateIds = queue.candidates.map(({ id }) => id);
  if (!isSortedUnique(candidateIds)) add("/candidates", "candidate IDs must be code-point sorted and unique");
  const searchKeys = queue.capabilitySearch.map((search) => targetKey(search.capabilityId, search));
  if (!isSortedUnique(searchKeys)) add("/capabilitySearch", "target search cells must be code-point sorted and unique");
  for (const [candidateIndex, candidate] of queue.candidates.entries()) {
    if (!isSortedUnique(candidate.capabilityIds)) add(`/candidates/${candidateIndex}/capabilityIds`, "must be code-point sorted and unique");
    if (!isSortedUnique(candidate.searchTerms)) add(`/candidates/${candidateIndex}/searchTerms`, "must be code-point sorted and unique");
    const targetKeys = candidate.targets.map((target) => targetKey("", target));
    if (!isSortedUnique(targetKeys)) add(`/candidates/${candidateIndex}/targets`, "must be code-point sorted and unique");
  }
  for (const [searchIndex, search] of queue.capabilitySearch.entries()) {
    if (!isSortedUnique(search.candidateIds)) add(`/capabilitySearch/${searchIndex}/candidateIds`, "must be code-point sorted and unique");
    if (!isSortedUnique(search.searchEvidenceIds)) add(`/capabilitySearch/${searchIndex}/searchEvidenceIds`, "must be code-point sorted and unique");
  }
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || compareCodePointStrings(values[index - 1]!, value) < 0);
}

export function candidateCoverageFor(repository: ResearchRepository, capabilityId: string): readonly ResearchQueueCandidate[] {
  return repository.queue.candidates.filter((candidate) => candidate.capabilityIds.includes(capabilityId))
    .sort((left, right) => compareCodePointStrings(left.id, right.id)).map((candidate) => structuredClone(candidate));
}

function validateReviewSearchBindings(
  reviews: readonly SourceReviewManifest[],
  searches: ReadonlyMap<string, CapabilityTargetSearch>,
  candidates: ReadonlyMap<string, ResearchQueueCandidate>,
  add: (fieldPath: string, message: string) => void
): void {
  for (const review of reviews) {
    const candidate = candidates.get(review.candidateId);
    if (candidate === undefined) {
      add("/", `review ${review.id} references unknown candidate ${review.candidateId}`);
      continue;
    }
    const declared = new Set<string>();
    for (const searchId of review.searchRecordIds) {
      const search = searches.get(searchId);
      if (search === undefined || !search.candidateIds.includes(candidate.id)) {
        add("/", `review ${review.id} search ${searchId} does not bind its candidate`);
        continue;
      }
      declared.add(targetKey(search.capabilityId, search));
    }
    for (const reviewTarget of review.capabilityTargetReviews) {
      if (!declared.has(targetKey(reviewTarget.capabilityId, reviewTarget))) {
        add("/", `review ${review.id} has a target decision without a matching candidate search cell`);
      }
    }
  }
}

function index<T extends { id: string }>(values: readonly T[], duplicate: (id: string) => void): ReadonlyMap<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    if (indexed.has(value.id)) duplicate(value.id);
    indexed.set(value.id, value);
  }
  return indexed;
}

function targetKey(capabilityId: string, target: RuntimeTarget): string {
  return `${capabilityId}\u0000${target.runtime}\u0000${target.platform}`;
}

function sameTarget(left: RuntimeTarget, right: RuntimeTarget): boolean {
  return left.runtime === right.runtime && left.platform === right.platform;
}
