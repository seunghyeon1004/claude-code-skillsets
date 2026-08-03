import type {
  InstallIndex,
  InstallPlugin,
  InstallProfile
} from "../model/install-index.js";
import type { TrustTier } from "../model/manifest.js";
import { satisfies, valid, validRange } from "semver";
import {
  assertSafeExecutable,
  assertSafeId,
  assertSafeMarketplace,
  assertSafeMarketplaceSource
} from "../safety/command-fields.js";

export type { InstallIndex, InstallPlugin, InstallProfile } from "../model/install-index.js";
export type { TrustTier } from "../model/manifest.js";

export type InstallLevel = "essential" | "recommended" | "custom-max";

export interface MarketplaceRegistration {
  id: string;
  source: string;
}

export function normalizeMarketplaceList(rawMarketplaceList: unknown): MarketplaceRegistration[] {
  if (!Array.isArray(rawMarketplaceList)) {
    throw new Error("Invalid marketplace list: expected a top-level array");
  }

  const registrations: MarketplaceRegistration[] = [];
  const seen = new Map<string, string>();

  for (const [index, entry] of rawMarketplaceList.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Invalid marketplace entry at index ${index}`);
    }

    const sourceKind = entry.source;
    if (sourceKind !== "github" && sourceKind !== "git") {
      throw new Error(
        `Unsupported marketplace source at index ${index}: ${JSON.stringify(sourceKind)}`
      );
    }

    const expectedKeys = sourceKind === "github"
      ? ["installLocation", "name", "repo", "source"]
      : ["installLocation", "name", "source", "url"];
    if (!hasExactKeys(entry, expectedKeys)) {
      throw new Error(`Invalid marketplace entry at index ${index} for source ${sourceKind}`);
    }

    const source = sourceKind === "github" ? entry.repo : entry.url;
    if (
      typeof entry.name !== "string"
      || typeof source !== "string"
      || typeof entry.installLocation !== "string"
      || entry.installLocation.length === 0
    ) {
      throw new Error(`Invalid marketplace entry at index ${index} for source ${sourceKind}`);
    }

    assertSafeMarketplace(entry.name, `marketplace list entry ${index} ID`);
    assertSafeMarketplaceSource(source, `marketplace list entry ${index} source`);

    const existingSource = seen.get(entry.name);
    if (existingSource !== undefined) {
      if (existingSource !== source) {
        throw marketplaceSourceConflict(entry.name, existingSource, source);
      }
      throw new Error(`Duplicate marketplace ID: ${entry.name}`);
    }

    seen.set(entry.name, source);
    registrations.push({ id: entry.name, source });
  }

  return registrations;
}

export interface InstallRequest {
  domains: string[];
  purposes: string[];
  tools: string[];
  level: InstallLevel;
  optionalPlugins: string[];
  registeredMarketplaces?: MarketplaceRegistration[];
}

export interface InstallOperation {
  kind: "marketplace-add" | "verify-marketplace" | "install" | "verify-version";
  command: string;
  pluginId?: string;
  marketplace: string;
  marketplaceSource?: string;
  reviewedVersion?: string;
}

export interface InstallPlan {
  required: string[];
  recommended: string[];
  optional: string[];
  warnings: string[];
  commands: string[];
  operations: InstallOperation[];
}

type PlanSection = "required" | "recommended" | "optional";

export function planInstall(request: InstallRequest, index: InstallIndex): InstallPlan {
  for (const executable of index.executables) {
    assertSafeExecutable(executable, "runtime executable");
  }
  for (const profile of index.profiles) {
    assertSafeId(profile.id, `profile ${profile.id}.id`);
    for (const executable of profile.executables) {
      assertSafeExecutable(executable.name, `profile ${profile.id} executable`);
    }
  }
  const plugins = indexPlugins(index.plugins);
  const profiles = matchingProfiles(request, index.profiles);
  const isResearchPending = index.researchPendingPacks.length > 0;
  if (isResearchPending && index.profiles.length !== 0) {
    throw new Error("Purpose profiles require complete P04B external-provider selections");
  }
  const roots = isResearchPending ? brokerRoots() : rootsFor(request, profiles);
  const warnings: string[] = [];
  const installed = new Set<string>();

  const required = resolveSection(roots.required, plugins, installed, warnings);
  const recommended = resolveSection(roots.recommended, plugins, installed, warnings);
  const optional = resolveSection(roots.optional, plugins, installed, warnings);
  const ordered = [...required, ...recommended, ...optional];

  const registeredMarketplaces = indexMarketplaceRegistrations(index, request);
  const operations = ordered.flatMap((id): InstallOperation[] => {
    const plugin = plugins.get(id);
    if (plugin === undefined) {
      throw new Error(`Unknown plugin: ${id}`);
    }
    const result: InstallOperation[] = [];
    if (plugin.kind === "external") {
      const source = requiredExternalField(plugin, "marketplaceSource");
      assertSafeMarketplaceSource(source, `marketplace source for ${plugin.id}`);
      const registeredSource = registeredMarketplaces.get(plugin.marketplace);
      if (registeredSource !== undefined && registeredSource !== source) {
        throw marketplaceSourceConflict(plugin.marketplace, registeredSource, source);
      }
      if (registeredSource === undefined) {
        const expected = `claude plugin marketplace add ${source} --scope user`;
        if (plugin.marketplaceAddCommand !== expected) {
          throw new Error(`Invalid marketplace registration command for plugin: ${plugin.id}`);
        }
        result.push({
          kind: "marketplace-add",
          command: expected,
          marketplace: plugin.marketplace,
          marketplaceSource: source
        });
        registeredMarketplaces.set(plugin.marketplace, source);
      }
      result.push({
        kind: "verify-marketplace",
        command: "claude plugin marketplace list --json",
        marketplace: plugin.marketplace,
        marketplaceSource: source
      });
    }
    result.push({
      kind: "install",
      command: plugin.installCommand,
      pluginId: plugin.id,
      marketplace: plugin.marketplace
    });
    if (plugin.kind === "external") {
      const reviewedVersion = requiredExternalField(plugin, "reviewedVersion");
      if (plugin.versionPinSupported !== false || reviewedVersion !== plugin.version) {
        throw new Error(`Invalid reviewed-version contract for external plugin: ${plugin.id}`);
      }
      if (plugin.verificationCommand !== "claude plugin list --json") {
        throw new Error(`Invalid verification command for external plugin: ${plugin.id}`);
      }
      result.push({
        kind: "verify-version",
        command: plugin.verificationCommand,
        pluginId: plugin.id,
        marketplace: plugin.marketplace,
        reviewedVersion
      });
    }
    return result;
  });

  return {
    required,
    recommended,
    optional,
    warnings,
    commands: operations.map(({ command }) => command),
    operations
  };
}

export function verifyMarketplaceIdentity(
  marketplace: string,
  expectedSource: string,
  rawMarketplaceList: unknown
): void {
  assertSafeMarketplace(marketplace, "expected marketplace ID");
  assertSafeMarketplaceSource(expectedSource, `expected source for marketplace ${marketplace}`);
  const registrations = new Map<string, string>();
  for (const registration of normalizeMarketplaceList(rawMarketplaceList)) {
    addMarketplaceRegistration(registrations, registration, "detected marketplace");
  }
  const detectedSource = registrations.get(marketplace);
  if (detectedSource === undefined) {
    throw new Error(`Marketplace ${marketplace} is missing after registration`);
  }
  if (detectedSource !== expectedSource) {
    throw marketplaceSourceConflict(marketplace, detectedSource, expectedSource);
  }
}

export function verifyReviewedExternalVersion(
  plugin: InstallPlugin,
  installed: Array<{ id: string; marketplace: string; version: string }>
): void {
  if (plugin.kind !== "external") {
    throw new Error(`Reviewed-version verification applies only to external plugins: ${plugin.id}`);
  }
  const reviewedVersion = requiredExternalField(plugin, "reviewedVersion");
  const match = installed.find((candidate) =>
    candidate.id === plugin.id && candidate.marketplace === plugin.marketplace
  );
  if (match === undefined) {
    throw new Error(`External plugin ${plugin.id} is missing after install`);
  }
  if (match.version !== reviewedVersion) {
    throw new Error(
      `External plugin ${plugin.id} reviewed version ${reviewedVersion} does not match installed version ${match.version}`
    );
  }
}

function indexPlugins(plugins: InstallPlugin[]): Map<string, InstallPlugin> {
  const indexed = new Map<string, InstallPlugin>();

  for (const plugin of plugins) {
    assertSafeId(plugin.id, `plugin ${plugin.id}.id`);
    assertSafeMarketplace(plugin.marketplace, `plugin ${plugin.id}.marketplace`);
    for (const dependency of plugin.requiredDependencies) {
      assertSafeId(dependency.id, `plugin ${plugin.id} dependency ID`);
      assertSafeMarketplace(
        dependency.marketplace,
        `plugin ${plugin.id} dependency marketplace`
      );
    }
    if (indexed.has(plugin.id)) {
      throw new Error(`Duplicate plugin ID: ${plugin.id}`);
    }
    if (plugin.marketplace.length === 0) {
      throw new Error(`Plugin marketplace is required: ${plugin.id}`);
    }
    if (!isTrustTier(plugin.trustTier)) {
      throw new Error(`Unknown trust tier for plugin: ${plugin.id}`);
    }
    if (valid(plugin.version) === null) {
      throw new Error(`Invalid plugin version: ${plugin.id}@${plugin.version}`);
    }
    const expectedCommand = `claude plugin install ${plugin.id}@${plugin.marketplace} --scope user`;
    if (plugin.installCommand !== expectedCommand) {
      throw new Error(`Invalid install command for plugin: ${plugin.id}`);
    }
    indexed.set(plugin.id, plugin);
  }

  return indexed;
}

function indexMarketplaceRegistrations(
  index: InstallIndex,
  request: InstallRequest
): Map<string, string> {
  const registrations = new Map<string, string>();
  addMarketplaceRegistration(registrations, index.marketplace, "index marketplace");
  for (const registration of request.registeredMarketplaces ?? []) {
    addMarketplaceRegistration(registrations, registration, "detected marketplace");
  }
  return registrations;
}

function addMarketplaceRegistration(
  registrations: Map<string, string>,
  registration: MarketplaceRegistration,
  context: string
): void {
  if (typeof registration !== "object" || registration === null) {
    throw new Error(`Invalid ${context} registration`);
  }
  assertSafeMarketplace(registration.id, `${context} ID`);
  assertSafeMarketplaceSource(registration.source, `${context} source`);
  const existing = registrations.get(registration.id);
  if (existing !== undefined && existing !== registration.source) {
    throw marketplaceSourceConflict(registration.id, existing, registration.source);
  }
  registrations.set(registration.id, registration.source);
}

function marketplaceSourceConflict(
  marketplace: string,
  detectedSource: string,
  expectedSource: string
): Error {
  return new Error(
    `Marketplace ${marketplace} source conflict: detected ${detectedSource}, expected ${expectedSource}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
}

function brokerRoots(): Record<PlanSection, string[]> {
  return {
    required: ["shared-core", "skillset-manager"],
    recommended: [],
    optional: []
  };
}

function matchingProfiles(request: InstallRequest, profiles: InstallProfile[]): InstallProfile[] {
  return profiles.filter((profile) =>
    intersects(profile.domainIds, request.domains)
    && intersects(profile.purposeIds, request.purposes)
    && (profile.toolIds.length === 0 || intersects(profile.toolIds, request.tools))
  );
}

function rootsFor(request: InstallRequest, profiles: InstallProfile[]): Record<PlanSection, string[]> {
  const roots: Record<PlanSection, Set<string>> = {
    required: new Set(),
    recommended: new Set(),
    optional: new Set()
  };
  for (const profile of profiles) {
    addAll(roots.required, profile.requiredPlugins);
    if (request.level !== "essential") addAll(roots.recommended, profile.recommendedPlugins);
    if (request.level === "custom-max") {
      const selectedOptionalPlugins = new Set(request.optionalPlugins);
      addAll(roots.optional, profile.optionalPlugins.filter((id) => selectedOptionalPlugins.has(id)));
    }
  }
  return {
    required: sorted(roots.required),
    recommended: sorted(roots.recommended),
    optional: sorted(roots.optional)
  };
}

function resolveSection(
  roots: string[],
  plugins: Map<string, InstallPlugin>,
  installed: Set<string>,
  warnings: string[]
): string[] {
  const resolved: string[] = [];
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (installed.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`Installation dependency cycle: ${[...visiting, id].join(" -> ")}`);
    }

    const plugin = plugins.get(id);
    if (plugin === undefined) {
      throw new Error(`Unknown plugin: ${id}`);
    }
    validateTrust(plugin, warnings);

    visiting.add(id);
    for (const dependency of sortedDependencies(plugin.requiredDependencies)) {
      const target = plugins.get(dependency.id);
      if (target === undefined) {
        throw new Error(`Unknown plugin: ${dependency.id}`);
      }
      validateDependency(plugin, dependency, target);
      visit(dependency.id);
    }
    visiting.delete(id);
    installed.add(id);
    resolved.push(id);
  };

  for (const root of roots) {
    visit(root);
  }

  return resolved;
}

