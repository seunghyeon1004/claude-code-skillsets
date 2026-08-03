import { SUPPORTED_RUNTIMES, type CapabilityTargetSearch, type Platform, type ProviderSelectionManifest } from "../model/complete-v1.js";
import type { CompleteV1Repository } from "../manifest/complete-v1-repository.js";
import { compareCodePointStrings } from "./snapshot.js";

export const P04_WAVE_COVERAGE = [
  { total: 33, required: 26, recommendedOnly: 7 },
  { total: 38, required: 23, recommendedOnly: 15 },
  { total: 40, required: 32, recommendedOnly: 8 },
  { total: 36, required: 20, recommendedOnly: 16 }
] as const;

export interface P04CapabilityCoverageInput {
  capabilityIds: readonly string[];
  requiredCapabilityIds: readonly string[];
  waves: readonly (readonly string[])[];
  searches: readonly CapabilityTargetSearch[];
  selections: readonly ProviderSelectionManifest[];
  platforms: readonly Platform[];
  actualCapabilityRoles?: readonly P04CapabilityRole[];
  fixtureCapabilityUniverse?: readonly P04CapabilityRole[];
  fixtureWaveCoverage?: readonly P04WaveCoverage[];
}

export interface P04CapabilityRole {
  capabilityId: string;
  requiredByPackIds: string[];
  recommendedByPackIds: string[];
}

export interface P04WaveCoverage {
  waveId: string;
  total: number;
  required: number;
  recommendedOnly: number;
}

export function deriveP04CapabilityRoles(completeV1: CompleteV1Repository): P04CapabilityRole[] {
  return completeV1.capabilityCollections.flatMap(({ capabilities }) => capabilities).map(({ id }) => ({
    capabilityId: id,
    requiredByPackIds: completeV1.packs.filter((pack) => pack.requiredCapabilityIds.includes(id)).map(({ id: packId }) => packId).sort(compareCodePointStrings),
    recommendedByPackIds: completeV1.packs.filter((pack) => pack.recommendedCapabilityIds.includes(id)).map(({ id: packId }) => packId).sort(compareCodePointStrings)
  })).sort((left, right) => compareCodePointStrings(left.capabilityId, right.capabilityId));
}

export function p04WavesFor(roles: readonly P04CapabilityRole[], waveCoverage: readonly Pick<P04WaveCoverage, "required" | "recommendedOnly">[]): string[][] {
  const required = roles.filter(({ requiredByPackIds }) => requiredByPackIds.length > 0).map(({ capabilityId }) => capabilityId);
  const recommendedOnly = roles.filter(({ requiredByPackIds }) => requiredByPackIds.length === 0).map(({ capabilityId }) => capabilityId);
  let requiredCursor = 0;
  let recommendedCursor = 0;
  return waveCoverage.map(({ required: requiredCount, recommendedOnly: recommendedOnlyCount }) => [
    ...required.slice(requiredCursor, requiredCursor += requiredCount),
    ...recommendedOnly.slice(recommendedCursor, recommendedCursor += recommendedOnlyCount)
  ]);
}

