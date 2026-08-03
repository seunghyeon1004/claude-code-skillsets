import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("public technical-preview positioning boundary", () => {
  it("states broker-skill ownership and taxonomy status before the Codex path", async () => {
    const readmes = [
      {
        path: "README.md",
        codexHeading: "## Codex 빠른 시작",
        ownership: /자체 broker\/control skills[\s\S]*`setup`[\s\S]*`doctor`[\s\S]*`maintain`[\s\S]*`shared-core`[\s\S]*외부 목적·도메인 스킬[\s\S]*제작하거나 복제하거나 번들하지 않습니다/i,
        taxonomy: /20개 대분류[\s\S]*40개 `?draft`? 결과 팩[\s\S]*분류 taxonomy와 향후 검토 backlog[\s\S]*지원 또는 실행 가능 범위[\s\S]*아닙니다/i
      },
      {
        path: "README.en.md",
        codexHeading: "## Codex Quick Start",
        ownership: /owns its broker\/control skills[\s\S]*`setup`[\s\S]*`doctor`[\s\S]*`maintain`[\s\S]*`shared-core`[\s\S]*does not author, copy, or bundle external purpose\/domain skills/i,
        taxonomy: /20 broad domains[\s\S]*40 draft outcome packs[\s\S]*classification taxonomy and future-review backlog[\s\S]*not supported or executable capabilities/i
      }
    ] as const;

    for (const readme of readmes) {
      const content = await readFile(join(projectRoot, readme.path), "utf8");
      const firstPath = content.slice(0, content.indexOf(readme.codexHeading));
      const normalizedFirstPath = firstPath.replace(/\s+/gu, " ");

      expect(normalizedFirstPath, readme.path).toMatch(readme.ownership);
      expect(normalizedFirstPath, readme.path).toMatch(readme.taxonomy);
    }
  });

  it("marks the unadopted v10 route target as non-current historical planning", async () => {
    const [plan, decisionIndexRaw] = await Promise.all([
      readFile(join(projectRoot, "docs", "superpowers", "plans", "2026-08-02-public-v10-gap-fix.md"), "utf8"),
      readFile(join(projectRoot, "generated", "decision-index.json"), "utf8")
    ]);
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
    const heldRoutes = routeCount - executableRoutes;
    const firstScreen = plan.slice(0, plan.indexOf("## Binding Product Contract"));
    const normalizedFirstScreen = firstScreen.replace(/\n> ?/gu, " ").replace(/\s+/gu, " ");

    expect(normalizedFirstScreen).toMatch(/Superseded[^\n]*Historical|Historical[^\n]*Superseded/i);
    expect(normalizedFirstScreen).toMatch(/non-current/i);
    expect(normalizedFirstScreen).toMatch(/7 executable[\s\S]*13 pending[\s\S]*not adopted/i);
    expect(normalizedFirstScreen).toContain(
      `canonical generated truth is ${executableRoutes}/${routeCount} executable and ${heldRoutes}/${routeCount} review-held discovery-only`
    );
    expect(plan).toContain("7 executable");
    expect(plan).toContain("13 pending");
  });
});
