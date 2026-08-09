import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const pluginRoot = join(projectRoot, "plugins", "shared-core");
const skillsRoot = join(pluginRoot, "skills");
const evaluationsRoot = join(projectRoot, "tests", "evaluations", "shared-core");
const expectedSkills = [
  "evidence-provenance",
  "handoff-continuity",
  "intent-to-brief",
  "plan-and-checkpoints",
  "quality-verification",
  "risk-privacy-permissions",
  "workflow-router",
  "workspace-context"
];
const expectedDescriptionContracts = {
  "evidence-provenance": /publishable artifact plus a review-only provenance ledger[\s\S]*not for fact verification, generic citation search/i,
  "handoff-continuity": /durable eight-field handoff record[\s\S]*not for customer release notes, self-contained answers/i,
  "intent-to-brief": /six-field brief[\s\S]*confirmed, assumption, or open[\s\S]*not for implementation, execution/i,
  "plan-and-checkpoints": /dependency-and-checkpoint record[\s\S]*not for general implementation plans, execution/i,
  "quality-verification": /criterion-to-evidence verification matrix[\s\S]*not for generic coding completion, generic test generation/i,
  "risk-privacy-permissions": /seven-field risk record[\s\S]*not for domain compliance interpretation, generic security review/i,
  "workflow-router": /provided catalog categories and packs[\s\S]*Primary, Supporting, Deferred, and Coverage[\s\S]*not for general skill, agent, tool/i,
  "workspace-context": /bounded context record of Instructions, Capabilities, Sources, Constraints[\s\S]*not for general repository exploration, feature implementation/i
} as const;
const expectedEvaluationFiles = [
  "01-normal-primary.yaml",
  "02-normal-variation.yaml",
  "03-normal-minimal.yaml",
  "04-boundary-loophole.yaml",
  "05-boundary-pressure.yaml"
];

describe("shared-core plugin", () => {
  it("declares the approved plugin metadata", async () => {
    const manifest = JSON.parse(
      await readFile(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")
    ) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      name: "shared-core",
      version: "0.1.0",
      license: "Apache-2.0",
      repository: "https://github.com/seunghyeon1004/claude-code-skillsets",
      author: { name: "seunghyeon1004" },
      skills: "./skills/"
    });
    expect(manifest.keywords).toEqual([
      "workflow",
      "verification",
      "privacy",
      "provenance"
    ]);
  });

  it("contains exactly the eight approved skill directories", async () => {
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(directories).toEqual(expectedSkills);
  });

  it.each(expectedSkills)("validates the %s skill structure", async (skillName) => {
    const content = await readFile(join(skillsRoot, skillName, "SKILL.md"), "utf8");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);

    expect(frontmatterMatch, "SKILL.md must begin with YAML frontmatter").not.toBeNull();
    const frontmatter = YAML.parse(frontmatterMatch?.[1] ?? "") as Record<string, unknown>;
    expect(frontmatter.name).toBe(skillName);
    expect(typeof frontmatter.description).toBe("string");
    expect(frontmatter.description).toMatch(/^Use when\b/);
    expect(frontmatter.description).toMatch(
      expectedDescriptionContracts[skillName as keyof typeof expectedDescriptionContracts]
    );
    expect(frontmatter.description).toMatch(/; not for /i);
    expect(content).toMatch(/^## When Not to Use$/m);
    expect(content.split("\n").length).toBeLessThanOrEqual(500);
  });

  it("does not let indirect context confirm an explicitly unstated brief field", async () => {
    const content = await readFile(join(skillsRoot, "intent-to-brief", "SKILL.md"), "utf8");

    expect(content).toMatch(/confirmed.*direct.*explicit.*exact value/is);
    expect(content).toMatch(/explicitly.*unstated.*open.*indirect context/is);
    expect(content).toMatch(/knows the context.*does not confirm.*audience/is);
    expect(content).toMatch(/artifact family.*does not confirm.*exact deliverable/is);
  });

  it("does not treat emergency instruction precedence as generated-file ownership proof", async () => {
    const content = await readFile(join(skillsRoot, "workspace-context", "SKILL.md"), "utf8");

    expect(content).toMatch(/instruction precedence.*does not prove.*runtime ownership/is);
    expect(content).toMatch(/generated artifact.*locate.*source.*generator.*before editing/is);
    expect(content).toMatch(/incident lead.*urgency.*not.*substitute.*evidence/is);
  });
});

