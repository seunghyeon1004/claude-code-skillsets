import type { CompletePackManifest } from "../model/complete-v1.js";
import type { CompleteV1Repository } from "../manifest/complete-v1-repository.js";
import { collectReplacementDiagnostics } from "./replacement-equivalence.js";

export interface GraphDiagnostic {
  path: string;
  fieldPath: string;
  message: string;
}

export interface CompleteV1GraphOptions {
  scenarioPaths: ReadonlySet<string>;
  waves: readonly (readonly string[])[];
  expectedWaveCounts: readonly number[];
  activePackIds: readonly string[];
}

export interface BundleIndexes {
  packToBundle: ReadonlyMap<string, string>;
  bundleToActivePackIds: ReadonlyMap<string, readonly string[]>;
}

export interface BundleTransition {
  packId: string;
  bundleId: string;
  beforeCount: number;
  afterCount: number;
  action: "activate" | "reuse" | "retain" | "eligible-for-removal";
}

export class CompleteV1GraphError extends Error {
  constructor(readonly diagnostics: readonly GraphDiagnostic[]) {
    super([
      "Complete v1 graph validation failed:",
      ...diagnostics.map(({ path, fieldPath, message }) => `${path}:${fieldPath}: ${message}`)
    ].join("\n"));
    this.name = "CompleteV1GraphError";
  }
}

