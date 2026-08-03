import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { COMPLETE_V1_DOMAIN_IDS, type DomainId, type ResearchSnapshot } from "../model/complete-v1.js";
import type { CompleteV1Repository } from "../manifest/complete-v1-repository.js";
import { loadCompleteV1Repository } from "../manifest/complete-v1-repository.js";
import { loadResearchRepository } from "../research/repository.js";
import { compareCodePointStrings, verifyResearchSnapshot } from "../research/snapshot.js";

export type DiscoveryStatus = "discovered-unreviewed" | "held";
export type DiscoveryVisibility = "default" | "gemini-only";
export type RuleStrength = "strong" | "weak";

export interface ReviewedAliasRule {
  alias: string;
  strength: RuleStrength;
}

export interface DiscoveryDomainVocabulary {
  id: DomainId;
  name: { ko: string; en: string };
  taxonomy: DiscoveryDomainTaxonomy;
  rules: ReviewedAliasRule[];
}

export interface DiscoveryDomainTaxonomy {
  categoryIds: string[];
  categoryCount: number;
  capabilityIds: string[];
  capabilityCount: number;
  packIds: string[];
  packCount: number;
}

export interface TaxonomyFileDigest {
  path: string;
  sha256: string;
}

export interface DiscoveryTaxonomy {
  domains: DiscoveryDomainVocabulary[];
  categoryCount: number;
  capabilityCount: number;
  packCount: number;
  fileDigests: TaxonomyFileDigest[];
}

export interface DiscoveryAlias {
  kind: "marketplace-entry" | "plugin-manifest" | "repository-record";
  address: string;
  sourceUrl: string | null;
}

export interface DiscoverySource {
  sourceRef: string;
  observedRepositoryUrl: string;
  snapshotIds: string[];
  observedCommits: string[];
  observedFrom: string;
  observedThrough: string;
  aliases: DiscoveryAlias[];
  sourcePlatformEvidence: SourcePlatformEvidence;
  provenanceDigest: string;
}

export interface ClassificationReason {
  domainId: DomainId;
  alias: string;
  strength: RuleStrength | "override";
  scope: "skill-slug" | "repository-path" | "goal" | "override";
  score: number;
}

export interface DiscoveryDomainScore {
  domainId: DomainId;
  score: number;
}

export interface OriginalSourceIdentity {
  repositoryUrl: string | null;
  resolution: "snapshot-root" | "unresolved";
  evidence: string[];
}

export interface ObservedSkillIdentity {
  repositoryUrl: string;
  selectedSkillPath: string;
  snapshotId: string;
  observedCommit: string;
  observedAt: string;
  snapshotDigest: string;
}

export interface PlatformEvidenceItem {
  state: "observed-path-surface" | "unknown";
  evidence: string[];
}

export interface PlatformEvidence {
  claudeCode: PlatformEvidenceItem;
  codex: PlatformEvidenceItem;
  gemini: PlatformEvidenceItem;
}

export interface CollisionEvidence {
  disposition: "none" | "kept-separate-unproven";
  sameSlugCandidateCount: number;
  observedRepositories: string[];
  reason: string;
}

export interface DiscoveredSkillContract {
  status: "discovered-unreviewed";
  visibility: DiscoveryVisibility;
  canonicalOriginalSource: OriginalSourceIdentity;
  observed: ObservedSkillIdentity;
  observations: ObservedSkillIdentity[];
  skillSlug: string;
  lineageEvidence: DiscoveryAlias[];
  lineageEvidenceTotal: number;
  platformEvidence: PlatformEvidence;
  collision: CollisionEvidence;
  provenanceDigest: string;
  classification: {
    domainIds: DomainId[];
    scores: DiscoveryDomainScore[];
    reasons: ClassificationReason[];
  };
}

export interface DiscoveryDomain {
  id: DomainId;
  name: { ko: string; en: string };
  taxonomy?: DiscoveryDomainTaxonomy;
  status: "held";
  candidateCount: number;
  sourceCount: number;
  candidates: DiscoveredSkillContract[];
}

export interface DiscoveryProvenance {
  digest: string;
  classifierVersion: string;
  observedFrom: string;
  observedThrough: string;
  observedCommits: string[];
  snapshotDigests: Array<{ snapshotId: string; sha256: string }>;
  taxonomyFileDigests: TaxonomyFileDigest[];
}

export interface CompactDiscoveryProvenance {
  digest: string;
  classifierVersion: string;
  observedAtRange: { from: string; through: string };
  sourceCount: number;
  taxonomyFileCount: number;
}

export interface DiscoveryIndex {
  status: "held";
  sourceCount: number;
  contractCount: number;
  visibleCandidateCount: number;
  classifiedCount: number;
  allClassifiedCount?: number;
  defaultVisibleClassifiedCount?: number;
  geminiOnlyClassifiedCount?: number;
  unclassifiedCount: number;
  geminiOnlyCount: number;
  provenance: DiscoveryProvenance;
  sources: DiscoverySource[];
  contracts: DiscoveredSkillContract[];
  domains: DiscoveryDomain[];
}

export interface CompleteDiscoveryIndex extends DiscoveryIndex {
  allClassifiedCount: number;
  defaultVisibleClassifiedCount: number;
  geminiOnlyClassifiedCount: number;
}

export interface CandidateResult {
  status: "discovered-unreviewed";
  visibility: DiscoveryVisibility;
  sourceRef: string;
  selectedSkillPath: string;
  skillSlug: string;
  latestCommit: string;
  latestObservedAt: string;
  observationCount: number;
  domainIds: DomainId[];
  platformStates: {
    claudeCode: PlatformEvidenceItem["state"];
    codex: PlatformEvidenceItem["state"];
    gemini: PlatformEvidenceItem["state"];
  };
  rankScore: number;
  reasons: string[];
  matchExplanations: string[];
  provenanceDigest: string;
}

export interface CandidatePage<T extends CandidateResult = CandidateResult> {
  totalCount: number;
  limit: number;
  cursor: string | null;
  nextCursor: string | null;
  candidates: T[];
}

export interface CandidateVisibilityCounts {
  all: number;
  defaultVisible: number;
  geminiOnly: number;
}

export interface PageOptions {
  limit?: number;
  cursor?: string;
}

export interface DomainDiscoveryResponse {
  status: "held";
  domain: Omit<DiscoveryDomain, "candidates" | "taxonomy"> & { taxonomy: DiscoveryDomainTaxonomy };
  candidatePage: CandidatePage;
  sources: Record<string, CandidateSourceSummary>;
  nextAction: "review-candidates" | "review-reclassification-queue";
  reasons: string[];
  provenance: CompactDiscoveryProvenance;
}

export interface UnclassifiedDiscoveryResponse {
  status: "held";
  candidatePage: CandidatePage;
  visibilityCounts: CandidateVisibilityCounts;
  sources: Record<string, CandidateSourceSummary>;
  nextAction: "review-reclassification-queue";
  reasons: string[];
  provenance: CompactDiscoveryProvenance;
}

