import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDecisionIndex } from "../../src/decision/repository.js";
import { loadDiscoveryBroker, type DiscoveryBroker } from "../../src/discovery/broker.js";
import { runDiscoveryCli } from "../../src/discovery/cli.js";
import type { DecisionIndex } from "../../src/model/decision.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const cloneUrl = "https://github.com/seunghyeon1004/claude-code-skillsets.git";
const codexCommands = [
  `git clone ${cloneUrl}`,
  "cd claude-code-skillsets",
  "npm ci",
  'AS_OF="$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
  "npm run broker -- decision-plan --runtime codex --platform darwin --as-of \"$AS_OF\" --goal \"software development\"",
  "npm run broker -- domains",
  "npm run broker -- runtime codex --limit 20",
  "npm run broker -- review-queue",
  "npm run broker -- recommend \"software development\" --limit 20",
  "npm run broker -- provenance"
];
let broker: DiscoveryBroker;
let decisionIndex: DecisionIndex;

beforeAll(async () => {
  [broker, decisionIndex] = await Promise.all([
    loadDiscoveryBroker(projectRoot),
    loadDecisionIndex(projectRoot)
  ]);
}, 30_000);

describe("Codex public discovery quick start", () => {
  it("documents a dependency-prepared fresh checkout without requiring gh", async () => {
    const [readmeKo, readmeEn, packageJson] = await Promise.all([
      readFile(join(projectRoot, "README.md"), "utf8"),
      readFile(join(projectRoot, "README.en.md"), "utf8"),
      readFile(join(projectRoot, "package.json"), "utf8")
    ]);

    const manifest = JSON.parse(packageJson) as { scripts: Record<string, string>; engines: { node: string } };
    expect(manifest.engines.node).toBe(">=22");
    for (const readme of [readmeKo, readmeEn]) {
      const quickStart = markdownSection(readme, readme === readmeKo ? "## Codex 빠른 시작" : "## Codex Quick Start");
      expect(quickStart).toMatch(/Node\.js.*>=22/);
      expect(quickStart).not.toMatch(/private repository|비공개\s*저장소/i);
      expect(quickStart).toMatch(/gh[\s\S]*not required|gh[\s\S]*필요하지 않습니다/i);
      expect(quickStart).toContain("cd /path/to/claude-code-skillsets");
      for (const command of codexCommands) expect(quickStart).toContain(command);
    }
  });

  it("keeps Codex as a non-executing approval boundary and Claude Code as a visible public install path", async () => {
    const [readmeKo, readmeEn] = await Promise.all([
      readFile(join(projectRoot, "README.md"), "utf8"),
      readFile(join(projectRoot, "README.en.md"), "utf8")
    ]);

    for (const [readme, codexHeading, claudeHeading] of [
      [readmeKo, "## Codex 빠른 시작", "## Claude Code 빠른 시작"],
      [readmeEn, "## Codex Quick Start", "## Claude Code Quick Start"]
    ] as const) {
      const codex = markdownSection(readme, codexHeading);
      const claude = markdownSection(readme, claudeHeading);
      expect(codex.indexOf(codexHeading)).toBeGreaterThanOrEqual(0);
      expect(claude.indexOf(claudeHeading)).toBeGreaterThanOrEqual(0);
      expect(codex).toMatch(/decision-plan/);
      expect(codex).toMatch(/runtime codex/);
      expect(codex).toMatch(/executionStatus: "not-executed"/);
      expect(codex).toMatch(/approval|required|승인/i);
      expect(codex).toContain("$skill-installer");
      expect(codex).toContain("preview-only");
      expect(codex).toMatch(/does not[\s\S]*install|Codex에서는[\s\S]*실행하지 않습니다/i);
      expect(codex).toMatch(/not.*compatibility|호환성.*자동으로/i);
      expect(codex).not.toContain("claude plugin marketplace add");
      expect(codex).not.toContain("claude plugin install");
      expect(codex).not.toContain("claude plugin update");
      expect(claude).toContain("claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user");
      expect(claude).toContain("claude plugin install skillset-manager@claude-code-skillsets --scope user");
    }
  });

  it("runs the documented broker discovery commands after dependency preparation without executing plugins", async () => {
    const outputs = new Map<string, Record<string, unknown>>();
    for (const [name, args] of [
      ["decisionPlan", [
        "decision-plan", "--runtime", "codex", "--platform", "darwin", "--as-of", "2026-07-29T00:00:00Z",
        "--goal", "software development"
      ]],
      ["domains", ["domains"]],
      ["runtime", ["runtime", "codex", "--limit", "20"]],
      ["reviewQueue", ["review-queue"]],
      ["official", ["official", "software-engineering", "--limit", "2"]],
      ["prepare", ["prepare-official", "software-engineering"]],
      ["recommend", ["recommend", "software development", "--limit", "20"]]
    ] as const) {
      let stdout = "";
      const exitCode = await runDiscoveryCli(args, projectRoot, {
        loadBroker: async () => broker,
        writeStdout: (value) => { stdout += value; },
        writeStderr: () => undefined
      });
      expect(exitCode, name).toBe(0);
      outputs.set(name, JSON.parse(stdout) as Record<string, unknown>);
    }

    expect(outputs.get("decisionPlan")).toMatchObject({
      status: "held",
      candidates: [],
      executionStatus: "not-executed"
    });
    expect(outputs.get("decisionPlan")?.provenanceDigest).toBe(decisionIndex.digest);
    expect(outputs.get("domains")).toMatchObject({ status: "held" });
    expect(outputs.get("runtime")).toMatchObject({
      runtime: "codex",
      codexDisposition: "discovery-only-no-execution",
      nextAction: "review-reclassification-queue"
    });
    expect(outputs.get("reviewQueue")).toMatchObject({
      kind: "source-review-backlog",
      status: "review-required",
      executionStatus: "not-executed",
      totalCandidateCount: 14,
      delegatedOfficialSourceIds: ["anthropic-plugins-official"]
    });
    expect(outputs.get("official")).toMatchObject({
      runtime: "claude-code",
      codexDisposition: "discovery-only-no-execution",
      executionStatus: "not-executed"
    });
    expect(outputs.get("prepare")).toMatchObject({
      runtime: "claude-code",
      codexDisposition: "discovery-only-no-execution",
      executionStatus: "not-executed"
    });
    expect(outputs.get("recommend")).toMatchObject({ status: "held" });
  }, 20_000);
});

function markdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start, `missing ${heading}`).toBeGreaterThanOrEqual(0);
  const next = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, next === -1 ? content.length : next);
}
