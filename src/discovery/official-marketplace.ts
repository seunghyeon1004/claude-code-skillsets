import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { COMPLETE_V1_DOMAIN_IDS, type DomainId } from "../model/complete-v1.js";

export const OFFICIAL_MARKETPLACE_ID = "claude-plugins-official" as const;
/** Historical public baseline identity; current selection is resolved from the selection ledger. */
export const OFFICIAL_MARKETPLACE_COMMIT =
  "e3e378cbbb205673a5d7254ded32679cafa6179d" as const;

const OFFICIAL_REPOSITORY = "https://github.com/anthropics/claude-plugins-official";
const OFFICIAL_MANIFEST_PATH = ".claude-plugin/marketplace.json";
export const OFFICIAL_MARKETPLACE_SOURCE = "anthropics/claude-plugins-official" as const;
const DEFAULT_PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MARKETPLACE_ROOT = "research/marketplaces";
const OFFICIAL_LISTING_CLAIMS = "manifests/official-listing-capability-claims.yaml";
const CURRENT_POINTER = "official-marketplace-current.json";
const INITIAL_ARTIFACT = "claude-plugins-official-e3e378c.json";
const INITIAL_ARTIFACT_SHA256 = "847feebbd5aa3d3d2ed7946689ecb61180e18b2cde9327e7cc9e36ec924727b8";

type ExternalSource =
  | { source: "url"; url: string; path?: string; sha: string }
  | { source: "github"; repo: string; commit: string; sha: string }
  | { source: "git-subdir"; url: string; path: string; ref?: string; sha: string };

export type OfficialPluginSource = string | ExternalSource;

export type OfficialSourcePin =
  | { kind: "external-sha"; sha: string }
  | { kind: "marketplace-commit"; sha: string };

export interface OfficialMarketplacePlugin {
  name: string;
  description: string;
  source: OfficialPluginSource;
  provenance: { jsonPointer: string };
  sourcePin: OfficialSourcePin;
}

export interface OfficialMarketplaceBaseline {
  schemaVersion: 1;
  marketplace: typeof OFFICIAL_MARKETPLACE_ID;
  provenance: {
    repository: string;
    inspectedCommit: string;
    manifestPath: string;
    manifestSha256: string;
    sourceUrl: string;
  };
  plugins: OfficialMarketplacePlugin[];
}

export interface OfficialMarketplaceSelection {
  state: "current" | "review-required";
  observedAt: string;
  approvedArtifactPath: string;
  approvedArtifactSha256: string;
  observedArtifactPath: string;
  observedArtifactSha256: string;
  approvedArtifact: OfficialMarketplaceBaseline;
  observedArtifact: OfficialMarketplaceBaseline;
  artifactByPath: Record<string, OfficialMarketplaceBaseline>;
  artifactObservedAtByPath: Record<string, string>;
  approvedArtifactPaths: string[];
  artifactSha256ByPath: Record<string, string>;
  marketplaceManifestSha256ByPath: Record<string, string>;
  selectedChanges: OfficialMarketplaceCandidateChange[];
  protectedCandidateNames: string[];
  chain: string[];
}

export interface OfficialMarketplaceCandidateChange {
  name: string;
  status: "added" | "changed" | "missing";
}

export type ClassificationRoute =
  | { kind: "name-description-rule"; ruleId: string }
  | { kind: "curated-override"; reason: string };

export interface OfficialMarketplaceRecommendation extends OfficialMarketplacePlugin {
  listingStatus: "marketplace-listed";
  individualSafetyReview: "not-complete";
  classificationRoutes: ClassificationRoute[];
}

export const OFFICIAL_CLAUDE_CODE_ONLY_BOUNDARY = {
  runtime: "claude-code",
  codexDisposition: "discovery-only-no-execution"
} as const;

export type OfficialClaudeCodeOnlyBoundary = typeof OFFICIAL_CLAUDE_CODE_ONLY_BOUNDARY;

interface ClassificationRule {
  domainId: DomainId;
  id: string;
  pattern: RegExp;
}

