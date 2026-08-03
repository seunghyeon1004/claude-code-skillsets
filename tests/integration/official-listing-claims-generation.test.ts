import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import { loadDecisionManifests } from "../../src/decision/repository.js";
import { candidateRevisionDigest } from "../../src/decision/candidate-revisions.js";
import {
  loadOfficialMarketplaceBaseline,
  loadOfficialMarketplaceSelection,
  officialMarketplaceCandidateIdentity,
  type OfficialMarketplaceBaseline
} from "../../src/discovery/official-marketplace.js";
import { generateDecisionIndex } from "../../src/generate/decision-index.js";
import type { DecisionCandidateEvidenceManifest, OfficialListingClaimsManifest } from "../../src/model/decision.js";
import { materializeDecisionResearch } from "../../scripts/research/materialize-decision-research.js";
import { approveOfficialMarketplaceObservation } from "../../scripts/research/stage-official-marketplace.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("official listing claims generation", () => {
  it("binds reviewed official listing claims to the pinned marketplace", async () => {
    const baseline = loadOfficialMarketplaceBaseline();
    const manifest = parse(await readFile(
      join(projectRoot, "manifests", "official-listing-capability-claims.yaml"),
      "utf8"
    )) as OfficialListingClaimsManifest;
    const starterCandidates = manifest.candidates.filter(({ pluginName }) =>
      !["exa", "feature-dev", "superpowers"].includes(pluginName));

    expect(starterCandidates.map(({ pluginName }) => pluginName).sort()).toEqual(
      Object.keys(expectedStarterClaims).sort()
    );
    expect(starterCandidates.some(({ pluginName }) => pluginName === "shopify-ai-toolkit")).toBe(false);

    for (const [pluginName, expected] of Object.entries(expectedStarterClaims)) {
      const candidate = starterCandidates.find((item) => item.pluginName === pluginName)!;
      const plugin = baseline.plugins[expected.index]!;
      expect(plugin.name).toBe(pluginName);
      expect(candidate).toMatchObject({
        pluginName,
        marketplaceReference:
          `research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/${expected.index}`,
        sourcePin: expected.sourcePin
      });
      expect(candidate.assignments.map(({ domainId }) => domainId)).toEqual(
        expected.assignments.map(({ domainId }) => domainId)
      );

      for (const expectedAssignment of expected.assignments) {
        const assignment = candidate.assignments.find(
          ({ domainId }) => domainId === expectedAssignment.domainId
        )!;
        expect(assignment.capabilityClaims.map((claim) => ({
          capabilityId: claim.capabilityId,
          listingExcerpt: claim.listingExcerpt
        }))).toEqual(expectedAssignment.claims.map(({ capabilityId, listingExcerpt }) => ({
          capabilityId,
          listingExcerpt
        })));
        for (const claim of assignment.capabilityClaims) {
          expect(plugin.description).toContain(claim.listingExcerpt);
          expect(claim.listingExcerptSha256).toBe(sha256(claim.listingExcerpt));
        }
      }
    }

    const capabilitiesFor = (pluginName: string) => starterCandidates
      .find((candidate) => candidate.pluginName === pluginName)!
      .assignments.flatMap(({ capabilityClaims }) =>
        capabilityClaims.map(({ capabilityId }) => capabilityId));
    expect(capabilitiesFor("mlflow").every((capabilityId) =>
      capabilitiesFor("aws-agents").includes(capabilityId))).toBe(true);

    await expect(loadDecisionManifests(projectRoot)).resolves.toBeDefined();
  });

  it("keeps strict full-compound support classifications", async () => {
    const manifest = parse(await readFile(
      join(projectRoot, "manifests", "official-listing-capability-claims.yaml"),
      "utf8"
    )) as OfficialListingClaimsManifest;
    const claims = manifest.candidates.flatMap(({ assignments }) => assignments.flatMap(
      ({ capabilityClaims }) => capabilityClaims
    ));
    const directIds = [
      "exa-web-research",
      "feature-dev-repository-exploration",
      "superpowers-debugging-tdd",
      "monday-crm-maintain-customer-relationship-records"
    ];
    const inferredIds = [
      "amplitude-discover-customer-problems-and-needs",
      "aws-agents-for-devsecops-assess-application-threats-and-security",
      "data-agent-kit-starter-pack-build-data-collection-and-transformation-pipelines",
      "data-agent-kit-starter-pack-query-and-explore-data",
      "notion-build-and-search-knowledge-bases"
    ];
    const byId = new Map(claims.map((claim) => [claim.id, claim]));

    expect(claims).toHaveLength(64);
    expect(directIds.map((id) => byId.get(id)?.support)).toEqual(["direct", "direct", "direct", "direct"]);
    expect(inferredIds.map((id) => byId.get(id)?.support)).toEqual([
      "inferred", "inferred", "inferred", "inferred", "inferred"
    ]);
    const related = claims.filter(({ id }) => !directIds.includes(id) && !inferredIds.includes(id));
    expect(related).toHaveLength(55);
    expect(related.every(({ support }) => support === "related")).toBe(true);
  });

  it("root-validates a compact listing claim and generates an eligible install-bound candidate", async () => {
    const root = await fixtureRoot();
    const baseline = loadOfficialMarketplaceBaseline(root);
    await writeClaims(root, claimsManifest(baseline, [exaClaims(baseline)]));

    const repository = await loadDecisionManifests(root);
    const exa = repository.candidateEvidence.find(({ candidateId }) => candidateId === "exa")!.candidate;
    expect(exa).toMatchObject({
      id: "exa",
      state: "eligible-with-disclosures",
      stateReasons: [
        "marketplace-listed",
        "individual-safety-review:not-complete",
        "revision-binding:unavailable"
      ],
      claudeInstall: {
        sourceId: "anthropic-plugins-official",
        pluginName: "exa",
        marketplaceId: "claude-plugins-official",
        marketplaceSource: "anthropics/claude-plugins-official",
        scope: "user",
        argv: ["claude", "plugin", "install", "exa@claude-plugins-official", "--scope", "user"]
      }
    });

    const index = JSON.parse(await generateDecisionIndex(root)) as {
      candidates: Array<Record<string, unknown> & { id: string }>;
    };
    expect(index.candidates.find(({ id }) => id === "exa")).toMatchObject({
      state: "eligible-with-disclosures",
      stateReasons: expect.arrayContaining([
        "marketplace-listed",
        "individual-safety-review:not-complete",
        "revision-binding:unavailable",
        "compatibility-inference:official-source-bound",
        "target-verified:claude-code/darwin",
        "target-unknown:claude-code/linux",
        "target-unknown:claude-code/win32"
      ]),
      permissions: { status: "unknown", evidence: [] },
      license: { status: "unknown", evidence: [] },
      trust: { status: "unknown", evidence: [] },
      dependencies: { status: "unknown", evidence: [] }
    });
  });

  it.each(["held", "blocked"] as const)("does not promote an existing Shopify %s override", async (state) => {
    const root = await fixtureRoot();
    const baseline = loadOfficialMarketplaceBaseline(root);
    await writeClaims(root, claimsManifest(baseline, [shopifyClaims(baseline)]));
    if (state === "blocked") {
      const path = join(root, "manifests", "decision-candidate-evidence.yaml");
      const manifest = parse(await readFile(path, "utf8")) as DecisionCandidateEvidenceManifest;
      const revision = manifest.candidateRevisions?.at(-1);
      if (revision === undefined) throw new Error("fixture Shopify revision is missing");
      revision.candidate.state = "blocked";
      revision.candidate.stateReasons = ["marketplace-listed", "review-blocked"];
      revision.approval.disposition = "blocked";
      revision.approval.digest = candidateRevisionDigest(revision);
      await writeFile(path, stringify(manifest, { lineWidth: 0 }));
    }

    const index = JSON.parse(await generateDecisionIndex(root)) as {
      candidates: Array<{ id: string; state: string; stateReasons: string[] }>;
    };
    const shopify = index.candidates.find(({ id }) => id === "shopify-ai-toolkit");
    expect(shopify).toMatchObject({
      state,
      stateReasons: expect.arrayContaining(state === "held"
        ? ["privacy-telemetry-review:not-complete"]
        : ["review-blocked"])
    });
  });

  it.each([
    ["unknown capability", "research-and-intelligence", "missing-capability"],
    ["wrong owner domain", "software-engineering", "source-discovery-and-web-research"]
  ] as const)("rejects a routed official claim with an %s", async (_label, domainId, capabilityId) => {
    const root = await fixtureRoot();
    const baseline = loadOfficialMarketplaceBaseline(root);
    const claims = exaClaims(baseline);
    claims.assignments[0]!.domainId = domainId as typeof claims.assignments[number]["domainId"];
    claims.assignments[0]!.capabilityClaims[0]!.capabilityId = capabilityId;
    await writeClaims(root, claimsManifest(baseline, [claims]));

    await expect(loadDecisionManifests(root)).rejects.toThrow(/capability|domain/i);
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "official-listing-generation-"));
  temporaryRoots.push(root);
  await Promise.all([
    cp(join(projectRoot, "manifests"), join(root, "manifests"), { recursive: true }),
    cp(join(projectRoot, "research"), join(root, "research"), { recursive: true }),
    cp(join(projectRoot, "governance"), join(root, "governance"), { recursive: true })
  ]);
  await rm(join(root, "manifests", "decision-starter-routes.yaml"));

  const heldSelection = loadOfficialMarketplaceSelection(root);
  await approveOfficialMarketplaceObservation({
    root,
    approvedAt: "2026-08-03T02:30:05Z",
    approvedBy: "reviewer:fixture",
    reason: "exercise eligible official install projection",
    candidateRebindings: heldSelection.selectedChanges.map(({ name }) => {
      const plugin = heldSelection.observedArtifact.plugins.find((candidate) => candidate.name === name);
      if (plugin === undefined) throw new Error(`${name}: fixture marketplace plugin is missing`);
      return { name, expectedIdentity: officialMarketplaceCandidateIdentity(plugin) };
    })
  });
  await materializeDecisionResearch({ root, asOf: "2026-08-03T02:30:05Z", checkOnly: false });
  return root;
}

