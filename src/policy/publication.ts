import type { BrokerManifestRepository } from "../manifest/repository.js";
import type { ReleaseStatus } from "../model/manifest.js";

export interface PublicationSelection {
  plugins: BrokerManifestRepository["plugins"];
}

export function selectPublication(repository: BrokerManifestRepository): PublicationSelection {
  const plugins = repository.plugins
    .filter(({ status }) => isPublishable(status))
    .sort((left, right) => compareStrings(left.id, right.id));
  if (plugins.length !== 2 || plugins[0]?.id !== "shared-core" || plugins[1]?.id !== "skillset-manager") {
    throw new Error("Broker publication must contain exactly shared-core and skillset-manager");
  }
  return { plugins };
}

export function isPublishable(status: ReleaseStatus): status is "beta" | "stable" {
  return status === "beta" || status === "stable";
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