const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    domainId: "ai-agents-and-automation",
    id: "agent-development",
    pattern: /\b(agent sdk|agent development|build(?:ing)? ai agents?|agentic workflow)\b/i,
  },
  {
    domainId: "business-operations",
    id: "business-work-management",
    pattern: /\b(business operations?|work management|operational workflow)\b/i,
  },
  {
    domainId: "commerce",
    id: "commerce-platform",
    pattern: /\b(shopify|e-?commerce|payment processing|online store)\b/i,
  },
  {
    domainId: "data-and-analytics",
    id: "analytics-data-platform",
    pattern: /\b(data analytics|product analytics|data warehouse|bigquery|analytics platform)\b/i,
  },
  {
    domainId: "design-and-brand",
    id: "design-creative-platform",
    pattern: /\b(design platform|design workflow|creative platform|figma|canva)\b/i,
  },
  {
    domainId: "devops-and-security",
    id: "devops-security-operations",
    pattern: /\b(devsecops|ci\/cd|incident management|security testing|buildkite)\b/i,
  },
  {
    domainId: "documents-and-knowledge",
    id: "documents-knowledge-base",
    pattern: /\b(knowledge base|document management|workspace content|notion)\b/i,
  },
  {
    domainId: "finance-and-accounting",
    id: "finance-accounting-platform",
    pattern: /\b(finance|accounting|cap table|financial operations)\b/i,
  },
  {
    domainId: "legal-risk-and-compliance",
    id: "legal-compliance-risk",
    pattern: /\b(legal|compliance|risk management|trust center)\b/i,
  },
  {
    domainId: "marketing-and-growth",
    id: "marketing-growth-analytics",
    pattern: /\b(marketing|growth experimentation|conversion|campaign analytics)\b/i,
  },
  {
    domainId: "people-and-training",
    id: "learning-training",
    pattern: /\b(course|learning|training|education)\b/i,
  },
  {
    domainId: "product-management",
    id: "product-discovery-management",
    pattern: /\b(product management|product analytics|product discovery|feature planning)\b/i,
  },
  {
    domainId: "project-management",
    id: "project-task-management",
    pattern: /\b(project management|task management|issue tracking|work tracking)\b/i,
  },
  {
    domainId: "promotion-and-distribution",
    id: "publishing-distribution",
    pattern: /\b(social media scheduling|advertising platform|email delivery|publish content)\b/i,
  },
  {
    domainId: "research-and-intelligence",
    id: "web-research-search",
    pattern: /\b(web research|search api|research platform|web search)\b/i,
  },
  {
    domainId: "sales-and-customer",
    id: "sales-crm-customer",
    pattern: /\b(crm|sales intelligence|customer support|sales engagement)\b/i,
  },
  {
    domainId: "software-engineering",
    id: "software-delivery",
    pattern: /\b(code review|software development|feature development|developer workflow)\b/i,
  },
  {
    domainId: "strategy-and-decision",
    id: "strategy-decision-support",
    pattern: /\b(strategic planning|startup advisor|decision making|business strategy)\b/i,
  },
  {
    domainId: "video-and-audio",
    id: "video-audio-media",
    pattern: /\b(video generation|audio|music|media creation|runway)\b/i,
  },
  {
    domainId: "writing-and-publishing",
    id: "writing-content-publishing",
    pattern: /\b(content platform|technical documentation|content management|publishing)\b/i,
  },
];

const CURATED_OVERRIDES: Readonly<
  Record<DomainId, readonly { name: string; reason: string }[]>
