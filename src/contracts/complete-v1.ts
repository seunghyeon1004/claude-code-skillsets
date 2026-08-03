import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { validRange } from "semver";
import {
  HARD_GATE_IDS,
  INITIAL_CENSUS_SNAPSHOT_IDS,
  SCORE_CRITERIA
} from "../model/complete-v1.js";
import type {
  CapabilityCollectionManifest,
  CatalogContract,
  CategoryCollectionManifest,
  CompletePackManifest,
  ConflictGroupManifest,
  LifecycleState,
  ProviderManifest,
  ProviderSelectionManifest,
  ReleaseManifest,
  ResearchCensus,
  ResearchCollectionReceipt,
  ResearchEvaluationContext,
  ResearchEvidence,
  ResearchQueue,
  SourceReviewBacklog,
  ReviewSourceExtensionIndex,
  ReviewSourceIndex,
  ResearchSnapshot,
  ResearchSourceConfig,
  ScenarioSpec,
  SourceReviewManifest,
  StructuredRecommendation
} from "../model/complete-v1.js";

/** These are versioned projection inputs, never optional discovery conveniences. */
export const DECISION_BROKER_V1_REQUIRED_RESEARCH_SURFACES = [
  "research/observation-evidence",
  "research/source-observations.json",
  "research/source-diffs.json",
  "research/materialized-review-state.json",
  "research/review-ledger.jsonl",
  "governance/reviewers.json"
] as const;

const require = createRequire(import.meta.url);
const catalogSchema = require("../../schemas/v2/catalog.schema.json") as object;
const categoryCollectionSchema = require("../../schemas/v2/category-collection.schema.json") as object;
const capabilityCollectionSchema = require("../../schemas/v2/capability-collection.schema.json") as object;
const packSchema = require("../../schemas/v2/pack.schema.json") as object;
const providerSchema = require("../../schemas/v2/provider.schema.json") as object;
const providerSelectionSchema = require("../../schemas/v2/provider-selection.schema.json") as object;
const sourceReviewSchema = require("../../schemas/v2/source-review.schema.json") as object;
const conflictGroupSchema = require("../../schemas/v2/conflict-group.schema.json") as object;
const researchSnapshotSchema = require("../../schemas/v2/research-snapshot.schema.json") as object;
const researchCensusSchema = require("../../schemas/v2/research-census.schema.json") as object;
const researchContextSchema = require("../../schemas/v2/research-context.schema.json") as object;
const researchEvidenceSchema = require("../../schemas/v2/research-evidence.schema.json") as object;
const researchQueueSchema = require("../../schemas/v2/research-queue.schema.json") as object;
const sourceReviewBacklogSchema = require("../../schemas/v2/source-review-backlog.schema.json") as object;
const reviewSourceIndexSchema = require("../../schemas/v2/review-source-index.schema.json") as object;
const reviewSourceExtensionIndexSchema = require("../../schemas/v2/review-source-extension-index.schema.json") as object;
const researchSourceConfigSchema = require("../../schemas/v2/research-source-config.schema.json") as object;
const researchCollectionReceiptSchema = require("../../schemas/v2/research-collection-receipt.schema.json") as object;
const recommendationSchema = require("../../schemas/v2/recommendation-result.schema.json") as object;
const lifecycleStateSchema = require("../../schemas/v2/lifecycle-state.schema.json") as object;
const releaseManifestSchema = require("../../schemas/v2/release-manifest.schema.json") as object;
const scenarioSchema = require("../../schemas/v2/scenario.schema.json") as object;

