import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTestTimeout } from "../../vitest.config.js";
import {
  validateCapabilityCollection,
  validateCatalogContract,
  validateCategoryCollection,
  validateCompletePack
} from "../../src/contracts/complete-v1.js";
import { derivePackAvailability } from "../../src/catalog/availability.js";
import { validateCompleteV1Graph } from "../../src/catalog/validate-graph.js";
import { generateAll } from "../../src/generate/all.js";
import { loadYaml, validateDomain } from "../../src/manifest/load.js";
import { loadCompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import { loadManifestRepository } from "../../src/manifest/repository.js";
import {
  COMPLETE_V1_PACK_IDS,
  type ProviderManifest,
  type ProviderSelectionManifest,
  type ProviderTargetEligibility
} from "../../src/model/complete-v1.js";

const require = createRequire(import.meta.url);
const expectedIdentities = require("../fixtures/catalog/v2/expected-identities.json") as ExpectedIdentities;
const expectedCoverage = require("../fixtures/catalog/v2/expected-coverage.json") as ExpectedCoverage;
const repositoryRoot = resolve(".");
const WAVE_ONE_DOMAIN_IDS = [
  "research-and-intelligence",
  "strategy-and-decision",
  "writing-and-publishing",
  "marketing-and-growth",
  "promotion-and-distribution"
] as const;
const WAVE_ONE_PACKS = [
  { id: "question-to-cited-research-brief", domainId: "research-and-intelligence" },
  { id: "competitor-landscape-to-opportunity-map", domainId: "research-and-intelligence" },
  { id: "customer-interviews-to-insights", domainId: "research-and-intelligence" },
  { id: "evidence-to-strategic-decision", domainId: "strategy-and-decision" },
  { id: "idea-to-edited-article", domainId: "writing-and-publishing" },
  { id: "source-to-multilingual-publication", domainId: "writing-and-publishing" },
  { id: "product-to-positioning-and-offer", domainId: "marketing-and-growth" },
  { id: "keyword-to-ranked-content", domainId: "marketing-and-growth" },
  { id: "launch-plan-to-multichannel-campaign", domainId: "promotion-and-distribution" },
  { id: "long-form-to-social-distribution", domainId: "promotion-and-distribution" }
] as const;
const WAVE_TWO_DOMAIN_IDS = [
  "sales-and-customer",
  "product-management",
  "project-management",
  "software-engineering",
  "devops-and-security"
] as const;
const WAVE_TWO_PACKS = [
  { id: "account-research-to-personalized-outreach", domainId: "sales-and-customer" },
  { id: "discovery-call-to-proposal", domainId: "sales-and-customer" },
  { id: "customer-problem-to-validated-prd", domainId: "product-management" },
  { id: "prd-to-prioritized-roadmap", domainId: "product-management" },
  { id: "project-brief-to-execution-board", domainId: "project-management" },
  { id: "repository-to-implementation-plan", domainId: "software-engineering" },
  { id: "spec-to-tested-feature", domainId: "software-engineering" },
  { id: "bug-report-to-verified-fix", domainId: "software-engineering" },
  { id: "service-to-ci-cd-deployment", domainId: "devops-and-security" },
  { id: "incident-alert-to-postmortem", domainId: "devops-and-security" },
  { id: "application-to-security-review", domainId: "devops-and-security" }
] as const;
const WAVE_THREE_PACKS = [
  { id: "use-case-to-agent-design", domainId: "ai-agents-and-automation" },
  { id: "prototype-to-evaluated-agent", domainId: "ai-agents-and-automation" },
  { id: "raw-data-to-validated-dataset", domainId: "data-and-analytics" },
  { id: "business-question-to-dashboard", domainId: "data-and-analytics" },
  { id: "brief-to-accessible-interface", domainId: "design-and-brand" },
  { id: "brand-strategy-to-visual-system", domainId: "design-and-brand" },
  { id: "topic-to-recording-ready-script", domainId: "video-and-audio" },
  { id: "raw-footage-to-published-video", domainId: "video-and-audio" },
  { id: "long-video-to-multiplatform-clips", domainId: "video-and-audio" },
  { id: "meeting-to-decisions-and-actions", domainId: "documents-and-knowledge" },
  { id: "source-files-to-polished-document", domainId: "documents-and-knowledge" }
] as const;
const WAVE_FOUR_PACKS = [
  { id: "manual-process-to-maintained-sop", domainId: "business-operations" },
  { id: "repetitive-work-to-approved-automation", domainId: "business-operations" },
  { id: "transactions-to-management-report", domainId: "finance-and-accounting" },
  { id: "product-idea-to-store-listing", domainId: "commerce" },
  { id: "role-need-to-interview-scorecard", domainId: "people-and-training" },
  { id: "expertise-to-training-program", domainId: "people-and-training" },
  { id: "contract-to-risk-and-revision-brief", domainId: "legal-risk-and-compliance" },
  { id: "regulation-to-compliance-checklist", domainId: "legal-risk-and-compliance" }
] as const;
const WAVE_THREE_DOMAIN_IDS = [
  "ai-agents-and-automation",
  "data-and-analytics",
  "design-and-brand",
  "video-and-audio",
  "documents-and-knowledge"
] as const;
const WAVE_FOUR_DOMAIN_IDS = [
  "business-operations",
  "finance-and-accounting",
  "commerce",
  "people-and-training",
  "legal-risk-and-compliance"
] as const;
const MATERIALIZED_TAXONOMY_DOMAIN_IDS = [
  ...WAVE_ONE_DOMAIN_IDS,
  ...WAVE_TWO_DOMAIN_IDS,
  ...WAVE_THREE_DOMAIN_IDS
] as const;
const COMPLETE_TAXONOMY_DOMAIN_IDS = [
  ...MATERIALIZED_TAXONOMY_DOMAIN_IDS,
  ...WAVE_FOUR_DOMAIN_IDS
] as const;
const HUMAN_REVIEW_DOMAIN_IDS = new Set([
  "finance-and-accounting",
  "people-and-training",
  "legal-risk-and-compliance"
]);
const HUMAN_REVIEW_BOUNDARY = {
  ko: "자격 있는 담당자의 검토를 지원하며 최종 판단이나 승인을 대신하지 않는다.",
  en: "It supports qualified human review and does not replace final judgment or approval."
} as const;

describe("complete-v1 canonical catalog", () => {
  it("matches the independently repeated exact identity fixture", async () => {
    const catalog = validateCatalogContract(
      await loadYaml(joinRepositoryPath("manifests/catalog.yaml"))
    );

    expect(catalog.domainIds).toEqual(expectedIdentities.domainIds);
    expect(catalog.categoryIds).toEqual(expectedIdentities.categoryIds);
    expect(catalog.capabilityIds).toEqual(expectedIdentities.capabilityIds);
    expect(catalog.initialPackIds).toEqual(expectedIdentities.initialPackIds);
    expect(catalog.replacements).toEqual(expectedIdentities.replacements);
  });

  it("has complete, unique ownership coverage independent of the catalog document", () => {
    const categoryIds = expectedCoverage.domains.flatMap(({ categoryIds }) => categoryIds);
    const capabilities = expectedCoverage.domains.flatMap(({ capabilities }) => capabilities);
    const capabilityIds = capabilities.map(({ id }) => id);
    const coveredCategoryIds = capabilities.flatMap(({ categoryIds }) => categoryIds);

    expect(expectedCoverage.domains.map(({ id }) => id)).toEqual(expectedIdentities.domainIds);
    expect(categoryIds).toEqual(expectedIdentities.categoryIds);
    expect(capabilityIds).toEqual(expectedIdentities.capabilityIds);
    expect(new Set(categoryIds).size).toBe(281);
    expect(new Set(capabilityIds).size).toBe(147);
    expect(new Set(coveredCategoryIds).size).toBe(281);
    expect(coveredCategoryIds.slice().sort()).toEqual(categoryIds.slice().sort());
    for (const domain of expectedCoverage.domains) {
      for (const capability of domain.capabilities) {
        expect(domain.categoryIds).toEqual(expect.arrayContaining(capability.categoryIds));
      }
    }
  });

  it("materializes the exact wave-one domain and category identities", async () => {
    const wave = await loadWaveOneTaxonomy();
    const expected = expectedCoverage.domains.slice(0, WAVE_ONE_DOMAIN_IDS.length);

    expect(expected.map(({ id }) => id)).toEqual(WAVE_ONE_DOMAIN_IDS);
    expect(wave.map(({ domain }) => domain.id)).toEqual(WAVE_ONE_DOMAIN_IDS);
    expect(wave.map(({ categoryCollection }) => categoryCollection.domainId)).toEqual(
      WAVE_ONE_DOMAIN_IDS
    );

    for (const [index, entry] of wave.entries()) {
      const expectedDomain = expected[index]!;
      expect(entry.domain.categories).toEqual(expectedDomain.categoryIds);
      expect(entry.categoryCollection.categories.map(({ id }) => id)).toEqual(
        expectedDomain.categoryIds
      );
      expect(entry.domain.languages).toEqual(["en", "ko"]);
      expect(entry.domain.regions).toEqual(["global"]);
      expect(entry.domain.maintainers).toEqual(["seunghyeon1004"]);
      expect(entry.domain.version).toBe("0.1.0");
      expect(entry.domain.status).toBe("draft");
      expect(entry.categoryCollection.categories.every(({ status }) => status === "draft")).toBe(true);
    }
  });

  it("materializes exact wave-one capabilities with sole ownership and complete coverage", async () => {
    const wave = await loadWaveOneTaxonomy();
    const expected = expectedCoverage.domains.slice(0, WAVE_ONE_DOMAIN_IDS.length);
    const categoryIds = wave.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => id)
    );
    const coveredCategoryIds = wave.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.flatMap(({ categoryIds: coveredIds }) => coveredIds)
    );
    const capabilityIds = wave.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.map(({ id }) => id)
    );

    expect(new Set(categoryIds).size).toBe(categoryIds.length);
    expect(new Set(capabilityIds).size).toBe(capabilityIds.length);
    expect(new Set(coveredCategoryIds)).toEqual(new Set(categoryIds));

    for (const [index, entry] of wave.entries()) {
      const expectedDomain = expected[index]!;
      expect(entry.capabilityCollection.domainId).toBe(expectedDomain.id);
      expect(entry.capabilityCollection.capabilities.map(({ id, categoryIds }) => ({ id, categoryIds })))
        .toEqual(expectedDomain.capabilities);
      expect(entry.capabilityCollection.capabilities.every(({ ownerDomainId }) =>
        ownerDomainId === expectedDomain.id
      )).toBe(true);
      expect(entry.capabilityCollection.capabilities.every(({ status }) => status === "draft")).toBe(true);
    }
  });

  it("materializes exactly the ordered wave-one draft pack identities", async () => {
    const packs = await loadWaveOnePacks();

    expect(WAVE_ONE_PACKS.map(({ id }) => id)).toEqual(expectedIdentities.initialPackIds.slice(0, 10));
    expect(packs.map(({ id }) => id)).toEqual(WAVE_ONE_PACKS.map(({ id }) => id));

    for (const [index, pack] of packs.entries()) {
      const expected = WAVE_ONE_PACKS[index]!;
      expect(pack.domainId).toBe(expected.domainId);
      expect(pack.routingProfileId).toBe(expected.domainId);
      expect(pack.minimumProviderTrust).toBe("trusted");
      expect(pack.platforms).toEqual(["darwin", "linux", "win32"]);
      expect(pack.replacesPackIds).toEqual([]);
      expect(pack.version).toBe("0.1.0");
      expect(pack.status).toBe("draft");
      expect(pack.outcome.ko.trim().length).toBeGreaterThan(20);
      expect(pack.outcome.en.trim().length).toBeGreaterThan(40);
      expect(pack.inputs.every((value) => value.trim().length > 10)).toBe(true);
      expect(pack.outputs.every((value) => value.trim().length > 10)).toBe(true);
      expect(pack.completionCriteria.every((value) => value.trim().length > 20)).toBe(true);
    }
  });

  it("resolves wave-one pack references within each owner domain and reaches all 62 categories", async () => {
    const packs = await loadWaveOnePacks();
    const taxonomy = await loadWaveOneTaxonomy();
    const capabilityById = new Map(taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.map((capability) => [capability.id, capability] as const)
    ));
    const categoryOwnerById = new Map(taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => [id, categoryCollection.domainId] as const)
    ));
    const reachableCategoryIds = new Set<string>();

    for (const pack of packs) {
      const capabilityGroups = [
        pack.requiredCapabilityIds,
        pack.recommendedCapabilityIds,
        pack.optionalCapabilityIds
      ];
      const declaredCapabilityIds = capabilityGroups.flat();
      expect(new Set(declaredCapabilityIds).size).toBe(declaredCapabilityIds.length);

      const declaredCategoryIds = new Set<string>();
      for (const capabilityId of declaredCapabilityIds) {
        const capability = capabilityById.get(capabilityId);
        expect(capability, `${pack.id} references ${capabilityId}`).toBeDefined();
        expect(capability!.ownerDomainId).toBe(pack.domainId);
        for (const categoryId of capability!.categoryIds) {
          declaredCategoryIds.add(categoryId);
        }
      }
      expect(new Set(pack.categoryIds)).toEqual(declaredCategoryIds);
      for (const categoryId of pack.categoryIds) {
        expect(categoryOwnerById.get(categoryId)).toBe(pack.domainId);
      }

      for (const capabilityId of [
        ...pack.requiredCapabilityIds,
        ...pack.recommendedCapabilityIds
      ]) {
        for (const categoryId of capabilityById.get(capabilityId)!.categoryIds) {
          reachableCategoryIds.add(categoryId);
        }
      }
    }

    const waveOneCategoryIds = taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => id)
    );
    expect(waveOneCategoryIds).toHaveLength(62);
    expect(reachableCategoryIds).toEqual(new Set(waveOneCategoryIds));
  });

  it("rejects duplicated behavior text across otherwise valid scenario specs", () => {
    const seenBehaviorTexts = new Set([
      "Keeps the original evidence boundary visible in the first scenario."
    ]);
    const mutatedScenario = {
      expectedBehaviors: [
        "Records a distinct expected behavior for the mutated scenario."
      ],
      forbiddenBehaviors: [
        "Keeps the original evidence boundary visible in the first scenario."
      ]
    };

    expect(() => addUniqueBehaviorTexts(seenBehaviorTexts, mutatedScenario)).toThrow(
      "Duplicate scenario behavior text"
    );
  });

  it("loads 63 exact, substantive, domain-specific wave-one and wave-two scenario specs", async () => {
    const packs = await loadWaveOneAndTwoPacks();
    const prompts = new Set<string>();
    const behaviorTexts = new Set<string>();
    let scenarioCount = 0;

    for (const pack of packs) {
      expect(pack.scenarios.map(({ type }) => type)).toEqual(["normal", "boundary", "refusal"]);
      const scenarioDirectory = joinRepositoryPath(`tests/evaluations/packs/${pack.id}`);
      expect((await readdir(scenarioDirectory)).filter((name) => name.endsWith(".yaml")).sort()).toEqual([
        "boundary.yaml",
        "normal.yaml",
        "refusal.yaml"
      ]);
      for (const scenarioReference of pack.scenarios) {
        const expectedPath = `tests/evaluations/packs/${pack.id}/${scenarioReference.type}.yaml`;
        expect(scenarioReference.id).toBe(`${pack.id}-${scenarioReference.type}`);
        expect(scenarioReference.path).toBe(expectedPath);
        const scenario = await loadScenario(expectedPath);
        expect(Object.keys(scenario).sort()).toEqual([
          "caseType",
          "expectedBehaviors",
          "forbiddenBehaviors",
          "id",
          "packId",
          "prompt"
        ]);
        expect(scenario.id).toBe(scenarioReference.id);
        expect(scenario.packId).toBe(pack.id);
        expect(scenario.caseType).toBe(scenarioReference.type);
        expect(scenario.prompt.trim().length).toBeGreaterThan(40);
        expect(scenario.expectedBehaviors.length).toBeGreaterThanOrEqual(2);
        expect(scenario.forbiddenBehaviors.length).toBeGreaterThanOrEqual(1);
        expect(scenario.expectedBehaviors.every((value) => value.trim().length > 20)).toBe(true);
        expect(scenario.forbiddenBehaviors.every((value) => value.trim().length > 20)).toBe(true);
        expect(prompts.has(scenario.prompt)).toBe(false);
        prompts.add(scenario.prompt);
        addUniqueBehaviorTexts(behaviorTexts, scenario);
        scenarioCount += 1;

        const scenarioText = [
          scenario.prompt,
          ...scenario.expectedBehaviors,
          ...scenario.forbiddenBehaviors
        ].join(" ");
        if (pack.domainId === "research-and-intelligence") {
          expect(scenarioText).toMatch(/source/i);
          expect(scenarioText).toMatch(/date/i);
          expect(scenarioText).toMatch(/fact/i);
          expect(scenarioText).toMatch(/inference/i);
          if (scenario.caseType === "refusal") {
            expect(scenarioText).toMatch(/refus/i);
            expect(scenarioText).toMatch(/unsupported|unverified/i);
          }
        }
        if (pack.id === "evidence-to-strategic-decision" && scenario.caseType === "refusal") {
          expect(scenarioText).toMatch(/uncertainty/i);
          expect(scenarioText).toMatch(/human approval/i);
          expect(scenarioText).toMatch(/refus|does not approve/i);
        }
        if (pack.domainId === "sales-and-customer" && scenario.caseType === "refusal") {
          expect(scenarioText).toMatch(/privacy|personal|crm/i);
          expect(scenarioText).toMatch(/spam|unsupported|unauthorized/i);
        }
        if (pack.domainId === "product-management" && scenario.caseType === "refusal") {
          expect(scenarioText).toMatch(/evidence|experiment|demand/i);
          expect(scenarioText).toMatch(/approval|manipulat|refus/i);
        }
        if (pack.domainId === "project-management" && scenario.caseType === "refusal") {
          expect(scenarioText).toMatch(/schedule|resource|change/i);
          expect(scenarioText).toMatch(/approval|evidence|refus/i);
        }
        if (pack.domainId === "software-engineering" && scenario.caseType === "refusal") {
          expect(scenarioText).toMatch(/repository|test|security|secret|destructive/i);
          expect(scenarioText).toMatch(/evidence|scope|verification|refus/i);
        }
        if (pack.domainId === "devops-and-security" && scenario.caseType === "refusal") {
          expect(scenarioText).toMatch(/credential|security control|production|rollback|evidence|live/i);
          expect(scenarioText).toMatch(/read-only|approval|refus/i);
        }
      }
    }

    expect(scenarioCount).toBe(63);
    expect(prompts.size).toBe(63);
    expect(behaviorTexts.size).toBe(189);
  });

  it("materializes exactly the first 21 ordered v2 pack identities including wave two", async () => {
    const packDirectory = joinRepositoryPath("manifests/complete-v1-packs");
    const fileIds = (await readdir(packDirectory))
      .filter((name) => name.endsWith(".yaml"))
      .map((name) => name.slice(0, -".yaml".length))
      .sort();
    const packs = await loadWaveTwoPacks();
    const expectedIds = expectedIdentities.initialPackIds.slice(0, 21);

    expect(WAVE_TWO_PACKS.map(({ id }) => id)).toEqual(expectedIds.slice(10));
    expect(fileIds.filter((id) => expectedIds.includes(id))).toEqual(expectedIds.slice().sort());
    expect(packs.map(({ id }) => id)).toEqual(WAVE_TWO_PACKS.map(({ id }) => id));

    for (const [index, pack] of packs.entries()) {
      const expected = WAVE_TWO_PACKS[index]!;
      expect(pack.domainId).toBe(expected.domainId);
      expect(pack.routingProfileId).toBe(expected.domainId);
      expect(pack.minimumProviderTrust).toBe("trusted");
      expect(pack.platforms).toEqual(["darwin", "linux", "win32"]);
      expect(pack.replacesPackIds).toEqual([]);
      expect(pack.version).toBe("0.1.0");
      expect(pack.status).toBe("draft");
      expect(pack.outcome.ko.trim().length).toBeGreaterThan(20);
      expect(pack.outcome.en.trim().length).toBeGreaterThan(40);
      expect(pack.inputs.every((value) => value.trim().length > 10)).toBe(true);
      expect(pack.outputs.every((value) => value.trim().length > 10)).toBe(true);
      expect(pack.completionCriteria.every((value) => value.trim().length > 20)).toBe(true);
    }
  });

  it("resolves wave-two pack references within each owner domain and reaches all 72 categories without optional-only edges", async () => {
    const packs = await loadWaveTwoPacks();
    const taxonomy = await loadTaxonomy(WAVE_TWO_DOMAIN_IDS);
    const capabilityById = new Map(taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.map((capability) => [capability.id, capability] as const)
    ));
    const categoryOwnerById = new Map(taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => [id, categoryCollection.domainId] as const)
    ));
    const reachableCategoryIds = new Set<string>();
    const referencedCapabilityIds = new Set<string>();

    for (const pack of packs) {
      const declaredCapabilityIds = [
        ...pack.requiredCapabilityIds,
        ...pack.recommendedCapabilityIds,
        ...pack.optionalCapabilityIds
      ];
      expect(new Set(declaredCapabilityIds).size).toBe(declaredCapabilityIds.length);
      expect(pack.optionalCapabilityIds).toEqual([]);

      const declaredCategoryIds = new Set<string>();
      for (const capabilityId of declaredCapabilityIds) {
        const capability = capabilityById.get(capabilityId);
        expect(capability, `${pack.id} references ${capabilityId}`).toBeDefined();
        expect(capability!.ownerDomainId).toBe(pack.domainId);
        for (const categoryId of capability!.categoryIds) {
          declaredCategoryIds.add(categoryId);
        }
      }
      expect(new Set(pack.categoryIds)).toEqual(declaredCategoryIds);
      for (const categoryId of pack.categoryIds) {
        expect(categoryOwnerById.get(categoryId)).toBe(pack.domainId);
      }

      for (const capabilityId of [
        ...pack.requiredCapabilityIds,
        ...pack.recommendedCapabilityIds
      ]) {
        referencedCapabilityIds.add(capabilityId);
        for (const categoryId of capabilityById.get(capabilityId)!.categoryIds) {
          reachableCategoryIds.add(categoryId);
        }
      }
    }

    const waveTwoCategoryIds = taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => id)
    );
    const waveTwoCapabilityIds = taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.map(({ id }) => id)
    );
    expect(waveTwoCategoryIds).toHaveLength(72);
    expect(waveTwoCapabilityIds).toHaveLength(38);
    expect(reachableCategoryIds).toEqual(new Set(waveTwoCategoryIds));
    expect(referencedCapabilityIds).toEqual(new Set(waveTwoCapabilityIds));
  });

  it("requires test evidence for the bug-report-to-verified-fix result", async () => {
    const packs = await loadWaveTwoPacks();
    const pack = packs.find(({ id }) => id === "bug-report-to-verified-fix");

    expect(pack).toBeDefined();
    expect(pack!.requiredCapabilityIds).toEqual([
      "test-and-debug-software",
      "review-refactor-and-optimize-software"
    ]);
    expect(pack!.recommendedCapabilityIds).toEqual([
      "document-and-prepare-software-releases"
    ]);
    expect(pack!.categoryIds).toEqual([
      "testing",
      "debugging",
      "review",
      "refactoring",
      "software-performance",
      "documentation",
      "release-readiness"
    ]);
    expect(pack!.outcome.ko).toContain("검증된 수정 결과");
    expect(pack!.outcome.en).toContain("verified fix result");
    expect(pack!.completionCriteria.join(" ")).toMatch(/verified fix result/i);
  });

  it("materializes exactly the first 32 ordered v2 pack identities including wave three", async () => {
    const packs = await loadWaveThreePacks();
    const expectedIds = expectedIdentities.initialPackIds.slice(0, 32);

    expect(WAVE_THREE_PACKS.map(({ id }) => id)).toEqual(expectedIds.slice(21));
    expect(packs.map(({ id }) => id)).toEqual(WAVE_THREE_PACKS.map(({ id }) => id));

    for (const [index, pack] of packs.entries()) {
      const expected = WAVE_THREE_PACKS[index]!;
      expect(pack.domainId).toBe(expected.domainId);
      expect(pack.routingProfileId).toBe(expected.domainId);
      expect(pack.minimumProviderTrust).toBe("trusted");
      expect(pack.platforms).toEqual(["darwin", "linux", "win32"]);
      expect(pack.replacesPackIds).toEqual([]);
      expect(pack.version).toBe("0.1.0");
      expect(pack.status).toBe("draft");
      expect(pack.outcome.ko.trim().length).toBeGreaterThan(20);
      expect(pack.outcome.en.trim().length).toBeGreaterThan(40);
      expect(pack.inputs.every((value) => value.trim().length > 10)).toBe(true);
      expect(pack.outputs.every((value) => value.trim().length > 10)).toBe(true);
      expect(pack.completionCriteria.every((value) => value.trim().length > 20)).toBe(true);
    }
  });

  it("resolves wave-three references within their owner domains and reaches all 78 categories without optional-only edges", async () => {
    const packs = await loadWaveThreePacks();
    const taxonomy = await loadTaxonomy(WAVE_THREE_DOMAIN_IDS);
    const capabilityById = new Map(taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.map((capability) => [capability.id, capability] as const)
    ));
    const categoryOwnerById = new Map(taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => [id, categoryCollection.domainId] as const)
    ));
    const reachableCategoryIds = new Set<string>();
    const referencedCapabilityIds = new Set<string>();

    for (const pack of packs) {
      const declaredCapabilityIds = [
        ...pack.requiredCapabilityIds,
        ...pack.recommendedCapabilityIds,
        ...pack.optionalCapabilityIds
      ];
      expect(new Set(declaredCapabilityIds).size).toBe(declaredCapabilityIds.length);
      expect(pack.optionalCapabilityIds).toEqual([]);

      const declaredCategoryIds = new Set<string>();
      for (const capabilityId of declaredCapabilityIds) {
        const capability = capabilityById.get(capabilityId);
        expect(capability, `${pack.id} references ${capabilityId}`).toBeDefined();
        expect(capability!.ownerDomainId).toBe(pack.domainId);
        capability!.categoryIds.forEach((categoryId) => declaredCategoryIds.add(categoryId));
      }
      expect(new Set(pack.categoryIds)).toEqual(declaredCategoryIds);
      pack.categoryIds.forEach((categoryId) =>
        expect(categoryOwnerById.get(categoryId)).toBe(pack.domainId)
      );

      for (const capabilityId of [
        ...pack.requiredCapabilityIds,
        ...pack.recommendedCapabilityIds
      ]) {
        referencedCapabilityIds.add(capabilityId);
        capabilityById.get(capabilityId)!.categoryIds.forEach((categoryId) =>
          reachableCategoryIds.add(categoryId)
        );
      }
    }

    const waveThreeCategoryIds = taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => id)
    );
    const waveThreeCapabilityIds = taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.map(({ id }) => id)
    );
    expect(waveThreeCategoryIds).toHaveLength(78);
    expect(waveThreeCapabilityIds).toHaveLength(40);
    expect(reachableCategoryIds).toEqual(new Set(waveThreeCategoryIds));
    expect(referencedCapabilityIds).toEqual(new Set(waveThreeCapabilityIds));
  });

  it("requires explicit accessibility completion criteria and normal-boundary evaluation evidence", async () => {
    const packs = await loadWaveThreePacks();
    const requirements = new Map<string, RegExp[]>([
      ["brief-to-accessible-interface", [/keyboard/i, /focus/i, /semantic/i, /contrast/i, /label/i, /responsive/i, /developer handoff/i]],
      ["brand-strategy-to-visual-system", [/contrast/i, /readab/i, /non-color/i, /accessible asset/i]],
      ["business-question-to-dashboard", [/accessible label/i, /table or text alternative/i, /color-independent/i]],
      ["topic-to-recording-ready-script", [/caption/i, /safe-area text/i, /audio intelligibility/i, /transcript/i, /format/i]],
      ["raw-footage-to-published-video", [/synchronized captions/i, /safe-area text/i, /audio intelligibility/i, /transcript/i, /format/i]],
      ["long-video-to-multiplatform-clips", [/synchronized captions/i, /safe-area text/i, /audio intelligibility/i, /transcript/i, /format/i]],
      ["meeting-to-decisions-and-actions", [/heading/i, /reading order/i, /alt text/i, /table headers/i, /searchable or accessible export/i]],
      ["source-files-to-polished-document", [/heading/i, /reading order/i, /alt text/i, /table headers/i, /searchable or accessible export/i]]
    ]);

    for (const [packId, expressions] of requirements) {
      const pack = packs.find(({ id }) => id === packId)!;
      const completionText = pack.completionCriteria.join(" ");
      const normal = await loadScenario(`tests/evaluations/packs/${packId}/normal.yaml`);
      const boundary = await loadScenario(`tests/evaluations/packs/${packId}/boundary.yaml`);
      const normalText = [normal.prompt, ...normal.expectedBehaviors, ...normal.forbiddenBehaviors].join(" ");
      const boundaryText = [boundary.prompt, ...boundary.expectedBehaviors, ...boundary.forbiddenBehaviors].join(" ");
      for (const expression of expressions) {
        expect(completionText, `${packId} completion: ${expression}`).toMatch(expression);
        expect(normalText, `${packId} normal: ${expression}`).toMatch(expression);
        expect(boundaryText, `${packId} boundary: ${expression}`).toMatch(expression);
      }
    }
  });

  it("adds 33 wave-three scenarios and preserves cumulative 96-prompt and 288-behavior uniqueness", async () => {
    const packs = await loadFirstThreeWavePacks();
    const prompts = new Set<string>();
    const behaviorTexts = new Set<string>();
    let scenarioCount = 0;

    for (const pack of packs) {
      expect(pack.scenarios.map(({ type }) => type)).toEqual(["normal", "boundary", "refusal"]);
      const scenarioDirectory = joinRepositoryPath(`tests/evaluations/packs/${pack.id}`);
      expect((await readdir(scenarioDirectory)).filter((name) => name.endsWith(".yaml")).sort()).toEqual([
        "boundary.yaml",
        "normal.yaml",
        "refusal.yaml"
      ]);
      for (const scenarioReference of pack.scenarios) {
        const expectedPath = `tests/evaluations/packs/${pack.id}/${scenarioReference.type}.yaml`;
        expect(scenarioReference.id).toBe(`${pack.id}-${scenarioReference.type}`);
        expect(scenarioReference.path).toBe(expectedPath);
        const scenario = await loadScenario(expectedPath);
        expect(Object.keys(scenario).sort()).toEqual([
          "caseType",
          "expectedBehaviors",
          "forbiddenBehaviors",
          "id",
          "packId",
          "prompt"
        ]);
        expect(scenario).toMatchObject({
          id: scenarioReference.id,
          packId: pack.id,
          caseType: scenarioReference.type
        });
        expect(scenario.prompt.trim().length).toBeGreaterThan(40);
        expect(scenario.expectedBehaviors).toHaveLength(2);
        expect(scenario.forbiddenBehaviors).toHaveLength(1);
        expect(scenario.expectedBehaviors.every((value) => value.trim().length > 20)).toBe(true);
        expect(scenario.forbiddenBehaviors.every((value) => value.trim().length > 20)).toBe(true);
        expect(prompts.has(scenario.prompt)).toBe(false);
        prompts.add(scenario.prompt);
        addUniqueBehaviorTexts(behaviorTexts, scenario);
        scenarioCount += 1;
      }
    }

    expect(scenarioCount).toBe(96);
    expect(prompts.size).toBe(96);
    expect(behaviorTexts.size).toBe(288);
  });

  it("enforces domain-specific refusal boundaries for every wave-three owner", async () => {
    const packs = await loadWaveThreePacks();
    const refusalTextByDomain = new Map<string, string>();
    for (const pack of packs) {
      const refusal = await loadScenario(`tests/evaluations/packs/${pack.id}/refusal.yaml`);
      const text = [refusal.prompt, ...refusal.expectedBehaviors, ...refusal.forbiddenBehaviors].join(" ");
      refusalTextByDomain.set(pack.domainId, `${refusalTextByDomain.get(pack.domainId) ?? ""} ${text}`);
    }

    const requirements = new Map<string, RegExp[]>([
      ["ai-agents-and-automation", [/credential|secret/i, /prompt injection/i, /unapproved (tool|live action)/i, /high-impact autonomous approval/i, /memory privacy|retention/i, /guardrail bypass/i, /false evaluation pass/i, /read-only/i, /sandbox/i, /human approval/i]],
      ["data-and-analytics", [/re-identification/i, /manipulation|deletion/i, /fabricated statistics/i, /fabricated forecast/i, /discriminatory segmentation/i, /evidence-free dashboard/i]],
      ["design-and-brand", [/deceptive|dark-pattern/i, /false accessibility/i, /unlicensed (brand|asset)/i]],
      ["video-and-audio", [/nonconsensual impersonation|deepfake/i, /copyright/i, /music rights/i, /fabricated evidence/i, /unapproved publishing/i, /captions removal/i]],
      ["documents-and-knowledge", [/confidential data/i, /OCR hallucination/i, /tampering/i, /unauthorized retention/i, /unauthorized deletion/i, /unauthorized publication/i]]
    ]);

    for (const [domainId, expressions] of requirements) {
      const refusalText = refusalTextByDomain.get(domainId)!;
      for (const expression of expressions) {
        expect(refusalText, `${domainId} refusal: ${expression}`).toMatch(expression);
      }
    }
  });

  it("materializes the exact final 40-pack identity and canonical wave counts", async () => {
    const packDirectory = joinRepositoryPath("manifests/complete-v1-packs");
    const fileIds = (await readdir(packDirectory))
      .filter((name) => name.endsWith(".yaml"))
      .map((name) => name.slice(0, -".yaml".length))
      .sort();
    const packs = await loadWaveFourPacks();
    const catalog = validateCatalogContract(await loadYaml(joinRepositoryPath("manifests/catalog.yaml")));

    expect(WAVE_FOUR_PACKS.map(({ id }) => id)).toEqual(expectedIdentities.initialPackIds.slice(32));
    expect(packs.map(({ id }) => id)).toEqual(WAVE_FOUR_PACKS.map(({ id }) => id));
    expect([...COMPLETE_V1_PACK_IDS]).toEqual(expectedIdentities.initialPackIds);
    expect(catalog.initialPackIds).toEqual([...COMPLETE_V1_PACK_IDS]);
    expect(fileIds).toEqual([...COMPLETE_V1_PACK_IDS].sort());
    expect([
      WAVE_ONE_PACKS.length,
      WAVE_TWO_PACKS.length,
      WAVE_THREE_PACKS.length,
      WAVE_FOUR_PACKS.length
    ]).toEqual([10, 11, 11, 8]);

    for (const [index, pack] of packs.entries()) {
      const expected = WAVE_FOUR_PACKS[index]!;
      expect(pack.domainId).toBe(expected.domainId);
      expect(pack.routingProfileId).toBe(expected.domainId);
      expect(pack.minimumProviderTrust).toBe("trusted");
      expect(pack.platforms).toEqual(["darwin", "linux", "win32"]);
      expect(pack.replacesPackIds).toEqual([]);
      expect(pack.version).toBe("0.1.0");
      expect(pack.status).toBe("draft");
      expect(pack.outcome.ko.trim().length).toBeGreaterThan(40);
      expect(pack.outcome.en.trim().length).toBeGreaterThan(80);
      expect(pack.inputs.every((value) => value.trim().length > 10)).toBe(true);
      expect(pack.outputs.every((value) => value.trim().length > 10)).toBe(true);
      expect(pack.completionCriteria.every((value) => value.trim().length > 20)).toBe(true);
    }
  });

  it("resolves every wave-four capability and reaches all 69 categories without optional-only edges", async () => {
    const packs = await loadWaveFourPacks();
    const taxonomy = await loadTaxonomy(WAVE_FOUR_DOMAIN_IDS);
    const capabilityById = new Map(taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.map((capability) => [capability.id, capability] as const)
    ));
    const categoryOwnerById = new Map(taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => [id, categoryCollection.domainId] as const)
    ));
    const reachableCategoryIds = new Set<string>();
    const referencedCapabilityIds = new Set<string>();

    for (const pack of packs) {
      const declaredCapabilityIds = [
        ...pack.requiredCapabilityIds,
        ...pack.recommendedCapabilityIds,
        ...pack.optionalCapabilityIds
      ];
      expect(new Set(declaredCapabilityIds).size).toBe(declaredCapabilityIds.length);
      expect(pack.optionalCapabilityIds).toEqual([]);

      const declaredCategoryIds = new Set<string>();
      for (const capabilityId of declaredCapabilityIds) {
        const capability = capabilityById.get(capabilityId);
        expect(capability, `${pack.id} references ${capabilityId}`).toBeDefined();
        expect(capability!.ownerDomainId).toBe(pack.domainId);
        capability!.categoryIds.forEach((categoryId) => declaredCategoryIds.add(categoryId));
      }
      expect(new Set(pack.categoryIds)).toEqual(declaredCategoryIds);
      pack.categoryIds.forEach((categoryId) =>
        expect(categoryOwnerById.get(categoryId)).toBe(pack.domainId)
      );

      for (const capabilityId of [
        ...pack.requiredCapabilityIds,
        ...pack.recommendedCapabilityIds
      ]) {
        referencedCapabilityIds.add(capabilityId);
        capabilityById.get(capabilityId)!.categoryIds.forEach((categoryId) =>
          reachableCategoryIds.add(categoryId)
        );
      }
    }

    const waveFourCategoryIds = taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => id)
    );
    const waveFourCapabilityIds = taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities.map(({ id }) => id)
    );
    expect(waveFourCategoryIds).toHaveLength(69);
    expect(waveFourCapabilityIds).toHaveLength(36);
    expect(reachableCategoryIds).toEqual(new Set(waveFourCategoryIds));
    expect(referencedCapabilityIds).toEqual(new Set(waveFourCapabilityIds));
  });

  it("routes all packs through trusted broker profiles and preserves the exact high-impact set", async () => {
    const packs = await loadAllPacks();
    const highImpactPackIds = [
      "application-to-security-review",
      "bug-report-to-verified-fix",
      "contract-to-risk-and-revision-brief",
      "customer-problem-to-validated-prd",
      "evidence-to-strategic-decision",
      "incident-alert-to-postmortem",
      "prd-to-prioritized-roadmap",
      "prototype-to-evaluated-agent",
      "raw-data-to-validated-dataset",
      "raw-footage-to-published-video",
      "regulation-to-compliance-checklist",
      "repetitive-work-to-approved-automation",
      "repository-to-implementation-plan",
      "role-need-to-interview-scorecard",
      "service-to-ci-cd-deployment",
      "spec-to-tested-feature",
      "transactions-to-management-report",
      "use-case-to-agent-design"
    ];

    expect(packs).toHaveLength(40);
    expect(packs.filter(({ assuranceProfile }) => assuranceProfile === "high-impact").map(({ id }) => id).sort())
      .toEqual(highImpactPackIds);
    for (const pack of packs) {
      expect(pack.routingProfileId).toBe(pack.domainId);
      expect(pack.minimumProviderTrust).toBe("trusted");
      expect(pack).not.toHaveProperty("runtimeBundle");
      expect(pack).not.toHaveProperty("ownedSkillIds");
      expect(pack).not.toHaveProperty("trustRequirement");
      expect(pack.assuranceProfile).toBe(highImpactPackIds.includes(pack.id) ? "high-impact" : "standard");
    }
  });

  it("adds 24 wave-four scenarios and preserves cumulative 120-prompt and 360-behavior uniqueness", async () => {
    const packs = await loadAllPacks();
    const waveFourIds = new Set<string>(WAVE_FOUR_PACKS.map(({ id }) => id));
    const prompts = new Set<string>();
    const behaviorTexts = new Set<string>();
    let scenarioCount = 0;
    let waveFourScenarioCount = 0;

    for (const pack of packs) {
      expect(pack.scenarios.map(({ type }) => type)).toEqual(["normal", "boundary", "refusal"]);
      const scenarioDirectory = joinRepositoryPath(`tests/evaluations/packs/${pack.id}`);
      expect((await readdir(scenarioDirectory)).filter((name) => name.endsWith(".yaml")).sort()).toEqual([
        "boundary.yaml",
        "normal.yaml",
        "refusal.yaml"
      ]);
      for (const scenarioReference of pack.scenarios) {
        const expectedPath = `tests/evaluations/packs/${pack.id}/${scenarioReference.type}.yaml`;
        expect(scenarioReference).toEqual({
          id: `${pack.id}-${scenarioReference.type}`,
          type: scenarioReference.type,
          path: expectedPath
        });
        const scenario = await loadScenario(expectedPath);
        expect(Object.keys(scenario).sort()).toEqual([
          "caseType",
          "expectedBehaviors",
          "forbiddenBehaviors",
          "id",
          "packId",
          "prompt"
        ]);
        expect(scenario).toMatchObject({
          id: scenarioReference.id,
          packId: pack.id,
          caseType: scenarioReference.type
        });
        expect(scenario.prompt.trim().length).toBeGreaterThan(40);
        expect(scenario.expectedBehaviors).toHaveLength(2);
        expect(scenario.forbiddenBehaviors).toHaveLength(1);
        expect(scenario.expectedBehaviors.every((value) => value.trim().length > 20)).toBe(true);
        expect(scenario.forbiddenBehaviors.every((value) => value.trim().length > 20)).toBe(true);
        expect(prompts.has(scenario.prompt)).toBe(false);
        prompts.add(scenario.prompt);
        addUniqueBehaviorTexts(behaviorTexts, scenario);
        scenarioCount += 1;
        if (waveFourIds.has(pack.id)) {
          waveFourScenarioCount += 1;
        }
      }
    }

    expect(waveFourScenarioCount).toBe(24);
    expect(scenarioCount).toBe(120);
    expect(prompts.size).toBe(120);
    expect(behaviorTexts.size).toBe(360);
  });

  it("requires pack-specific qualified-human boundaries in every high-impact wave-four surface", async () => {
    const packs = await loadWaveFourPacks();
    const koreanOutcomeRequirements = new Map<string, RegExp[]>([
      ["transactions-to-management-report", [/거래|재무|회계/, /자격/, /검토|승인/, /대신하지|대체하지/]],
      ["role-need-to-interview-scorecard", [/채용|면접/, /자격/, /검토|승인/, /대신하지|대체하지/]],
      ["expertise-to-training-program", [/교육|평가/, /자격/, /검토|승인/, /대신하지|대체하지/]],
      ["contract-to-risk-and-revision-brief", [/계약|법률/, /자격/, /검토|승인/, /대신하지|대체하지/]],
      ["regulation-to-compliance-checklist", [/규제|컴플라이언스/, /자격/, /검토|승인/, /대신하지|대체하지/]]
    ]);
    const requirements = new Map<string, Record<"outcome" | "completion" | "refusal", RegExp[]>>([
      ["transactions-to-management-report", {
        outcome: [/source records/i, /assumptions/i, /qualified (finance|accounting|tax) reviewer/i],
        completion: [/never fabricates? (receipts|entries|statements)/i, /does not file tax/i, /qualified (finance|accounting|tax) reviewer/i],
        refusal: [/fabricat(ed|e) (receipts|entries|statements)/i, /tax filing|final (accounting|finance) decision/i, /qualified (finance|accounting|tax) reviewer/i]
      }],
      ["role-need-to-interview-scorecard", {
        outcome: [/job-related evidence/i, /protected-trait inference/i, /qualified human hiring approval/i],
        completion: [/discriminatory prox/i, /automated final hiring/i, /qualified human hiring approval/i],
        refusal: [/protected-trait inference/i, /discriminatory prox/i, /automated final hiring/i, /qualified human hiring approval/i]
      }],
      ["expertise-to-training-program", {
        outcome: [/subject-matter accuracy/i, /assessment fairness/i, /privacy/i, /qualified human review/i],
        completion: [/subject-matter accuracy/i, /assessment fairness/i, /privacy/i, /qualified human review/i, /consequential learner decisions/i],
        refusal: [
          /subject-matter accuracy/i,
          /assessment fairness/i,
          /privacy/i,
          /qualified human review|qualified human approval/i,
          /invent(s|ed)? technical guidance|fabricat(e|ed|es) guidance/i,
          /unfair scores|biased (test|assessment)/i,
          /disclos(e|es|ed).*privacy|expos(e|es|ed).*private/i,
          /automated result|consequential (employment|learner) decision|employment action/i
        ]
      }],
      ["contract-to-risk-and-revision-brief", {
        outcome: [/assistance, not legal advice/i, /final interpretation/i, /qualified counsel/i],
        completion: [/signing|acceptance/i, /privileged disclosure/i, /qualified counsel/i],
        refusal: [/legal advice|final interpretation/i, /signing|acceptance/i, /privileged disclosure/i, /qualified counsel/i]
      }],
      ["regulation-to-compliance-checklist", {
        outcome: [/jurisdiction/i, /as-of date/i, /source/i, /uncertainty/i, /qualified (legal|compliance) approval/i],
        completion: [/does not certify compliance/i, /does not invent requirements/i, /qualified (legal|compliance) approval/i],
        refusal: [/certif(y|ies) compliance/i, /invent(ed)? requirements/i, /jurisdiction/i, /as-of date/i, /qualified (legal|compliance) approval/i]
      }]
    ]);

    for (const [packId, surfaces] of requirements) {
      const pack = packs.find(({ id }) => id === packId)!;
      const refusal = await loadScenario(`tests/evaluations/packs/${packId}/refusal.yaml`);
      for (const expression of koreanOutcomeRequirements.get(packId)!) {
        expect(pack.outcome.ko, `${packId} Korean outcome: ${expression}`).toMatch(expression);
      }
      const textBySurface = {
        outcome: pack.outcome.en,
        completion: pack.completionCriteria.join(" "),
        refusal: [refusal.prompt, ...refusal.expectedBehaviors, ...refusal.forbiddenBehaviors].join(" ")
      };
      for (const [surface, expressions] of Object.entries(surfaces)) {
        for (const expression of expressions) {
          expect(textBySurface[surface as keyof typeof textBySurface], `${packId} ${surface}: ${expression}`)
            .toMatch(expression);
        }
      }
    }
  });

  it("requires pack-specific operational and commerce approval boundaries", async () => {
    const packs = await loadWaveFourPacks();
    const requirements = new Map<string, Record<"completion" | "refusal", RegExp[]>>([
      ["manual-process-to-maintained-sop", {
        completion: [
          /No unauthorized procurement/i,
          /emergency decision is made/i,
          /explicit approval|named approver/i,
          /audit trail/i
        ],
        refusal: [/unauthorized procurement/i, /emergency decision/i, /approval/i, /audit/i]
      }],
      ["repetitive-work-to-approved-automation", {
        completion: [/unauthorized writes/i, /tool execution/i, /preview/i, /approval/i, /rollback/i, /audit/i],
        refusal: [/unauthorized writes/i, /tool execution/i, /preview/i, /approval/i, /rollback/i, /audit/i]
      }],
      ["product-idea-to-store-listing", {
        completion: [/fake reviews/i, /deceptive pricing|deceptive discounts/i, /unsafe or unsupported listing claims/i, /inventory, order, or store mutations/i, /publication without owner approval/i],
        refusal: [/fake reviews/i, /deceptive pricing|deceptive discounts/i, /unsafe or unsupported listing claims/i, /inventory, order, or store mutations/i, /publication without owner approval/i]
      }]
    ]);

    for (const [packId, surfaceRequirements] of requirements) {
      const pack = packs.find(({ id }) => id === packId)!;
      const refusal = await loadScenario(`tests/evaluations/packs/${packId}/refusal.yaml`);
      const textBySurface = {
        completion: pack.completionCriteria.join(" "),
        refusal: [refusal.prompt, ...refusal.expectedBehaviors, ...refusal.forbiddenBehaviors].join(" ")
      };
      expect(findMissingSurfaceRequirements(textBySurface, surfaceRequirements), packId).toEqual([]);
    }
  });

  it("detects a boundary removed from one surface even when another surface retains it", () => {
    const requirements = {
      completion: [/owner approval/i, /audit/i],
      refusal: [/owner approval/i, /audit/i]
    };
    const completeSurfaces = {
      completion: "Owner approval is required and the audit record is preserved.",
      refusal: "The refusal keeps owner approval and audit requirements explicit."
    };

    expect(findMissingSurfaceRequirements(completeSurfaces, requirements)).toEqual([]);
    expect(findMissingSurfaceRequirements({
      ...completeSurfaces,
      completion: "The audit record is preserved."
    }, requirements)).toEqual(["completion: /owner approval/i"]);
    expect(findMissingSurfaceRequirements({
      ...completeSurfaces,
      refusal: "The refusal keeps owner approval explicit."
    }, requirements)).toEqual(["refusal: /audit/i"]);
  });

  it("keeps every initial pack and the catalog free of unapproved replacements", async () => {
    const [packs, catalog] = await Promise.all([
      loadAllPacks(),
      loadYaml(joinRepositoryPath("manifests/catalog.yaml")).then(validateCatalogContract)
    ]);

    expect(packs).toHaveLength(40);
    expect(packs.every(({ replacesPackIds }) => replacesPackIds.length === 0)).toBe(true);
    expect(catalog.replacements).toEqual([]);
  });

  it("loads one broker-only atomic view while preserving every complete-v1 identity as research-pending", async () => {
    const [repository, draftPack, generatedIndex] = await Promise.all([
      loadManifestRepository(repositoryRoot),
      loadYaml<Record<string, unknown>>(joinRepositoryPath(
        "manifests/complete-v1-packs/repository-to-implementation-plan.yaml"
      )),
      loadYaml<GeneratedInstallIndex>(joinRepositoryPath("generated/install-index.json"))
    ]);
    const completePacks = repository.completeV1.packs
      .filter(({ id }) => id === "repository-to-implementation-plan");

    expect(repository).not.toHaveProperty("foundation");
    expect(repository).not.toHaveProperty("foundationMigration");
    expect(repository.broker.plugins.map(({ id }) => id)).toEqual(["shared-core", "skillset-manager"]);
    expect(completePacks).toHaveLength(1);
    expect(repository.completeV1.domains).toHaveLength(20);
    expect(repository.completeV1.categoryCollections).toHaveLength(20);
    expect(repository.completeV1.capabilityCollections).toHaveLength(20);
    expect(repository.completeV1.packs).toHaveLength(40);
    expect(repository.completeV1BundleIndexes.packToBundle).toHaveLength(40);
    expect(repository.completeV1BundleIndexes.bundleToActivePackIds).toHaveLength(0);
    expect(repository.completeV1.domains.every(({ status }) => status === "draft")).toBe(true);
    expect(repository.completeV1.packs.every(({ status }) => status === "draft")).toBe(true);
    expect(draftPack).toMatchObject({
      id: "repository-to-implementation-plan",
      domainId: "software-engineering",
      replacesPackIds: [],
      status: "draft"
    });
    expect(generatedIndex.profiles).toEqual([]);
    expect(generatedIndex.availability).toEqual([]);
    expect(generatedIndex.researchPendingPacks).toHaveLength(40);
  });

  it("keeps broker-only artifacts deterministic after atomic complete-v1 validation", async () => {
    const [first, second, managerInstallIndex] = await Promise.all([
      generateAll(repositoryRoot),
      generateAll(repositoryRoot),
      readFile(joinRepositoryPath("plugins/skillset-manager/data/install-index.json"), "utf8")
    ]);

    expect(second).toEqual(first);
    expect(managerInstallIndex).toBe(first.installIndex);
  }, resolveTestTimeout(process.env.CI, 15_000));

  it("loads the exact 40-pack repository identity while deferring comprehensive graph invariants to task eleven", async () => {
    const repository = await loadCompleteV1Repository(repositoryRoot);

    expect(repository.packs).toHaveLength(40);
    expect(repository.packs.map(({ id }) => id).sort()).toEqual([...COMPLETE_V1_PACK_IDS].sort());
    expect(repository.catalog.initialPackIds).toEqual([...COMPLETE_V1_PACK_IDS]);
  });

  it("validates the complete production graph against all 120 committed scenario paths", async () => {
    const repository = await loadCompleteV1Repository(repositoryRoot);
    const scenarioPaths = new Set<string>();
    for (const pack of repository.packs) {
      const directory = `tests/evaluations/packs/${pack.id}`;
      for (const name of await readdir(joinRepositoryPath(directory))) {
        if (name.endsWith(".yaml")) scenarioPaths.add(`${directory}/${name}`);
      }
    }

    expect(scenarioPaths.size).toBe(120);
    const indexes = validateCompleteV1Graph(repository, {
      scenarioPaths,
      waves: [WAVE_ONE_PACKS, WAVE_TWO_PACKS, WAVE_THREE_PACKS, WAVE_FOUR_PACKS]
        .map((wave) => wave.map(({ id }) => id)),
      expectedWaveCounts: [10, 11, 11, 8],
      activePackIds: []
    });
    expect(indexes.packToBundle.size).toBe(40);
    expect(indexes.bundleToActivePackIds.size).toBe(0);
  });

  it("materializes the exact wave-two domain and category identities", async () => {
    const wave = await loadTaxonomy(WAVE_TWO_DOMAIN_IDS);
    const expected = expectedCoverage.domains.slice(
      WAVE_ONE_DOMAIN_IDS.length,
      WAVE_ONE_DOMAIN_IDS.length + WAVE_TWO_DOMAIN_IDS.length
    );

    expect(expected.map(({ id }) => id)).toEqual(WAVE_TWO_DOMAIN_IDS);
    expect(wave.map(({ domain }) => domain.id)).toEqual(WAVE_TWO_DOMAIN_IDS);
    expect(wave.map(({ categoryCollection }) => categoryCollection.domainId)).toEqual(
      WAVE_TWO_DOMAIN_IDS
    );

    for (const [index, entry] of wave.entries()) {
      const expectedDomain = expected[index]!;
      expect(entry.domain.categories).toEqual(expectedDomain.categoryIds);
      expect(entry.categoryCollection.categories.map(({ id }) => id)).toEqual(
        expectedDomain.categoryIds
      );
      expect(entry.domain.languages).toEqual(["en", "ko"]);
      expect(entry.domain.regions).toEqual(["global"]);
      expect(entry.domain.maintainers).toEqual(["seunghyeon1004"]);
      expect(entry.domain.version).toBe("0.1.0");
      expect(entry.domain.status).toBe("draft");
      expect(entry.categoryCollection.categories.every(({ status }) => status === "draft")).toBe(true);
    }
  });

  it("materializes the exact wave-three domain and category identities", async () => {
    const wave = await loadTaxonomy(WAVE_THREE_DOMAIN_IDS);
    const expected = expectedCoverage.domains.slice(
      WAVE_ONE_DOMAIN_IDS.length + WAVE_TWO_DOMAIN_IDS.length,
      MATERIALIZED_TAXONOMY_DOMAIN_IDS.length
    );

    expect(expected.map(({ id }) => id)).toEqual(WAVE_THREE_DOMAIN_IDS);
    expect(wave.map(({ domain }) => domain.id)).toEqual(WAVE_THREE_DOMAIN_IDS);
    expect(wave.map(({ categoryCollection }) => categoryCollection.domainId)).toEqual(
      WAVE_THREE_DOMAIN_IDS
    );

    for (const [index, entry] of wave.entries()) {
      const expectedDomain = expected[index]!;
      expect(entry.domain.categories).toEqual(expectedDomain.categoryIds);
      expect(entry.categoryCollection.categories.map(({ id }) => id)).toEqual(
        expectedDomain.categoryIds
      );
      expect(entry.domain.languages).toEqual(["en", "ko"]);
      expect(entry.domain.regions).toEqual(["global"]);
      expect(entry.domain.maintainers).toEqual(["seunghyeon1004"]);
      expect(entry.domain.version).toBe("0.1.0");
      expect(entry.domain.status).toBe("draft");
      expect(entry.categoryCollection.categories.every(({ status }) => status === "draft")).toBe(true);
    }
  });

  it("uses reviewed stable IDs for repeated source labels", async () => {
    const taxonomy = await loadTaxonomy(MATERIALIZED_TAXONOMY_DOMAIN_IDS);
    const categoryOwner = new Map(
      taxonomy.flatMap(({ categoryCollection }) =>
        categoryCollection.categories.map(({ id }) => [id, categoryCollection.domainId] as const)
      )
    );

    for (const ambiguousId of ["experiments", "accessibility", "research"]) {
      expect(categoryOwner.has(ambiguousId)).toBe(false);
    }
    expect(categoryOwner.get("product-experiments")).toBe("product-management");
    expect(categoryOwner.get("data-experiments")).toBe("data-and-analytics");
    expect(categoryOwner.get("software-accessibility")).toBe("software-engineering");
    expect(categoryOwner.get("design-accessibility")).toBe("design-and-brand");
    expect(categoryOwner.get("video-research")).toBe("video-and-audio");
  });

  it("keeps waves one through three capabilities globally unique with sole exact-once ownership", async () => {
    const taxonomy = await loadTaxonomy(MATERIALIZED_TAXONOMY_DOMAIN_IDS);
    const expected = expectedCoverage.domains.slice(0, MATERIALIZED_TAXONOMY_DOMAIN_IDS.length);
    const categoryIds = taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => id)
    );
    const capabilities = taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities
    );
    const capabilityIds = capabilities.map(({ id }) => id);
    const coveredCategoryIds = capabilities.flatMap(({ categoryIds: coveredIds }) => coveredIds);

    expect(taxonomy.map(({ domain }) => domain.id)).toEqual(MATERIALIZED_TAXONOMY_DOMAIN_IDS);
    expect(new Set(categoryIds).size).toBe(categoryIds.length);
    expect(new Set(capabilityIds).size).toBe(capabilityIds.length);
    expect(coveredCategoryIds).toHaveLength(categoryIds.length);
    expect(new Set(coveredCategoryIds)).toEqual(new Set(categoryIds));

    for (const [index, entry] of taxonomy.entries()) {
      const expectedDomain = expected[index]!;
      expect(entry.capabilityCollection.domainId).toBe(expectedDomain.id);
      expect(entry.capabilityCollection.capabilities.map(({ id, categoryIds }) => ({ id, categoryIds })))
        .toEqual(expectedDomain.capabilities);
      expect(entry.capabilityCollection.capabilities.every(({ ownerDomainId }) =>
        ownerDomainId === expectedDomain.id
      )).toBe(true);
      expect(entry.capabilityCollection.capabilities.every(({ status }) => status === "draft")).toBe(true);
    }
  });

  it("materializes the exact wave-four domain, category, and capability identities", async () => {
    const wave = await loadTaxonomy(WAVE_FOUR_DOMAIN_IDS);
    const expected = expectedCoverage.domains.slice(MATERIALIZED_TAXONOMY_DOMAIN_IDS.length);

    expect(expected.map(({ id }) => id)).toEqual(WAVE_FOUR_DOMAIN_IDS);
    expect(wave.map(({ domain }) => domain.id)).toEqual(WAVE_FOUR_DOMAIN_IDS);

    for (const [index, entry] of wave.entries()) {
      const expectedDomain = expected[index]!;
      expect(entry.domain.categories).toEqual(expectedDomain.categoryIds);
      expect(entry.categoryCollection.domainId).toBe(expectedDomain.id);
      expect(entry.categoryCollection.categories.map(({ id }) => id)).toEqual(
        expectedDomain.categoryIds
      );
      expect(entry.capabilityCollection.domainId).toBe(expectedDomain.id);
      expect(entry.capabilityCollection.capabilities.map(({ id, categoryIds }) => ({ id, categoryIds })))
        .toEqual(expectedDomain.capabilities);
      expect(entry.domain.languages).toEqual(["en", "ko"]);
      expect(entry.domain.regions).toEqual(["global"]);
      expect(entry.domain.maintainers).toEqual(["seunghyeon1004"]);
      expect(entry.domain.version).toBe("0.1.0");
      expect(entry.domain.status).toBe("draft");
      expect(entry.categoryCollection.categories.every(({ status }) => status === "draft")).toBe(true);
      expect(entry.capabilityCollection.capabilities.every(({ status }) => status === "draft")).toBe(true);
    }
  });

  it("keeps a substantive localized human-review boundary in every finance, people, and legal outcome", async () => {
    const wave = await loadTaxonomy(WAVE_FOUR_DOMAIN_IDS);
    const highImpactCapabilities = wave
      .filter(({ domain }) => HUMAN_REVIEW_DOMAIN_IDS.has(domain.id))
      .flatMap(({ capabilityCollection }) => capabilityCollection.capabilities);

    expect(highImpactCapabilities).toHaveLength(22);
    for (const { outcome } of highImpactCapabilities) {
      expect(outcome.ko).toContain(HUMAN_REVIEW_BOUNDARY.ko);
      expect(outcome.en).toContain(HUMAN_REVIEW_BOUNDARY.en);
      expect(outcome.ko).not.toBe(HUMAN_REVIEW_BOUNDARY.ko);
      expect(outcome.en).not.toBe(HUMAN_REVIEW_BOUNDARY.en);
      expect(outcome.ko.replace(HUMAN_REVIEW_BOUNDARY.ko, "").trim().length).toBeGreaterThan(25);
      expect(outcome.en.replace(HUMAN_REVIEW_BOUNDARY.en, "").trim().length).toBeGreaterThan(50);
    }
  });

  it("materializes the final exact taxonomy with no duplicate, orphan, unknown, or cross-owner coverage", async () => {
    const taxonomy = await loadTaxonomy(COMPLETE_TAXONOMY_DOMAIN_IDS);
    const categoryIds = taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => id)
    );
    const capabilities = taxonomy.flatMap(({ capabilityCollection }) =>
      capabilityCollection.capabilities
    );
    const capabilityIds = capabilities.map(({ id }) => id);
    const coveredCategoryIds = capabilities.flatMap(({ categoryIds: coveredIds }) => coveredIds);
    const categoryOwnerById = new Map(taxonomy.flatMap(({ categoryCollection }) =>
      categoryCollection.categories.map(({ id }) => [id, categoryCollection.domainId] as const)
    ));

    expect(taxonomy.map(({ domain }) => domain.id)).toEqual(expectedIdentities.domainIds);
    expect(categoryIds).toEqual(expectedIdentities.categoryIds);
    expect(capabilityIds).toEqual(expectedIdentities.capabilityIds);
    expect(categoryIds).toHaveLength(281);
    expect(capabilityIds).toHaveLength(147);
    expect(new Set(categoryIds).size).toBe(categoryIds.length);
    expect(new Set(capabilityIds).size).toBe(capabilityIds.length);
    expect(coveredCategoryIds).toHaveLength(categoryIds.length);
    expect(new Set(coveredCategoryIds).size).toBe(coveredCategoryIds.length);
    expect(new Set(coveredCategoryIds)).toEqual(new Set(categoryIds));

    for (const [index, entry] of taxonomy.entries()) {
      const expectedDomain = expectedCoverage.domains[index]!;
      expect(entry.capabilityCollection.capabilities.map(({ id, categoryIds }) => ({ id, categoryIds })))
        .toEqual(expectedDomain.capabilities);
      for (const capability of entry.capabilityCollection.capabilities) {
        expect(capability.ownerDomainId).toBe(entry.domain.id);
        for (const categoryId of capability.categoryIds) {
          expect(categoryOwnerById.get(categoryId)).toBe(entry.domain.id);
        }
      }
    }
  });

  it("derives an available target result from a loaded high-impact pack and exact eligible routes", async () => {
    const [pack] = await loadPacks([{ id: "repository-to-implementation-plan", domainId: "software-engineering" }]);
    const target = { runtime: "claude-code", platform: "darwin" } as const;
    const capabilityIds = [
      ...pack!.requiredCapabilityIds,
      ...pack!.recommendedCapabilityIds,
      ...pack!.optionalCapabilityIds
    ];
    const providers: ProviderManifest[] = capabilityIds.map((capabilityId) => ({
      schemaVersion: 2,
      id: `availability-${capabilityId}`,
      capabilityIds: [capabilityId],
      sourceReviewId: `review-${capabilityId}`,
      permissions: { filesystem: [], commands: [], network: [], externalData: [] },
      version: "1.0.0",
      status: "stable",
      trustTier: "trusted",
      runtimeContracts: [{
        runtime: "claude-code",
        packaging: "agent-skill",
        runtimeVersionRange: ">=1.0.0",
        platforms: ["darwin"],
        repositoryUrl: `https://github.com/example/${capabilityId}`,
        subdirectory: "skills/availability",
        ref: "v1.0.0",
        reviewedCommit: "a".repeat(40),
        artifacts: [{ path: "skills/availability/SKILL.md", sha256: "b".repeat(64) }]
      }]
    }));
    const selections: ProviderSelectionManifest[] = capabilityIds.map((capabilityId) => ({
      schemaVersion: 2,
      id: `selection-${capabilityId}`,
      capabilityId,
      ...target,
      searchRecordId: `search-${capabilityId}`,
      disposition: "selected",
      preferredProviderId: `availability-${capabilityId}`,
      alternateProviderIds: [],
      terminalReviewIds: [],
      decisionReasons: ["trialed"],
      releaseEvidence: "trialed-p04"
    }));
    const eligibility: ProviderTargetEligibility[] = capabilityIds.map((capabilityId) => ({
      providerId: `availability-${capabilityId}`,
      capabilityId,
      target,
      eligible: true,
      assuranceProfiles: ["high-impact", "standard"],
      evidenceIds: [],
      reasonCodes: []
    }));

    const result = derivePackAvailability({ pack: pack!, selections, providers, eligibility, target, installed: null });

    expect(result.availability).toBe("available");
    expect(result.resolvedProviders.map(({ capabilityId }) => capabilityId)).toEqual(
      [...capabilityIds].sort((left, right) => left.localeCompare(right))
    );
  });
});