> = {
  "ai-agents-and-automation": [
    { name: "agent-sdk-dev", reason: "Curated for agent SDK development workflows." },
    { name: "feature-dev", reason: "Curated for autonomous implementation workflows." },
  ],
  "business-operations": [
    { name: "airtable", reason: "Curated for structured operational workflows." },
    { name: "asana", reason: "Curated for cross-functional work operations." },
  ],
  commerce: [
    { name: "shopify-ai-toolkit", reason: "Curated for Shopify commerce workflows." },
    { name: "stripe", reason: "Curated for commerce payment workflows." },
  ],
  "data-and-analytics": [
    { name: "bigquery-data-analytics", reason: "Curated for warehouse analytics." },
    { name: "amplitude", reason: "Curated for product analytics." },
  ],
  "design-and-brand": [
    { name: "figma", reason: "Curated for product and brand design workflows." },
    { name: "canva", reason: "Curated for branded creative production." },
  ],
  "devops-and-security": [
    { name: "aws-agents-for-devsecops", reason: "Curated for DevSecOps workflows." },
    { name: "buildkite", reason: "Curated for CI/CD operations." },
  ],
  "documents-and-knowledge": [
    { name: "notion", reason: "Curated for workspace knowledge management." },
    { name: "box", reason: "Curated for document management." },
  ],
  "finance-and-accounting": [
    { name: "airwallex-agentos", reason: "Curated for finance operations." },
    { name: "carta-cap-table", reason: "Curated for cap table workflows." },
  ],
  "legal-risk-and-compliance": [
    { name: "legalzoom", reason: "Curated for legal workflows." },
    { name: "vanta", reason: "Curated for compliance workflows." },
  ],
  "marketing-and-growth": [
    { name: "posthog", reason: "Curated for growth and product analytics." },
    { name: "windsor-ai", reason: "Curated for marketing analytics." },
  ],
  "people-and-training": [
    { name: "learn-with-coursera", reason: "Curated for structured learning." },
    { name: "learning-output-style", reason: "Curated for guided learning sessions." },
  ],
  "product-management": [
    { name: "amplitude", reason: "Curated for evidence-led product decisions." },
    { name: "linear", reason: "Curated for product issue planning." },
  ],
  "project-management": [
    { name: "asana", reason: "Curated for project and task management." },
    { name: "atlassian", reason: "Curated for project tracking workflows." },
  ],
  "promotion-and-distribution": [
    { name: "postiz", reason: "Curated for social distribution workflows." },
    { name: "spotify-ads-api", reason: "Curated for advertising distribution." },
  ],
  "research-and-intelligence": [
    { name: "exa", reason: "Curated for web research and retrieval." },
    { name: "tavily", reason: "Curated for web research and search." },
  ],
  "sales-and-customer": [
    { name: "apollo", reason: "Curated for sales intelligence." },
    { name: "monday-crm", reason: "Curated for CRM workflows." },
  ],
  "software-engineering": [
    { name: "feature-dev", reason: "Curated for feature implementation." },
    { name: "superpowers", reason: "Curated for systematic debugging and test-driven development." },
  ],
  "strategy-and-decision": [
    { name: "aws-startup-advisor", reason: "Curated for startup strategy guidance." },
    { name: "miro", reason: "Curated for collaborative strategic planning." },
  ],
  "video-and-audio": [
    { name: "runway-api", reason: "Curated for video generation workflows." },
    { name: "canva", reason: "Curated for video and media production." },
  ],
  "writing-and-publishing": [
    { name: "sanity", reason: "Curated for structured content publishing." },
    { name: "mintlify", reason: "Curated for documentation publishing." },
  ],
};

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function validateExternalSource(value: Record<string, unknown>, label: string): ExternalSource {
  const source = requireString(value, "source", label);
  const sha = requireString(value, "sha", label);
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`${label}.sha must be a full lowercase 40-character commit SHA`);
  }

  if (source === "url") {
    const url = requireString(value, "url", label);
    if (value.path === undefined) {
      return { source, url, sha };
    }
    return { source, url, path: requireString(value, "path", label), sha };
  }
  if (source === "github") {
    return {
      source,
      repo: requireString(value, "repo", label),
      commit: requireString(value, "commit", label),
      sha,
    };
  }
  if (source === "git-subdir") {
    const url = requireString(value, "url", label);
    const path = requireString(value, "path", label);
    if (value.ref === undefined) {
      return { source, url, path, sha };
    }
    return { source, url, path, ref: requireString(value, "ref", label), sha };
  }
  throw new Error(`${label}.source has unsupported external source type ${source}`);
}

function validateRelativeSource(value: string, label: string): string {
  const segments = value.split("/");
  if (
    !value.startsWith("./") ||
    value.includes("\\") ||
    segments.includes("..") ||
    value === "./"
  ) {
    throw new Error(`${label} must be a commit-bound relative marketplace path`);
  }
  return value;
}

function requireExact(record: Record<string, unknown>, key: string, expected: string): void {
  if (record[key] !== expected) {
    throw new Error(`official marketplace provenance ${key} must equal ${expected}`);
  }
}