const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { date: true, "date-time": true } });
const validateCatalogSchema = ajv.compile<CatalogContract>(catalogSchema);
const validateCategoryCollectionSchema = ajv.compile<CategoryCollectionManifest>(categoryCollectionSchema);
const validateCapabilityCollectionSchema = ajv.compile<CapabilityCollectionManifest>(capabilityCollectionSchema);
const validateCompletePackSchema = ajv.compile<CompletePackManifest>(packSchema);
const validateProviderSchema = ajv.compile<ProviderManifest>(providerSchema);
const validateProviderSelectionSchema = ajv.compile<ProviderSelectionManifest>(providerSelectionSchema);
const validateSourceReviewSchema = ajv.compile<SourceReviewManifest>(sourceReviewSchema);
const validateConflictGroupSchema = ajv.compile<ConflictGroupManifest>(conflictGroupSchema);
const validateResearchSnapshotSchema = ajv.compile<ResearchSnapshot>(researchSnapshotSchema);
const validateResearchCensusSchema = ajv.compile<ResearchCensus>(researchCensusSchema);
const validateResearchContextSchema = ajv.compile<ResearchEvaluationContext>(researchContextSchema);
const validateResearchEvidenceSchema = ajv.compile<ResearchEvidence>(researchEvidenceSchema);
const validateResearchQueueSchema = ajv.compile<ResearchQueue>(researchQueueSchema);
const validateSourceReviewBacklogSchema = ajv.compile<SourceReviewBacklog>(sourceReviewBacklogSchema);
const validateReviewSourceIndexSchema = ajv.compile<ReviewSourceIndex>(reviewSourceIndexSchema);
const validateReviewSourceExtensionIndexSchema = ajv.compile<ReviewSourceExtensionIndex>(reviewSourceExtensionIndexSchema);
const validateResearchSourceConfigSchema = ajv.compile<ResearchSourceConfig>(researchSourceConfigSchema);
const validateResearchCollectionReceiptSchema = ajv.compile<ResearchCollectionReceipt>(researchCollectionReceiptSchema);
const validateStructuredRecommendationSchema = ajv.compile<StructuredRecommendation>(recommendationSchema);
const validateLifecycleStateSchema = ajv.compile<LifecycleState>(lifecycleStateSchema);
const validateReleaseManifestSchema = ajv.compile<ReleaseManifest>(releaseManifestSchema);
const validateScenarioSpecSchema = ajv.compile<ScenarioSpec>(scenarioSchema);

interface KeyedUniquenessRule {
  collection: string;
  key: string;
}

interface ContractError {
  path: string;
  message: string;
}

type SemanticErrorValidator = (value: unknown) => ContractError[];

const catalogKeyedUniqueness = [{ collection: "replacements", key: "replacementPackId" }];
const categoryCollectionKeyedUniqueness = [{ collection: "categories", key: "id" }];
const capabilityCollectionKeyedUniqueness = [{ collection: "capabilities", key: "id" }];
const completePackKeyedUniqueness = [{ collection: "scenarios", key: "id" }];
const sourceReviewKeyedUniqueness: KeyedUniquenessRule[] = [];
const lifecycleStateKeyedUniqueness = [
  { collection: "marketplaceIdentities", key: "id" },
  { collection: "operations", key: "id" },
  { collection: "receipts", key: "operationId" },
  { collection: "ownership", key: "pluginId" }
];
const releaseManifestKeyedUniqueness = [{ collection: "evidence", key: "id" }];

export function validateCatalogContract(value: unknown): CatalogContract {
  return validateContract("catalog", validateCatalogSchema, value, catalogKeyedUniqueness);
}

export function validateCategoryCollection(value: unknown): CategoryCollectionManifest {
  return validateContract(
    "category collection",
    validateCategoryCollectionSchema,
    value,
    categoryCollectionKeyedUniqueness
  );
}

export function validateCapabilityCollection(value: unknown): CapabilityCollectionManifest {
  return validateContract(
    "capability collection",
    validateCapabilityCollectionSchema,
    value,
    capabilityCollectionKeyedUniqueness
  );
}

