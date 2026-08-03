import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateReviewLedgerEvent } from "../../src/contracts/review-ledger.js";
import { canonicalize } from "../../src/research/canonical-json.js";
import { hashReviewEvent, verifyReviewLedger } from "../../src/research/review-ledger.js";
import type { ReviewLedgerEvent, ReviewerRegistry } from "../../src/model/review-ledger.js";

const reviewers: ReviewerRegistry = {
  schemaVersion: 3,
  reviewers: [
    { id: "seunghyeon1004", roles: ["maintainer", "security-reviewer"] },
    { id: "security-reviewer", roles: ["security-reviewer"] },
    { id: "source-reviewer", roles: ["source-reviewer"] }
  ]
};

describe("review ledger", () => {
  it("canonicalizes object keys by code point while preserving array order", () => {
    const value = { "\uE000": "private-use", "\u{10000}": "astral", a: [3, 1, 2], z: { b: true, a: false } };

    expect(canonicalize(value)).toBe('{"a":[3,1,2],"z":{"a":false,"b":true},"\uE000":"private-use","\u{10000}":"astral"}');
  });

  it("hashes the canonical event without eventHash and retains previousEventHash", () => {
    const event = eventFor("seunghyeon1004", { previousEventHash: "a".repeat(64), eventHash: "ignored" });
    const { eventHash: _eventHash, ...hashable } = event;
    const expected = createHash("sha256")
      .update(canonicalize(hashable), "utf8")
      .digest("hex");

    expect(hashReviewEvent(event)).toBe(expected);
  });

  it("accepts a canonical authorized append and returns its active leaf", () => {
    const event = signed(eventFor("seunghyeon1004"));

    expect(verifyReviewLedger({
      base: [],
      head: [event],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    }).leaves).toEqual([event]);
  });

  it("rejects a reviewer self-promotion in the same change", () => {
    expect(() => verifyReviewLedger({
      base: [],
      head: [signed(eventFor("new-reviewer"))],
      baseReviewers: reviewers,
      changedPaths: ["governance/reviewers.json", "research/review-ledger.jsonl"]
    })).toThrow(/base reviewer|same change/i);
  });

  it("uses base reviewer roles rather than the head registry", () => {
    expect(() => verifyReviewLedger({
      base: [],
      head: [signed(eventFor("new-reviewer"))],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    })).toThrow(/base reviewer/i);
  });

  it("rejects source-level approved decisions", () => {
    expect(() => verifyReviewLedger({
      base: [],
      head: [signed(eventFor("seunghyeon1004", { disposition: "approved", target: { sourceId: "source-a", skillPath: null } }))],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    })).toThrow(/exact path/i);
  });

  it("rejects malformed exact and evidence paths", () => {
    for (const skillPath of [".", "..", "skills/.", "skills/..", "skills//SKILL.md", "../skills/SKILL.md", "skills\\SKILL.md", "skills/\u0000SKILL.md", "skills/\u001FSKILL.md"]) {
      expect(() => validateReviewLedgerEvent(signed(eventFor("seunghyeon1004", {
        target: { sourceId: "source-a", skillPath }
      })))).toThrow(/pattern|relative path/i);
    }

    expect(() => validateReviewLedgerEvent(signed(eventFor("seunghyeon1004", {
      reviewedSensitiveFields: {
        ...eventFor("seunghyeon1004").reviewedSensitiveFields,
        license: { ...observed("Apache-2.0"), evidence: [{ path: "skills/../LICENSE", contentSha256: "e".repeat(64) }] }
      }
    })))).toThrow(/pattern|relative path/i);
  });

  it("rejects non-RFC3339, locale, and impossible review timestamps", () => {
    for (const reviewedAt of ["not-a-date", "July 29, 2026 00:00 UTC", "2026-02-30T00:00:00Z"]) {
      expect(() => verifyReviewLedger({
        base: [],
        head: [signed(eventFor("seunghyeon1004", { reviewedAt }))],
        baseReviewers: reviewers,
        changedPaths: ["research/review-ledger.jsonl"]
      })).toThrow(/date-time|RFC3339/i);
    }
    expect(() => verifyReviewLedger({
      base: [],
      head: [signed(eventFor("seunghyeon1004", { expiresAt: "July 29, 2026 00:00 UTC" }))],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    })).toThrow(/date-time|RFC3339/i);
  });

  it("does not let a source reviewer approve or block a decision", () => {
    for (const disposition of ["approved", "blocked"] as const) {
      expect(() => verifyReviewLedger({
        base: [],
        head: [signed(eventFor("source-reviewer", { disposition }))],
        baseReviewers: reviewers,
        changedPaths: ["research/review-ledger.jsonl"]
      })).toThrow(/security-reviewer|maintainer/i);
    }
  });

  it("requires a security reviewer or maintainer to release a blocked decision to held", () => {
    const blocked = signed(eventFor("security-reviewer", { disposition: "blocked" }));
    const heldBySourceReviewer = signed(eventFor("source-reviewer", {
      sequence: 2,
      id: "decision-2",
      previousEventHash: blocked.eventHash,
      disposition: "held",
      supersedes: blocked.id,
      reviewedAt: "2026-07-30T00:00:00Z",
      expiresAt: "2026-08-30T00:00:00Z"
    }));
    const heldBySecurityReviewer = signed({ ...heldBySourceReviewer, reviewerId: "security-reviewer" });

    expect(() => verifyReviewLedger({
      base: [],
      head: [blocked, heldBySourceReviewer],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    })).toThrow(/security-reviewer|maintainer/i);
    expect(verifyReviewLedger({
      base: [],
      head: [blocked, heldBySecurityReviewer],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    }).leaves).toEqual([heldBySecurityReviewer]);
  });

  it("rejects sequence gaps, broken hashes, and changed base events", () => {
    const first = signed(eventFor("seunghyeon1004"));
    const second = signed(eventFor("seunghyeon1004", {
      sequence: 3,
      id: "decision-2",
      previousEventHash: first.eventHash,
      target: { sourceId: "source-a", skillPath: "skills/second/SKILL.md" }
    }));

    expect(() => verifyReviewLedger({
      base: [],
      head: [first, second],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    })).toThrow(/sequence/i);
    expect(() => verifyReviewLedger({
      base: [first],
      head: [{ ...first, reasonCode: "rewritten" }],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    })).toThrow(/past|hash|base/i);
  });

  it("rejects two active leaves for one target", () => {
    const first = signed(eventFor("seunghyeon1004"));
    const fork = signed(eventFor("seunghyeon1004", {
      sequence: 2,
      id: "decision-2",
      previousEventHash: first.eventHash,
      reviewedAt: "2026-07-30T00:00:00Z",
      expiresAt: "2026-08-30T00:00:00Z"
    }));

    expect(() => verifyReviewLedger({
      base: [],
      head: [first, fork],
      baseReviewers: reviewers,
      changedPaths: ["research/review-ledger.jsonl"]
    })).toThrow(/leaf|fork|supersed/i);
  });
});