export function validateOfficialMarketplaceArtifact(
  value: unknown,
): OfficialMarketplaceBaseline {
  assertRecord(value, "official marketplace artifact");
  if (value.schemaVersion !== 1) {
    throw new Error("official marketplace artifact schemaVersion must be 1");
  }
  if (value.marketplace !== OFFICIAL_MARKETPLACE_ID) {
    throw new Error(`official marketplace artifact must identify ${OFFICIAL_MARKETPLACE_ID}`);
  }

  assertRecord(value.provenance, "official marketplace provenance");
  requireExact(value.provenance, "repository", OFFICIAL_REPOSITORY);
  requireExact(value.provenance, "manifestPath", OFFICIAL_MANIFEST_PATH);
  const inspectedCommit = requireString(value.provenance, "inspectedCommit", "official marketplace provenance");
  const manifestSha256 = requireString(value.provenance, "manifestSha256", "official marketplace provenance");
  if (!/^[0-9a-f]{40}$/u.test(inspectedCommit) || !/^[0-9a-f]{64}$/u.test(manifestSha256)) {
    throw new Error("official marketplace provenance requires full lowercase commit and manifest digests");
  }
  const sourceUrl = `https://raw.githubusercontent.com/anthropics/claude-plugins-official/${inspectedCommit}/${OFFICIAL_MANIFEST_PATH}`;
  requireExact(value.provenance, "sourceUrl", sourceUrl);

  if (!Array.isArray(value.plugins) || value.plugins.length === 0) {
    throw new Error("official marketplace artifact must contain plugins");
  }

  const names = new Set<string>();
  const plugins = value.plugins.map((candidate, index): OfficialMarketplacePlugin => {
    const label = `official marketplace plugin ${index}`;
    assertRecord(candidate, label);
    const name = requireString(candidate, "name", label);
    if (names.has(name)) {
      throw new Error(`official marketplace plugin name must be unique: ${name}`);
    }
    names.add(name);

    const description = requireString(candidate, "description", label);
    assertRecord(candidate.provenance, `${label}.provenance`);
    if (candidate.provenance.jsonPointer !== `/plugins/${index}`) {
      throw new Error(`${label}.provenance.jsonPointer does not match its manifest position`);
    }

    let source: OfficialPluginSource;
    let sourcePin: OfficialSourcePin;
    if (typeof candidate.source === "string") {
      source = validateRelativeSource(candidate.source, `${label}.source`);
      sourcePin = { kind: "marketplace-commit", sha: inspectedCommit };
    } else {
      assertRecord(candidate.source, `${label}.source`);
      source = validateExternalSource(candidate.source, `${label}.source`);
      sourcePin = { kind: "external-sha", sha: source.sha };
    }

    return {
      name,
      description,
      source,
      provenance: { jsonPointer: `/plugins/${index}` },
      sourcePin,
    };
  });

  return {
    schemaVersion: 1,
    marketplace: OFFICIAL_MARKETPLACE_ID,
    provenance: {
      repository: OFFICIAL_REPOSITORY,
      inspectedCommit,
      manifestPath: OFFICIAL_MANIFEST_PATH,
      manifestSha256,
      sourceUrl,
    },
    plugins,
  };
}

export function loadOfficialMarketplaceBaseline(root = DEFAULT_PROJECT_ROOT): OfficialMarketplaceBaseline {
  const selection = validateOfficialMarketplaceSelection(root);
  return structuredClone(selection.state === "current" ? selection.observedArtifact : selection.approvedArtifact);
}

interface SelectionPointer {
  schemaVersion: 1;
  selection: string;
  selectionSha256: string;
}

interface SelectionRecord {
  schemaVersion: 1;
  observedAt: string;
  state: "current" | "review-required";
  approvedArtifact: string;
  approvedArtifactSha256: string;
  observedArtifact: string;
  observedArtifactSha256: string;
  protectedCandidates: string[];
  previousSelection: string | null;
  previousSelectionSha256: string | null;
  transition?: "observation" | "approval";
  approval?: {
    approvedAt: string;
    approvedBy: string;
    reason: string;
  } | null;
}

export function loadOfficialMarketplaceSelection(root = DEFAULT_PROJECT_ROOT): OfficialMarketplaceSelection {
  return structuredClone(validateOfficialMarketplaceSelection(root));
}

