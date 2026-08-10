import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { validateDependencyGraph, type DependencyNode } from "../graph/dependencies.js";
import {
  loadManifestRepository,
  type BrokerManifestRepository
} from "../manifest/repository.js";
import { validateDecisionIndex } from "../contracts/decision.js";
import { assertBrokerCommandFields } from "../safety/command-fields.js";
import {
  OFFICIAL_MARKETPLACE_ID,
  loadOfficialMarketplaceBaseline,
  officialMarketplaceRecommendations
} from "../discovery/official-marketplace.js";
import { COMPLETE_V1_DOMAIN_IDS } from "../model/complete-v1.js";
import type { DomainManifest } from "../model/manifest.js";
import { generateCatalogs, type GeneratedCatalogs } from "./catalog.js";
import { generateDecisionIndex } from "./decision-index.js";
import { bilingualPluginDescription, generateMarketplace } from "./marketplace.js";
import { generateRoutingIndex } from "./routing-index.js";

export interface GeneratedArtifacts extends GeneratedCatalogs {
  marketplace: string;
  officialMarketplaceIndex: string;
  decisionIndex: string;
  routingIndex: string;
}

export async function generateAll(root: string): Promise<GeneratedArtifacts> {
  const repository = await loadManifestRepository(root);
  validateRepositoryGraph(repository.broker);
  await validateRepositoryReferences(root, repository.broker);
  const decisionIndex = await generateDecisionIndex(root);
  const validatedDecisionIndex = validateDecisionIndex(JSON.parse(decisionIndex));
  const catalogs = generateCatalogs(repository, validatedDecisionIndex);
  return {
    marketplace: serializeJson(generateMarketplace(repository.broker)),
    officialMarketplaceIndex: generateOfficialMarketplaceIndex(
      repository.completeV1.domains,
      loadOfficialMarketplaceBaseline(root)
    ),
    decisionIndex,
    routingIndex: generateRoutingIndex(validatedDecisionIndex),
    ...catalogs
  };
}

export function generateOfficialMarketplaceIndex(
  domains: readonly DomainManifest[],
  baseline = loadOfficialMarketplaceBaseline()
): string {
  const recommendations = officialMarketplaceRecommendations(baseline);
  const domainById = new Map(domains.map((domain) => [domain.id, domain]));
  if (domains.length !== COMPLETE_V1_DOMAIN_IDS.length || domainById.size !== COMPLETE_V1_DOMAIN_IDS.length) {
    throw new Error("official marketplace index requires exactly 20 unique Complete v1 domains");
  }

  const generatedDomains = COMPLETE_V1_DOMAIN_IDS.map((domainId) => {
    const domain = domainById.get(domainId);
    if (domain === undefined) {
      throw new Error(`official marketplace index is missing Complete v1 domain ${domainId}`);
    }
    return {
      id: domainId,
      name: domain.name,
      candidates: recommendations[domainId].map((candidate) => ({
        name: candidate.name,
        description: candidate.description,
        listingStatus: candidate.listingStatus,
        individualSafetyReview: candidate.individualSafetyReview,
        sourcePin: candidate.sourcePin,
        permissions: "unknown",
        license: "unknown",
        trust: "unknown",
        dependencies: "unknown",
        reviewedVersionVerification: "unavailable",
        classificationRoutes: candidate.classificationRoutes
      }))
    };
  });

  const unknownDomain = domains.find((domain) => !COMPLETE_V1_DOMAIN_IDS.includes(domain.id as never));
  if (unknownDomain !== undefined) {
    throw new Error(`official marketplace index contains unknown Complete v1 domain ${unknownDomain.id}`);
  }

  return serializeJson({
    schemaVersion: 1,
    pathKind: "official-listing-delegated",
    marketplace: {
      id: OFFICIAL_MARKETPLACE_ID,
      source: "anthropics/claude-plugins-official",
      ...baseline.provenance,
      pluginCount: baseline.plugins.length,
      listingStatus: "marketplace-listed",
      individualSafetyReview: "not-complete"
    },
    notices: {
      listing: {
        ko: "공식 마켓플레이스 등재는 확인됐지만 개별 플러그인의 안전성 검토 완료를 뜻하지 않습니다.",
        en: "Official marketplace listing is confirmed, but it does not mean the individual plugin safety review is complete."
      },
      safety: {
        ko: "각 후보의 개별 안전성 검토 상태는 완료되지 않았습니다.",
        en: "Individual safety review is not complete for each candidate."
      }
    },
    executionStatus: "not-executed",
    decisionAuthority: "none",
    nextAction: "use-decision-plan",
    domains: generatedDomains
  });
}

