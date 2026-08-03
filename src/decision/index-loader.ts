import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDecisionIndex } from "../contracts/decision.js";
import type { DecisionCandidateProjection, DecisionIndex, DecisionIntentFixture, IntentProfile } from "../model/decision.js";
import { COMPLETE_V1_DOMAIN_IDS, type Platform } from "../model/complete-v1.js";
import { normalizedPhraseLength } from "./normalize.js";
import { assertSemanticListingExcerpt } from "./listing-excerpt.js";

export const DECISION_CATALOG_FRESHNESS_MS = 9 * 86_400_000;
const authenticatedDecisionIndexes = new WeakSet<object>();
const authenticatedDecisionIndexSets = new WeakMap<AuthenticatedDecisionIndexSet, ReadonlyMap<string, DecisionIndex>>();
const installedPluginRoot = fileURLToPath(new URL("../../plugins/skillset-manager", import.meta.url));
let installedDecisionIndex: Promise<DecisionIndex> | undefined;
let installedDecisionIndexSet: Promise<AuthenticatedDecisionIndexSet> | undefined;

export interface AuthenticatedDecisionIndexSet {
  readonly current: DecisionIndex;
  readonly digests: readonly string[];
}

/** Loads the checked-in plugin index without treating user input as catalog data. */
export async function loadPluginDecisionIndex(pluginRoot: string): Promise<DecisionIndex> {
  const value = JSON.parse(await readFile(join(pluginRoot, "data", "decision-index.json"), "utf8")) as unknown;
  const index = validateDecisionIndex(value);
  assertDecisionIndexIntegrity(index);
  return deepFreeze(index);
}

/** Loads and authenticates only this module's installed plugin-owned index. */
export function loadInstalledDecisionIndex(): Promise<DecisionIndex> {
  installedDecisionIndex ??= loadPluginDecisionIndex(installedPluginRoot).then((index) => {
    authenticatedDecisionIndexes.add(index);
    return index;
  });
  return installedDecisionIndex;
}

/** Loads the current installed catalog and every immutable digest-named historical catalog. */
export function loadInstalledDecisionIndexSet(): Promise<AuthenticatedDecisionIndexSet> {
  installedDecisionIndexSet ??= loadInstalledDecisionIndex().then(async (current) =>
    loadDecisionIndexSet(installedPluginRoot, current));
  return installedDecisionIndexSet;
}

/** Plugin-root variant used by isolated installed-plugin verification. */
export async function loadPluginDecisionIndexSet(pluginRoot: string): Promise<AuthenticatedDecisionIndexSet> {
  const root = resolve(await realpath(pluginRoot));
  const current = await loadAnchoredDecisionIndex(join(root, "data", "decision-index.json"));
  return loadDecisionIndexSet(root, current);
}

export function decisionIndexFromSet(
  set: AuthenticatedDecisionIndexSet,
  digest: string
): DecisionIndex | undefined {
  return authenticatedDecisionIndexSets.get(set)?.get(digest);
}

export function isAuthenticatedDecisionIndexSet(value: unknown): value is AuthenticatedDecisionIndexSet {
  return typeof value === "object" && value !== null
    && authenticatedDecisionIndexSets.has(value as AuthenticatedDecisionIndexSet);
}

/** True only for the exact frozen object returned by this module's loader. */
export function isAuthenticatedDecisionIndex(index: DecisionIndex): boolean {
  return authenticatedDecisionIndexes.has(index);
}