export interface RuntimeObservedCandidate extends CandidateResult {
  runtimePathEvidence: {
    runtime: "codex";
    state: "observed-path-surface";
    paths: string[];
    compatibility: "not-verified";
  };
}

export interface RuntimeDiscoveryResponse {
  status: "held";
  runtime: "codex";
  codexDisposition: "discovery-only-no-execution";
  candidatePage: CandidatePage<RuntimeObservedCandidate>;
  sources: Record<string, CandidateSourceSummary>;
  nextAction: "review-reclassification-queue";
  reasons: string[];
  provenance: CompactDiscoveryProvenance;
}

export interface SourceSurfaceEvidence {
  state: "observed-source-surface" | "unknown";
  evidenceCount: number;
  evidence: string[];
}

export interface SourcePlatformEvidence {
  claudeCode: SourceSurfaceEvidence;
  codex: SourceSurfaceEvidence;
  gemini: SourceSurfaceEvidence;
}

export interface CandidateSourceSummary {
  observedRepositoryUrl: string;
  snapshotIds: string[];
  lineageEvidenceCount: number;
  lineageEvidence: DiscoveryAlias[];
  sourcePlatformEvidence: SourcePlatformEvidence;
}

export interface DiscoveryDomainChoice {
  id: DomainId;
  name: { ko: string; en: string };
  candidateCount: number;
  score: number;
  reasons: string[];
}

export interface DiscoveryRecommendation {
  status: "held";
  goal: string;
  resolution: "matched" | "ambiguous" | "unclassified";
  domainIds: DomainId[];
  domainChoices: DiscoveryDomainChoice[];
  totalChoiceCount: number;
  truncated: boolean;
  reasons: string[];
  nextAction: "review-candidates" | "review-reclassification-queue" | "select-domain" | "list-domains";
  candidatePage: CandidatePage;
  sources: Record<string, CandidateSourceSummary>;
  provenance: CompactDiscoveryProvenance;
}

export interface DiscoveryBroker {
  taxonomy: DiscoveryTaxonomy;
  index: CompleteDiscoveryIndex;
  domain(domainId: DomainId, options?: PageOptions): DomainDiscoveryResponse;
  unclassified(options?: PageOptions): UnclassifiedDiscoveryResponse;
  runtime(runtime: "codex", options?: PageOptions): RuntimeDiscoveryResponse;
  recommend(goal: string, options?: PageOptions): DiscoveryRecommendation;
}

interface SourceObservation {
  snapshotId: string;
  observedAt: string;
  observedCommit: string;
  snapshotDigest: string;
  aliases: DiscoveryAlias[];
  skillPaths: string[];
}

interface SourceGroup {
  observedRepositoryUrl: string;
  observations: SourceObservation[];
  aliases: DiscoveryAlias[];
}

interface RankedDomain extends DiscoveryDomainScore {
  qualified: boolean;
  reasons: ClassificationReason[];
}

const CLASSIFIER_VERSION = "reviewed-phrase-v2";
const MAX_PAGE_SIZE = 20;
const DEFAULT_PAGE_SIZE = 20;
const CLASSIFIER_CONFIG = {
  strongSlugScore: 100,
  strongPathScore: 70,
  weakSlugScore: 20,
  weakPathScore: 10,
  goalStrongScore: 100,
  goalWeakScore: 20,
  minimumIndependentWeakSignals: 2,
  maxDomains: 3,
  geminiPrefix: ".gemini/"
} as const;

const CLASSIFICATION_OVERRIDES: ReadonlyArray<{
  repositoryUrl: string;
  selectedSkillPath: string;
  domainId: DomainId;
  reason: string;
}> = [];