export function validateCompletePack(value: unknown): CompletePackManifest {
  return validateContract(
    "pack",
    validateCompletePackSchema,
    value,
    completePackKeyedUniqueness,
    completePackCapabilityOverlapErrors
  );
}

export function validateProvider(value: unknown): ProviderManifest {
  return validateContract("provider", validateProviderSchema, value, [], providerSemanticErrors);
}

export function validateProviderSelection(value: unknown): ProviderSelectionManifest {
  return validateContract(
    "provider selection",
    validateProviderSelectionSchema,
    value,
    [],
    providerSelectionSemanticErrors
  );
}

export function validateSourceReview(value: unknown): SourceReviewManifest {
  return validateContract(
    "source review",
    validateSourceReviewSchema,
    value,
    sourceReviewKeyedUniqueness,
    sourceReviewSemanticErrors
  );
}

export function validateConflictGroup(value: unknown): ConflictGroupManifest {
  return validateContract("conflict group", validateConflictGroupSchema, value, [], conflictGroupSemanticErrors);
}

export function validateResearchSnapshot(value: unknown): ResearchSnapshot {
  return validateContract("research snapshot", validateResearchSnapshotSchema, value);
}

export const validateResearchCensus = (value: unknown): ResearchCensus =>
  validateContract("research census", validateResearchCensusSchema, value, [], researchCensusSnapshotErrors);

export const validateResearchContext = (value: unknown): ResearchEvaluationContext =>
  validateContract("research context", validateResearchContextSchema, value);

export const validateResearchEvidence = (value: unknown): ResearchEvidence =>
  validateContract("research evidence", validateResearchEvidenceSchema, value, [], researchEvidenceArtifactPathErrors);

export const validateResearchQueue = (value: unknown): ResearchQueue =>
  validateContract("research queue", validateResearchQueueSchema, value);

export const validateSourceReviewBacklog = (value: unknown): SourceReviewBacklog =>
  validateContract("source review backlog", validateSourceReviewBacklogSchema, value, [{ collection: "candidates", key: "id" }]);

export const validateReviewSourceIndex = (value: unknown): ReviewSourceIndex =>
  validateContract("review source index", validateReviewSourceIndexSchema, value);

export const validateReviewSourceExtensionIndex = (value: unknown): ReviewSourceExtensionIndex =>
  validateContract("review source extension index", validateReviewSourceExtensionIndexSchema, value);

export const validateResearchSourceConfig = (value: unknown): ResearchSourceConfig =>
  validateContract("research source config", validateResearchSourceConfigSchema, value);

export const validateResearchCollectionReceipt = (value: unknown): ResearchCollectionReceipt =>
  validateContract("research collection receipt", validateResearchCollectionReceiptSchema, value);

export function validateStructuredRecommendation(value: unknown): StructuredRecommendation {
  return validateContract("structured recommendation", validateStructuredRecommendationSchema, value);
}

export function validateLifecycleState(value: unknown): LifecycleState {
  return validateContract("lifecycle state", validateLifecycleStateSchema, value, lifecycleStateKeyedUniqueness);
}

export function validateReleaseManifest(value: unknown): ReleaseManifest {
  return validateContract("release manifest", validateReleaseManifestSchema, value, releaseManifestKeyedUniqueness);
}

export function validateScenarioSpec(value: unknown): ScenarioSpec {
  return validateContract("scenario", validateScenarioSpecSchema, value);
}

function validateContract<T>(
  kind: string,
  validator: ValidateFunction<T>,
  value: unknown,
  keyedUniqueness: readonly KeyedUniquenessRule[] = [],
  semanticErrorValidator?: SemanticErrorValidator
): T {
  if (!validator(value)) {
    const errors = (validator.errors ?? [])
      .slice()
      .sort(compareAjvErrors)
      .map(formatError);
    throw new Error(`Invalid complete-v1 ${kind}:\n${errors.join("\n")}`);
  }

  const errors = [
    ...keyedUniquenessErrors(value, keyedUniqueness),
    ...(semanticErrorValidator?.(value) ?? [])
  ]
    .slice()
    .sort(compareContractErrors)
    .map(({ path, message }) => `${path}: ${message}`);
  if (errors.length > 0) {
    throw new Error(`Invalid complete-v1 ${kind}:\n${errors.join("\n")}`);
  }
  return value;
}

