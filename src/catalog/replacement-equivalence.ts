import type {
  AssuranceProfile,
  CompletePackManifest,
  Platform,
  ReplacementEdge,
  ScenarioType
} from "../model/complete-v1.js";
import type { TrustTier } from "../model/manifest.js";
import type { CompleteV1Repository } from "../manifest/complete-v1-repository.js";

export interface ReplacementObligations {
  requiredCategoryIds: string[];
  requiredCapabilityIds: string[];
  requiredPlatforms: Platform[];
  minimumTrust: Exclude<TrustTier, "blocked">;
  assuranceProfile: AssuranceProfile;
  evaluationTypes: ScenarioType[];
}

export interface ReplacementDiagnostic {
  path: string;
  fieldPath: string;
  message: string;
}

export class ReplacementEquivalenceError extends Error {
  constructor(readonly diagnostics: readonly ReplacementDiagnostic[]) {
    super([
      "Replacement equivalence validation failed:",
      ...diagnostics.map(({ path, fieldPath, message }) => `${path}:${fieldPath}: ${message}`)
    ].join("\n"));
    this.name = "ReplacementEquivalenceError";
  }
}

const trustRank: Record<Exclude<TrustTier, "blocked">, number> = {
  community: 1,
  trusted: 2,
  verified: 3
};

const assuranceRank: Record<AssuranceProfile, number> = {
  standard: 1,
  "high-impact": 2
};

export function deriveReplacementObligations(
  repository: CompleteV1Repository,
  replacesPackIds: readonly string[]
): ReplacementObligations {
  const packById = new Map(repository.packs.map((pack) => [pack.id, pack]));
  const packs = replacesPackIds.map((id) => {
    const pack = packById.get(id);
    if (pack === undefined) throw new Error(`Unknown superseded pack: ${id}`);
    return pack;
  });
  return {
    requiredCategoryIds: sortedUnique(packs.flatMap(({ categoryIds }) => categoryIds)),
    requiredCapabilityIds: sortedUnique(packs.flatMap(({ requiredCapabilityIds }) => requiredCapabilityIds)),
    requiredPlatforms: sortedUnique(packs.flatMap(({ platforms }) => platforms)) as Platform[],
    minimumTrust: packs.reduce<Exclude<TrustTier, "blocked">>(
      (strongest, pack) => trustStrength(pack.minimumProviderTrust) > trustStrength(strongest)
        ? pack.minimumProviderTrust
        : strongest,
      "community"
    ),
    assuranceProfile: packs.reduce<AssuranceProfile>(
      (strongest, pack) => assuranceStrength(pack.assuranceProfile) > assuranceStrength(strongest)
        ? pack.assuranceProfile
        : strongest,
      "standard"
    ),
    evaluationTypes: sortedUnique(packs.flatMap(({ scenarios }) => scenarios.map(({ type }) => type))) as ScenarioType[]
  };
}

export function validateReplacementEquivalence(repository: CompleteV1Repository): void {
  const diagnostics = collectReplacementDiagnostics(repository);
  if (diagnostics.length > 0) throw new ReplacementEquivalenceError(diagnostics);
}

