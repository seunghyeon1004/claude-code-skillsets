import { createHash } from "node:crypto";

import type { ObservedMarketplaceIdentityEvidence } from "../model/complete-v1.js";
import type {
  CandidateCapabilityEvidence,
  CandidateRevision,
  DecisionCandidateEvidenceManifest,
  DecisionCandidateProjection,
  OfficialTargetCompatibilityEvidence
} from "../model/decision.js";
import type { ObservationEvidence } from "../model/observation.js";
import type { ReviewerRegistry } from "../model/review-ledger.js";
import {
  officialMarketplaceCandidateIdentity,
  type OfficialMarketplacePlugin,
  type OfficialMarketplaceSelection
} from "../discovery/official-marketplace.js";
import { canonicalize } from "../research/canonical-json.js";
import { hasPrivilegedReviewerAuthority } from "../research/reviewer-authority.js";

export interface CandidateRevisionProjectionContext {
  selection: OfficialMarketplaceSelection;
  asOf: string;
  reviewers: ReviewerRegistry;
  observationEvidence: readonly ObservationEvidence[];
  latestObservationEvidenceIdBySource: Readonly<Record<string, string>>;
  observedMarketplaceEvidence: readonly ObservedMarketplaceIdentityEvidence[];
  artifactSha256ByPath: Readonly<Record<string, string>>;
}

export interface CandidateRevisionProjection {
  candidates: DecisionCandidateProjection[];
  evidence: CandidateCapabilityEvidence[];
  officialTargetCompatibilityEvidence: OfficialTargetCompatibilityEvidence[];
  quarantinedCandidateIds: string[];
}

/** Hashes the complete revision after removing only the nested approval digest. */
export function candidateRevisionDigest(revision: CandidateRevision): string {
  const hashable = structuredClone(revision);
  delete (hashable.approval as Partial<CandidateRevision["approval"]>).digest;
  return createHash("sha256").update(canonicalize(hashable), "utf8").digest("hex");
}

/** Validates immutable revision chains and materializes only each candidate's current tail. */
export function resolveCandidateRevisionProjection(
  manifest: DecisionCandidateEvidenceManifest,
  context: CandidateRevisionProjectionContext
): CandidateRevisionProjection {
  const baseById = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
  const revisions = manifest.candidateRevisions ?? [];
  const revisionsByCandidate = new Map<string, CandidateRevision[]>();
  const revisionCandidateIds = new Map<string, string>();
  const revisionIds = new Set<string>();
  for (const revision of revisions) {
    if (revisionIds.has(revision.id)) throw new Error(`${revision.id}: duplicate candidate revision ID`);
    revisionIds.add(revision.id);
    revisionCandidateIds.set(revision.id, revision.candidateId);
    const base = baseById.get(revision.candidateId);
    if (base === undefined) throw new Error(`${revision.id}: candidateId does not resolve to an immutable base candidate`);
    const candidateRevisions = revisionsByCandidate.get(revision.candidateId) ?? [];
    const expectedPrevious = candidateRevisions.at(-1)?.id ?? null;
    if (revision.previousRevisionId !== expectedPrevious) {
      throw new Error(`${revision.id}: previousRevisionId must identify the immediately preceding revision; forks are forbidden`);
    }
    validateRevision(revision, base, manifest, context);
    candidateRevisions.push(revision);
    revisionsByCandidate.set(revision.candidateId, candidateRevisions);
  }

  for (const evidence of manifest.evidence) {
    if (!baseById.has(evidence.candidateId)) {
      throw new Error(`${evidence.id}: capability evidence candidate does not exist`);
    }
    if (evidence.candidateRevisionId !== undefined && !revisionIds.has(evidence.candidateRevisionId)) {
      throw new Error(`${evidence.id}: candidateRevisionId does not resolve`);
    }
    if (evidence.candidateRevisionId !== undefined
      && revisionCandidateIds.get(evidence.candidateRevisionId) !== evidence.candidateId) {
      throw new Error(`${evidence.id}: candidateRevisionId belongs to a different candidate`);
    }
  }
  for (const evidence of manifest.officialTargetCompatibilityEvidence ?? []) {
    if (!baseById.has(evidence.candidateId)) {
      throw new Error(`${evidence.id}: compatibility evidence candidate does not exist`);
    }
    if (evidence.candidateRevisionId !== undefined && !revisionIds.has(evidence.candidateRevisionId)) {
      throw new Error(`${evidence.id}: candidateRevisionId does not resolve`);
    }
    if (evidence.candidateRevisionId !== undefined
      && revisionCandidateIds.get(evidence.candidateRevisionId) !== evidence.candidateId) {
      throw new Error(`${evidence.id}: candidateRevisionId belongs to a different candidate`);
    }
  }

  const candidates: DecisionCandidateProjection[] = [];
  const evidence: CandidateCapabilityEvidence[] = [];
  const compatibility: OfficialTargetCompatibilityEvidence[] = [];
  const quarantinedCandidateIds: string[] = [];
  for (const base of manifest.candidates) {
    const tail = revisionsByCandidate.get(base.id)?.at(-1);
    const current = structuredClone(tail?.candidate ?? base);
    if (requiresDriftQuarantine(current, tail, context.selection)) {
      candidates.push(quarantinedCandidate(current, context.selection));
      quarantinedCandidateIds.push(current.id);
      continue;
    }
    candidates.push(current);
    evidence.push(...manifest.evidence.filter((item) => item.candidateId === current.id
      && item.candidateRevisionId === tail?.id));
    compatibility.push(...(manifest.officialTargetCompatibilityEvidence ?? []).filter((item) =>
      item.candidateId === current.id && item.candidateRevisionId === tail?.id));
  }
  return {
    candidates,
    evidence,
    officialTargetCompatibilityEvidence: compatibility,
    quarantinedCandidateIds
  };
}

