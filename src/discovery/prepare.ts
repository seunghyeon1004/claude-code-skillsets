import { planInstall, type InstallPlan } from "../installer/plan.js";
import { HARD_GATE_IDS } from "../model/complete-v1.js";
import type {
  DomainId,
  NativePluginRuntimeContract,
  Platform,
  ProviderManifest,
  ProviderSelectionManifest,
  RuntimeId,
  SourceReviewManifest
} from "../model/complete-v1.js";
import type { InstallIndex, InstallPlugin, InstallProfile, RuntimeDomain } from "../model/install-index.js";
import type { CompleteV1Repository } from "../manifest/complete-v1-repository.js";
import type { DiscoveryIndex, DiscoveredSkillContract } from "./broker.js";

export interface ReviewedPrepareRepository {
  completeV1: CompleteV1Repository;
  providers: readonly ProviderManifest[];
  sourceReviews: readonly SourceReviewManifest[];
  providerSelections: readonly ProviderSelectionManifest[];
}

export interface ReviewedPrepareInput {
  selectedDomainId: DomainId;
  discoveryIndex: DiscoveryIndex;
  repository: ReviewedPrepareRepository;
  installIndex: InstallIndex;
  runtime?: RuntimeId;
  platform?: Platform;
}

export interface ReviewedInstallPreview {
  status: "ready";
  domainId: DomainId;
  providerIds: string[];
  profileIds: string[];
  plan: InstallPlan;
}

export interface HeldReviewedInstallPreview {
  status: "held";
  domainId: DomainId;
  reasons: string[];
}

export type ReviewedPrepareResult = ReviewedInstallPreview | HeldReviewedInstallPreview;

interface ProviderAnchor {
  providerId: string;
  pluginId: string;
  capabilityId: string;
  version: string;
}

/**
 * Prepares commands without executing them. A discovered candidate is evidence only;
 * it can enter a plan solely through an eligible review, selected provider, and profile.
 */
export function prepareReviewedInstallPreview(input: ReviewedPrepareInput): ReviewedPrepareResult {
  const runtime = input.runtime ?? "claude-code";
  const platform = input.platform ?? "darwin";
  const { selectedDomainId, repository, installIndex } = input;

  if (!repository.completeV1.domains.some(({ id }) => id === selectedDomainId)) {
    return held(selectedDomainId, `Selected domain ${selectedDomainId} is not present in the complete-v1 repository.`);
  }

  const runtimeDomain = installIndex.domains.find(({ id }) => id === selectedDomainId);
  if (runtimeDomain === undefined) {
    return held(selectedDomainId, `No generated runtime domain targets ${selectedDomainId}.`);
  }

  const profiles = matchingDomainProfiles(installIndex.profiles, selectedDomainId);
  if (profiles.length === 0) {
    return held(selectedDomainId, `No generated install profile targets domain ${selectedDomainId}.`);
  }

  const domainCapabilities = capabilitiesForDomain(repository.completeV1, selectedDomainId);
  const selections = repository.providerSelections.filter((selection) =>
    selection.disposition === "selected"
    && selection.preferredProviderId !== undefined
    && selection.runtime === runtime
    && selection.platform === platform
    && domainCapabilities.has(selection.capabilityId)
  );
  if (selections.length === 0) {
    return held(selectedDomainId, `No selected provider selection targets domain ${selectedDomainId} for ${runtime}/${platform}.`);
  }

  const providersById = new Map(repository.providers.map((provider) => [provider.id, provider]));
  const reviewsById = new Map(repository.sourceReviews.map((review) => [review.id, review]));
  const pluginsById = new Map(installIndex.plugins.map((plugin) => [plugin.id, plugin]));
  const diagnostics: string[] = [];
  const anchors = new Map<string, ProviderAnchor>();

  for (const selection of selections) {
    const providerId = selection.preferredProviderId!;
    const provider = providersById.get(providerId);
    if (provider === undefined) {
      diagnostics.push(`Selected provider ${providerId} is absent from the provider repository.`);
      continue;
    }
    const review = reviewsById.get(provider.sourceReviewId);
    if (review === undefined) {
      diagnostics.push(`Selected provider ${provider.id} has no source review ${provider.sourceReviewId}.`);
      continue;
    }
    const anchor = anchorProvider({
      selectedDomainId,
      selection,
      provider,
      review,
      discoveryIndex: input.discoveryIndex,
      pluginsById,
      runtime,
      platform
    });
    if (typeof anchor === "string") {
      diagnostics.push(anchor);
      continue;
    }
    anchors.set(anchor.pluginId, anchor);
  }

  if (anchors.size === 0) {
    return {
      status: "held",
      domainId: selectedDomainId,
      reasons: uniqueSorted(diagnostics)
    };
  }

  const profileAnchorError = validateProfileAnchors({
    selectedDomainId,
    runtimeDomain,
    profiles,
    capabilities: domainCapabilities,
    anchors: [...anchors.values()]
  });
  if (profileAnchorError !== undefined) {
    return held(selectedDomainId, profileAnchorError);
  }

  let plan: InstallPlan;
  try {
    plan = planInstall({
      domains: [selectedDomainId],
      purposes: uniqueSorted(profiles.flatMap(({ purposeIds }) => purposeIds)),
      tools: uniqueSorted(profiles.flatMap(({ toolIds }) => toolIds)),
      level: "essential",
      optionalPlugins: []
    }, installIndex);
  } catch (error) {
    return held(selectedDomainId, `Generated profile cannot produce an install preview: ${errorMessage(error)}`);
  }

  const anchorPluginIds = new Set(anchors.keys());
  for (const anchor of anchors.values()) {
    if (!plan.operations.some((operation) => operation.kind === "install" && operation.pluginId === anchor.pluginId)) {
      return held(selectedDomainId, `Generated install preview does not include reviewed plugin ${anchor.pluginId}.`);
    }
    if (!plan.operations.some((operation) =>
      operation.kind === "verify-version"
      && operation.pluginId === anchor.pluginId
      && operation.reviewedVersion === anchor.version
    )) {
      return held(selectedDomainId, `Generated install preview does not verify reviewed version ${anchor.version} for plugin ${anchor.pluginId}.`);
    }
  }
  for (const operation of plan.operations) {
    if (operation.kind !== "install") continue;
    if (operation.pluginId === undefined || anchorPluginIds.has(operation.pluginId)) continue;
    const profile = profiles.find(({ requiredPlugins }) => requiredPlugins.includes(operation.pluginId!));
    return held(
      selectedDomainId,
      `Generated profile ${profile?.id ?? "for domain " + selectedDomainId} includes plugin ${operation.pluginId} without an eligible reviewed selected-provider anchor.`
    );
  }

  return {
    status: "ready",
    domainId: selectedDomainId,
    providerIds: uniqueSorted([...anchors.values()].map(({ providerId }) => providerId)),
    profileIds: profiles.map(({ id }) => id),
    plan
  };
}

