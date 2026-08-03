import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import { deriveP04CapabilityRoles, p04WavesFor, validateP04CapabilityCoverage } from "../../src/research/coverage.js";

const universePath = resolve("tests/fixtures/research/p04-capability-universe.json");
const wavePath = resolve("tests/fixtures/research/p04-wave-coverage.json");
const universe = JSON.parse(readFileSync(universePath, "utf8")) as Array<{
  capabilityId: string;
  requiredByPackIds: string[];
  recommendedByPackIds: string[];
}>;
const waveCoverage = JSON.parse(readFileSync(wavePath, "utf8")) as Array<{
  waveId: string;
  total: number;
  required: number;
  recommendedOnly: number;
}>;

function fixture() {
  const capabilityIds = universe.map(({ capabilityId }) => capabilityId);
  const requiredCapabilityIds = universe.filter(({ requiredByPackIds }) => requiredByPackIds.length > 0).map(({ capabilityId }) => capabilityId);
  const recommendedOnlyIds = universe.filter(({ requiredByPackIds }) => requiredByPackIds.length === 0).map(({ capabilityId }) => capabilityId);
  let requiredCursor = 0;
  let recommendedCursor = 0;
  const waves = waveCoverage.map(({ required, recommendedOnly }) => [
    ...requiredCapabilityIds.slice(requiredCursor, requiredCursor += required),
    ...recommendedOnlyIds.slice(recommendedCursor, recommendedCursor += recommendedOnly)
  ]);
  const platforms = ["darwin", "linux", "win32"] as const;
  const searches = capabilityIds.flatMap((capabilityId) => ["claude-code", "codex"].flatMap((runtime) => platforms.map((platform) => ({
    id: `search-${capabilityId}-${runtime}-${platform}`,
    capabilityId,
    runtime: runtime as "claude-code" | "codex",
    platform,
    candidateIds: [],
    searchEvidenceIds: ["no-candidate"]
  }))));
  const selections = searches.map((search) => ({
    schemaVersion: 2 as const,
    id: `selection-${search.id}`,
    capabilityId: search.capabilityId,
    runtime: search.runtime,
    platform: search.platform,
    searchRecordId: search.id,
    disposition: "unavailable" as const,
    alternateProviderIds: [],
    terminalReviewIds: [],
    decisionReasons: ["no candidate"],
    releaseEvidence: "not-applicable" as const
  }));
  return { capabilityIds, requiredCapabilityIds, waves, searches, selections, platforms: [...platforms] };
}

describe("P04 target coverage", () => {
  it("uses both protected P04 fixtures and the frozen six-cell order", () => {
    expect(createHash("sha256").update(readFileSync(universePath)).digest("hex")).toBe("d659a3c00e54a06ff051f91c1c555faad3017af398a71f651c4a8b5676923561");
    expect(createHash("sha256").update(readFileSync(wavePath)).digest("hex")).toBe("d232efceed1f6146c2a768fe3c8670249628721a9574306098c0cc241deb7241");
    expect(waveCoverage).toEqual([
      { waveId: "W1", total: 33, required: 26, recommendedOnly: 7 },
      { waveId: "W2", total: 38, required: 23, recommendedOnly: 15 },
      { waveId: "W3", total: 40, required: 32, recommendedOnly: 8 },
      { waveId: "W4", total: 36, required: 20, recommendedOnly: 16 }
    ]);
    expect(() => validateP04CapabilityCoverage(fixture())).not.toThrow();
  });

  it("rejects an omitted Codex selection cell", () => {
    const input = fixture();
    input.selections.pop();
    expect(() => validateP04CapabilityCoverage(input)).toThrow("frozen code-point target order");
  });

  it("derives current capability roles from complete-v1 packs before comparing both fixtures", async () => {
    const completeV1 = await loadCompleteV1Repository(resolve("."));
    const actualCapabilityRoles = deriveP04CapabilityRoles(completeV1);
    const input = fixture();
    input.waves = p04WavesFor(actualCapabilityRoles, waveCoverage);
    input.capabilityIds = actualCapabilityRoles.map(({ capabilityId }) => capabilityId);
    input.requiredCapabilityIds = actualCapabilityRoles.filter(({ requiredByPackIds }) => requiredByPackIds.length > 0).map(({ capabilityId }) => capabilityId);
    expect(() => validateP04CapabilityCoverage({
      ...input,
      actualCapabilityRoles,
      fixtureCapabilityUniverse: universe,
      fixtureWaveCoverage: waveCoverage
    })).not.toThrow();
  });
});
