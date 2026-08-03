import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertReviewLedgerAppendOnly } from "../../scripts/research/assert-review-ledger-append-only.js";
import { canonicalize } from "../../src/research/canonical-json.js";
import { hashReviewEvent } from "../../src/research/review-ledger.js";
import type { ReviewLedgerEvent } from "../../src/model/review-ledger.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("review ledger append-only assertion", () => {
  it("accepts an append that retains the byte-identical base prefix", async () => {
    const { root, base } = await repository();
    const event = signed(eventFor({
      sequence: 2,
      id: "decision-2",
      previousEventHash: firstEventHash(root),
      target: { sourceId: "source-a", skillPath: "skills/second/SKILL.md" },
      reviewedAt: "2026-07-30T00:00:00Z",
      expiresAt: "2026-08-30T00:00:00Z"
    }));
    await writeFile(join(root, "research/review-ledger.jsonl"), `${await readFile(join(root, "research/review-ledger.jsonl"), "utf8")}${canonicalize(event)}\n`);
    commit(root, "append review");

    expect(() => assertReviewLedgerAppendOnly({ root, base })).not.toThrow();
  });

  it("rejects a rewritten historical line and a noncanonical JSONL event", async () => {
    const { root, base } = await repository();
    const event = signed(eventFor({
      sequence: 2,
      id: "decision-2",
      previousEventHash: firstEventHash(root),
      target: { sourceId: "source-a", skillPath: "skills/second/SKILL.md" },
      reviewedAt: "2026-07-30T00:00:00Z",
      expiresAt: "2026-08-30T00:00:00Z"
    }));
    const first = JSON.parse(await readFile(join(root, "research/review-ledger.jsonl"), "utf8")) as ReviewLedgerEvent;
    await writeFile(join(root, "research/review-ledger.jsonl"), `${JSON.stringify({ ...first, reasonCode: "rewritten" })}\n${canonicalize(event)}\n`);
    commit(root, "rewrite review");

    expect(() => assertReviewLedgerAppendOnly({ root, base })).toThrow(/past|canonical|hash/i);
  });

  it("rejects a base that predates the mandatory public review-ledger baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "review-ledger-bootstrap-"));
    roots.push(root);
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "Ledger Test"]);
    git(root, ["config", "user.email", "ledger@example.test"]);
    await writeFile(join(root, "README.md"), "bootstrap base\n");
    const base = commit(root, "base without v1 surfaces");
    await mkdir(join(root, "research"), { recursive: true });
    await mkdir(join(root, "governance"), { recursive: true });
    await writeFile(join(root, "research/review-ledger.jsonl"), "");
    await writeFile(join(root, "governance/reviewers.json"), canonicalize({ schemaVersion: 3, reviewers: [] }));
    commit(root, "bootstrap v1 surfaces");

    expect(() => assertReviewLedgerAppendOnly({ root, base })).toThrow(/required public baseline/i);
    await writeFile(join(root, "research/review-ledger.jsonl"), "not-empty\n");
    commit(root, "attempt bootstrap event");
    expect(() => assertReviewLedgerAppendOnly({ root, base })).toThrow(/required public baseline/i);
  });
});

async function repository(): Promise<{ root: string; base: string }> {
  const root = await mkdtemp(join(tmpdir(), "review-ledger-"));
  roots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Ledger Test"]);
  git(root, ["config", "user.email", "ledger@example.test"]);
  await mkdir(join(root, "research"), { recursive: true });
  await mkdir(join(root, "governance"), { recursive: true });
  await writeFile(join(root, "research/review-ledger.jsonl"), `${canonicalize(signed(eventFor()))}\n`);
  await writeFile(join(root, "governance/reviewers.json"), canonicalize({
    schemaVersion: 3,
    reviewers: [{ id: "seunghyeon1004", roles: ["maintainer", "security-reviewer"] }]
  }));
  const base = commit(root, "baseline");
  return { root, base };
}

function eventFor(overrides: Partial<ReviewLedgerEvent> = {}): ReviewLedgerEvent {
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
    reason: { ko: "complete", en: "complete" },
    reviewedSensitiveFields: {
      license: observed("Apache-2.0"), permissions: observed(["network:none"]), ownership: observed("owner"),
      trust: observed("community"), dependencies: observed(["none"]), executableSurface: observed(["SKILL.md"])
    },
    runtimeEvidence: [{ runtime: "codex", compatibility: "verified", evidenceIds: ["evidence-a"] }],
    reviewerId: "seunghyeon1004",
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

function commit(root: string, message: string): string {
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function firstEventHash(root: string): string {
  return JSON.parse(execFileSync("git", ["show", "HEAD:research/review-ledger.jsonl"], { cwd: root, encoding: "utf8" }))
    .eventHash as string;
}