function keyedUniquenessErrors(
  value: unknown,
  rules: readonly KeyedUniquenessRule[]
): ContractError[] {
  if (!isRecord(value)) {
    return [];
  }

  const errors: ContractError[] = [];
  for (const { collection, key } of rules) {
    const items = value[collection];
    if (!Array.isArray(items)) {
      continue;
    }

    const firstIndexes = new Map<string, number>();
    for (const [index, item] of items.entries()) {
      if (!isRecord(item) || typeof item[key] !== "string") {
        continue;
      }
      const valueKey = item[key];
      const firstIndex = firstIndexes.get(valueKey);
      const path = `/${collection}/${index}/${key}`;
      if (firstIndex === undefined) {
        firstIndexes.set(valueKey, index);
        continue;
      }
      errors.push({
        path,
        message: `duplicate key; first occurrence at /${collection}/${firstIndex}/${key}`
      });
    }
  }
  return errors;
}

function completePackCapabilityOverlapErrors(value: unknown): ContractError[] {
  if (!isRecord(value)) {
    return [];
  }

  const capabilityLists = [
    "requiredCapabilityIds",
    "recommendedCapabilityIds",
    "optionalCapabilityIds"
  ] as const;
  const firstLocations = new Map<string, { collection: string; index: number }>();
  const errors: ContractError[] = [];

  for (const collection of capabilityLists) {
    const capabilityIds = value[collection];
    if (!Array.isArray(capabilityIds)) {
      continue;
    }

    for (const [index, capabilityId] of capabilityIds.entries()) {
      if (typeof capabilityId !== "string") {
        continue;
      }

      const firstLocation = firstLocations.get(capabilityId);
      if (firstLocation === undefined) {
        firstLocations.set(capabilityId, { collection, index });
        continue;
      }

      errors.push({
        path: `/${collection}/${index}`,
        message: `capability ID "${capabilityId}" is also declared at /${firstLocation.collection}/${firstLocation.index}`
      });
    }
  }

  return errors;
}

