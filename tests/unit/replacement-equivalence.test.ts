import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveReplacementObligations,
  ReplacementEquivalenceError,
  validateReplacementEquivalence
} from "../../src/catalog/replacement-equivalence.js";
import { loadCompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import type { CompleteV1Repository } from "../../src/manifest/complete-v1-repository.js";
import type { CompletePackManifest, ReplacementEdge } from "../../src/model/complete-v1.js";

const fixtureRoot = resolve("tests/fixtures/complete-v1-repository/valid");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("replacement equivalence", () => {
  it("derives high-impact obligations and accepts a high-impact replacement with exact proof", async () => {
    const repository = await replacementRepository();
    const edge = repository.catalog.replacements[0]!;

    expect(deriveReplacementObligations(repository, edge.replacesPackIds)).toEqual({
      requiredCategoryIds: ["repository-context"],
      requiredCapabilityIds: ["repository-context-analysis"],
      requiredPlatforms: ["darwin", "linux", "win32"],
      minimumTrust: "trusted",
      assuranceProfile: "high-impact",
      evaluationTypes: ["boundary", "normal", "refusal"]
    });
    expect(() => validateReplacementEquivalence(repository)).not.toThrow();
  });

  it.each([
    ["missing category coverage", (repository: CompleteV1Repository) => {
      replacementPack(repository).categoryIds = [];
    }, "does not cover required category repository-context"],
    ["missing capability coverage", (repository: CompleteV1Repository) => {
      replacementPack(repository).requiredCapabilityIds = [];
    }, "does not cover required capability repository-context-analysis"],
    ["required capability downgraded to optional", (repository: CompleteV1Repository) => {
      const replacement = replacementPack(repository);
      replacement.requiredCapabilityIds = [];
      replacement.optionalCapabilityIds = ["repository-context-analysis"];
    }, "does not cover required capability repository-context-analysis"],
    ["missing platform", (repository: CompleteV1Repository) => {
      replacementPack(repository).platforms = ["darwin", "linux"];
    }, "does not support required platform win32"],
    ["weaker assurance", (repository: CompleteV1Repository) => {
      replacementPack(repository).assuranceProfile = "standard";
    }, "assurance standard is weaker than required high-impact"],
    ["missing evaluation class", (repository: CompleteV1Repository) => {
      repository.catalog.replacements[0]!.evaluationRefs = [
        "spec-to-tested-feature-normal",
        "spec-to-tested-feature-boundary"
      ];
    }, "does not reference replacement refusal evidence"],
    ["false category proof", (repository: CompleteV1Repository) => {
      repository.catalog.replacements[0]!.requiredCategoryIds = ["implementation"];
    }, "requiredCategoryIds do not equal derived obligations"],
    ["pack without catalog edge", (repository: CompleteV1Repository) => {
      repository.catalog.replacements = [];
    }, "declares replacesPackIds without exactly one catalog edge"],
    ["edge without pack declaration", (repository: CompleteV1Repository) => {
      replacementPack(repository).replacesPackIds = [];
    }, "catalog edge does not equal replacement pack replacesPackIds"],
    ["self replacement", (repository: CompleteV1Repository) => {
      replacementPack(repository).replacesPackIds = ["spec-to-tested-feature"];
      repository.catalog.replacements[0]!.replacesPackIds = ["spec-to-tested-feature"];
    }, "cannot replace itself"],
    ["unknown replacement target", (repository: CompleteV1Repository) => {
      replacementPack(repository).replacesPackIds = ["question-to-cited-research-brief"];
      repository.catalog.replacements[0]!.replacesPackIds = ["question-to-cited-research-brief"];
    }, "references unknown replaced pack question-to-cited-research-brief"],
    ["duplicate catalog edge", (repository: CompleteV1Repository) => {
      repository.catalog.replacements.push(structuredClone(repository.catalog.replacements[0]!));
    }, "has duplicate catalog replacement edges"],
    ["duplicate replaced target", (repository: CompleteV1Repository) => {
      replacementPack(repository).replacesPackIds = [
        "repository-to-implementation-plan",
        "repository-to-implementation-plan"
      ];
      repository.catalog.replacements[0]!.replacesPackIds = [
        "repository-to-implementation-plan",
        "repository-to-implementation-plan"
      ];
    }, "Duplicate replaced pack ID: repository-to-implementation-plan"],
    ["replacement cycle", (repository: CompleteV1Repository) => {
      repository.packs[0]!.replacesPackIds = ["spec-to-tested-feature"];
      repository.catalog.replacements.push(edgeFor(repository.packs[0]!, ["spec-to-tested-feature"]));
    }, "Replacement cycle detected"]
  ])("rejects %s", async (_name, mutate, expectedMessage) => {
    const repository = await replacementRepository();
    mutate(repository);
    expect(() => validateReplacementEquivalence(repository)).toThrow(expectedMessage);
  });

  it("sorts multiple replacement diagnostics stably", async () => {
    const repository = await replacementRepository();
    replacementPack(repository).platforms = ["darwin"];
    replacementPack(repository).categoryIds = [];

    try {
      validateReplacementEquivalence(repository);
      throw new Error("Expected replacement validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplacementEquivalenceError);
      const diagnostics = (error as ReplacementEquivalenceError).diagnostics;
      expect(diagnostics.map(({ message }) => message)).toEqual([
        "Replacement spec-to-tested-feature does not cover required category repository-context",
        "Replacement spec-to-tested-feature does not support required platform linux",
        "Replacement spec-to-tested-feature does not support required platform win32"
      ]);
    }
  });

  it("rejects optional-only replacement capability and category coverage together", async () => {
    const repository = await replacementRepository();
    const replacement = replacementPack(repository);
    replacement.requiredCapabilityIds = [];
    replacement.optionalCapabilityIds = ["repository-context-analysis"];

    try {
      validateReplacementEquivalence(repository);
      throw new Error("Expected optional-only replacement failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplacementEquivalenceError);
      expect((error as ReplacementEquivalenceError).diagnostics.map(({ message }) => message)).toEqual(
        expect.arrayContaining([
          "Replacement spec-to-tested-feature does not cover required capability repository-context-analysis",
          "Replacement spec-to-tested-feature does not cover required category repository-context through required or recommended capabilities"
        ])
      );
    }
  });
});

async function replacementRepository(): Promise<CompleteV1Repository> {
  const root = await mkdtemp(join(tmpdir(), "replacement-equivalence-"));
  temporaryRoots.push(root);
  await cp(fixtureRoot, root, { recursive: true });
  const repository = await loadCompleteV1Repository(root);
  const source = repository.packs[0]!;
  const replacement = structuredClone(source);
  replacement.id = "spec-to-tested-feature";
  replacement.minimumProviderTrust = "trusted";
  replacement.replacesPackIds = ["repository-to-implementation-plan"];
  replacement.scenarios = replacement.scenarios.map((scenario) => ({
    ...scenario,
    id: `spec-to-tested-feature-${scenario.type}`,
    path: `tests/evaluations/packs/spec-to-tested-feature/${scenario.type}.yaml`
  }));
  repository.packs.push(replacement);
  repository.catalog.initialPackIds.push("spec-to-tested-feature");
  repository.catalog.replacements = [edgeFor(replacement, ["repository-to-implementation-plan"] )];
  return repository;
}

function edgeFor(replacement: CompletePackManifest, replacesPackIds: ReplacementEdge["replacesPackIds"]): ReplacementEdge {
  return {
    replacementPackId: replacement.id,
    replacesPackIds,
    decisionRef: "architecture-review-2026",
    reviewer: "catalog-maintainer",
    requiredCategoryIds: ["repository-context"],
    requiredCapabilityIds: ["repository-context-analysis"],
    requiredPlatforms: ["darwin", "linux", "win32"],
    minimumTrust: "trusted",
    evaluationRefs: replacement.scenarios.map(({ id }) => id)
  };
}

function replacementPack(repository: CompleteV1Repository): CompletePackManifest {
  return repository.packs.find(({ id }) => id === "spec-to-tested-feature")!;
}
