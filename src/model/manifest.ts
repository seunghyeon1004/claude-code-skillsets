export interface LocalizedText {
  ko: string;
  en: string;
}

export interface PermissionDeclaration {
  filesystem: string[];
  commands: string[];
  network: string[];
  externalData: string[];
}

export type TrustTier = "verified" | "trusted" | "community" | "blocked";

export type PackTrustRequirement = Exclude<TrustTier, "blocked">;

export type RiskLevel = "standard" | "review-required" | "expert-required";

export type ReleaseStatus = "draft" | "beta" | "stable" | "deprecated" | "blocked";

export interface DomainManifest {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  categories: string[];
  languages: string[];
  regions: string[];
  maintainers: string[];
  version: string;
  status: ReleaseStatus;
}

export interface PackManifest {
  id: string;
  domain: string;
  categories: string[];
  outcome: LocalizedText;
  targetUsers: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  inputs: string[];
  outputs: string[];
  workflow: string[];
  requiredPlugins: string[];
  recommendedPlugins: string[];
  optionalPlugins: string[];
  tools: string[];
  requiredExecutables?: string[];
  optionalExecutables?: string[];
  languages: string[];
  regions: string[];
  riskLevel: RiskLevel;
  trustRequirements: PackTrustRequirement;
  licenses: string[];
  evaluationCases: string[];
  maintainers: string[];
  version: string;
  status: ReleaseStatus;
}

export interface PluginDependency {
  name: string;
  marketplace?: string;
  version?: string;
  reason: LocalizedText;
}

export interface LocalPluginManifest {
  id: string;
  name?: LocalizedText;
  description?: LocalizedText;
  source: string;
  marketplace?: string;
  trustTier?: TrustTier;
  permissions?: PermissionDeclaration;
  version: string;
  status: ReleaseStatus;
  requiredDependencies: PluginDependency[];
  recommendedDependencies: PluginDependency[];
  optionalDependencies: PluginDependency[];
}

export interface ExternalSourceManifest {
  id: string;
  name: LocalizedText;
  homepage: string;
  repository: string;
  license: string;
  trustTier: TrustTier;
  status: ReleaseStatus;
  marketplace: string;
  marketplaceSource: string;
  version: string;
  permissions: PermissionDeclaration;
  requiredDependencies: PluginDependency[];
  updatePolicy: string;
  reviewedAt: string;
}
