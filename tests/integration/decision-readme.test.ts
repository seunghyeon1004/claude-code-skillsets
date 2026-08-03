import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const readmes = [
  {
    path: "README.md",
    claudeHeading: "## Claude Code 빠른 시작",
    codexHeading: "## Codex 빠른 시작",
    installUnit: /주력.*primary[\s\S]*선택.*complement/is,
    upstreamBoundary: /하나의 목표 또는 도메인[\s\S]*Anthropic 공식 Marketplace에 등재되고 source identity 근거가 있는\s+외부 upstream Claude 플러그인을 최대 두 개[\s\S]*근거, 빈틈,[\s\S]*`unknown`[\s\S]*별도 승인/i,
    official: /marketplace-listed/,
    held: /`held`[\s\S]*설명만[\s\S]*설치 계획/is,
    blocked: /`blocked`[\s\S]*추천과 설치.*금지/is,
    stale: /`stale`[\s\S]*held/is
  },
  {
    path: "README.en.md",
    claudeHeading: "## Claude Code Quick Start",
    codexHeading: "## Codex Quick Start",
    installUnit: /primary[\s\S]*optional complement/is,
    upstreamBoundary: /one goal or domain[\s\S]*at most two external upstream Claude plugins with\s+Anthropic official-marketplace listing and source-identity evidence[\s\S]*evidence, gaps, and `unknown`[\s\S]*separate approval/i,
    official: /marketplace-listed/,
    held: /`held`[\s\S]*explanation[\s\S]*install plan/is,
    blocked: /`blocked`[\s\S]*recommendation and installation.*prohibited/is,
    stale: /`stale`[\s\S]*held/is
  }
] as const;

describe("decision broker first-run documentation", () => {
  it("states the broker boundary, auto dependency, current limits, and route table before the Codex path", async () => {
    const decisionIndex = JSON.parse(
      await readFile(join(projectRoot, "generated", "decision-index.json"), "utf8")
    ) as {
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

    for (const readme of readmes) {
      const content = await readFile(join(projectRoot, readme.path), "utf8");
      const firstPath = content.slice(0, content.indexOf(readme.codexHeading));
      const routeStatus = readme.path === "README.md"
        ? `${executableRoutes}/${routeCount} 실행 가능, ${reviewHeldRoutes}/${routeCount} 검토 대기·발견 전용`
        : `${executableRoutes}/${routeCount} executable, ${reviewHeldRoutes}/${routeCount} review-held discovery-only`;

      expect(firstPath, readme.path).toMatch(/not a (?:marketplace list|bundle|safety certification)|목록이나[\s\S]*번들 또는 안전성 인증/i);
      expect(firstPath, readme.path).toMatch(readme.upstreamBoundary);
      expect(firstPath, readme.path).not.toMatch(/official upstream|공식 upstream/i);
      expect(firstPath, readme.path).toMatch(/0\.1[\s\S]*review-required hold|`0\.1`[\s\S]*review-required hold/i);
      expect(firstPath, readme.path).toMatch(/(?:shared-core[\s\S]*(?:automatic|자동)|(?:automatic|자동)[\s\S]*shared-core)/i);
      expect(firstPath.replace(/\s+/gu, " "), readme.path).toContain(routeStatus);
      expect(firstPath, readme.path).toMatch(/(?:2\.1\.198[\s\S]*(?:darwin|macOS)|(?:darwin|macOS)[\s\S]*2\.1\.198)/i);
      expect(firstPath, readme.path).toMatch(/generated\/catalog\.(?:ko|en)\.md/i);
      expect(firstPath, readme.path).toMatch(/(?:\/skillset-manager:setup[\s\S]*(?:example|예:)|(?:example|예:)[\s\S]*\/skillset-manager:setup)/i);
    }
  });

  it("places the Claude install and setup CTA before every Codex developer workflow", async () => {
    for (const readme of readmes) {
      const content = await readFile(join(projectRoot, readme.path), "utf8");
      const claude = markdownSection(content, readme.claudeHeading);

      expect(content.indexOf("skillset-manager@claude-code-skillsets"), readme.path)
        .toBeLessThan(content.indexOf(readme.codexHeading));
      expect(claude).toContain("claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user");
      expect(claude).toContain("claude plugin install skillset-manager@claude-code-skillsets --scope user");
      expect(claude).toContain("/skillset-manager:setup");
    }
  });

  it("describes the decision-plan installation unit and all review states truthfully in both languages", async () => {
    for (const readme of readmes) {
      const content = await readFile(join(projectRoot, readme.path), "utf8");

      expect(content, readme.path).toMatch(readme.installUnit);
      expect(content, readme.path).toMatch(readme.official);
      expect(content, readme.path).toMatch(readme.held);
      expect(content, readme.path).toMatch(readme.blocked);
      expect(content, readme.path).toMatch(readme.stale);
      expect(content, readme.path).not.toMatch(/(?:install(?:ation)?|설치).{0,120}Outcome Pack/is);
    }
  });
});

function markdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start, `missing ${heading}`).toBeGreaterThanOrEqual(0);
  const next = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, next === -1 ? content.length : next);
}
