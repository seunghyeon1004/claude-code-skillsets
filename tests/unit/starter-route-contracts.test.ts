import { describe, expect, it } from "vitest";
import {
  validateDecisionStarterRoutes,
  validateDecisionStarterRoutesSemantics,
  type DecisionStarterRoutesValidationContext
} from "../../src/contracts/decision.js";
import type {
  CandidateCapabilityEvidence,
  DecisionCandidateProjection,
  DecisionStarterRoutesManifest
} from "../../src/model/decision.js";

describe("starter route contracts", () => {
  it("accepts a closed starter-partial route manifest", () => {
    const manifest = validStarterRoutesManifest();

    expect(validateDecisionStarterRoutes(manifest)).toEqual(manifest);
  });

  it.each([
    ["unknown properties", (manifest: Record<string, unknown>) => {
      manifest.unexpected = true;
    }],
    ["more than two candidates", (manifest: Record<string, unknown>) => {
      routeOf(manifest).orderedCandidateIds.push("third-candidate");
    }],
    ["duplicate candidates", (manifest: Record<string, unknown>) => {
      routeOf(manifest).orderedCandidateIds = ["primary", "primary"];
    }],
    ["complete coverage", (manifest: Record<string, unknown>) => {
      routeOf(manifest).broadCoverageComplete = true;
    }],
    ["an empty unsupported set", (manifest: Record<string, unknown>) => {
      routeOf(manifest).unsupportedCapabilityIds = [];
    }]
  ])("rejects %s", (_label, mutate) => {
    const manifest = structuredClone(validStarterRoutesManifest()) as unknown as Record<string, unknown>;
    mutate(manifest);

    expect(() => validateDecisionStarterRoutes(manifest)).toThrow(/invalid starter routes|additional|candidate|unsupported|false/i);
  });

  it("authenticates exact domain coverage against candidate evidence", () => {
    const manifest = semanticStarterRoutesManifest();
    const context = semanticContext();

    expect(validateDecisionStarterRoutesSemantics(manifest, context)).toEqual(manifest);
  });

  it("allows a related-only complement for an explicitly unsupported capability", () => {
    const manifest = semanticStarterRoutesManifest();
    const route = routeFor(manifest, "commerce");
    route.orderedCandidateIds.push("posthog");
    route.relatedEvidenceIds = ["posthog-commerce-store-relevance"];
    const context = semanticContext();
    context.candidates.find(({ id }) => id === "posthog")!.providedCapabilityIds = [];

    expect(validateDecisionStarterRoutesSemantics(manifest, context)).toEqual(manifest);
  });

  it.each([
    ["held Shopify inclusion", (manifest: DecisionStarterRoutesManifest) => {
      routeFor(manifest, "commerce").orderedCandidateIds = ["windsor-ai", "shopify-ai-toolkit"];
    }, /shopify|forbidden|eligible/i],
    ["wrong direct classification", (manifest: DecisionStarterRoutesManifest) => {
      const route = routeFor(manifest, "strategy-and-decision");
      route.directEvidenceIds.push(route.inferredEvidenceIds.shift()!);
    }, /support|direct|inferred/i],
    ["evidence from an unlisted candidate", (manifest: DecisionStarterRoutesManifest) => {
      routeFor(manifest, "commerce").inferredEvidenceIds = ["posthog-commerce-revenue"];
    }, /candidate|route/i],
    ["a missing capability gap", (manifest: DecisionStarterRoutesManifest) => {
      routeFor(manifest, "commerce").unsupportedCapabilityIds.pop();
    }, /capabilit|coverage|complete/i],
    ["overlapping supported and unsupported capability", (manifest: DecisionStarterRoutesManifest) => {
      routeFor(manifest, "commerce").unsupportedCapabilityIds.push("run-promotions-and-analyze-revenue");
    }, /capabilit|overlap|coverage/i],
    ["a candidate without route evidence", (manifest: DecisionStarterRoutesManifest) => {
      routeFor(manifest, "commerce").orderedCandidateIds.push("posthog");
    }, /candidate.*evidence|evidence.*candidate/i],
    ["a complement with no incremental capability", (manifest: DecisionStarterRoutesManifest) => {
      const route = routeFor(manifest, "commerce");
      route.orderedCandidateIds.push("posthog");
      route.inferredEvidenceIds.push("posthog-commerce-revenue");
    }, /complement|incremental|new capability/i],
    ["related evidence outside the unsupported capability set", (manifest: DecisionStarterRoutesManifest) => {
      const route = routeFor(manifest, "commerce");
      route.orderedCandidateIds.push("posthog");
      route.relatedEvidenceIds = ["posthog-commerce-store-relevance"];
      route.unsupportedCapabilityIds = ["manage-product-catalogs-and-listings"];
    }, /related.*unsupported|unsupported.*related/i],
    ["a related complement with no incremental association", (manifest: DecisionStarterRoutesManifest) => {
      const route = routeFor(manifest, "commerce");
      route.orderedCandidateIds.push("posthog");
      route.relatedEvidenceIds = ["windsor-commerce-store-relevance", "posthog-commerce-store-relevance"];
    }, /complement|incremental|associated/i],
    ["one required domain missing", (manifest: DecisionStarterRoutesManifest) => {
      manifest.routes = manifest.routes.filter(({ domainId }) => domainId !== "strategy-and-decision");
    }, /domain|strategy-and-decision/i],
    ["a duplicate domain", (manifest: DecisionStarterRoutesManifest) => {
      manifest.routes.push(structuredClone(manifest.routes[0]!));
    }, /duplicate.*domain|domain.*duplicate/i]
  ])("rejects %s", (_label, mutate, expected) => {
    const manifest = semanticStarterRoutesManifest();
    mutate(manifest);

    expect(() => validateDecisionStarterRoutesSemantics(manifest, semanticContext())).toThrow(expected);
  });
});