describe("shared-core evaluation corpus", () => {
  it("supplies complete synthetic evidence for handoff and self-contained edit cases", async () => {
    const handoff = YAML.parse(await readFile(
      join(evaluationsRoot, "handoff-continuity", "01-normal-primary.yaml"),
      "utf8"
    )) as { prompt: string; expectedBehaviors: string[]; forbiddenBehaviors: string[] };
    expect(handoff.prompt).toContain("4f3c2a1");
    expect(handoff.prompt).toContain("/workspace/video-pipeline/docs/handoffs/4f3c2a1.md");
    expect(handoff.prompt).toMatch(/already persisted/i);
    expect(handoff.prompt).toContain("release-preview-2026-08-09");
    expect(handoff.prompt).toContain("src/render.ts");
    expect(handoff.prompt).toContain("tests/render.test.ts");
    expect(handoff.prompt).toContain('Current codec allowlist: ["h264", "hevc", "vp9"]');
    expect(handoff.prompt).toMatch(/Changes:.*rejects every codec outside/is);
    expect(handoff.prompt).toMatch(/Decision:.*unsupported codecs must fail closed/is);
    expect(handoff.prompt).toContain("`npm test -- render` => PASS (12/12)");
    expect(handoff.prompt).toContain("`npm run typecheck` => PASS (exit 0)");
    expect(handoff.prompt).toContain(
      "Verification observed fresh at 2026-08-09T10:00:00Z against commit 4f3c2a1 immediately before handoff."
    );
    expect(handoff.prompt).toMatch(
      /Remaining: none for implementation; no failure, risk, flag, cleanup, or approval remains/i
    );
    expect(handoff.prompt).toMatch(
      /Resume:.*read the already-persisted record.*acknowledge the handoff receipt.*not implementation approval or work.*stop after the receipt is acknowledged/is
    );
    expect(handoff.prompt).toMatch(/Owner\/checkpoint: Dana.*2026-08-10T00:00:00Z/i);
    const handoffRubric = handoff.expectedBehaviors.join(" ");
    expect(handoffRubric).toMatch(
      /Outcome.*Artifacts.*Changes.*Decisions.*Verification.*Remaining.*Resume.*Owner\/checkpoint/is
    );
    expect(handoffRubric).toMatch(
      /4f3c2a1.*\["h264", "hevc", "vp9"\].*unsupported codecs must fail closed.*npm test -- render.*npm run typecheck.*none for implementation.*acknowledge the handoff receipt.*Dana/is
    );
    expect(handoffRubric).toContain("/workspace/video-pipeline/docs/handoffs/4f3c2a1.md");
    expect(handoffRubric).toContain("/workspace/video-pipeline");
    expect(handoffRubric).toContain("src/render.ts");
    expect(handoffRubric).toContain("tests/render.test.ts");
    expect(handoffRubric).toMatch(/rejects every codec outside.*strict current allowlist/is);
    expect(handoffRubric).toContain(
      "fresh at 2026-08-09T10:00:00Z against commit 4f3c2a1"
    );
    expect(handoff.forbiddenBehaviors.join(" ")).toMatch(/unknown.*placeholder.*invent/is);

    const workspace = YAML.parse(await readFile(
      join(evaluationsRoot, "workspace-context", "03-normal-minimal.yaml"),
      "utf8"
    )) as { prompt: string; expectedBehaviors: string[] };
    expect(workspace.prompt).toContain("The report recieveed three seperate updates.");
    expect(workspace.expectedBehaviors.join(" ")).toContain(
      "The report received three separate updates."
    );
  });

  it("contains a deterministic 3-normal and 2-boundary corpus for every skill", async () => {
    const rootEntries = await readdir(evaluationsRoot, { withFileTypes: true });
    expect(rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)).toEqual([]);
    expect(
      rootEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    ).toEqual(expectedSkills);

    const expectedPaths = expectedSkills.flatMap((skillName) =>
      expectedEvaluationFiles.map((fileName) => `${skillName}/${fileName}`)
    );
    const actualPaths: string[] = [];
    const caseIds = new Set<string>();

    for (const skillName of expectedSkills) {
      const entries = await readdir(join(evaluationsRoot, skillName), { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
      expect(entries.every((entry) => entry.isFile())).toBe(true);
      expect(files).toEqual(expectedEvaluationFiles);

      const caseTypes: string[] = [];
      for (const fileName of files) {
        const relativePath = `${skillName}/${fileName}`;
        actualPaths.push(relativePath);
        const evaluation = YAML.parse(
          await readFile(join(evaluationsRoot, relativePath), "utf8")
        ) as Record<string, unknown>;

        expect(Object.keys(evaluation)).toEqual([
          "id",
          "caseType",
          "prompt",
          "expectedBehaviors",
          "forbiddenBehaviors"
        ]);
        expect(typeof evaluation.id).toBe("string");
        expect(evaluation.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(caseIds.has(evaluation.id as string)).toBe(false);
        caseIds.add(evaluation.id as string);

        const expectedType = fileName.includes("-normal-") ? "normal" : "boundary";
        expect(evaluation.caseType).toBe(expectedType);
        caseTypes.push(evaluation.caseType as string);
        expect(typeof evaluation.prompt).toBe("string");
        expect((evaluation.prompt as string).trim()).not.toBe("");

        for (const field of ["expectedBehaviors", "forbiddenBehaviors"] as const) {
          expect(Array.isArray(evaluation[field])).toBe(true);
          const behaviors = evaluation[field] as unknown[];
          expect(behaviors.length).toBeGreaterThan(0);
          expect(
            behaviors.every((behavior) => typeof behavior === "string" && behavior.trim() !== "")
          ).toBe(true);
        }

        const expected = new Set(evaluation.expectedBehaviors as string[]);
        const forbidden = evaluation.forbiddenBehaviors as string[];
        expect(forbidden.filter((behavior) => expected.has(behavior))).toEqual([]);
      }

      expect(caseTypes.filter((type) => type === "normal")).toHaveLength(3);
      expect(caseTypes.filter((type) => type === "boundary")).toHaveLength(2);
    }

    expect(actualPaths).toEqual(expectedPaths);
    expect(caseIds.size).toBe(40);
  });
});
