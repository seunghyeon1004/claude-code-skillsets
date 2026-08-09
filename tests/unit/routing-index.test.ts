import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionIndex } from "../../src/model/decision.js";
import { canonicalize } from "../../src/research/canonical-json.js";

const projectRoot = process.cwd();

describe("decision routing index", () => {
  it("generates only from an integrity-valid complete decision index", async () => {
    const module = await import("../../src/generate/routing-index.js").catch(() => ({}));
    const generate = (module as { generateRoutingIndex?: (value: unknown) => string }).generateRoutingIndex;

    expect(typeof generate).toBe("function");
    if (generate === undefined) return;
    const decision = await decisionIndex();
    const raw = generate(decision);
    expect(raw.endsWith("\n")).toBe(true);

    const invalid = structuredClone(decision);
    invalid.digest = "0".repeat(64);
    expect(() => generate(invalid)).toThrow(/decision index digest mismatch/i);
  });

  it("fails closed for changed projection content, source binding, or object keys", async () => {
    const generatorModule = await import("../../src/generate/routing-index.js").catch(() => ({}));
    const contractModule = await import("../../src/contracts/decision.js");
    const generate = (generatorModule as { generateRoutingIndex?: (value: unknown) => string }).generateRoutingIndex;
    const validate = (contractModule as {
      validateDecisionRoutingIndex?: (value: unknown, decision: unknown) => unknown;
    }).validateDecisionRoutingIndex;

    expect(typeof generate).toBe("function");
    expect(typeof validate).toBe("function");
    if (generate === undefined || validate === undefined) return;
    const decision = await decisionIndex();
    const routing = JSON.parse(generate(decision)) as Record<string, unknown>;
    expect(validate(routing, decision)).toEqual(routing);

    expect(() => validate({ ...routing, digest: "0".repeat(64) }, decision)).toThrow(/digest/i);
    expect(() => validate({ ...routing, candidates: [] }, decision)).toThrow(/additional properties/i);
    expect(() => validate(withDigest({ ...routing, decisionIndexDigest: "0".repeat(64) }), decision))
      .toThrow(/decision index digest/i);
    expect(() => validate(withDigest({ ...routing, profiles: [...decision.profiles].reverse() }), decision))
      .toThrow(/profiles/i);
    expect(() => validate(withDigest({ ...routing, catalogExpiresAt: "2099-01-01T00:00:00Z" }), decision))
      .toThrow(/catalogExpiresAt/i);
  });
});

async function decisionIndex(): Promise<DecisionIndex> {
  return JSON.parse(await readFile(join(projectRoot, "generated", "decision-index.json"), "utf8")) as DecisionIndex;
}

function withDigest(value: Record<string, unknown>): Record<string, unknown> {
  const { digest: _digest, ...withoutDigest } = value;
  return {
    ...withoutDigest,
    digest: createHash("sha256").update(canonicalize(withoutDigest)).digest("hex")
  };
}
