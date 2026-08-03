import { describe, expect, it } from "vitest";
import { TOOLING_VERSION } from "../../src/version.js";

describe("tooling version", () => {
  it("uses a semantic version", () => {
    expect(TOOLING_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
