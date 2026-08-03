import { describe, expect, it } from "vitest";
import {
  inheritedEvidenceDigest,
  isExactReviewDecisionCurrent,
  materializeReviewState,
  type ReviewStateObservation
} from "../../src/research/review-state.js";
import { hashReviewEvent } from "../../src/research/review-ledger.js";
import type { ObservationEvidence, SourceDiff, SourceObservation } from "../../src/model/observation.js";
import type { ReviewLedgerEvent, ReviewerRegistry } from "../../src/model/review-ledger.js";

const reviewers: ReviewerRegistry = {
  schemaVersion: 3,
  reviewers: [{ id: "maintainer", roles: ["maintainer", "security-reviewer"] }]
};

describe("materialized review state", () => {
  it("exposes the exact-path predicate used by materialization for other verified bindings", () => {
    const observation = currentObservation();
    const approved = signed(event(observation));
    const skillPath = "skills/example/SKILL.md";

    expect(isExactReviewDecisionCurrent(approved, observation, skillPath, "2026-07-29T00:00:00Z")).toBe(true);
    expect(isExactReviewDecisionCurrent({
      ...approved,
      baseline: { ...approved.baseline, pathBlobSha: "f".repeat(40) }
    }, observation, skillPath, "2026-07-29T00:00:00Z")).toBe(false);
    expect(isExactReviewDecisionCurrent({
      ...approved,
      baseline: { ...approved.baseline, inheritedEvidenceDigest: "f".repeat(64) }
    }, observation, skillPath, "2026-07-29T00:00:00Z")).toBe(false);
  });

  it("keeps an exact-path approval across unrelated commits", () => {
    const observation = currentObservation();
    const result = materializeReviewState(input(observation, [signed(event(observation))]));

    expect(result[0]).toMatchObject({
      sourceId: "source-a",
      skillPath: "skills/example/SKILL.md",
      state: "approved",
      reason: "current"
    });
  });

  it("keeps an exact approval when an unrelated plugin manifest changes", () => {
    const target = "plugins/target/skills/example/SKILL.md";
    const baseline = currentObservation({
      evidence: evidence({
        blobs: [
          observedBlob("plugin.json", "c".repeat(40), "a".repeat(64)),
          observedBlob("plugins/target/.claude-plugin/plugin.json", "d".repeat(40), "b".repeat(64)),
          observedBlob(target, "e".repeat(40), "c".repeat(64)),
          observedBlob("plugins/unrelated/.claude-plugin/plugin.json", "f".repeat(40), "d".repeat(64))
        ]
      })
    });
    const current = currentObservation({
      evidence: evidence({
        blobs: [
          observedBlob("plugin.json", "c".repeat(40), "a".repeat(64)),
          observedBlob("plugins/target/.claude-plugin/plugin.json", "d".repeat(40), "b".repeat(64)),
          observedBlob(target, "e".repeat(40), "c".repeat(64)),
          observedBlob("plugins/unrelated/.claude-plugin/plugin.json", "0".repeat(40), "e".repeat(64))
        ]
      })
    });
    const approved = signed(event(baseline, {
      target: { sourceId: "source-a", skillPath: target },
      baseline: {
        snapshotId: baseline.snapshotId,
        inspectedCommit: baseline.source.inspectedCommit,
        contentSha256: baseline.snapshotContentSha256,
        pathBlobSha: "e".repeat(40),
        inheritedEvidenceDigest: inheritedEvidenceDigest(baseline.evidence, target)!
      }
    }));

    expect(materializeReviewState(input(current, [approved]))[0]).toMatchObject({
      state: "approved",
      reason: "current"
    });
  });

  it("keeps a collector-shaped exact approval current when sibling plugin evidence changes", () => {
    const target = "plugins/target/skills/example/SKILL.md";
    const baseline = currentObservation({ evidence: collectorShapedEvidence(target) });
    const current = currentObservation({
      evidence: collectorShapedEvidence(target, {
        siblingDependencySha: "0".repeat(64),
        siblingMcpSha: "1".repeat(64)
      })
    });
    const approved = collectorShapedApproval(baseline, target);

    expect(materializeReviewState(input(current, [approved]))[0]).toMatchObject({
      state: "approved",
      reason: "current"
    });
  });

  it.each([
    ["root LICENSE", { rootLicenseSha: "0".repeat(64) }],
    ["ancestor dependency evidence", { ancestorDependencySha: "1".repeat(64) }],
    ["target MCP configuration evidence", { targetMcpSha: "2".repeat(64) }]
  ])("stales a collector-shaped exact approval when %s changes", (_label, changes) => {
    const target = "plugins/target/skills/example/SKILL.md";
    const baseline = currentObservation({ evidence: collectorShapedEvidence(target) });
    const current = currentObservation({ evidence: collectorShapedEvidence(target, changes) });
    const approved = collectorShapedApproval(baseline, target);

    expect(materializeReviewState(input(current, [approved]))[0]).toMatchObject({
      state: "held",
      reason: "stale"
    });
  });

  it("keeps an exact approval across an A-to-B-to-C sequence of unrelated commits", () => {
    const current = currentObservation({
      snapshotId: "snapshot-c",
      evidence: evidence({ id: "observation-c", inspectedCommit: "c".repeat(40) }),
      previousEvidence: evidence({ id: "observation-b", inspectedCommit: "b".repeat(40) }),
      previousSnapshotId: "snapshot-b"
    });
    const approved = signed(event(current, {
      baseline: {
        snapshotId: "snapshot-a",
        inspectedCommit: "a".repeat(40),
        contentSha256: current.snapshotContentSha256,
        pathBlobSha: "d".repeat(40),
        inheritedEvidenceDigest: inheritedEvidenceDigest(current.evidence)!
      }
    }));

    expect(materializeReviewState(input(current, [approved]))[0]).toMatchObject({
      state: "approved",
      reason: "current"
    });
  });

  it("materializes a structurally valid historical decision after its reviewer is removed", () => {
    const observation = currentObservation();
    const approved = signed(event(observation, { reviewerId: "retired-maintainer" }));
    const currentReviewers: ReviewerRegistry = {
      schemaVersion: 3,
      reviewers: [{ id: "maintainer", roles: ["maintainer", "security-reviewer"] }]
    };

    expect(materializeReviewState(input(observation, [approved], currentReviewers))[0]).toMatchObject({
      state: "approved",
      reason: "current"
    });
  });

  it("stales approval when the path blob, manifest chain, ownership, or inherited evidence changes", () => {
    const current = currentObservation({
      evidence: evidence({
        blobs: [
          observedBlob("plugin.json", "f".repeat(40), "0".repeat(64)),
          observedBlob("skills/example/SKILL.md", "d".repeat(40), "e".repeat(64))
        ],
        fields: {
          ...evidence().fields,
          ownership: observedField("plugin.json", "0".repeat(64))
        }
      })
    });
    const baseline = currentObservation();

    const result = materializeReviewState(input(current, [signed(event(baseline))]));

    expect(result[0]).toMatchObject({ state: "held", reason: "stale", invalidatedDecisionId: "decision-a" });
  });

  it("stales an exact approval when only its path blob changes", () => {
    const current = currentObservation({
      evidence: evidence({
        blobs: [
          observedBlob("plugin.json", "c".repeat(40), "a".repeat(64)),
          observedBlob("skills/example/SKILL.md", "f".repeat(40), "0".repeat(64))
        ]
      })
    });
    const baseline = currentObservation();

    expect(materializeReviewState(input(current, [signed(event(baseline))]))[0]).toMatchObject({
      state: "held",
      reason: "stale"
    });
  });

  it("stales a source decision when its inspected commit changes", () => {
    const observation = currentObservation();
    const sourceDecision = signed(event(observation, {
      target: { sourceId: "source-a", skillPath: null },
      disposition: "held",
      baseline: {
        snapshotId: "snapshot-current",
        inspectedCommit: "a".repeat(40),
        contentSha256: "9".repeat(64),
        pathBlobSha: null,
        inheritedEvidenceDigest: "1".repeat(64)
      }
    }));

    expect(materializeReviewState(input(observation, [sourceDecision]))[0]).toMatchObject({
      state: "held",
      reason: "stale-evidence"
    });
  });

  it("lets source blocked override exact-path approved and does not auto-expire the block", () => {
    const observation = currentObservation();
    const approved = signed(event(observation, { reviewedAt: "2026-07-27T00:00:00Z" }));
    const blocked = signed(event(observation, {
      sequence: 2,
      id: "decision-source-blocked",
      previousEventHash: approved.eventHash,
      target: { sourceId: "source-a", skillPath: null },
      disposition: "blocked",
      reviewedAt: "2026-07-27T01:00:00Z",
      expiresAt: "2026-07-28T00:00:00Z"
    }));

    const result = materializeReviewState(input(observation, [approved, blocked]));

    expect(result).toHaveLength(2);
    expect(result.every((state) => state.state === "blocked" && state.reason === "blocked")).toBe(true);
  });

  it("keeps legacy observations held and not-reviewed when no v3 evidence or ledger decision exists", () => {
    const legacy = currentObservation({ evidence: undefined });

    expect(materializeReviewState(input(legacy, []))).toEqual([expect.objectContaining({
      state: "held",
      reason: "not-reviewed",
      decisionId: null,
      invalidatedDecisionId: null
    })]);
  });
});

