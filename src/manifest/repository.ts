import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";
import {
  validateCompleteV1Graph,
  type BundleIndexes
} from "../catalog/validate-graph.js";
import { INITIAL_CENSUS_SNAPSHOT_IDS, type Platform } from "../model/complete-v1.js";
import type { LocalPluginManifest } from "../model/manifest.js";
import { validateResearchGraph } from "../research/graph.js";
import { loadResearchRepository, type ResearchRepository } from "../research/repository.js";
import { loadYaml, validatePlugin } from "./load.js";
import { loadCompleteV1Repository, type CompleteV1Repository } from "./complete-v1-repository.js";

export interface BrokerManifestRepository {
  plugins: LocalPluginManifest[];
}

export interface AtomicManifestRepository {
  broker: BrokerManifestRepository;
  completeV1: CompleteV1Repository;
  completeV1BundleIndexes: BundleIndexes;
  research: ResearchRepository;
}

const COMPLETE_V1_WAVES = [
  [
    "question-to-cited-research-brief",
    "competitor-landscape-to-opportunity-map",
    "customer-interviews-to-insights",
    "evidence-to-strategic-decision",
    "idea-to-edited-article",
    "source-to-multilingual-publication",
    "product-to-positioning-and-offer",
    "keyword-to-ranked-content",
    "launch-plan-to-multichannel-campaign",
    "long-form-to-social-distribution"
  ],
  [
    "account-research-to-personalized-outreach",
    "discovery-call-to-proposal",
    "customer-problem-to-validated-prd",
    "prd-to-prioritized-roadmap",
    "project-brief-to-execution-board",
    "repository-to-implementation-plan",
    "spec-to-tested-feature",
    "bug-report-to-verified-fix",
    "service-to-ci-cd-deployment",
    "incident-alert-to-postmortem",
    "application-to-security-review"
  ],
  [
    "use-case-to-agent-design",
    "prototype-to-evaluated-agent",
    "raw-data-to-validated-dataset",
    "business-question-to-dashboard",
    "brief-to-accessible-interface",
    "brand-strategy-to-visual-system",
    "topic-to-recording-ready-script",
    "raw-footage-to-published-video",
    "long-video-to-multiplatform-clips",
    "meeting-to-decisions-and-actions",
    "source-files-to-polished-document"
  ],
  [
    "manual-process-to-maintained-sop",
    "repetitive-work-to-approved-automation",
    "transactions-to-management-report",
    "product-idea-to-store-listing",
    "role-need-to-interview-scorecard",
    "expertise-to-training-program",
    "contract-to-risk-and-revision-brief",
    "regulation-to-compliance-checklist"
  ]
] as const;

const COMPLETE_V1_EXPECTED_WAVE_COUNTS = [10, 11, 11, 8] as const;
const BROKER_PLUGIN_IDS = ["shared-core", "skillset-manager"] as const;
const RETIRED_FOUNDATION_ROOTS = [
  "manifests/domains",
  "manifests/packs",
  "manifests/external-sources",
  "manifests/migrations"
] as const;

export async function loadManifestRepository(root: string): Promise<AtomicManifestRepository> {
  await assertRetiredFoundationRootsAbsent(root);
  const [broker, completeV1, researchInput] = await Promise.all([
    loadBrokerManifestRepository(root),
    loadCompleteV1Repository(root),
    loadResearchRepository(root)
  ]);
  const research = validateResearchGraph(researchInput, {
    completeV1,
    platforms: new Set<Platform>(["darwin", "linux", "win32"]),
    expectedCensusSnapshotIds: INITIAL_CENSUS_SNAPSHOT_IDS,
    enforceP04Coverage: true
  });
  const completeV1BundleIndexes = validateCompleteV1Graph(completeV1, {
    scenarioPaths: await loadCompleteV1ScenarioInventory(root, completeV1),
    waves: COMPLETE_V1_WAVES,
    expectedWaveCounts: COMPLETE_V1_EXPECTED_WAVE_COUNTS,
    activePackIds: []
  });

  return { broker, completeV1, completeV1BundleIndexes, research };
}

export async function loadBrokerManifestRepository(root: string): Promise<BrokerManifestRepository> {
  const directory = join(root, "manifests", "plugins");
  const paths = await yamlPaths(root, directory, "broker plugin");
  const plugins = await Promise.all(paths.map(async (path) => validatePlugin(await loadYaml(path))));
  const ids = plugins.map(({ id }) => id).sort(compareCodePointStrings);
  if (ids.length !== BROKER_PLUGIN_IDS.length || ids.some((id, index) => id !== BROKER_PLUGIN_IDS[index])) {
    throw new Error(`manifests/plugins: must contain exactly broker plugins ${BROKER_PLUGIN_IDS.join(", ")}`);
  }
  return { plugins: plugins.sort((left, right) => compareCodePointStrings(left.id, right.id)) };
}