function validStarterRoutesManifest(): DecisionStarterRoutesManifest {
  return {
    schemaVersion: 1,
    routes: [{
      domainId: "commerce",
      kind: "starter-partial",
      orderedCandidateIds: ["primary", "complement"],
      smallestHonestProfile: {
        ko: "매출 데이터를 조회합니다.",
        en: "Queries revenue data."
      },
      directEvidenceIds: ["primary-evidence"],
      inferredEvidenceIds: ["complement-evidence"],
      relatedEvidenceIds: [],
      unsupportedCapabilityIds: ["operate-stores-and-marketplaces"],
      broadCoverageComplete: false
    }]
  };
}

function routeOf(manifest: Record<string, unknown>): Record<string, unknown> & {
  orderedCandidateIds: string[];
  unsupportedCapabilityIds: string[];
} {
  return (manifest.routes as Array<Record<string, unknown> & {
    orderedCandidateIds: string[];
    unsupportedCapabilityIds: string[];
  }>)[0]!;
}

function routeFor(manifest: DecisionStarterRoutesManifest, domainId: string) {
  return manifest.routes.find((route) => route.domainId === domainId)!;
}

function semanticStarterRoutesManifest(): DecisionStarterRoutesManifest {
  return {
    schemaVersion: 1,
    routes: [{
      domainId: "commerce",
      kind: "starter-partial",
      orderedCandidateIds: ["windsor-ai"],
      smallestHonestProfile: { ko: "매출 데이터를 조회합니다.", en: "Queries revenue data." },
      directEvidenceIds: [],
      inferredEvidenceIds: ["windsor-commerce-revenue"],
      relatedEvidenceIds: [],
      unsupportedCapabilityIds: ["operate-stores-and-marketplaces", "manage-product-catalogs-and-listings"],
      broadCoverageComplete: false
    }, {
      domainId: "strategy-and-decision",
      kind: "starter-partial",
      orderedCandidateIds: ["miro"],
      smallestHonestProfile: { ko: "전략 맥락을 시각화합니다.", en: "Visualizes strategic context." },
      directEvidenceIds: [],
      inferredEvidenceIds: ["miro-strategy-framing"],
      relatedEvidenceIds: [],
      unsupportedCapabilityIds: ["design-business-and-execution-strategy"],
      broadCoverageComplete: false
    }]
  };
}