function input(
  observation: ReviewStateObservation,
  ledger: ReviewLedgerEvent[],
  currentReviewers: ReviewerRegistry = reviewers
) {
  return {
    observations: [observation],
    diffs: [diff(observation.source.sourceId)],
    ledger,
    reviewers: currentReviewers,
    asOf: "2026-07-29T00:00:00Z"
  };
}

function currentObservation(overrides: Partial<ReviewStateObservation> = {}): ReviewStateObservation {
  const currentEvidence = overrides.evidence === undefined && Object.hasOwn(overrides, "evidence")
    ? undefined
    : (overrides.evidence ?? evidence({ inspectedCommit: "b".repeat(40) }));
  const source: SourceObservation = {
    schemaVersion: 3,
    sourceId: "source-a",
    latestEvidenceId: currentEvidence?.id ?? "legacy-snapshot-a",
    previousEvidenceId: "observation-previous",
    observedAt: currentEvidence?.observedAt ?? "2026-07-29T00:00:00Z",
    inspectedCommit: currentEvidence?.inspectedCommit ?? "b".repeat(40),
    representativePaths: ["skills/example/SKILL.md"],
    provisionalDomainIds: ["software-engineering"],
    fields: currentEvidence?.fields ?? unknownFields()
  };
  return {
    source,
    snapshotId: "snapshot-current",
    snapshotContentSha256: "9".repeat(64),
    evidence: currentEvidence,
    previousEvidence: evidence({ id: "observation-previous", inspectedCommit: "a".repeat(40) }),
    previousSnapshotId: "snapshot-previous",
    previousSnapshotContentSha256: "9".repeat(64),
    ...overrides
  };
}

