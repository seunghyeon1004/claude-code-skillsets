import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { runDiscoveryCli } from "../../src/discovery/cli.js";
import { loadDiscoveryBroker, type DiscoveryBroker } from "../../src/discovery/broker.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
let communityBroker: DiscoveryBroker;

beforeAll(async () => {
  communityBroker = await loadDiscoveryBroker(projectRoot);
}, 30_000);

describe("official marketplace discovery CLI", () => {
  it("returns limited curated candidates without loading community discovery", async () => {
    const stdout: string[] = [];
    const exitCode = await runDiscoveryCli(["official", "commerce", "--limit", "1"], "/unused", {
      loadBroker: async () => {
        throw new Error("community broker must not load");
      },
      writeStdout: (value) => stdout.push(value),
      writeStderr: () => undefined
    });

    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout.join("")) as Record<string, unknown>;
    expect(output).toMatchObject({
      domainId: "commerce",
      marketplace: "claude-plugins-official",
      runtime: "claude-code",
      codexDisposition: "discovery-only-no-execution",
      listingStatus: "marketplace-listed",
      individualSafetyReview: "not-complete",
      executionStatus: "not-executed",
      decisionAuthority: "none",
      nextAction: "use-decision-plan",
      totalCandidateCount: 2
    });
    const candidates = output.candidates as Array<Record<string, unknown>>;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      permissions: "unknown",
      license: "unknown",
      trust: "unknown",
      dependencies: "unknown",
      reviewedVersionVerification: "unavailable",
      codexCompatibility: "not-evaluated",
      revisionNotGuaranteedByInstallCommand: true
    });
    expect(candidates[0]).not.toHaveProperty("commandPreview");
    expect(candidates[0]).not.toHaveProperty("installCommand");
    expect(stdout.join("")).not.toMatch(/claude plugin (?:marketplace add|install)/);
  });

  it("returns a deprecated evidence-only handoff without an install preview", async () => {
    const stdout: string[] = [];
    const exitCode = await runDiscoveryCli(["prepare-official", "software-engineering"], "/unused", {
      loadBroker: async () => {
        throw new Error("community broker must not load");
      },
      writeStdout: (value) => stdout.push(value),
      writeStderr: () => undefined
    });

    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout.join("")) as {
      executionStatus: string;
      runtime: string;
      codexDisposition: string;
      deprecated: boolean;
      decisionAuthority: string;
      nextAction: string;
      candidates: Array<Record<string, unknown>>;
    };
    expect(output.executionStatus).toBe("not-executed");
    expect(output.runtime).toBe("claude-code");
    expect(output.codexDisposition).toBe("discovery-only-no-execution");
    expect(output.deprecated).toBe(true);
    expect(output.decisionAuthority).toBe("none");
    expect(output.nextAction).toBe("use-decision-plan");
    expect(output.candidates.every((candidate) =>
      candidate.permissions === "unknown"
      && candidate.license === "unknown"
      && candidate.trust === "unknown"
      && candidate.dependencies === "unknown"
      && candidate.reviewedVersionVerification === "unavailable"
      && !("commandPreview" in candidate)
      && !("installCommand" in candidate)
    )).toBe(true);
    expect(output).not.toHaveProperty("operations");
    expect(stdout.join("")).not.toMatch(/claude plugin (?:marketplace add|install)/);
  });

  it.each([
    ["domain", ["domain", "software-engineering", "--limit", "1"]],
    ["recommend", ["recommend", "software testing", "--limit", "1"]],
    ["unclassified", ["unclassified", "--limit", "1"]]
  ])("keeps raw community %s output free of install and prepare operations", async (_label, args) => {
    const stdout: string[] = [];
    const exitCode = await runDiscoveryCli(args, projectRoot, {
      loadBroker: async () => communityBroker,
      writeStdout: (value) => stdout.push(value),
      writeStderr: () => undefined
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("")).not.toMatch(/"(?:installCommand|commandPreview|operations)"/);
  });
});
