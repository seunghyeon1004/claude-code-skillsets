import { describe, expect, it } from "vitest";

import { COMPLETE_V1_DOMAIN_IDS } from "../../src/model/complete-v1.js";
import {
  OFFICIAL_MARKETPLACE_COMMIT,
  OFFICIAL_MARKETPLACE_ID,
  loadOfficialMarketplaceBaseline,
  officialMarketplaceRecommendations,
  validateOfficialMarketplaceArtifact,
} from "../../src/discovery/official-marketplace.js";

describe("official marketplace baseline", () => {
  it("loads the pinned 272-entry manifest with fail-closed source accounting", () => {
    const baseline = loadOfficialMarketplaceBaseline();

    expect(baseline.marketplace).toBe(OFFICIAL_MARKETPLACE_ID);
    expect(baseline.provenance.inspectedCommit).toBe(OFFICIAL_MARKETPLACE_COMMIT);
    expect(baseline.provenance.manifestSha256).toBe(
      "64b111d8c1716c062a285ed63eade42f56e2e79ac95859a994d586f573a20e5e",
    );
    expect(baseline.plugins).toHaveLength(272);
    expect(new Set(baseline.plugins.map((plugin) => plugin.name))).toHaveLength(272);
    expect(baseline.plugins.every((plugin) => plugin.description.trim().length > 0)).toBe(true);

    const external = baseline.plugins.filter((plugin) => plugin.sourcePin.kind === "external-sha");
    const relative = baseline.plugins.filter(
      (plugin) => plugin.sourcePin.kind === "marketplace-commit",
    );

    expect(external).toHaveLength(219);
    expect(relative).toHaveLength(53);
    expect(external.every((plugin) => /^[0-9a-f]{40}$/.test(plugin.sourcePin.sha))).toBe(true);
    expect(relative.every((plugin) => plugin.sourcePin.sha === OFFICIAL_MARKETPLACE_COMMIT)).toBe(
      true,
    );
  });

  it.each([
    ["duplicate plugin", (artifact: Record<string, unknown>) => {
      const plugins = artifact.plugins as Array<Record<string, unknown>>;
      plugins[1]!.name = plugins[0]!.name;
    }],
    ["blank description", (artifact: Record<string, unknown>) => {
      const plugins = artifact.plugins as Array<Record<string, unknown>>;
      plugins[0]!.description = " ";
    }],
    ["unpinned external source", (artifact: Record<string, unknown>) => {
      const plugins = artifact.plugins as Array<Record<string, unknown>>;
      const external = plugins.find((plugin) => typeof plugin.source === "object");
      (external!.source as Record<string, unknown>).sha = "main";
    }],
    ["escaping relative source", (artifact: Record<string, unknown>) => {
      const plugins = artifact.plugins as Array<Record<string, unknown>>;
      const relative = plugins.find((plugin) => typeof plugin.source === "string");
      relative!.source = "../escape";
    }],
    ["drifted provenance", (artifact: Record<string, unknown>) => {
      (artifact.provenance as Record<string, unknown>).inspectedCommit = "f".repeat(40);
    }],
  ])("rejects %s", (_label, mutate) => {
    const artifact = structuredClone(loadOfficialMarketplaceBaseline()) as unknown as Record<
      string,
      unknown
    >;
    mutate(artifact);

    expect(() => validateOfficialMarketplaceArtifact(artifact)).toThrow();
  });
});

describe("official marketplace recommendations", () => {
  it("covers every Complete v1 domain with curated marketplace listings and source-pin evidence", () => {
    const recommendations = officialMarketplaceRecommendations();

    expect(Object.keys(recommendations).sort()).toEqual([...COMPLETE_V1_DOMAIN_IDS].sort());

    const assignments = COMPLETE_V1_DOMAIN_IDS.flatMap((domainId) => {
      const candidates = recommendations[domainId];
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      expect(candidates.length).toBeLessThanOrEqual(3);

      for (const candidate of candidates) {
        expect(candidate.listingStatus).toBe("marketplace-listed");
        expect(candidate.individualSafetyReview).toBe("not-complete");
        expect(candidate.classificationRoutes.length).toBeGreaterThan(0);
        expect(["external-sha", "marketplace-commit"]).toContain(candidate.sourcePin.kind);
      }

      return candidates.map((candidate) => candidate.name);
    });

    const allRoutes = COMPLETE_V1_DOMAIN_IDS.flatMap((domainId) =>
      recommendations[domainId].flatMap((candidate) =>
        candidate.classificationRoutes.map((route) => route.kind),
      ),
    );
    expect(allRoutes).toContain("name-description-rule");
    expect(allRoutes).toContain("curated-override");
    expect(new Set(assignments).size).toBeLessThan(assignments.length);
    expect(recommendations["software-engineering"].map(({ name }) => name)).toEqual([
      "feature-dev",
      "superpowers"
    ]);
  });
});
