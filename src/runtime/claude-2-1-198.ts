import { valid } from "semver";
import { normalizeMarketplaceList } from "../installer/plan.js";
import { assertSafeId } from "../safety/command-fields.js";

export const CLAUDE_CODE_VERSION = "2.1.198";

export interface ClaudeMarketplaceRow {
  id: string;
  source: string;
}

export interface ClaudePluginRow {
  pluginName: string;
  marketplaceId: string;
  version: string | null;
  versionStatus: "observed-semver" | "unknown";
  scope: "user" | "project" | "local";
  enabled: boolean;
}

export type ClaudeEnabledPluginVersion = Pick<ClaudePluginRow, "version" | "versionStatus">;

/** Strictly parses the documented Claude Code 2.1.198 version line. */
export function parseClaudeVersion21198(stdout: string): typeof CLAUDE_CODE_VERSION {
  if (stdout !== `${CLAUDE_CODE_VERSION} (Claude Code)\n` && stdout !== `${CLAUDE_CODE_VERSION} (Claude Code)`) {
    throw new Error("Unexpected Claude Code version output");
  }
  return CLAUDE_CODE_VERSION;
}

/** Adapts raw `claude plugin marketplace list --json` bytes to canonical identities. */
export function parseClaudeMarketplaceList21198(stdout: string): ClaudeMarketplaceRow[] {
  const value = parseJson(stdout, "marketplace list");
  return normalizeMarketplaceList(value).map(({ id, source }) => ({ id, source }));
}

/** Adapts raw `claude plugin list --json` bytes without accepting ambiguous identities. */
export function parseClaudePluginList21198(stdout: string): ClaudePluginRow[] {
  const parsed = parseJson(stdout, "plugin list");
  if (!Array.isArray(parsed)) throw new Error("Invalid plugin list: expected a top-level array");
  const rows: ClaudePluginRow[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    if (!isRecord(entry) || !hasRequiredKeys(entry, ["id", "version", "scope", "enabled"])) {
      throw new Error(`Invalid plugin list entry at index ${index}`);
    }
    if (typeof entry.id !== "string" || typeof entry.version !== "string" || !isScope(entry.scope)
      || typeof entry.enabled !== "boolean" || !isObservedVersionField(entry.version)) {
      throw new Error(`Invalid plugin list entry at index ${index}`);
    }
    const [pluginName, marketplaceId] = splitCompositePluginId(entry.id, index);
    const semver = valid(entry.version);
    const key = `${pluginName}\u0000${marketplaceId}\u0000${entry.scope}`;
    if (seen.has(key)) throw new Error(`Duplicate plugin identity at index ${index}`);
    seen.add(key);
    rows.push({
      pluginName,
      marketplaceId,
      version: semver,
      versionStatus: semver === null ? "unknown" : "observed-semver",
      scope: entry.scope,
      enabled: entry.enabled
    });
  }
  return rows;
}

export function exactEnabledPluginVersion(
  rows: readonly ClaudePluginRow[],
  expected: Pick<ClaudePluginRow, "pluginName" | "marketplaceId" | "scope">
): ClaudeEnabledPluginVersion | null {
  const matches = rows.filter((row) => row.pluginName === expected.pluginName
    && row.marketplaceId === expected.marketplaceId && row.scope === expected.scope);
  if (matches.length > 1) throw new Error("Ambiguous installed plugin identity");
  const match = matches[0];
  return match?.enabled === true
    ? { version: match.version, versionStatus: match.versionStatus }
    : null;
}

function parseJson(stdout: string, label: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`Invalid ${label}: expected JSON output`);
  }
}

function splitCompositePluginId(value: string, index: number): [string, string] {
  if (value.split("@").length !== 2) throw new Error(`Invalid composite plugin ID at index ${index}`);
  const [pluginName, marketplaceId] = value.split("@");
  if (pluginName === undefined || marketplaceId === undefined) throw new Error(`Invalid composite plugin ID at index ${index}`);
  try {
    assertSafeId(pluginName, `plugin list entry ${index} plugin name`);
    assertSafeId(marketplaceId, `plugin list entry ${index} marketplace ID`);
  } catch {
    throw new Error(`Invalid composite plugin ID at index ${index}`);
  }
  return [pluginName, marketplaceId];
}

function hasRequiredKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(value, key));
}

function isScope(value: unknown): value is ClaudePluginRow["scope"] {
  return value === "user" || value === "project" || value === "local";
}

function isObservedVersionField(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
