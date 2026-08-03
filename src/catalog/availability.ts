import type {
  ActionRequiredIssue,
  CompletePackManifest,
  InstalledTargetHealth,
  PackAvailability,
  PackAvailabilityResult,
  ProviderManifest,
  ProviderSelectionManifest,
  ProviderTargetEligibility,
  ResolvedCapabilityProvider,
  RuntimeTarget
} from "../model/complete-v1.js";
import { COMPLETE_V1_PACK_IDS } from "../model/complete-v1.js";

type CapabilityRole = "required" | "recommended" | "optional";

interface RouteRecord {
  provider: ProviderManifest;
  eligibility: ProviderTargetEligibility;
}

interface CapabilityRoute {
  capabilityId: string;
  role: CapabilityRole;
  selection: ProviderSelectionManifest;
  preferred: RouteRecord | undefined;
  alternatives: ReadonlyMap<string, RouteRecord>;
}

export function derivePackAvailability(input: {
  pack: CompletePackManifest;
  selections: readonly ProviderSelectionManifest[];
  providers: readonly ProviderManifest[];
  eligibility: readonly ProviderTargetEligibility[];
  target: RuntimeTarget;
  installed: InstalledTargetHealth | null;
}): PackAvailabilityResult {
  assertPackSupportsTarget(input.pack, input.target);
  validateSelectionRecords(input.selections);
  const capabilityRoles = collectCapabilityRoles(input.pack);
  const providersById = indexUnique(input.providers, (provider) => provider.id, "provider");
  const eligibilityByKey = indexUnique(
    input.eligibility,
    (record) => eligibilityKey(record.providerId, record.capabilityId, record.target),
    "eligibility"
  );
  const routes = new Map<string, CapabilityRoute>();

  for (const [capabilityId, role] of capabilityRoles) {
    const selection = findSelection(input.selections, capabilityId, input.target);
    const route = createCapabilityRoute(selection, role, providersById, eligibilityByKey, input.target);
    routes.set(capabilityId, route);
  }

  const installedBindings = validateInstalledHealth(input.installed, routes, input.target);
  const resolvedProviders: ResolvedCapabilityProvider[] = [];
  const missingRequiredCapabilityIds: string[] = [];
  const missingRecommendedCapabilityIds: string[] = [];
  const actionRequiredIssues: ActionRequiredIssue[] = [];

  for (const route of routes.values()) {
    const binding = installedBindings.bindings.get(route.capabilityId);
    const failure = binding === undefined ? undefined : installedBindings.failures.get(binding.providerId);
    const resolved = resolveRoute(route, binding?.providerId);

    if (failure !== undefined && binding !== undefined) {
      actionRequiredIssues.push({
        capabilityId: route.capabilityId,
        providerId: binding.providerId,
        reason: failure.reason
      });
    }

    const satisfiesCoverage = failure === undefined
      && resolved !== undefined
      && isCoverageEligible(resolved.record, input.pack);
    if (satisfiesCoverage && resolved !== undefined) {
      resolvedProviders.push({
        capabilityId: route.capabilityId,
        providerId: resolved.providerId,
        role: resolved.role
      });
    }

    if (!satisfiesCoverage && route.role === "required") missingRequiredCapabilityIds.push(route.capabilityId);
    if (!satisfiesCoverage && route.role === "recommended") missingRecommendedCapabilityIds.push(route.capabilityId);
  }

  const sortedResolvedProviders = sortedUnique(
    resolvedProviders,
    (left, right) => compareCodePoint(left.capabilityId, right.capabilityId)
      || compareCodePoint(left.providerId, right.providerId)
      || compareCodePoint(left.role, right.role),
    (value) => `${value.capabilityId}\u0000${value.providerId}\u0000${value.role}`,
    "resolved provider"
  );
  const sortedRequired = sortedUniqueStrings(missingRequiredCapabilityIds, "missing required capability");
  const sortedRecommended = sortedUniqueStrings(missingRecommendedCapabilityIds, "missing recommended capability");
  const sortedIssues = sortedUnique(
    actionRequiredIssues,
    (left, right) => compareCodePoint(left.capabilityId, right.capabilityId)
      || compareCodePoint(left.providerId, right.providerId)
      || compareCodePoint(left.reason, right.reason),
    (value) => `${value.capabilityId}\u0000${value.providerId}\u0000${value.reason}`,
    "action-required issue"
  );

  return {
    packId: completePackId(input.pack),
    runtime: input.target.runtime,
    platform: input.target.platform,
    availability: availabilityFor(sortedIssues, sortedRequired, sortedRecommended),
    resolvedProviders: sortedResolvedProviders,
    missingRequiredCapabilityIds: sortedRequired,
    missingRecommendedCapabilityIds: sortedRecommended,
    actionRequiredIssues: sortedIssues
  };
}

