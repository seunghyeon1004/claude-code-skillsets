import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { validateReleaseManifest } from "../../src/contracts/complete-v1.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const packageDescription = "A bilingual decision broker for reviewable Claude Code plugin installation, with a non-executing Codex discovery companion.";

describe("public release surface", () => {
  it("publishes complete package metadata", async () => {
    const pkg = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as Record<string, unknown>;
    expect(pkg).toMatchObject({
      description: packageDescription,
      license: "Apache-2.0",
      repository: {
        type: "git",
        url: "git+https://github.com/seunghyeon1004/claude-code-skillsets.git"
      },
      homepage: "https://github.com/seunghyeon1004/claude-code-skillsets#readme",
      bugs: { url: "https://github.com/seunghyeon1004/claude-code-skillsets/issues" }
    });
  });

  it("assigns the entire repository to the maintainer CODEOWNER", async () => {
    const codeowners = await readFile(join(projectRoot, ".github", "CODEOWNERS"), "utf8");
    expect(codeowners.trim()).toBe("* @seunghyeon1004");
  });

  it("accepts PUBLIC release manifests and rejects the retired private target", () => {
    const manifest = {
      schemaVersion: 2,
      candidateCommit: "a".repeat(40),
      catalogFingerprint: "b".repeat(64),
      repositoryVisibility: "PUBLIC",
      evidence: [
        { id: "darwin-clean-install", platform: "darwin", status: "proven" },
        { id: "linux-clean-install", platform: "linux", status: "proven" },
        { id: "win32-clean-install", platform: "win32", status: "proven" }
      ],
      criticalFindings: 0,
      importantFindings: 0
    };
    expect(validateReleaseManifest(manifest)).toEqual(manifest);
    expect(() => validateReleaseManifest({ ...manifest, repositoryVisibility: "PRIVATE" })).toThrow();
  });

  it("shows a public two-command Claude quick start and all 20 broad domains", async () => {
    const readmes = await Promise.all(["README.md", "README.en.md"].map((name) =>
      readFile(join(projectRoot, name), "utf8")
    ));
    const domainIds = [
      "ai-agents-and-automation", "business-operations", "commerce", "data-and-analytics",
      "design-and-brand", "devops-and-security", "documents-and-knowledge", "finance-and-accounting",
      "legal-risk-and-compliance", "marketing-and-growth", "people-and-training", "product-management",
      "project-management", "promotion-and-distribution", "research-and-intelligence", "sales-and-customer",
      "software-engineering", "strategy-and-decision", "video-and-audio", "writing-and-publishing"
    ];
    for (const readme of readmes) {
      const quickStart = readme.match(/## Claude Code (?:빠른 시작|Quick Start)([\s\S]*?)(?=\n## )/)?.[1] ?? "";
      expect(quickStart).not.toMatch(/private repository|비공개\s*저장소|private test flow|비공개 테스트용/i);
      const shellBlock = quickStart.match(/```sh\n([\s\S]*?)```/)?.[1] ?? "";
      const shell = shellBlock.trim().split("\n");
      expect(shell).toEqual([
        "claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user",
        "claude plugin install skillset-manager@claude-code-skillsets --scope user"
      ]);
      expect(quickStart).toMatch(/primary[\s\S]*optional\s+complement|주력[\s\S]*선택 보완/is);
      expect(quickStart).toMatch(/bounded indexed goal phrase|제한된 인덱스 목표 문구/i);
      expect(quickStart).toMatch(/broad-domain fallback|대분류 선택으로 돌아갑니다/i);
      expect(quickStart).not.toMatch(/detects? the detailed category|세부 분류를 자동 탐지/i);
      expect(quickStart).toMatch(/40[\s\S]*(?:draft outcome packs|`?draft`? 상태의 결과 팩)/i);
      expect(quickStart).toMatch(/(?:not active install units|활성 설치 단위가 아닙니다)/i);
      for (const domainId of domainIds) expect(quickStart).toContain(domainId);
      expect(readme).toMatch(/approval count of `0`[\s\S]*independent human review is not guaranteed|승인 수는 `0`[\s\S]*독립적인 사람의 검토를 보장하지/is);
    }
  });

  it("states the Anthropic listing boundary without treating listing as safety certification", async () => {
    const marketplace = JSON.parse(await readFile(join(projectRoot, ".claude-plugin", "marketplace.json"), "utf8")) as {
      description: string;
      plugins: Array<{ name: string; description?: string }>;
    };
    const managerManifest = await readFile(join(projectRoot, "manifests", "plugins", "skillset-manager.yaml"), "utf8");
    const managerPlugin = await readFile(join(projectRoot, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"), "utf8");
    const managerListing = marketplace.plugins.find(({ name }) => name === "skillset-manager");

    expect(marketplace.description).toMatch(/no-vendoring[\s\S]*source-identity evidence/i);
    expect(marketplace.description).toMatch(/비번들[\s\S]*source identity 근거|source identity 근거[\s\S]*비번들/i);
    for (const description of [marketplace.description, managerListing?.description, managerManifest, managerPlugin]) {
      expect(description).toMatch(/Anthropic official Marketplace listing is not safety certification/i);
      expect(description).toMatch(/Anthropic 공식 Marketplace 등재는 안전성 인증이 아닙니다/i);
      expect(description).not.toMatch(/marketplace\/source evidence was reviewed/i);
    }
  });

  it("synchronizes the v0.1 runtime and route limitation across manager entry surfaces", async () => {
    const marketplace = JSON.parse(await readFile(join(projectRoot, ".claude-plugin", "marketplace.json"), "utf8")) as {
      description: string;
      plugins: Array<{ name: string; description?: string }>;
    };
    const managerManifest = await readFile(join(projectRoot, "manifests", "plugins", "skillset-manager.yaml"), "utf8");
    const managerPlugin = await readFile(join(projectRoot, "plugins", "skillset-manager", ".claude-plugin", "plugin.json"), "utf8");
    const managerReadme = await readFile(join(projectRoot, "plugins", "skillset-manager", "README.md"), "utf8");
    const [readmeKo, readmeEn, decisionIndexRaw] = await Promise.all([
      readFile(join(projectRoot, "README.md"), "utf8"),
      readFile(join(projectRoot, "README.en.md"), "utf8"),
      readFile(join(projectRoot, "generated", "decision-index.json"), "utf8")
    ]);
    const managerListing = marketplace.plugins.find(({ name }) => name === "skillset-manager")?.description ?? "";
    const sourceManifest = parse(managerManifest) as { description: { en: string; ko: string } };
    const decisionIndex = JSON.parse(decisionIndexRaw) as {
      candidates: Array<{ id: string; state: string; claudeInstall?: unknown }>;
      starterRoutes: Array<{ orderedCandidateIds: string[] }>;
    };
    const candidates = new Map(decisionIndex.candidates.map((candidate) => [candidate.id, candidate]));
    const executableRoutes = decisionIndex.starterRoutes.filter(({ orderedCandidateIds }) =>
      orderedCandidateIds.length > 0 && orderedCandidateIds.every((id) => {
        const candidate = candidates.get(id);
        return candidate?.state === "eligible-with-disclosures" && candidate.claudeInstall !== undefined;
      })
    ).length;
    const routeCount = decisionIndex.starterRoutes.length;
    const reviewHeldRoutes = routeCount - executableRoutes;
    const limitationEn = `v0.1: darwin + exact Claude Code 2.1.198; ${executableRoutes}/${routeCount} executable, ${reviewHeldRoutes}/${routeCount} review-held discovery-only.`;
    const limitationKo = `v0.1: darwin + 정확한 Claude Code 2.1.198; ${executableRoutes}/${routeCount} 실행 가능, ${reviewHeldRoutes}/${routeCount} 검토 대기·발견 전용.`;
    const technicalPreviewEn = `Technical preview:** currently ${executableRoutes}/${routeCount} executable and ${reviewHeldRoutes}/${routeCount} review-held discovery-only.`;
    const technicalPreviewKo = `기술 프리뷰:** 현재 ${executableRoutes}/${routeCount} 실행 가능, ${reviewHeldRoutes}/${routeCount} 검토 대기·발견 전용입니다.`;

    expect(sourceManifest.description.en).toContain(limitationEn);
    expect(sourceManifest.description.ko).toContain(limitationKo);
    for (const surface of [marketplace.description, managerListing, managerPlugin]) {
      expect(surface).toContain(limitationEn);
      expect(surface).toContain(limitationKo);
    }
    expect(readmeEn.replace(/\s+/gu, " ")).toContain(limitationEn);
    expect(readmeKo.replace(/\s+/gu, " ")).toContain(limitationKo);
    expect(readmeEn.replace(/\s+/gu, " ")).toContain(technicalPreviewEn);
    expect(readmeKo.replace(/\s+/gu, " ")).toContain(technicalPreviewKo);
    expect(readmeEn.indexOf("**Technical preview:**")).toBeLessThan(readmeEn.indexOf("claude plugin marketplace add"));
    expect(readmeKo.indexOf("**기술 프리뷰:**")).toBeLessThan(readmeKo.indexOf("claude plugin marketplace add"));
    expect(readmeEn).toMatch(/Public repository visibility is not the launch of an\s+installation-executable product\./i);
    expect(readmeKo).toMatch(/저장소 공개는 설치 실행 가능 제품 출시가 아닙니다\./i);
    for (const readme of [readmeEn, readmeKo]) {
      expect(readme).not.toMatch(/7\/20|13\/20|executable-partial|실행 가능 부분/i);
    }
    expect(managerReadme).toMatch(/darwin[\s\S]*Claude Code `?2\.1\.198`?/i);
    const normalizedManagerReadme = managerReadme.replace(/\s+/gu, " ");
    expect(normalizedManagerReadme).toContain(`${executableRoutes}/${routeCount} routes executable, ${reviewHeldRoutes}/${routeCount} review-held discovery-only`);
    expect(normalizedManagerReadme).toContain(`${executableRoutes}/${routeCount} 실행 가능, ${reviewHeldRoutes}/${routeCount} 검토 대기·발견 전용`);
    expect(normalizedManagerReadme).toContain("Because all 20 current routes are review-held, setup currently returns a held preview with no candidates and does not enter the risk-acknowledgement, approval, or execution phases.");
    expect(normalizedManagerReadme).toContain("Only a future eligible route can expose at most two official candidates together with coverage gaps, authentication `unknown`, and cost `unknown`; it then requires risk acknowledgement and separate final approval.");
    expect(normalizedManagerReadme).toContain("현재 20개 경로가 모두 검토 대기 상태이므로 setup은 후보가 없는 held 미리보기를 반환하고 위험 확인, 승인 또는 실행 단계로 진입하지 않습니다.");
    expect(normalizedManagerReadme).toContain("향후 eligible 경로에서만 최대 두 개의 공식 후보와 coverage gap, authentication `unknown`, cost `unknown`을 공개하며, 그때 위험 확인과 별도 최종 승인을 요구합니다.");
    expect(managerReadme).not.toMatch(/current setup flow[\s\S]*exposes at most two|현재 설정 흐름[\s\S]*최대 두 개/is);

    const managerPluginDescription = (JSON.parse(managerPlugin) as { description: string }).description;
    expect(managerListing).toBe(managerPluginDescription);
    expect(marketplace.description.length).toBeLessThan(500);
    expect(managerPluginDescription.length).toBeLessThan(400);
    for (const surface of [marketplace.description, managerListing, managerPluginDescription]) {
      expect(surface).toMatch(/Exact install occurs only after separate approval; a local receipt is recorded\./i);
      expect(surface).toMatch(/정확한 설치는 별도 승인 후에만 실행하며 로컬 영수증을 기록합니다\./i);
    }
  });

  it("uses non-certifying language for a separately approved exact marketplace source", async () => {
    const managerManifest = await readFile(join(projectRoot, "manifests", "plugins", "skillset-manager.yaml"), "utf8");
    const generatedInstallIndex = await readFile(join(projectRoot, "generated", "install-index.json"), "utf8");
    const pluginInstallIndex = await readFile(join(projectRoot, "plugins", "skillset-manager", "data", "install-index.json"), "utf8");

    for (const surface of [managerManifest, generatedInstallIndex, pluginInstallIndex]) {
      expect(surface).toContain("claude plugin marketplace add separately approved exact marketplace source");
      expect(surface).not.toContain("claude plugin marketplace add approved safe source");
    }
  });

  it("marks the old market-gap review as historical and superseded evidence", async () => {
    const review = await readFile(join(projectRoot, ".superpowers", "sdd", "market-gap-final-review.md"), "utf8");

    expect(review).toMatch(/historical audit snapshot[\s\S]*superseded/i);
    expect(review).toMatch(/does not state current release[\s>]+clearance/i);
    expect(review).toContain("## Historical Launch Gate");
  });

  it("requires same-SHA release validation without blocking candidate documentation", async () => {
    const contributing = await readFile(join(projectRoot, "CONTRIBUTING.md"), "utf8");
    expect(contributing).toMatch(/exact (?:public-)?candidate SHA[\s\S]*installation (?:instructions|documentation)/i);
    expect(contributing).toMatch(/public visibility[\s\S]*not\s+a\s+release/i);
    expect(contributing).toMatch(/do not (?:tag|publish)[\s\S]*release[\s\S]*until that exact\s+(?:public-)?candidate\s+SHA\s+has\s+passed/i);
    expect(contributing).not.toMatch(/do not add installation instructions until/i);
  });
});