function event(observation: ReviewStateObservation, overrides: Partial<ReviewLedgerEvent> = {}): ReviewLedgerEvent {
  const evidence = observation.evidence!;
  const target = overrides.target ?? { sourceId: "source-a", skillPath: "skills/example/SKILL.md" };
  const value: ReviewLedgerEvent = {
    sequence: 1,
    id: "decision-a",
    previousEventHash: null,
    target,
    disposition: "approved",
    supersedes: null,
    baseline: {
      snapshotId: observation.previousEvidence === undefined ? observation.snapshotId : "snapshot-previous",
      inspectedCommit: observation.previousEvidence?.inspectedCommit ?? observation.source.inspectedCommit,
      contentSha256: observation.snapshotContentSha256,
      pathBlobSha: target.skillPath === null
        ? null
        : evidence.blobs.find(({ path }) => path === target.skillPath)!.gitBlobSha,
      inheritedEvidenceDigest: inheritedEvidenceDigest(evidence)!
    },
    reasonCode: "review-complete",
    reason: { ko: "검토 완료", en: "Review complete" },
    reviewedSensitiveFields: {
      license: reviewed("MIT"),
      permissions: reviewed(["network:none"]),
      ownership: reviewed("owner"),
      trust: reviewed("community"),
      dependencies: reviewed(["none"]),
      executableSurface: reviewed(["SKILL.md"])
    },
    runtimeEvidence: [{ runtime: "codex", compatibility: "verified", evidenceIds: ["evidence-a"] }],
    reviewerId: "maintainer",
    reviewedAt: "2026-07-28T00:00:00Z",
    expiresAt: "2026-08-29T00:00:00Z",
    eventHash: "",
    ...overrides
  };
  return value;
}