function semanticContext(): DecisionStarterRoutesValidationContext {
  const candidates = [
    candidate("windsor-ai", "eligible-with-disclosures"),
    candidate("miro", "eligible-with-disclosures"),
    candidate("posthog", "eligible-with-disclosures"),
    candidate("shopify-ai-toolkit", "held")
  ];
  const evidence: CandidateCapabilityEvidence[] = [{
    id: "windsor-commerce-revenue",
    candidateId: "windsor-ai",
    capabilityId: "run-promotions-and-analyze-revenue",
    kind: "official-listing",
    current: true,
    reference: "marketplace#/plugins/260/description",
    contentSha256: "a".repeat(64),
    support: "inferred",
    listingExcerpt: "ecommerce",
    listingExcerptSha256: "b".repeat(64)
  }, {
    id: "miro-strategy-framing",
    candidateId: "miro",
    capabilityId: "frame-strategic-problems-and-opportunities",
    kind: "official-listing",
    current: true,
    reference: "marketplace#/plugins/158/description",
    contentSha256: "c".repeat(64),
    support: "inferred",
    listingExcerpt: "read board context",
    listingExcerptSha256: "d".repeat(64)
  }, {
    id: "posthog-commerce-revenue",
    candidateId: "posthog",
    capabilityId: "run-promotions-and-analyze-revenue",
    kind: "official-listing",
    current: true,
    reference: "marketplace#/plugins/185/description",
    contentSha256: "e".repeat(64),
    support: "inferred",
    listingExcerpt: "analytics",
    listingExcerptSha256: "f".repeat(64)
  }, {
    id: "windsor-commerce-store-relevance",
    candidateId: "windsor-ai",
    capabilityId: "operate-stores-and-marketplaces",
    kind: "official-listing",
    current: true,
    reference: "marketplace#/plugins/260/description",
    contentSha256: "1".repeat(64),
    support: "related",
    listingExcerpt: "ecommerce",
    listingExcerptSha256: "2".repeat(64)
  }, {
    id: "posthog-commerce-store-relevance",
    candidateId: "posthog",
    capabilityId: "operate-stores-and-marketplaces",
    kind: "official-listing",
    current: true,
    reference: "marketplace#/plugins/185/description",
    contentSha256: "3".repeat(64),
    support: "related",
    listingExcerpt: "analytics",
    listingExcerptSha256: "4".repeat(64)
  }];
  return {
    expectedDomainIds: ["commerce", "strategy-and-decision"],
    capabilities: [{
      id: "operate-stores-and-marketplaces",
      ownerDomainId: "commerce"
    }, {
      id: "run-promotions-and-analyze-revenue",
      ownerDomainId: "commerce"
    }, {
      id: "manage-product-catalogs-and-listings",
      ownerDomainId: "commerce"
    }, {
      id: "frame-strategic-problems-and-opportunities",
      ownerDomainId: "strategy-and-decision"
    }, {
      id: "design-business-and-execution-strategy",
      ownerDomainId: "strategy-and-decision"
    }],
    candidates,
    evidence,
    forbiddenCandidateIds: ["shopify-ai-toolkit"]
  };
}

function candidate(id: string, state: DecisionCandidateProjection["state"]): DecisionCandidateProjection {
  return {
    id,
    sourceId: "anthropic-plugins-official",
    skillPath: null,
    runtime: "claude-code",
    state,
    stateReasons: ["marketplace-listed"],
    providedCapabilityIds: ["run-promotions-and-analyze-revenue"],
    capabilityEvidenceIds: [],
    revisionBinding: "unavailable",
    permissions: { status: "unknown", evidence: [] },
    license: { status: "unknown", evidence: [] },
    trust: { status: "unknown", evidence: [] },
    dependencies: { status: "unknown", evidence: [] }
  };
}