/** Validates the content-addressed current pointer and its append-only predecessor chain. */
export function validateOfficialMarketplaceSelection(root = DEFAULT_PROJECT_ROOT): OfficialMarketplaceSelection {
  const projectRoot = resolve(root);
  const marketplaceRoot = join(projectRoot, MARKETPLACE_ROOT);
  const pointer = selectionPointer(readJson(join(marketplaceRoot, CURRENT_POINTER)));
  const chain: string[] = [];
  const records: SelectionRecord[] = [];
  let path: string | null = pointer.selection;
  let expectedSha256: string | null = pointer.selectionSha256;
  const seen = new Set<string>();
  while (path !== null && expectedSha256 !== null) {
    assertSelectionPath(path);
    if (seen.has(path)) throw new Error("official marketplace selection chain contains a cycle");
    seen.add(path);
    const bytes = readFileSync(join(marketplaceRoot, path));
    if (sha256(bytes) !== expectedSha256) {
      throw new Error("official marketplace selection SHA-256 mismatch");
    }
    const record = selectionRecord(JSON.parse(bytes.toString("utf8")) as unknown);
    chain.push(path);
    records.push(record);
    path = record.previousSelection;
    expectedSha256 = record.previousSelectionSha256;
  }
  if (path !== null || expectedSha256 !== null || records.length === 0) {
    throw new Error("official marketplace selection predecessor fields must both be null or both be set");
  }

  const genesis = records.at(-1)!;
  if (genesis.previousSelection !== null || genesis.previousSelectionSha256 !== null
    || genesis.approvedArtifact !== INITIAL_ARTIFACT
    || genesis.observedArtifact !== INITIAL_ARTIFACT
    || genesis.approvedArtifactSha256 !== INITIAL_ARTIFACT_SHA256
    || genesis.observedArtifactSha256 !== INITIAL_ARTIFACT_SHA256) {
    throw new Error("official marketplace selection chain does not retain the authenticated initial artifact");
  }
  for (let index = 0; index < records.length - 1; index += 1) {
    validateSelectionTransition(records[index]!, records[index + 1]!);
  }

  const referencedArtifactDigests = new Map<string, string>();
  const marketplaceManifestDigests = new Map<string, string>();
  const artifactsByPath = new Map<string, OfficialMarketplaceBaseline>();
  const artifactObservedAtByPath = new Map<string, string>();
  const approvedArtifactDigests = new Map<string, string>();
  for (const record of records) {
    for (const [path, digest] of [
      [record.approvedArtifact, record.approvedArtifactSha256],
      [record.observedArtifact, record.observedArtifactSha256]
    ] as const) {
      const existingDigest = referencedArtifactDigests.get(path);
      if (existingDigest !== undefined && existingDigest !== digest) {
        throw new Error("official marketplace artifact history has conflicting digests");
      }
      if (existingDigest === undefined) {
        const artifact = loadSelectedArtifact(marketplaceRoot, path, digest);
        referencedArtifactDigests.set(path, digest);
        marketplaceManifestDigests.set(path, artifact.provenance.manifestSha256);
        artifactsByPath.set(path, artifact);
      }
    }
    approvedArtifactDigests.set(record.approvedArtifact, record.approvedArtifactSha256);
  }
  for (const record of [...records].reverse()) {
    if (record.transition !== "approval") {
      artifactObservedAtByPath.set(record.observedArtifact, record.observedAt);
    }
  }

  const current = records[0]!;
  const approvedArtifact = loadSelectedArtifact(
    marketplaceRoot,
    current.approvedArtifact,
    current.approvedArtifactSha256
  );
  const observedArtifact = loadSelectedArtifact(
    marketplaceRoot,
    current.observedArtifact,
    current.observedArtifactSha256
  );
  const selectedChanges = selectedCandidateChanges(
    approvedArtifact,
    observedArtifact,
    current.protectedCandidates,
    records[1]?.protectedCandidates ?? current.protectedCandidates
  );
  if (current.state === "current" && selectedChanges.length > 0) {
    throw new Error("official marketplace selected candidate drift cannot be labeled current");
  }
  if (current.state === "review-required" && selectedChanges.length === 0) {
    throw new Error("official marketplace review-required selection must identify selected candidate drift");
  }
  return {
    state: current.state,
    observedAt: current.observedAt,
    approvedArtifactPath: current.approvedArtifact,
    approvedArtifactSha256: current.approvedArtifactSha256,
    observedArtifactPath: current.observedArtifact,
    observedArtifactSha256: current.observedArtifactSha256,
    approvedArtifact,
    observedArtifact,
    artifactByPath: Object.fromEntries(artifactsByPath),
    artifactObservedAtByPath: Object.fromEntries(artifactObservedAtByPath),
    approvedArtifactPaths: [...approvedArtifactDigests.keys()],
    artifactSha256ByPath: Object.fromEntries(referencedArtifactDigests),
    marketplaceManifestSha256ByPath: Object.fromEntries(marketplaceManifestDigests),
    selectedChanges,
    protectedCandidateNames: [...current.protectedCandidates],
    chain
  };
}