const REVIEWED_ALIASES: Record<DomainId, { strong: string[]; weak: string[] }> = {
  "research-and-intelligence": {
    strong: ["research", "competitive intelligence", "competitor research", "cited research", "source discovery", "fact checking", "리서치", "경쟁사 조사", "출처 조사", "인용 조사", "사실 확인"],
    weak: ["competitor", "citation", "source", "evidence", "trend", "조사", "인용", "출처", "근거"]
  },
  "strategy-and-decision": {
    strong: ["strategic decision", "scenario planning", "business strategy", "decision record", "problem framing", "전략", "전략적 의사결정", "시나리오 계획", "사업 전략", "의사결정 기록", "문제 정의"],
    weak: ["strategy", "decision", "scenario", "priority", "review", "전략", "의사결정", "시나리오", "우선순위", "검토"]
  },
  "writing-and-publishing": {
    strong: ["blog article", "blog post", "article writing", "copywriting", "proofreading", "technical writing", "newsletter", "블로그 글", "기사 작성", "카피라이팅", "교정", "기술 글쓰기", "뉴스레터"],
    weak: ["article", "write", "edit", "publish", "글", "작성", "편집", "출판"]
  },
  "marketing-and-growth": {
    strong: ["seo", "search engine optimization", "marketing plan", "email marketing", "conversion rate optimization", "content marketing", "마케팅", "검색 최적화", "이메일 마케팅", "전환율 최적화", "콘텐츠 마케팅"],
    weak: ["marketing", "growth", "funnel", "acquisition", "retention", "persona", "성장", "퍼널", "획득", "유지"]
  },
  "promotion-and-distribution": {
    strong: ["social distribution", "content repurposing", "public relations", "launch campaign", "media pitching", "influencer marketing", "social channel", "소셜 배포", "콘텐츠 재활용", "홍보 캠페인", "미디어 피칭", "인플루언서 홍보", "소셜 채널"],
    weak: ["promotion", "distribution", "campaign", "outreach", "social", "홍보", "배포", "캠페인", "아웃리치"]
  },
  "sales-and-customer": {
    strong: ["sales", "crm", "lead qualification", "sales proposal", "customer support", "account research", "영업", "고객 관계 관리", "리드 검증", "영업 제안서", "고객 지원", "계정 조사"],
    weak: ["lead", "proposal", "customer", "renewal", "support", "리드", "제안", "고객", "갱신", "지원"]
  },
  "product-management": {
    strong: ["product roadmap", "prd", "product discovery", "user story", "product requirements", "제품 로드맵", "제품 발견", "사용자 스토리", "제품 요구사항", "제품 기획"],
    weak: ["product", "roadmap", "scope", "prioritization", "review", "제품", "로드맵", "범위", "우선순위", "검토"]
  },
  "project-management": {
    strong: ["project plan", "project schedule", "project status", "work breakdown", "project retrospective", "프로젝트 계획", "프로젝트 일정", "프로젝트 상태", "작업 분해", "프로젝트 회고"],
    weak: ["project", "schedule", "stakeholder", "dependency", "meeting", "프로젝트", "일정", "이해관계자", "의존성", "회의"]
  },
  "software-engineering": {
    strong: ["debugging", "software testing", "performance testing", "performance test", "api", "backend", "frontend", "refactoring", "code review", "database migration", "디버깅", "소프트웨어 테스트", "성능 테스트", "백엔드", "프론트엔드", "리팩터링", "코드 리뷰", "데이터베이스 마이그레이션"],
    weak: ["software", "test", "debug", "code", "repository", "review", "소프트웨어", "테스트", "코드", "저장소", "검토"]
  },
  "devops-and-security": {
    strong: ["ci cd", "deployment pipeline", "kubernetes", "terraform", "application security", "threat model", "security incident response", "container security", "배포 파이프라인", "쿠버네티스", "테라폼", "애플리케이션 보안", "위협 모델", "보안 사고 대응", "컨테이너 보안"],
    weak: ["deployment", "cloud", "security", "incident", "secret", "observability", "배포", "클라우드", "보안", "사고", "비밀", "관찰성"]
  },
  "ai-agents-and-automation": {
    strong: ["ai agent", "multi agent", "rag", "retrieval augmented generation", "prompt engineering", "mcp", "llm evaluation", "ai 에이전트", "다중 에이전트", "검색 증강 생성", "프롬프트 엔지니어링", "llm 평가"],
    weak: ["agent", "llm", "prompt", "model", "automation", "에이전트", "모델", "프롬프트", "자동화"]
  },
  "data-and-analytics": {
    strong: ["data analysis", "dashboard", "sql", "data pipeline", "statistics", "forecasting", "data visualization", "데이터 분석", "대시보드", "데이터 파이프라인", "통계", "예측", "데이터 시각화"],
    weak: ["data", "analytics", "kpi", "metric", "report", "데이터", "분석", "지표", "보고서"]
  },
  "design-and-brand": {
    strong: ["design system", "wireframe", "user interface", "brand identity", "visual design", "user flow", "디자인 시스템", "와이어프레임", "사용자 인터페이스", "브랜드 아이덴티티", "시각 디자인", "사용자 흐름"],
    weak: ["design", "brand", "visual", "prototype", "interface", "디자인", "브랜드", "시각", "프로토타입", "인터페이스"]
  },
  "video-and-audio": {
    strong: ["video editing", "audio mixing", "storyboard", "captions", "thumbnail", "motion graphics", "영상 편집", "오디오 믹싱", "스토리보드", "자막", "썸네일", "모션 그래픽"],
    weak: ["video", "audio", "recording", "music", "영상", "오디오", "녹음", "음악"]
  },
  "documents-and-knowledge": {
    strong: ["spreadsheet", "presentation", "pdf", "knowledge base", "document conversion", "meeting notes", "스프레드시트", "프레젠테이션", "지식 베이스", "문서 변환", "회의록"],
    weak: ["document", "template", "archive", "ocr", "문서", "템플릿", "보관"]
  },
  "business-operations": {
    strong: ["standard operating procedure", "sop", "business process", "procurement", "vendor management", "workflow automation", "service operations", "표준 운영 절차", "업무 프로세스", "조달", "공급업체 관리", "워크플로 자동화", "서비스 운영"],
    weak: ["operation", "process", "vendor", "handoff", "automation", "운영", "프로세스", "공급업체", "인수인계", "자동화"]
  },
  "finance-and-accounting": {
    strong: ["budget", "cash flow", "invoice", "bookkeeping", "financial statement", "tax preparation", "unit economics", "예산", "현금 흐름", "송장", "회계 장부", "재무제표", "세금 준비", "단위 경제성"],
    weak: ["finance", "accounting", "cost", "profit", "receipt", "재무", "회계", "비용", "수익", "영수증"]
  },
  "commerce": {
    strong: ["ecommerce", "e commerce", "product listing", "inventory", "shipping", "order fulfillment", "online store", "이커머스", "상품 등록", "재고", "배송", "주문 처리", "온라인 스토어"],
    weak: ["commerce", "store", "order", "return", "catalog", "커머스", "스토어", "주문", "반품", "카탈로그"]
  },
  "people-and-training": {
    strong: ["job description", "hiring interview", "employee onboarding", "training program", "performance review", "learning assessment", "채용 공고", "채용 면접", "직원 온보딩", "교육 프로그램", "성과 평가", "학습 평가"],
    weak: ["hiring", "employee", "training", "candidate", "채용", "직원", "교육", "지원자"]
  },
  "legal-risk-and-compliance": {
    strong: ["contract review", "privacy policy", "compliance checklist", "legal research", "gdpr", "risk register", "계약서 검토", "계약 검토", "개인정보 보호", "컴플라이언스 체크리스트", "법률 조사", "위험 등록부"],
    weak: ["legal", "contract", "privacy", "compliance", "risk", "review", "법률", "계약", "개인정보", "컴플라이언스", "위험", "검토"]
  }
};

export async function loadDiscoveryBroker(root: string): Promise<DiscoveryBroker> {
  const [research, complete, fileDigests] = await Promise.all([
    loadResearchRepository(root),
    loadCompleteV1Repository(root),
    loadTaxonomyFileDigests(root)
  ]);
  const taxonomy = createDiscoveryTaxonomy(complete, fileDigests);
  const index = buildDiscoveryIndex(research.snapshots, taxonomy);
  return {
    taxonomy,
    index,
    domain: (domainId, options) => discoverDomain(index, domainId, options),
    unclassified: (options) => discoverUnclassified(index, options),
    runtime: (runtime, options) => discoverRuntime(index, runtime, options),
    recommend: (goal, options) => recommendDiscoveryDomains(goal, taxonomy, index, options)
  };
}

export function createDiscoveryTaxonomy(
  repository: CompleteV1Repository,
  fileDigests: readonly TaxonomyFileDigest[] = []
): DiscoveryTaxonomy {
  const domainsById = new Map(repository.domains.map((domain) => [domain.id, domain]));
  const categoryCollectionsByDomain = new Map(repository.categoryCollections.map((collection) => [collection.domainId, collection]));
  const capabilityCollectionsByDomain = new Map(repository.capabilityCollections.map((collection) => [collection.domainId, collection]));
  const domains = COMPLETE_V1_DOMAIN_IDS.map((id): DiscoveryDomainVocabulary => {
    const domain = domainsById.get(id);
    if (domain === undefined) throw new Error(`Discovery taxonomy is missing domain ${id}`);
    const categoryCollection = categoryCollectionsByDomain.get(id);
    if (categoryCollection === undefined) throw new Error(`Discovery taxonomy is missing categories for ${id}`);
    const capabilityCollection = capabilityCollectionsByDomain.get(id);
    if (capabilityCollection === undefined) throw new Error(`Discovery taxonomy is missing capabilities for ${id}`);
    const domainPacks = repository.packs.filter(({ domainId }) => domainId === id);
    const reviewed = REVIEWED_ALIASES[id];
    return {
      id,
      name: domain.name,
      taxonomy: {
        categoryIds: categoryCollection.categories.map(({ id: categoryId }) => categoryId),
        categoryCount: categoryCollection.categories.length,
        capabilityIds: capabilityCollection.capabilities.map(({ id: capabilityId }) => capabilityId),
        capabilityCount: capabilityCollection.capabilities.length,
        packIds: domainPacks.map(({ id: packId }) => packId),
        packCount: domainPacks.length
      },
      rules: [
        ...reviewed.strong.map((alias): ReviewedAliasRule => ({ alias, strength: "strong" })),
        ...reviewed.weak.map((alias): ReviewedAliasRule => ({ alias, strength: "weak" }))
      ].sort(compareAliasRules)
    };
  });
  return {
    domains,
    categoryCount: repository.categoryCollections.reduce((count, collection) => count + collection.categories.length, 0),
    capabilityCount: repository.capabilityCollections.reduce((count, collection) => count + collection.capabilities.length, 0),
    packCount: repository.packs.length,
    fileDigests: [...fileDigests].sort((left, right) => compareCodePointStrings(left.path, right.path))
  };
}

