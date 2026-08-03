import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

import {
  OFFICIAL_MARKETPLACE_SOURCE,
  type OfficialMarketplaceBaseline,
  type OfficialMarketplacePlugin
} from "../discovery/official-marketplace.js";
import type {
  CandidateCapabilityEvidence,
  DecisionCandidateEvidenceManifest,
  DecisionCandidateProjection,
  OfficialListingCandidateClaims,
  OfficialListingClaimsManifest,
  OfficialTargetCompatibilityEvidence
} from "../model/decision.js";
import type { DomainId } from "../model/complete-v1.js";
import { canonicalize } from "../research/canonical-json.js";
import { assertSemanticListingExcerpt } from "./listing-excerpt.js";

const require = createRequire(import.meta.url);
const schema = require("../../schemas/v3/official-listing-claims.schema.json") as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile<OfficialListingClaimsManifest>(schema);
const MARKETPLACE_ARTIFACT = "research/marketplaces/claude-plugins-official-e3e378c.json";
const DECISION_CATALOG_FRESHNESS_MS = 9 * 86_400_000;

export interface OfficialListingClaimsValidationContext {
  capabilityOwnership: ReadonlyMap<string, DomainId>;
  catalogEpoch: string;
  selectionState?: "current" | "review-required";
}

export function validateOfficialListingClaims(
  value: unknown,
  context: OfficialListingClaimsValidationContext
): OfficialListingClaimsManifest {
  if (!validateSchema(value)) {
    throw new Error(`Invalid official listing claims:\n${formatErrors(validateSchema.errors).join("\n")}`);
  }
  const errors = semanticErrors(value, context);
  if (errors.length > 0) {
    throw new Error(`Invalid official listing claims:\n${errors.join("\n")}`);
  }
  return value;
}

export function materializeOfficialListingClaims(input: {
  manifest: OfficialListingClaimsManifest;
  baseline: OfficialMarketplaceBaseline;
  existing: DecisionCandidateEvidenceManifest;
  marketplaceArtifactPath?: string;
  heldCandidateNames?: ReadonlySet<string>;
}): DecisionCandidateEvidenceManifest {
  const { manifest, baseline, existing } = input;
  validateAttestation(manifest, baseline);
  const existingCandidateIds = new Set(existing.candidates.map(({ id }) => id));
  const existingEvidenceIds = new Set(existing.evidence.map(({ id }) => id));
  const compatibilityIds = new Set((existing.officialTargetCompatibilityEvidence ?? []).map(({ id }) => id));
  const candidates: DecisionCandidateProjection[] = [];
  const evidence: CandidateCapabilityEvidence[] = [];
  const compatibility: OfficialTargetCompatibilityEvidence[] = [];

  for (const claims of manifest.candidates) {
    const resolved = resolveCandidate(
      claims,
      baseline,
      input.marketplaceArtifactPath ?? MARKETPLACE_ARTIFACT
    );
    const materializedEvidence = materializeCapabilityEvidence(claims, resolved.plugin);
    for (const item of materializedEvidence) {
      if (existingEvidenceIds.has(item.id)) {
        throw new Error(`${item.id}: official listing capability evidence ID conflicts with existing evidence`);
      }
    }
    const compatibilityId = uniqueCompatibilityId(resolved.plugin.name, manifest, compatibilityIds);
    compatibilityIds.add(compatibilityId);
    compatibility.push(materializeCompatibility(manifest, resolved, compatibilityId));
    if (existingCandidateIds.has(claims.pluginName)) continue;

    candidates.push(materializeCandidate(
      claims,
      resolved,
      input.heldCandidateNames?.has(claims.pluginName) ?? false
    ));
    evidence.push(...materializedEvidence);
  }

  return {
    schemaVersion: 3,
    candidates: [...existing.candidates, ...candidates],
    ...(existing.candidateRevisions === undefined
      ? {}
      : { candidateRevisions: structuredClone(existing.candidateRevisions) }),
    evidence: [...existing.evidence, ...evidence],
    officialTargetCompatibilityEvidence: [
      ...(existing.officialTargetCompatibilityEvidence ?? []),
      ...compatibility
    ]
  };
}

