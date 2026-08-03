import type {
  ResearchCountMetric,
  ResearchSnapshotEntry,
  ResearchSourceConfig,
  SnapshotEntryKind
} from "../model/complete-v1.js";
import {
  SNAPSHOT_ENTRY_KINDS,
  canonicalizeSnapshotEntries,
  compareCodePointStrings
} from "./snapshot.js";

const MARKETPLACE_PATH_SUFFIX = "/.claude-plugin/marketplace.json";
const GITHUB_ROOT_REPOSITORY_URL_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)\/([A-Za-z0-9_.-]+)$/u;
const GITHUB_DISCOVERY_REPOSITORY_URL_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)\/([A-Za-z0-9_.-]+)(?:[/?#][^\s]*)?$/u;

export function classifyTreePath(path: string): SnapshotEntryKind | undefined {
  if (path.split("/").at(-1) === "SKILL.md") {
    return "skill-file";
  }
  if (path.endsWith("/.claude-plugin/plugin.json") || path === ".claude-plugin/plugin.json") {
    return "plugin-manifest";
  }
  return undefined;
}

export function isMarketplacePath(path: string): boolean {
  return path.endsWith(MARKETPLACE_PATH_SUFFIX) || path === ".claude-plugin/marketplace.json";
}

export function classifyTree(
  paths: readonly string[],
  marketplaceDocuments: ReadonlyMap<string, unknown>,
  markdownDocuments: ReadonlyMap<string, string>,
  config: ResearchSourceConfig
): ResearchSnapshotEntry[] {
  const entries: ResearchSnapshotEntry[] = [{
    kind: "repository-record",
    address: ".",
    sourceUrl: config.repository
  }];

  for (const path of [...paths].sort(compareCodePointStrings)) {
    const kind = classifyTreePath(path);
    if (kind !== undefined) {
      entries.push({ kind, address: path, sourceUrl: null });
    }
    if (isMarketplacePath(path)) {
      const document = parseClosedMarketplace(marketplaceDocuments.get(path), path);
      document.plugins.forEach((plugin, index) => entries.push({
        kind: "marketplace-entry",
        address: `${path}#/plugins/${index}`,
        sourceUrl: marketplaceHttpsGitHubRepositoryUrl(plugin.source)
      }));
    }
  }

  for (const path of config.markdownIndexPaths) {
    extractHttpsGitHubLinks(markdownDocuments.get(path) ?? "").forEach((sourceUrl, index) => entries.push({
      kind: "repository-record",
      address: `${path}#link/${index}`,
      sourceUrl
    }));
  }

  return canonicalizeSnapshotEntries(entries);
}

export function independentCounts(
  entries: readonly ResearchSnapshotEntry[],
  config: ResearchSourceConfig
): ResearchCountMetric[] {
  const claimByKind = new Map(config.reportedCountClaims.map((claim) => [claim.kind, claim]));
  return SNAPSHOT_ENTRY_KINDS
    .filter((kind) => entries.some((entry) => entry.kind === kind))
    .map((kind) => {
      const claim = claimByKind.get(kind);
      return {
        kind,
        reportedCount: claim?.count ?? null,
        reportedCountSourceUrl: claim?.sourceUrl ?? null,
        independentlyCountedTotal: entries.filter((entry) => entry.kind === kind).length
      };
    });
}

interface ClosedMarketplace {
  plugins: Array<{ source: unknown }>;
}

function parseClosedMarketplace(value: unknown, path: string): ClosedMarketplace {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: marketplace must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.plugins)) {
    throw new Error(`${path}:/plugins must be an array`);
  }
  return {
    plugins: record.plugins.map((plugin, index) => {
      if (typeof plugin !== "object" || plugin === null || Array.isArray(plugin) || !("source" in plugin)) {
        throw new Error(`${path}:/plugins/${index}/source is required`);
      }
      return { source: (plugin as Record<string, unknown>).source };
    })
  };
}

function marketplaceHttpsGitHubRepositoryUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return canonicalGitHubRepositoryUrl(value, GITHUB_ROOT_REPOSITORY_URL_PATTERN);
}

function markdownHttpsGitHubRepositoryUrl(value: string): string | null {
  return canonicalGitHubRepositoryUrl(value, GITHUB_DISCOVERY_REPOSITORY_URL_PATTERN);
}

function canonicalGitHubRepositoryUrl(value: string, pattern: RegExp): string | null {
  const match = pattern.exec(value);
  if (match === null) {
    return null;
  }
  const owner = match[1]!;
  const repository = match[2]!.replace(/\.git$/u, "");
  if (repository.length === 0 || isGitHubAttachmentNamespace(owner, repository)) {
    return null;
  }
  return `https://github.com/${owner}/${repository}`;
}

function isGitHubAttachmentNamespace(owner: string, repository: string): boolean {
  return owner.toLowerCase() === "user-attachments" && repository.toLowerCase() === "assets";
}

function extractHttpsGitHubLinks(markdown: string): string[] {
  return [...markdown.matchAll(/https:\/\/github\.com\/[^\s<>"']+/gu)]
    .map(([url]) => markdownHttpsGitHubRepositoryUrl(url.replace(/[),.;\]}]+$/u, "")))
    .filter((url): url is string => url !== null)
    .filter((url, index, all) => all.indexOf(url) === index);
}
