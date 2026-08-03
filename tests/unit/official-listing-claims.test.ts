import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  materializeOfficialListingClaims,
  validateOfficialListingClaims
} from "../../src/decision/official-listing-claims.js";
import { validateDecisionCandidateEvidence } from "../../src/contracts/decision.js";
import {
  loadOfficialMarketplaceBaseline,
  type OfficialMarketplaceBaseline,
  type OfficialMarketplacePlugin
} from "../../src/discovery/official-marketplace.js";
import type {
  DecisionCandidateEvidenceManifest,
  OfficialListingClaimsManifest
} from "../../src/model/decision.js";

const catalogEpoch = "2026-07-29T00:00:00Z";
const capabilityOwnership = new Map([
  ["source-discovery-and-web-research", "research-and-intelligence"],
  ["synthesize-cited-evidence", "research-and-intelligence"],
  ["operate-stores-and-marketplaces", "commerce"]
] as const);

function validateClaims(manifest: OfficialListingClaimsManifest): OfficialListingClaimsManifest {
  return validateOfficialListingClaims(manifest, { capabilityOwnership, catalogEpoch });
}

describe("official listing capability claims", () => {
  it("materializes an eligible official candidate from a pinned listing with unknown sensitive fields", () => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = validManifest(baseline, "exa", {
      capabilityId: "source-discovery-and-web-research",
      excerpt: "web search, deep research, and content extraction"
    });

    const result = materializeOfficialListingClaims({
      manifest: validateClaims(manifest),
      baseline,
      existing: emptyEvidenceManifest()
    });

    expect(result.candidates).toEqual([expect.objectContaining({
      id: "exa",
      displayName: "exa",
      state: "eligible-with-disclosures",
      stateReasons: [
        "marketplace-listed",
        "individual-safety-review:not-complete",
        "revision-binding:unavailable"
      ],
      permissions: { status: "unknown", evidence: [] },
      license: { status: "unknown", evidence: [] },
      trust: { status: "unknown", evidence: [] },
      dependencies: { status: "unknown", evidence: [] },
      officialBaseline: expect.objectContaining({
        pluginName: "exa",
        sourceUrl: "https://github.com/exa-labs/exa-mcp-server.git",
        sourceCommit: "685aaa990c120a1e009fbbb8bc809128cedc957a",
        sourceBlobs: []
      })
    })]);
    expect(result.evidence).toEqual([expect.objectContaining({
      id: "exa-web-research",
      candidateId: "exa",
      capabilityId: "source-discovery-and-web-research",
      kind: "official-listing",
      current: true,
      reference: "research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/97/description",
      contentSha256: sha256(pluginByName(baseline, "exa").description),
      listingExcerpt: "web search, deep research, and content extraction",
      listingExcerptSha256: sha256("web search, deep research, and content extraction"),
      support: "direct"
    })]);
    expect(result.officialTargetCompatibilityEvidence).toEqual([
      expect.objectContaining({
        id: "exa-claude-code-darwin",
        candidateId: "exa",
        sourceId: "anthropic-plugins-official",
        runtime: "claude-code",
        platform: "darwin",
        compatibility: "verified",
        kind: "official-source-bound-inference",
        snapshot: expect.objectContaining({
          marketplaceEntrySourceUrl: "https://github.com/exa-labs/exa-mcp-server.git",
          marketplaceEntrySourceCommit: "685aaa990c120a1e009fbbb8bc809128cedc957a"
        })
      })
    ]);
  });

  it.each([
    ["pointer", (manifest: OfficialListingClaimsManifest) => {
      manifest.candidates[0]!.marketplaceReference =
        "research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/96";
    }, /reference|pointer/i],
    ["listing excerpt", (manifest: OfficialListingClaimsManifest) => {
      const claim = manifest.candidates[0]!.assignments[0]!.capabilityClaims[0]!;
      claim.listingExcerpt = "fabricated capability claim";
      claim.listingExcerptSha256 = sha256(claim.listingExcerpt);
    }, /excerpt/i],
    ["listing excerpt hash", (manifest: OfficialListingClaimsManifest) => {
      manifest.candidates[0]!.assignments[0]!.capabilityClaims[0]!.listingExcerptSha256 = "0".repeat(64);
    }, /excerpt.*sha|sha.*excerpt/i],
    ["source pin", (manifest: OfficialListingClaimsManifest) => {
      manifest.candidates[0]!.sourcePin.sha = "0".repeat(40);
    }, /source pin/i]
  ] as const)("rejects a tampered %s", (_label, mutate, expected) => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = validManifest(baseline, "exa", {
      capabilityId: "source-discovery-and-web-research",
      excerpt: "web search, deep research, and content extraction"
    });
    mutate(manifest);

    expect(() => materializeOfficialListingClaims({
      manifest: validateClaims(manifest),
      baseline,
      existing: emptyEvidenceManifest()
    })).toThrow(expected);
  });

  it.each([
    ["one-character excerpt", "a"],
    ["partial-token excerpt", "sea"]
  ] as const)("rejects a %s even when it occurs in the pinned description", (_label, excerpt) => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = validManifest(baseline, "exa", {
      capabilityId: "source-discovery-and-web-research",
      excerpt
    });

    expect(() => materializeOfficialListingClaims({
      manifest: validateClaims(manifest),
      baseline,
      existing: emptyEvidenceManifest()
    })).toThrow(/listingExcerpt|excerpt.*boundary|excerpt.*short|listing excerpt/i);
  });

  it("preserves a boundary-matched two-letter official acronym", () => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = validManifest(baseline, "shopify-ai-toolkit", {
      capabilityId: "operate-stores-and-marketplaces",
      excerpt: "AI"
    });

    const result = materializeOfficialListingClaims({
      manifest: validateClaims(manifest),
      baseline,
      existing: emptyEvidenceManifest()
    });

    expect(result.evidence[0]?.listingExcerpt).toBe("AI");
  });

  it.each([
    ["unknown capability", "missing-capability", "research-and-intelligence"],
    ["wrong owner domain", "source-discovery-and-web-research", "software-engineering"]
  ] as const)("rejects an assignment with an %s", (_label, capabilityId, domainId) => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = validManifest(baseline, "exa", {
      capabilityId,
      excerpt: "web search"
    });
    manifest.candidates[0]!.assignments[0]!.domainId = domainId;
    expect(() => validateClaims(manifest)).toThrow(/capability|domain/i);
  });

  it("keeps an existing Shopify deep-evidence hold instead of promoting the compact listing", () => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = validManifest(baseline, "shopify-ai-toolkit", {
      capabilityId: "operate-stores-and-marketplaces",
      excerpt: "store management via CLI"
    });
    const held = heldShopifyOverride(baseline);

    const result = materializeOfficialListingClaims({
      manifest: validateClaims(manifest),
      baseline,
      existing: held
    });

    expect(result.candidates).toEqual(held.candidates);
    expect(result.evidence).toEqual(held.evidence);
    expect(result.officialTargetCompatibilityEvidence).toEqual([
      expect.objectContaining({
        id: "shopify-ai-toolkit-claude-code-darwin",
        candidateId: "shopify-ai-toolkit"
      })
    ]);
    expect(result.candidates[0]).toMatchObject({
      id: "shopify-ai-toolkit",
      state: "held",
      stateReasons: ["marketplace-listed", "privacy-telemetry-review:not-complete"],
      permissions: { status: "observed", value: ["telemetry-default-on"], evidence: [] }
    });
  });

  it("preserves inferred support and the exact listing excerpt for preview disclosure", () => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = validManifest(baseline, "exa", {
      capabilityId: "synthesize-cited-evidence",
      excerpt: "content extraction",
      support: "inferred"
    });

    const result = materializeOfficialListingClaims({
      manifest: validateClaims(manifest),
      baseline,
      existing: emptyEvidenceManifest()
    });

    expect(result.evidence[0]).toMatchObject({
      support: "inferred",
      listingExcerpt: "content extraction",
      listingExcerptSha256: sha256("content extraction")
    });
  });

  it("retains related listing evidence without claiming capability coverage", () => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = validManifest(baseline, "exa", {
      capabilityId: "synthesize-cited-evidence",
      excerpt: "content extraction",
      support: "related"
    });

    const result = materializeOfficialListingClaims({
      manifest: validateClaims(manifest),
      baseline,
      existing: emptyEvidenceManifest()
    });

    expect(result.candidates[0]).toMatchObject({
      providedCapabilityIds: [],
      capabilityEvidenceIds: ["exa-web-research"]
    });
    expect(result.evidence[0]).toMatchObject({
      capabilityId: "synthesize-cited-evidence",
      support: "related"
    });
    expect(validateDecisionCandidateEvidence(result)).toEqual(result);
  });
});

