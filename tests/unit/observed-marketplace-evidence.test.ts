import { describe, expect, it } from "vitest";

import { validateResearchEvidence } from "../../src/contracts/complete-v1.js";
import { validateObservedMarketplaceEvidenceBinding } from "../../src/research/observed-marketplace-evidence.js";

describe("observed marketplace research evidence", () => {
  it("accepts the v3 variant and binds it to one exact validated selection artifact", () => {
    const evidence = observedMarketplaceEvidence();

    expect(validateResearchEvidence(evidence)).toEqual(evidence);
    expect(validateObservedMarketplaceEvidenceBinding(evidence, {
      observationEvidence: [{
        id: "official-marketplace-observation",
        sourceId: "anthropic-plugins-official",
        observedAt: "2026-08-03T00:00:00Z",
        inspectedCommit: "a".repeat(40)
      }],
      sourceRepositoryById: {
        "anthropic-plugins-official": "https://github.com/anthropics/claude-plugins-official"
      },
      artifactSha256ByPath: {
        "claude-plugins-official-new.json": "b".repeat(64)
      },
      marketplaceArtifactsByPath: {
        "claude-plugins-official-new.json": {
          repository: "https://github.com/anthropics/claude-plugins-official",
          inspectedCommit: "a".repeat(40)
        }
      }
    })).toBeUndefined();
  });

  it.each([
    ["observation ID", (value: ReturnType<typeof observedMarketplaceEvidence>) => { value.observationEvidenceId = "wrong"; }],
    ["artifact path", (value: ReturnType<typeof observedMarketplaceEvidence>) => { value.observedArtifactPath = "research/marketplaces/wrong.json"; }],
    ["artifact SHA", (value: ReturnType<typeof observedMarketplaceEvidence>) => { value.observedArtifactSha256 = "c".repeat(64); }],
    ["marketplace commit", (value: ReturnType<typeof observedMarketplaceEvidence>) => { value.reviewedCommit = "d".repeat(40); }]
  ])("rejects a mismatched %s", (_label, mutate) => {
    const evidence = observedMarketplaceEvidence();
    mutate(evidence);

    expect(() => validateObservedMarketplaceEvidenceBinding(evidence, {
      observationEvidence: [{
        id: "official-marketplace-observation",
        sourceId: "anthropic-plugins-official",
        observedAt: "2026-08-03T00:00:00Z",
        inspectedCommit: "a".repeat(40)
      }],
      sourceRepositoryById: {
        "anthropic-plugins-official": "https://github.com/anthropics/claude-plugins-official"
      },
      artifactSha256ByPath: {
        "claude-plugins-official-new.json": "b".repeat(64)
      },
      marketplaceArtifactsByPath: {
        "claude-plugins-official-new.json": {
          repository: "https://github.com/anthropics/claude-plugins-official",
          inspectedCommit: "a".repeat(40)
        }
      }
    })).toThrow(/observation|artifact|commit|selection/i);
  });
});

function observedMarketplaceEvidence() {
  return {
    schemaVersion: 3 as const,
    id: "shopify-observed-marketplace-binding",
    reviewId: "shopify-rebind-review",
    providerId: "anthropic-plugins-official",
    kind: "marketplace-identity" as const,
    observationEvidenceId: "official-marketplace-observation",
    reviewedCommit: "a".repeat(40),
    observedArtifactPath: "research/marketplaces/claude-plugins-official-new.json",
    observedArtifactSha256: "b".repeat(64),
    scope: { runtime: null, platform: null, capabilityId: null },
    observedAt: "2026-08-03T00:00:00Z",
    artifactPath: "research/evidence/artifacts/shopify-new.json",
    artifactSha256: "e".repeat(64),
    outcome: "passed" as const,
    summary: "Exact source identity observation; no install authority."
  };
}
