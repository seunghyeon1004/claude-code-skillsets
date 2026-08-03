import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { assertOfficialListingClaimsAppendOnly } from
  "../../scripts/research/assert-official-listing-claims-append-only.js";

describe("official listing claims append-only policy", () => {
  it.each([
    ["candidate", (value: Claims) => value.candidates.splice(0, 1)],
    ["assignment", (value: Claims) => value.candidates[0]!.assignments.splice(0, 1)],
    ["capability claim", (value: Claims) =>
      value.candidates[0]!.assignments[0]!.capabilityClaims.splice(0, 1)]
  ])("rejects removal of a published %s", (_label, mutate) => {
    const current = claims();
    mutate(current);

    expect(() => assertOfficialListingClaimsAppendOnly(
      YAML.stringify(claims()),
      YAML.stringify(current)
    )).toThrow(/append-only|removed/i);
  });

  it("allows refreshed pins and attestations while retaining every published claim", () => {
    const current = claims();
    current.compatibilityAttestation.observedAt = "2026-08-08T00:00:00Z";
    current.candidates[0]!.marketplaceReference = "research/marketplaces/new.json#/plugins/4";
    current.candidates[0]!.sourcePin.sha = "f".repeat(40);
    current.candidates.push(candidate("added", "new-domain", "added-claim"));

    expect(() => assertOfficialListingClaimsAppendOnly(
      YAML.stringify(claims()),
      YAML.stringify(current)
    )).not.toThrow();
  });

  it.each([
    ["capabilityId", (claim: CapabilityClaim) => {
      claim.capabilityId = "different-capability";
    }],
    ["support", (claim: CapabilityClaim) => {
      claim.support = "related";
    }],
    ["listing excerpt", (claim: CapabilityClaim) => {
      claim.listingExcerpt = "different listing evidence";
    }]
  ])("rejects mutation of an existing claim's %s", (_label, mutate) => {
    const current = claims();
    mutate(current.candidates[0]!.assignments[0]!.capabilityClaims[0]!);

    expect(() => assertOfficialListingClaimsAppendOnly(
      YAML.stringify(claims()),
      YAML.stringify(current)
    )).toThrow(/append-only|mutated/i);
  });
});

interface Claims {
  compatibilityAttestation: { observedAt: string };
  candidates: Candidate[];
}

interface Candidate {
  pluginName: string;
  marketplaceReference: string;
  sourcePin: { kind: "external-sha"; sha: string };
  assignments: Array<{
    domainId: string;
    capabilityClaims: CapabilityClaim[];
  }>;
}

interface CapabilityClaim {
  id: string;
  capabilityId: string;
  support: "direct" | "related";
  listingExcerpt: string;
  listingExcerptSha256: string;
}

function claims(): Claims {
  return {
    compatibilityAttestation: { observedAt: "2026-07-29T00:00:00Z" },
    candidates: [candidate("exa", "research-and-intelligence", "exa-web-research")]
  };
}

function candidate(pluginName: string, domainId: string, claimId: string): Candidate {
  return {
    pluginName,
    marketplaceReference: "research/marketplaces/old.json#/plugins/1",
    sourcePin: { kind: "external-sha", sha: "a".repeat(40) },
    assignments: [{
      domainId,
      capabilityClaims: [{
        id: claimId,
        capabilityId: `${claimId}-capability`,
        support: "direct",
        listingExcerpt: "stable listing evidence",
        listingExcerptSha256: "a".repeat(64)
      }]
    }]
  };
}
