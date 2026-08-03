import { lstat, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { validateDecisionIndex } from "../src/contracts/decision.js";
import { assertDecisionIndexIntegrity } from "../src/decision/index-loader.js";

const root = resolve(process.cwd());
const brokerPluginIds = ["shared-core", "skillset-manager"] as const;
const allowedSkills = [
  "plugins/shared-core/skills/evidence-provenance/SKILL.md",
  "plugins/shared-core/skills/handoff-continuity/SKILL.md",
  "plugins/shared-core/skills/intent-to-brief/SKILL.md",
  "plugins/shared-core/skills/plan-and-checkpoints/SKILL.md",
  "plugins/shared-core/skills/quality-verification/SKILL.md",
  "plugins/shared-core/skills/risk-privacy-permissions/SKILL.md",
  "plugins/shared-core/skills/workflow-router/SKILL.md",
  "plugins/shared-core/skills/workspace-context/SKILL.md",
  "plugins/skillset-manager/skills/doctor/SKILL.md",
  "plugins/skillset-manager/skills/maintain/SKILL.md",
  "plugins/skillset-manager/skills/setup/SKILL.md"
] as const;
const allowedExecutableSurface = [
  ...allowedSkills,
  "plugins/skillset-manager/runtime.mjs"
].sort(compare);
const retiredKeys = new Set([
  "ownedSkillIds",
  "ownedGapDecisionId",
  "ownedGapDecisionIds",
  "installStrategy"
]);
const retiredValues = new Set(["pending-p11", "owned-gap"]);
const retiredRoots = [
  "manifests/domains",
  "manifests/packs",
  "manifests/migrations",
  "manifests/owned-gaps"
] as const;
const repositoryHost = "github.com";
const repositoryPath = "/seunghyeon1004/claude-code-skillsets";

async function main(): Promise<void> {
  const errors: string[] = [];
  for (const path of retiredRoots) await assertAbsentOrEmpty(path, errors);
  await assertAbsent("schemas/v2/owned-gap-decision.schema.json", errors);
  await assertBrokerManifestRoots(errors);
  await assertSkillAllowlist(errors);
  await assertExecutableSurfaceAllowlist(errors);
  await assertNoVendoredExternalSourceBlobs(errors);
  await assertStructuredProductionData(errors);
  await assertGeneratedProjection(errors);
  if (errors.length > 0) {
    throw new Error(`Broker-only verification failed:\n${errors.sort(compare).map((error) => `- ${error}`).join("\n")}`);
  }
}

async function assertNoVendoredExternalSourceBlobs(errors: string[]): Promise<void> {
  const start = "research/evidence/artifacts";
  const visit = async (relativePath: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(join(root, relativePath), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      errors.push(`${relativePath}: ${message(error)}`);
      return;
    }
    for (const entry of entries) {
      const child = `${relativePath}/${entry.name}`;
      if (entry.isDirectory() && entry.name === "source-blobs") {
        errors.push(`${child}: vendored external source blobs are not allowed`);
      } else if (entry.isDirectory()) {
        await visit(child);
      }
    }
  };
  await visit(start);
}

async function assertBrokerManifestRoots(errors: string[]): Promise<void> {
  const manifestPaths = await yamlPaths("manifests/plugins", errors);
  const manifests = await Promise.all(manifestPaths.map((path) => readYaml(path, errors)));
  const ids = manifests.map((manifest) => stringAt(manifest, "id")).sort(compare);
  if (!same(ids, [...brokerPluginIds])) {
    errors.push(`manifests/plugins must contain exactly ${brokerPluginIds.join(", ")}`);
  }
  for (const manifest of manifests) {
    const id = stringAt(manifest, "id") ?? "unknown";
    const source = stringAt(manifest, "source");
    if (!brokerPluginIds.includes(id as typeof brokerPluginIds[number])) {
      errors.push(`local manifest ${id} is not an allowed broker plugin`);
    }
    if (source !== `./plugins/${id}`) errors.push(`broker manifest ${id} has invalid local source ${String(source)}`);
    assertNoRetiredValues(manifest, `manifests/plugins/${id}`, errors);
  }
}

async function assertSkillAllowlist(errors: string[]): Promise<void> {
  const found = await findSkills("plugins", errors);
  if (!same(found, [...allowedSkills])) {
    errors.push(`local SKILL.md allowlist mismatch: expected ${allowedSkills.join(", ")}; found ${found.join(", ")}`);
  }
}

/** Skills, hooks, commands, and runnable files are execution surface, not catalog metadata. */
async function assertExecutableSurfaceAllowlist(errors: string[]): Promise<void> {
  const found = await findExecutableSurface("plugins", errors);
  if (!same(found, allowedExecutableSurface)) {
    errors.push(`plugin executable surface allowlist mismatch: expected ${allowedExecutableSurface.join(", ")}; found ${found.join(", ")}`);
  }
}

async function assertStructuredProductionData(errors: string[]): Promise<void> {
  const yamlDirectories = [
    "manifests/complete-v1-packs",
    "manifests/complete-v1-providers",
    "manifests/provider-selections",
    "manifests/source-reviews",
    "manifests/conflicts"
  ];
  for (const directory of yamlDirectories) {
    for (const path of await yamlPaths(directory, errors)) {
      const value = await readYaml(path, errors);
      assertNoRetiredValues(value, path, errors);
      if (path.startsWith("manifests/complete-v1-packs/")) assertNoPackFulfillment(value, path, errors);
      if (path.startsWith("manifests/complete-v1-providers/")) assertExternalProviderSources(value, path, errors);
    }
  }
  for (const path of [
    "schemas/v2/provider.schema.json",
    "schemas/v2/provider-selection.schema.json",
    "schemas/v2/source-review.schema.json",
    "schemas/v2/research-evidence.schema.json",
    "schemas/v2/research-queue.schema.json"
  ]) {
    const value = await readJson(path, errors);
    assertNoRetiredValues(value, path, errors);
  }
}

async function assertGeneratedProjection(errors: string[]): Promise<void> {
  const index = await readJson("generated/install-index.json", errors);
  const managerIndex = await readJson("plugins/skillset-manager/data/install-index.json", errors);
  const marketplace = await readJson(".claude-plugin/marketplace.json", errors);
  const decisionIndex = await readJson("generated/decision-index.json", errors);
  const managerDecisionIndex = await readJson("plugins/skillset-manager/data/decision-index.json", errors);
  const [decisionBytes, managerDecisionBytes] = await Promise.all([
    readText("generated/decision-index.json", errors),
    readText("plugins/skillset-manager/data/decision-index.json", errors)
  ]);
  if (JSON.stringify(index) !== JSON.stringify(managerIndex)) errors.push("generated and manager install indexes differ");
  const profiles = arrayAt(index, "profiles");
  const availability = arrayAt(index, "availability");
  const pending = arrayAt(index, "researchPendingPacks");
  const plugins = arrayAt(index, "plugins");
  if (profiles.length !== 0) errors.push("generated install index has activatable purpose profiles");
  if (availability.length !== 0) errors.push("generated install index has availability records before P04B");
  if (pending.length !== 40 || pending.some((pack) => stringAt(pack, "state") !== "research-pending")) {
    errors.push("generated install index must contain exactly 40 research-pending pack metadata records");
  }
  const pluginIds = plugins.map((plugin) => stringAt(plugin, "id")).sort(compare);
  if (!same(pluginIds, [...brokerPluginIds])) errors.push("generated install index has a non-broker plugin");
  for (const plugin of plugins) {
    const id = stringAt(plugin, "id") ?? "unknown";
    if (stringAt(plugin, "kind") !== "local" || stringAt(plugin, "source") !== `./plugins/${id}`) {
      errors.push(`generated plugin ${id} is not a local broker artifact`);
    }
  }
  const marketplacePlugins = arrayAt(marketplace, "plugins").map((plugin) => stringAt(plugin, "name")).sort(compare);
  if (!same(marketplacePlugins, [...brokerPluginIds])) errors.push("marketplace must contain exactly the two broker plugins");
  assertNoRetiredValues(index, "generated/install-index.json", errors);
  assertNoRetiredValues(marketplace, ".claude-plugin/marketplace.json", errors);
  if (decisionBytes !== undefined && managerDecisionBytes !== undefined && decisionBytes !== managerDecisionBytes) {
    errors.push("generated and manager decision indexes differ byte-for-byte");
  }
  assertDecisionIndex(decisionIndex, "generated/decision-index.json", errors);
  assertDecisionIndex(managerDecisionIndex, "plugins/skillset-manager/data/decision-index.json", errors);
}

function assertDecisionIndex(value: unknown, path: string, errors: string[]): void {
  try {
    const index = validateDecisionIndex(value);
    assertDecisionIndexIntegrity(index);
  } catch (error) {
    errors.push(`${path}: invalid decision index: ${message(error)}`);
  }
}

function assertNoPackFulfillment(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) return;
  for (const key of ["requiredPlugins", "recommendedPlugins", "optionalPlugins", "workflow", "requiredExecutables", "optionalExecutables"]) {
    if (key in value) errors.push(`${path} has retired local pack fulfillment field ${key}`);
  }
}

