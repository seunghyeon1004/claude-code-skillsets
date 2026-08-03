import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type {
  CandidateCapabilityEvidence,
  DecisionCandidateEvidenceManifest,
  DecisionCandidateProjection,
  DecisionIndex,
  DecisionIntentsManifest,
  DecisionStarterRoutesManifest
} from "../model/decision.js";
import type { DomainId } from "../model/complete-v1.js";

const require = createRequire(import.meta.url);
const decisionIndexSchema = require("../../schemas/v3/decision-index.schema.json") as object;
const decisionIntentsSchema = require("../../schemas/v3/decision-intents.schema.json") as object;
const decisionCandidateEvidenceSchema = require("../../schemas/v3/decision-candidate-evidence.schema.json") as object;
const decisionStarterRoutesSchema = require("../../schemas/v3/decision-starter-routes.schema.json") as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateDecisionIndexSchema = ajv.compile<DecisionIndex>(decisionIndexSchema);
const validateDecisionIntentsSchema = ajv.compile<DecisionIntentsManifest>(decisionIntentsSchema);
const validateDecisionCandidateEvidenceSchema = ajv.compile<DecisionCandidateEvidenceManifest>(
  decisionCandidateEvidenceSchema
);
const validateDecisionStarterRoutesSchema = ajv.compile<DecisionStarterRoutesManifest>(decisionStarterRoutesSchema);

interface ContractError {
  path: string;
  message: string;
}

export function validateDecisionIndex(value: unknown): DecisionIndex {
  return validateContract("decision index", validateDecisionIndexSchema, value, decisionIndexErrors);
}

export function validateDecisionIntents(value: unknown): DecisionIntentsManifest {
  return validateContract("decision intents", validateDecisionIntentsSchema, value, intentProfileErrors);
}

export function validateDecisionCandidateEvidence(value: unknown): DecisionCandidateEvidenceManifest {
  return validateContract(
    "decision candidate evidence",
    validateDecisionCandidateEvidenceSchema,
    value,
    candidateEvidenceErrors
  );
}

export function validateDecisionStarterRoutes(value: unknown): DecisionStarterRoutesManifest {
  return validateContract("starter routes", validateDecisionStarterRoutesSchema, value);
}

export interface DecisionStarterRoutesValidationContext {
  expectedDomainIds: readonly DomainId[];
  capabilities: readonly { id: string; ownerDomainId: DomainId }[];
  candidates: readonly DecisionCandidateProjection[];
  evidence: readonly CandidateCapabilityEvidence[];
  forbiddenCandidateIds?: readonly string[];
}

/** Authenticates route coverage against an already validated candidate/evidence graph. */
export function validateDecisionStarterRoutesSemantics(
  value: unknown,
  context: DecisionStarterRoutesValidationContext
): DecisionStarterRoutesManifest {
  const manifest = validateDecisionStarterRoutes(value);
  const errors = starterRouteSemanticErrors(manifest, context)
    .sort((left, right) => compareCodePointStrings(left.path, right.path)
      || compareCodePointStrings(left.message, right.message));
  if (errors.length > 0) {
    throw new Error(`Invalid starter routes:\n${errors.map(({ path, message }) => `${path}: ${message}`).join("\n")}`);
  }
  return manifest;
}