function signed(value: ReviewLedgerEvent): ReviewLedgerEvent {
  return { ...value, eventHash: hashReviewEvent(value) };
}

function diff(sourceId: string): SourceDiff {
  return {
    schemaVersion: 3,
    sourceId,
    currentEvidenceId: "observation-current",
    previousEvidenceId: "observation-previous",
    status: "unchanged",
    skillPaths: "unchanged",
    manifest: "unchanged",
    source: "changed",
    fields: {
      license: "unchanged",
      permissions: "unchanged",
      ownership: "unchanged",
      dependencies: "unchanged",
      executableSurface: "unchanged"
    }
  };
}

function evidence(overrides: Partial<ObservationEvidence> = {}): ObservationEvidence {
  return {
    schemaVersion: 3,
    id: "observation-current",
    sourceId: "source-a",
    observedAt: "2026-07-29T00:00:00Z",
    inspectedCommit: "b".repeat(40),
    blobs: [
      observedBlob("plugin.json", "c".repeat(40), "a".repeat(64)),
      observedBlob("skills/example/SKILL.md", "d".repeat(40), "e".repeat(64))
    ],
    fields: {
      license: observedField("plugin.json", "a".repeat(64)),
      permissions: observedField("plugin.json", "a".repeat(64)),
      ownership: observedField("plugin.json", "a".repeat(64)),
      dependencies: observedField("plugin.json", "a".repeat(64)),
      executableSurface: observedField("plugin.json", "a".repeat(64))
    },
    ...overrides
  };
}

function collectorShapedEvidence(
  target: string,
  changes: Partial<{
    rootLicenseSha: string;
    ancestorDependencySha: string;
    targetMcpSha: string;
    siblingDependencySha: string;
    siblingMcpSha: string;
  }> = {}
): ObservationEvidence {
  const rootManifestSha = "1".repeat(64);
  const rootLicenseSha = changes.rootLicenseSha ?? "2".repeat(64);
  const ancestorDependencySha = changes.ancestorDependencySha ?? "3".repeat(64);
  const targetMcpSha = changes.targetMcpSha ?? "4".repeat(64);
  const siblingDependencySha = changes.siblingDependencySha ?? "5".repeat(64);
  const siblingMcpSha = changes.siblingMcpSha ?? "6".repeat(64);
  const targetDirectory = target.slice(0, target.lastIndexOf("/"));

  return evidence({
    blobs: [
      observedBlob("LICENSE", "a".repeat(40), rootLicenseSha),
      observedBlob("package.json", "b".repeat(40), rootManifestSha),
      observedBlob("plugins/sibling/.mcp.json", "0".repeat(40), siblingMcpSha),
      observedBlob("plugins/sibling/package-lock.json", "f".repeat(40), siblingDependencySha),
      observedBlob("plugins/target/package-lock.json", "c".repeat(40), ancestorDependencySha),
      observedBlob(`${targetDirectory}/.mcp.json`, "d".repeat(40), targetMcpSha),
      observedBlob(target, "e".repeat(40), "7".repeat(64))
    ],
    fields: {
      license: observedField("LICENSE", rootLicenseSha),
      permissions: observedField("package.json", rootManifestSha),
      ownership: observedField("package.json", rootManifestSha),
      dependencies: observedFieldReferences(
        ["plugins/sibling/package-lock.json", siblingDependencySha],
        ["plugins/target/package-lock.json", ancestorDependencySha]
      ),
      executableSurface: observedFieldReferences(
        ["package.json", rootManifestSha],
        ["plugins/sibling/.mcp.json", siblingMcpSha],
        [`${targetDirectory}/.mcp.json`, targetMcpSha]
      )
    }
  });
}