export async function validateRepositoryReferences(
  root: string,
  repository: BrokerManifestRepository
): Promise<void> {
  const rootReal = await realpath(root);
  for (const plugin of repository.plugins) {
    const sourceRoot = await containedExistingPath(rootReal, plugin.source, `Broker plugin ${plugin.id} source`);
    if (!(await lstat(sourceRoot)).isDirectory()) {
      throw new Error(`Broker plugin ${plugin.id} source is not a directory: ${plugin.source}`);
    }
    const pluginJsonPath = await containedExistingPath(
      rootReal,
      join(plugin.source, ".claude-plugin", "plugin.json"),
      `Broker plugin ${plugin.id} plugin.json`
    );
    const pluginJson = JSON.parse(await readFile(pluginJsonPath, "utf8")) as unknown;
    if (!isRecord(pluginJson) || pluginJson.name !== plugin.id || pluginJson.version !== plugin.version) {
      throw new Error(`Broker plugin ${plugin.id} plugin.json identity mismatch`);
    }
    if (plugin.description !== undefined
      && pluginJson.description !== bilingualPluginDescription(plugin.description)) {
      throw new Error(`Broker plugin ${plugin.id} plugin.json description mismatch`);
    }
    const actualDependencies = pluginJson.dependencies === undefined ? [] : pluginJson.dependencies;
    const expectedDependencies = plugin.requiredDependencies.map(toPluginManifestDependency);
    if (!Array.isArray(actualDependencies)
      || JSON.stringify(actualDependencies) !== JSON.stringify(expectedDependencies)) {
      throw new Error(`Broker plugin ${plugin.id} plugin.json dependencies mismatch`);
    }
  }
}

function toPluginManifestDependency(dependency: BrokerManifestRepository["plugins"][number]["requiredDependencies"][number]): string | Record<string, string> {
  if (dependency.marketplace === undefined && dependency.version === undefined) return dependency.name;
  return {
    name: dependency.name,
    ...(dependency.marketplace === undefined ? {} : { marketplace: dependency.marketplace }),
    ...(dependency.version === undefined ? {} : { version: dependency.version })
  };
}

export function validateRepositoryGraph(repository: BrokerManifestRepository): void {
  assertBrokerCommandFields(repository);
  const nodes: DependencyNode[] = repository.plugins.map((plugin) => ({
    id: plugin.id,
    required: plugin.requiredDependencies.map((dependency) => dependency.name)
  }));
  validateDependencyGraph(nodes);
  const ids = repository.plugins.map((plugin) => plugin.id).sort(compareStrings);
  if (ids.length !== 2 || ids[0] !== "shared-core" || ids[1] !== "skillset-manager") {
    throw new Error("Broker graph must contain exactly shared-core and skillset-manager");
  }
  const manager = repository.plugins.find(({ id }) => id === "skillset-manager")!;
  if (manager.requiredDependencies.length !== 1 || manager.requiredDependencies[0]?.name !== "shared-core") {
    throw new Error("skillset-manager must require shared-core as its only broker dependency");
  }
  if (manager.requiredDependencies[0].marketplace !== undefined
    && manager.requiredDependencies[0].marketplace !== "claude-code-skillsets") {
    throw new Error("skillset-manager dependency shared-core must resolve from claude-code-skillsets");
  }
}

async function containedExistingPath(rootReal: string, path: string, label: string): Promise<string> {
  if (isAbsolute(path)) throw new Error(`${label} must be repository-relative: ${path}`);
  const lexical = resolve(rootReal, path);
  assertContained(rootReal, lexical, label, path);
  let targetReal: string;
  try {
    targetReal = await realpath(lexical);
  } catch (error) {
    throw new Error(`${label} does not exist: ${path}`, { cause: error });
  }
  assertContained(rootReal, targetReal, label, path);
  return targetReal;
}

function assertContained(root: string, target: string, label: string, original: string): void {
  const relation = relative(root, target);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} escapes the repository: ${original}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