function semanticErrors(
  manifest: OfficialListingClaimsManifest,
  context: OfficialListingClaimsValidationContext
): string[] {
  const errors: string[] = [];
  const pluginNames = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const [candidateIndex, candidate] of manifest.candidates.entries()) {
    if (pluginNames.has(candidate.pluginName)) {
      errors.push(`/candidates/${candidateIndex}/pluginName: duplicate plugin name`);
    }
    pluginNames.add(candidate.pluginName);
    const domains = new Set<string>();
    for (const [assignmentIndex, assignment] of candidate.assignments.entries()) {
      if (domains.has(assignment.domainId)) {
        errors.push(`/candidates/${candidateIndex}/assignments/${assignmentIndex}/domainId: duplicate domain assignment`);
      }
      domains.add(assignment.domainId);
      for (const [claimIndex, claim] of assignment.capabilityClaims.entries()) {
        const capabilityPath = `/candidates/${candidateIndex}/assignments/${assignmentIndex}/capabilityClaims/${claimIndex}/capabilityId`;
        const ownerDomainId = context.capabilityOwnership.get(claim.capabilityId);
        if (ownerDomainId === undefined) {
          errors.push(`${capabilityPath}: capability does not exist in the Complete v1 taxonomy`);
        } else if (ownerDomainId !== assignment.domainId) {
          errors.push(`${capabilityPath}: capability belongs to ${ownerDomainId}, not ${assignment.domainId}`);
        }
        if (evidenceIds.has(claim.id)) {
          errors.push(`/candidates/${candidateIndex}/assignments/${assignmentIndex}/capabilityClaims/${claimIndex}/id: duplicate evidence ID`);
        }
        evidenceIds.add(claim.id);
      }
    }
  }
  const attestation = manifest.compatibilityAttestation;
  const observed = Date.parse(attestation.observedAt);
  const reviewed = Date.parse(attestation.reviewedAt);
  const expires = Date.parse(attestation.expiresAt);
  const catalogEpoch = Date.parse(context.catalogEpoch);
  if (!Number.isFinite(observed) || !Number.isFinite(reviewed) || !Number.isFinite(expires)
    || !Number.isFinite(catalogEpoch) || reviewed < observed || expires <= reviewed) {
    errors.push("/compatibilityAttestation: timestamps must satisfy observedAt <= reviewedAt < expiresAt");
  }
  if ((context.selectionState ?? "current") === "current") {
    if (attestation.observedAt !== context.catalogEpoch || attestation.reviewedAt !== context.catalogEpoch) {
      errors.push("/compatibilityAttestation: observedAt and reviewedAt must equal the authenticated catalog epoch");
    }
  } else if (observed > catalogEpoch || reviewed > catalogEpoch) {
    errors.push("/compatibilityAttestation: review-held evidence cannot postdate the authenticated catalog epoch");
  }
  if (Number.isFinite(reviewed) && Number.isFinite(expires)
    && expires - reviewed > DECISION_CATALOG_FRESHNESS_MS) {
    errors.push("/compatibilityAttestation/expiresAt: validity must not exceed the nine-day decision catalog freshness window");
  }
  const requiredDisclosures = [
    "compatibility-inference:not-install-smoke",
    "individual-safety-review:not-complete",
    "target-unknown:claude-code/linux",
    "target-unknown:claude-code/win32"
  ];
  for (const disclosure of requiredDisclosures) {
    if (!attestation.disclosures.includes(disclosure)) {
      errors.push(`/compatibilityAttestation/disclosures: missing ${disclosure}`);
    }
  }
  if (!attestation.sourceUrls.includes("https://code.claude.com/docs/en/overview")) {
    errors.push("/compatibilityAttestation/sourceUrls: missing official Claude Code overview");
  }
  return errors;
}