function providerSemanticErrors(value: unknown): ContractError[] {
  if (!isRecord(value) || !Array.isArray(value.runtimeContracts)) return [];
  const errors: ContractError[] = [];
  const runtimeContracts = value.runtimeContracts;
  const runtimes = runtimeContracts.flatMap((contract) => isRecord(contract) && typeof contract.runtime === "string" ? [contract.runtime] : []);
  if (runtimes.length !== new Set(runtimes).size || !isCodePointSorted(runtimes)) {
    errors.push({ path: "/runtimeContracts", message: "must contain distinct runtime entries in SUPPORTED_RUNTIMES order" });
  }
  for (const [index, contract] of runtimeContracts.entries()) {
    if (!isRecord(contract)) continue;
    if (typeof contract.runtimeVersionRange !== "string" || validRange(contract.runtimeVersionRange) === null
      || /^\s*(?:\*|x|X)(?:\.\s*(?:\*|x|X)){0,2}\s*$/.test(contract.runtimeVersionRange)) {
      errors.push({ path: `/runtimeContracts/${index}/runtimeVersionRange`, message: "must be a non-wildcard semver range" });
    }
    const platforms = stringArray(contract.platforms);
    if (!isCodePointSorted(platforms) || new Set(platforms).size !== platforms.length) {
      errors.push({ path: `/runtimeContracts/${index}/platforms`, message: "must be code-point sorted and unique" });
    }
    for (const field of ["marketplaceSource", "repositoryUrl"] as const) {
      if (typeof contract[field] === "string" && !isCanonicalHttpsRepositoryUrl(contract[field])) {
        errors.push({ path: `/runtimeContracts/${index}/${field}`, message: "must be a credential-free canonical HTTPS repository URL" });
      }
    }
    for (const field of ["subdirectory"] as const) {
      if (typeof contract[field] === "string" && !isCanonicalPosixPath(contract[field])) {
        errors.push({ path: `/runtimeContracts/${index}/${field}`, message: "must be a normalized relative POSIX path" });
      }
    }
    const artifacts = Array.isArray(contract.artifacts) ? contract.artifacts : [];
    const artifactPaths = artifacts.flatMap((artifact) => isRecord(artifact) && typeof artifact.path === "string" ? [artifact.path] : []);
    if (!isCodePointSorted(artifactPaths) || artifactPaths.length !== new Set(artifactPaths).size) {
      errors.push({ path: `/runtimeContracts/${index}/artifacts`, message: "must be code-point sorted and unique" });
    }
    for (const [artifactIndex, artifact] of artifacts.entries()) {
      if (!isRecord(artifact) || typeof artifact.path !== "string") continue;
      if (!isCanonicalPosixPath(artifact.path)) {
        errors.push({ path: `/runtimeContracts/${index}/artifacts/${artifactIndex}/path`, message: "must be a normalized relative POSIX path" });
      }
      if (typeof contract.subdirectory === "string" && !artifact.path.startsWith(`${contract.subdirectory}/`)) {
        errors.push({ path: `/runtimeContracts/${index}/artifacts/${artifactIndex}/path`, message: "must remain inside the selected subdirectory" });
      }
    }
  }
  for (const field of ["capabilityIds"] as const) {
    const values = value[field];
    if (Array.isArray(values) && (!isCodePointSorted(values.filter((item): item is string => typeof item === "string")) || new Set(values).size !== values.length)) {
      errors.push({ path: `/${field}`, message: "must be code-point sorted and unique" });
    }
  }
  if (isRecord(value.permissions)) {
    for (const field of ["filesystem", "commands", "network", "externalData"] as const) {
      const permissions = stringArray(value.permissions[field]);
      if (!isCodePointSorted(permissions) || new Set(permissions).size !== permissions.length) {
        errors.push({ path: `/permissions/${field}`, message: "must be code-point sorted and unique" });
      }
    }
  }
  return errors;
}

function providerSelectionSemanticErrors(value: unknown): ContractError[] {
  if (!isRecord(value)) return [];
  const errors: ContractError[] = [];
  const preferred = typeof value.preferredProviderId === "string" ? value.preferredProviderId : undefined;
  const alternates = stringArray(value.alternateProviderIds);
  const terminalReviews = stringArray(value.terminalReviewIds);
  if (!isCodePointSorted(alternates) || new Set(alternates).size !== alternates.length) errors.push({ path: "/alternateProviderIds", message: "must be code-point sorted and unique" });
  if (!isCodePointSorted(terminalReviews) || new Set(terminalReviews).size !== terminalReviews.length) errors.push({ path: "/terminalReviewIds", message: "must be code-point sorted and unique" });
  if (preferred !== undefined && alternates.includes(preferred)) errors.push({ path: "/alternateProviderIds", message: "must not contain preferredProviderId" });
  const disposition = value.disposition;
  const trialed = value.releaseEvidence === "trialed-p04";
  if ((disposition === "selected" || disposition === "alternate") && (preferred === undefined || !trialed || terminalReviews.length !== 0)) {
    errors.push({ path: "/disposition", message: "selected and alternate require a preferred provider, no terminal review, and trialed-p04 evidence" });
  }
  if (disposition === "rejected" && (preferred !== undefined || alternates.length !== 0 || terminalReviews.length === 0 || value.releaseEvidence !== "not-applicable")) {
    errors.push({ path: "/disposition", message: "rejected requires terminal reviews and no provider route" });
  }
  if (disposition === "unavailable" && (preferred !== undefined || alternates.length !== 0 || terminalReviews.length !== 0 || value.releaseEvidence !== "not-applicable")) {
    errors.push({ path: "/disposition", message: "unavailable requires no provider route or terminal review" });
  }
  return errors;
}

function isCodePointSorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || compareCodePointStrings(values[index - 1]!, value) <= 0);
}

function sourceReviewSemanticErrors(value: unknown): ContractError[] {
  if (!isRecord(value)) return [];
  const errors: ContractError[] = [];
  const compatibility = Array.isArray(value.compatibility) ? value.compatibility : [];
  const compatibilityKeys = compatibility.flatMap((item) => isRecord(item) && typeof item.runtime === "string" ? [item.runtime] : []);
  if (!isCodePointSorted(compatibilityKeys) || compatibilityKeys.length !== new Set(compatibilityKeys).size) errors.push({ path: "/compatibility", message: "must be sorted with one record per runtime" });
  const reviews = Array.isArray(value.capabilityTargetReviews) ? value.capabilityTargetReviews : [];
  const keys = reviews.flatMap((review) => isRecord(review) && typeof review.capabilityId === "string" && typeof review.runtime === "string" && typeof review.platform === "string" ? [`${review.capabilityId}\u0000${review.runtime}\u0000${review.platform}`] : []);
  if (!isCodePointSorted(keys) || keys.length !== new Set(keys).size) errors.push({ path: "/capabilityTargetReviews", message: "must be sorted and unique by capability and target" });
  for (const [index, review] of reviews.entries()) {
    if (!isRecord(review)) continue;
    errors.push(...exactObjectIdSetErrors(review.hardGates, `capabilityTargetReviews/${index}/hardGates`, HARD_GATE_IDS));
    errors.push(...exactObjectIdSetErrors(review.scoreCriteria, `capabilityTargetReviews/${index}/scoreCriteria`, Object.keys(SCORE_CRITERIA)));
    const profiles = stringArray(review.assuranceProfiles);
    if (!isCodePointSorted(profiles) || new Set(profiles).size !== profiles.length) errors.push({ path: `/capabilityTargetReviews/${index}/assuranceProfiles`, message: "must be code-point sorted and unique" });
    for (const field of ["evidenceIds", "decisionReasons"] as const) {
      const ids = stringArray(review[field]);
      if (!isCodePointSorted(ids) || new Set(ids).size !== ids.length) errors.push({ path: `/capabilityTargetReviews/${index}/${field}`, message: "must be code-point sorted and unique" });
    }
  }
  for (const [index, item] of compatibility.entries()) {
    if (!isRecord(item)) continue;
    const platforms = stringArray(item.platforms);
    if (!isCodePointSorted(platforms) || new Set(platforms).size !== platforms.length) errors.push({ path: `/compatibility/${index}/platforms`, message: "must be code-point sorted and unique" });
  }
  for (const field of ["searchRecordIds", "snapshotIds", "selectedPaths", "linkedDomainIds", "linkedCategoryIds", "linkedPackIds", "capabilityIds", "evidenceIds"] as const) {
    const ids = stringArray(value[field]);
    if (!isCodePointSorted(ids) || new Set(ids).size !== ids.length) errors.push({ path: `/${field}`, message: "must be code-point sorted and unique" });
  }
  if (isRecord(value.surfaces)) {
    for (const field of ["skills", "commands", "agents", "hooks", "mcpServers", "scripts", "binaries"] as const) {
      const paths = stringArray(value.surfaces[field]);
      if (!isCodePointSorted(paths) || new Set(paths).size !== paths.length) errors.push({ path: `/surfaces/${field}`, message: "must be code-point sorted and unique" });
    }
  }
  if (isRecord(value.permissions)) {
    for (const field of ["filesystem", "commands", "network", "externalData"] as const) {
      const permissions = stringArray(value.permissions[field]);
      if (!isCodePointSorted(permissions) || new Set(permissions).size !== permissions.length) errors.push({ path: `/permissions/${field}`, message: "must be code-point sorted and unique" });
    }
  }
  const secretFlowKeys = Array.isArray(value.secretFlows)
    ? value.secretFlows.flatMap((item) => isRecord(item) && typeof item.name === "string" ? [item.name] : [])
    : [];
  if (!isCodePointSorted(secretFlowKeys) || new Set(secretFlowKeys).size !== secretFlowKeys.length) errors.push({ path: "/secretFlows", message: "must be code-point sorted and unique by name" });
  return errors;
}