function starterRouteSemanticErrors(
  manifest: DecisionStarterRoutesManifest,
  context: DecisionStarterRoutesValidationContext
): ContractError[] {
  const errors: ContractError[] = [];
  const expectedDomains = new Set(context.expectedDomainIds);
  const actualDomains = new Set<string>();
  const capabilityById = new Map(context.capabilities.map((capability) => [capability.id, capability]));
  const candidateById = new Map(context.candidates.map((candidate) => [candidate.id, candidate]));
  const evidenceById = new Map(context.evidence.map((evidence) => [evidence.id, evidence]));
  const forbiddenCandidates = new Set(context.forbiddenCandidateIds ?? []);

  for (const [routeIndex, route] of manifest.routes.entries()) {
    const routePath = `/routes/${routeIndex}`;
    if (actualDomains.has(route.domainId)) {
      errors.push({ path: `${routePath}/domainId`, message: "duplicate route domain" });
    }
    actualDomains.add(route.domainId);
    if (!expectedDomains.has(route.domainId)) {
      errors.push({ path: `${routePath}/domainId`, message: "domain is not in the expected starter route set" });
    }

    const routeCapabilities = context.capabilities.filter(({ ownerDomainId }) => ownerDomainId === route.domainId);
    const routeCandidateIds = new Set(route.orderedCandidateIds);
    const contributedCapabilities = new Map(
      route.orderedCandidateIds.map((candidateId) => [candidateId, new Set<string>()])
    );
    for (const [candidateIndex, candidateId] of route.orderedCandidateIds.entries()) {
      const path = `${routePath}/orderedCandidateIds/${candidateIndex}`;
      const candidate = candidateById.get(candidateId);
      if (forbiddenCandidates.has(candidateId)) {
        errors.push({ path, message: `${candidateId} is forbidden from starter routes` });
      }
      if (candidate === undefined) {
        errors.push({ path, message: "candidate does not resolve" });
      } else if (candidate.runtime !== "claude-code" || candidate.sourceId !== "anthropic-plugins-official"
        || candidate.skillPath !== null) {
        errors.push({ path, message: "candidate must be an official Claude Code marketplace candidate" });
      } else if (candidate.state === "blocked") {
        errors.push({ path, message: "blocked candidate cannot appear in starter route discovery metadata" });
      }
    }

    const supportedCapabilityIds = new Set<string>();
    const relatedEvidence = new Map<string, { capabilityId: string; path: string }>();
    const seenEvidenceIds = new Set<string>();
    const evidenceLists = [
      { name: "directEvidenceIds", support: "direct" as const, ids: route.directEvidenceIds },
      { name: "inferredEvidenceIds", support: "inferred" as const, ids: route.inferredEvidenceIds },
      { name: "relatedEvidenceIds", support: "related" as const, ids: route.relatedEvidenceIds ?? [] }
    ];
    for (const list of evidenceLists) {
      for (const [evidenceIndex, evidenceId] of list.ids.entries()) {
        const path = `${routePath}/${list.name}/${evidenceIndex}`;
        if (seenEvidenceIds.has(evidenceId)) {
          errors.push({ path, message: "evidence ID is duplicated across route support classes" });
        }
        seenEvidenceIds.add(evidenceId);
        const evidence = evidenceById.get(evidenceId);
        if (evidence === undefined) {
          errors.push({ path, message: "evidence does not resolve" });
          continue;
        }
        const current = evidence.current;
        const supportMatches = evidence.support === list.support;
        if (!current) errors.push({ path, message: "evidence must be current" });
        if (!supportMatches) {
          errors.push({ path, message: `evidence support must be ${list.support}` });
        }
        const candidateListed = routeCandidateIds.has(evidence.candidateId);
        if (!candidateListed) {
          errors.push({ path, message: "evidence candidate is not listed by the route" });
        }
        const capability = capabilityById.get(evidence.capabilityId);
        const capabilityBelongsToRoute = capability !== undefined && capability.ownerDomainId === route.domainId;
        if (!capabilityBelongsToRoute) {
          errors.push({ path, message: "evidence capability does not belong to the route domain" });
        } else if (list.support === "related") {
          relatedEvidence.set(evidenceId, { capabilityId: evidence.capabilityId, path });
        } else {
          supportedCapabilityIds.add(evidence.capabilityId);
        }
        if (current && supportMatches && candidateListed && capabilityBelongsToRoute) {
          contributedCapabilities.get(evidence.candidateId)!.add(evidence.capabilityId);
        }
      }
    }

    const earlierCapabilities = new Set<string>();
    for (const [candidateIndex, candidateId] of route.orderedCandidateIds.entries()) {
      const candidateCapabilities = contributedCapabilities.get(candidateId)!;
      if (candidateCapabilities.size === 0) {
        errors.push({
          path: `${routePath}/orderedCandidateIds/${candidateIndex}`,
          message: "every route candidate must contribute current related or supported capability evidence"
        });
      }
      if (candidateIndex > 0 && ![...candidateCapabilities].some((capabilityId) => !earlierCapabilities.has(capabilityId))) {
        errors.push({
          path: `${routePath}/orderedCandidateIds/${candidateIndex}`,
          message: "a complement must add at least one related or supported capability not associated with earlier candidates"
        });
      }
      for (const capabilityId of candidateCapabilities) earlierCapabilities.add(capabilityId);
    }

    const unsupportedCapabilityIds = new Set<string>();
    for (const [capabilityIndex, capabilityId] of route.unsupportedCapabilityIds.entries()) {
      const path = `${routePath}/unsupportedCapabilityIds/${capabilityIndex}`;
      const capability = capabilityById.get(capabilityId);
      if (capability === undefined || capability.ownerDomainId !== route.domainId) {
        errors.push({ path, message: "unsupported capability does not belong to the route domain" });
      }
      if (supportedCapabilityIds.has(capabilityId)) {
        errors.push({ path, message: "supported and unsupported capability coverage overlaps" });
      }
      unsupportedCapabilityIds.add(capabilityId);
    }

    for (const { capabilityId, path } of relatedEvidence.values()) {
      if (!unsupportedCapabilityIds.has(capabilityId)) {
        errors.push({ path, message: "related evidence capability must be listed as unsupported" });
      }
    }

    const accountedCapabilities = new Set([...supportedCapabilityIds, ...unsupportedCapabilityIds]);
    const expectedCapabilityIds = new Set(routeCapabilities.map(({ id }) => id));
    if (!sameStringSets(accountedCapabilities, expectedCapabilityIds)) {
      errors.push({
        path: routePath,
        message: "direct, inferred, and unsupported coverage must exactly account for every domain capability"
      });
    }
  }

  for (const domainId of expectedDomains) {
    if (!actualDomains.has(domainId)) {
      errors.push({ path: "/routes", message: `missing expected domain ${domainId}` });
    }
  }
  return errors;
}

