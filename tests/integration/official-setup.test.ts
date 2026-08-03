import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionIndexDigest } from "../../src/decision/index-loader.js";
import * as decisionIndexLoader from "../../src/decision/index-loader.js";
import { evaluateSetupDecisionFixture } from "../../src/evaluate/setup.js";
import { createApprovedOfficialDecisionIndexSetFixture } from "../helpers/official-marketplace-fixture.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const skillPath = join(projectRoot, "plugins", "skillset-manager", "skills", "setup", "SKILL.md");
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("official decision-plan setup path", () => {
  it("shows delegated official uncertainty without converting it into a trust claim", async () => {
    const content = await readFile(skillPath, "utf8");

    expect(content).toContain("individualSafetyReview: not-complete");
    expect(content).toContain("revisionBinding: unavailable");
    expect(content).toMatch(/print `unknown` without guessing/i);
    expect(content).toMatch(/not proof of an installed revision/i);
    expect(content).toMatch(/does not guarantee safety, trust, capability quality,[\s\S]*an exact reviewed revision/i);
    expect(content).toMatch(/telemetry, Node\/Bash execution behavior, store[\s\S]*secret-flow behavior remain `unknown`/i);
    expect(content).toMatch(/do not describe them[\s\S]*safe, disabled, reviewed, or absent/i);
  });

  it("binds an exact observed marketplace identity and only records a receipt after success", async () => {
    const content = await readFile(skillPath, "utf8");

    expect(content).toMatch(/exact `\{id, source\}` marketplace identity/i);
    expect(content).toMatch(/same ID with another source is a hard failure/i);
    expect(content).toMatch(/After every successful managed install/i);
    expect(content).toMatch(/decisionPlanDigest.*pluginName.*marketplaceId.*marketplaceSource.*scope.*preInstallVersion.*postInstallVersion.*versionStatus.*observedAt.*installCommandDigest/is);
    expect(content).toMatch(/successful receipt means only[\s\S]*exact plugin identity[\s\S]*observed enabled/i);
  });

  it("runs the real starter-partial Darwin plan through separate approval and receipt integration", async () => {
    const index = await isolatedApprovedIndex();
    const input = {
      language: "ko" as const,
      goal: "시장 조사하고 근거를 검증하고 싶어",
      platform: "darwin" as const,
      timeProbe: { consent: "granted" as const, utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    };
    const awaitingApproval = await evaluateSetupDecisionFixture(index, input);

    expect(awaitingApproval).toMatchObject({
      status: "awaiting-approval",
      decisionPlan: {
        status: "eligible-with-disclosures",
        planKind: "starter-partial",
        primary: { id: "exa" },
        complement: null,
        coverageIncomplete: true,
        uncoveredCapabilityIds: expect.arrayContaining([
          "verify-sources-and-claims",
          "synthesize-cited-evidence"
        ])
      }
    });
    const previewCandidate = awaitingApproval.approvalBinding.preview.candidates.find(
      ({ candidateId }) => candidateId === "exa"
    );
    if (previewCandidate === undefined) throw new Error("Expected exa preview candidate");
    expect(previewCandidate.capabilities).toEqual(expect.arrayContaining([
      {
        capabilityId: "verify-sources-and-claims",
        evidenceId: "exa-source-verification",
        support: "related"
      }
    ]));
    expect(awaitingApproval.approvalBinding.preview.riskDisclosures).toContain(
      "capability-relevance-only:not-supported"
    );

    const directlySupportedIndex = structuredClone(index);
    const directlySupportedExa = directlySupportedIndex.candidates.find(({ id }) => id === "exa");
    if (directlySupportedExa === undefined) throw new Error("Expected exa candidate in drift fixture");
    directlySupportedExa.providedCapabilityIds.push("verify-sources-and-claims");
    for (const evidence of directlySupportedIndex.candidateEvidence.filter(({ candidateId }) => candidateId === "exa")) {
      evidence.candidate = structuredClone(directlySupportedExa);
      if (evidence.id === "exa-source-verification") evidence.support = "direct";
    }
    const { digest: _digest, ...withoutDigest } = directlySupportedIndex;
    directlySupportedIndex.digest = decisionIndexDigest(withoutDigest);
    const stale = await evaluateSetupDecisionFixture(directlySupportedIndex, {
      ...input,
      approval: awaitingApproval.approvalBinding
    });
    expect(stale).toMatchObject({ status: "awaiting-approval", approvalValid: false });
    const staleExa = stale.approvalBinding.preview.candidates.find(({ candidateId }) => candidateId === "exa");
    if (staleExa === undefined) throw new Error("Expected stale exa preview candidate");
    expect(staleExa.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capabilityId: "verify-sources-and-claims",
        support: "direct"
      })
    ]));
    expect(stale.approvalBinding.preview.riskDisclosures).toContain(
      "capability-relevance-only:not-supported"
    );

    const executed = await evaluateSetupDecisionFixture(index, {
      ...input,
      approval: awaitingApproval.approvalBinding,
      execution: {
        candidates: [{
          marketplaceBeforeStdout: JSON.stringify([{
            name: "claude-plugins-official",
            source: "github",
            repo: "anthropics/claude-plugins-official",
            installLocation: "/Users/example/.claude/plugins/marketplaces/claude-plugins-official"
          }]),
          cliVersionBeforeStdout: "2.1.198 (Claude Code)\n",
          installInvocation: { argv: previewCandidate.installArgv, status: "success" },
          pluginListAfterStdout: JSON.stringify([{
            id: `${previewCandidate.pluginName}@${previewCandidate.marketplaceId}`,
            version: "1.0.0",
            scope: "user",
            enabled: true
          }]),
          cliVersionAfterStdout: "2.1.198 (Claude Code)\n"
        }]
      }
    });

    expect(executed).toMatchObject({
      status: "executed",
      executionStatus: "executed",
      installReceipts: [expect.objectContaining({
        pluginName: "exa",
        marketplaceId: "claude-plugins-official",
        marketplaceSource: "anthropics/claude-plugins-official",
        preInstallVersion: null,
        postInstallVersion: "1.0.0",
        versionStatus: "observed-semver",
        decisionPlanDigest: awaitingApproval.approvalBinding.previewDigest
      })]
    });
  });

  it("preserves marketplace relevance without presenting it as supported coverage", async () => {
    const index = structuredClone(await isolatedApprovedIndex());
    const candidate = index.candidates.find(({ id }) => id === "exa")!;
    const relatedEvidenceId = "exa-academic-research-relevance";
    candidate.capabilityEvidenceIds.push(relatedEvidenceId);
    for (const evidence of index.candidateEvidence.filter((item) => item.candidateId === candidate.id)) {
      evidence.candidate = structuredClone(candidate);
    }
    const template = index.candidateEvidence.find(({ id }) => id === "exa-source-verification")!;
    index.candidateEvidence.push({
      ...structuredClone(template),
      id: relatedEvidenceId,
      capabilityId: "academic-evidence-research",
      support: "related",
      candidate: structuredClone(candidate)
    });
    const { digest: _digest, ...withoutDigest } = index;
    index.digest = decisionIndexDigest(withoutDigest);

    const result = await evaluateSetupDecisionFixture(index, {
      language: "ko",
      goal: "시장 조사하고 근거를 검증하고 싶어",
      platform: "darwin",
      timeProbe: { consent: "granted", utcTimestamp: index.observedThrough },
      riskAcknowledged: true
    });

    expect(result.decisionPlan).toMatchObject({
      status: "eligible-with-disclosures",
      planKind: "starter-partial",
      coverageIncomplete: true,
      uncoveredCapabilityIds: expect.arrayContaining(["academic-evidence-research"])
    });
    const resultExa = result.approvalBinding.preview.candidates.find(({ candidateId }) => candidateId === "exa");
    if (resultExa === undefined) throw new Error("Expected related-evidence exa preview candidate");
    expect(resultExa.capabilities).toContainEqual({
      capabilityId: "academic-evidence-research",
      evidenceId: relatedEvidenceId,
      support: "related"
    });
    expect(result.approvalBinding.preview.riskDisclosures).toContain(
      "capability-relevance-only:not-supported"
    );
  });
});

async function isolatedApprovedIndex() {
  const fixture = await createApprovedOfficialDecisionIndexSetFixture(projectRoot);
  temporaryRoots.push(fixture.root);
  vi.spyOn(decisionIndexLoader, "isAuthenticatedDecisionIndex")
    .mockImplementation((value) => value === fixture.index);
  vi.spyOn(decisionIndexLoader, "loadInstalledDecisionIndexSet").mockResolvedValue(fixture.indexSet);
  return fixture.index;
}