function assertExternalProviderSources(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) return;
  const contracts = arrayAt(value, "runtimeContracts");
  for (const contract of contracts) {
    if (!isRecord(contract)) continue;
    for (const field of ["repositoryUrl", "marketplaceSource"]) {
      const source = stringAt(contract, field);
      if (source !== undefined && isRepositorySource(source)) {
        errors.push(`${path}:${field} must not point to this repository`);
      }
      if (source !== undefined && (source.startsWith(".") || source.includes("/plugins/"))) {
        errors.push(`${path}:${field} must be an external provider source`);
      }
    }
  }
}

function isRepositorySource(source: string): boolean {
  try {
    const url = new URL(source);
    const normalizedPath = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === repositoryHost
      && normalizedPath === repositoryPath
      && url.username === ""
      && url.password === ""
      && url.port === ""
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function assertNoRetiredValues(value: unknown, path: string, errors: string[]): void {
  walk(value, path, (item, itemPath, key) => {
    if (key !== undefined && retiredKeys.has(key)) errors.push(`${itemPath}: retired field ${key}`);
    if (typeof item === "string" && retiredValues.has(item)) errors.push(`${itemPath}: retired value ${item}`);
  });
}

async function assertAbsentOrEmpty(path: string, errors: string[]): Promise<void> {
  const directory = join(root, path);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    errors.push(`${path}: ${message(error)}`);
    return;
  }

  if (entries.length === 0) return;
  const sentinel = entries[0];
  if (
    entries.length !== 1
    || sentinel?.name !== ".gitkeep"
    || !sentinel.isFile()
    || sentinel.isSymbolicLink()
  ) {
    errors.push(`${path} must be absent or empty`);
  }
}

async function assertAbsent(path: string, errors: string[]): Promise<void> {
  try {
    await lstat(join(root, path));
    errors.push(`${path} must be absent`);
  } catch (error) {
    if (!isMissing(error)) errors.push(`${path}: ${message(error)}`);
  }
}

async function yamlPaths(directory: string, errors: string[]): Promise<string[]> {
  try {
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => `${directory}/${entry.name}`).sort(compare);
  } catch (error) {
    errors.push(`${directory}: ${message(error)}`);
    return [];
  }
}