export function collectReplacementDiagnostics(repository: CompleteV1Repository): ReplacementDiagnostic[] {
  const diagnostics: ReplacementDiagnostic[] = [];
  const add = (path: string, fieldPath: string, message: string): void => {
    diagnostics.push({ path, fieldPath, message });
  };
  const packById = new Map(repository.packs.map((pack) => [pack.id, pack]));
  const capabilityById = new Map(repository.capabilityCollections.flatMap(({ capabilities }) =>
    capabilities.map((capability) => [capability.id, capability] as const)
  ));
  const edgesByReplacementId = new Map<string, Array<{ edge: ReplacementEdge; index: number }>>();
  repository.catalog.replacements.forEach((edge, index) => {
    const entries = edgesByReplacementId.get(edge.replacementPackId) ?? [];
    entries.push({ edge, index });
    edgesByReplacementId.set(edge.replacementPackId, entries);
  });

  for (const [replacementId, entries] of edgesByReplacementId) {
    if (entries.length > 1) {
      entries.slice(1).forEach(({ index }) => add(
        "manifests/catalog.yaml",
        `/replacements/${index}/replacementPackId`,
        `Replacement ${replacementId} has duplicate catalog replacement edges`
      ));
    }
  }

  for (const pack of repository.packs) {
    const entries = edgesByReplacementId.get(pack.id) ?? [];
    if (pack.replacesPackIds.length > 0 && entries.length !== 1) {
      add(packPath(pack.id), "/replacesPackIds", `Replacement ${pack.id} declares replacesPackIds without exactly one catalog edge`);
    }
  }

  for (const [index, edge] of repository.catalog.replacements.entries()) {
    const catalogPath = "manifests/catalog.yaml";
    const base = `/replacements/${index}`;
    const replacement = packById.get(edge.replacementPackId);
    if (replacement === undefined) {
      add(catalogPath, `${base}/replacementPackId`, `Catalog edge references unknown replacement pack ${edge.replacementPackId}`);
      continue;
    }
    if (!setEquals(new Set(edge.replacesPackIds), new Set(replacement.replacesPackIds))) {
      add(catalogPath, `${base}/replacesPackIds`, `Replacement ${replacement.id} catalog edge does not equal replacement pack replacesPackIds`);
    }
    const knownTargets: CompletePackManifest[] = [];
    const seenTargets = new Set<string>();
    edge.replacesPackIds.forEach((targetId, targetIndex) => {
      if (seenTargets.has(targetId)) {
        add(catalogPath, `${base}/replacesPackIds/${targetIndex}`, `Duplicate replaced pack ID: ${targetId}`);
      }
      seenTargets.add(targetId);
      if (targetId === replacement.id) {
        add(catalogPath, `${base}/replacesPackIds/${targetIndex}`, `Replacement ${replacement.id} cannot replace itself`);
      }
      const target = packById.get(targetId);
      if (target === undefined) {
        add(catalogPath, `${base}/replacesPackIds/${targetIndex}`, `Replacement ${replacement.id} references unknown replaced pack ${targetId}`);
      } else {
        knownTargets.push(target);
      }
    });
    if (knownTargets.length !== edge.replacesPackIds.length) continue;
    const obligations = deriveReplacementObligations(repository, edge.replacesPackIds);
    checkProofSet(edge.requiredCategoryIds, obligations.requiredCategoryIds, "requiredCategoryIds", replacement.id, base, add);
    checkProofSet(edge.requiredCapabilityIds, obligations.requiredCapabilityIds, "requiredCapabilityIds", replacement.id, base, add);
    checkProofSet(edge.requiredPlatforms, obligations.requiredPlatforms, "requiredPlatforms", replacement.id, base, add);
    if (edge.minimumTrust !== obligations.minimumTrust) {
      add(catalogPath, `${base}/minimumTrust`, `Replacement ${replacement.id} minimumTrust does not equal derived obligation ${obligations.minimumTrust}`);
    }

    const replacementCapabilityIds = new Set([
      ...replacement.requiredCapabilityIds,
      ...replacement.recommendedCapabilityIds
    ]);
    const replacementStrongCategoryIds = new Set([...replacementCapabilityIds].flatMap((id) =>
      capabilityById.get(id)?.categoryIds ?? []
    ));
    obligations.requiredCategoryIds.forEach((id) => {
      if (!replacement.categoryIds.includes(id)) {
        add(packPath(replacement.id), "/categoryIds", `Replacement ${replacement.id} does not cover required category ${id}`);
      } else if (!replacementStrongCategoryIds.has(id)) {
        add(packPath(replacement.id), "/categoryIds", `Replacement ${replacement.id} does not cover required category ${id} through required or recommended capabilities`);
      }
    });
    obligations.requiredCapabilityIds.forEach((id) => {
      if (!replacementCapabilityIds.has(id)) {
        add(packPath(replacement.id), "/requiredCapabilityIds", `Replacement ${replacement.id} does not cover required capability ${id}`);
      }
    });
    obligations.requiredPlatforms.forEach((platform) => {
      if (!replacement.platforms.includes(platform)) {
        add(packPath(replacement.id), "/platforms", `Replacement ${replacement.id} does not support required platform ${platform}`);
      }
    });
    if (trustStrength(replacement.minimumProviderTrust) < trustStrength(obligations.minimumTrust)) {
      add(packPath(replacement.id), "/minimumProviderTrust", `Replacement ${replacement.id} trust ${replacement.minimumProviderTrust} is weaker than required ${obligations.minimumTrust}`);
    }
    if (assuranceStrength(replacement.assuranceProfile) < assuranceStrength(obligations.assuranceProfile)) {
      add(packPath(replacement.id), "/assuranceProfile", `Replacement ${replacement.id} assurance ${replacement.assuranceProfile} is weaker than required ${obligations.assuranceProfile}`);
    }
    const expectedEvaluationRefs = obligations.evaluationTypes.flatMap((type) =>
      replacement.scenarios.filter((scenario) => scenario.type === type).map(({ id }) => id)
    );
    if (!setEquals(new Set(edge.evaluationRefs), new Set(expectedEvaluationRefs))) {
      add(catalogPath, `${base}/evaluationRefs`, `Replacement ${replacement.id} evaluationRefs do not equal derived replacement evidence`);
    }
    obligations.evaluationTypes.forEach((type) => {
      const evidenceIds = replacement.scenarios.filter((scenario) => scenario.type === type).map(({ id }) => id);
      if (evidenceIds.length === 0 || !evidenceIds.some((id) => edge.evaluationRefs.includes(id))) {
        add(catalogPath, `${base}/evaluationRefs`, `Replacement ${replacement.id} does not reference replacement ${type} evidence`);
      }
    });
  }

  collectCycles(repository.packs, add);
  return diagnostics.sort(compareDiagnostics);
}