async function loadWaveOneTaxonomy() {
  return loadTaxonomy(WAVE_ONE_DOMAIN_IDS);
}

async function loadWaveOnePacks() {
  return loadPacks(WAVE_ONE_PACKS);
}

async function loadWaveTwoPacks() {
  return loadPacks(WAVE_TWO_PACKS);
}

async function loadWaveThreePacks() {
  return loadPacks(WAVE_THREE_PACKS);
}

async function loadWaveFourPacks() {
  return loadPacks(WAVE_FOUR_PACKS);
}

async function loadWaveOneAndTwoPacks() {
  return loadPacks([...WAVE_ONE_PACKS, ...WAVE_TWO_PACKS]);
}

async function loadFirstThreeWavePacks() {
  return loadPacks([...WAVE_ONE_PACKS, ...WAVE_TWO_PACKS, ...WAVE_THREE_PACKS]);
}

async function loadAllPacks() {
  return loadPacks([
    ...WAVE_ONE_PACKS,
    ...WAVE_TWO_PACKS,
    ...WAVE_THREE_PACKS,
    ...WAVE_FOUR_PACKS
  ]);
}

async function loadPacks(packs: readonly { id: string; domainId: string }[]) {
  return Promise.all(packs.map(async ({ id }) =>
    validateCompletePack(await loadYaml(
      joinRepositoryPath(`manifests/complete-v1-packs/${id}.yaml`)
    ))
  ));
}

