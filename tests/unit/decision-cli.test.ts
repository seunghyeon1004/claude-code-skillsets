import { describe, expect, it } from "vitest";
import { runDiscoveryCli } from "../../src/discovery/cli.js";
import type { DecisionIndex } from "../../src/model/decision.js";

describe("decision-plan CLI", () => {
  it("requires bounded target arguments and either one goal or prioritized domains", async () => {
    const stderr: string[] = [];

    const exitCode = await runDiscoveryCli(
      ["decision-plan", "--runtime", "codex", "--platform", "darwin", "--as-of", "2026-07-29T00:00:00Z"],
      "/fixture",
      { loadDecisionIndex: async () => fixtureIndex(), writeStdout: () => undefined, writeStderr: (value) => stderr.push(value) }
    );

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("Usage: npm run broker -- decision-plan");
  });

  it("returns a non-executing plan from the root-validated decision index", async () => {
    const stdout: string[] = [];
    const exitCode = await runDiscoveryCli(
      [
        "decision-plan", "--runtime", "claude-code", "--platform", "darwin", "--as-of", "2026-07-29T00:00:00Z",
        "--domain", "commerce"
      ],
      "/fixture",
      { loadDecisionIndex: async () => fixtureIndex(), writeStdout: (value) => stdout.push(value), writeStderr: () => undefined }
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      status: "held",
      domainIds: ["commerce"],
      executionStatus: "not-executed"
    });
  });

  it("holds broker output before the index observation window", async () => {
    const stdout: string[] = [];
    const exitCode = await runDiscoveryCli(
      [
        "decision-plan", "--runtime", "claude-code", "--platform", "darwin", "--as-of", "2026-07-28T23:59:59Z",
        "--domain", "commerce"
      ],
      "/fixture",
      { loadDecisionIndex: async () => fixtureIndex(), writeStdout: (value) => stdout.push(value), writeStderr: () => undefined }
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      status: "held",
      holdReasons: ["catalog-not-current"],
      executionStatus: "not-executed"
    });
  });
});

function fixtureIndex(): DecisionIndex {
  return {
    schemaVersion: 3,
    catalogVersion: "1".repeat(64),
    observedThrough: "2026-07-29T00:00:00Z",
    catalogExpiresAt: "2026-08-07T00:00:00Z",
    profiles: [{
      id: "commerce",
      domainId: "commerce",
      phrases: { ko: ["commerce"], en: ["commerce"] },
      coreCapabilityId: "operate-stores-and-marketplaces",
      requiredCapabilityIds: ["manage-product-catalogs-and-listings"]
    }],
    candidates: [{
      id: "held-candidate",
      sourceId: "held-source",
      skillPath: "skills/held/SKILL.md",
      runtime: "claude-code",
      state: "held",
      stateReasons: ["target-unknown:claude-code/darwin"],
      providedCapabilityIds: ["operate-stores-and-marketplaces"],
      capabilityEvidenceIds: ["held-evidence"],
      revisionBinding: "exact",
      permissions: { status: "unknown", evidence: [] },
      license: { status: "unknown", evidence: [] },
      trust: { status: "unknown", evidence: [] },
      dependencies: { status: "unknown", evidence: [] }
    }],
    candidateEvidence: [{
      id: "held-evidence",
      candidateId: "held-candidate",
      capabilityId: "operate-stores-and-marketplaces",
      kind: "observation",
      current: true,
      reference: "research/snapshots/example.json#/entries/0",
      contentSha256: "2".repeat(64),
      candidate: {
        id: "held-candidate",
        sourceId: "held-source",
        skillPath: "skills/held/SKILL.md",
        runtime: "claude-code",
        state: "held",
        stateReasons: ["target-unknown:claude-code/darwin"],
        providedCapabilityIds: ["operate-stores-and-marketplaces"],
        capabilityEvidenceIds: ["held-evidence"],
        revisionBinding: "exact",
        permissions: { status: "unknown", evidence: [] },
        license: { status: "unknown", evidence: [] },
        trust: { status: "unknown", evidence: [] },
        dependencies: { status: "unknown", evidence: [] }
      }
    }],
    intentFixtures: [],
    digest: "3".repeat(64)
  };
}