function selectionPointer(value: unknown): SelectionPointer {
  assertRecord(value, "official marketplace current pointer");
  if (value.schemaVersion !== 1 || typeof value.selection !== "string"
    || typeof value.selectionSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.selectionSha256)
    || Object.keys(value).length !== 3) {
    throw new Error("official marketplace current pointer is invalid");
  }
  assertSelectionPath(value.selection);
  return value as unknown as SelectionPointer;
}

function selectionRecord(value: unknown): SelectionRecord {
  assertRecord(value, "official marketplace selection");
  const legacyRequired = [
    "schemaVersion", "observedAt", "state", "approvedArtifact", "approvedArtifactSha256",
    "observedArtifact", "observedArtifactSha256", "protectedCandidates", "previousSelection",
    "previousSelectionSha256"
  ];
  const transitionRequired = [...legacyRequired, "transition", "approval"];
  const keys = Object.keys(value).sort().join("\0");
  const legacy = keys === [...legacyRequired].sort().join("\0");
  if ((!legacy && keys !== transitionRequired.sort().join("\0"))
    || value.schemaVersion !== 1
    || typeof value.observedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value.observedAt)
    || !Number.isFinite(Date.parse(value.observedAt))
    || (value.state !== "current" && value.state !== "review-required")
    || typeof value.approvedArtifact !== "string"
    || typeof value.observedArtifact !== "string"
    || typeof value.approvedArtifactSha256 !== "string"
    || typeof value.observedArtifactSha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(value.approvedArtifactSha256)
    || !/^[0-9a-f]{64}$/u.test(value.observedArtifactSha256)
    || (value.previousSelection !== null && typeof value.previousSelection !== "string")
    || (value.previousSelectionSha256 !== null
      && (typeof value.previousSelectionSha256 !== "string"
        || !/^[0-9a-f]{64}$/u.test(value.previousSelectionSha256)))
    || (!legacy && value.transition !== "observation" && value.transition !== "approval")) {
    throw new Error("official marketplace selection is invalid");
  }
  if (!Array.isArray(value.protectedCandidates)
    || value.protectedCandidates.length === 0
    || value.protectedCandidates.some((name) => typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name))
    || new Set(value.protectedCandidates).size !== value.protectedCandidates.length
    || [...value.protectedCandidates].sort(compareStrings).join("\0") !== value.protectedCandidates.join("\0")) {
    throw new Error("official marketplace protected candidates must be nonempty, unique, and sorted");
  }
  if (!legacy) validateApprovalMetadata(value.transition, value.approval);
  assertArtifactPath(value.approvedArtifact);
  assertArtifactPath(value.observedArtifact);
  if (typeof value.previousSelection === "string") assertSelectionPath(value.previousSelection);
  return value as unknown as SelectionRecord;
}

function validateApprovalMetadata(transition: unknown, approval: unknown): void {
  if (transition === "observation") {
    if (approval !== null) throw new Error("automatic official marketplace observation cannot contain approval metadata");
    return;
  }
  assertRecord(approval, "official marketplace approval");
  if (Object.keys(approval).sort().join("\0") !== ["approvedAt", "approvedBy", "reason"].sort().join("\0")
    || typeof approval.approvedAt !== "string" || !isUtcSeconds(approval.approvedAt)
    || typeof approval.approvedBy !== "string" || approval.approvedBy.trim().length === 0
    || typeof approval.reason !== "string" || approval.reason.trim().length === 0) {
    throw new Error("official marketplace approval metadata is invalid");
  }
}