export function buildDiscoveryIndex(
  snapshots: readonly ResearchSnapshot[],
  taxonomy: DiscoveryTaxonomy
): CompleteDiscoveryIndex {
  const sourceGroups = groupSnapshotsBySource(snapshots);
  const sources = sourceGroups.map(toDiscoverySource);
  const extracted = sourceGroups.flatMap((group) => extractContracts(group, taxonomy));
  const contracts = attachCollisionEvidence(extracted).sort(compareContracts);
  const visibleContracts = contracts.filter(({ visibility }) => visibility === "default");
  const domains = taxonomy.domains.map((domain): DiscoveryDomain => {
    const candidates = visibleContracts.filter(({ classification }) => classification.domainIds.includes(domain.id));
    return {
      id: domain.id,
      name: domain.name,
      taxonomy: domain.taxonomy,
      status: "held",
      candidateCount: candidates.length,
      sourceCount: new Set(candidates.map(({ observed }) => observed.repositoryUrl)).size,
      candidates
    };
  });
  const classifiedCount = contracts.filter(({ classification }) => classification.domainIds.length > 0).length;
  const defaultVisibleClassifiedCount = visibleContracts.filter(({ classification }) => classification.domainIds.length > 0).length;
  const geminiOnlyClassifiedCount = contracts.filter(({ visibility, classification }) =>
    visibility === "gemini-only" && classification.domainIds.length > 0
  ).length;
  const snapshotRecords = sourceGroups.flatMap(({ observedRepositoryUrl, observations }) => observations.map((observation) => ({
    observedRepositoryUrl,
    snapshotId: observation.snapshotId,
    observedAt: observation.observedAt,
    observedCommit: observation.observedCommit,
    snapshotDigest: observation.snapshotDigest,
    aliases: observation.aliases
  }))).sort(compareSnapshotRecords);
  const observedTimes = snapshotRecords.map(({ observedAt }) => observedAt).sort(compareCodePointStrings);
  const observedCommits = [...new Set(snapshotRecords.map(({ observedCommit }) => observedCommit))].sort(compareCodePointStrings);
  const snapshotDigests = snapshotRecords.map(({ snapshotId, snapshotDigest: sha256 }) => ({ snapshotId, sha256 }));
  const provenanceInput = {
    classifierVersion: CLASSIFIER_VERSION,
    classifierConfig: CLASSIFIER_CONFIG,
    classificationOverrides: CLASSIFICATION_OVERRIDES,
    reviewedAliases: taxonomy.domains.map(({ id, rules }) => ({ id, rules })),
    taxonomyCounts: {
      categories: taxonomy.categoryCount,
      capabilities: taxonomy.capabilityCount,
      packs: taxonomy.packCount
    },
    taxonomyFileDigests: taxonomy.fileDigests,
    snapshots: snapshotRecords,
    classifiedOutput: contracts.map(({ observed, observations, visibility, canonicalOriginalSource, classification }) => ({
      observed,
      observations,
      visibility,
      canonicalOriginalSource,
      classification
    }))
  };
  const provenance: DiscoveryProvenance = {
    digest: digest(provenanceInput),
    classifierVersion: CLASSIFIER_VERSION,
    observedFrom: observedTimes[0] ?? "",
    observedThrough: observedTimes.at(-1) ?? "",
    observedCommits,
    snapshotDigests,
    taxonomyFileDigests: taxonomy.fileDigests
  };
  return {
    status: "held",
    sourceCount: sources.length,
    contractCount: contracts.length,
    visibleCandidateCount: visibleContracts.length,
    classifiedCount,
    allClassifiedCount: classifiedCount,
    defaultVisibleClassifiedCount,
    geminiOnlyClassifiedCount,
    unclassifiedCount: contracts.length - classifiedCount,
    geminiOnlyCount: contracts.length - visibleContracts.length,
    provenance,
    sources,
    contracts,
    domains
  };
}

export function discoverUnclassified(
  index: DiscoveryIndex,
  options: PageOptions = {}
): UnclassifiedDiscoveryResponse {
  const unclassified = index.contracts
    .filter(({ classification }) => classification.domainIds.length === 0)
    .map((contract) => candidateResult(contract, undefined, undefined, 0))
    .sort(compareCandidateResults);
  const candidatePage = paginate(unclassified, options);
  return {
    status: "held",
    candidatePage,
    visibilityCounts: countCandidateVisibility(index.contracts.filter(({ classification }) => classification.domainIds.length === 0)),
    sources: candidateSourceMap(candidatePage.candidates, index.sources),
    nextAction: "review-reclassification-queue",
    reasons: candidatePage.totalCount > 0
      ? ["Unclassified candidates are held for the review and reclassification queue."]
      : ["The fixed snapshot has no unclassified candidates; continue review and reclassification queue maintenance."],
    provenance: compactDiscoveryProvenance(index)
  };
}

export function discoverRuntime(
  index: DiscoveryIndex,
  runtime: "codex",
  options: PageOptions = {}
): RuntimeDiscoveryResponse {
  if (runtime !== "codex") throw new Error(`Unsupported observed runtime: ${runtime}`);
  const candidates = index.contracts
    .filter((contract) => contract.platformEvidence.codex.state === "observed-path-surface")
    .map((contract) => runtimeCandidateResult(contract))
    .sort(compareCandidateResults);
  const candidatePage = paginate(candidates, options);
  return {
    status: "held",
    runtime,
    codexDisposition: "discovery-only-no-execution",
    candidatePage,
    sources: candidateSourceMap(candidatePage.candidates, index.sources),
    nextAction: "review-reclassification-queue",
    reasons: candidatePage.totalCount > 0
      ? ["Observed Codex paths are discovery evidence only; compatibility and installation remain unverified."]
      : ["The fixed snapshot has no observed Codex paths; continue review and reclassification queue maintenance."],
    provenance: compactDiscoveryProvenance(index)
  };
}

export function discoverDomain(
  index: DiscoveryIndex,
  domainId: DomainId,
  options: PageOptions = {}
): DomainDiscoveryResponse {
  const domain = index.domains.find(({ id }) => id === domainId);
  if (domain === undefined) throw new Error(`Unknown domain ID: ${domainId}`);
  const ranked = [...domain.candidates]
    .map((contract) => candidateResult(contract, domainId, undefined, domainRankScore(contract, domainId)))
    .sort(compareCandidateResults);
  const { candidates: _candidates, taxonomy, ...summary } = domain;
  if (taxonomy === undefined) throw new Error(`Discovery domain ${domainId} has no manifest taxonomy inventory`);
  const candidatePage = paginate(ranked, options);
  const hasCandidates = candidatePage.totalCount > 0;
  return {
    status: "held",
    domain: { ...summary, taxonomy },
    candidatePage,
    sources: candidateSourceMap(candidatePage.candidates, index.sources),
    nextAction: hasCandidates ? "review-candidates" : "review-reclassification-queue",
    reasons: hasCandidates
      ? [`${candidatePage.totalCount} held candidates matched the reviewed domain rules.`]
      : ["The fixed snapshot produced no reviewed candidates for this domain; route it to the review and reclassification queue."],
    provenance: compactDiscoveryProvenance(index)
  };
}

