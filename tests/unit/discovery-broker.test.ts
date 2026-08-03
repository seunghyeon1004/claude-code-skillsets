import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPLETE_V1_DOMAIN_IDS, type DomainId } from "../../src/model/complete-v1.js";
import { loadCompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import { loadResearchRepository } from "../../src/research/repository.js";
import {
  buildDiscoveryIndex,
  createDiscoveryTaxonomy,
  loadDiscoveryBroker,
  type DiscoveryBroker
} from "../../src/discovery/broker.js";
import { runDiscoveryCli } from "../../src/discovery/cli.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const brokerPromise = loadDiscoveryBroker(projectRoot);

const goalCases: ReadonlyArray<readonly [DomainId, string, string]> = [
  ["research-and-intelligence", "research competitors with cited sources", "경쟁사를 조사하고 출처를 인용해줘"],
  ["strategy-and-decision", "make a strategic decision with scenarios", "시나리오를 비교해 전략적 의사결정을 해줘"],
  ["writing-and-publishing", "write and proofread a blog article", "블로그 글을 작성하고 교정해줘"],
  ["marketing-and-growth", "create an SEO marketing plan", "검색 최적화 마케팅 계획을 만들어줘"],
  ["promotion-and-distribution", "repurpose content for social distribution", "콘텐츠를 재활용해 소셜 채널에 배포해줘"],
  ["sales-and-customer", "qualify sales leads in the CRM", "CRM에서 영업 리드를 검증해줘"],
  ["product-management", "turn discovery into a product roadmap", "제품 발견 결과를 제품 로드맵으로 만들어줘"],
  ["project-management", "build a project schedule and status plan", "프로젝트 일정과 상태 보고 계획을 만들어줘"],
  ["software-engineering", "debug and test a backend API", "백엔드 API를 디버깅하고 테스트해줘"],
  ["devops-and-security", "build a CI/CD deployment pipeline", "CI/CD 배포 파이프라인을 만들어줘"],
  ["ai-agents-and-automation", "evaluate a RAG AI agent", "검색 증강 생성 AI 에이전트를 평가해줘"],
  ["data-and-analytics", "analyze data in a KPI dashboard", "KPI 대시보드에서 데이터를 분석해줘"],
  ["design-and-brand", "create a brand design system", "브랜드 디자인 시스템을 만들어줘"],
  ["video-and-audio", "edit video and mix audio", "영상을 편집하고 오디오를 믹싱해줘"],
  ["documents-and-knowledge", "convert a PDF into a spreadsheet", "PDF를 스프레드시트로 변환해줘"],
  ["business-operations", "document a standard operating procedure", "표준 운영 절차를 문서화해줘"],
  ["finance-and-accounting", "prepare a cash flow budget", "현금 흐름 예산을 준비해줘"],
  ["commerce", "manage ecommerce inventory and shipping", "이커머스 재고와 배송을 관리해줘"],
  ["people-and-training", "design a hiring interview and training program", "채용 면접과 교육 프로그램을 설계해줘"],
  ["legal-risk-and-compliance", "review a contract for privacy compliance", "계약서를 검토하고 개인정보 컴플라이언스를 확인해줘"]
];

describe("discovery broker product contract", () => {
  it("builds a held index for the fixed 20-domain offline census", async () => {
    const broker = await brokerPromise;

    expect(broker.index.status).toBe("held");
    expect(broker.index.sourceCount).toBe(15);
    expect(broker.index.contractCount).toBe(8059);
    expect(broker.index.domains.map(({ id }) => id)).toEqual(COMPLETE_V1_DOMAIN_IDS);
    expect(broker.taxonomy).toMatchObject({ categoryCount: 281, capabilityCount: 147, packCount: 40 });
    expect(broker.index.provenance).toMatchObject({ classifierVersion: expect.any(String) });
    expect(broker.index.provenance.taxonomyFileDigests.length).toBeGreaterThan(0);
    expect(broker.index.provenance.observedCommits).toHaveLength(15);
  }, 20_000);

  it.each(goalCases)("resolves paired English and Korean goals for %s", async (domainId, english, korean) => {
    const broker = await brokerPromise;

    expect(broker.recommend(english).domainIds).toContain(domainId);
    expect(broker.recommend(korean).domainIds).toContain(domainId);
  });

  it("returns real held candidates for a multi-domain Korean goal", async () => {
    const broker = await brokerPromise;
    const result = broker.recommend("경쟁사를 조사하고 인용된 전략 보고서를 써줘");

    expect(result.resolution).toBe("matched");
    expect(result.domainIds).toEqual(expect.arrayContaining([
      "research-and-intelligence",
      "strategy-and-decision"
    ]));
    expect(result.status).toBe("held");
    expect(result.candidatePage.candidates.length).toBeGreaterThan(0);
    expect(result.candidatePage.candidates).toHaveLength(Math.min(20, result.candidatePage.totalCount));
    expect(result.candidatePage.candidates.every(({ status }) => status === "discovered-unreviewed")).toBe(true);
    expect(result.candidatePage.candidates.every(({ matchExplanations }) => matchExplanations.length > 0)).toBe(true);
  });

  it("uses reviewed aliases without generic-token false positives", async () => {
    const broker = await brokerPromise;
    const labels = [
      ["https://github.com/obra/superpowers", "skills/systematic-debugging/SKILL.md", ["software-engineering"]],
      ["https://github.com/coreyhaines31/marketingskills", "skills/programmatic-seo/SKILL.md", ["marketing-and-growth"]],
      ["https://github.com/wshobson/agents", "plugins/developer-essentials/skills/debugging-strategies/SKILL.md", ["software-engineering"]],
      ["https://github.com/jeremylongshore/claude-code-plugins-plus-skills", "plugins/saas-packs/anthropic-pack/skills/anth-rate-limits/SKILL.md", []],
      ["https://github.com/jeremylongshore/claude-code-plugins-plus-skills", "plugins/testing/performance-test-suite/skills/running-performance-tests/SKILL.md", ["software-engineering"]]
    ] as const;

    for (const [sourceUrl, selectedPath, expectedDomains] of labels) {
      const contract = broker.index.contracts.find((candidate) =>
        candidate.observed.repositoryUrl === sourceUrl && candidate.observed.selectedSkillPath === selectedPath
      );
      expect(contract, selectedPath).toBeDefined();
      expect(contract!.classification.domainIds).toEqual(expectedDomains);
      expect(contract!.classification.domainIds).not.toContain("people-and-training");
      if (selectedPath.includes("debugging")) {
        expect(contract!.classification.domainIds).not.toContain("marketing-and-growth");
        expect(contract!.classification.domainIds).not.toContain("design-and-brand");
      }
      if (selectedPath.includes("rate-limits")) {
        expect(contract!.classification.domainIds).not.toContain("marketing-and-growth");
      }
    }
  });

  it("bounds and paginates direct domain candidate pages at 20", async () => {
    const broker = await brokerPromise;
    const first = broker.domain("ai-agents-and-automation", { limit: 200 });
    const second = broker.domain("ai-agents-and-automation", { cursor: first.candidatePage.nextCursor! });

    expect(first.status).toBe("held");
    expect(first.candidatePage.limit).toBe(20);
    expect(first.candidatePage.cursor).toBeNull();
    expect(first.candidatePage.candidates).toHaveLength(20);
    expect(first.candidatePage.nextCursor).toBe("20");
    expect(second.candidatePage.cursor).toBe("20");
    expect(second.candidatePage.candidates[0]).not.toEqual(first.candidatePage.candidates[0]);
    expect(first.candidatePage.totalCount).toBeGreaterThan(20);
  });

  it("exposes bounded unclassified candidates with their observed visibility", async () => {
    const broker = await brokerPromise;
    const first = broker.unclassified({ limit: 200 });
    const second = broker.unclassified({ cursor: first.candidatePage.nextCursor! });

    expect(first.status).toBe("held");
    expect(first.nextAction).toBe("review-reclassification-queue");
    expect(first.candidatePage).toMatchObject({ limit: 20, cursor: null, nextCursor: "20" });
    expect(first.candidatePage.candidates).toHaveLength(20);
    expect(second.candidatePage.cursor).toBe("20");
    expect(second.candidatePage.candidates[0]).not.toEqual(first.candidatePage.candidates[0]);
    expect(first.candidatePage.candidates.every((candidate) => candidate.domainIds.length === 0)).toBe(true);
    expect(first.candidatePage.candidates.every((candidate) =>
      candidate.visibility === "default" || candidate.visibility === "gemini-only"
    )).toBe(true);
    expect(first.visibilityCounts).toEqual({
      all: first.candidatePage.totalCount,
      defaultVisible: expect.any(Number),
      geminiOnly: expect.any(Number)
    });
    expect(first.visibilityCounts.all).toBe(
      first.visibilityCounts.defaultVisible + first.visibilityCounts.geminiOnly
    );
    expect(first.visibilityCounts.geminiOnly).toBeGreaterThan(0);
  });

  it("pages observed Codex paths as unclassified discovery evidence, not compatibility", async () => {
    const broker = await brokerPromise;
    const first = broker.runtime("codex", { limit: 2 });
    const second = broker.runtime("codex", { cursor: first.candidatePage.nextCursor! });

    expect(first).toMatchObject({
      status: "held",
      runtime: "codex",
      codexDisposition: "discovery-only-no-execution",
      nextAction: "review-reclassification-queue",
      candidatePage: { totalCount: 5, limit: 2, cursor: null, nextCursor: "2" }
    });
    expect(first.candidatePage.candidates).toHaveLength(2);
    expect(second.candidatePage.cursor).toBe("2");
    expect(first.candidatePage.candidates.every((candidate) =>
      candidate.domainIds.length === 0
      && candidate.platformStates.codex === "observed-path-surface"
      && candidate.runtimePathEvidence.compatibility === "not-verified"
      && candidate.runtimePathEvidence.paths.includes(candidate.selectedSkillPath)
    )).toBe(true);
    expect(Object.values(first.sources).every((source) =>
      source.observedRepositoryUrl.startsWith("https://github.com/")
    )).toBe(true);
  });

  it("separates all, default-visible, and Gemini-only classified counts", async () => {
    const broker = await brokerPromise;

    expect(broker.index.allClassifiedCount).toBe(
      broker.index.defaultVisibleClassifiedCount + broker.index.geminiOnlyClassifiedCount
    );
    expect(broker.index.allClassifiedCount).toBe(
      broker.index.contracts.filter(({ classification }) => classification.domainIds.length > 0).length
    );
    expect(broker.index.defaultVisibleClassifiedCount).toBe(
      broker.index.contracts.filter(({ visibility, classification }) =>
        visibility === "default" && classification.domainIds.length > 0
      ).length
    );
    expect(broker.index.geminiOnlyClassifiedCount).toBe(
      broker.index.contracts.filter(({ visibility, classification }) =>
        visibility === "gemini-only" && classification.domainIds.length > 0
      ).length
    );
  });

  it("derives domain taxonomy inventory from manifests without candidate capability links", async () => {
    const [broker, complete] = await Promise.all([brokerPromise, loadCompleteV1Repository(projectRoot)]);
    const response = broker.domain("software-engineering");
    const categoryIds = complete.categoryCollections.find(({ domainId }) => domainId === "software-engineering")!
      .categories.map(({ id }) => id);
    const capabilityIds = complete.capabilityCollections.find(({ domainId }) => domainId === "software-engineering")!
      .capabilities.map(({ id }) => id);
    const packIds = complete.packs
      .filter(({ domainId }) => domainId === "software-engineering")
      .map(({ id }) => id);

    expect(response.domain.taxonomy).toEqual({
      categoryIds,
      categoryCount: categoryIds.length,
      capabilityIds,
      capabilityCount: capabilityIds.length,
      packIds,
      packCount: packIds.length
    });
    expect(response.domain).not.toHaveProperty("candidateCapabilityIds");
    for (const domain of COMPLETE_V1_DOMAIN_IDS) {
      const inventory = broker.domain(domain).domain.taxonomy;
      expect(inventory.categoryCount).toBe(inventory.categoryIds.length);
      expect(inventory.capabilityCount).toBe(inventory.capabilityIds.length);
      expect(inventory.packCount).toBe(inventory.packIds.length);
    }
  });

  it("ranks bounded recommendation pages by resolved domain and goal relevance", async () => {
    const broker = await brokerPromise;
    const result = broker.recommend("debug backend api", { limit: 5 });

    expect(result.resolution).toBe("matched");
    expect(result.domainIds).toContain("software-engineering");
    expect(result.candidatePage.limit).toBe(5);
    expect(result.candidatePage.candidates.length).toBeLessThanOrEqual(5);
    expect(result.candidatePage.totalCount).toBeGreaterThanOrEqual(result.candidatePage.candidates.length);
    expect(result.candidatePage.candidates[0]!.matchExplanations).toEqual(expect.arrayContaining([
      expect.stringMatching(/domain|alias|goal/i)
    ]));
  });

  it("returns actionable, non-silent unknown and ambiguous results", async () => {
    const broker = await brokerPromise;
    const unknown = broker.recommend("zzqxv blorptastic");
    const ambiguous = broker.recommend("review");

    expect(unknown).toMatchObject({
      resolution: "unclassified",
      domainIds: [],
      totalChoiceCount: 0,
      truncated: false,
      reasons: expect.any(Array),
      nextAction: "list-domains"
    });
    expect(ambiguous).toMatchObject({
      resolution: "ambiguous",
      domainIds: [],
      totalChoiceCount: 4,
      truncated: true,
      reasons: expect.any(Array),
      nextAction: "select-domain"
    });
    expect(ambiguous.domainChoices).toHaveLength(3);
  });

  it("derives candidate platform evidence only from selected runtime paths", async () => {
    const broker = await brokerPromise;
    const gemini = broker.index.contracts.find(({ observed }) => observed.selectedSkillPath.startsWith(".gemini/"));
    const codex = broker.index.contracts.find(({ observed }) => observed.selectedSkillPath.includes("/.codex/skills/"));
    const claude = broker.index.contracts.find(({ observed }) => observed.selectedSkillPath.includes("/.claude/skills/"));
    const regular = broker.index.contracts.find(({ observed }) =>
      observed.repositoryUrl === "https://github.com/obra/superpowers"
      && observed.selectedSkillPath === "skills/systematic-debugging/SKILL.md"
    );

    expect(gemini).toMatchObject({
      visibility: "gemini-only",
      canonicalOriginalSource: { resolution: "unresolved" },
      platformEvidence: {
        gemini: { state: "observed-path-surface" },
        claudeCode: { state: "unknown" },
        codex: { state: "unknown" }
      }
    });
    expect(codex!.platformEvidence).toEqual({
      claudeCode: { state: "unknown", evidence: [] },
      codex: { state: "observed-path-surface", evidence: [codex!.observed.selectedSkillPath] },
      gemini: { state: "unknown", evidence: [] }
    });
    expect(claude!.platformEvidence).toEqual({
      claudeCode: { state: "observed-path-surface", evidence: [claude!.observed.selectedSkillPath] },
      codex: { state: "unknown", evidence: [] },
      gemini: { state: "unknown", evidence: [] }
    });
    expect(regular!.platformEvidence).toEqual({
      claudeCode: { state: "unknown", evidence: [] },
      codex: { state: "unknown", evidence: [] },
      gemini: { state: "unknown", evidence: [] }
    });
    for (const domain of broker.index.domains) {
      expect(broker.domain(domain.id).candidatePage.candidates.every(({ selectedSkillPath }) =>
        !selectedSkillPath.startsWith(".gemini/")
      )).toBe(true);
    }
    const software = broker.domain("software-engineering");
    const obra = software.candidatePage.candidates.find(({ selectedSkillPath }) =>
      selectedSkillPath === "skills/systematic-debugging/SKILL.md"
    );
    expect(obra!.platformStates).toEqual({ claudeCode: "unknown", codex: "unknown", gemini: "unknown" });
    expect(software.sources[obra!.sourceRef]!.sourcePlatformEvidence.claudeCode.state).toBe("observed-source-surface");
  });

  it("keeps uncertain same-slug cross-source collisions separate", async () => {
    const broker = await brokerPromise;
    const docx = broker.index.contracts.filter(({ skillSlug, observed }) =>
      skillSlug === "docx" && [
        "https://github.com/anthropics/skills",
        "https://github.com/k-dense-ai/scientific-agent-skills"
      ].includes(observed.repositoryUrl)
    );

    expect(docx).toHaveLength(2);
    expect(docx.every(({ collision }) => collision.disposition === "kept-separate-unproven")).toBe(true);
    expect(new Set(docx.map(({ observed }) => observed.repositoryUrl)).size).toBe(2);
  });

  it("keeps one candidate per repository path and merges commit observations", async () => {
    const [research, complete] = await Promise.all([
      loadResearchRepository(projectRoot),
      loadCompleteV1Repository(projectRoot)
    ]);
    const taxonomy = createDiscoveryTaxonomy(complete);
    const snapshot = structuredClone(research.snapshots.find(({ id }) => id === "2026-07-23-obra-superpowers")!);
    const changedCommit = {
      ...structuredClone(snapshot),
      id: "changed-commit-copy",
      inspectedCommit: "f".repeat(40),
      observedAt: "2026-07-24T09:08:12Z"
    };
    const index = buildDiscoveryIndex([snapshot, changedCommit], taxonomy);

    expect(index.contracts).toHaveLength(14);
    expect(index.contracts.every(({ observations }) => observations.length === 2)).toBe(true);
    expect(index.contracts.every(({ observed }) => observed.observedCommit === "f".repeat(40))).toBe(true);
    expect(index.contracts[0]!.observations.map(({ observedAt }) => observedAt)).toEqual([
      "2026-07-24T09:08:12Z",
      "2026-07-23T09:08:12Z"
    ]);
  });

  it("covers semantic taxonomy and classifier output in stable provenance", async () => {
    const [research, complete] = await Promise.all([
      loadResearchRepository(projectRoot),
      loadCompleteV1Repository(projectRoot)
    ]);
    const taxonomy = createDiscoveryTaxonomy(complete);
    const snapshots = research.snapshots.filter(({ id }) => [
      "2026-07-23-obra-superpowers",
      "2026-07-23-coreyhaines31-marketingskills"
    ].includes(id));
    const baseline = buildDiscoveryIndex(snapshots, taxonomy);
    const reorderedDigest = buildDiscoveryIndex([...snapshots].reverse(), taxonomy).provenance.digest;
    const changedTaxonomy = structuredClone(taxonomy);
    changedTaxonomy.domains[0]!.rules[0]!.alias = `${changedTaxonomy.domains[0]!.rules[0]!.alias}-changed`;

    expect(reorderedDigest).toBe(baseline.provenance.digest);
    expect(buildDiscoveryIndex(snapshots, changedTaxonomy).provenance.digest).not.toBe(baseline.provenance.digest);
    expect(baseline.provenance.observedCommits).toHaveLength(2);
    expect(baseline.provenance.observedFrom).toBeTruthy();
    expect(baseline.provenance.observedThrough).toBeTruthy();
  }, 30_000);

  it("fails closed on snapshot drift", async () => {
    const [research, complete] = await Promise.all([
      loadResearchRepository(projectRoot),
      loadCompleteV1Repository(projectRoot)
    ]);
    const changed = structuredClone(research.snapshots[0]!);
    const skillIndex = changed.entries.findIndex(({ kind }) => kind === "skill-file");
    changed.entries[skillIndex] = { ...changed.entries[skillIndex]!, address: "changed/SKILL.md" };

    expect(() => buildDiscoveryIndex([changed], createDiscoveryTaxonomy(complete))).toThrow(/SHA-256/i);
  });

  it("returns compact pages and exposes full receipts only through provenance", async () => {
    const broker = await brokerPromise;
    const outputs = new Map<string, string>();
    for (const args of [
      ["domains"],
      ["domain", "software-engineering", "--limit", "999"],
      ["recommend", "debug", "backend", "api", "--limit", "20"],
      ["domain", "people-and-training"],
      ["unclassified", "--limit", "20"],
      ["provenance"]
    ]) {
      let stdout = "";
      const exitCode = await runDiscoveryCli(args, projectRoot, {
        loadBroker: async () => broker,
        writeStdout: (value) => { stdout += value; }
      });
      expect(exitCode).toBe(0);
      outputs.set(args[0] === "domain" ? args.slice(0, 2).join(":") : args[0]!, stdout);
    }
    const domainJson = outputs.get("domain:software-engineering")!;
    const recommendJson = outputs.get("recommend")!;
    const peopleJson = outputs.get("domain:people-and-training")!;
    const unclassifiedJson = outputs.get("unclassified")!;
    const domainsOutput = JSON.parse(outputs.get("domains")!) as {
      classifiedCount: number;
      allClassifiedCount: number;
      defaultVisibleClassifiedCount: number;
      geminiOnlyClassifiedCount: number;
    };
    const domainOutput = JSON.parse(domainJson) as {
      candidatePage: { limit: number; candidates: Array<Record<string, unknown>> };
      sources: Record<string, unknown>;
      provenance: Record<string, unknown>;
    };
    const recommendOutput = JSON.parse(recommendJson) as { candidatePage: { limit: number; candidates: unknown[] } };
    const provenanceOutput = JSON.parse(outputs.get("provenance")!) as {
      provenance: { snapshotDigests: unknown[]; taxonomyFileDigests: unknown[] };
    };

    expect(domainOutput.candidatePage.limit).toBe(20);
    expect(domainOutput.candidatePage.candidates).toHaveLength(20);
    expect(recommendOutput.candidatePage.limit).toBe(20);
    expect(Object.keys(domainOutput.sources).length).toBeGreaterThan(0);
    expect(domainOutput.candidatePage.candidates[0]).not.toHaveProperty("lineageEvidence");
    expect(domainOutput.candidatePage.candidates[0]).not.toHaveProperty("canonicalOriginalSource");
    expect(Object.keys(domainOutput.provenance).sort()).toEqual([
      "classifierVersion", "digest", "observedAtRange", "sourceCount", "taxonomyFileCount"
    ]);
    expect(Buffer.byteLength(domainJson)).toBeLessThan(50_000);
    expect(Buffer.byteLength(recommendJson)).toBeLessThan(50_000);
    expect(Buffer.byteLength(peopleJson)).toBeLessThan(5_000);
    expect(Buffer.byteLength(unclassifiedJson)).toBeLessThan(50_000);
    expect(domainsOutput.classifiedCount).toBe(domainsOutput.allClassifiedCount);
    expect(domainsOutput.allClassifiedCount).toBe(
      domainsOutput.defaultVisibleClassifiedCount + domainsOutput.geminiOnlyClassifiedCount
    );
    expect(provenanceOutput.provenance.snapshotDigests).toHaveLength(15);
    expect(provenanceOutput.provenance.taxonomyFileDigests).toHaveLength(101);
    for (const output of outputs.values()) {
      expect(output).toContain('"provenance"');
      expect(output).not.toMatch(/"(?:install|installation|eligible|eligibility|commands)"\s*:/iu);
    }
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.broker).toBe("tsx src/discovery/cli.ts");
  });

  it("reports no reviewed candidates instead of offering an impossible review", async () => {
    const broker = await brokerPromise;
    const direct = broker.domain("people-and-training");
    const recommended = broker.recommend("design a hiring interview and training program");

    expect(direct).toMatchObject({
      nextAction: "review-reclassification-queue",
      reasons: [expect.stringMatching(/fixed snapshot/i)]
    });
    expect(recommended).toMatchObject({
      resolution: "matched",
      nextAction: "review-reclassification-queue",
      candidatePage: { totalCount: 0 },
      reasons: expect.arrayContaining([expect.stringMatching(/no reviewed candidates/i)])
    });
  });
});
