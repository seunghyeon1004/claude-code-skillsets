import type { BrokerManifestRepository } from "../manifest/repository.js";

export const SAFE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SAFE_MARKETPLACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SAFE_EXECUTABLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
export const SAFE_MARKETPLACE_SOURCE_PATTERN = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*|https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~%/-]+)*)$/;

export function assertSafeId(value: string, field: string): void {
  assertMatches(value, SAFE_ID_PATTERN, field);
}

export function assertSafeMarketplace(value: string, field: string): void {
  assertMatches(value, SAFE_MARKETPLACE_PATTERN, field);
}

export function assertSafeExecutable(value: string, field: string): void {
  assertMatches(value, SAFE_EXECUTABLE_PATTERN, field);
}

export function assertSafeMarketplaceSource(value: string, field: string): void {
  assertMatches(value, SAFE_MARKETPLACE_SOURCE_PATTERN, field);
}

export function assertBrokerCommandFields(repository: BrokerManifestRepository): void {
  for (const plugin of repository.plugins) {
    assertSafeId(plugin.id, `plugin ${plugin.id}.id`);
    if (plugin.marketplace !== undefined) assertSafeMarketplace(plugin.marketplace, `plugin ${plugin.id}.marketplace`);
    for (const dependency of [
      ...plugin.requiredDependencies,
      ...plugin.recommendedDependencies,
      ...plugin.optionalDependencies
    ]) {
      assertSafeId(dependency.name, `plugin ${plugin.id} dependency ID`);
      if (dependency.marketplace !== undefined) {
        assertSafeMarketplace(dependency.marketplace, `plugin ${plugin.id} dependency marketplace`);
      }
    }
  }
}

function assertMatches(value: string, pattern: RegExp, field: string): void {
  if (!pattern.test(value)) throw new Error(`Unsafe ${field}: ${JSON.stringify(value)}`);
}