function conflictGroupSemanticErrors(value: unknown): ContractError[] {
  if (!isRecord(value)) return [];
  const providerIds = stringArray(value.providerIds);
  return !isCodePointSorted(providerIds) || new Set(providerIds).size !== providerIds.length
    ? [{ path: "/providerIds", message: "must be code-point sorted and unique" }]
    : [];
}

function researchCensusSnapshotErrors(value: unknown): ContractError[] {
  if (!isRecord(value) || !Array.isArray(value.snapshotIds)) {
    return [];
  }

  const allowedPrefixLengths = [0, 5, 10, 15];
  const expectedPrefix = INITIAL_CENSUS_SNAPSHOT_IDS.slice(0, value.snapshotIds.length);
  if (allowedPrefixLengths.includes(value.snapshotIds.length)
    && value.snapshotIds.length === expectedPrefix.length
    && value.snapshotIds.every((snapshotId, index) => snapshotId === expectedPrefix[index])) {
    return [];
  }

  return [{
    path: "/snapshotIds",
    message: "must be an exact ordered prefix at length 0, 5, 10, or 15"
  }];
}

function researchEvidenceArtifactPathErrors(value: unknown): ContractError[] {
  if (!isRecord(value) || typeof value.artifactPath !== "string") {
    return [];
  }

  const prefix = "research/evidence/artifacts/";
  const relativePath = value.artifactPath.slice(prefix.length);
  const valid = value.artifactPath.startsWith(prefix)
    && relativePath.length > 0
    && relativePath.split("/").every((segment) => segment.length > 0
      && segment !== "."
      && segment !== ".."
      && !segment.includes("\\"));
  const errors = valid
    ? [] as ContractError[]
    : [{
      path: "/artifactPath",
      message: "must be a repository-relative POSIX path under research/evidence/artifacts/"
    }];
  const scope = isRecord(value.scope) ? value.scope : undefined;
  const isNullScope = scope?.runtime === null && scope.platform === null && scope.capabilityId === null;
  const isTargetScope = (scope?.runtime === "claude-code" || scope?.runtime === "codex")
    && (scope.platform === "darwin" || scope.platform === "linux" || scope.platform === "win32");
  if (["source-identity", "marketplace-identity", "license", "surface-inventory", "permissions", "secret-flow", "maintenance", "documentation"].includes(String(value.kind)) && !isNullScope) {
    errors.push({ path: "/scope", message: "static evidence must use the all-null scope" });
  }
  if (["compatibility", "install-smoke", "update-smoke", "remove-smoke", "doctor-smoke", "lifecycle"].includes(String(value.kind)) && (!isTargetScope || scope?.capabilityId !== null)) {
    errors.push({ path: "/scope", message: "target evidence must use one target and no capability" });
  }
  if (["outcome-evaluation", "semantic-smoke", "high-impact-review"].includes(String(value.kind)) && (!isTargetScope || typeof scope?.capabilityId !== "string")) {
    errors.push({ path: "/scope", message: "capability evidence must use one target and one capability" });
  }
  if (value.kind === "high-impact-review") {
    const reviewer = typeof value.reviewerId === "string" ? value.reviewerId : "";
    const collector = typeof value.collectorId === "string" ? value.collectorId : "";
    const authors = stringArray(value.upstreamAuthorIds);
    if (reviewer === collector || authors.includes(reviewer)) errors.push({ path: "/reviewerId", message: "must be independent from collector and upstream authors" });
    const lists = ["normalResultEvidenceIds", "boundaryResultEvidenceIds", "refusalResultEvidenceIds"].map((name) => stringArray(value[name]));
    const referenced = lists.flat();
    if (referenced.length !== new Set(referenced).size) errors.push({ path: "/", message: "high-impact result references must be pairwise disjoint" });
    if (lists.some((list) => !isCodePointSorted(list))) errors.push({ path: "/", message: "high-impact result references must be code-point sorted" });
  }
  return errors;
}