async function loadDecisionIndexSet(
  pluginRoot: string,
  current: DecisionIndex
): Promise<AuthenticatedDecisionIndexSet> {
  const byDigest = new Map<string, DecisionIndex>([[current.digest, current]]);
  const historyRoot = join(pluginRoot, "data", "decision-index-history");
  let entries: Dirent[];
  try {
    const metadata = await lstat(historyRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Decision index history is not a regular directory");
    }
    entries = await readdir(historyRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) entries = [];
    else throw error;
  }
  for (const entry of entries) {
    const match = entry.name.match(/^([a-f0-9]{64})\.json$/u);
    if (match === null || !entry.isFile() || entry.isSymbolicLink()) {
      throw new Error("Decision index history contains a noncanonical filename or entry");
    }
    const digest = match[1]!;
    const historical = await loadAnchoredDecisionIndex(join(historyRoot, entry.name));
    if (historical.digest !== digest || byDigest.has(digest)) {
      throw new Error("Decision index history filename does not match one unique index digest");
    }
    byDigest.set(digest, historical);
  }
  const set = Object.freeze({ current, digests: Object.freeze([...byDigest.keys()].sort()) });
  authenticatedDecisionIndexSets.set(set, byDigest);
  return set;
}

async function loadAnchoredDecisionIndex(path: string): Promise<DecisionIndex> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Decision index generation is not a regular file");
  }
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  const index = validateDecisionIndex(value);
  assertDecisionIndexIntegrity(index);
  return deepFreeze(index);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Verifies deterministic index metadata before any plan may be built from it. */
export function assertDecisionIndexIntegrity(index: DecisionIndex): void {
  const expectedDigest = digest(indexWithoutDigest(index));
  if (index.digest !== expectedDigest) throw new Error("decision index digest mismatch");
  if (!/^[a-f0-9]{64}$/u.test(index.catalogVersion)) {
    throw new Error("decision index catalogVersion must be a projection digest");
  }

  const observedThrough = Date.parse(index.observedThrough);
  const expiresAt = Date.parse(index.catalogExpiresAt);
  if (!Number.isFinite(observedThrough) || !Number.isFinite(expiresAt)
    || expiresAt - observedThrough !== DECISION_CATALOG_FRESHNESS_MS) {
    throw new Error("decision index catalogExpiresAt must be exactly nine days after observedThrough");
  }

  const candidateById = new Map(index.candidates.map((candidate) => [candidate.id, candidate]));
  if (candidateById.size !== index.candidates.length) throw new Error("decision index has duplicate candidate IDs");
  for (const candidate of index.candidates) assertCandidateIntegrity(candidate, index.observedThrough);
  for (const evidence of index.candidateEvidence) {
    const candidate = candidateById.get(evidence.candidateId);
    if (candidate === undefined || !sameValue(candidate, evidence.candidate)) {
      throw new Error(`${evidence.id}: candidate evidence does not bind its indexed candidate`);
    }
    assertCandidateEvidenceIntegrity(evidence, candidate);
  }

  const expectedFixtures = buildExpectedFixtures(index.profiles, index.observedThrough);
  if (!sameValue(index.intentFixtures, expectedFixtures)) {
    throw new Error("decision index intent fixtures must contain every single profile and ordered pair");
  }
}

export function decisionIndexDigest(index: Omit<DecisionIndex, "digest">): string {
  return digest(index);
}

export function buildDecisionIntentFixtures(
  profiles: readonly IntentProfile[],
  observedThrough: string
): DecisionIntentFixture[] {
  return buildExpectedFixtures(profiles, observedThrough);
}