function validateSelectionTransition(current: SelectionRecord, previous: SelectionRecord): void {
  if (Date.parse(current.observedAt) <= Date.parse(previous.observedAt)) {
    throw new Error("official marketplace selection observedAt must increase monotonically");
  }
  if (current.transition === undefined) {
    throw new Error("official marketplace successor selection requires an explicit transition");
  }
  if (current.transition === "observation") {
    if (current.approvedArtifact !== previous.approvedArtifact
      || current.approvedArtifactSha256 !== previous.approvedArtifactSha256) {
      throw new Error("automatic official marketplace observation cannot advance approved evidence");
    }
    if (previous.protectedCandidates.some((name) => !current.protectedCandidates.includes(name))) {
      throw new Error("official marketplace protected candidates are append-only");
    }
    return;
  }
  if (previous.state !== "review-required" || current.state !== "current"
    || current.approvedArtifact !== previous.observedArtifact
    || current.approvedArtifactSha256 !== previous.observedArtifactSha256
    || current.observedArtifact !== previous.observedArtifact
    || current.observedArtifactSha256 !== previous.observedArtifactSha256
    || current.protectedCandidates.join("\0") !== previous.protectedCandidates.join("\0")
    || current.approval?.approvedAt !== current.observedAt) {
    throw new Error("official marketplace approval must explicitly promote the reviewed predecessor observation");
  }
}

function loadSelectedArtifact(root: string, path: string, expectedSha256: string): OfficialMarketplaceBaseline {
  assertArtifactPath(path);
  const bytes = readFileSync(join(root, path));
  if (sha256(bytes) !== expectedSha256) {
    throw new Error(`official marketplace artifact SHA-256 mismatch: ${path}`);
  }
  return validateOfficialMarketplaceArtifact(JSON.parse(bytes.toString("utf8")) as unknown);
}

function selectedCandidateChanges(
  approved: OfficialMarketplaceBaseline,
  observed: OfficialMarketplaceBaseline,
  protectedNames: readonly string[],
  previouslyProtectedNames: readonly string[] = protectedNames
): OfficialMarketplaceCandidateChange[] {
  const approvedByName = new Map(approved.plugins.map((plugin) => [plugin.name, plugin]));
  const observedByName = new Map(observed.plugins.map((plugin) => [plugin.name, plugin]));
  const previouslyProtected = new Set(previouslyProtectedNames);
  const changes: OfficialMarketplaceCandidateChange[] = [];
  for (const name of protectedNames) {
    const before = approvedByName.get(name);
    const after = observedByName.get(name);
    if (!previouslyProtected.has(name) && after !== undefined) changes.push({ name, status: "added" });
    else if (before === undefined && after !== undefined) changes.push({ name, status: "added" });
    else if (after === undefined) changes.push({ name, status: "missing" });
    else if (before === undefined) throw new Error(`protected official marketplace candidate is unresolved: ${name}`);
    else if (stableIdentity(before) !== stableIdentity(after)) changes.push({ name, status: "changed" });
  }
  return changes;
}

export function officialMarketplaceSelectedChanges(
  approved: OfficialMarketplaceBaseline,
  observed: OfficialMarketplaceBaseline,
  protectedNames: readonly string[],
  previouslyProtectedNames: readonly string[] = protectedNames
): OfficialMarketplaceCandidateChange[] {
  return selectedCandidateChanges(approved, observed, protectedNames, previouslyProtectedNames);
}

function curatedCandidateNames(): string[] {
  return [...new Set(Object.values(CURATED_OVERRIDES).flatMap((entries) => entries.map(({ name }) => name)))]
    .sort(compareStrings);
}

export function isSelectedOfficialMarketplaceCandidate(name: string): boolean {
  return curatedCandidateNames().includes(name);
}

export function configuredOfficialMarketplaceCandidateNames(root = DEFAULT_PROJECT_ROOT): string[] {
  const claims = parse(readFileSync(join(root, OFFICIAL_LISTING_CLAIMS), "utf8")) as unknown;
  assertRecord(claims, "official listing claims");
  if (!Array.isArray(claims.candidates) || claims.candidates.length === 0) {
    throw new Error("official listing claims must contain protected candidates");
  }
  const claimNames = claims.candidates.map((candidate, index) => {
    assertRecord(candidate, `official listing claim candidate ${index}`);
    return requireString(candidate, "pluginName", `official listing claim candidate ${index}`);
  });
  if (new Set(claimNames).size !== claimNames.length) {
    throw new Error("official listing claim protected candidates must be unique");
  }
  return [...new Set([...curatedCandidateNames(), ...claimNames])].sort(compareStrings);
}