export function validateCompleteV1Graph(
  repository: CompleteV1Repository,
  options: CompleteV1GraphOptions
): BundleIndexes {
  assertExplicitOptions(options);
  const diagnostics: GraphDiagnostic[] = [];
  const add = (path: string, fieldPath: string, message: string): void => {
    diagnostics.push({ path, fieldPath, message });
  };
  const domainIds = repository.domains.map(({ id }) => id);
  const categoryCollectionDomainIds = repository.categoryCollections.map(({ domainId }) => domainId);
  const capabilityCollectionDomainIds = repository.capabilityCollections.map(({ domainId }) => domainId);
  const categories = repository.categoryCollections.flatMap(({ domainId, categories: entries }) =>
    entries.map((category, index) => ({ ...category, domainId, index }))
  );
  const capabilities = repository.capabilityCollections.flatMap(({ domainId, capabilities: entries }) =>
    entries.map((capability, index) => ({ ...capability, collectionDomainId: domainId, index }))
  );
  const packIds = repository.packs.map(({ id }) => id);

  collectDuplicateEntries(diagnostics, repository.domains, ({ id }) => id, ({ id }) => domainPath(id), "/id", "domain manifest");
  collectDuplicateEntries(diagnostics, repository.categoryCollections, ({ domainId }) => domainId, ({ domainId }) => categoryPath(domainId), "/domainId", "category collection domain");
  collectDuplicateEntries(diagnostics, repository.capabilityCollections, ({ domainId }) => domainId, ({ domainId }) => capabilityPath(domainId), "/domainId", "capability collection domain");
  collectDuplicateEntries(diagnostics, categories, ({ id }) => id, ({ domainId }) => categoryPath(domainId), ({ index }) => `/categories/${index}/id`, "category");
  collectDuplicateEntries(diagnostics, capabilities, ({ id }) => id, ({ collectionDomainId }) => capabilityPath(collectionDomainId), ({ index }) => `/capabilities/${index}/id`, "capability");
  collectDuplicateEntries(diagnostics, repository.packs, ({ id }) => id, ({ id }) => packPath(id), "/id", "pack manifest");

  collectExactIdentity(diagnostics, "domain", "/domainIds", repository.catalog.domainIds, domainIds);
  collectExactIdentity(diagnostics, "category", "/categoryIds", repository.catalog.categoryIds, categories.map(({ id }) => id));
  collectExactIdentity(diagnostics, "capability", "/capabilityIds", repository.catalog.capabilityIds, capabilities.map(({ id }) => id));
  collectExactIdentity(diagnostics, "pack", "/initialPackIds", repository.catalog.initialPackIds, packIds);

  const domainSet = new Set(domainIds);
  const categoryDomainById = new Map(categories.map(({ id, domainId }) => [id, domainId]));
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
  const packIdSet = new Set(packIds);

  const categoryCollectionsByDomain = groupBy(repository.categoryCollections, ({ domainId }) => domainId);
  const capabilityCollectionsByDomain = groupBy(repository.capabilityCollections, ({ domainId }) => domainId);
  for (const domain of repository.domains) {
    const domainManifestPath = domainPath(domain.id);
    const domainCategoryCollections = categoryCollectionsByDomain.get(domain.id) ?? [];
    const domainCapabilityCollections = capabilityCollectionsByDomain.get(domain.id) ?? [];
    if (domainCategoryCollections.length === 0) {
      add(domainManifestPath, "/id", `Domain ${domain.id} is missing its category collection`);
    } else if (!arraysEqual(
      domain.categories,
      domainCategoryCollections[0]!.categories.map(({ id }) => id)
    )) {
      add(domainManifestPath, "/categories", `Domain ${domain.id} categories do not exactly equal its category collection order`);
    }
    if (domainCapabilityCollections.length === 0) {
      add(domainManifestPath, "/id", `Domain ${domain.id} is missing its capability collection`);
    }
  }

  for (const collection of repository.categoryCollections) {
    if (!domainSet.has(collection.domainId)) {
      add(categoryPath(collection.domainId), "/domainId", `Category collection references unknown domain ID: ${collection.domainId}`);
    }
  }
  const capabilityCoveredCategories = new Set<string>();
  for (const capability of capabilities) {
    const path = capabilityPath(capability.collectionDomainId);
    const base = `/capabilities/${capability.index}`;
    if (capability.ownerDomainId !== capability.collectionDomainId) {
      add(path, `${base}/ownerDomainId`, `Capability ${capability.id} ownerDomainId ${capability.ownerDomainId} does not match collection domain ${capability.collectionDomainId}`);
    }
    for (const [categoryIndex, categoryId] of capability.categoryIds.entries()) {
      if (!categoryDomainById.has(categoryId)) {
        add(path, `${base}/categoryIds/${categoryIndex}`, `Capability ${capability.id} references unknown category ID: ${categoryId}`);
      } else if (categoryDomainById.get(categoryId) !== capability.ownerDomainId) {
        add(path, `${base}/categoryIds/${categoryIndex}`, `Capability ${capability.id} references category ID outside owner domain: ${categoryId}`);
      }
      capabilityCoveredCategories.add(categoryId);
    }
  }
  for (const category of categories) {
    if (!capabilityCoveredCategories.has(category.id)) {
      add(categoryPath(category.domainId), `/categories/${category.index}/id`, `Category ${category.id} is not covered by any capability`);
    }
  }
  for (const collection of repository.capabilityCollections) {
    if (!domainSet.has(collection.domainId)) {
      add(capabilityPath(collection.domainId), "/domainId", `Capability collection references unknown domain ID: ${collection.domainId}`);
    }
  }

  const requiredOrRecommendedCapabilityIds = new Set<string>();
  const optionalCapabilityIds = new Set<string>();
  const requiredOrRecommendedCategoryIds = new Set<string>();
  const scenarioIdOwner = new Map<string, string>();
  const scenarioPathOwner = new Map<string, string>();

  for (const pack of repository.packs) {
    const path = packPath(pack.id);
    if (!domainSet.has(pack.domainId)) {
      add(path, "/domainId", `Pack ${pack.id} references unknown domain ID: ${pack.domainId}`);
    }
    if (pack.routingProfileId !== pack.domainId) {
      add(path, "/routingProfileId", `Pack ${pack.id} routingProfileId must equal owner domain ${pack.domainId}`);
    }
    const capabilityGroups = [
      ["requiredCapabilityIds", pack.requiredCapabilityIds],
      ["recommendedCapabilityIds", pack.recommendedCapabilityIds],
      ["optionalCapabilityIds", pack.optionalCapabilityIds]
    ] as const;
    const declaredCapabilityIds: string[] = [];
    const seenCapabilityEdges = new Set<string>();
    for (const [field, ids] of capabilityGroups) {
      for (const [index, capabilityId] of ids.entries()) {
        const edgeKey = capabilityId;
        if (seenCapabilityEdges.has(edgeKey)) {
          add(path, `/${field}/${index}`, `Duplicate pack capability edge: ${capabilityId}`);
        }
        seenCapabilityEdges.add(edgeKey);
        declaredCapabilityIds.push(capabilityId);
        const capability = capabilityById.get(capabilityId);
        if (capability === undefined) {
          add(path, `/${field}/${index}`, `Pack ${pack.id} references unknown ${capabilityFieldLabel(field)} capability ID: ${capabilityId}`);
          continue;
        }
        if (capability.ownerDomainId !== pack.domainId) {
          add(path, `/${field}/${index}`, `Pack ${pack.id} references capability outside owner domain: ${capabilityId}`);
        }
        if (field === "optionalCapabilityIds") {
          optionalCapabilityIds.add(capabilityId);
        } else {
          requiredOrRecommendedCapabilityIds.add(capabilityId);
          capability.categoryIds.forEach((categoryId) => requiredOrRecommendedCategoryIds.add(categoryId));
        }
      }
    }
    const declaredCategoryIds = new Set(declaredCapabilityIds.flatMap((id) => capabilityById.get(id)?.categoryIds ?? []));
    if (!setEquals(new Set(pack.categoryIds), declaredCategoryIds)) {
      add(path, "/categoryIds", `Pack ${pack.id} category IDs do not equal declared capability category union`);
    }
    for (const [index, categoryId] of pack.categoryIds.entries()) {
      if (!categoryDomainById.has(categoryId)) {
        add(path, `/categoryIds/${index}`, `Pack ${pack.id} references unknown category ID: ${categoryId}`);
      } else if (categoryDomainById.get(categoryId) !== pack.domainId) {
        add(path, `/categoryIds/${index}`, `Pack ${pack.id} references category ID outside owner domain: ${categoryId}`);
      }
    }
    validateScenarios(pack, options.scenarioPaths, scenarioIdOwner, scenarioPathOwner, add);
    for (const [index, replacementId] of pack.replacesPackIds.entries()) {
      if (!packIdSet.has(replacementId)) {
        add(path, `/replacesPackIds/${index}`, `Pack ${pack.id} references unknown replacement pack ID: ${replacementId}`);
      }
    }
  }

  for (const capability of capabilities) {
    if (!requiredOrRecommendedCapabilityIds.has(capability.id)) {
      const message = optionalCapabilityIds.has(capability.id)
        ? `Capability ${capability.id} is reachable only through optional edges`
        : `Capability ${capability.id} is not reachable from any pack`;
      add(capabilityPath(capability.collectionDomainId), `/capabilities/${capability.index}/id`, message);
    }
  }
  for (const category of categories) {
    if (!requiredOrRecommendedCategoryIds.has(category.id)) {
      add(categoryPath(category.domainId), `/categories/${category.index}/id`, `Category ${category.id} is not reachable through required or recommended pack capabilities`);
    }
  }

  for (const [index, replacement] of repository.catalog.replacements.entries()) {
    if (!packIdSet.has(replacement.replacementPackId)) {
      add("manifests/catalog.yaml", `/replacements/${index}/replacementPackId`, `Catalog replacement references unknown pack ID: ${replacement.replacementPackId}`);
    }
    replacement.replacesPackIds.forEach((id, replacedIndex) => {
      if (!packIdSet.has(id)) {
        add("manifests/catalog.yaml", `/replacements/${index}/replacesPackIds/${replacedIndex}`, `Catalog replacement references unknown replaced pack ID: ${id}`);
      }
    });
  }

  validateWaves(repository, options, add);
  diagnostics.push(...collectReplacementDiagnostics(repository));
  const sorted = diagnostics.sort(compareDiagnostics);
  if (sorted.length > 0) {
    throw new CompleteV1GraphError(sorted);
  }
  return buildBundleIndexes(repository.packs, options.activePackIds);
}

