import { describe, expect, it } from "vitest";
import { materializeSourceDiff } from "../../src/research/source-diff.js";
import type { ObservationEvidence } from "../../src/model/observation.js";

const commit = "a".repeat(40);
const blob = "b".repeat(40);
const content = "c".repeat(64);

describe("source diff materialization", () => {
  it("marks the first observation as a baseline", () => {
    expect(materializeSourceDiff({ current: evidence() })).toEqual({
      schemaVersion: 3,
      sourceId: "source-a",
      currentEvidenceId: "observation-a",
      previousEvidenceId: null,
      status: "baseline",
      skillPaths: "baseline",
      manifest: "baseline",
      source: "baseline",
      fields: {
        license: "baseline",
        permissions: "baseline",
        ownership: "baseline",
        dependencies: "baseline",
        executableSurface: "baseline"
      }
    });
  });

  it("marks directly observed equal evidence unchanged", () => {
    const previous = evidence({ id: "observation-previous" });
    const current = evidence({ id: "observation-current" });

    expect(materializeSourceDiff({ current, previous })).toMatchObject({
      status: "unchanged",
      skillPaths: "unchanged",
      manifest: "unchanged",
      source: "unchanged",
      fields: {
        license: "unchanged",
        permissions: "unchanged",
        ownership: "unchanged",
        dependencies: "unchanged",
        executableSurface: "unchanged"
      }
    });
  });

  it("marks directly observed changes changed and unknown evidence unknown", () => {
    const previous = evidence({ id: "observation-previous" });
    const current = evidence({
      id: "observation-current",
      blobs: [
        observedBlob("plugin.json", "d".repeat(40), "e".repeat(64)),
        observedBlob("skills/example/SKILL.md", "f".repeat(40), "0".repeat(64))
      ],
      fields: {
        ...evidence().fields,
        license: observedField("plugin.json", "e".repeat(64)),
        permissions: { status: "unknown", evidence: [] }
      }
    });

    expect(materializeSourceDiff({ current, previous })).toMatchObject({
      status: "changed",
      skillPaths: "changed",
      manifest: "changed",
      fields: {
        license: "changed",
        permissions: "unknown",
        ownership: "unchanged"
      }
    });
  });
});

function evidence(overrides: Partial<ObservationEvidence> = {}): ObservationEvidence {
  return {
    schemaVersion: 3,
    id: "observation-a",
    sourceId: "source-a",
    observedAt: "2026-07-29T00:00:00Z",
    inspectedCommit: commit,
    blobs: [
      observedBlob("plugin.json", blob, content),
      observedBlob("skills/example/SKILL.md", "d".repeat(40), "e".repeat(64))
    ],
    fields: {
      license: observedField("plugin.json", content),
      permissions: observedField("plugin.json", content),
      ownership: observedField("plugin.json", content),
      dependencies: observedField("plugin.json", content),
      executableSurface: observedField("plugin.json", content)
    },
    ...overrides
  };
}

function observedBlob(path: string, gitBlobSha: string, contentSha256: string) {
  return { path, gitBlobSha, byteSize: 1, readStatus: "observed" as const, contentSha256 };
}

function observedField(path: string, contentSha256: string) {
  return { status: "observed" as const, evidence: [{ path, contentSha256 }] };
}
