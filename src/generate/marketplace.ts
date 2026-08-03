import type { BrokerManifestRepository } from "../manifest/repository.js";
import type { LocalizedText, PluginDependency } from "../model/manifest.js";
import { assertBrokerCommandFields } from "../safety/command-fields.js";
import { selectPublication } from "../policy/publication.js";

export interface MarketplaceDependency {
  name: string;
  marketplace?: string;
  version?: string;
}

export interface MarketplacePlugin {
  name: string;
  displayName: string;
  description?: string;
  source: string;
  version: string;
  homepage: string;
  category: "productivity";
  dependencies?: MarketplaceDependency[];
  tags?: string[];
}

export interface Marketplace {
  $schema: string;
  name: string;
  description: string;
  owner: { name: string };
  plugins: MarketplacePlugin[];
}

export function generateMarketplace(repository: BrokerManifestRepository): Marketplace {
  assertBrokerCommandFields(repository);
  const publication = selectPublication(repository);
  const manager = publication.plugins.find(({ id }) => id === "skillset-manager");
  if (manager?.description === undefined) {
    throw new Error("skillset-manager must expose a bilingual description");
  }
  return {
    $schema: "https://json.schemastore.org/claude-code-marketplace.json",
    name: "claude-code-skillsets",
    description: marketplaceDescription(manager.description),
    owner: { name: "seunghyeon1004" },
    plugins: publication.plugins.map((plugin) => ({
      name: plugin.id,
      ...marketplaceMetadata(plugin.id),
      ...(plugin.id === "skillset-manager" && plugin.description !== undefined
        ? { description: `${plugin.description.en} / ${plugin.description.ko}` }
        : {}),
      source: plugin.source,
      version: plugin.version,
      ...(plugin.requiredDependencies.length > 0 ? {
        dependencies: [...plugin.requiredDependencies].sort(compareDependencies).map(toMarketplaceDependency)
      } : {}),
      tags: [plugin.id === "shared-core" ? "broker" : "setup"]
    }))
  };
}

export function bilingualPluginDescription(description: LocalizedText): string {
  return `${description.en} / ${description.ko}`;
}

function marketplaceDescription(description: LocalizedText): string {
  return `No-vendoring broker with source-identity evidence. ${description.en} / source identity 근거 기반 비번들 브로커입니다. ${description.ko}`;
}

function marketplaceMetadata(pluginId: string): Pick<MarketplacePlugin, "displayName" | "homepage" | "category"> {
  const homepage = "https://github.com/seunghyeon1004/claude-code-skillsets#readme";
  switch (pluginId) {
    case "shared-core":
      return { displayName: "Shared Core", homepage, category: "productivity" };
    case "skillset-manager":
      return { displayName: "Skillset Manager", homepage, category: "productivity" };
    default:
      throw new Error(`Unknown broker plugin metadata: ${pluginId}`);
  }
}

function toMarketplaceDependency(dependency: PluginDependency): MarketplaceDependency {
  return {
    name: dependency.name,
    ...(dependency.marketplace === undefined ? {} : { marketplace: dependency.marketplace }),
    ...(dependency.version === undefined ? {} : { version: dependency.version })
  };
}

function compareDependencies(left: PluginDependency, right: PluginDependency): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}
