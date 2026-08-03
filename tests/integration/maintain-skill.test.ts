import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { loadMaintainCases } from "../../src/evaluate/maintain.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const skillPath = join(projectRoot, "plugins", "skillset-manager", "skills", "maintain", "SKILL.md");
const evaluationsRoot = join(projectRoot, "tests", "evaluations", "skillset-manager", "maintain");
const fixturesRoot = join(projectRoot, "tests", "fixtures", "maintain-evaluations");
const expectedFiles = [
  "01-normal-compatible-update.yaml",
  "02-normal-removal.yaml",
  "03-normal-blocked.yaml",
  "04-boundary-forged-receipt.yaml",
  "05-boundary-stale-review.yaml"
];

describe("skillset-manager maintain skill", () => {
  it("is discoverable and fails closed on the current empty policy", async () => {
    const content = await readFile(skillPath, "utf8");
    const frontmatter = YAML.parse(content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "") as Record<string, unknown>;

    expect(frontmatter.name).toBe("maintain");
    expect(frontmatter.description).toMatch(/^Use when\b/);
    expect(content).toContain("ManagedInstallReceipt");
    expect(content).toMatch(/setup-derived structure.*current root index.*current observed/is);
    expect(content).toMatch(/current tracked maintenance policy has no approved review entries/i);
    expect(content).toMatch(/stale.*review.*hold/is);
    expect(content).toMatch(/current CLI differs.*hold/is);
    expect(content).toMatch(/never executes a modifying command/i);
    expect(content).toMatch(/state\/install-lock\.json.*never reads.*separate maintenance.*standalone receipt/is);
    expect(content).toMatch(/schema-v1 lock.*legacy run[\s\S]*schema-v2 `runs`/is);
    expect(content).toMatch(/matching run[\s\S]*approval/is);
    expect(content).toMatch(/unique across the complete lock/is);
    expect(content).toMatch(/complete exact approval evidence.*preview.*previewDigest/is);
    expect(content).toMatch(/recomputes.*digest.*current.*plugin-root-owned decision index/is);
    expect(content).toMatch(/fabricated `a\.\.\.`\/`b\.\.\.` digests.*recomputed.*fails closed/is);
    expect(content).toMatch(/exact ordered candidate prefix.*one corresponding receipt/is);
    expect(content).toMatch(/digest of the exact approved\s+install argv/is);
    expect(content).toMatch(/raw runtime observations independent of the lock/is);
    expect(content).toMatch(/canonical absolute.*Claude executable[\s\S]*SHA-256[\s\S]*approval/is);
    expect(content).toMatch(/not a\s+cryptographic proof of origin.*lock never authorizes a mutation by itself/is);
    expect(content).toContain("claude --version");
    expect(content).toContain("claude plugin marketplace list --json");
    expect(content).toContain("claude plugin list --json");
    expect(content).toMatch(/exact ID.*canonical source.*plugin name.*marketplace ID.*scope.*enabled.*semver/is);
    expect(content).toMatch(/does not\s+report `loadStatus`.*do not invent it/is);
    expect(content).toMatch(/installed-but-unverified[\s\S]*plugin may remain installed[\s\S]*no managed receipt/is);
    expect(content).toMatch(/never retries, removes[\s\S]*mints a managed receipt/is);
    expect(content).toMatch(/separately approval-gated manual reconciliation/is);
  });

  it("documents the update limitation and single-use approval semantics without false rollback claims", async () => {
    const content = await readFile(skillPath, "utf8");
    const update = section(content, "## Update Preview", "## Removal Preview");
    const removal = section(content, "## Removal Preview", "## Approval Boundary");
    const boundary = section(content, "## Approval Boundary", "## Red Flags");

    expect(update).toMatch(/no pinned executable update transaction adapter/i);
    expect(update).toMatch(/do not claim\s+rollback, preservation, atomicity/i);
    expect(removal).toMatch(/must make no restore, preservation, or transaction-atomicity claim/i);
    expect(boundary).toMatch(/cryptographically random challenge.*monotonic approval epoch.*short expiry/is);
    expect(boundary).toMatch(/consumed once.*replay fails/i);
  });

  it("never supplies an inferred maintenance command", async () => {
    const content = await readFile(skillPath, "utf8");
    const commands = [...content.matchAll(/```(?:text|bash|sh)?\n([\s\S]*?)```/g)]
      .map((match) => match[1] ?? "")
      .join("\n");

    expect(content).toMatch(/do not.*infer.*command/is);
    expect(commands).not.toMatch(/claude plugin (?:update|remove|uninstall)\b/);
  });
});