function checkProofSet<T extends string>(
  actual: readonly T[],
  expected: readonly T[],
  field: string,
  replacementId: string,
  base: string,
  add: (path: string, fieldPath: string, message: string) => void
): void {
  if (!setEquals(new Set(actual), new Set(expected))) {
    add("manifests/catalog.yaml", `${base}/${field}`, `Replacement ${replacementId} ${field} do not equal derived obligations`);
  }
}

function collectCycles(
  packs: readonly CompletePackManifest[],
  add: (path: string, fieldPath: string, message: string) => void
): void {
  const adjacency = new Map(packs.map((pack) => [pack.id, pack.replacesPackIds as readonly string[]]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const reported = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const key = [...new Set(cycle)].sort(compareCodePointStrings).join("|");
      if (!reported.has(key)) {
        reported.add(key);
        add(packPath(id), "/replacesPackIds", `Replacement cycle detected: ${cycle.join(" -> ")}`);
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (adjacency.has(target)) visit(target, [...stack, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  [...adjacency.keys()].sort(compareCodePointStrings).forEach((id) => visit(id, []));
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareCodePointStrings);
}

function setEquals<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function compareDiagnostics(left: ReplacementDiagnostic, right: ReplacementDiagnostic): number {
  return compareCodePointStrings(`${left.path}\0${left.fieldPath}\0${left.message}`, `${right.path}\0${right.fieldPath}\0${right.message}`);
}

function compareCodePointStrings(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! < rightPoints[index]! ? -1 : 1;
  }
  return leftPoints.length - rightPoints.length;
}

function trustStrength(tier: Exclude<TrustTier, "blocked">): number {
  return trustRank[tier];
}

function assuranceStrength(profile: AssuranceProfile): number {
  return assuranceRank[profile];
}

function packPath(id: string): string {
  return `manifests/complete-v1-packs/${id}.yaml`;
}