function eventFor(
  reviewerId: string,
  overrides: Partial<ReviewLedgerEvent> = {}
): ReviewLedgerEvent {
  return {
    sequence: 1,
    id: "decision-1",
    previousEventHash: null,
    target: { sourceId: "source-a", skillPath: "skills/example/SKILL.md" },
    disposition: "approved",
    supersedes: null,
    baseline: {
      snapshotId: "snapshot-a",
      inspectedCommit: "a".repeat(40),
      contentSha256: "b".repeat(64),
      pathBlobSha: "c".repeat(40),
      inheritedEvidenceDigest: "d".repeat(64)
    },
    reasonCode: "review-complete",
    reason: { ko: "검토 완료", en: "Review complete" },
    reviewedSensitiveFields: {
      license: observed("Apache-2.0"),
      permissions: observed(["network:none"]),
      ownership: observed("owner"),
      trust: observed("community"),
      dependencies: observed(["none"]),
      executableSurface: observed(["SKILL.md"])
    },
    runtimeEvidence: [{ runtime: "codex", compatibility: "verified", evidenceIds: ["evidence-a"] }],
    reviewerId,
    reviewedAt: "2026-07-29T00:00:00Z",
    expiresAt: "2026-08-29T00:00:00Z",
    eventHash: "",
    ...overrides
  };
}

function observed<T extends string | string[]>(value: T) {
  return { status: "observed" as const, value, evidence: [{ path: "SKILL.md", contentSha256: "e".repeat(64) }] };
}

function signed(event: ReviewLedgerEvent): ReviewLedgerEvent {
  return { ...event, eventHash: hashReviewEvent(event) };
}