function anchorProvider(input: {
  selectedDomainId: DomainId;
  selection: ProviderSelectionManifest;
  provider: ProviderManifest;
  review: SourceReviewManifest;
  discoveryIndex: DiscoveryIndex;
  pluginsById: ReadonlyMap<string, InstallPlugin>;
  runtime: RuntimeId;
  platform: Platform;
}): ProviderAnchor | string {
  const { selectedDomainId, selection, provider, review, discoveryIndex, pluginsById, runtime, platform } = input;
  if (provider.status !== "stable" || provider.trustTier === "blocked") {
    return `Selected provider ${provider.id} is not a stable non-blocked provider.`;
  }
  if (selection.terminalReviewIds.length !== 0) {
    return `Selected provider selection ${selection.id} must not include terminal reviews.`;
  }
  if (
    review.providerId !== provider.id
    || !provider.capabilityIds.includes(selection.capabilityId)
    || !review.linkedDomainIds.includes(selectedDomainId)
    || !review.capabilityIds.includes(selection.capabilityId)
  ) {
    return `Source review ${review.id} does not anchor selected provider ${provider.id} to domain ${selectedDomainId} and capability ${selection.capabilityId}.`;
  }
  if (review.observedVersion !== provider.version) {
    return `Source review ${review.id} observed version does not match provider ${provider.id} version ${provider.version}.`;
  }
  const targetReview = review.capabilityTargetReviews.find((target) =>
    target.runtime === runtime && target.platform === platform && target.capabilityId === selection.capabilityId
  );
  if (
    targetReview?.decision !== "eligible"
    || HARD_GATE_IDS.some((id) => !targetReview.hardGates.some((gate) => gate.id === id && gate.passed))
  ) {
    return `Source review ${review.id} is not eligible for ${selection.capabilityId} on ${runtime}/${platform}.`;
  }
  if (!review.compatibility.some((target) =>
    target.runtime === runtime && target.platforms.includes(platform)
  )) {
    return `Source review ${review.id} does not declare compatibility for ${runtime}/${platform}.`;
  }
  const runtimeContract = provider.runtimeContracts.find(isNativePluginRuntimeContractFor(runtime, platform));
  if (runtimeContract === undefined) {
    return `Selected provider ${provider.id} has no native plugin contract for ${runtime}/${platform}.`;
  }
  if (
    runtimeContract.reviewedCommit !== review.reviewedCommit
    || review.marketplaceIdentity === null
    || review.marketplaceIdentity.id !== runtimeContract.marketplaceId
    || review.marketplaceIdentity.source !== runtimeContract.marketplaceSource
  ) {
    return `Source review ${review.id} does not match the runtime contract for provider ${provider.id}.`;
  }
  if (!hasExactDiscoveryArtifactProvenance(discoveryIndex.contracts, review, runtimeContract)) {
    return `Source review ${review.id} has no discovery observation matching its reviewed repository, path, commit, and snapshot.`;
  }
  const plugin = pluginsById.get(runtimeContract.pluginId);
  if (
    plugin === undefined
    || plugin.kind !== "external"
    || plugin.marketplace !== runtimeContract.marketplaceId
    || plugin.marketplaceSource !== runtimeContract.marketplaceSource
    || plugin.source !== review.originalRepository
    || plugin.versionPinSupported !== false
    || plugin.verificationCommand !== "claude plugin list --json"
  ) {
    return `Generated plugin ${runtimeContract.pluginId} does not preserve the reviewed runtime contract for provider ${provider.id}.`;
  }
  if (plugin.version !== provider.version || plugin.reviewedVersion !== provider.version) {
    return `Generated plugin ${runtimeContract.pluginId} does not preserve the reviewed version ${provider.version} for provider ${provider.id}.`;
  }
  return {
    providerId: provider.id,
    pluginId: plugin.id,
    capabilityId: selection.capabilityId,
    version: provider.version
  };
}