async function writeClaims(root: string, manifest: OfficialListingClaimsManifest): Promise<void> {
  const selection = loadOfficialMarketplaceSelection(root);
  const artifact = selection.state === "current" ? selection.observedArtifact : selection.approvedArtifact;
  const artifactPath = selection.state === "current"
    ? selection.observedArtifactPath
    : selection.approvedArtifactPath;
  for (const candidate of manifest.candidates) {
    const pluginIndex = artifact.plugins.findIndex(({ name }) => name === candidate.pluginName);
    if (pluginIndex < 0) throw new Error(`${candidate.pluginName}: fixture marketplace plugin is missing`);
    candidate.marketplaceReference = `research/marketplaces/${artifactPath}#/plugins/${pluginIndex}`;
  }
  await writeFile(
    join(root, "manifests", "official-listing-capability-claims.yaml"),
    stringify(manifest, { lineWidth: 0 })
  );
}

function claimsManifest(
  baseline: OfficialMarketplaceBaseline,
  candidates: OfficialListingClaimsManifest["candidates"]
): OfficialListingClaimsManifest {
  return {
    schemaVersion: 1,
    compatibilityAttestation: {
      id: "official-claude-code-darwin",
      sourceId: "anthropic-plugins-official",
      runtime: "claude-code",
      platform: "darwin",
      compatibility: "verified",
      kind: "official-source-bound-inference",
      observedAt: "2026-08-03T02:30:05Z",
      reviewedAt: "2026-08-03T02:30:05Z",
      expiresAt: "2026-08-12T02:30:05Z",
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
    candidates
  };
}

function exaClaims(baseline: OfficialMarketplaceBaseline): OfficialListingClaimsManifest["candidates"][number] {
  return candidateClaims(baseline, "exa", "research-and-intelligence", {
    id: "exa-web-research",
    capabilityId: "source-discovery-and-web-research",
    excerpt: "web search, deep research, and content extraction"
  });
}

function shopifyClaims(baseline: OfficialMarketplaceBaseline): OfficialListingClaimsManifest["candidates"][number] {
  return candidateClaims(baseline, "shopify-ai-toolkit", "commerce", {
    id: "shopify-store-operations-listing",
    capabilityId: "operate-stores-and-marketplaces",
    excerpt: "store management via CLI"
  });
}

function candidateClaims(
  baseline: OfficialMarketplaceBaseline,
  pluginName: string,
  domainId: OfficialListingClaimsManifest["candidates"][number]["assignments"][number]["domainId"],
  claim: { id: string; capabilityId: string; excerpt: string }
): OfficialListingClaimsManifest["candidates"][number] {
  const pluginIndex = baseline.plugins.findIndex((plugin) => plugin.name === pluginName);
  const plugin = baseline.plugins[pluginIndex]!;
  return {
    pluginName,
    marketplaceReference:
      `research/marketplaces/claude-plugins-official-e3e378c.json#/plugins/${pluginIndex}`,
    sourcePin: structuredClone(plugin.sourcePin),
    assignments: [{
      domainId,
      capabilityClaims: [{
        id: claim.id,
        capabilityId: claim.capabilityId,
        support: "direct",
        listingExcerpt: claim.excerpt,
        listingExcerptSha256: sha256(claim.excerpt)
      }]
    }]
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type StarterClaim = {
  capabilityId: string;
  support: "direct" | "inferred";
  listingExcerpt: string;
};

type StarterCandidateExpectation = {
  index: number;
  sourcePin: { kind: "external-sha" | "marketplace-commit"; sha: string };
  assignments: Array<{ domainId: string; claims: StarterClaim[] }>;
};

const claim = (
  capabilityId: string,
  support: StarterClaim["support"],
  listingExcerpt: string
): StarterClaim => ({ capabilityId, support, listingExcerpt });

const expectedStarterClaims: Record<string, StarterCandidateExpectation> = {
  "aws-startup-advisor": {
    index: 30,
    sourcePin: { kind: "external-sha", sha: "084d44e1dedab244c938a2eb37bd613a9643b223" },
    assignments: [{ domainId: "strategy-and-decision", claims: [
      claim("frame-strategic-problems-and-opportunities", "inferred", "Personalized architecture, cost, security, and migration guidance for startups")
    ] }]
  },
  sanity: {
    index: 213,
    sourcePin: { kind: "external-sha", sha: "af54474c21b00aee8e2fa2855b8ff6ef8a0cf41c" },
    assignments: [{ domainId: "writing-and-publishing", claims: [
      claim("publish-content-to-cms", "inferred", "Query and author content")
    ] }]
  },
  mintlify: {
    index: 157,
    sourcePin: { kind: "external-sha", sha: "acd6d2e0128c4f235d55cfb8d8c91ecbdd5df8cc" },
    assignments: [{ domainId: "writing-and-publishing", claims: [
      claim("edit-verify-and-proofread-content", "inferred", "Convert non-markdown files into properly formatted MDX pages, add and modify content")
    ] }]
  },
  posthog: {
    index: 185,
    sourcePin: { kind: "external-sha", sha: "00579b8a86d9caecbda117b1b3999858f785c3dd" },
    assignments: [{ domainId: "marketing-and-growth", claims: [
      claim("design-and-optimize-conversion-funnels", "inferred", "analytics, feature flags, experiments, error tracking, and insights")
    ] }]
  },
  "windsor-ai": {
    index: 260,
    sourcePin: { kind: "external-sha", sha: "8a4fed5425bd43f6f57f4543d7acfc0593616846" },
    assignments: [
      { domainId: "marketing-and-growth", claims: [
        claim("retain-customers-and-measure-growth", "inferred", "Query marketing, sales, CRM, ecommerce, finance, and analytics data from Google Ads, Meta, HubSpot, Salesforce, Shopify, Stripe")
      ] },
      { domainId: "commerce", claims: [
        claim("run-promotions-and-analyze-revenue", "inferred", "Query marketing, sales, CRM, ecommerce, finance, and analytics data from Google Ads, Meta, HubSpot, Salesforce, Shopify, Stripe")
      ] }
    ]
  },
  postiz: {
    index: 186,
    sourcePin: { kind: "external-sha", sha: "41c5a9dbd6b2776863e7c05c22e7a385c208321c" },
    assignments: [{ domainId: "promotion-and-distribution", claims: [
      claim("plan-launch-promotion", "inferred", "scheduling posts, managing integrations, uploading media, and tracking analytics across 28+ platforms"),
      claim("adapt-repurpose-and-distribute-content", "inferred", "scheduling posts, managing integrations, uploading media, and tracking analytics across 28+ platforms")
    ] }]
  },
  "spotify-ads-api": {
    index: 234,
    sourcePin: { kind: "external-sha", sha: "1421ab69a67f8b0d48d96cdbe277a4a1a92b8d10" },
    assignments: [{ domainId: "promotion-and-distribution", claims: [
      claim("operate-and-optimize-campaigns", "direct", "Create campaigns, ad sets, ads, pull reports, and handle OAuth")
    ] }]
  },
  apollo: {
    index: 14,
    sourcePin: { kind: "external-sha", sha: "2adde980e45f421b7e9383d92870455627936bce" },
    assignments: [{ domainId: "sales-and-customer", claims: [
      claim("research-accounts-and-discover-leads", "inferred", "Prospect, enrich leads, load outreach sequences, and query sales analytics"),
      claim("qualify-opportunities-through-discovery", "inferred", "Prospect, enrich leads, load outreach sequences, and query sales analytics")
    ] }]
  },
  "monday-crm": {
    index: 161,
    sourcePin: { kind: "external-sha", sha: "fc64cf88c2fd9e3081f70fa8bbfb6d2bbee809a8" },
    assignments: [{ domainId: "sales-and-customer", claims: [
      claim("maintain-customer-relationship-records", "direct", "turn meeting notes into deal updates")
    ] }]
  },
  amplitude: {
    index: 13,
    sourcePin: { kind: "external-sha", sha: "05ce0a91cbf3188f1512e324bd9663cc0e23f34a" },
    assignments: [{ domainId: "product-management", claims: [
      claim("discover-customer-problems-and-needs", "inferred", "discover product opportunities, analyze charts, create dashboards, manage experiments, and understand users and accounts"),
      claim("validate-products-with-prototypes-and-experiments", "inferred", "discover product opportunities, analyze charts, create dashboards, manage experiments, and understand users and accounts"),
      claim("measure-products-and-assess-launch-readiness", "inferred", "discover product opportunities, analyze charts, create dashboards, manage experiments, and understand users and accounts")
    ] }]
  },
  linear: {
    index: 138,
    sourcePin: { kind: "marketplace-commit", sha: "e3e378cbbb205673a5d7254ded32679cafa6179d" },
    assignments: [{ domainId: "product-management", claims: [
      claim("shape-and-prioritize-product-scope", "inferred", "Create issues, manage projects, update statuses, search across workspaces"),
      claim("build-evidence-based-product-roadmaps", "inferred", "Create issues, manage projects, update statuses, search across workspaces")
    ] }]
  },
  asana: {
    index: 17,
    sourcePin: { kind: "marketplace-commit", sha: "e3e378cbbb205673a5d7254ded32679cafa6179d" },
    assignments: [{ domainId: "project-management", claims: [
      claim("define-and-decompose-project-work", "inferred", "Create and manage tasks, search projects, update assignments, track progress"),
      claim("coordinate-project-dependencies-and-resources", "inferred", "Create and manage tasks, search projects, update assignments, track progress"),
      claim("report-project-status-to-stakeholders", "inferred", "Create and manage tasks, search projects, update assignments, track progress")
    ] }]
  },
  atlassian: {
    index: 20,
    sourcePin: { kind: "external-sha", sha: "f22e7075136a62baa7c10200a64884f83bf3ebe1" },
    assignments: [{ domainId: "project-management", claims: [
      claim("facilitate-meetings-and-record-decisions", "inferred", "Search and create issues, access documentation, manage sprints"),
      claim("control-project-change-and-risk", "inferred", "Search and create issues, access documentation, manage sprints")
    ] }]
  },
  "aws-agents-for-devsecops": {
    index: 24,
    sourcePin: { kind: "external-sha", sha: "08025af3d27a1eb7c18fe06bf451df8b110e9e0e" },
    assignments: [{ domainId: "devops-and-security", claims: [
      claim("respond-to-security-incidents-and-recover", "inferred", "Investigate incidents, review code and execute UAT for release readiness, scan code for vulnerabilities, and run penetration tests"),
      claim("assess-application-threats-and-security", "inferred", "Investigate incidents, review code and execute UAT for release readiness, scan code for vulnerabilities, and run penetration tests")
    ] }]
  },
  buildkite: {
    index: 42,
    sourcePin: { kind: "external-sha", sha: "5bbd53d496b9dd5cd7b3e0a2d8345daa333c3f4e" },
    assignments: [{ domainId: "devops-and-security", claims: [
      claim("automate-safe-software-delivery", "inferred", "pipelines, migration, preflight, agent runtime, CLI, and API")
    ] }]
  },
  "aws-agents": {
    index: 23,
    sourcePin: { kind: "external-sha", sha: "851e0346e51c10afc96f1fb1c167a8a55134df79" },
    assignments: [{ domainId: "ai-agents-and-automation", claims: [
      claim("connect-models-to-tools-and-mcp", "inferred", "connecting tools, memory, policies, evaluation, debugging, and production hardening"),
      claim("design-single-and-multi-agent-systems", "inferred", "Build, deploy, and operate AI agents on AWS"),
      claim("implement-stateful-agent-memory", "direct", "connecting tools, memory, policies, evaluation, debugging, and production hardening"),
      claim("evaluate-guard-and-monitor-ai-systems", "inferred", "connecting tools, memory, policies, evaluation, debugging, and production hardening")
    ] }]
  },
  mlflow: {
    index: 160,
    sourcePin: { kind: "external-sha", sha: "c33bb3d303a2c6113bbaed6dbfe756e88e80f1df" },
    assignments: [{ domainId: "ai-agents-and-automation", claims: [
      // Authenticated listing evidence only; this is not an incremental starter-route complement to AWS.
      claim("evaluate-guard-and-monitor-ai-systems", "inferred", "tracing, evaluating, and improving AI agents")
    ] }]
  },
  "data-agent-kit-starter-pack": {
    index: 80,
    sourcePin: { kind: "external-sha", sha: "b5d4964a1fa82ca2f67faa16ee808265aa3a0cb6" },
    assignments: [{ domainId: "data-and-analytics", claims: [
      claim("build-data-collection-and-transformation-pipelines", "inferred", "architect complex data pipelines, transform data with dbt, write Spark and BigQuery SQL notebooks, and orchestrate end-to-end workflows"),
      claim("query-and-explore-data", "inferred", "architect complex data pipelines, transform data with dbt, write Spark and BigQuery SQL notebooks, and orchestrate end-to-end workflows")
    ] }]
  },
  atlan: {
    index: 19,
    sourcePin: { kind: "external-sha", sha: "86bb1ad27f80e189b328333d2271b360ae579f2b" },
    assignments: [{ domainId: "data-and-analytics", claims: [
      claim("validate-and-clean-data", "inferred", "lineage traversal, glossary management, data quality rules"),
      claim("produce-governed-analytical-reports", "inferred", "Search, explore, govern, and manage your data assets")
    ] }]
  },
  figma: {
    index: 104,
    sourcePin: { kind: "external-sha", sha: "07316dd2920d61303ca0e52812b31f5f341e7b15" },
    assignments: [{ domainId: "design-and-brand", claims: [
      claim("map-and-prototype-user-experiences", "inferred", "extract component information, read design tokens, and translate designs into code"),
      claim("build-design-systems-and-developer-handoffs", "inferred", "extract component information, read design tokens, and translate designs into code"),
      claim("design-responsive-web-experiences", "inferred", "extract component information, read design tokens, and translate designs into code")
    ] }]
  },
  canva: {
    index: 43,
    sourcePin: { kind: "external-sha", sha: "b56291ea0a36d0a941e1478b47959be5f1771dee" },
    assignments: [{ domainId: "design-and-brand", claims: [
      claim("define-brands-and-visual-identities", "inferred", "Create, edit, review, resize, and brand-check Canva designs"),
      claim("produce-brand-aligned-creative", "direct", "Create, edit, review, resize, and brand-check Canva designs")
    ] }]
  },
  "runway-api": {
    index: 210,
    sourcePin: { kind: "external-sha", sha: "16353db3500ea5e346460755205991081567902a" },
    assignments: [{ domainId: "video-and-audio", claims: [
      claim("research-and-develop-media-concepts", "inferred", "batch ad campaigns, product videos, multishot stories, and creative iteration")
    ] }]
  },
  hyperframes: {
    index: 125,
    sourcePin: { kind: "external-sha", sha: "c39f3cf924bb5109bfc0b36f3d7b99a4cb397322" },
    assignments: [{ domainId: "video-and-audio", claims: [
      claim("create-motion-graphics-and-thumbnails", "inferred", "animations, captions, voiceovers, audio-reactive visuals, and website-to-video capture"),
      claim("produce-accessible-captions", "inferred", "animations, captions, voiceovers, audio-reactive visuals, and website-to-video capture"),
      claim("repurpose-and-deliver-quality-controlled-media", "inferred", "Write HTML, render video")
    ] }]
  },
  notion: {
    index: 169,
    sourcePin: { kind: "external-sha", sha: "9847f2aa1a15f25df35ed1fb7b4557dbb60cd651" },
    assignments: [{ domainId: "documents-and-knowledge", claims: [
      claim("author-documents-from-reusable-templates", "inferred", "Search pages, create and update documents, manage databases, and access your team's knowledge base"),
      claim("capture-meeting-records-and-notes", "inferred", "Search pages, create and update documents, manage databases, and access your team's knowledge base"),
      claim("build-and-search-knowledge-bases", "direct", "Search pages, create and update documents, manage databases, and access your team's knowledge base"),
      claim("document-standard-operating-procedures", "inferred", "Search pages, create and update documents, manage databases, and access your team's knowledge base")
    ] }]
  },
  "carbone-skill": {
    index: 44,
    sourcePin: { kind: "external-sha", sha: "52cd97e4ff35490440c066822739e466fab47901" },
    assignments: [{ domainId: "documents-and-knowledge", claims: [
      claim("author-documents-from-reusable-templates", "direct", "complete templating language reference"),
      claim("build-data-rich-spreadsheets", "inferred", "all output formats (DOCX, XLSX, PPTX, ODT, HTML, Markdown, PDF)"),
      claim("create-presentations", "inferred", "all output formats (DOCX, XLSX, PPTX, ODT, HTML, Markdown, PDF)")
    ] }]
  },
  airtable: {
    index: 6,
    sourcePin: { kind: "external-sha", sha: "812ee67f1fd3d76fb45ff8df40afaa0448602ba8" },
    assignments: [
      { domainId: "business-operations", claims: [
        claim("map-and-standardize-operational-processes", "inferred", "database and operations layer for your agents — whether running product, marketing, sales, ops, HR"),
        claim("design-and-coordinate-operational-handoffs", "inferred", "structured data with multiplayer visual surfaces")
      ] }
    ]
  },
  zapier: {
    index: 265,
    sourcePin: { kind: "external-sha", sha: "217d65a980f9b75536babf89ba64bf03ad95beea" },
    assignments: [{ domainId: "business-operations", claims: [
      claim("automate-repetitive-operational-work", "inferred", "Discover, enable, and execute Zapier actions")
    ] }]
  },
  "airwallex-agentos": {
    index: 7,
    sourcePin: { kind: "external-sha", sha: "b0bd2c3d65da47e39db8c779501119376d91c431" },
    assignments: [{ domainId: "finance-and-accounting", claims: [
      claim("plan-budgets-and-cash-flow", "inferred", "set up invoices from a PO, onboard suppliers from invoices, and check current cash position across currencies"),
      claim("process-receipts-invoices-and-collections", "inferred", "set up invoices from a PO, onboard suppliers from invoices, and check current cash position across currencies")
    ] }]
  },
  "carta-investors": {
    index: 47,
    sourcePin: { kind: "external-sha", sha: "a6c97d0e25b6c559adb905dd4a6d11ce478aec86" },
    assignments: [{ domainId: "finance-and-accounting", claims: [
      claim("forecast-and-report-financial-performance", "inferred", "querying investor data, performance benchmarks, regulatory reporting, AGM deck generation, brand extraction")
    ] }]
  },
  "learn-with-coursera": {
    index: 135,
    sourcePin: { kind: "external-sha", sha: "ac28fd6ebf8584e3ee196159bd6d4514fa07de0f" },
    assignments: [{ domainId: "people-and-training", claims: [
      claim("design-learning-programs-and-assessments", "inferred", "delivers the right next step — a course, hands-on project, short video, or live roleplay — then maps a path forward")
    ] }]
  },
  legalzoom: {
    index: 137,
    sourcePin: { kind: "external-sha", sha: "f9fd8a0ca6e1421bc1aacb113a109663a7a6f6d8" },
    assignments: [{ domainId: "legal-risk-and-compliance", claims: [
      claim("assist-with-contract-drafting-and-review", "inferred", "document review identifies critical risks and important clauses, advises when to engage an attorney")
    ] }]
  }
};