function validManifest(
  baseline: OfficialMarketplaceBaseline,
  pluginName: string,
  claim: { capabilityId: string; excerpt: string; support?: "direct" | "inferred" | "related" }
): OfficialListingClaimsManifest {
  const pluginIndex = baseline.plugins.findIndex((plugin) => plugin.name === pluginName);
  const plugin = baseline.plugins[pluginIndex]!;
  return {
    schemaVersion: 1,
    compatibilityAttestation: {
      id: "official-claude-code-darwin",
      sourceId: "anthropic-plugins-official",
      runtime: "claude-code",
      platform: "darwin",
      compatibility: "verified",
      kind: "official-source-bound-inference",
      observedAt: "2026-07-29T00:00:00Z",
      reviewedAt: "2026-07-29T00:00:00Z",
      expiresAt: "2026-08-07T00:00:00Z",
      sourceUrls: [
        `${baseline.provenance.repository}/blob/${baseline.provenance.inspectedCommit}/${baseline.provenance.manifestPath}`,
        "https://code.claude.com/docs/en/overview"
      ],
      disclosures: [
        "compatibility-inference:not-install-smoke",
        "individual-safety-review:not-complete",
        "target-unknown:claude-code/linux",
        "target-unknown:claude-code/win32"
      ]
    },
    candidates: [{
      pluginName,
      marketplaceReference:
        `research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/${pluginIndex}`,
      sourcePin: structuredClone(plugin.sourcePin),
      assignments: [{
        domainId: pluginName === "exa" ? "research-and-intelligence" : "commerce",
        capabilityClaims: [{
          id: pluginName === "exa" ? "exa-web-research" : "shopify-store-operations-listing",
          capabilityId: claim.capabilityId,
          support: claim.support ?? "direct",
          listingExcerpt: claim.excerpt,
          listingExcerptSha256: sha256(claim.excerpt)
        }]
      }]
    }]
  };
}

