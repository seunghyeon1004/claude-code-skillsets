import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  validateCapabilityCollection,
  validateCatalogContract,
  validateCategoryCollection,
  validateCompletePack
} from "../contracts/complete-v1.js";
import type {
  CapabilityCollectionManifest,
  CatalogContract,
  CategoryCollectionManifest,
  CompletePackManifest
} from "../model/complete-v1.js";
import type { DomainManifest } from "../model/manifest.js";
import { loadYaml, validateDomain } from "./load.js";

export interface CompleteV1Repository {
  catalog: CatalogContract;
  domains: DomainManifest[];
  categoryCollections: CategoryCollectionManifest[];
  capabilityCollections: CapabilityCollectionManifest[];
  packs: CompletePackManifest[];
}

export async function loadCompleteV1Repository(root: string): Promise<CompleteV1Repository> {
  const manifestsRoot = join(root, "manifests");
  const catalog = await loadDocument(root, join(manifestsRoot, "catalog.yaml"), validateCatalogContract);
  const domains = await loadManifestDirectory(
    root,
    join(manifestsRoot, "complete-v1-domains"),
    "domain",
    validateDomain,
    ({ id }) => id
  );
  const categoryCollections = await loadManifestDirectory(
    root,
    join(manifestsRoot, "categories"),
    "category collection",
    validateCategoryCollection,
    ({ domainId }) => domainId
  );
  const capabilityCollections = await loadManifestDirectory(
    root,
    join(manifestsRoot, "capabilities"),
    "capability collection",
    validateCapabilityCollection,
    ({ domainId }) => domainId
  );
  const packs = await loadManifestDirectory(
    root,
    join(manifestsRoot, "complete-v1-packs"),
    "pack",
    validateCompletePack,
    ({ id }) => id
  );

  return { catalog, domains, categoryCollections, capabilityCollections, packs };
}

async function loadManifestDirectory<T>(
  root: string,
  directory: string,
  kind: string,
  validate: (value: unknown) => T,
  identity: (value: T) => string
): Promise<T[]> {
  const paths = await yamlPaths(root, directory);
  const manifests: T[] = [];
  for (const path of paths) {
    manifests.push(await loadDocument(root, path, validate));
  }

  rejectDuplicateIdentities(kind, manifests, identity);
  return manifests.sort((left, right) => compareCodePointStrings(identity(left), identity(right)));
}

async function yamlPaths(root: string, directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => join(directory, entry.name))
      .sort(compareCodePointStrings);
  } catch (error) {
    if (isMissingDirectory(error)) {
      throw new Error(`${repositoryRelativePath(root, directory)}: Missing manifest directory`, { cause: error });
    }
    throw new Error(`${repositoryRelativePath(root, directory)}: Unable to read manifest directory: ${errorMessage(error)}`, {
      cause: error
    });
  }
}

async function loadDocument<T>(
  root: string,
  path: string,
  validate: (value: unknown) => T
): Promise<T> {
  try {
    return validate(await loadYaml(path));
  } catch (error) {
    throw new Error(`${repositoryRelativePath(root, path)}: ${errorMessage(error)}`, { cause: error });
  }
}

function rejectDuplicateIdentities<T>(
  kind: string,
  manifests: T[],
  identity: (value: T) => string
): void {
  const identities = new Set<string>();
  for (const manifest of manifests) {
    const id = identity(manifest);
    if (identities.has(id)) {
      throw new Error(`Duplicate ${kind} ${kind.includes("collection") ? "domain " : "manifest "}ID: ${id}`);
    }
    identities.add(id);
  }
}

function isMissingDirectory(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function repositoryRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareCodePointStrings(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftCharacters[index]!.codePointAt(0)!;
    const rightPoint = rightCharacters[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) {
      return leftPoint < rightPoint ? -1 : 1;
    }
  }
  return leftCharacters.length === rightCharacters.length
    ? 0
    : (leftCharacters.length < rightCharacters.length ? -1 : 1);
}