/** Validates the immutable P04 census shape without treating unavailable as a gap. */
export function validateP04CapabilityCoverage(input: P04CapabilityCoverageInput): void {
  validateFixtureRoles(input);
  const allCapabilities = [...input.capabilityIds];
  if (allCapabilities.length !== 147 || new Set(allCapabilities).size !== 147) throw new Error("P04 capability coverage requires exactly 147 unique capabilities");
  if (!isSortedUnique(allCapabilities)) throw new Error("P04 capability universe must be code-point sorted and unique");
  const required = new Set(input.requiredCapabilityIds);
  if (required.size !== 101 || required.size !== input.requiredCapabilityIds.length) throw new Error("P04 capability coverage requires exactly 101 required capabilities");
  if (allCapabilities.filter((id) => !required.has(id)).length !== 46) throw new Error("P04 capability coverage requires exactly 46 recommended-only capabilities");
  if (input.waves.length !== P04_WAVE_COVERAGE.length) throw new Error("P04 capability coverage requires four waves");
  const waveIds = input.waves.flat();
  if (waveIds.length !== 147 || new Set(waveIds).size !== 147 || waveIds.some((id) => !allCapabilities.includes(id))) throw new Error("P04 waves must partition the capability universe");
  input.waves.forEach((wave, index) => {
    const expected = P04_WAVE_COVERAGE[index]!;
    const requiredCount = wave.filter((id) => required.has(id)).length;
    if (wave.length !== expected.total || requiredCount !== expected.required || wave.length - requiredCount !== expected.recommendedOnly) {
      throw new Error(`P04 wave ${index + 1} must contain ${expected.total}/${expected.required}/${expected.recommendedOnly} total/required/recommended-only capabilities`);
    }
  });
  if (!isSortedUnique([...input.platforms])) throw new Error("P04 platforms must be code-point sorted and unique");
  const expectedCells = allCapabilities.flatMap((capabilityId) => SUPPORTED_RUNTIMES.flatMap((runtime) => input.platforms.map((platform) => targetKey(capabilityId, runtime, platform))));
  if (!sameStrings(input.searches.map((cell) => targetKey(cell.capabilityId, cell.runtime, cell.platform)), expectedCells)) {
    throw new Error("P04 target search cells must be in frozen code-point target order");
  }
  if (!sameStrings(input.selections.map((cell) => targetKey(cell.capabilityId, cell.runtime, cell.platform)), expectedCells)) {
    throw new Error("P04 provider selection cells must be in frozen code-point target order");
  }
  for (const capabilityId of allCapabilities) for (const runtime of SUPPORTED_RUNTIMES) for (const platform of input.platforms) {
    const searches = input.searches.filter((cell) => cell.capabilityId === capabilityId && cell.runtime === runtime && cell.platform === platform);
    const selections = input.selections.filter((cell) => cell.capabilityId === capabilityId && cell.runtime === runtime && cell.platform === platform);
    if (searches.length !== 1 || selections.length !== 1) throw new Error(`P04 capability ${capabilityId} requires one search and one selection for ${runtime}/${platform}`);
    if (searches[0]!.id !== selections[0]!.searchRecordId) throw new Error(`P04 capability ${capabilityId} selection must bind its exact target search cell`);
  }
}

function validateFixtureRoles(input: P04CapabilityCoverageInput): void {
  if (input.actualCapabilityRoles === undefined && input.fixtureCapabilityUniverse === undefined && input.fixtureWaveCoverage === undefined) return;
  if (input.actualCapabilityRoles === undefined || input.fixtureCapabilityUniverse === undefined || input.fixtureWaveCoverage === undefined) {
    throw new Error("P04 production coverage requires actual capability roles and both immutable fixtures");
  }
  if (input.actualCapabilityRoles.length !== input.fixtureCapabilityUniverse.length || !input.actualCapabilityRoles.every((actual, index) => sameRole(actual, input.fixtureCapabilityUniverse![index]!))) {
    throw new Error("P04 capability universe fixture does not match current complete-v1 pack roles");
  }
  const expectedWaves = P04_WAVE_COVERAGE.map((wave, index) => ({ waveId: `W${index + 1}`, ...wave }));
  if (!sameStrings(input.fixtureWaveCoverage.map(stableWave), expectedWaves.map(stableWave))) {
    throw new Error("P04 wave coverage fixture does not match the immutable four-wave definition");
  }
}

function sameRole(left: P04CapabilityRole, right: P04CapabilityRole): boolean {
  return left.capabilityId === right.capabilityId
    && sameStrings(left.requiredByPackIds, right.requiredByPackIds)
    && sameStrings(left.recommendedByPackIds, right.recommendedByPackIds);
}

function stableWave(wave: P04WaveCoverage): string {
  return `${wave.waveId}\u0000${wave.total}\u0000${wave.required}\u0000${wave.recommendedOnly}`;
}

function targetKey(capabilityId: string, runtime: string, platform: string): string {
  return `${capabilityId}\u0000${runtime}\u0000${platform}`;
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || compareCodePointStrings(values[index - 1]!, value) < 0);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
