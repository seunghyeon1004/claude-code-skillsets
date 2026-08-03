import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDecisionPlan } from "../../src/decision/planner.js";
import { generateAll } from "../../src/generate/all.js";
import { validateDecisionIndex } from "../../src/contracts/decision.js";
import { COMPLETE_V1_DOMAIN_IDS } from "../../src/model/complete-v1.js";
import type { DecisionIndex } from "../../src/model/decision.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const rootIndex = `${root}/generated/decision-index.json`;
const pluginIndex = `${root}/plugins/skillset-manager/data/decision-index.json`;

describe("decision index generation", () => {
  it("generates byte-identical root and plugin indexes", async () => {
    const artifacts = await generateAll(root);
    const [rootBytes, pluginBytes] = await Promise.all([readFile(rootIndex), readFile(pluginIndex)]);

    expect(rootBytes).toEqual(pluginBytes);
    expect(rootBytes.toString("utf8")).toBe(artifacts.decisionIndex);
  });

  it("binds the generated catalog version, nine-day expiry, and complete fixture corpus", async () => {
    const artifacts = await generateAll(root);
    const index = JSON.parse(artifacts.decisionIndex) as DecisionIndex;

    expect(index.catalogVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(index.observedThrough).toBe("2026-08-03T02:30:05Z");
    expect(Date.parse(index.catalogExpiresAt) - Date.parse(index.observedThrough)).toBe(9 * 86_400_000);
    expect(index.profiles).toHaveLength(20);
    expect(index.intentFixtures.length).toBeGreaterThan(800);
    expect(index.profiles.map(({ domainId }) => domainId)).toEqual(COMPLETE_V1_DOMAIN_IDS);
    expect(index.intentFixtures.filter((fixture) => fixture.id.startsWith("claude-domain-")).map(({ domainIds }) => domainIds)).toEqual([
      ...COMPLETE_V1_DOMAIN_IDS.map((domainId) => [domainId]),
      ...COMPLETE_V1_DOMAIN_IDS.flatMap((primary) => COMPLETE_V1_DOMAIN_IDS
        .filter((complement) => complement !== primary)
        .map((complement) => [primary, complement]))
    ]);
    expect(index.intentFixtures).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "claude-boundary-token", runtime: "claude-code", goal: "metadata analysis migration" }),
      expect.objectContaining({ id: "codex-boundary-token", runtime: "codex", goal: "metadata analysis migration" }),
      expect.objectContaining({ id: "claude-tie", runtime: "claude-code", goal: expect.any(String) }),
      expect.objectContaining({ id: "codex-tie", runtime: "codex", goal: expect.any(String) }),
      expect.objectContaining({ id: "claude-three-domain-priority", domainIds: expect.arrayContaining(COMPLETE_V1_DOMAIN_IDS.slice(0, 3)), domainPriority: [COMPLETE_V1_DOMAIN_IDS[2], COMPLETE_V1_DOMAIN_IDS[0]] }),
      expect.objectContaining({ id: "codex-three-domain-priority", runtime: "codex" })
    ]));
    for (const profile of index.profiles) {
      for (const language of ["ko", "en"] as const) {
        for (const phrase of profile.phrases[language]) {
          for (const runtime of ["claude-code", "codex"] as const) {
            expect(index.intentFixtures).toContainEqual(expect.objectContaining({ runtime, goal: phrase }));
          }
        }
      }
    }
    expect(index.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("holds the exact Shopify revision outside the unchanged Windsor commerce route", async () => {
    const artifacts = await generateAll(root);
    const index = JSON.parse(artifacts.decisionIndex) as DecisionIndex;
    const candidate = index.candidates.find(({ id }) => id === "shopify-ai-toolkit");

    expect(candidate).toEqual(expect.objectContaining({
      id: "shopify-ai-toolkit",
      candidateRevisionId: "shopify-ai-toolkit-revision-0e06bc35611e",
      state: "held",
      stateReasons: expect.arrayContaining([
        "marketplace-listed",
        "official-marketplace-selection:review-required",
        "source-drift:556811e94dd45c795abe5c0b1bf6b5a4b098149d->0e06bc35611e505e372de7f8cdf265e6d6dbc311",
        "individual-safety-review:not-complete",
        "privacy-telemetry-review:not-complete",
        "install-smoke:not-run",
        "authentication-review:not-complete",
        "authentication-scopes-and-revocation:not-complete",
        "cost-review:not-complete",
        "dependency-review:not-complete",
        "trust-review:not-complete",
        "telemetry-default-on:queries-responses-errors-code-context-optional-prompt",
        "hooks:telemetry-activation",
        "mutation-surface:allow-mutations",
        "preview-store-and-browser-open:not-smoke-tested",
        "dynamic-install-surface:shopify-cli-at-latest",
        "dynamic-install-surface:hermes-raw-main",
        "dynamic-install-surface:pi-git",
        "dynamic-install-surface:npx-skills-add",
        "target-unknown:claude-code/darwin",
        "target-unknown:claude-code/linux",
        "target-unknown:claude-code/win32"
      ]),
      revisionBinding: "exact",
      providedCapabilityIds: [
        "operate-stores-and-marketplaces",
        "manage-product-catalogs-and-listings",
        "run-promotions-and-analyze-revenue"
      ],
      capabilityEvidenceIds: [
        "shopify-ai-toolkit-catalog-listings-0e06bc35611e",
        "shopify-ai-toolkit-promotion-revenue-0e06bc35611e",
        "shopify-ai-toolkit-store-operations-0e06bc35611e"
      ],
      permissions: expect.objectContaining({
        status: "observed",
        value: expect.arrayContaining([
          "telemetry-default-on",
          "endpoint:https://shopify.dev/mcp/usage",
          "user-prompt:verbatim-up-to-2000-characters"
        ]),
        evidence: expect.arrayContaining([expect.objectContaining({ path: "README.md" })])
      }),
      license: expect.objectContaining({
        status: "observed",
        value: "MIT",
        evidence: expect.arrayContaining([expect.objectContaining({ path: "LICENSE" })])
      })
    }));
    expect(candidate).not.toHaveProperty("claudeInstall");
    expect(index.candidateEvidence.filter(({ candidateId }) => candidateId === "shopify-ai-toolkit"))
      .toHaveLength(3);

    expect(buildDecisionPlan(index, {
      domainIds: ["commerce"],
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    })).toMatchObject({
      status: "held",
      planKind: "complete",
      primary: null,
      complement: null,
      coverageIncomplete: true,
      uncoveredCapabilityIds: expect.arrayContaining(["operate-stores-and-marketplaces"])
    });
    for (const platform of ["linux", "win32"] as const) {
      expect(buildDecisionPlan(index, {
        domainIds: ["commerce"],
        runtime: "claude-code",
        platform,
        asOf: index.observedThrough
      })).toMatchObject({
        status: "held",
        primary: null,
        coverageIncomplete: true,
        uncoveredCapabilityIds: expect.arrayContaining(["operate-stores-and-marketplaces"])
      });
    }
  });

  it("holds all 20 routes for review while preserving discovery metadata", async () => {
    const artifacts = await generateAll(root);
    const index = JSON.parse(artifacts.decisionIndex) as DecisionIndex;

    const research = buildDecisionPlan(index, {
      domainIds: ["research-and-intelligence"],
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    });
    expect(research).toMatchObject({
      status: "held",
      planKind: "complete",
      primary: null,
      complement: null,
      coverageIncomplete: true,
      uncoveredCapabilityIds: expect.arrayContaining([
        "verify-sources-and-claims",
        "synthesize-cited-evidence"
      ])
    });

    const software = buildDecisionPlan(index, {
      domainIds: ["software-engineering"],
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    });
    expect(software).toMatchObject({
      status: "held",
      planKind: "complete",
      primary: null,
      complement: null,
      coverageIncomplete: true,
      uncoveredCapabilityIds: expect.arrayContaining([
        "turn-requirements-into-specifications",
        "document-and-prepare-software-releases"
      ])
    });

    let executablePartialRoutes = 0;
    let discoveryOnlyRoutes = 0;
    for (const domainId of COMPLETE_V1_DOMAIN_IDS) {
      const plan = buildDecisionPlan(index, {
        domainIds: [domainId],
        runtime: "claude-code",
        platform: "darwin",
        asOf: index.observedThrough
      });
      const route = index.starterRoutes?.find((candidate) => candidate.domainId === domainId);
      const eligibleCandidateIds = new Set(route?.orderedCandidateIds.filter((candidateId) =>
        index.candidates.find(({ id }) => id === candidateId)?.state === "eligible-with-disclosures"
      ));
      const executable = route !== undefined
        && [...route.directEvidenceIds, ...route.inferredEvidenceIds]
          .some((evidenceId) => {
            const evidence = index.candidateEvidence.find(({ id }) => id === evidenceId);
            return evidence?.current === true && eligibleCandidateIds.has(evidence.candidateId);
          });
      if (executable) {
        executablePartialRoutes += 1;
        expect(plan, domainId).toMatchObject({
          status: "eligible-with-disclosures",
          planKind: "starter-partial",
          coverageIncomplete: true
        });
        expect(plan.primary, domainId).not.toBeNull();
      } else {
        discoveryOnlyRoutes += 1;
        expect(plan, domainId).toMatchObject({
          status: "held",
          planKind: "complete",
          primary: null,
          complement: null,
          coverageIncomplete: true
        });
      }
      expect(plan.uncoveredCapabilityIds.length, domainId).toBeGreaterThan(0);
    }
    expect(executablePartialRoutes).toBe(0);
    expect(discoveryOnlyRoutes).toBe(20);

    expect(buildDecisionPlan(index, {
      domainIds: ["documents-and-knowledge"],
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    })).toMatchObject({ status: "held", primary: null, complement: null });
    expect(buildDecisionPlan(index, {
      domainIds: ["commerce"],
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    })).toMatchObject({ status: "held", primary: null, complement: null });

    expect(index.starterRoutes?.find(({ domainId }) => domainId === "research-and-intelligence"))
      .toEqual(expect.objectContaining({
        orderedCandidateIds: [],
        unsupportedCapabilityIds: expect.arrayContaining(["source-discovery-and-web-research"])
      }));
    expect(index.candidateEvidence.filter(({ candidateId }) => candidateId === "exa")).toEqual([]);
    expect(index.candidates.find(({ id }) => id === "notion")).toMatchObject({
      id: "notion",
      state: "held"
    });
  });

  it("renders deterministic honest 20-row route availability tables from the decision index", async () => {
    const artifacts = await generateAll(root);
    const index = JSON.parse(artifacts.decisionIndex) as DecisionIndex;

    for (const [catalog, heading, executable, discoveryOnly] of [
      [artifacts.catalogKo, "## 경로 가용성", "실행 가능 부분 경로", "보류/발견 전용"],
      [artifacts.catalogEn, "## Route Availability", "Executable partial", "Pending/discovery-only"]
    ] as const) {
      const table = markdownSection(catalog, heading);
      const rows = table.split("\n").filter((line) => line.startsWith("| ")).slice(2);

      expect(rows).toHaveLength(20);
      expect(rows.filter((row) => row.includes(`| ${executable} |`))).toHaveLength(0);
      expect(rows.filter((row) => row.includes(`| ${discoveryOnly} |`))).toHaveLength(20);
      expect(rows.map((row) => row.split("|")[1]!.trim())).toEqual(index.profiles.map(({ domainId }) => domainId));
      expect(table).toContain(index.observedThrough);
      expect(table).toContain(index.catalogExpiresAt);
    }
  });

  it("keeps Windsor held without an install binding during marketplace review", async () => {
    const artifacts = await generateAll(root);
    const index = JSON.parse(artifacts.decisionIndex) as DecisionIndex;

    const validated = validateDecisionIndex(index);
    const commercePlan = buildDecisionPlan(validated, {
      domainIds: ["commerce"],
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    });

    const windsor = index.candidates.find(({ id }) => id === "windsor-ai");
    expect(windsor).toEqual(expect.objectContaining({
      id: "windsor-ai",
      state: "held",
      stateReasons: expect.arrayContaining([
        "marketplace-listed",
        "individual-safety-review:not-complete",
        "official-marketplace-selection:review-required",
        "revision-binding:unavailable",
        "compatibility-inference:official-source-bound",
        "target-verified:claude-code/darwin"
      ]),
      permissions: { status: "unknown", evidence: [] },
      license: { status: "unknown", evidence: [] },
      trust: { status: "unknown", evidence: [] },
      dependencies: { status: "unknown", evidence: [] }
    }));
    expect(windsor).not.toHaveProperty("claudeInstall");
    expect(commercePlan).toMatchObject({
      status: "held",
      planKind: "complete",
      coverageIncomplete: true,
      primary: null,
      complement: null
    });
  });
});

function markdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start, `missing ${heading}`).toBeGreaterThanOrEqual(0);
  const next = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, next === -1 ? content.length : next);
}