function validateRevision(
  revision: CandidateRevision,
  base: DecisionCandidateProjection,
  manifest: DecisionCandidateEvidenceManifest,
  context: CandidateRevisionProjectionContext
): void {
  const { candidate, approval } = revision;
  if (candidate.id !== revision.candidateId || candidate.candidateRevisionId !== revision.id) {
    throw new Error(`${revision.id}: candidate identity or candidateRevisionId mismatch`);
  }
  if (candidate.sourceId !== base.sourceId || candidate.runtime !== base.runtime || candidate.skillPath !== base.skillPath) {
    throw new Error(`${revision.id}: sourceId, runtime, and skillPath must match the immutable base identity`);
  }
  if (approval.disposition !== candidate.state) {
    throw new Error(`${revision.id}: approval disposition must equal candidate state`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(approval.reviewedAt)
    || !Number.isFinite(Date.parse(approval.reviewedAt))) {
    throw new Error(`${revision.id}: approval reviewedAt is invalid`);
  }
  if (!hasPrivilegedReviewerAuthority(context.reviewers, approval.reviewerId)) {
    throw new Error(`${revision.id}: reviewer has no candidate revision approval authority`);
  }
  if (approval.digest !== candidateRevisionDigest(revision)) {
    throw new Error(`${revision.id}: approval digest mismatch`);
  }

  const baseline = candidate.officialBaseline;
  if (baseline === undefined || baseline.pluginName !== candidate.id
    || approval.sourceCommit !== baseline.sourceCommit
    || approval.marketplaceManifestSha256 !== baseline.marketplaceManifestSha256
    || !baseline.reference.startsWith(`${approval.observedArtifactPath}#/plugins/`)) {
    throw new Error(`${revision.id}: approval source commit or marketplace baseline mismatch`);
  }
  const selectedPath = approval.observedArtifactPath.slice("research/marketplaces/".length);
  const selectedArtifact = context.selection.artifactByPath[selectedPath];
  const selectedArtifactObservedAt = context.selection.artifactObservedAtByPath[selectedPath];
  const selectedPlugin = selectedArtifact?.plugins.find(({ name }) => name === candidate.id);
  if (context.selection.artifactSha256ByPath[selectedPath] !== approval.observedArtifactSha256
    || context.selection.marketplaceManifestSha256ByPath[selectedPath] !== baseline.marketplaceManifestSha256
    || selectedArtifact === undefined
    || selectedArtifactObservedAt === undefined
    || selectedPlugin === undefined
    || approval.candidateIdentity !== officialMarketplaceCandidateIdentity(selectedPlugin)
    || baseline.sourceUrl !== pluginSourceUrl(selectedPlugin, selectedArtifact.provenance.repository)
    || baseline.sourceCommit !== pluginSourceCommit(selectedPlugin, selectedArtifact.provenance.inspectedCommit)) {
    throw new Error(`${revision.id}: observed artifact path or SHA is not authenticated by the marketplace selection chain`);
  }
  if (context.artifactSha256ByPath[approval.evidenceArtifactPath] !== approval.evidenceArtifactSha256) {
    throw new Error(`${revision.id}: approval evidence artifact SHA mismatch`);
  }

  const revisionEvidence = manifest.evidence.filter((item) => item.candidateRevisionId === revision.id);
  if (!sameStrings(approval.evidenceIds, candidate.capabilityEvidenceIds)
    || !sameStrings(approval.evidenceIds, revisionEvidence.map(({ id }) => id))) {
    throw new Error(`${revision.id}: approval, candidate, and revision evidence IDs must match exactly`);
  }
  for (const item of revisionEvidence) {
    if (item.candidateId !== candidate.id
      || item.artifactPath !== approval.evidenceArtifactPath
      || item.artifactSha256 !== approval.evidenceArtifactSha256
      || item.reference !== baseline.reference
      || item.contentSha256 !== baseline.marketplaceManifestSha256) {
      throw new Error(`${item.id}: candidate revision evidence binding mismatch`);
    }
  }

  const observation = context.observationEvidence.find(({ id }) => id === approval.observationEvidenceId);
  const marketplaceEvidence = context.observedMarketplaceEvidence.filter((item) =>
    item.observationEvidenceId === approval.observationEvidenceId
    && item.providerId === candidate.sourceId
    && item.reviewedCommit === observation?.inspectedCommit
    && item.observedArtifactPath === approval.observedArtifactPath
    && item.observedArtifactSha256 === approval.observedArtifactSha256
    && item.artifactPath === approval.evidenceArtifactPath
    && item.artifactSha256 === approval.evidenceArtifactSha256
    && item.outcome === "passed");
  if (observation === undefined || observation.sourceId !== candidate.sourceId
    || context.latestObservationEvidenceIdBySource[candidate.sourceId] !== observation.id
    || marketplaceEvidence.length !== 1) {
    throw new Error(`${revision.id}: observation or observed-marketplace evidence binding mismatch`);
  }
  const reviewedAt = Date.parse(approval.reviewedAt);
  if (reviewedAt < Date.parse(observation.observedAt)
    || reviewedAt < Date.parse(selectedArtifactObservedAt)
    || reviewedAt > Date.parse(context.asOf)
    || marketplaceEvidence.some((item) => reviewedAt < Date.parse(item.observedAt))) {
    throw new Error(`${revision.id}: review timestamp must follow bound observations and not exceed catalog asOf`);
  }

  for (const item of manifest.officialTargetCompatibilityEvidence ?? []) {
    if (item.candidateRevisionId !== revision.id) continue;
    if (item.candidateId !== candidate.id || item.sourceId !== candidate.sourceId
      || item.snapshot.marketplaceEntrySourceCommit !== baseline.sourceCommit) {
      throw new Error(`${item.id}: compatibility evidence does not bind the exact candidate revision`);
    }
  }
}

function requiresDriftQuarantine(
  candidate: DecisionCandidateProjection,
  tail: CandidateRevision | undefined,
  selection: OfficialMarketplaceSelection
): boolean {
  const baseline = candidate.officialBaseline;
  if (baseline === undefined) return false;
  const observedPlugin = selection.observedArtifact.plugins.find(({ name }) => name === candidate.id);
  if (observedPlugin === undefined) return true;
  const observedIdentity = officialMarketplaceCandidateIdentity(observedPlugin);
  if (tail !== undefined) return tail.approval.candidateIdentity !== observedIdentity;

  const baselineMatch = /^research\/marketplaces\/([a-z0-9][a-z0-9-]*\.json)#\/plugins\/(0|[1-9][0-9]*)$/u
    .exec(baseline.reference);
  const baselineArtifact = baselineMatch === null ? undefined : selection.artifactByPath[baselineMatch[1]!];
  const baselinePlugin = baselineArtifact?.plugins[Number(baselineMatch?.[2])];
  if (baselineArtifact === undefined || baselinePlugin === undefined) return true;
  return baselinePlugin.name !== candidate.id
    || baseline.sourceUrl !== pluginSourceUrl(baselinePlugin, baselineArtifact.provenance.repository)
    || baseline.sourceCommit !== pluginSourceCommit(baselinePlugin, baselineArtifact.provenance.inspectedCommit)
    || officialMarketplaceCandidateIdentity(baselinePlugin) !== observedIdentity;
}

function quarantinedCandidate(
  candidate: DecisionCandidateProjection,
  selection: OfficialMarketplaceSelection
): DecisionCandidateProjection {
  const copy = structuredClone(candidate);
  const previousPin = copy.officialBaseline?.sourceCommit ?? "unknown";
  const observed = selection.observedArtifact.plugins.find(({ name }) => name === copy.id);
  const observedPin = observed === undefined
    ? "missing"
    : pluginSourceCommit(observed, selection.observedArtifact.provenance.inspectedCommit);
  delete copy.officialBaseline;
  delete copy.claudeInstall;
  delete copy.codexInstall;
  delete copy.eligibility;
  delete copy.ranking;
  const globalHoldReasons = selection.state === "review-required"
    ? ["official-marketplace-selection:review-required"]
    : [];
  return {
    ...copy,
    state: "held",
    stateReasons: [...new Set([
      ...copy.stateReasons,
      ...globalHoldReasons,
      "source-drift:unreviewed",
      `source-drift:${previousPin}->${observedPin}`
    ])],
    providedCapabilityIds: [],
    capabilityEvidenceIds: [],
    revisionBinding: "unavailable"
  };
}

function pluginSourceCommit(
  plugin: OfficialMarketplacePlugin,
  marketplaceCommit: string
): string {
  return typeof plugin.source === "string" ? marketplaceCommit : plugin.source.sha;
}

function pluginSourceUrl(
  plugin: OfficialMarketplacePlugin,
  marketplaceRepository: string
): string {
  if (typeof plugin.source === "string") return marketplaceRepository;
  if (plugin.source.source === "github") return `https://github.com/${plugin.source.repo}.git`;
  return plugin.source.url;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
