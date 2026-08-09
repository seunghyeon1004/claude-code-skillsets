import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelOutput, ModelRequest, ModelRunner } from "../../src/evaluate/setup.js";

const projectRoot = process.cwd();
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read-only setup runtime preview handoff", () => {
  it("materializes an actual schema-v2 preview as a minimal projection and evaluates exact Reads only", async () => {
    const module = await import("../../src/evaluate/setup-preview.js").catch(() => ({}));
    const run = (module as {
      runSetupPreviewEvaluation?: (
        options: { outputDirectory: string },
        dependencies: {
          runner: ModelRunner;
          environment: NodeJS.ProcessEnv;
          projectRoot: string;
        }
      ) => Promise<{ passed: boolean; cases: Array<{ caseId: string }> }>;
    }).runSetupPreviewEvaluation;
    expect(typeof run).toBe("function");
    if (run === undefined) return;

    const root = await temporaryDirectory("setup-preview-test-");
    const home = join(root, "home");
    const bin = join(root, "bin");
    const outputDirectory = join(root, "receipts");
    await Promise.all([mkdir(home), mkdir(bin)]);
    const claude = join(bin, "claude");
    await writeFile(claude, [
      "#!/bin/sh",
      "test -z \"$ANTHROPIC_API_KEY\" || exit 90",
      "printf '2.1.198 (Claude Code)\\n'",
      ""
    ].join("\n"), "utf8");
    await chmod(claude, 0o755);
    const claudeSha256 = createHash("sha256").update(await readFile(claude)).digest("hex");
    const runner = new PreviewRunner();

    const summary = await run({ outputDirectory }, {
      runner,
      environment: {
        PATH: "/usr/bin:/bin",
        HOME: home,
        TMPDIR: tmpdir(),
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        NO_COLOR: "1",
        TERM: "dumb",
        SEMANTIC_RC_CLAUDE_EXECUTABLE: claude,
        SEMANTIC_RC_CLAUDE_SHA256: claudeSha256,
        ANTHROPIC_API_KEY: "must-not-reach-preview"
      },
      projectRoot
    });

    expect(summary.passed).toBe(true);
    expect(summary.cases).toEqual([expect.objectContaining({ caseId: "setup-runtime-preview-handoff" })]);
    const responseRequest = runner.requests.find(({ kind }) => kind === "response");
    expect(responseRequest?.allowedTools).toEqual(["Read"]);
    expect(responseRequest?.requiredReads?.map(({ expectedStatus }) => expectedStatus)).toEqual([
      "success",
      "failure",
      "success"
    ]);
    expect(responseRequest?.requiredReads?.map(({ path }) => path.replace(/^.*\/state\//u, "state/"))).toEqual([
      expect.stringMatching(/data\/routing-index\.json$/u),
      "state/install-lock.json",
      "state/runtime-preview.json"
    ]);
    expect(responseRequest?.systemPrompt).toMatch(/schema-v2.*preview/i);
    expect(responseRequest?.systemPrompt).toMatch(/Bash.*forbidden|forbidden.*Bash/i);
    expect(responseRequest?.additionalDirectories).toHaveLength(1);

    expect(runner.projection).toEqual({
      schemaVersion: 1,
      fixtureKind: "approved-official-disposable",
      executionInvoked: false,
      status: "awaiting-risk-acknowledgement",
      decisionIndexDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      routingIndexDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      approvalPreviewDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      candidateIds: expect.arrayContaining([expect.stringMatching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)]),
      riskDisclosures: expect.any(Array),
      approvalBoundaries: {
        riskAcknowledgementRequired: true,
        separateExactApprovalRequired: true,
        executionAuthorized: false
      }
    });
    const projectionRaw = JSON.stringify(runner.projection);
    expect(projectionRaw).not.toMatch(/argv|approvedExecution|approvalObjectAccess/u);
    expect(projectionRaw).not.toContain(process.execPath);
    expect(projectionRaw).not.toContain(home);
    expect(projectionRaw).not.toContain("must-not-reach-preview");

    const rawSummary = await readFile(join(outputDirectory, "summary.json"), "utf8");
    expect(rawSummary).not.toMatch(/runtime-preview\.json|approvedExecution|approvalObjectAccess/u);
  }, 30_000);

  it("rejects non-closed, oversized, or digest-mismatched runtime preview output", async () => {
    const module = await import("../../src/evaluate/setup-preview.js").catch(() => ({}));
    const project = (module as {
      validateAndProjectSetupRuntimePreview?: (
        raw: string,
        expected: { decisionIndexDigest: string; routingIndexDigest: string }
      ) => unknown;
    }).validateAndProjectSetupRuntimePreview;
    expect(typeof project).toBe("function");
    if (project === undefined) return;

    const decisionIndexDigest = "b".repeat(64);
    const routingIndexDigest = "c".repeat(64);
    const preview = validRuntimePreview(decisionIndexDigest, routingIndexDigest);
    const reviewSummary = preview.reviewSummary as string;
    expect(project(canonicalJson(preview), { decisionIndexDigest, routingIndexDigest })).toMatchObject({
      executionInvoked: false,
      decisionIndexDigest,
      routingIndexDigest,
      candidateIds: ["fixture-candidate"]
    });
    expect(() => project(canonicalJson({ ...preview, extra: "not closed" }), {
      decisionIndexDigest,
      routingIndexDigest
    })).toThrow(/closed|field|shape/i);
    expect(() => project(canonicalJson({
      ...preview,
      reviewSummary: reviewSummary.replace(routingIndexDigest, "d".repeat(64))
    }), { decisionIndexDigest, routingIndexDigest })).toThrow(/routing.*digest|digest.*routing/i);
    expect(() => project(canonicalJson({
      ...preview,
      discoveryCandidates: [{
        candidateId: "untrusted",
        sourceId: "source-a",
        domainIds: ["video-and-audio"],
        state: "held",
        stateReasons: ["review-required"],
        evidenceSupport: ["related"],
        installable: true
      }]
    }), { decisionIndexDigest, routingIndexDigest })).toThrow(/discovery.*(?:shape|bound)/i);
    expect(() => project(" ".repeat(64 * 1024 + 1), {
      decisionIndexDigest,
      routingIndexDigest
    })).toThrow(/size|large|bound/i);
  });
});