function validateDependency(
  owner: InstallPlugin,
  dependency: InstallPlugin["requiredDependencies"][number],
  target: InstallPlugin
): void {
  if (dependency.marketplace !== target.marketplace) {
    throw new Error(
      `Dependency marketplace mismatch: ${owner.id} requires ${dependency.id}@${dependency.marketplace}, resolved target is ${dependency.id}@${target.marketplace}`
    );
  }
  if (dependency.version === undefined) return;
  if (validRange(dependency.version) === null) {
    throw new Error(
      `Invalid dependency range: ${owner.id} requires ${dependency.id}@${dependency.version}`
    );
  }
  if (!satisfies(target.version, dependency.version)) {
    throw new Error(
      `Unsatisfied dependency range: ${owner.id} requires ${dependency.id}@${dependency.version}, resolved version is ${target.version}`
    );
  }
}

function validateTrust(plugin: InstallPlugin, warnings: string[]): void {
  if (plugin.trustTier === "blocked") {
    throw new Error(`Blocked plugin source: ${plugin.id}@${plugin.marketplace}`);
  }
  if (plugin.trustTier === "community") {
    warnings.push(`Community source requires review: ${plugin.id}@${plugin.marketplace}`);
  }
}

function addAll(target: Set<string>, values: string[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function intersects(left: string[], right: string[]): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function isTrustTier(value: string): value is TrustTier {
  return value === "verified" || value === "trusted" || value === "community" || value === "blocked";
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareIds);
}

function sortedDependencies(
  values: InstallPlugin["requiredDependencies"]
): InstallPlugin["requiredDependencies"] {
  return [...values].sort((left, right) =>
    compareIds(left.id, right.id)
    || compareIds(left.marketplace, right.marketplace)
    || compareIds(left.version ?? "", right.version ?? "")
  );
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredExternalField<K extends keyof InstallPlugin>(
  plugin: InstallPlugin,
  field: K
): NonNullable<InstallPlugin[K]> {
  const value = plugin[field];
  if (value === undefined || value === "") {
    throw new Error(`Missing external plugin field ${String(field)}: ${plugin.id}`);
  }
  return value as NonNullable<InstallPlugin[K]>;
}