export function recommendDiscoveryDomains(
  goal: string,
  taxonomy: DiscoveryTaxonomy,
  index: DiscoveryIndex,
  options: PageOptions = {}
): DiscoveryRecommendation {
  const rankedDomains = classifyGoal(goal, taxonomy);
  const qualified = rankedDomains.filter(({ qualified }) => qualified);
  if (qualified.length === 0) {
    const weakChoices = rankedDomains.filter(({ score }) => score > 0);
    if (weakChoices.length > 1) {
      return recommendationWithoutCandidates(
        goal,
        "ambiguous",
        weakChoices,
        taxonomy,
        index,
        "select-domain",
        weakChoices.flatMap(({ reasons }) => reasons.map(formatReason))
      );
    }
    return recommendationWithoutCandidates(
      goal,
      "unclassified",
      [],
      taxonomy,
      index,
      "list-domains",
      ["No reviewed domain phrase or two independent weak aliases matched the goal."]
    );
  }

  const cutoffTie = qualified.length > CLASSIFIER_CONFIG.maxDomains
    && qualified[CLASSIFIER_CONFIG.maxDomains - 1]!.score === qualified[CLASSIFIER_CONFIG.maxDomains]!.score;
  if (cutoffTie) {
    return recommendationWithoutCandidates(
      goal,
      "ambiguous",
      qualified,
      taxonomy,
      index,
      "select-domain",
      qualified.flatMap(({ reasons }) => reasons.map(formatReason))
    );
  }
  const selected = qualified.slice(0, CLASSIFIER_CONFIG.maxDomains);
  const selectedIds = selected.map(({ domainId }) => domainId);
  const candidates = index.contracts
    .filter(({ visibility, classification }) => visibility === "default"
      && classification.domainIds.some((domainId) => selectedIds.includes(domainId)))
    .map((contract) => {
      const rankScore = recommendationRankScore(contract, selectedIds, goal);
      const primaryDomain = selectedIds.find((domainId) => contract.classification.domainIds.includes(domainId))!;
      return candidateResult(contract, primaryDomain, goal, rankScore);
    })
    .sort(compareCandidateResults);
  const candidatePage = paginate(candidates, options);
  const hasCandidates = candidatePage.totalCount > 0;
  return {
    status: "held",
    goal,
    resolution: "matched",
    domainIds: selectedIds,
    domainChoices: toDomainChoices(selected, index.domains),
    totalChoiceCount: qualified.length,
    truncated: qualified.length > selected.length,
    reasons: [
      ...selected.flatMap(({ reasons }) => reasons.map(formatReason)),
      ...(hasCandidates ? [] : ["The resolved domains have no reviewed candidates in the fixed snapshot."])
    ],
    nextAction: hasCandidates ? "review-candidates" : "review-reclassification-queue",
    candidatePage,
    sources: candidateSourceMap(candidatePage.candidates, index.sources),
    provenance: compactDiscoveryProvenance(index)
  };
}

function recommendationWithoutCandidates(
  goal: string,
  resolution: "ambiguous" | "unclassified",
  ranked: readonly RankedDomain[],
  _taxonomy: DiscoveryTaxonomy,
  index: DiscoveryIndex,
  nextAction: "select-domain" | "list-domains",
  reasons: string[]
): DiscoveryRecommendation {
  const choices = ranked.slice(0, CLASSIFIER_CONFIG.maxDomains);
  return {
    status: "held",
    goal,
    resolution,
    domainIds: [],
    domainChoices: toDomainChoices(choices, index.domains),
    totalChoiceCount: ranked.length,
    truncated: ranked.length > choices.length,
    reasons: uniqueSorted(reasons),
    nextAction,
    candidatePage: paginate([], {}),
    sources: {},
    provenance: compactDiscoveryProvenance(index)
  };
}

export function compactDiscoveryProvenance(index: DiscoveryIndex): CompactDiscoveryProvenance {
  return {
    digest: index.provenance.digest,
    classifierVersion: index.provenance.classifierVersion,
    observedAtRange: {
      from: index.provenance.observedFrom,
      through: index.provenance.observedThrough
    },
    sourceCount: index.sourceCount,
    taxonomyFileCount: index.provenance.taxonomyFileDigests.length
  };
}

function groupSnapshotsBySource(snapshots: readonly ResearchSnapshot[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const snapshot of snapshots) {
    verifyResearchSnapshot(snapshot);
    const observedRepositoryUrl = normalizedObservedRepository(snapshot);
    const aliases = snapshot.entries
      .filter((entry): entry is typeof entry & { kind: DiscoveryAlias["kind"] } => entry.kind !== "skill-file")
      .map(({ kind, address, sourceUrl }) => ({ kind, address, sourceUrl }))
      .sort(compareAliases);
    const observation: SourceObservation = {
      snapshotId: snapshot.id,
      observedAt: snapshot.observedAt,
      observedCommit: snapshot.inspectedCommit,
      snapshotDigest: snapshot.contentSha256,
      aliases,
      skillPaths: snapshot.entries
        .filter(({ kind }) => kind === "skill-file")
        .map(({ address }) => address)
        .sort(compareCodePointStrings)
    };
    const group = groups.get(observedRepositoryUrl) ?? { observedRepositoryUrl, observations: [], aliases: [] };
    group.observations.push(observation);
    group.aliases.push(...aliases);
    groups.set(observedRepositoryUrl, group);
  }
  return [...groups.values()].map((group) => ({
    observedRepositoryUrl: group.observedRepositoryUrl,
    observations: [...group.observations].sort(compareObservations),
    aliases: deduplicateAliases(group.aliases)
  })).sort((left, right) => compareCodePointStrings(left.observedRepositoryUrl, right.observedRepositoryUrl));
}

function normalizedObservedRepository(snapshot: ResearchSnapshot): string {
  const rootRecord = snapshot.entries.find(({ kind, address }) => kind === "repository-record" && address === ".");
  if (rootRecord === undefined || rootRecord.sourceUrl === null) {
    throw new Error(`Discovery snapshot ${snapshot.id} has no observed root repository identity`);
  }
  const snapshotUrl = normalizeRepositoryUrl(snapshot.sourceUrl);
  const recordUrl = normalizeRepositoryUrl(rootRecord.sourceUrl);
  if (snapshotUrl !== recordUrl) {
    throw new Error(`Discovery snapshot ${snapshot.id} root repository does not match snapshot sourceUrl`);
  }
  return snapshotUrl;
}

function normalizeRepositoryUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(`Discovery source URL must be a plain HTTPS repository URL: ${value}`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname.toLowerCase() === "github.com" && parts.length === 2) {
    return `https://github.com/${parts[0]!.toLowerCase()}/${parts[1]!.replace(/\.git$/iu, "").toLowerCase()}`;
  }
  return url.toString().replace(/\/$/u, "");
}

function toDiscoverySource(group: SourceGroup): DiscoverySource {
  const observedTimes = group.observations.map(({ observedAt }) => observedAt).sort(compareCodePointStrings);
  const snapshotIds = group.observations.map(({ snapshotId }) => snapshotId).sort(compareCodePointStrings);
  const observedCommits = [...new Set(group.observations.map(({ observedCommit }) => observedCommit))]
    .sort(compareCodePointStrings);
  return {
    sourceRef: sourceReference(group.observedRepositoryUrl),
    observedRepositoryUrl: group.observedRepositoryUrl,
    snapshotIds,
    observedCommits,
    observedFrom: observedTimes[0] ?? "",
    observedThrough: observedTimes.at(-1) ?? "",
    aliases: group.aliases,
    sourcePlatformEvidence: buildSourcePlatformEvidence(group.aliases),
    provenanceDigest: digest({
      observedRepositoryUrl: group.observedRepositoryUrl,
      observations: group.observations.map(({ snapshotId, observedAt, observedCommit, snapshotDigest }) => ({
        snapshotId,
        observedAt,
        observedCommit,
        snapshotDigest
      })),
      aliases: group.aliases
    })
  };
}

function extractContracts(group: SourceGroup, taxonomy: DiscoveryTaxonomy): DiscoveredSkillContract[] {
  const provenIdentities = new Map<string, { path: string; observations: SourceObservation[] }>();
  for (const observation of group.observations) {
    for (const path of observation.skillPaths) {
      const key = `${group.observedRepositoryUrl}\u0000${path}`;
      const candidate = provenIdentities.get(key) ?? { path, observations: [] };
      candidate.observations.push(observation);
      provenIdentities.set(key, candidate);
    }
  }
  return [...provenIdentities.values()].map(({ path, observations }): DiscoveredSkillContract => {
    const sortedObservations = [...observations].sort(compareObservations);
    const latest = sortedObservations[0]!;
    const skillSlug = path.split("/").at(-2);
    if (skillSlug === undefined) throw new Error(`Discovery skill path has no slug: ${path}`);
    const visibility: DiscoveryVisibility = isPathSurface(path, ".gemini") ? "gemini-only" : "default";
    const externalLineage = group.aliases.filter(({ sourceUrl }) =>
      sourceUrl !== null && normalizeRepositoryUrl(sourceUrl) !== group.observedRepositoryUrl
    );
    const hasUnmappedLineage = externalLineage.length > 0 || visibility === "gemini-only";
    const canonicalOriginalSource: OriginalSourceIdentity = {
      repositoryUrl: hasUnmappedLineage ? null : group.observedRepositoryUrl,
      resolution: hasUnmappedLineage ? "unresolved" : "snapshot-root",
      evidence: hasUnmappedLineage
        ? ["Source-level aliases cannot be mapped to this selected skill path."]
        : ["Snapshot root repository-record equals the observed repository."]
    };
    const observedHistory = sortedObservations.map((observation): ObservedSkillIdentity => ({
      repositoryUrl: group.observedRepositoryUrl,
      selectedSkillPath: path,
      snapshotId: observation.snapshotId,
      observedCommit: observation.observedCommit,
      observedAt: observation.observedAt,
      snapshotDigest: observation.snapshotDigest
    }));
    const observed = observedHistory[0]!;
    const platformEvidence = buildPlatformEvidence(path);
    const classification = classifySkill(path, group.observedRepositoryUrl, taxonomy);
    const lineageEvidence = contractLineageEvidence(group.aliases);
    return {
      status: "discovered-unreviewed",
      visibility,
      canonicalOriginalSource,
      observed,
      observations: observedHistory,
      skillSlug,
      lineageEvidence,
      lineageEvidenceTotal: group.aliases.length,
      platformEvidence,
      collision: {
        disposition: "none",
        sameSlugCandidateCount: 1,
        observedRepositories: [group.observedRepositoryUrl],
        reason: "No unproven cross-source same-slug collision was observed."
      },
      provenanceDigest: digest({
        canonicalOriginalSource,
        observed,
        observations: observedHistory,
        platformEvidence,
        lineageEvidenceDigest: digest(group.aliases)
      }),
      classification
    };
  });
}

function buildPlatformEvidence(path: string): PlatformEvidence {
  if (isPathSurface(path, ".gemini")) {
    return {
      claudeCode: { state: "unknown", evidence: [] },
      codex: { state: "unknown", evidence: [] },
      gemini: { state: "observed-path-surface", evidence: [path] }
    };
  }
  if (isPathSurface(path, ".codex") || path.includes(".agents/skills/")) {
    return {
      claudeCode: { state: "unknown", evidence: [] },
      codex: { state: "observed-path-surface", evidence: [path] },
      gemini: { state: "unknown", evidence: [] }
    };
  }
  if (isPathSurface(path, ".claude")) {
    return {
      claudeCode: { state: "observed-path-surface", evidence: [path] },
      codex: { state: "unknown", evidence: [] },
      gemini: { state: "unknown", evidence: [] }
    };
  }
  return {
    claudeCode: { state: "unknown", evidence: [] },
    codex: { state: "unknown", evidence: [] },
    gemini: { state: "unknown", evidence: [] }
  };
}

function buildSourcePlatformEvidence(aliases: readonly DiscoveryAlias[]): SourcePlatformEvidence {
  const claudeEvidence = aliases
    .filter(({ kind }) => kind === "plugin-manifest" || kind === "marketplace-entry")
    .map(({ kind, address }) => `${kind}:${address}`)
    .sort(compareCodePointStrings);
  return {
    claudeCode: sourceSurfaceEvidence(claudeEvidence),
    codex: sourceSurfaceEvidence([]),
    gemini: sourceSurfaceEvidence([])
  };
}

function sourceSurfaceEvidence(evidence: readonly string[]): SourceSurfaceEvidence {
  return {
    state: evidence.length > 0 ? "observed-source-surface" : "unknown",
    evidenceCount: evidence.length,
    evidence: evidence.slice(0, 5)
  };
}

function isPathSurface(path: string, directory: ".claude" | ".codex" | ".gemini"): boolean {
  return path.startsWith(`${directory}/`) || path.includes(`/${directory}/`);
}

function contractLineageEvidence(aliases: readonly DiscoveryAlias[]): DiscoveryAlias[] {
  const external = aliases.filter(({ address, sourceUrl }) => address !== "." && sourceUrl !== null);
  const preferred = external.length > 0 ? external : aliases;
  return preferred.slice(0, MAX_PAGE_SIZE);
}

