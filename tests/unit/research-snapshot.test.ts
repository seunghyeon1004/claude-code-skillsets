import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ResearchSnapshot, ResearchSnapshotEntry } from "../../src/model/complete-v1.js";
import {
  SNAPSHOT_ENTRY_KINDS,
  canonicalizeSnapshotEntries,
  compareCodePointStrings,
  computeSnapshotContentSha256,
  snapshotContentBytes,
  verifyResearchSnapshot
} from "../../src/research/snapshot.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/research/snapshots/2026-07-23-example.json", import.meta.url)
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ResearchSnapshot;

function snapshot(): ResearchSnapshot {
  return structuredClone(fixture);
}

describe("research snapshots", () => {
  it("freezes the supported entry kinds", () => {
    expect(SNAPSHOT_ENTRY_KINDS).toEqual([
      "marketplace-entry",
      "plugin-manifest",
      "repository-record",
      "skill-file"
    ]);
  });

  it("projects literal entry keys and sorts by Unicode code point without mutating callers", () => {
    const entries: ResearchSnapshotEntry[] = [
      { sourceUrl: null, address: "paths/\u{10000}", kind: "skill-file" },
      { sourceUrl: null, address: "paths/\uE000", kind: "skill-file" },
      { sourceUrl: "https://example.com/marketplace", address: "marketplace.json#/plugins/0", kind: "marketplace-entry" }
    ];
    const original = structuredClone(entries);
    const canonical = canonicalizeSnapshotEntries(entries);

    expect(compareCodePointStrings("\u{10000}", "\uE000")).toBeGreaterThan(0);
    expect(canonical.map(({ address }) => address)).toEqual([
      "marketplace.json#/plugins/0",
      "paths/\uE000",
      "paths/\u{10000}"
    ]);
    expect(Object.keys(canonical[0]!)).toEqual(["kind", "address", "sourceUrl"]);
    expect(canonical[0]).not.toBe(entries[2]);
    expect(entries).toEqual(original);
  });

  it("produces one compact LF-terminated digest for every canonical variant", () => {
    const base = snapshot();
    const variants = [
      base.entries,
      [...base.entries].reverse(),
      [...base.entries].reverse().map(({ kind, address, sourceUrl }) => ({ sourceUrl, address, kind }))
    ];
    const expectedBytes = Buffer.from(
      "[{\"kind\":\"marketplace-entry\",\"address\":\".claude-plugin/marketplace.json#/plugins/0\",\"sourceUrl\":\"https://example.com/marketplace\"},{\"kind\":\"plugin-manifest\",\"address\":\"plugins/example/.claude-plugin/plugin.json\",\"sourceUrl\":null},{\"kind\":\"repository-record\",\"address\":\".\",\"sourceUrl\":\"https://example.com/repository\"},{\"kind\":\"skill-file\",\"address\":\"plugins/example/skills/demo/SKILL.md\",\"sourceUrl\":null}]\n",
      "utf8"
    );

    expect(snapshotContentBytes(variants[0]!)).toEqual(expectedBytes);
    expect(expectedBytes.at(-1)).toBe(0x0a);
    expect(new Set(variants.map(computeSnapshotContentSha256))).toEqual(new Set([fixture.contentSha256]));
  });

  it.each([
    ["marketplace path must be repository-relative", "marketplace-entry", "/marketplace.json#/plugins/0"],
    ["marketplace pointer requires a zero-based array index", "marketplace-entry", "marketplace.json#/plugins/00"],
    ["marketplace pointer must be exactly plugins plus an index", "marketplace-entry", "marketplace.json#/plugins/0/extra"],
    ["marketplace pointer rejects malformed RFC 6901 escaping", "marketplace-entry", "marketplace.json#/plugins/0~2"],
    ["file path rejects dot segments", "skill-file", "skills/../demo/SKILL.md"],
    ["file path rejects backslashes", "plugin-manifest", "plugins\\example\\plugin.json"],
    ["repository records use the root address", "repository-record", "repository.json"]
  ] as const)("rejects invalid address: %s", (_case, kind, address) => {
    const value = snapshot();
    value.entries[0] = { kind, address, sourceUrl: null };

    expect(() => verifyResearchSnapshot(value)).toThrow(/address|pointer|path/i);
  });

  it("accepts a root repository record or a canonical Markdown link record", () => {
    const rootRecord = snapshot();
    expect(verifyResearchSnapshot(rootRecord)).toBe(rootRecord);

    const markdownLinkRecord = snapshot();
    const entry = markdownLinkRecord.entries.find(({ kind }) => kind === "repository-record")!;
    entry.address = "docs/README.markdown#link/12";
    markdownLinkRecord.contentSha256 = computeSnapshotContentSha256(markdownLinkRecord.entries);

    expect(verifyResearchSnapshot(markdownLinkRecord)).toBe(markdownLinkRecord);
  });

  it.each([
    "README.md#link/00",
    "README.md#link/-1",
    "README.md#link/0/extra",
    "README.txt#link/0",
    "docs/../README.md#link/0",
    "docs\\README.md#link/0",
    "README.md#links/0"
  ])("rejects a malformed Markdown repository record address: %s", (address) => {
    const value = snapshot();
    const entry = value.entries.find(({ kind }) => kind === "repository-record")!;
    entry.address = address;

    expect(() => verifyResearchSnapshot(value)).toThrow(/repository-record.*address|Markdown/i);
  });

  it("rejects duplicate kind-address identities even when the source changes", () => {
    const value = snapshot();
    value.entries.push({
      ...value.entries[0]!,
      sourceUrl: "https://example.com/another-source"
    });

    expect(() => verifyResearchSnapshot(value)).toThrow(/duplicate.*kind.*address/i);
  });

  it("requires exactly one count metric for each and only each represented kind", () => {
    const missingMetric = snapshot();
    missingMetric.countMetrics = missingMetric.countMetrics.filter(({ kind }) => kind !== "skill-file");

    const unrepresentedMetric = snapshot();
    unrepresentedMetric.entries = unrepresentedMetric.entries.filter(({ kind }) => kind !== "repository-record");

    const duplicateMetric = snapshot();
    duplicateMetric.countMetrics.push({ ...duplicateMetric.countMetrics[0]! });

    expect(() => verifyResearchSnapshot(missingMetric)).toThrow(/missing.*count metric.*skill-file/i);
    expect(() => verifyResearchSnapshot(unrepresentedMetric)).toThrow(/unrepresented.*count metric.*repository-record/i);
    expect(() => verifyResearchSnapshot(duplicateMetric)).toThrow(/duplicate.*count metric.*repository-record/i);
  });

  it("requires a matching independently counted total for every represented kind", () => {
    const value = snapshot();
    value.countMetrics.find(({ kind }) => kind === "skill-file")!.independentlyCountedTotal = 2;

    expect(() => verifyResearchSnapshot(value)).toThrow(/independentlyCountedTotal.*skill-file.*2.*1/i);
  });

  it.each([
    [null, "https://example.com/marketplace"],
    [1, null]
  ] as const)("requires reported count and source URL to be null together", (reportedCount, reportedCountSourceUrl) => {
    const value = snapshot();
    const metric = value.countMetrics.find(({ kind }) => kind === "marketplace-entry")!;
    metric.reportedCount = reportedCount;
    metric.reportedCountSourceUrl = reportedCountSourceUrl;

    expect(() => verifyResearchSnapshot(value)).toThrow(/reportedCount.*reportedCountSourceUrl.*both be null/i);
  });

  it.each([-1, 1.5, Number.NaN])(
    "rejects an invalid non-null reported count: %s",
    (reportedCount) => {
      const value = snapshot();
      const metric = value.countMetrics.find(({ kind }) => kind === "marketplace-entry")!;
      metric.reportedCount = reportedCount;

      expect(metric.reportedCountSourceUrl).toBe("https://example.com/marketplace");
      expect(() => verifyResearchSnapshot(value)).toThrow(/reportedCount.*non-negative integer/i);
    }
  );

  it("rejects a snapshot whose declared content hash does not match its canonical entries", () => {
    const value = snapshot();
    value.contentSha256 = "0".repeat(64);

    expect(() => verifyResearchSnapshot(value)).toThrow(/content SHA-256/i);
  });

  it("returns a valid snapshot without mutating its arrays or entry objects", () => {
    const value = snapshot();
    const before = structuredClone(value);

    expect(verifyResearchSnapshot(value)).toBe(value);
    expect(value).toEqual(before);
  });
});
