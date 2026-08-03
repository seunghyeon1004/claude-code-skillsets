import { readFileSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const SHOPIFY_TEST_SOURCE_ID = "shopify-ai-toolkit-test-fixture";
export const SHOPIFY_TEST_SNAPSHOT_ID = "2026-07-28-shopify-ai-toolkit-test-fixture";
export const SHOPIFY_TEST_REVIEW_ID = "shopify-ai-toolkit-test-approved";
export const SHOPIFY_REPOSITORY = "https://github.com/Shopify/Shopify-AI-Toolkit.git";
export const SHOPIFY_COMMIT = "556811e94dd45c795abe5c0b1bf6b5a4b098149d";
export const SHOPIFY_SKILL_PATH = "skills/shopify-use-shopify-cli/SKILL.md";
export const SHOPIFY_SNAPSHOT_SHA256 = "0fb50757d47ecf1a1e4175ae3c04f4f3b60d3a79bf1fdc457600c885b3c93cf0";

const rawRoot = `https://raw.githubusercontent.com/Shopify/Shopify-AI-Toolkit/${SHOPIFY_COMMIT}`;
const observationReference = `research/snapshots/${SHOPIFY_TEST_SNAPSHOT_ID}.json#/entries/22`;

export const SHOPIFY_SOURCE_BLOBS = {
  readme: {
    path: "README.md",
    immutableRawUrl: `${rawRoot}/README.md`,
    contentSha256: "af1b941c36d5c18a0a2d72046776c177d6c7694c7fc28ef1d1c224532ebac8f9"
  },
  adminSkill: {
    path: "skills/shopify-admin/SKILL.md",
    immutableRawUrl: `${rawRoot}/skills/shopify-admin/SKILL.md`,
    contentSha256: "552ee5fc54aa76ffe1c074b545276ecef7fc38a10f602fc8ed9eba39dd50c532"
  },
  cliSkill: {
    path: SHOPIFY_SKILL_PATH,
    immutableRawUrl: `${rawRoot}/${SHOPIFY_SKILL_PATH}`,
    contentSha256: "919d2cd97d2f85015f95a9054647dd59b4ab094c8eea6ae8b52db429406c0abf"
  },
  license: {
    path: "LICENSE",
    immutableRawUrl: `${rawRoot}/LICENSE`,
    contentSha256: "75c4e0e960d7639e5974c0b10a420f738b8011ac08742d3bbb13cca849fda9f4"
  }
} as const;

export const SHOPIFY_CAPABILITY_EVIDENCE = [
  {
    capabilityId: "operate-stores-and-marketplaces",
    support: "direct",
    reference: observationReference,
    contentSha256: SHOPIFY_SNAPSHOT_SHA256,
    sourceBlobs: [SHOPIFY_SOURCE_BLOBS.readme, SHOPIFY_SOURCE_BLOBS.cliSkill]
  },
  {
    capabilityId: "manage-product-catalogs-and-listings",
    support: "direct",
    reference: observationReference,
    contentSha256: SHOPIFY_SNAPSHOT_SHA256,
    sourceBlobs: [SHOPIFY_SOURCE_BLOBS.cliSkill]
  },
  {
    capabilityId: "run-promotions-and-analyze-revenue",
    support: "inferred",
    reference: observationReference,
    contentSha256: SHOPIFY_SNAPSHOT_SHA256,
    sourceBlobs: [SHOPIFY_SOURCE_BLOBS.adminSkill, SHOPIFY_SOURCE_BLOBS.cliSkill]
  }
] as const;

const fixtureRoot = fileURLToPath(new URL("../fixtures/decision-codex-evidence", import.meta.url));
const productionManifestPath = fileURLToPath(new URL("../../manifests/decision-candidate-evidence.yaml", import.meta.url));
const productionManifest = parse(readFileSync(productionManifestPath, "utf8")) as {
  candidates: Array<{
    id: string;
    officialBaseline?: { sourceCommit?: string };
    permissions?: { status?: string; value?: unknown };
  }>;
};
const productionShopifyCandidate = productionManifest.candidates.find(({ id }) => id === "shopify-ai-toolkit");
if (productionShopifyCandidate?.officialBaseline?.sourceCommit !== SHOPIFY_COMMIT
  || productionShopifyCandidate.permissions?.status !== "observed"
  || !Array.isArray(productionShopifyCandidate.permissions.value)
  || !productionShopifyCandidate.permissions.value.every((value) => typeof value === "string")) {
  throw new Error("production Shopify permissions must match the pinned test source");
}
const productionShopifyPermissions = productionShopifyCandidate.permissions.value as string[];

export async function installShopifyResearchSource(root: string): Promise<void> {
  await Promise.all([
    cp(join(fixtureRoot, "shopify-source.json"), join(root, "research", "sources", `${SHOPIFY_TEST_SOURCE_ID}.json`)),
    cp(join(fixtureRoot, "shopify-receipt.json"), join(root, "research", "receipts", `${SHOPIFY_TEST_SNAPSHOT_ID}.json`)),
    cp(join(fixtureRoot, "shopify-snapshot.json"), join(root, "research", "snapshots", `${SHOPIFY_TEST_SNAPSHOT_ID}.json`)),
    cp(
      join(fixtureRoot, "shopify-observation-evidence.json"),
      join(root, "research", "observation-evidence", "shopify-ai-toolkit-test-observation.json")
    )
  ]);

  const extensionPath = join(root, "research", "review-source-extensions.json");
  const extensions = JSON.parse(await readFile(extensionPath, "utf8")) as {
    schemaVersion: 2;
    triads: Array<{ sourceId: string; receiptId: string; snapshotId: string }>;
  };
  extensions.triads.push({
    sourceId: SHOPIFY_TEST_SOURCE_ID,
    receiptId: SHOPIFY_TEST_SNAPSHOT_ID,
    snapshotId: SHOPIFY_TEST_SNAPSHOT_ID
  });
  extensions.triads.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const backlogPath = join(root, "research", "source-review-backlog.json");
  const backlog = JSON.parse(await readFile(backlogPath, "utf8")) as {
    schemaVersion: 2;
    candidates: Array<Record<string, unknown> & { id: string }>;
  };
  backlog.candidates.push({
    id: `source-review-${SHOPIFY_TEST_SOURCE_ID}`,
    sourceId: SHOPIFY_TEST_SOURCE_ID,
    sourceRepository: SHOPIFY_REPOSITORY,
    status: "review-required",
    snapshotId: SHOPIFY_TEST_SNAPSHOT_ID,
    observedAt: "2026-07-28T00:00:00Z",
    inspectedCommit: SHOPIFY_COMMIT,
    snapshotContentSha256: SHOPIFY_SNAPSHOT_SHA256,
    representativeSkillPaths: ["skills/shopify-admin/SKILL.md", SHOPIFY_SKILL_PATH],
    domainClassifications: [{
      domainId: "commerce",
      representativeSkillPath: SHOPIFY_SKILL_PATH
    }],
    reclassification: "next-research-observation"
  });
  backlog.candidates.sort((left, right) => left.id.localeCompare(right.id));

  await Promise.all([
    writeFile(extensionPath, `${JSON.stringify(extensions)}\n`),
    writeFile(backlogPath, `${JSON.stringify(backlog)}\n`)
  ]);
}

export function shopifySkillFieldEvidence() {
  return {
    path: SHOPIFY_SKILL_PATH,
    contentSha256: SHOPIFY_SOURCE_BLOBS.cliSkill.contentSha256
  };
}

export function shopifyLicenseFieldEvidence() {
  return {
    path: SHOPIFY_SOURCE_BLOBS.license.path,
    contentSha256: SHOPIFY_SOURCE_BLOBS.license.contentSha256
  };
}

export function shopifyPermissionsField() {
  return {
    status: "observed" as const,
    value: [...productionShopifyPermissions],
    evidence: [shopifySkillFieldEvidence()]
  };
}

export function shopifyDependenciesField() {
  return {
    status: "observed" as const,
    value: ["Node.js", "Shopify CLI", "bash"],
    evidence: [shopifySkillFieldEvidence()]
  };
}

export function shopifyTrustField() {
  return {
    status: "observed" as const,
    value: "Shopify-authored pinned source",
    evidence: [shopifySkillFieldEvidence()]
  };
}

export function shopifyOwnershipField() {
  return {
    status: "observed" as const,
    value: "Shopify",
    evidence: [shopifySkillFieldEvidence()]
  };
}

export function shopifyExecutableSurfaceField() {
  return {
    status: "observed" as const,
    value: ["bash", "shopify store auth", "shopify store execute"],
    evidence: [shopifySkillFieldEvidence()]
  };
}
