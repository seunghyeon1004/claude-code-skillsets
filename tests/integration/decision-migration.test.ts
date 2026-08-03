import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DECISION_BROKER_V1_AS_OF,
  migrateDecisionBrokerV1,
  writeDecisionBrokerV1Migration
} from "../../scripts/research/migrate-decision-broker-v1.js";
import { canonicalize } from "../../src/research/canonical-json.js";
import { hashReviewEvent } from "../../src/research/review-ledger.js";
import type { ReviewLedgerEvent } from "../../src/model/review-ledger.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("Decision Broker v1 migration", () => {
  it("materializes all legacy sources as unknown, held, and not-reviewed without seeding a review", async () => {
    const root = await cleanRepository();
    try {
      const migrated = await migrateDecisionBrokerV1({ root });

      expect(migrated.asOf).toBe(DECISION_BROKER_V1_AS_OF);
      expect(migrated.ledgerEvents).toEqual([]);
      expect(migrated.observations).toHaveLength(15);
      expect(migrated.observations.every((observation) =>
        Object.values(observation.fields).every((field) => field.status === "unknown" && field.evidence.length === 0)
      )).toBe(true);
      expect(migrated.diffs.every((diff) => diff.status === "baseline" && diff.previousEvidenceId === null)).toBe(true);
      expect(migrated.states).toHaveLength(15);
      expect(migrated.states.every((state) => state.state === "held" && state.reason === "not-reviewed")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is byte-stable and does not rewrite the legacy snapshot or receipt inputs", async () => {
    const root = await cleanRepository();
    try {
      const before = await legacyBytes(root);
      const first = await migrateDecisionBrokerV1({ root });
      const second = await migrateDecisionBrokerV1({ root });

      expect(second.files).toEqual(first.files);
      expect(await legacyBytes(root)).toEqual(before);
      expect(Object.keys(before)).toHaveLength(30);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the required observation-evidence root is missing", async () => {
    const root = await cleanRepository();
    try {
      await rm(join(root, "research", "observation-evidence"), { recursive: true, force: true });

      await expect(migrateDecisionBrokerV1({ root })).rejects.toThrow(/observation-evidence.*missing|required/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a schema-valid but incomplete source-review backlog before materializing", async () => {
    const root = await cleanRepository();
    try {
      const path = join(root, "research", "source-review-backlog.json");
      const backlog = JSON.parse(await readFile(path, "utf8")) as { candidates: unknown[] };
      backlog.candidates = backlog.candidates.slice(1);
      await writeFile(path, `${JSON.stringify(backlog, null, 2)}\n`);

      await expect(migrateDecisionBrokerV1({ root })).rejects.toThrow(/source review backlog|candidate/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves a nonempty later ledger byte-for-byte instead of seeding or rewriting it", async () => {
    const root = await cleanRepository();
    try {
      const event = signedLaterHeldEvent();
      const ledger = `${canonicalize(event)}\n`;
      const path = join(root, "research", "review-ledger.jsonl");
      await writeFile(path, ledger);

      const migrated = await migrateDecisionBrokerV1({ root });

      expect(migrated.ledgerEvents).toEqual([event]);
      await expect(readFile(path, "utf8")).resolves.toBe(ledger);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects stale materialized bytes in explicit migration check mode", async () => {
    const root = await cleanRepository();
    try {
      const path = join(root, "research", "source-observations.json");
      await writeFile(path, `${await readFile(path, "utf8")}\n`);

      await expect(writeDecisionBrokerV1Migration({ root, checkOnly: true })).rejects.toThrow(/source-observations\.json is stale/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function legacyBytes(root: string): Promise<Record<string, string>> {
  const paths = (await Promise.all(["research/receipts", "research/snapshots"].map(async (directory) =>
    (await readdir(join(root, directory)))
      .filter((name) => name.endsWith(".json"))
      .map((name) => `${directory}/${name}`)
  ))).flat().sort();
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [
    path,
    createHash("sha256").update(await readFile(join(root, path))).digest("hex")
  ])));
}

async function cleanRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "decision-migration-"));
  await rm(root, { recursive: true, force: true });
  execFileSync("git", ["clone", "--no-hardlinks", "--local", projectRoot, root], { stdio: "ignore" });
  git(root, ["config", "user.name", "Decision Migration Test"]);
  git(root, ["config", "user.email", "decision-migration@example.test"]);

  const observationRoot = join(root, "research", "observation-evidence");
  for (const filename of (await readdir(observationRoot)).filter((name) => name.endsWith(".json"))) {
    await rm(join(observationRoot, filename));
  }
  git(root, ["add", "-A"]);
  const tree = git(root, ["write-tree"]);
  const rootCommit = git(root, ["commit-tree", tree, "-m", "public root"]);
  const tipCommit = git(root, ["commit-tree", tree, "-p", rootCommit, "-m", "public attestation"]);
  for (const ref of git(root, ["for-each-ref", "--format=%(refname)", "refs/tags/public-history/"])
    .split("\n").filter(Boolean)) {
    git(root, ["update-ref", "-d", ref]);
  }
  git(root, ["update-ref", "HEAD", tipCommit]);
  git(root, ["tag", "-a", "public-history/root-v1", "-m", "Public history root", rootCommit]);
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function signedLaterHeldEvent(): ReviewLedgerEvent {
  const event: ReviewLedgerEvent = {
    sequence: 1,
    id: "later-held-observation",
    previousEventHash: null,
    target: { sourceId: "anthropic-plugins-official", skillPath: null },
    disposition: "held",
    supersedes: null,
    baseline: {
      snapshotId: "2026-07-23-anthropic-plugins-official",
      inspectedCommit: "e3e378cbbb205673a5d7254ded32679cafa6179d",
      contentSha256: "a".repeat(64),
      pathBlobSha: null,
      inheritedEvidenceDigest: "b".repeat(64)
    },
    reasonCode: "later-observation-held",
    reason: { ko: "later held", en: "later held" },
    reviewedSensitiveFields: {
      license: unknown(), permissions: unknown(), ownership: unknown(), trust: unknown(),
      dependencies: unknown(), executableSurface: unknown()
    },
    runtimeEvidence: [{ runtime: "claude-code", compatibility: "unknown", evidenceIds: ["later-held-evidence"] }],
    reviewerId: "seunghyeon1004",
    reviewedAt: "2026-07-28T00:00:00Z",
    expiresAt: "2026-08-28T00:00:00Z",
    eventHash: ""
  };
  return { ...event, eventHash: hashReviewEvent(event) };
}

function unknown() {
  return { status: "unknown" as const, evidence: [] };
}