function validateAttestation(
  manifest: OfficialListingClaimsManifest,
  baseline: OfficialMarketplaceBaseline
): void {
  const expectedMarketplaceUrl = marketplaceEntryUrl(baseline);
  if (!manifest.compatibilityAttestation.sourceUrls.includes(expectedMarketplaceUrl)) {
    throw new Error("official listing compatibility attestation is not bound to the pinned marketplace manifest");
  }
}

function resolveCandidate(
  claims: OfficialListingCandidateClaims,
  baseline: OfficialMarketplaceBaseline,
  marketplaceArtifactPath: string
): {
  plugin: OfficialMarketplacePlugin;
  pluginIndex: number;
  sourceUrl: string;
  sourceCommit: string;
  baseline: OfficialMarketplaceBaseline;
} {
  const pluginIndex = baseline.plugins.findIndex(({ name }) => name === claims.pluginName);
  const plugin = baseline.plugins[pluginIndex];
  if (plugin === undefined) throw new Error(`${claims.pluginName}: official marketplace plugin does not exist`);
  const expectedReference = `${marketplaceArtifactPath}#/plugins/${pluginIndex}`;
  if (claims.marketplaceReference !== expectedReference) {
    throw new Error(`${claims.pluginName}: marketplace reference does not match the pinned plugin pointer`);
  }
  if (claims.sourcePin.kind !== plugin.sourcePin.kind || claims.sourcePin.sha !== plugin.sourcePin.sha) {
    throw new Error(`${claims.pluginName}: source pin does not match the pinned marketplace listing`);
  }
  const source = normalizedSource(plugin, baseline);
  return { plugin, pluginIndex, ...source, baseline };
}

function materializeCapabilityEvidence(
  claims: OfficialListingCandidateClaims,
  plugin: OfficialMarketplacePlugin
): CandidateCapabilityEvidence[] {
  const descriptionSha256 = sha256(plugin.description);
  return claims.assignments.flatMap((assignment) => assignment.capabilityClaims.map((claim) => {
    if (claim.listingExcerptSha256 !== sha256(claim.listingExcerpt)) {
      throw new Error(`${claim.id}: listing excerpt SHA-256 mismatch`);
    }
    if (!plugin.description.includes(claim.listingExcerpt)) {
      throw new Error(`${claim.id}: listing excerpt does not occur in the pinned description`);
    }
    assertSemanticListingExcerpt(plugin.description, claim.listingExcerpt, claim.id);
    return {
      id: claim.id,
      candidateId: claims.pluginName,
      capabilityId: claim.capabilityId,
      kind: "official-listing" as const,
      current: true,
      reference: `${claims.marketplaceReference}/description`,
      contentSha256: descriptionSha256,
      support: claim.support,
      listingExcerpt: claim.listingExcerpt,
      listingExcerptSha256: claim.listingExcerptSha256
    };
  }));
}

function materializeCandidate(
  claims: OfficialListingCandidateClaims,
  resolved: ReturnType<typeof resolveCandidate>,
  heldForMarketplaceReview: boolean
): DecisionCandidateProjection {
  const capabilityEvidence = materializeCapabilityEvidence(claims, resolved.plugin);
  return {
    id: claims.pluginName,
    displayName: resolved.plugin.name,
    description: resolved.plugin.description,
    sourceId: "anthropic-plugins-official",
    skillPath: null,
    runtime: "claude-code",
    state: heldForMarketplaceReview ? "held" : "eligible-with-disclosures",
    stateReasons: heldForMarketplaceReview
      ? [
          "marketplace-listed",
          "official-marketplace-selection:review-required",
          "individual-safety-review:not-complete"
        ]
      : [
          "marketplace-listed",
          "individual-safety-review:not-complete",
          "revision-binding:unavailable"
        ],
    providedCapabilityIds: unique(capabilityEvidence
      .filter(({ support }) => support !== "related")
      .map(({ capabilityId }) => capabilityId)),
    capabilityEvidenceIds: capabilityEvidence.map(({ id }) => id),
    revisionBinding: "unavailable",
    permissions: { status: "unknown", evidence: [] },
    license: { status: "unknown", evidence: [] },
    trust: { status: "unknown", evidence: [] },
    dependencies: { status: "unknown", evidence: [] },
    officialBaseline: {
      reference: claims.marketplaceReference,
      marketplaceManifestSha256: resolved.baseline.provenance.manifestSha256,
      pluginName: claims.pluginName,
      sourceUrl: resolved.sourceUrl,
      sourceCommit: resolved.sourceCommit,
      sourceBlobs: []
    }
  };
}

