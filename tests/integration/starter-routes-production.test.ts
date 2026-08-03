import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMPLETE_V1_DOMAIN_IDS } from "../../src/model/complete-v1.js";
import { loadDecisionManifests } from "../../src/decision/repository.js";
import { generateDecisionIndex } from "../../src/generate/decision-index.js";
import type { DecisionIndex } from "../../src/model/decision.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const expectedCandidateSets = [
  ["research-and-intelligence", []],
  ["strategy-and-decision", []],
  ["writing-and-publishing", ["mintlify"]],
  ["marketing-and-growth", ["windsor-ai"]],
  ["promotion-and-distribution", ["postiz"]],
  ["sales-and-customer", ["apollo", "monday-crm"]],
  ["product-management", []],
  ["project-management", []],
  ["software-engineering", []],
  ["devops-and-security", ["aws-agents-for-devsecops", "buildkite"]],
  ["ai-agents-and-automation", ["aws-agents"]],
  ["data-and-analytics", ["atlan"]],
  ["design-and-brand", ["canva"]],
  ["video-and-audio", ["runway-api"]],
  ["documents-and-knowledge", ["notion", "carbone-skill"]],
  ["business-operations", ["airtable", "zapier"]],
  ["finance-and-accounting", ["airwallex-agentos"]],
  ["commerce", ["windsor-ai"]],
  ["people-and-training", ["learn-with-coursera"]],
  ["legal-risk-and-compliance", ["legalzoom"]]
] as const;

describe("production starter routes", () => {
  it("authenticates every Complete v1 domain in order with the reviewed official candidates", async () => {
    const repository = await loadDecisionManifests(projectRoot);
    const index = JSON.parse(await generateDecisionIndex(projectRoot)) as DecisionIndex;
    const routes = repository.starterRoutes!;

    expect(routes.map(({ domainId }) => domainId)).toEqual(COMPLETE_V1_DOMAIN_IDS);
    expect(index.candidates).toHaveLength(35);
    expect(index.candidates.every(({ state }) => state === "held")).toBe(true);
    expect(index.candidates.every(({ claudeInstall }) => claudeInstall === undefined)).toBe(true);
    expect(routes.map(({ domainId, orderedCandidateIds }) => [domainId, orderedCandidateIds]))
      .toEqual(expectedCandidateSets);
    expect(routes.every(({ broadCoverageComplete }) => broadCoverageComplete === false)).toBe(true);
    expect(routes.flatMap(({ orderedCandidateIds }) => orderedCandidateIds)).not.toContain("shopify-ai-toolkit");
    expect(routes.flatMap(({ orderedCandidateIds }) => orderedCandidateIds)).not.toContain("mlflow");
  });

  it("keeps related evidence outside supported candidate coverage", async () => {
    const repository = await loadDecisionManifests(projectRoot);
    const routes = repository.starterRoutes!;
    const evidenceById = new Map(repository.candidateEvidence.map((evidence) => [evidence.id, evidence]));
    const directEvidenceIds = routes.flatMap(({ directEvidenceIds }) => directEvidenceIds);
    const inferredEvidenceIds = routes.flatMap(({ inferredEvidenceIds }) => inferredEvidenceIds);
    const relatedEvidenceIds = routes.flatMap(({ relatedEvidenceIds = [] }) => relatedEvidenceIds);

    expect(directEvidenceIds).toHaveLength(1);
    expect(inferredEvidenceIds).toHaveLength(2);
    expect(relatedEvidenceIds).toHaveLength(31);
    expect(directEvidenceIds.every((id) => evidenceById.get(id)?.support === "direct")).toBe(true);
    expect(inferredEvidenceIds.every((id) => evidenceById.get(id)?.support === "inferred")).toBe(true);
    expect(relatedEvidenceIds.every((id) => evidenceById.get(id)?.support === "related")).toBe(true);
    expect(relatedEvidenceIds).not.toContain("mlflow-evaluate-guard-and-monitor-ai-systems");
    for (const id of relatedEvidenceIds) {
      const evidence = evidenceById.get(id)!;
      expect(evidence.candidate.providedCapabilityIds).not.toContain(evidence.capabilityId);
    }
  });

  it("keeps generated and installed decision indexes byte-identical to the authenticated routes", async () => {
    const [generated, tracked, installed] = await Promise.all([
      generateDecisionIndex(projectRoot),
      readFile(join(projectRoot, "generated", "decision-index.json"), "utf8"),
      readFile(join(projectRoot, "plugins", "skillset-manager", "data", "decision-index.json"), "utf8")
    ]);

    expect(generated).toBe(tracked);
    expect(tracked).toBe(installed);
  });
});