function pluginByName(
  baseline: OfficialMarketplaceBaseline,
  name: string
): OfficialMarketplacePlugin {
  return baseline.plugins.find((plugin) => plugin.name === name)!;
}

function emptyEvidenceManifest(): DecisionCandidateEvidenceManifest {
  return { schemaVersion: 3, candidates: [], evidence: [], officialTargetCompatibilityEvidence: [] };
}

function heldShopifyOverride(baseline: OfficialMarketplaceBaseline): DecisionCandidateEvidenceManifest {
  const pluginIndex = baseline.plugins.findIndex((plugin) => plugin.name === "shopify-ai-toolkit");
  const plugin = baseline.plugins[pluginIndex]!;
  return {
    schemaVersion: 3,
    candidates: [{
      id: plugin.name,
      sourceId: "anthropic-plugins-official",
      skillPath: null,
      runtime: "claude-code",
      state: "held",
      stateReasons: ["marketplace-listed", "privacy-telemetry-review:not-complete"],
      providedCapabilityIds: ["operate-stores-and-marketplaces"],
      capabilityEvidenceIds: ["shopify-deep-evidence"],
      revisionBinding: "unavailable",
      permissions: { status: "observed", value: ["telemetry-default-on"], evidence: [] },
      license: { status: "observed", value: "MIT", evidence: [] },
      trust: { status: "unknown", evidence: [] },
      dependencies: { status: "unknown", evidence: [] },
      officialBaseline: {
        reference: `research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/${pluginIndex}`,
        marketplaceManifestSha256: baseline.provenance.manifestSha256,
        pluginName: plugin.name,
        sourceUrl: "https://github.com/Shopify/Shopify-AI-Toolkit.git",
        sourceCommit: plugin.sourcePin.sha,
        sourceBlobs: [{
          path: "README.md",
          immutableRawUrl:
            `https://raw.githubusercontent.com/Shopify/Shopify-AI-Toolkit/${plugin.sourcePin.sha}/README.md`,
          contentSha256: "a".repeat(64)
        }]
      }
    }],
    evidence: [{
      id: "shopify-deep-evidence",
      candidateId: plugin.name,
      capabilityId: "operate-stores-and-marketplaces",
      kind: "official-baseline",
      current: true,
      reference: `research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/${pluginIndex}`,
      contentSha256: baseline.provenance.manifestSha256
    }],
    officialTargetCompatibilityEvidence: []
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
