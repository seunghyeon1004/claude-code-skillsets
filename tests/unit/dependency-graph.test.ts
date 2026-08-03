import { describe, expect, it } from "vitest";
import { resolvePackClosure, validateDependencyGraph } from "../../src/graph/dependencies.js";

describe("dependency graph", () => {
  it("rejects duplicate node IDs", () => {
    const nodes = [
      { id: "shared-core", required: [] },
      { id: "shared-core", required: [] }
    ];

    expect(() => validateDependencyGraph(nodes)).toThrow(/duplicate.*shared-core/i);
  });

  it("reports duplicate node IDs identically for equivalent input permutations", () => {
    const first = [
      { id: "zeta", required: [] },
      { id: "zeta", required: [] },
      { id: "alpha", required: [] },
      { id: "alpha", required: [] }
    ];
    const second = [
      { id: "alpha", required: [] },
      { id: "zeta", required: [] },
      { id: "alpha", required: [] },
      { id: "zeta", required: [] }
    ];

    expect(validationError(first)).toBe("Duplicate dependency node ID: alpha");
    expect(validationError(second)).toBe(validationError(first));
  });

  it("rejects unknown required node IDs", () => {
    const nodes = [{ id: "publish", required: ["missing"] }];

    expect(() => validateDependencyGraph(nodes)).toThrow(/unknown.*missing/i);
  });

  it("reports unknown required IDs identically for equivalent input permutations", () => {
    const first = [
      { id: "zeta", required: ["missing-z", "missing-a"] },
      { id: "alpha", required: ["missing-b", "missing-c"] }
    ];
    const second = [
      { id: "alpha", required: ["missing-c", "missing-b"] },
      { id: "zeta", required: ["missing-a", "missing-z"] }
    ];

    expect(validationError(first)).toBe("Unknown required dependency ID: missing-b (required by alpha)");
    expect(validationError(second)).toBe(validationError(first));
  });

  it("rejects a cycle with its complete path", () => {
    const nodes = [
      { id: "a", required: ["b"] },
      { id: "b", required: ["c"] },
      { id: "c", required: ["a"] }
    ];

    expect(() => validateDependencyGraph(nodes)).toThrow("a -> b -> c -> a");
  });

  it("returns dependencies before dependents", () => {
    const nodes = [
      { id: "publish", required: ["write"] },
      { id: "write", required: ["shared-core"] },
      { id: "shared-core", required: [] }
    ];

    expect(resolvePackClosure("publish", nodes)).toEqual(["shared-core", "write", "publish"]);
  });

  it("orders sibling dependencies lexicographically regardless of input order", () => {
    const nodes = [
      { id: "publish", required: ["zeta", "alpha", "zeta"] },
      { id: "zeta", required: [] },
      { id: "alpha", required: [] }
    ];

    expect(resolvePackClosure("publish", nodes)).toEqual(["alpha", "zeta", "publish"]);
  });
});

function validationError(nodes: { id: string; required: string[] }[]): string {
  try {
    validateDependencyGraph(nodes);
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    throw error;
  }

  throw new Error("Expected dependency graph validation to fail");
}
