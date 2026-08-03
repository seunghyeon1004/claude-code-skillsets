import type {
  LocalizedText,
  PermissionDeclaration,
  TrustTier
} from "./manifest.js";
import type { PackAvailabilityResult } from "./complete-v1.js";

export type PublishedStatus = "beta" | "stable";

export interface RuntimeDomain {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  purposeIds: string[];
  profileIds: string[];
}

export interface RuntimeExecutable {
  name: string;
  impact: "required" | "optional";
}

export interface InstallProfile {
  id: string;
  labels: LocalizedText;
  domainIds: string[];
  purposeIds: string[];
  toolIds: string[];
  requiredPlugins: string[];
  recommendedPlugins: string[];
  optionalPlugins: string[];
  executables: RuntimeExecutable[];
  version: string;
  status: PublishedStatus;
}

export interface ResearchPendingPack {
  id: string;
  domainId: string;
  labels: LocalizedText;
  state: "research-pending";
}

export interface RuntimeDependency {
  id: string;
  marketplace: string;
  version?: string;
}

export interface InstallPlugin {
  id: string;
  name: LocalizedText;
  version: string;
  source: string;
  marketplace: string;
  trustTier: TrustTier;
  permissions: PermissionDeclaration;
  requiredDependencies: RuntimeDependency[];
  installCommand: string;
  kind?: "local" | "external";
  license?: string;
  marketplaceSource?: string;
  marketplaceAddCommand?: string;
  reviewedVersion?: string;
  versionPinSupported?: false;
  verificationCommand?: "claude plugin list --json";
}

export interface InstallIndex {
  schemaVersion: 1;
  indexFingerprint: string;
  marketplace: {
    id: string;
    source: string;
  };
  domains: RuntimeDomain[];
  profiles: InstallProfile[];
  availability: PackAvailabilityResult[];
  researchPendingPacks: ResearchPendingPack[];
  executables: string[];
  plugins: InstallPlugin[];
}