export function buildBundleIndexes(
  packs: readonly Pick<CompletePackManifest, "id" | "routingProfileId">[],
  activePackIds: readonly string[]
): BundleIndexes {
  const sortedPacks = [...packs].sort((left, right) => compareCodePointStrings(left.id, right.id));
  const packToBundle = new Map(sortedPacks.map(({ id, routingProfileId }) => [id, routingProfileId]));
  for (const activePackId of activePackIds) {
    if (!packToBundle.has(activePackId)) throw new Error(`Unknown active pack ID: ${activePackId}`);
  }
  const activeSet = new Set(activePackIds);
  const bundleToMutableIds = new Map<string, string[]>();
  for (const { id, routingProfileId } of sortedPacks) {
    if (!activeSet.has(id)) continue;
    const ids = bundleToMutableIds.get(routingProfileId) ?? [];
    ids.push(id);
    bundleToMutableIds.set(routingProfileId, ids);
  }
  const bundleToActivePackIds = new Map([...bundleToMutableIds]
    .sort(([left], [right]) => compareCodePointStrings(left, right))
    .map(([bundle, ids]) => [bundle, ids.sort(compareCodePointStrings)] as const));
  return { packToBundle, bundleToActivePackIds };
}

export function planBundleActivation(indexes: BundleIndexes, packId: string): BundleTransition {
  const bundleId = requiredBundle(indexes, packId);
  const activeIds = indexes.bundleToActivePackIds.get(bundleId) ?? [];
  const alreadyActive = activeIds.includes(packId);
  return {
    packId,
    bundleId,
    beforeCount: activeIds.length,
    afterCount: alreadyActive ? activeIds.length : activeIds.length + 1,
    action: activeIds.length === 0 ? "activate" : "reuse"
  };
}