function attachCollisionEvidence(contracts: readonly DiscoveredSkillContract[]): DiscoveredSkillContract[] {
  const bySlug = new Map<string, DiscoveredSkillContract[]>();
  for (const contract of contracts) {
    const values = bySlug.get(contract.skillSlug) ?? [];
    values.push(contract);
    bySlug.set(contract.skillSlug, values);
  }
  return contracts.map((contract) => {
    const collisions = bySlug.get(contract.skillSlug)!;
    const repositories = [...new Set(collisions.map(({ observed }) => observed.repositoryUrl))].sort(compareCodePointStrings);
    if (repositories.length < 2) return contract;
    return {
      ...contract,
      collision: {
        disposition: "kept-separate-unproven",
        sameSlugCandidateCount: collisions.length,
        observedRepositories: repositories,
        reason: "Same slug appears in multiple observed repositories without path-level original or content lineage proof."
      }
    };
  });
}

function classifySkill(
  selectedSkillPath: string,
  repositoryUrl: string,
  taxonomy: DiscoveryTaxonomy
): DiscoveredSkillContract["classification"] {
  const slug = selectedSkillPath.split("/").at(-2) ?? selectedSkillPath;
  const slugTokens = tokenize(slug);
  const pathTokens = tokenize(selectedSkillPath.replace(/\/SKILL\.md$/iu, ""));
  const ranked = taxonomy.domains.map((domain) => scoreAliases(domain, slugTokens, pathTokens, "skill-slug"))
    .filter(({ qualified }) => qualified);
  for (const override of CLASSIFICATION_OVERRIDES) {
    if (override.repositoryUrl !== repositoryUrl || override.selectedSkillPath !== selectedSkillPath) continue;
    ranked.push({
      domainId: override.domainId,
      score: 200,
      qualified: true,
      reasons: [{
        domainId: override.domainId,
        alias: override.reason,
        strength: "override",
        scope: "override",
        score: 200
      }]
    });
  }
  ranked.sort(compareRankedDomains);
  const selected = ranked.slice(0, CLASSIFIER_CONFIG.maxDomains);
  return {
    domainIds: selected.map(({ domainId }) => domainId),
    scores: ranked.map(({ domainId, score }) => ({ domainId, score })),
    reasons: selected.flatMap(({ reasons }) => reasons).sort(compareReasons)
  };
}

function classifyGoal(goal: string, taxonomy: DiscoveryTaxonomy): RankedDomain[] {
  const tokens = tokenize(goal);
  return taxonomy.domains.map((domain) => scoreAliases(domain, tokens, tokens, "goal"))
    .filter(({ score }) => score > 0)
    .sort(compareRankedDomains);
}

function scoreAliases(
  domain: DiscoveryDomainVocabulary,
  primaryTokens: readonly string[],
  fallbackTokens: readonly string[],
  primaryScope: "skill-slug" | "goal"
): RankedDomain {
  const reasons: ClassificationReason[] = [];
  for (const rule of domain.rules) {
    const aliasTokens = tokenize(rule.alias);
    const matchesPrimary = containsPhrase(primaryTokens, aliasTokens);
    const matchesFallback = !matchesPrimary && primaryScope === "skill-slug" && containsPhrase(fallbackTokens, aliasTokens);
    if (!matchesPrimary && !matchesFallback) continue;
    const scope = matchesPrimary ? primaryScope : "repository-path";
    const score = primaryScope === "goal"
      ? (rule.strength === "strong" ? CLASSIFIER_CONFIG.goalStrongScore : CLASSIFIER_CONFIG.goalWeakScore)
      : rule.strength === "strong"
        ? (scope === "skill-slug" ? CLASSIFIER_CONFIG.strongSlugScore : CLASSIFIER_CONFIG.strongPathScore)
        : (scope === "skill-slug" ? CLASSIFIER_CONFIG.weakSlugScore : CLASSIFIER_CONFIG.weakPathScore);
    reasons.push({ domainId: domain.id, alias: rule.alias, strength: rule.strength, scope, score });
  }
  const strong = reasons.filter(({ strength }) => strength === "strong");
  const weakAliases = new Set(reasons.filter(({ strength }) => strength === "weak").map(({ alias }) => alias));
  return {
    domainId: domain.id,
    score: reasons.reduce((total, { score }) => total + score, 0),
    qualified: strong.length > 0 || weakAliases.size >= CLASSIFIER_CONFIG.minimumIndependentWeakSignals,
    reasons: reasons.sort(compareReasons)
  };
}

function candidateResult(
  contract: DiscoveredSkillContract,
  domainId: DomainId | undefined,
  goal: string | undefined,
  rankScore: number
): CandidateResult {
  const domainReasons = domainId === undefined
    ? []
    : contract.classification.reasons.filter((reason) => reason.domainId === domainId);
  const goalTokens = goal === undefined ? [] : tokenize(goal);
  const pathTokens = tokenize(contract.observed.selectedSkillPath);
  const sharedTokens = goalTokens.filter((token) => pathTokens.includes(token));
  const matchExplanations = [
    ...domainReasons.map((reason) => `domain ${domainId}: ${reason.scope} matched reviewed alias "${reason.alias}"`),
    ...sharedTokens.map((token) => `goal token "${token}" appears in the selected skill path`)
  ];
  const explanations = uniqueSorted(matchExplanations.length > 0
    ? matchExplanations
    : [domainId === undefined
      ? "No reviewed domain classification has been assigned."
      : `domain ${domainId}: classified membership supplies the candidate match`]);
  return {
    status: contract.status,
    visibility: contract.visibility,
    sourceRef: sourceReference(contract.observed.repositoryUrl),
    selectedSkillPath: contract.observed.selectedSkillPath,
    skillSlug: contract.skillSlug,
    latestCommit: contract.observed.observedCommit,
    latestObservedAt: contract.observed.observedAt,
    observationCount: contract.observations.length,
    domainIds: contract.classification.domainIds,
    platformStates: {
      claudeCode: contract.platformEvidence.claudeCode.state,
      codex: contract.platformEvidence.codex.state,
      gemini: contract.platformEvidence.gemini.state
    },
    rankScore,
    reasons: explanations,
    matchExplanations: explanations,
    provenanceDigest: contract.provenanceDigest
  };
}

function runtimeCandidateResult(contract: DiscoveredSkillContract): RuntimeObservedCandidate {
  const evidence = contract.platformEvidence.codex;
  if (evidence.state !== "observed-path-surface" || evidence.evidence.length === 0) {
    throw new Error("Codex runtime discovery requires observed path evidence");
  }
  return {
    ...candidateResult(contract, undefined, undefined, 0),
    runtimePathEvidence: {
      runtime: "codex",
      state: evidence.state,
      paths: evidence.evidence,
      compatibility: "not-verified"
    }
  };
}

function countCandidateVisibility(contracts: readonly DiscoveredSkillContract[]): CandidateVisibilityCounts {
  const defaultVisible = contracts.filter(({ visibility }) => visibility === "default").length;
  const geminiOnly = contracts.length - defaultVisible;
  return { all: contracts.length, defaultVisible, geminiOnly };
}

