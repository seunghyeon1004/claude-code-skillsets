import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";

const fixtureRoot = resolve("tests/fixtures/complete-v1-repository/valid");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("loadCompleteV1Repository", () => {
  it("loads each manifest collection in deterministic identifier order", async () => {
    const root = await copyFixture();
    const domainsDirectory = join(root, "manifests", "complete-v1-domains");
    const original = await readFile(join(domainsDirectory, "software-engineering.yaml"), "utf8");

    await writeFile(join(domainsDirectory, "z-domain.yaml"), original.replace("id: software-engineering", "id: z-domain"));
    await writeFile(join(domainsDirectory, "a-domain.yaml"), original.replace("id: software-engineering", "id: a-domain"));

    const repository = await loadCompleteV1Repository(root);

    expect(repository.domains.map(({ id }) => id)).toEqual([
      "a-domain",
      "software-engineering",
      "z-domain"
    ]);
  });

  it("reports YAML parse failures with a repository-relative path", async () => {
    const root = await copyFixture();
    await writeFile(join(root, "manifests", "catalog.yaml"), "schemaVersion: [\n");

    await expect(loadCompleteV1Repository(root)).rejects.toThrow(/manifests\/catalog\.yaml:/);
  });

  it("reports schema failures with a repository-relative path", async () => {
    const root = await copyFixture();
    await replaceFile(root, "manifests/catalog.yaml", "schemaVersion: 2", "schemaVersion: 1");

    await expect(loadCompleteV1Repository(root)).rejects.toThrow(
      /manifests\/catalog\.yaml: Invalid complete-v1 catalog:/
    );
  });

  it("rejects a missing complete-v1 collection directory", async () => {
    const root = await copyFixture();
    await rm(join(root, "manifests", "categories"), { force: true, recursive: true });

    await expect(loadCompleteV1Repository(root)).rejects.toThrow(
      "manifests/categories: Missing manifest directory"
    );
  });

  it("rejects duplicate category collection domain IDs", async () => {
    const root = await copyFixture();
    const categoriesDirectory = join(root, "manifests", "categories");
    await cp(
      join(categoriesDirectory, "software-engineering.yaml"),
      join(categoriesDirectory, "duplicate.yaml")
    );

    await expect(loadCompleteV1Repository(root)).rejects.toThrow(
      "Duplicate category collection domain ID: software-engineering"
    );
  });

  it("rejects duplicate v2 manifest IDs", async () => {
    const root = await copyFixture();
    const packsDirectory = join(root, "manifests", "complete-v1-packs");
    await cp(
      join(packsDirectory, "repository-to-implementation-plan.yaml"),
      join(packsDirectory, "duplicate.yaml")
    );

    await expect(loadCompleteV1Repository(root)).rejects.toThrow(
      "Duplicate pack manifest ID: repository-to-implementation-plan"
    );
  });

  it("does not read providers, reviews, conflicts, runtime state, or generated output", async () => {
    const root = await copyFixture();
    const ignoredPaths = [
      "manifests/providers/provider.yaml",
      "manifests/source-reviews/review.yaml",
      "manifests/conflicts/conflict.yaml",
      "state/install.json",
      "generated/install-index.json"
    ];
    for (const relativePath of ignoredPaths) {
      const path = join(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "this: is: invalid\n");
    }

    await expect(loadCompleteV1Repository(root)).resolves.toMatchObject({
      catalog: { releaseTarget: "complete-private-v1" },
      domains: [{ id: "software-engineering" }],
      categoryCollections: [{ domainId: "software-engineering" }],
      capabilityCollections: [{ domainId: "software-engineering" }],
      packs: [{
        id: "repository-to-implementation-plan",
        routingProfileId: "software-engineering",
        minimumProviderTrust: "trusted",
        assuranceProfile: "high-impact"
      }]
    });
  });
});

async function copyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "complete-v1-repository-"));
  temporaryRoots.push(root);
  await cp(fixtureRoot, root, { recursive: true });
  return root;
}

async function replaceFile(root: string, relativePath: string, search: string, replacement: string): Promise<void> {
  const path = join(root, relativePath);
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace(search, replacement));
}