function assertCandidateIntegrity(candidate: DecisionCandidateProjection, observedThrough: string): void {
  const staleOrBlocked = candidate.stateReasons.some((reason) =>
    reason === "review-blocked" || reason === "blocked" || reason === "stale" || reason === "stale-evidence"
      || reason === "expired" || reason === "review-stale"
  );
  if (candidate.state === "eligible-with-disclosures") {
    if (candidate.displayName === undefined || candidate.description === undefined) {
      throw new Error(`${candidate.id}: eligible candidate lacks authenticated display metadata`);
    }
    if (staleOrBlocked) throw new Error(`${candidate.id}: blocked or stale candidate cannot be eligible`);
    if (!candidate.stateReasons.some((reason) =>
      reason.startsWith(`target-verified:${candidate.runtime}/`)
    )) {
      throw new Error(`${candidate.id}: eligible candidate lacks verified target evidence`);
    }
    for (const reason of candidate.stateReasons.filter((value) => value.startsWith(`target-verified:${candidate.runtime}/`))) {
      const platform = reason.slice(reason.lastIndexOf("/") + 1) as Platform;
      assertFutureTimestamp(candidate.eligibility?.targetExpiresAt[platform], observedThrough, `${candidate.id}: target expiry`);
      assertPastTimestamp(candidate.ranking?.targetEvidenceAt[platform], observedThrough, `${candidate.id}: target ranking evidence`);
      assertTargetEvidenceWindow(
        candidate.ranking?.targetEvidenceAt[platform],
        candidate.eligibility?.targetExpiresAt[platform],
        observedThrough,
        candidate.officialBaseline !== undefined && candidate.revisionBinding === "unavailable",
        `${candidate.id}: target evidence`
      );
    }
    if (candidate.revisionBinding === "exact" && candidate.skillPath !== null) {
      assertFutureTimestamp(candidate.eligibility?.reviewExpiresAt ?? undefined, observedThrough, `${candidate.id}: review expiry`);
      assertPastTimestamp(candidate.ranking?.reviewedAt ?? undefined, observedThrough, `${candidate.id}: review ranking evidence`);
    }
  }
  if (candidate.codexInstall !== undefined) {
    if (candidate.runtime !== "codex" || candidate.skillPath !== candidate.codexInstall.skillPath
      || candidate.revisionBinding !== "exact") {
      throw new Error(`${candidate.id}: Codex install evidence requires an exact Codex skill path`);
    }
  }
}

function assertCandidateEvidenceIntegrity(
  evidence: DecisionIndex["candidateEvidence"][number],
  candidate: DecisionCandidateProjection
): void {
  const hasArtifactFields = evidence.artifactPath !== undefined
    || evidence.artifactSha256 !== undefined
    || evidence.sourceBlobs !== undefined;
  const hasListingProof = evidence.listingExcerpt !== undefined
    || evidence.listingExcerptSha256 !== undefined;
  if (evidence.kind === "official-listing") {
    if (evidence.support === undefined || evidence.listingExcerpt === undefined
      || evidence.listingExcerptSha256 === undefined || hasArtifactFields) {
      throw new Error(`${evidence.id}: official-listing evidence requires listing proof fields and forbids source artifact fields`);
    }
    if (candidate.description === undefined || candidate.officialBaseline === undefined
      || evidence.reference !== `${candidate.officialBaseline.reference}/description`
      || evidence.contentSha256 !== digestText(candidate.description)
      || evidence.listingExcerptSha256 !== digestText(evidence.listingExcerpt)) {
      throw new Error(`${evidence.id}: official-listing evidence does not bind the indexed candidate description`);
    }
    assertSemanticListingExcerpt(candidate.description, evidence.listingExcerpt, evidence.id);
  } else if (hasListingProof) {
    throw new Error(`${evidence.id}: ${evidence.kind} evidence must not carry official-listing fields`);
  }
}

function assertTargetEvidenceWindow(
  reviewedAt: string | undefined,
  expiresAt: string | undefined,
  observedThrough: string,
  requiresCatalogEpoch: boolean,
  label: string
): void {
  const reviewed = reviewedAt === undefined ? Number.NaN : Date.parse(reviewedAt);
  const expires = expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);
  if (!Number.isFinite(reviewed) || !Number.isFinite(expires)
    || expires - reviewed > DECISION_CATALOG_FRESHNESS_MS) {
    throw new Error(`${label} validity must not exceed the nine-day catalog freshness window`);
  }
  if (requiresCatalogEpoch && reviewedAt !== observedThrough) {
    throw new Error(`${label} must equal the authenticated catalog epoch`);
  }
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertFutureTimestamp(value: string | undefined, observedThrough: string, label: string): void {
  const timestamp = value === undefined ? Number.NaN : Date.parse(value);
  const observed = Date.parse(observedThrough);
  if (!Number.isFinite(timestamp) || !Number.isFinite(observed) || timestamp <= observed) {
    throw new Error(`${label} must be authenticated and later than observedThrough`);
  }
}