function candidateSourceMap(
  candidates: readonly CandidateResult[],
  sources: readonly DiscoverySource[]
): Record<string, CandidateSourceSummary> {
  const sourcesByRef = new Map(sources.map((source) => [source.sourceRef, source]));
  const result: Record<string, CandidateSourceSummary> = {};
  for (const sourceRef of uniqueSorted(candidates.map((candidate) => candidate.sourceRef))) {
    const source = sourcesByRef.get(sourceRef);
    if (source === undefined) throw new Error(`Discovery source reference is missing: ${sourceRef}`);
    result[sourceRef] = {
      observedRepositoryUrl: source.observedRepositoryUrl,
      snapshotIds: source.snapshotIds,
      lineageEvidenceCount: source.aliases.length,
      lineageEvidence: source.aliases.slice(0, 5),
      sourcePlatformEvidence: source.sourcePlatformEvidence
    };
  }
  return result;
}

function sourceReference(repositoryUrl: string): string {
  return `source-${digest(repositoryUrl).slice(0, 12)}`;
}

function domainRankScore(contract: DiscoveredSkillContract, domainId: DomainId): number {
  return contract.classification.scores.find((score) => score.domainId === domainId)?.score ?? 0;
}

function recommendationRankScore(
  contract: DiscoveredSkillContract,
  domainIds: readonly DomainId[],
  goal: string
): number {
  const firstDomainIndex = domainIds.findIndex((domainId) => contract.classification.domainIds.includes(domainId));
  const domainId = domainIds[firstDomainIndex]!;
  const base = (domainIds.length - firstDomainIndex) * 1000 + domainRankScore(contract, domainId);
  const pathTokens = new Set(tokenize(contract.observed.selectedSkillPath));
  const shared = new Set(tokenize(goal).filter((token) => pathTokens.has(token)));
  return base + shared.size * 50;
}

function paginate<T extends CandidateResult>(candidates: readonly T[], options: PageOptions): CandidatePage<T> {
  const requestedLimit = options.limit ?? DEFAULT_PAGE_SIZE;
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_PAGE_SIZE));
  const offset = parseCursor(options.cursor);
  const page = candidates.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    totalCount: candidates.length,
    limit,
    cursor: options.cursor ?? null,
    nextCursor: nextOffset < candidates.length ? String(nextOffset) : null,
    candidates: page
  };
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor)) throw new Error(`Invalid discovery cursor: ${cursor}`);
  return Number(cursor);
}

function toDomainChoices(
  ranked: readonly RankedDomain[],
  domains: readonly DiscoveryDomain[]
): DiscoveryDomainChoice[] {
  const domainsById = new Map(domains.map((domain) => [domain.id, domain]));
  return ranked.slice(0, CLASSIFIER_CONFIG.maxDomains).map(({ domainId, score, reasons }) => {
    const domain = domainsById.get(domainId);
    if (domain === undefined) throw new Error(`Discovery index is missing domain ${domainId}`);
    return {
      id: domainId,
      name: domain.name,
      candidateCount: domain.candidateCount,
      score,
      reasons: reasons.map(formatReason)
    };
  });
}

function formatReason(reason: ClassificationReason): string {
  return `${reason.scope} matched ${reason.strength} reviewed alias "${reason.alias}" for ${reason.domainId}`;
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(normalizeToken)
    .filter((token) => token.length > 0);
}

function normalizeToken(token: string): string {
  const koreanSuffixes = ["으로", "에서", "하고", "하며", "해서", "해줘", "에게", "까지", "부터", "처럼", "보다", "으로", "된", "적", "을", "를", "이", "가", "은", "는", "와", "과", "도", "에", "로"];
  for (const suffix of koreanSuffixes) {
    if (token.length > suffix.length + 1 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
  }
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
    if (phrase.every((token, offset) => tokens[index + offset] === token)) return true;
  }
  return false;
}

async function loadTaxonomyFileDigests(root: string): Promise<TaxonomyFileDigest[]> {
  const paths = [join(root, "manifests", "catalog.yaml")];
  for (const directoryName of ["complete-v1-domains", "categories", "capabilities", "complete-v1-packs"]) {
    const directory = join(root, "manifests", directoryName);
    const names = (await readdir(directory)).filter((name) => name.endsWith(".yaml")).sort(compareCodePointStrings);
    paths.push(...names.map((name) => join(directory, name)));
  }
  const records: TaxonomyFileDigest[] = [];
  for (const path of paths.sort(compareCodePointStrings)) {
    records.push({ path: repositoryRelativePath(root, path), sha256: digestBytes(await readFile(path)) });
  }
  return records;
}

function repositoryRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function compareObservations(left: SourceObservation, right: SourceObservation): number {
  return compareCodePointStrings(right.observedAt, left.observedAt)
    || compareCodePointStrings(right.snapshotId, left.snapshotId)
    || compareCodePointStrings(right.observedCommit, left.observedCommit);
}

function compareAliases(left: DiscoveryAlias, right: DiscoveryAlias): number {
  return compareCodePointStrings(left.kind, right.kind)
    || compareCodePointStrings(left.address, right.address)
    || compareNullableStrings(left.sourceUrl, right.sourceUrl);
}

function compareContracts(left: DiscoveredSkillContract, right: DiscoveredSkillContract): number {
  return compareCodePointStrings(left.observed.repositoryUrl, right.observed.repositoryUrl)
    || compareCodePointStrings(left.observed.selectedSkillPath, right.observed.selectedSkillPath)
    || compareCodePointStrings(left.observed.observedCommit, right.observed.observedCommit)
    || compareCodePointStrings(left.observed.snapshotId, right.observed.snapshotId);
}

function compareCandidateResults(left: CandidateResult, right: CandidateResult): number {
  return right.rankScore - left.rankScore
    || compareCodePointStrings(left.sourceRef, right.sourceRef)
    || compareCodePointStrings(left.selectedSkillPath, right.selectedSkillPath)
    || compareCodePointStrings(left.latestCommit, right.latestCommit);
}

function compareRankedDomains(left: RankedDomain, right: RankedDomain): number {
  return right.score - left.score || compareCodePointStrings(left.domainId, right.domainId);
}

function compareReasons(left: ClassificationReason, right: ClassificationReason): number {
  return compareCodePointStrings(left.domainId, right.domainId)
    || compareCodePointStrings(left.scope, right.scope)
    || compareCodePointStrings(left.alias, right.alias);
}

function compareAliasRules(left: ReviewedAliasRule, right: ReviewedAliasRule): number {
  return compareCodePointStrings(left.strength, right.strength)
    || compareCodePointStrings(left.alias, right.alias);
}

function compareSnapshotRecords(
  left: { observedRepositoryUrl: string; snapshotId: string },
  right: { observedRepositoryUrl: string; snapshotId: string }
): number {
  return compareCodePointStrings(left.observedRepositoryUrl, right.observedRepositoryUrl)
    || compareCodePointStrings(left.snapshotId, right.snapshotId);
}

function compareNullableStrings(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : -1;
  return right === null ? 1 : compareCodePointStrings(left, right);
}

function deduplicateAliases(aliases: readonly DiscoveryAlias[]): DiscoveryAlias[] {
  const values = new Map<string, DiscoveryAlias>();
  for (const alias of aliases) {
    values.set(`${alias.kind}\u0000${alias.address}\u0000${alias.sourceUrl ?? ""}`, alias);
  }
  return [...values.values()].sort(compareAliases);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePointStrings);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestBytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