function collectCapabilityRoles(pack: CompletePackManifest): ReadonlyMap<string, CapabilityRole> {
  const roles = new Map<string, CapabilityRole>();
  for (const [role, capabilityIds] of [
    ["required", pack.requiredCapabilityIds],
    ["recommended", pack.recommendedCapabilityIds],
    ["optional", pack.optionalCapabilityIds]
  ] as const) {
    for (const capabilityId of capabilityIds) {
      if (roles.has(capabilityId)) throw new Error(`Duplicate pack capability: ${capabilityId}`);
      roles.set(capabilityId, role);
    }
  }
  return roles;
}

function assertPackSupportsTarget(pack: CompletePackManifest, target: RuntimeTarget): void {
  if (!pack.platforms.includes(target.platform)) {
    throw new Error(`Pack target ${targetLabel(target)} is not supported by ${pack.id}`);
  }
}

function validateSelectionRecords(selections: readonly ProviderSelectionManifest[]): void {
  indexUnique(selections, (selection) => selection.id, "selection");
  indexUnique(
    selections,
    (selection) => selectionKey(selection.capabilityId, selection),
    "selection capability target"
  );
  for (const selection of selections) validateSelectionRecord(selection);
}

function validateSelectionRecord(selection: ProviderSelectionManifest): void {
  const providerIds = selectedProviderIds(selection);
  const terminalReviews = selection.terminalReviewIds;
  if (selection.disposition === "selected" || selection.disposition === "alternate") {
    if (selection.preferredProviderId === undefined || selection.releaseEvidence !== "trialed-p04" || terminalReviews.length !== 0) {
      throw new Error(`Selection ${selection.id} selected or alternate route requires a preferred provider, no terminal reviews, and trialed-p04 evidence`);
    }
    return;
  }
  if (selection.disposition === "rejected") {
    if (providerIds.length !== 0 || terminalReviews.length === 0 || selection.releaseEvidence !== "not-applicable") {
      throw new Error(`Selection ${selection.id} rejected route requires terminal reviews, no provider route, and not-applicable evidence`);
    }
    return;
  }
  if (providerIds.length !== 0 || terminalReviews.length !== 0 || selection.releaseEvidence !== "not-applicable") {
    throw new Error(`Selection ${selection.id} unavailable route requires no terminal reviews or provider route and not-applicable evidence`);
  }
}

function completePackId(pack: CompletePackManifest): PackAvailabilityResult["packId"] {
  const packId = COMPLETE_V1_PACK_IDS.find((id) => id === pack.id);
  if (packId === undefined) throw new Error(`Unknown complete pack ID: ${pack.id}`);
  return packId;
}

function findSelection(
  selections: readonly ProviderSelectionManifest[],
  capabilityId: string,
  target: RuntimeTarget
): ProviderSelectionManifest {
  const candidates = selections.filter((selection) => selection.capabilityId === capabilityId);
  const exact = candidates.filter((selection) => matchesTarget(selection, target));
  if (exact.length > 1) throw new Error(`Duplicate selection for ${capabilityId} at ${targetLabel(target)}`);
  if (exact.length === 1) return exact[0]!;
  if (candidates.length > 0) throw new Error(`Selection target mismatch for ${capabilityId} at ${targetLabel(target)}`);
  throw new Error(`Missing selection for ${capabilityId} at ${targetLabel(target)}`);
}

