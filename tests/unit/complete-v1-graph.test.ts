import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CompleteV1GraphError,
  buildBundleIndexes,
  planBundleActivation,
  planBundleRemoval,
  validateCompleteV1Graph
} from "../../src/catalog/validate-graph.js";
import { loadCompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import type { CompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";

const fixtureRoot = resolve("tests/fixtures/complete-v1-repository/valid");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("validateCompleteV1Graph", () => {
  it("accepts a complete repository and returns deterministic bundle indexes", async () => {
    const repository = await loadFixture();
    const result = validateCompleteV1Graph(repository, graphOptions(repository));

    expect([...result.packToBundle]).toEqual([
      ["repository-to-implementation-plan", "software-engineering"]
    ]);
    expect([...result.bundleToActivePackIds]).toEqual([
      ["software-engineering", ["repository-to-implementation-plan"]]
    ]);
  });

  it.each([undefined, null, true, 1, "options", {}])("fails closed for invalid graph options at runtime: %j", async (invalidOptions) => {
    const repository = await loadFixture();
    const invokeWithRuntimeOptions = validateCompleteV1Graph as unknown as (
      repository: CompleteV1Repository,
      options?: unknown
    ) => unknown;

    expect(() => invokeWithRuntimeOptions(repository, invalidOptions)).toThrow(
      "Complete v1 graph options must explicitly provide scenarioPaths, waves, expectedWaveCounts, and activePackIds"
    );
  });

  it.each(["scenarioPaths", "waves", "expectedWaveCounts", "activePackIds"] as const)(
    "fails closed when the %s option is omitted at runtime",
    async (missingField) => {
      const repository = await loadFixture();
      const options = graphOptions(repository) as unknown as Record<string, unknown>;
      delete options[missingField];

      expect(() => validateCompleteV1Graph(repository, options as unknown as ReturnType<typeof graphOptions>)).toThrow(
        "Complete v1 graph options must explicitly provide scenarioPaths, waves, expectedWaveCounts, and activePackIds"
      );
    }
  );

  it.each([
    ["unknown pack category", (repository: CompleteV1Repository) => {
      repository.packs[0]!.categoryIds = ["unknown-category"];
    }, "references unknown category ID: unknown-category"],
    ["unknown required capability", (repository: CompleteV1Repository) => {
      repository.packs[0]!.requiredCapabilityIds = ["unknown-capability"];
    }, "references unknown required capability ID: unknown-capability"],
    ["capability wrong owner", (repository: CompleteV1Repository) => {
      repository.capabilityCollections[0]!.capabilities[0]!.ownerDomainId = "research-and-intelligence";
    }, "does not match collection domain software-engineering"],
    ["pack capability wrong owner", (repository: CompleteV1Repository) => {
      repository.capabilityCollections[0]!.capabilities[0]!.ownerDomainId = "research-and-intelligence";
    }, "references capability outside owner domain"],
    ["orphan capability", (repository: CompleteV1Repository) => {
      repository.capabilityCollections[0]!.capabilities.push({
        ...structuredClone(repository.capabilityCollections[0]!.capabilities[0]!),
        id: "orphan-capability"
      });
      repository.catalog.capabilityIds.push("orphan-capability");
    }, "Capability orphan-capability is not reachable from any pack"],
    ["optional-only reachability", (repository: CompleteV1Repository) => {
      const pack = repository.packs[0]!;
      pack.optionalCapabilityIds = [...pack.requiredCapabilityIds];
      pack.requiredCapabilityIds = [];
    }, "Capability repository-context-analysis is reachable only through optional edges"],
    ["duplicate capability edge", (repository: CompleteV1Repository) => {
      repository.packs[0]!.requiredCapabilityIds.push("repository-context-analysis");
    }, "Duplicate pack capability edge"],
    ["routing profile mismatch", (repository: CompleteV1Repository) => {
      repository.packs[0]!.routingProfileId = "research-and-intelligence";
    }, "routingProfileId must equal owner domain software-engineering"],
    ["wrong scenario id", (repository: CompleteV1Repository) => {
      repository.packs[0]!.scenarios[0]!.id = "wrong-normal";
    }, "scenario id must equal repository-to-implementation-plan-normal"],
    ["wrong scenario path", (repository: CompleteV1Repository) => {
      repository.packs[0]!.scenarios[0]!.path = "wrong/normal.yaml";
    }, "scenario path must equal tests/evaluations/packs/repository-to-implementation-plan/normal.yaml"],
    ["missing scenario type", (repository: CompleteV1Repository) => {
      repository.packs[0]!.scenarios.pop();
    }, "must declare exactly normal, boundary, and refusal scenarios"],
    ["missing scenario file", (_repository: CompleteV1Repository) => undefined,
      "scenario path is missing from explicit inventory"],
    ["wrong wave totals", (_repository: CompleteV1Repository) => undefined,
      "Wave counts do not equal expected counts"],
    ["catalog orphan pack", (repository: CompleteV1Repository) => {
      repository.catalog.initialPackIds.push("question-to-cited-research-brief");
    }, "Catalog pack IDs do not equal loaded pack IDs"]
  ])("rejects %s", async (_name, mutate, expectedMessage) => {
    const repository = await loadFixture();
    mutate(repository);
    const options = graphOptions(repository);
    if (_name === "missing scenario file") {
      options.scenarioPaths = new Set<string>();
    }
    if (_name === "wrong wave totals") {
      options.expectedWaveCounts = [2];
    }

    expect(() => validateCompleteV1Graph(repository, options)).toThrow(expectedMessage);
  });

  it("aggregates multiple diagnostics in stable code-point order independent of mutation order", async () => {
    const first = await loadFixture();
    first.packs[0]!.routingProfileId = "research-and-intelligence";
    first.packs[0]!.requiredCapabilityIds = ["unknown-capability"];
    const second = structuredClone(first);
    second.packs[0]!.requiredCapabilityIds = ["unknown-capability"];
    second.packs[0]!.routingProfileId = "research-and-intelligence";

    const firstDiagnostics = captureDiagnostics(first);
    const secondDiagnostics = captureDiagnostics(second);
    expect(firstDiagnostics).toEqual(secondDiagnostics);
    expect(firstDiagnostics).toEqual([...firstDiagnostics].sort((left, right) =>
      codePointCompare(`${left.path}\0${left.fieldPath}\0${left.message}`, `${right.path}\0${right.fieldPath}\0${right.message}`)
    ));
    expect(firstDiagnostics.length).toBeGreaterThanOrEqual(2);
  });

  it("reports an orphan category as both uncovered and unreachable", async () => {
    const repository = await loadFixture();
    repository.domains[0]!.categories.push("orphan-category");
    repository.catalog.categoryIds.push("orphan-category");
    repository.categoryCollections[0]!.categories.push({
      id: "orphan-category",
      name: { ko: "고립 범주", en: "Orphan category" },
      description: { ko: "연결되지 않은 범주", en: "A category with no graph edge." },
      status: "draft"
    });

    expect(captureDiagnostics(repository).map(({ message }) => message)).toEqual(expect.arrayContaining([
      "Category orphan-category is not covered by any capability",
      "Category orphan-category is not reachable through required or recommended pack capabilities"
    ]));
  });

  it("rejects duplicate scenario IDs and paths even within one pack", async () => {
    const repository = await loadFixture();
    repository.packs[0]!.scenarios[1]!.id = repository.packs[0]!.scenarios[0]!.id;
    repository.packs[0]!.scenarios[1]!.path = repository.packs[0]!.scenarios[0]!.path;

    expect(captureDiagnostics(repository).map(({ message }) => message)).toEqual(expect.arrayContaining([
      expect.stringContaining("Duplicate scenario ID"),
      expect.stringContaining("Duplicate scenario path")
    ]));
  });

  it.each([
    ["missing", (repository: CompleteV1Repository) => {
      repository.domains[0]!.categories = [];
    }],
    ["foreign", (repository: CompleteV1Repository) => {
      repository.domains[0]!.categories = ["implementation"];
    }],
    ["reordered", (repository: CompleteV1Repository) => {
      addSecondCategory(repository);
      repository.domains[0]!.categories.reverse();
    }]
  ])("rejects %s domain category identity at the concrete domain path", async (_name, mutate) => {
    const repository = await loadFixture();
    mutate(repository);
    expect(captureDiagnostics(repository)).toContainEqual({
      path: "manifests/complete-v1-domains/software-engineering.yaml",
      fieldPath: "/categories",
      message: "Domain software-engineering categories do not exactly equal its category collection order"
    });
  });

  it("uses concrete second-manifest paths and real fields for duplicate IDs", async () => {
    const repository = await loadFixture();
    repository.domains.push(structuredClone(repository.domains[0]!));
    repository.categoryCollections[0]!.categories.push(structuredClone(repository.categoryCollections[0]!.categories[0]!));
    repository.capabilityCollections[0]!.capabilities.push(structuredClone(repository.capabilityCollections[0]!.capabilities[0]!));
    repository.packs.push(structuredClone(repository.packs[0]!));

    expect(captureDiagnostics(repository)).toEqual(expect.arrayContaining([
      {
        path: "manifests/complete-v1-domains/software-engineering.yaml",
        fieldPath: "/id",
        message: "Duplicate domain manifest ID: software-engineering"
      },
      {
        path: "manifests/categories/software-engineering.yaml",
        fieldPath: "/categories/1/id",
        message: "Duplicate category ID: repository-context"
      },
      {
        path: "manifests/capabilities/software-engineering.yaml",
        fieldPath: "/capabilities/1/id",
        message: "Duplicate capability ID: repository-context-analysis"
      },
      {
        path: "manifests/complete-v1-packs/repository-to-implementation-plan.yaml",
        fieldPath: "/id",
        message: "Duplicate pack manifest ID: repository-to-implementation-plan"
      }
    ]));
  });

  it("attaches missing collection and catalog identity errors to real manifest fields", async () => {
    const repository = await loadFixture();
    repository.categoryCollections = [];
    repository.capabilityCollections = [];

    expect(captureDiagnostics(repository)).toEqual(expect.arrayContaining([
      {
        path: "manifests/complete-v1-domains/software-engineering.yaml",
        fieldPath: "/id",
        message: "Domain software-engineering is missing its category collection"
      },
      {
        path: "manifests/complete-v1-domains/software-engineering.yaml",
        fieldPath: "/id",
        message: "Domain software-engineering is missing its capability collection"
      },
      expect.objectContaining({ path: "manifests/catalog.yaml", fieldPath: "/categoryIds" }),
      expect.objectContaining({ path: "manifests/catalog.yaml", fieldPath: "/capabilityIds" })
    ]));
    expect(captureDiagnostics(repository).some(({ fieldPath }) => fieldPath.includes("collection-domain"))).toBe(false);
  });

  it("includes computed replacement-equivalence diagnostics in comprehensive graph validation", async () => {
    const repository = await loadFixture();
    const replacement = structuredClone(repository.packs[0]!);
    replacement.id = "spec-to-tested-feature";
    replacement.categoryIds = [];
    replacement.replacesPackIds = ["repository-to-implementation-plan"];
    replacement.scenarios = replacement.scenarios.map((scenario) => ({
      ...scenario,
      id: `spec-to-tested-feature-${scenario.type}`,
      path: `tests/evaluations/packs/spec-to-tested-feature/${scenario.type}.yaml`
    }));
    repository.packs.push(replacement);
    repository.catalog.initialPackIds.push("spec-to-tested-feature");
    repository.catalog.replacements.push({
      replacementPackId: "spec-to-tested-feature",
      replacesPackIds: ["repository-to-implementation-plan"],
      decisionRef: "architecture-review-2026",
      reviewer: "catalog-maintainer",
      requiredCategoryIds: ["repository-context"],
      requiredCapabilityIds: ["repository-context-analysis"],
      requiredPlatforms: ["darwin", "linux", "win32"],
      minimumTrust: "trusted",
      evaluationRefs: replacement.scenarios.map(({ id }) => id)
    });
    const options = graphOptions(repository);
    options.waves = [repository.catalog.initialPackIds];
    options.expectedWaveCounts = [2];

    expect(() => validateCompleteV1Graph(repository, options)).toThrow(
      "Replacement spec-to-tested-feature does not cover required category repository-context"
    );
  });
});

describe("bundle lifecycle indexes", () => {
  it("proves first activation, same-domain reuse, non-last retention, and last removal eligibility", async () => {
    const repository = await loadFixture();
    const basePack = repository.packs[0]!;
    const siblingPack = { ...structuredClone(basePack), id: "spec-to-tested-feature" };
    const indexes = buildBundleIndexes([basePack, siblingPack], []);

    const first = planBundleActivation(indexes, basePack.id);
    expect(first).toMatchObject({ bundleId: "software-engineering", beforeCount: 0, afterCount: 1, action: "activate" });
    const afterFirst = buildBundleIndexes([basePack, siblingPack], [basePack.id]);
    expect(planBundleActivation(afterFirst, siblingPack.id)).toMatchObject({ beforeCount: 1, afterCount: 2, action: "reuse" });
    const afterBoth = buildBundleIndexes([basePack, siblingPack], [basePack.id, siblingPack.id]);
    expect(planBundleRemoval(afterBoth, basePack.id)).toMatchObject({ beforeCount: 2, afterCount: 1, action: "retain" });
    expect(planBundleRemoval(afterFirst, basePack.id)).toMatchObject({ beforeCount: 1, afterCount: 0, action: "eligible-for-removal" });
  });

  it("counts active pack IDs once even when duplicate installed rows are supplied", async () => {
    const repository = await loadFixture();
    const pack = repository.packs[0]!;
    const indexes = buildBundleIndexes([pack], [pack.id, pack.id]);

    expect(indexes.bundleToActivePackIds.get("software-engineering")).toEqual([pack.id]);
    expect(planBundleRemoval(indexes, pack.id)).toMatchObject({ beforeCount: 1, afterCount: 0 });
  });

  it("rejects unknown active pack IDs and inactive removals while keeping active activation idempotent", async () => {
    const repository = await loadFixture();
    const pack = repository.packs[0]!;
    expect(() => buildBundleIndexes([pack], ["unknown-pack"])).toThrow("Unknown active pack ID: unknown-pack");
    const inactive = buildBundleIndexes([pack], []);
    expect(() => planBundleRemoval(inactive, pack.id)).toThrow(`Cannot remove inactive pack ID: ${pack.id}`);
    const active = buildBundleIndexes([pack], [pack.id]);
    expect(planBundleActivation(active, pack.id)).toMatchObject({ beforeCount: 1, afterCount: 1, action: "reuse" });
    expect(buildBundleIndexes([pack], [pack.id, pack.id]).bundleToActivePackIds.get(pack.routingProfileId)).toEqual([pack.id]);
  });
});

async function loadFixture() {
  const root = await mkdtemp(join(tmpdir(), "complete-v1-graph-"));
  temporaryRoots.push(root);
  await cp(fixtureRoot, root, { recursive: true });
  return loadCompleteV1Repository(root);
}

function graphOptions(repository: CompleteV1Repository) {
  return {
    scenarioPaths: new Set(repository.packs.flatMap((pack) => pack.scenarios.map(({ path }) => path))),
    waves: [repository.catalog.initialPackIds],
    expectedWaveCounts: [repository.catalog.initialPackIds.length],
    activePackIds: repository.catalog.initialPackIds
  };
}

function addSecondCategory(repository: CompleteV1Repository): void {
  repository.domains[0]!.categories.push("implementation");
  repository.catalog.categoryIds.push("implementation");
  repository.categoryCollections[0]!.categories.push({
    id: "implementation",
    name: { ko: "구현", en: "Implementation" },
    description: { ko: "구현 범주", en: "Implementation category." },
    status: "draft"
  });
  repository.capabilityCollections[0]!.capabilities[0]!.categoryIds.push("implementation");
  repository.packs[0]!.categoryIds.push("implementation");
}

function captureDiagnostics(repository: CompleteV1Repository) {
  try {
    validateCompleteV1Graph(repository, graphOptions(repository));
    throw new Error("Expected graph validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(CompleteV1GraphError);
    return (error as CompleteV1GraphError).diagnostics;
  }
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index]! < rightPoints[index]! ? -1 : 1;
    }
  }
  return leftPoints.length - rightPoints.length;
}