async function assertRetiredFoundationRootsAbsent(root: string): Promise<void> {
  for (const relativePath of RETIRED_FOUNDATION_ROOTS) {
    const directory = join(root, relativePath);
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingDirectory(error)) continue;
      throw error;
    }

    if (entries.length === 0) continue;
    const sentinel = entries[0];
    if (
      entries.length !== 1
      || sentinel?.name !== ".gitkeep"
      || !sentinel.isFile()
      || sentinel.isSymbolicLink()
    ) {
      throw new Error(`${relativePath}: retired foundation root must be absent or empty`);
    }
  }
}

async function loadCompleteV1ScenarioInventory(
  root: string,
  repository: CompleteV1Repository
): Promise<ReadonlySet<string>> {
  const packsRoot = join(root, "tests", "evaluations", "packs");
  const packById = new Map(repository.packs.map((pack) => [pack.id, pack]));
  const referenceByPath = new Map(repository.packs.flatMap((pack) =>
    pack.scenarios.map((scenario) => [scenario.path, { pack, scenario }] as const)
  ));
  let directories;
  try {
    directories = await readdir(packsRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error("tests/evaluations/packs: Unable to read complete-v1 scenario inventory", { cause: error });
  }
  for (const entry of directories.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml")).sort(compareDirectoryEntries)) {
    throw new Error(`tests/evaluations/packs/${entry.name}: Orphan complete-v1 scenario file`);
  }
  const directoriesByName = new Map(directories.map((entry) => [entry.name, entry]));
  for (const pack of repository.packs) {
    if (!directoriesByName.get(pack.id)?.isDirectory()) {
      throw new Error(`tests/evaluations/packs/${pack.id}: Unable to read complete-v1 scenario inventory`);
    }
  }

  const paths = new Set<string>();
  for (const directoryEntry of directories.filter((entry) => entry.isDirectory()).sort(compareDirectoryEntries)) {
    const directory = join(packsRoot, directoryEntry.name);
    const pack = packById.get(directoryEntry.name);
    const directoryPath = `tests/evaluations/packs/${directoryEntry.name}`;
    for (const path of await loadCompleteV1ScenarioPaths(directory, directoryPath)) {
      const reference = referenceByPath.get(path);
      if (pack === undefined || reference === undefined) {
        throw new Error(`${path}: Orphan complete-v1 scenario file`);
      }
      const scenario = await loadCompleteV1Scenario(root, path);
      if (scenario.id !== reference.scenario.id) {
        throw new Error(`${path}: scenario id does not match pack reference ${reference.scenario.id}`);
      }
      if (scenario.packId !== pack.id) {
        throw new Error(`${path}: scenario packId does not match pack ${pack.id}`);
      }
      if (scenario.caseType !== reference.scenario.type) {
        throw new Error(`${path}: scenario caseType does not match pack reference ${reference.scenario.type}`);
      }
      paths.add(path);
    }
  }
  if (paths.size !== referenceByPath.size) {
    const missing = [...referenceByPath.keys()].filter((path) => !paths.has(path)).sort(compareCodePointStrings);
    throw new Error(`${missing[0]}: Missing complete-v1 scenario file`);
  }
  return paths;
}

async function loadCompleteV1ScenarioPaths(directory: string, directoryPath: string): Promise<string[]> {
  try {
    const paths: string[] = [];
    const entries = (await readdir(directory, { withFileTypes: true })).sort(compareDirectoryEntries);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".yaml")) {
        paths.push(`${directoryPath}/${entry.name}`);
      } else if (entry.isDirectory()) {
        paths.push(...await loadCompleteV1ScenarioPaths(
          join(directory, entry.name),
          `${directoryPath}/${entry.name}`
        ));
      }
    }
    return paths.sort(compareCodePointStrings);
  } catch (error) {
    throw new Error(`${directoryPath}: Unable to read complete-v1 scenario inventory`, { cause: error });
  }
}

async function loadCompleteV1Scenario(root: string, path: string): Promise<{ id: string; packId: string; caseType: string }> {
  const { validateScenarioSpec } = await import("../contracts/complete-v1.js");
  try {
    return validateScenarioSpec(await loadYaml(join(root, path)));
  } catch (error) {
    throw new Error(`${path}: ${errorMessage(error)}`, { cause: error });
  }
}

async function yamlPaths(root: string, directory: string, kind: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => join(directory, entry.name))
      .sort(compareCodePointStrings);
  } catch (error) {
    if (isMissingDirectory(error)) {
      throw new Error(`${relative(root, directory)}: Missing ${kind} directory`, { cause: error });
    }
    throw new Error(`${relative(root, directory)}: Unable to read ${kind} directory: ${errorMessage(error)}`, { cause: error });
  }
}

function compareDirectoryEntries(left: { name: string }, right: { name: string }): number {
  return compareCodePointStrings(left.name, right.name);
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
  return leftCharacters.length === rightCharacters.length ? 0 : (leftCharacters.length < rightCharacters.length ? -1 : 1);
}

function isMissingDirectory(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