function isNativePluginRuntimeContractFor(
  runtime: RuntimeId,
  platform: Platform
): (contract: ProviderManifest["runtimeContracts"][number]) => contract is NativePluginRuntimeContract {
  return (contract): contract is NativePluginRuntimeContract =>
    contract.packaging === "native-plugin"
    && contract.runtime === runtime
    && contract.platforms.includes(platform);
}

function capabilitiesForDomain(repository: CompleteV1Repository, domainId: DomainId): Map<string, string[]> {
  return new Map(
    repository.capabilityCollections
      .filter((collection) => collection.domainId === domainId)
      .flatMap(({ capabilities }) => capabilities.map(({ id, categoryIds }) => [id, categoryIds] as const))
  );
}

function matchingDomainProfiles(profiles: readonly InstallProfile[], domainId: DomainId): InstallProfile[] {
  return profiles
    .filter(({ domainIds }) => domainIds.includes(domainId))
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
}

function hasExactDiscoveryArtifactProvenance(
  contracts: readonly DiscoveredSkillContract[],
  review: SourceReviewManifest,
  runtimeContract: NativePluginRuntimeContract
): boolean {
  return contracts.some((contract) =>
    contract.observations.some((observation) =>
      observation.repositoryUrl === review.originalRepository
      && review.selectedPaths.includes(observation.selectedSkillPath)
      && observation.observedCommit === review.reviewedCommit
      && review.snapshotIds.includes(observation.snapshotId)
      && runtimeContract.artifacts.some(({ path }) =>
        path === observation.selectedSkillPath && review.selectedPaths.includes(path)
      )
    )
  );
}

function validateProfileAnchors(input: {
  selectedDomainId: DomainId;
  runtimeDomain: RuntimeDomain;
  profiles: readonly InstallProfile[];
  capabilities: ReadonlyMap<string, readonly string[]>;
  anchors: readonly ProviderAnchor[];
}): string | undefined {
  const { selectedDomainId, runtimeDomain, profiles, capabilities, anchors } = input;
  for (const profile of profiles) {
    if (!runtimeDomain.profileIds.includes(profile.id) || !profile.domainIds.includes(selectedDomainId)) {
      return `Generated profile ${profile.id} is not linked to runtime domain ${selectedDomainId}.`;
    }
    for (const purposeId of profile.purposeIds) {
      if (!runtimeDomain.purposeIds.includes(purposeId)) {
        return `Generated profile ${profile.id} purpose ${purposeId} is not linked to runtime domain ${selectedDomainId}.`;
      }
      if (!anchors.some(({ capabilityId }) => capabilities.get(capabilityId)?.includes(purposeId))) {
        return `Generated profile ${profile.id} purpose ${purposeId} is not anchored to a selected provider capability.`;
      }
    }
  }
  return undefined;
}

function held(domainId: DomainId, reason: string): HeldReviewedInstallPreview {
  return { status: "held", domainId, reasons: [reason] };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
