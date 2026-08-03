import { describe, expect, it } from "vitest";
import { decideUpdate } from "../../src/trust/update-policy.js";

describe("update policy", () => {
  it.each([
    ["verified", "2.1.0", "2.2.0", "preview"],
    ["trusted", "2.1.0", "2.1.4", "preview"],
    ["trusted", "2.1.0", "2.1.0", "review"],
    ["community", "2.1.0", "2.1.4", "review"],
    ["verified", "2.1.0", "3.0.0", "review"],
    ["blocked", "2.1.0", "2.1.1", "block"]
  ] as const)("maps %s %s -> %s to %s", (trustTier, current, next, action) => {
    expect(decideUpdate(candidate({ trustTier, current, next })).action).toBe(action);
  });

  it.each(["licenseChanged", "permissionsChanged", "ownershipChanged"] as const)(
    "requires review when %s changes",
    (change) => {
      expect(decideUpdate(candidate({ [change]: true })).action).toBe("review");
    }
  );

  it("keeps blocked sources blocked when a sensitive value changes", () => {
    expect(decideUpdate(candidate({ trustTier: "blocked", permissionsChanged: true })).action).toBe("block");
  });

  it.each([
    ["not-semver", "invalid next version"],
    ["2.0.0", "decreasing next version"]
  ])("blocks %s with an explicit reason", (next, reason) => {
    expect(decideUpdate(candidate({ current: "2.1.0", next }))).toEqual({
      action: "block",
      reasons: [reason]
    });
  });

  it("blocks an invalid current version with an explicit reason", () => {
    expect(decideUpdate(candidate({ current: "not-semver" }))).toEqual({
      action: "block",
      reasons: ["invalid current version"]
    });
  });

  it("returns at least one reason for every decision", () => {
    const decisions = [
      decideUpdate(candidate()),
      decideUpdate(candidate({ trustTier: "community" })),
      decideUpdate(candidate({ trustTier: "blocked" }))
    ];

    expect(decisions.every((decision) => decision.reasons.length > 0)).toBe(true);
  });

  it("never exposes an auto-apply action", () => {
    expect(decideUpdate(candidate()).action).not.toBe("auto-apply");
  });
});

function candidate(overrides: Partial<Parameters<typeof decideUpdate>[0]> = {}) {
  return {
    trustTier: "verified" as const,
    current: "2.1.0",
    next: "2.1.1",
    licenseChanged: false,
    permissionsChanged: false,
    ownershipChanged: false,
    ...overrides
  };
}