function assertPastTimestamp(value: string | undefined, observedThrough: string, label: string): void {
  const timestamp = value === undefined ? Number.NaN : Date.parse(value);
  const observed = Date.parse(observedThrough);
  if (!Number.isFinite(timestamp) || !Number.isFinite(observed) || timestamp > observed) {
    throw new Error(`${label} must be authenticated and no later than observedThrough`);
  }
}

function buildExpectedFixtures(
  profiles: readonly IntentProfile[],
  observedThrough: string
): DecisionIntentFixture[] {
  if (profiles.length !== COMPLETE_V1_DOMAIN_IDS.length
    || profiles.some(({ domainId }, index) => domainId !== COMPLETE_V1_DOMAIN_IDS[index])) {
    throw new Error("decision index fixtures require the exact Complete v1 domain profile order");
  }
  const fixtures: DecisionIntentFixture[] = [];
  for (const runtime of ["claude-code", "codex"] as const) {
    const runtimeId = runtime === "claude-code" ? "claude" : "codex";
    for (const profile of profiles) {
      fixtures.push({
        id: `${runtimeId}-domain-single-${profile.id}`,
        runtime,
        platform: "darwin",
        asOf: observedThrough,
        domainIds: [profile.domainId]
      });
      for (const language of ["ko", "en"] as const) {
        for (const [phraseIndex, goal] of profile.phrases[language].entries()) {
          fixtures.push({
            id: `${runtimeId}-goal-${profile.id}-${language}-${phraseIndex + 1}`,
            runtime,
            platform: "darwin",
            asOf: observedThrough,
            goal
          });
        }
      }
    }
    for (const primary of profiles) {
      for (const complement of profiles) {
        if (primary.domainId === complement.domainId) continue;
        fixtures.push({
          id: `${runtimeId}-domain-pair-${primary.id}-then-${complement.id}`,
          runtime,
          platform: "darwin",
          asOf: observedThrough,
          domainIds: [primary.domainId, complement.domainId]
        });
      }
    }
    const tie = equalLengthTie(profiles);
    fixtures.push(
      {
        id: `${runtimeId}-boundary-punctuation`,
        runtime,
        platform: "darwin",
        asOf: observedThrough,
        goal: "쇼핑몰을, 상품 홍보하고."
      },
      {
        id: `${runtimeId}-boundary-token`,
        runtime,
        platform: "darwin",
        asOf: observedThrough,
        goal: "metadata analysis migration"
      },
      {
        id: `${runtimeId}-tie`,
        runtime,
        platform: "darwin",
        asOf: observedThrough,
        goal: `${tie.left} ${tie.right}`
      },
      {
        id: `${runtimeId}-three-domain-priority`,
        runtime,
        platform: "darwin",
        asOf: observedThrough,
        domainIds: COMPLETE_V1_DOMAIN_IDS.slice(0, 3),
        domainPriority: [COMPLETE_V1_DOMAIN_IDS[2]!, COMPLETE_V1_DOMAIN_IDS[0]!]
      }
    );
  }
  const ids = new Set(fixtures.map(({ id }) => id));
  if (ids.size !== fixtures.length) throw new Error("decision index fixtures must have unique IDs");
  return fixtures;
}

function equalLengthTie(profiles: readonly IntentProfile[]): { left: string; right: string } {
  const phrases = profiles.flatMap((profile) => [...profile.phrases.ko, ...profile.phrases.en]
    .map((phrase) => ({ domainId: profile.domainId, phrase, length: normalizedPhraseLength(phrase) })));
  for (const [index, left] of phrases.entries()) {
    const right = phrases.slice(index + 1).find((candidate) =>
      candidate.domainId !== left.domainId && candidate.length === left.length
    );
    if (right !== undefined) return { left: left.phrase, right: right.phrase };
  }
  throw new Error("decision index fixtures require an equal-length cross-domain phrase tie");
}

function indexWithoutDigest(index: DecisionIndex): Omit<DecisionIndex, "digest"> {
  const { digest: _digest, ...withoutDigest } = index;
  return withoutDigest;
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableValue(value)).digest("hex");
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodePoints(left: string, right: string): number {
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

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}