export function planBundleRemoval(indexes: BundleIndexes, packId: string): BundleTransition {
  const bundleId = requiredBundle(indexes, packId);
  const activeIds = indexes.bundleToActivePackIds.get(bundleId) ?? [];
  if (!activeIds.includes(packId)) throw new Error(`Cannot remove inactive pack ID: ${packId}`);
  const afterCount = activeIds.length - 1;
  return {
    packId,
    bundleId,
    beforeCount: activeIds.length,
    afterCount,
    action: afterCount === 0 ? "eligible-for-removal" : "retain"
  };
}

function validateScenarios(
  pack: CompletePackManifest,
  scenarioPaths: ReadonlySet<string>,
  scenarioIdOwner: Map<string, string>,
  scenarioPathOwner: Map<string, string>,
  add: (path: string, fieldPath: string, message: string) => void
): void {
  const path = packPath(pack.id);
  const expectedTypes = ["normal", "boundary", "refusal"];
  if (pack.scenarios.length !== 3 || !setEquals(new Set(pack.scenarios.map(({ type }) => type)), new Set(expectedTypes))) {
    add(path, "/scenarios", `Pack ${pack.id} must declare exactly normal, boundary, and refusal scenarios`);
  }
  for (const [index, scenario] of pack.scenarios.entries()) {
    const expectedId = `${pack.id}-${scenario.type}`;
    const expectedPath = `tests/evaluations/packs/${pack.id}/${scenario.type}.yaml`;
    if (scenario.id !== expectedId) {
      add(path, `/scenarios/${index}/id`, `Pack ${pack.id} scenario id must equal ${expectedId}`);
    }
    if (scenario.path !== expectedPath) {
      add(path, `/scenarios/${index}/path`, `Pack ${pack.id} scenario path must equal ${expectedPath}`);
    }
    const idOwner = scenarioIdOwner.get(scenario.id);
    if (idOwner !== undefined) {
      add(path, `/scenarios/${index}/id`, `Duplicate scenario ID ${scenario.id}; first declared by ${idOwner}`);
    } else {
      scenarioIdOwner.set(scenario.id, pack.id);
    }
    const pathOwner = scenarioPathOwner.get(scenario.path);
    if (pathOwner !== undefined) {
      add(path, `/scenarios/${index}/path`, `Duplicate scenario path ${scenario.path}; first declared by ${pathOwner}`);
    } else {
      scenarioPathOwner.set(scenario.path, pack.id);
    }
    if (!scenarioPaths.has(scenario.path)) {
      add(path, `/scenarios/${index}/path`, `Pack ${pack.id} scenario path is missing from explicit inventory: ${scenario.path}`);
    }
  }
}

