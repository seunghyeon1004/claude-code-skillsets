import { createHash } from "node:crypto";
import type { AtomicManifestRepository } from "../manifest/repository.js";
import type { LocalPluginManifest, LocalizedText, PermissionDeclaration } from "../model/manifest.js";
import type { DecisionIndex, DecisionStarterRoute } from "../model/decision.js";
import { buildDecisionPlan } from "../decision/planner.js";
import type {
  InstallIndex,
  InstallPlugin,
  ResearchPendingPack,
  RuntimeDomain
} from "../model/install-index.js";
import { assertBrokerCommandFields } from "../safety/command-fields.js";
import { selectPublication } from "../policy/publication.js";

const ROOT_MARKETPLACE = "claude-code-skillsets";

export interface GeneratedCatalogs {
  catalogKo: string;
  catalogEn: string;
  installIndex: string;
}

type Locale = keyof LocalizedText;

export function generateCatalogs(
  repository: AtomicManifestRepository,
  decisionIndex?: DecisionIndex
): GeneratedCatalogs {
  assertBrokerCommandFields(repository.broker);
  return {
    catalogKo: generateCatalog(repository, "ko", decisionIndex),
    catalogEn: generateCatalog(repository, "en", decisionIndex),
    installIndex: serializeJson(generateInstallIndex(repository))
  };
}

function generateCatalog(
  repository: AtomicManifestRepository,
  locale: Locale,
  decisionIndex?: DecisionIndex
): string {
  const labels = locale === "ko"
    ? {
        title: "스킬셋 카탈로그",
        sourceModel: "소스 모델: 후보 적격성은 후보 단위 근거 상태입니다. 후보가 eligible-with-disclosures여도 경로는 발견 전용일 수 있으며, 이 카탈로그는 설치를 승인하지 않습니다.",
        availability: "경로 가용성",
        availabilityHeader: "| 도메인 | 최소 정직 프로필 | 후보 순서/상태 | 가용성 | 미지원 수 | 관찰 시각 | 만료 |",
        executablePartial: "실행 가능 부분 경로",
        discoveryOnly: "보류/발견 전용",
        domains: "도메인",
        packs: "리서치 대기 팩",
        domainHeader: "| ID | 이름 | 설명 | 카테고리 | 상태 | 버전 |",
        packHeader: "| ID | 결과 | 도메인 | 상태 |"
      }
    : {
        title: "Skillset Catalog",
        sourceModel: "Source model: candidate eligibility is candidate-level evidence state. A route can remain discovery-only even when its candidates are eligible-with-disclosures; this catalog does not authorize installation.",
        availability: "Route Availability",
        availabilityHeader: "| Domain | Smallest honest profile | Candidate order/state | Availability | Unsupported count | Observed at | Expires at |",
        executablePartial: "Executable partial",
        discoveryOnly: "Pending/discovery-only",
        domains: "Domains",
        packs: "Research-Pending Packs",
        domainHeader: "| ID | Name | Description | Categories | Status | Version |",
        packHeader: "| ID | Outcome | Domain | State |"
      };
  const domains = [...repository.completeV1.domains].sort(compareIds);
  const packs = researchPendingPacks(repository).sort(compareIds);
  const routeTable = decisionIndex === undefined
    ? []
    : [
        `## ${labels.availability}`,
        "",
        labels.availabilityHeader,
        "| --- | --- | --- | --- | ---: | --- | --- |",
        ...decisionRouteRows(decisionIndex, locale, labels.executablePartial, labels.discoveryOnly),
        ""
      ];
  return [
    `# ${labels.title}`,
    "",
    labels.sourceModel,
    "",
    ...routeTable,
    `## ${labels.domains}`,
    "",
    labels.domainHeader,
    "| --- | --- | --- | --- | --- | --- |",
    ...domains.map((domain) => tableRow([
      domain.id,
      domain.name[locale],
      domain.description[locale],
      domain.categories.join(", "),
      domain.status,
      domain.version
    ])),
    "",
    `## ${labels.packs}`,
    "",
    labels.packHeader,
    "| --- | --- | --- | --- |",
    ...packs.map((pack) => tableRow([pack.id, pack.labels[locale], pack.domainId, pack.state])),
    ""
  ].join("\n");
}