function isCanonicalHttpsRepositoryUrl(value: string): boolean {
  try {
    if (/%2e|%2f/i.test(value) || /(?:^|\/)\.\.?($|\/)/.test(value)) return false;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.search !== "" || url.hash !== "") return false;
    if (url.pathname !== "" && url.pathname.endsWith("/")) return false;
    return !url.pathname.split("/").some((segment) => segment === "." || segment === ".." || /%2e|%2f/i.test(segment));
  } catch {
    return false;
  }
}

function isCanonicalPosixPath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !/%2e|%2f/i.test(segment));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function exactObjectIdSetErrors(
  value: unknown,
  collection: string,
  expectedIds: readonly string[]
): ContractError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return exactStringSetErrors(
    value.flatMap((item) => isRecord(item) && typeof item.id === "string" ? [item.id] : []),
    collection,
    expectedIds
  );
}

function exactStringSetErrors(
  value: unknown,
  collection: string,
  expectedIds: readonly string[]
): ContractError[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actual = value.filter((item): item is string => typeof item === "string");
  const expected = [...expectedIds].sort(compareCodePointStrings);
  const sortedActual = [...actual].sort(compareCodePointStrings);
  if (actual.length === expected.length && sortedActual.every((id, index) => id === expected[index])) {
    return [];
  }

  return [{ path: `/${collection}`, message: `must contain exactly: ${expected.join(", ")}` }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorPath(error: ErrorObject): string {
  if (error.keyword === "required") {
    return `${error.instancePath}/${String(error.params.missingProperty)}`;
  }
  if (error.keyword === "additionalProperties") {
    return `${error.instancePath}/${String(error.params.additionalProperty)}`;
  }
  return error.instancePath || "/";
}

function formatError(error: ErrorObject): string {
  const path = errorPath(error);
  const message = error.keyword === "pattern" && path.endsWith("/version")
    ? `${error.message ?? "must match pattern"} (semver)`
    : (error.message ?? error.keyword);
  return `${path}: ${message}`;
}

function compareAjvErrors(left: ErrorObject, right: ErrorObject): number {
  return compareCodePointStrings(errorPath(left), errorPath(right))
    || compareCodePointStrings(left.keyword, right.keyword)
    || compareCodePointStrings(left.schemaPath, right.schemaPath)
    || compareCodePointStrings(left.message ?? "", right.message ?? "")
    || compareCodePointStrings(stableValue(left.params), stableValue(right.params));
}

function compareContractErrors(left: ContractError, right: ContractError): number {
  return compareCodePointStrings(left.path, right.path)
    || compareCodePointStrings(left.message, right.message);
}

/**
 * Error ordering is part of the CLI contract, so it must not depend on the host locale.
 */
function compareCodePointStrings(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftCharacters[index]!.codePointAt(0)!;
    const rightPoint = rightCharacters[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) {
      return leftPoint < rightPoint ? -1 : 1;
    }
  }
  return leftCharacters.length === rightCharacters.length
    ? 0
    : (leftCharacters.length < rightCharacters.length ? -1 : 1);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareCodePointStrings)
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}