function sameStringSets(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateContract<T>(
  kind: string,
  validator: ValidateFunction<T>,
  value: unknown,
  semanticErrors: (value: unknown) => ContractError[] = () => []
): T {
  if (!validator(value)) {
    throw new Error(`Invalid ${kind}:\n${formatAjvErrors(validator.errors).join("\n")}`);
  }

  const errors = semanticErrors(value)
    .sort((left, right) => compareCodePointStrings(left.path, right.path)
      || compareCodePointStrings(left.message, right.message));
  if (errors.length > 0) {
    throw new Error(`Invalid ${kind}:\n${errors.map(({ path, message }) => `${path}: ${message}`).join("\n")}`);
  }
  return value;
}

function decisionIndexErrors(value: unknown): ContractError[] {
  if (!isRecord(value)) return [];

  const errors = [
    ...intentProfileErrors({ profiles: value.profiles }),
    ...candidateEvidenceErrors({ candidates: value.candidates, evidence: value.candidateEvidence })
  ];
  if (!Array.isArray(value.candidates) || !Array.isArray(value.candidateEvidence)) return errors;

  const candidates = new Map<string, Record<string, unknown>>();
  for (const candidate of value.candidates) {
    if (isRecord(candidate) && typeof candidate.id === "string") candidates.set(candidate.id, candidate);
  }
  for (const [index, evidence] of value.candidateEvidence.entries()) {
    if (!isRecord(evidence) || typeof evidence.candidateId !== "string" || !isRecord(evidence.candidate)) continue;
    const candidate = candidates.get(evidence.candidateId);
    if (candidate === undefined) continue;
    if (stableValue(evidence.candidate) !== stableValue(candidate)) {
      errors.push({
        path: `/candidateEvidence/${index}/candidate`,
        message: "must exactly match the candidate identified by candidateId"
      });
    }
  }
  return errors;
}

function intentProfileErrors(value: unknown): ContractError[] {
  if (!isRecord(value) || !Array.isArray(value.profiles)) return [];

  const errors: ContractError[] = [];
  const profileIds = new Map<string, number>();
  const firstOccurrence = new Map<string, string>();
  for (const [profileIndex, profile] of value.profiles.entries()) {
    if (!isRecord(profile)) continue;
    if (typeof profile.id === "string") {
      const previous = profileIds.get(profile.id);
      if (previous === undefined) {
        profileIds.set(profile.id, profileIndex);
      } else {
        errors.push({
          path: `/profiles/${profileIndex}/id`,
          message: `duplicate profile ID; first occurrence at /profiles/${previous}/id`
        });
      }
    }

    if (!isRecord(profile.phrases)) continue;
    for (const language of ["ko", "en"] as const) {
      const phrases = stringArray(profile.phrases[language]);
      const pathPrefix = `/profiles/${profileIndex}/phrases/${language}`;
      if (language === "ko" && !phrases.some((phrase) => /[\uac00-\ud7a3]/u.test(phrase))) {
        errors.push({ path: pathPrefix, message: "must include a Korean phrase" });
      }
      if (language === "en" && !phrases.some((phrase) => /[A-Za-z]/u.test(phrase))) {
        errors.push({ path: pathPrefix, message: "must include an English phrase" });
      }
      for (const [phraseIndex, phrase] of phrases.entries()) {
        const normalized = normalizePhrase(phrase);
        const path = `${pathPrefix}/${phraseIndex}`;
        if (normalized.length === 0) {
          errors.push({ path, message: "must contain a normalized phrase" });
          continue;
        }
        const previous = firstOccurrence.get(normalized);
        if (previous !== undefined) {
          errors.push({ path, message: `duplicate normalized phrase; first occurrence at ${previous}` });
        } else {
          firstOccurrence.set(normalized, path);
        }
      }
    }
  }
  return errors;
}

function candidateEvidenceErrors(value: unknown): ContractError[] {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !Array.isArray(value.evidence)) {
    return [];
  }

  const errors: ContractError[] = [];
  const candidates = new Map<string, { index: number; value: Record<string, unknown> }>();
  const graphCandidates = new Map<string, {
    path: string;
    value: Record<string, unknown>;
    candidateId: string;
    candidateRevisionId?: string;
  }>();
  const evidenceById = new Map<string, { index: number; value: Record<string, unknown> }>();

  for (const [index, candidate] of value.candidates.entries()) {
    if (!isRecord(candidate) || typeof candidate.id !== "string") continue;
    const previous = candidates.get(candidate.id);
    if (previous === undefined) {
      candidates.set(candidate.id, { index, value: candidate });
      const candidateRevisionId = typeof candidate.candidateRevisionId === "string"
        ? candidate.candidateRevisionId
        : undefined;
      graphCandidates.set(candidateGraphKey(candidate.id, candidateRevisionId), {
        path: `/candidates/${index}`,
        value: candidate,
        candidateId: candidate.id,
        ...(candidateRevisionId === undefined ? {} : { candidateRevisionId })
      });
    } else {
      errors.push({
        path: `/candidates/${index}/id`,
        message: `duplicate candidate ID; first occurrence at /candidates/${previous.index}/id`
      });
    }
  }

  if (Array.isArray(value.candidateRevisions)) {
    const revisionIds = new Set<string>();
    for (const [index, revision] of value.candidateRevisions.entries()) {
      if (!isRecord(revision) || typeof revision.id !== "string" || typeof revision.candidateId !== "string"
        || !isRecord(revision.candidate)) continue;
      if (revisionIds.has(revision.id)) {
        errors.push({ path: `/candidateRevisions/${index}/id`, message: "duplicate candidate revision ID" });
      }
      revisionIds.add(revision.id);
      if (!candidates.has(revision.candidateId)) {
        errors.push({ path: `/candidateRevisions/${index}/candidateId`, message: "must resolve to a base candidate" });
      }
      if (revision.candidate.id !== revision.candidateId || revision.candidate.candidateRevisionId !== revision.id) {
        errors.push({
          path: `/candidateRevisions/${index}/candidate`,
          message: "candidate id and candidateRevisionId must match the revision"
        });
      }
      const key = candidateGraphKey(revision.candidateId, revision.id);
      graphCandidates.set(key, {
        path: `/candidateRevisions/${index}/candidate`,
        value: revision.candidate,
        candidateId: revision.candidateId,
        candidateRevisionId: revision.id
      });
    }
  }

  for (const [index, evidence] of value.evidence.entries()) {
    if (!isRecord(evidence) || typeof evidence.id !== "string") continue;
    const previous = evidenceById.get(evidence.id);
    if (previous === undefined) {
      evidenceById.set(evidence.id, { index, value: evidence });
    } else {
      errors.push({
        path: `/evidence/${index}/id`,
        message: `duplicate evidence ID; first occurrence at /evidence/${previous.index}/id`
      });
    }
    if (typeof evidence.candidateId === "string") {
      const revisionId = typeof evidence.candidateRevisionId === "string" ? evidence.candidateRevisionId : undefined;
      if (!graphCandidates.has(candidateGraphKey(evidence.candidateId, revisionId))) {
        errors.push({ path: `/evidence/${index}/candidateId`, message: "must resolve to the exact candidate revision" });
      }
    }
  }

  for (const [candidateId, candidate] of candidates) {
    if (!isRecord(candidate.value.claudeInstall)) continue;
    const install = candidate.value.claudeInstall;
    const path = `/candidates/${candidate.index}/claudeInstall`;
    if (candidate.value.runtime !== "claude-code" || candidate.value.skillPath !== null) {
      errors.push({ path, message: "requires a Claude Code marketplace candidate without a skill path" });
    }
    if (install.sourceId !== candidate.value.sourceId) {
      errors.push({ path: `${path}/sourceId`, message: "must exactly match the candidate sourceId" });
    }
    if (install.pluginName !== candidateId) {
      errors.push({ path: `${path}/pluginName`, message: "must exactly match the candidate ID" });
    }
    if (Array.isArray(install.argv)
      && install.pluginName === candidateId
      && typeof install.marketplaceId === "string"
      && install.argv[3] !== `${install.pluginName}@${install.marketplaceId}`) {
      errors.push({ path: `${path}/argv/3`, message: "must bind the exact plugin and marketplace identity" });
    }
  }

  const currentCoverageCapabilitiesByCandidate = new Map<string, Set<string>>();
  for (const [candidateKey, candidate] of graphCandidates) {
    const providedCapabilityIds = stringArray(candidate.value.providedCapabilityIds);
    const capabilityEvidenceIds = stringArray(candidate.value.capabilityEvidenceIds);
    const evidenceByCapability = new Map<string, Record<string, unknown>[]>();

    for (const [evidenceIndex, evidenceId] of capabilityEvidenceIds.entries()) {
      const evidence = evidenceById.get(evidenceId);
      const path = `${candidate.path}/capabilityEvidenceIds/${evidenceIndex}`;
      if (evidence === undefined) {
        errors.push({ path, message: "must resolve to evidence" });
        continue;
      }
      if (evidence.value.candidateId !== candidate.candidateId
        || evidence.value.candidateRevisionId !== candidate.candidateRevisionId) {
        errors.push({ path, message: "must identify the same candidate" });
        continue;
      }
      if (typeof evidence.value.capabilityId === "string") {
        const matches = evidenceByCapability.get(evidence.value.capabilityId) ?? [];
        matches.push(evidence.value);
        evidenceByCapability.set(evidence.value.capabilityId, matches);
      }
    }

    const currentCoverageCapabilityIds = new Set(
      [...evidenceByCapability.entries()]
        .filter(([, matches]) => matches.some(isCurrentCoverageEvidence))
        .map(([capabilityId]) => capabilityId)
    );
    currentCoverageCapabilitiesByCandidate.set(candidateKey, currentCoverageCapabilityIds);

    for (const [capabilityIndex, capabilityId] of providedCapabilityIds.entries()) {
      if (!currentCoverageCapabilityIds.has(capabilityId)) {
        errors.push({
          path: `${candidate.path}/providedCapabilityIds/${capabilityIndex}`,
          message: "must have current capability evidence that is non-related"
        });
      }
    }
  }

  for (const [evidenceId, evidence] of evidenceById) {
    const candidate = typeof evidence.value.candidateId === "string"
      ? graphCandidates.get(candidateGraphKey(
          evidence.value.candidateId,
          typeof evidence.value.candidateRevisionId === "string" ? evidence.value.candidateRevisionId : undefined
        ))
      : undefined;
    if (candidate === undefined) continue;
    const path = `/evidence/${evidence.index}`;
    if (!stringArray(candidate.value.capabilityEvidenceIds).includes(evidenceId)) {
      errors.push({ path: `${path}/id`, message: "must be referenced by its candidate" });
    }
    if (typeof evidence.value.capabilityId === "string") {
      const providedCapabilityIds = stringArray(candidate.value.providedCapabilityIds);
      const provided = providedCapabilityIds.includes(evidence.value.capabilityId);
      const hasCurrentCoverageEvidence = currentCoverageCapabilitiesByCandidate
        .get(candidateGraphKey(
          String(evidence.value.candidateId),
          typeof evidence.value.candidateRevisionId === "string" ? evidence.value.candidateRevisionId : undefined
        ))
        ?.has(evidence.value.capabilityId) ?? false;
      if (evidence.value.support === "related") {
        if (provided && !hasCurrentCoverageEvidence) {
          errors.push({
            path: `${path}/capabilityId`,
            message: "related evidence must not provide a capability without separate current direct or inferred evidence"
          });
        }
      } else if (!provided) {
        errors.push({ path: `${path}/capabilityId`, message: "must be provided by its candidate" });
      }
    }
  }

  return errors;
}

function candidateGraphKey(candidateId: string, candidateRevisionId?: string): string {
  return `${candidateId}\u0000${candidateRevisionId ?? ""}`;
}

function isCurrentCoverageEvidence(evidence: Record<string, unknown>): boolean {
  return evidence.current === true
    && (evidence.support === "direct" || evidence.support === "inferred");
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? [])
    .slice()
    .sort((left, right) => compareCodePointStrings(errorPath(left), errorPath(right))
      || compareCodePointStrings(left.keyword, right.keyword))
    .map((error) => `${errorPath(error)}: ${error.message ?? error.keyword}`);
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

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareCodePointStrings)
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return leftCharacters.length === rightCharacters.length
    ? 0
    : (leftCharacters.length < rightCharacters.length ? -1 : 1);
}