async function loadScenario(path: string): Promise<ScenarioSpec> {
  return await loadYaml(joinRepositoryPath(path)) as ScenarioSpec;
}

function addUniqueBehaviorTexts(
  behaviorTexts: Set<string>,
  scenario: Pick<ScenarioSpec, "expectedBehaviors" | "forbiddenBehaviors">
): void {
  for (const behaviorText of [
    ...scenario.expectedBehaviors,
    ...scenario.forbiddenBehaviors
  ]) {
    if (behaviorTexts.has(behaviorText)) {
      throw new Error(`Duplicate scenario behavior text: ${behaviorText}`);
    }
    behaviorTexts.add(behaviorText);
  }
}

function findMissingSurfaceRequirements(
  textBySurface: Readonly<Record<string, string>>,
  requirements: Readonly<Record<string, readonly RegExp[]>>
): string[] {
  const missing: string[] = [];
  for (const [surface, expressions] of Object.entries(requirements)) {
    const text = textBySurface[surface] ?? "";
    for (const expression of expressions) {
      if (!new RegExp(expression.source, expression.flags).test(text)) {
        missing.push(`${surface}: ${expression}`);
      }
    }
  }
  return missing;
}

async function loadTaxonomy(domainIds: readonly string[]) {
  return Promise.all(domainIds.map(async (domainId) => ({
    domain: validateDomain(await loadYaml(
      joinRepositoryPath(`manifests/complete-v1-domains/${domainId}.yaml`)
    )),
    categoryCollection: validateCategoryCollection(await loadYaml(
      joinRepositoryPath(`manifests/categories/${domainId}.yaml`)
    )),
    capabilityCollection: validateCapabilityCollection(await loadYaml(
      joinRepositoryPath(`manifests/capabilities/${domainId}.yaml`)
    ))
  })));
}

function joinRepositoryPath(path: string): string {
  return `${repositoryRoot}/${path}`;
}

interface ExpectedIdentities {
  domainIds: string[];
  categoryIds: string[];
  capabilityIds: string[];
  initialPackIds: string[];
  replacements: unknown[];
}

interface ExpectedCoverage {
  domains: Array<{
    id: string;
    categoryIds: string[];
    capabilities: Array<{
      id: string;
      categoryIds: string[];
    }>;
  }>;
}

interface ScenarioSpec {
  id: string;
  packId: string;
  caseType: "normal" | "boundary" | "refusal";
  prompt: string;
  expectedBehaviors: string[];
  forbiddenBehaviors: string[];
}

interface GeneratedInstallIndex {
  profiles: Array<{
    id: string;
    status: string;
  }>;
  availability: unknown[];
  researchPendingPacks: Array<{ id: string; state: "research-pending" }>;
}