class PreviewRunner implements ModelRunner {
  readonly requests: ModelRequest[] = [];
  projection: unknown;

  async run(request: ModelRequest): Promise<ModelOutput> {
    this.requests.push(request);
    if (request.kind === "judge") {
      const payload = JSON.parse(request.prompt) as {
        caseId: string;
        expectedBehaviors: string[];
        forbiddenBehaviors: string[];
      };
      return {
        structured: {
          caseId: payload.caseId,
          expectedBehaviors: behaviorResults(
            payload.expectedBehaviors,
            "The response used the authenticated preview handoff.",
            "Expected behavior is present."
          ),
          forbiddenBehaviors: behaviorResults(
            payload.forbiddenBehaviors,
            "No forbidden action was taken.",
            "Forbidden behavior is absent."
          )
        }
      };
    }
    const reads = request.requiredReads ?? [];
    const previewRead = reads[2];
    if (previewRead === undefined) throw new Error("Preview Read is missing");
    this.projection = JSON.parse(await readFile(previewRead.path, "utf8")) as unknown;
    const projection = this.projection as {
      decisionIndexDigest: string;
      routingIndexDigest: string;
      candidateIds: string[];
      riskDisclosures: string[];
    };
    return {
      text: [
        `The decision digest ${projection.decisionIndexDigest} and routing digest ${projection.routingIndexDigest} match.`,
        `The runtime preview, not routing data, supplies candidates: ${projection.candidateIds.join(", ")}.`,
        `Risks requiring acknowledgement: ${projection.riskDisclosures.join(", ")}.`,
        "A separate exact approval is required after risk acknowledgement. Execution remains unauthorized."
      ].join("\n"),
      toolCalls: reads.map((read) => ({
        name: "Read",
        input: { file_path: read.path },
        completed: true,
        success: read.expectedStatus === "success"
      }))
    };
  }
}

function behaviorResults(behaviors: string[], evidence: string, reason: string): Record<string, unknown> {
  return Object.fromEntries(behaviors.map((behavior, index) => [`item${index}`, {
    behavior,
    passed: true,
    evidence,
    reason
  }]));
}

function validRuntimePreview(decisionIndexDigest: string, routingIndexDigest: string): Record<string, unknown> {
  const previewDigest = "a".repeat(64);
  const riskDisclosures = ["individual-safety-review:not-complete"];
  const reviewSummary = [
    "# Setup Review Summary",
    `approvalPreviewDigest: ${previewDigest}`,
    `decisionIndexDigest: ${decisionIndexDigest}`,
    `routingIndexDigest: ${routingIndexDigest}`,
    "catalogExpiresAt: 2026-08-12T02:30:05Z",
    `candidates: ${JSON.stringify([{ candidateId: "fixture-candidate" }])}`,
    "sources: []",
    "externalCommands: []",
    "evidenceLevels: []",
    "unknowns: []",
    "discoveryCandidates: []",
    "discoveryAuthority: discovery-only; not approval-bound; installable:false",
    "uncoveredCapabilities: []",
    `riskDisclosures: ${JSON.stringify(riskDisclosures)}`,
    "executableIdentities: {}",
    "statePaths: []",
    "fullApprovalObject: available on demand; verify approvalPreviewDigest before use",
    ""
  ].join("\n");
  return {
    schemaVersion: 1,
    command: "preview",
    status: "awaiting-risk-acknowledgement",
    holdReason: null,
    holdReasons: [],
    discoveryCandidates: [],
    approval: { previewDigest },
    reviewSummary,
    riskAcknowledgement: {
      statement: "I acknowledge every listed setup risk disclosure for this exact preview.",
      disclosures: riskDisclosures,
      digest: "d".repeat(64)
    },
    approvalObjectAccess: { availability: "on-demand", argv: [process.execPath, "runtime.mjs"] },
    approvedExecution: {
      approvalBoundary: "separate-exact-Bash-tool-call",
      argv: [process.execPath, "runtime.mjs", "execute"]
    }
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortJson(record[key])]));
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  temporaryRoots.push(root);
  return root;
}