async function findSkills(directory: string, errors: string[]): Promise<string[]> {
  const found: string[] = [];
  const visit = async (relativePath: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(root, relativePath), { withFileTypes: true });
    } catch (error) {
      errors.push(`${relativePath}: ${message(error)}`);
      return;
    }
    for (const entry of entries.sort((left, right) => compare(left.name, right.name))) {
      const child = `${relativePath}/${entry.name}`;
      const stat = await lstat(join(root, child));
      if (stat.isSymbolicLink()) {
        errors.push(`${child}: symlinked local skill content is not allowed`);
      } else if (stat.isDirectory()) {
        await visit(child);
      } else if (stat.isFile() && entry.name === "SKILL.md") {
        found.push(child);
      }
    }
  };
  await visit(directory);
  return found.sort(compare);
}

async function findExecutableSurface(directory: string, errors: string[]): Promise<string[]> {
  const found: string[] = [];
  const visit = async (relativePath: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(join(root, relativePath), { withFileTypes: true });
    } catch (error) {
      errors.push(`${relativePath}: ${message(error)}`);
      return;
    }
    for (const entry of entries.sort((left, right) => compare(left.name, right.name))) {
      const child = `${relativePath}/${entry.name}`;
      const stat = await lstat(join(root, child));
      if (stat.isSymbolicLink()) {
        errors.push(`${child}: symlinked plugin executable surface is not allowed`);
      } else if (stat.isDirectory()) {
        await visit(child);
      } else if (stat.isFile() && isExecutableSurfacePath(child)) {
        found.push(child);
      }
    }
  };
  await visit(directory);
  return found.sort(compare);
}

function isExecutableSurfacePath(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base === "SKILL.md" || base === ".mcp.json") return true;
  if (/(?:^|\/)(?:agents|commands|hooks|scripts|bin)(?:\/|$)/u.test(path)) return true;
  return /\.(?:[cm]?js|ts|py|rb|sh|bash|zsh)$/u.test(base);
}

async function readJson(path: string, errors: string[]): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(root, path), "utf8")) as unknown;
  } catch (error) {
    errors.push(`${path}: ${message(error)}`);
    return {};
  }
}

async function readText(path: string, errors: string[]): Promise<string | undefined> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch (error) {
    errors.push(`${path}: ${message(error)}`);
    return undefined;
  }
}

async function readYaml(path: string, errors: string[]): Promise<unknown> {
  try {
    return YAML.parse(await readFile(join(root, path), "utf8")) as unknown;
  } catch (error) {
    errors.push(`${path}: ${message(error)}`);
    return {};
  }
}

function walk(value: unknown, path: string, visit: (value: unknown, path: string, key?: string) => void, key?: string): void {
  visit(value, path, key);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit));
  } else if (isRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) walk(child, `${path}.${childKey}`, visit, childKey);
  }
}

function arrayAt(value: unknown, key: string): unknown[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function stringAt(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(left: readonly (string | undefined)[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compare(left: string | undefined, right: string | undefined): number {
  return (left ?? "") < (right ?? "") ? -1 : (left ?? "") > (right ?? "") ? 1 : 0;
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main();