export function isProtectedOfficialMarketplaceCandidate(name: string, root = DEFAULT_PROJECT_ROOT): boolean {
  return loadOfficialMarketplaceSelection(root).protectedCandidateNames.includes(name);
}

export function classifyOfficialMarketplacePlugin(plugin: OfficialMarketplacePlugin): DomainId[] {
  const curated = COMPLETE_V1_DOMAIN_IDS.filter((domainId) =>
    CURATED_OVERRIDES[domainId].some(({ name }) => name === plugin.name)
  );
  const classified = CLASSIFICATION_RULES
    .filter((rule) => rule.pattern.test(`${plugin.name} ${plugin.description}`))
    .map(({ domainId }) => domainId);
  return [...new Set([...curated, ...classified])].sort(compareStrings);
}

export function officialMarketplaceCandidateIdentity(plugin: OfficialMarketplacePlugin): string {
  return stableIdentity(plugin);
}

export function officialMarketplaceSourceCoordinate(plugin: OfficialMarketplacePlugin): unknown {
  return pinInsensitiveSourceCoordinate(plugin.source);
}

function stableIdentity(plugin: OfficialMarketplacePlugin): string {
  return JSON.stringify({
    name: plugin.name,
    description: plugin.description,
    sourceCoordinate: stableSourceCoordinate(plugin.source),
    sourcePin: plugin.sourcePin
  });
}

function stableSourceCoordinate(source: OfficialPluginSource): unknown {
  if (typeof source === "string") return { source: "relative", path: source };
  if (source.source === "github") {
    return { source: source.source, repo: source.repo, commit: source.commit };
  }
  if (source.source === "url") {
    return { source: source.source, url: source.url, path: source.path ?? null };
  }
  return { source: source.source, url: source.url, path: source.path, ref: source.ref ?? null };
}

/** Source location excluding pin fields; typed pin-only approvals compare this coordinate. */
function pinInsensitiveSourceCoordinate(source: OfficialPluginSource): unknown {
  if (typeof source === "string") return { source: "relative", path: source };
  if (source.source === "github") return { source: source.source, repo: source.repo };
  if (source.source === "url") {
    return { source: source.source, url: source.url, path: source.path ?? null };
  }
  return { source: source.source, url: source.url, path: source.path, ref: source.ref ?? null };
}

function assertSelectionPath(path: string): void {
  if (!/^official-marketplace-selections\/[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,40}\.json$/u.test(path)) {
    throw new Error("official marketplace selection path is not canonical");
  }
}

function assertArtifactPath(path: string): void {
  if (!/^claude-plugins-official-[0-9a-f]{7,40}\.json$/u.test(path)) {
    throw new Error("official marketplace artifact path is not canonical");
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isUtcSeconds(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) && Number.isFinite(Date.parse(value));
}

function ruleRoutesFor(plugin: OfficialMarketplacePlugin, domainId: DomainId): ClassificationRoute[] {
  const searchable = `${plugin.name} ${plugin.description}`;
  return CLASSIFICATION_RULES.filter(
    (rule) => rule.domainId === domainId && rule.pattern.test(searchable),
  ).map((rule) => ({ kind: "name-description-rule", ruleId: rule.id }));
}

export function officialMarketplaceRecommendations(
  baseline = loadOfficialMarketplaceBaseline()
): Record<
  DomainId,
  OfficialMarketplaceRecommendation[]
> {
  const byName = new Map(baseline.plugins.map((plugin) => [plugin.name, plugin]));

  return Object.fromEntries(
    COMPLETE_V1_DOMAIN_IDS.map((domainId) => {
      const candidates = CURATED_OVERRIDES[domainId].map(({ name, reason }) => {
        const plugin = byName.get(name);
        if (plugin === undefined) {
          throw new Error(`curated official marketplace override is absent from baseline: ${name}`);
        }
        return {
          ...plugin,
          listingStatus: "marketplace-listed" as const,
          individualSafetyReview: "not-complete" as const,
          classificationRoutes: [
            ...ruleRoutesFor(plugin, domainId),
            { kind: "curated-override" as const, reason },
          ],
        };
      });
      if (candidates.length < 1 || candidates.length > 3) {
        throw new Error(`official marketplace domain ${domainId} must have 1-3 recommendations`);
      }
      return [domainId, candidates];
    }),
  ) as Record<DomainId, OfficialMarketplaceRecommendation[]>;
}