function collectorShapedApproval(baseline: ReviewStateObservation, target: string): ReviewLedgerEvent {
  const evidence = baseline.evidence!;
  return signed(event(baseline, {
    target: { sourceId: "source-a", skillPath: target },
    baseline: {
      snapshotId: baseline.snapshotId,
      inspectedCommit: baseline.source.inspectedCommit,
      contentSha256: baseline.snapshotContentSha256,
      pathBlobSha: evidence.blobs.find(({ path }) => path === target)!.gitBlobSha,
      inheritedEvidenceDigest: inheritedEvidenceDigest(evidence, target)!
    },
    reviewedSensitiveFields: {
      license: reviewedScoped("MIT", evidence.fields.license.evidence, target),
      permissions: reviewedScoped(["network:none"], evidence.fields.permissions.evidence, target),
      ownership: reviewedScoped("owner", evidence.fields.ownership.evidence, target),
      trust: reviewed("community"),
      dependencies: reviewedScoped(["none"], evidence.fields.dependencies.evidence, target),
      executableSurface: reviewedScoped(["SKILL.md"], evidence.fields.executableSurface.evidence, target)
    }
  }));
}

function observedFieldReferences(...evidence: Array<[string, string]>) {
  return {
    status: "observed" as const,
    evidence: evidence.map(([path, contentSha256]) => ({ path, contentSha256 }))
  };
}

function reviewedScoped<T extends string | string[]>(
  value: T,
  directEvidence: readonly { path: string; contentSha256: string }[],
  target: string
) {
  return {
    status: "observed" as const,
    value,
    evidence: directEvidence.filter(({ path }) => collectorEvidenceGovernsTarget(path, target))
  };
}

function collectorEvidenceGovernsTarget(path: string, target: string): boolean {
  const separator = path.lastIndexOf("/");
  const directory = separator === -1 ? "" : path.slice(0, separator);
  return directory === "" || target.startsWith(`${directory}/`);
}

function observedBlob(path: string, gitBlobSha: string, contentSha256: string) {
  return { path, gitBlobSha, byteSize: 1, readStatus: "observed" as const, contentSha256 };
}

function observedField(path: string, contentSha256: string) {
  return { status: "observed" as const, evidence: [{ path, contentSha256 }] };
}

function unknownFields(): ObservationEvidence["fields"] {
  return {
    license: { status: "unknown", evidence: [] },
    permissions: { status: "unknown", evidence: [] },
    ownership: { status: "unknown", evidence: [] },
    dependencies: { status: "unknown", evidence: [] },
    executableSurface: { status: "unknown", evidence: [] }
  };
}

function reviewed<T extends string | string[]>(value: T) {
  return { status: "observed" as const, value, evidence: [{ path: "plugin.json", contentSha256: "a".repeat(64) }] };
}