function materializeCompatibility(
  manifest: OfficialListingClaimsManifest,
  resolved: ReturnType<typeof resolveCandidate>,
  id: string
): OfficialTargetCompatibilityEvidence {
  const attestation = manifest.compatibilityAttestation;
  const marketplaceUrl = marketplaceEntryUrl(resolved.baseline);
  const snapshotWithoutDigest = {
    id: `${resolved.plugin.name}-${attestation.id}`,
    sourceUrl: resolved.baseline.provenance.repository,
    marketplaceEntryUrl: marketplaceUrl,
    marketplaceEntrySourceUrl: resolved.sourceUrl,
    marketplaceEntrySourceCommit: resolved.sourceCommit
  };
  const snapshot = { ...snapshotWithoutDigest, digest: sha256(canonicalize(snapshotWithoutDigest)) };
  const withoutDigest: Omit<OfficialTargetCompatibilityEvidence, "evidenceDigest"> = {
    id,
    candidateId: resolved.plugin.name,
    sourceId: attestation.sourceId,
    runtime: attestation.runtime,
    platform: attestation.platform,
    compatibility: attestation.compatibility,
    kind: attestation.kind,
    observedAt: attestation.observedAt,
    reviewedAt: attestation.reviewedAt,
    expiresAt: attestation.expiresAt,
    snapshot,
    sourceUrls: unique([...attestation.sourceUrls, resolved.sourceUrl]),
    disclosures: [...attestation.disclosures]
  };
  return { ...withoutDigest, evidenceDigest: sha256(canonicalize(withoutDigest)) };
}

function uniqueCompatibilityId(
  pluginName: string,
  manifest: OfficialListingClaimsManifest,
  existing: ReadonlySet<string>
): string {
  const base = `${pluginName}-claude-code-darwin`;
  if (!existing.has(base)) return base;
  return `${base}-${manifest.compatibilityAttestation.observedAt.replace(/[^0-9]/gu, "")}`;
}

function normalizedSource(
  plugin: OfficialMarketplacePlugin,
  baseline: OfficialMarketplaceBaseline
): { sourceUrl: string; sourceCommit: string } {
  if (typeof plugin.source === "string") {
    return {
      sourceUrl: baseline.provenance.repository,
      sourceCommit: baseline.provenance.inspectedCommit
    };
  }
  if (plugin.source.source === "github") {
    return {
      sourceUrl: `https://github.com/${plugin.source.repo}.git`,
      sourceCommit: plugin.source.sha
    };
  }
  return { sourceUrl: plugin.source.url, sourceCommit: plugin.source.sha };
}

function marketplaceEntryUrl(baseline: OfficialMarketplaceBaseline): string {
  const { repository, inspectedCommit, manifestPath } = baseline.provenance;
  return `${repository}/blob/${inspectedCommit}/${manifestPath}`;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const path = error.keyword === "required"
      ? `${error.instancePath}/${String(error.params.missingProperty)}`
      : error.instancePath || "/";
    return `${path}: ${error.message ?? error.keyword}`;
  });
}

function unique<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
