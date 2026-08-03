import { describe, expect, it } from "vitest";
import { evaluateEvaluationContextFreshness, evaluateProviderReviewFreshness, validateCurrentEvaluationContext } from "../../src/research/freshness.js";

const baseline = { schemaVersion: 2 as const, asOf: "2026-07-23T00:00:00Z", privateRcAt: null, upstreamObservations: [{ providerId: "provider-a", snapshotId: "snapshot-a", observedAt: "2026-07-23T00:00:00Z", headCommit: "a".repeat(40) }] };
describe("current evaluation context", () => {
  it("permits additive observations after the baseline", () => expect(() => validateCurrentEvaluationContext(baseline, { ...baseline, asOf: "2026-07-24T00:00:00Z" }, [{ id: "snapshot-a" } as never])).not.toThrow());
  it("rejects context time regression", () => expect(evaluateEvaluationContextFreshness(baseline, { ...baseline, asOf: "2026-07-22T00:00:00Z" }).reasonCodes).toContain("context-before-baseline"));
  it("marks due reviews and observed upstream commit drift stale", () => {
    const provider = { id: "provider-a", runtimeContracts: [{ reviewedCommit: "a".repeat(40) }] } as never;
    const review = { reviewedAt: "2026-07-23T00:00:00Z", nextReviewDate: "2026-07-23", reviewedCommit: "a".repeat(40) } as never;
    const context = { ...baseline, asOf: "2026-07-24T00:00:00Z", privateRcAt: "2026-07-24T00:00:00Z", upstreamObservations: [{ ...baseline.upstreamObservations[0]!, headCommit: "b".repeat(40) }] };
    expect(evaluateProviderReviewFreshness(provider, review, context).reasonCodes).toEqual(["review-overdue", "rc-recheck-required", "upstream-drift"]);
  });
});