function createCapabilityRoute(
  selection: ProviderSelectionManifest,
  role: CapabilityRole,
  providersById: ReadonlyMap<string, ProviderManifest>,
  eligibilityByKey: ReadonlyMap<string, ProviderTargetEligibility>,
  target: RuntimeTarget
): CapabilityRoute {
  const routes = selectedProviderIds(selection);
  if (routes.length === 0) {
    return { capabilityId: selection.capabilityId, role, selection, preferred: undefined, alternatives: new Map() };
  }
  if (selection.releaseEvidence !== "trialed-p04") {
    throw new Error(`Selection ${selection.id} route requires trialed-p04 evidence`);
  }

  const records = new Map<string, RouteRecord>();
  for (const providerId of routes) {
    const provider = providersById.get(providerId);
    if (provider === undefined) throw new Error(`Missing provider ${providerId} for selection ${selection.id}`);
    records.set(providerId, {
      provider,
      eligibility: findEligibility(eligibilityByKey, providerId, selection.capabilityId, target)
    });
  }
  const preferredProviderId = selection.preferredProviderId;
  if (preferredProviderId === undefined) throw new Error(`Selection ${selection.id} route requires a preferred provider`);
  const alternatives = new Map(selection.alternateProviderIds.map((providerId) => [providerId, records.get(providerId)!]));
  return {
    capabilityId: selection.capabilityId,
    role,
    selection,
    preferred: records.get(preferredProviderId),
    alternatives
  };
}

function selectedProviderIds(selection: ProviderSelectionManifest): string[] {
  const providerIds = [selection.preferredProviderId, ...selection.alternateProviderIds]
    .filter((providerId): providerId is string => providerId !== undefined);
  if (providerIds.length !== new Set(providerIds).size) {
    throw new Error(`Duplicate provider route in selection ${selection.id}`);
  }
  return providerIds;
}

function findEligibility(
  eligibilityByKey: ReadonlyMap<string, ProviderTargetEligibility>,
  providerId: string,
  capabilityId: string,
  target: RuntimeTarget
): ProviderTargetEligibility {
  const exact = eligibilityByKey.get(eligibilityKey(providerId, capabilityId, target));
  if (exact !== undefined) return exact;
  const hasOtherTarget = [...eligibilityByKey.values()].some((record) =>
    record.providerId === providerId && record.capabilityId === capabilityId
  );
  if (hasOtherTarget) throw new Error(`Eligibility target mismatch for ${providerId}/${capabilityId} at ${targetLabel(target)}`);
  throw new Error(`Missing eligibility for ${providerId}/${capabilityId} at ${targetLabel(target)}`);
}

function validateInstalledHealth(
  installed: InstalledTargetHealth | null,
  routes: ReadonlyMap<string, CapabilityRoute>,
  target: RuntimeTarget
): {
  bindings: ReadonlyMap<string, { providerId: string }>;
  failures: ReadonlyMap<string, InstalledTargetHealth["failures"][number]>;
} {
  if (installed === null) return { bindings: new Map(), failures: new Map() };
  const bindings = indexUnique(installed.bindings, (binding) => binding.capabilityId, "installed binding");
  const failures = indexUnique(installed.failures, (failure) => failure.providerId, "installed failure");

  for (const failure of failures.values()) {
    if (!matchesTarget(failure, target)) throw new Error(`Installed failure target mismatch for ${failure.providerId}`);
  }
  for (const [capabilityId, binding] of bindings) {
    const route = routes.get(capabilityId);
    if (route === undefined) throw new Error(`Installed binding is unrelated to pack capability ${capabilityId}`);
    const record = route.preferred?.provider.id === binding.providerId
      ? route.preferred
      : route.alternatives.get(binding.providerId);
    if (record === undefined) throw new Error(`Installed binding provider ${binding.providerId} is not listed for ${capabilityId}`);
    if (!record.eligibility.eligible && !failures.has(binding.providerId)) {
      throw new Error(`Installed binding ${binding.providerId} is ineligible without an installed failure`);
    }
  }
  for (const providerId of failures.keys()) {
    if (![...bindings.values()].some((binding) => binding.providerId === providerId)) {
      throw new Error(`Installed failure for ${providerId} is unrelated to a pack binding`);
    }
  }
  return { bindings, failures };
}