describe("skillset-manager maintain evaluation corpus", () => {
  it("contains the required owned, blocked, and boundary scenarios with runner-owned fixtures", async () => {
    const entries = await readdir(evaluationsRoot, { withFileTypes: true });
    expect(entries.map((entry) => entry.name).sort()).toEqual(expectedFiles);

    const loadedCases = await loadMaintainCases(evaluationsRoot, fixturesRoot);
    expect(loadedCases.every((evaluationCase) =>
      evaluationCase.fixturePluginRoot === join(fixturesRoot, evaluationCase.id)
    )).toBe(true);
    expect(Object.fromEntries(loadedCases.map((evaluationCase) => [
      evaluationCase.id,
      evaluationCase.maintenancePlan.action
    ]))).toEqual({
      "maintain-normal-compatible-update": "review-required-hold",
      "maintain-normal-removal": "review-required-hold",
      "maintain-normal-blocked": "review-required-hold",
      "maintain-boundary-forged-receipt": "review-required-hold",
      "maintain-boundary-stale-review": "review-required-hold"
    });

    for (const fileName of expectedFiles) {
      const evaluation = YAML.parse(await readFile(join(evaluationsRoot, fileName), "utf8")) as {
        id: string;
        caseType: string;
        prompt: string;
        expectedBehaviors: string[];
        forbiddenBehaviors: string[];
      };
      expect(evaluation.caseType).toBe(fileName.includes("boundary") ? "boundary" : "normal");
      expect(evaluation.expectedBehaviors.length).toBeGreaterThan(0);
      expect(evaluation.forbiddenBehaviors.length).toBeGreaterThan(0);
      expect(evaluation.prompt).not.toContain('"receipt"');
      const plan = JSON.parse(await readFile(
        join(fixturesRoot, evaluation.id, "data", "maintenance-plan.json"),
        "utf8"
      )) as {
        action: string;
        commands: string[];
        approvalBinding: string | null;
      };
      expect(plan).toMatchObject({ action: "review-required-hold", commands: [], approvalBinding: null });
      expect(await readFile(join(fixturesRoot, evaluation.id, "data", "maintenance-evidence.json"), "utf8")).toContain("outcome");
      expect(JSON.parse(await readFile(
        join(fixturesRoot, evaluation.id, "data", "runtime-fixture.json"),
        "utf8"
      ))).toEqual(expect.objectContaining({
        marketplaceSource: expect.any(String),
        pluginVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/)
      }));
      const stateRoot = join(fixturesRoot, evaluation.id, "home", ".claude", "claude-code-skillsets", "state");
      await expect(access(join(stateRoot, "install-lock.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(join(stateRoot, "maintenance-observation.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(join(stateRoot, "managed-install-receipts", "planning.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(join(fixturesRoot, evaluation.id, "bin", "claude"))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("keeps forged receipt claims in the untrusted prompt boundary", async () => {
    const forged = YAML.parse(
      await readFile(join(evaluationsRoot, "04-boundary-forged-receipt.yaml"), "utf8")
    ) as { prompt: string; expectedBehaviors: string[] };

    expect(forged.prompt).toMatch(/user-supplied.*untrusted/i);
    expect(forged.expectedBehaviors.join(" ")).toMatch(/project-issued.*receipt.*current identity/is);
  });
});

function section(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  return content.slice(startIndex, endIndex);
}