function validateWaves(
  repository: CompleteV1Repository,
  options: CompleteV1GraphOptions,
  add: (path: string, fieldPath: string, message: string) => void
): void {
  const actualCounts = options.waves.map((wave) => wave.length);
  if (!arraysEqual(actualCounts, options.expectedWaveCounts)) {
    add("manifests/catalog.yaml", "/initialPackIds", `Wave counts do not equal expected counts: actual [${actualCounts.join(", ")}], expected [${options.expectedWaveCounts.join(", ")}]`);
  }
  const flattened = options.waves.flat();
  if (!arraysEqual(flattened, repository.catalog.initialPackIds)) {
    add("manifests/catalog.yaml", "/initialPackIds", "Wave pack IDs do not equal catalog initial pack order");
  }
}

function collectDuplicateEntries<T>(
  diagnostics: GraphDiagnostic[],
  entries: readonly T[],
  getId: (entry: T) => string,
  getPath: (entry: T) => string,
  getFieldPath: string | ((entry: T) => string),
  kind: string
): void {
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const id = getId(entry);
    const first = seen.get(id);
    if (first !== undefined) {
      diagnostics.push({
        path: getPath(entry),
        fieldPath: typeof getFieldPath === "string" ? getFieldPath : getFieldPath(entry),
        message: `Duplicate ${kind} ID: ${id}`
      });
    } else {
      seen.set(id, index);
    }
  });
}

function collectExactIdentity(
  diagnostics: GraphDiagnostic[],
  kind: string,
  fieldPath: string,
  expectedIds: readonly string[],
  loadedIds: readonly string[]
): void {
  const expected = [...expectedIds].sort(compareCodePointStrings);
  const loaded = [...loadedIds].sort(compareCodePointStrings);
  if (!arraysEqual(expected, loaded)) {
    diagnostics.push({ path: "manifests/catalog.yaml", fieldPath, message: `Catalog ${kind} IDs do not equal loaded ${kind} IDs` });
  }
}

function compareDiagnostics(left: GraphDiagnostic, right: GraphDiagnostic): number {
  return compareCodePointStrings(
    `${left.path}\0${left.fieldPath}\0${left.message}`,
    `${right.path}\0${right.fieldPath}\0${right.message}`
  );
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
  return leftCharacters.length - rightCharacters.length;
}

function setEquals<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function capabilityFieldLabel(field: "requiredCapabilityIds" | "recommendedCapabilityIds" | "optionalCapabilityIds"): string {
  return field.replace("CapabilityIds", "");
}

function requiredBundle(indexes: BundleIndexes, packId: string): string {
  const bundle = indexes.packToBundle.get(packId);
  if (bundle === undefined) throw new Error(`Unknown pack ID: ${packId}`);
  return bundle;
}

function assertExplicitOptions(options: CompleteV1GraphOptions): void {
  const value = options as unknown;
  if (typeof value !== "object" || value === null) {
    throw new Error("Complete v1 graph options must explicitly provide scenarioPaths, waves, expectedWaveCounts, and activePackIds");
  }
  const record = value as Record<string, unknown>;
  const scenarioPaths = record.scenarioPaths as { has?: unknown } | null | undefined;
  if (
    typeof scenarioPaths?.has !== "function"
    || !Array.isArray(record.waves)
    || !Array.isArray(record.expectedWaveCounts)
    || !Array.isArray(record.activePackIds)
  ) {
    throw new Error("Complete v1 graph options must explicitly provide scenarioPaths, waves, expectedWaveCounts, and activePackIds");
  }
}

function groupBy<T>(entries: readonly T[], keyOf: (entry: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return groups;
}

function packPath(id: string): string { return `manifests/complete-v1-packs/${id}.yaml`; }
function categoryPath(domainId: string): string { return `manifests/categories/${domainId}.yaml`; }
function capabilityPath(domainId: string): string { return `manifests/capabilities/${domainId}.yaml`; }
function domainPath(id: string): string { return `manifests/complete-v1-domains/${id}.yaml`; }