function resolveRoute(
  route: CapabilityRoute,
  installedProviderId: string | undefined
): { providerId: string; role: ResolvedCapabilityProvider["role"]; record: RouteRecord } | undefined {
  if (route.selection.disposition === "rejected" || route.selection.disposition === "unavailable") return undefined;
  if (route.role === "required" && route.selection.disposition !== "selected") return undefined;
  if (installedProviderId !== undefined) {
    if (route.preferred?.provider.id === installedProviderId) {
      return { providerId: installedProviderId, role: "selected", record: route.preferred };
    }
    const alternate = route.alternatives.get(installedProviderId);
    return alternate === undefined ? undefined : { providerId: installedProviderId, role: "alternate", record: alternate };
  }
  return route.preferred === undefined
    ? undefined
    : { providerId: route.preferred.provider.id, role: "selected", record: route.preferred };
}

function isCoverageEligible(record: RouteRecord, pack: CompletePackManifest): boolean {
  const runtimeContract = record.provider.runtimeContracts.find(({ runtime }) => runtime === record.eligibility.target.runtime);
  return record.provider.trustTier === pack.minimumProviderTrust
    && record.provider.status === "stable"
    && record.provider.capabilityIds.includes(record.eligibility.capabilityId)
    && runtimeContract !== undefined
    && runtimeContract.platforms.includes(record.eligibility.target.platform)
    && record.eligibility.eligible
    && record.eligibility.assuranceProfiles.includes(pack.assuranceProfile);
}

function availabilityFor(
  issues: readonly ActionRequiredIssue[],
  missingRequired: readonly string[],
  missingRecommended: readonly string[]
): PackAvailability {
  if (issues.length > 0) return "action-required";
  if (missingRequired.length > 0) return "unavailable";
  if (missingRecommended.length > 0) return "available-with-gaps";
  return "available";
}

function indexUnique<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
  label: string
): ReadonlyMap<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    const key = keyFor(value);
    if (indexed.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
    indexed.set(key, value);
  }
  return indexed;
}

function eligibilityKey(providerId: string, capabilityId: string, target: RuntimeTarget): string {
  return `${providerId}\u0000${capabilityId}\u0000${target.runtime}\u0000${target.platform}`;
}

function selectionKey(capabilityId: string, target: RuntimeTarget): string {
  return `${capabilityId}\u0000${target.runtime}\u0000${target.platform}`;
}

function matchesTarget(value: RuntimeTarget, target: RuntimeTarget): boolean {
  return value.runtime === target.runtime && value.platform === target.platform;
}

function targetLabel(target: RuntimeTarget): string {
  return `${target.runtime}/${target.platform}`;
}

function sortedUniqueStrings(values: readonly string[], label: string): string[] {
  return sortedUnique(values, compareCodePoint, (value) => value, label);
}

function sortedUnique<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
  keyFor: (value: T) => string,
  label: string
): T[] {
  const sorted = [...values].sort(compare);
  for (let index = 1; index < sorted.length; index += 1) {
    if (keyFor(sorted[index - 1]!) === keyFor(sorted[index]!)) throw new Error(`Duplicate ${label}: ${keyFor(sorted[index]!)}`);
  }
  return sorted;
}

function compareCodePoint(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftCharacters[index]!.codePointAt(0)!;
    const rightPoint = rightCharacters[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
  return leftCharacters.length === rightCharacters.length ? 0 : leftCharacters.length < rightCharacters.length ? -1 : 1;
}