function decisionRouteRows(
  index: DecisionIndex,
  locale: Locale,
  executablePartial: string,
  discoveryOnly: string
): string[] {
  const routes = index.starterRoutes;
  if (routes === undefined || routes.length !== index.profiles.length || index.profiles.length !== 20) {
    throw new Error("route availability catalog requires exactly one authenticated starter route for each of 20 domains");
  }
  const routesByDomain = new Map(routes.map((route) => [route.domainId, route]));
  if (routesByDomain.size !== routes.length) {
    throw new Error("route availability catalog has duplicate starter-route domains");
  }
  const candidatesById = new Map(index.candidates.map((candidate) => [candidate.id, candidate]));
  const evidenceById = new Map(index.candidateEvidence.map((evidence) => [evidence.id, evidence]));
  return index.profiles.map(({ domainId }) => {
    const route = routesByDomain.get(domainId);
    if (route === undefined) throw new Error(`route availability catalog is missing ${domainId}`);
    const plan = buildDecisionPlan(index, {
      domainIds: [domainId],
      runtime: "claude-code",
      platform: "darwin",
      asOf: index.observedThrough
    });
    const currentExecutableEvidence = currentExecutableRouteEvidence(route, evidenceById)
      && plan.status === "eligible-with-disclosures"
      && plan.planKind === "starter-partial";
    const candidateOrder = route.orderedCandidateIds.map((candidateId) => {
      const state = candidatesById.get(candidateId)?.state ?? "missing";
      return `${candidateId} (${state})`;
    }).join(" -> ");
    return tableRow([
      domainId,
      route.smallestHonestProfile[locale],
      candidateOrder,
      currentExecutableEvidence ? executablePartial : discoveryOnly,
      String(route.unsupportedCapabilityIds.length),
      index.observedThrough,
      index.catalogExpiresAt
    ]);
  });
}

function currentExecutableRouteEvidence(
  route: DecisionStarterRoute,
  evidenceById: ReadonlyMap<string, DecisionIndex["candidateEvidence"][number]>
): boolean {
  return [...route.directEvidenceIds, ...route.inferredEvidenceIds]
    .some((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return evidence?.current === true
        && (evidence.support === "direct" || evidence.support === "inferred");
    });
}

export function generateInstallIndex(repository: AtomicManifestRepository): InstallIndex {
  const publication = selectPublication(repository.broker);
  const plugins = publication.plugins.map(localRuntimePlugin).sort(compareIds);
  const domains = [...repository.completeV1.domains].sort(compareIds).map((domain): RuntimeDomain => ({
    id: domain.id,
    name: localized(domain.name),
    description: localized(domain.description),
    purposeIds: [...domain.categories].sort(compareStrings),
    profileIds: []
  }));
  const indexWithoutFingerprint = {
    marketplace: { id: ROOT_MARKETPLACE, source: "seunghyeon1004/claude-code-skillsets" },
    domains,
    profiles: [],
    availability: [],
    researchPendingPacks: researchPendingPacks(repository),
    executables: [],
    plugins
  };
  const indexFingerprint = `sha256:${createHash("sha256")
    .update(JSON.stringify({ schemaVersion: 1, ...indexWithoutFingerprint }))
    .digest("hex")}`;
  return { schemaVersion: 1, indexFingerprint, ...indexWithoutFingerprint };
}

function researchPendingPacks(repository: AtomicManifestRepository): ResearchPendingPack[] {
  return [...repository.completeV1.packs]
    .sort(compareIds)
    .map((pack) => ({
      id: pack.id,
      domainId: pack.domainId,
      labels: localized(pack.outcome),
      state: "research-pending" as const
    }));
}

function localRuntimePlugin(plugin: LocalPluginManifest): InstallPlugin {
  if (plugin.marketplace !== ROOT_MARKETPLACE) {
    throw new Error(`Broker plugin ${plugin.id} declares marketplace ${String(plugin.marketplace)}; expected ${ROOT_MARKETPLACE}`);
  }
  if (plugin.trustTier !== "verified") {
    throw new Error(`Broker plugin ${plugin.id} must be verified`);
  }
  return {
    id: plugin.id,
    name: localized(required(plugin.name, `plugin ${plugin.id}.name`)),
    version: plugin.version,
    source: plugin.source,
    marketplace: ROOT_MARKETPLACE,
    trustTier: plugin.trustTier,
    permissions: sortedPermissions(required(plugin.permissions, `plugin ${plugin.id}.permissions`)),
    requiredDependencies: plugin.requiredDependencies
      .map((dependency) => ({
        id: dependency.name,
        marketplace: dependency.marketplace ?? ROOT_MARKETPLACE,
        ...(dependency.version === undefined ? {} : { version: dependency.version })
      }))
      .sort((left, right) => compareStrings(left.id, right.id)),
    installCommand: `claude plugin install ${plugin.id}@${ROOT_MARKETPLACE} --scope user`,
    kind: "local",
    license: "Apache-2.0"
  };
}

function sortedPermissions(permissions: PermissionDeclaration): PermissionDeclaration {
  return {
    filesystem: [...permissions.filesystem].sort(compareStrings),
    commands: [...permissions.commands].sort(compareStrings),
    network: [...permissions.network].sort(compareStrings),
    externalData: [...permissions.externalData].sort(compareStrings)
  };
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing runtime field: ${label}`);
  return value;
}

function localized(value: LocalizedText): LocalizedText {
  return { ko: value.ko, en: value.en };
}

function tableRow(values: string[]): string {
  return `| ${values.map((value) => value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ")).join(" | ")} |`;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return compareStrings(left.id, right.id);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
