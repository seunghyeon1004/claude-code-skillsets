import { execFileSync } from "node:child_process";
import { link, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  assertExtensionAppendOnly,
  hasProtectedResearchBatchSurfaceChanges,
  hasResearchBatchChanges
} from "../../scripts/research/assert-extension-append-only.js";

const roots: string[] = [];
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

interface Batch { head: string; tagObject: string; }

async function repository(options: {
  mutableResearchAtBase?: boolean;
  decisionEvidenceAtBase?: boolean;
  largeObservationAtBase?: boolean;
} = {}): Promise<{ root: string; base: string; rootTagObject: string }> {
  const root = await mkdtemp(join(tmpdir(), "research-append-only-"));
  roots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Research Test"]);
  git(root, ["config", "user.email", "research-test@example.test"]);
  await mkdir(join(root, "research", "evidence", "artifacts"), { recursive: true });
  await writeJson(root, "research/evaluation-context.json", context());
  if (options.mutableResearchAtBase !== false) {
    await writeJson(root, "research/review-source-extensions.json", { schemaVersion: 2, triads: [] });
    await writeJson(root, "research/current-evaluation-context.json", context());
  }
  await writeJson(root, "research/evidence/issued.json", { id: "issued", artifactPath: "research/evidence/artifacts/issued.txt" });
  await writeFile(join(root, "research/evidence/artifacts/issued.txt"), "issued\n");
  await writeJson(root, "governance/reviewers.json", {
    schemaVersion: 3,
    reviewers: [
      { id: "maintainer", roles: ["maintainer"] },
      { id: "author", roles: ["source-reviewer"] }
    ]
  });
  if (options.decisionEvidenceAtBase !== false) {
    await mkdir(join(root, "manifests"), { recursive: true });
    await writeFile(
      join(root, "manifests", "decision-candidate-evidence.yaml"),
      [
        "schemaVersion: 3",
        "candidates:",
        "  - id: candidate-a",
        "    capabilities: [capability-a]",
        "evidence:",
        "  - id: evidence-a",
        "    candidateId: candidate-a",
        "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
        ""
      ].join("\n")
    );
    await writeJson(root, "research/evidence/shopify-source.json", {
      id: "shopify-source",
      artifactPath: "research/evidence/artifacts/shopify/source-blobs/readme.md"
    });
    await mkdir(join(root, "research/evidence/artifacts/shopify/source-blobs"), { recursive: true });
    await writeFile(join(root, "research/evidence/artifacts/shopify/source-blobs/readme.md"), "pinned source\n");
  }
  if (options.largeObservationAtBase) {
    await writeJson(
      root,
      "research/observation-evidence/observation-large.json",
      largeObservationEvidence()
    );
  }
  const base = commit(root, "baseline");
  git(root, ["tag", "-a", "registry-approved/r01", "-m", "R01 root"]);
  return { root, base, rootTagObject: git(root, ["rev-parse", "registry-approved/r01"]) };
}

async function addTriad(
  root: string,
  sequence: number,
  predecessorName: string,
  predecessorObject: string,
  options: { tagName?: string; annotation?: string; lightweight?: boolean } = {}
): Promise<Batch> {
  const suffix = String.fromCharCode(96 + sequence);
  const extensionPath = join(root, "research/review-source-extensions.json");
  const extension = JSON.parse(await readFile(extensionPath, "utf8")) as { schemaVersion: 2; triads: Array<{ sourceId: string; receiptId: string; snapshotId: string }> };
  extension.triads.push({ sourceId: `source-${suffix}`, receiptId: `receipt-${suffix}`, snapshotId: `snapshot-${suffix}` });
  await writeJson(root, "research/review-source-extensions.json", extension);
  await writeJson(root, `research/sources/source-${suffix}.json`, { sourceId: `source-${suffix}` });
  await writeJson(root, `research/receipts/receipt-${suffix}.json`, { id: `receipt-${suffix}`, sourceId: `source-${suffix}`, snapshotId: `snapshot-${suffix}` });
  await writeJson(root, `research/snapshots/snapshot-${suffix}.json`, { id: `snapshot-${suffix}` });
  commit(root, `batch-${sequence}`);
  return tagCurrentBatch(root, sequence, predecessorName, predecessorObject, options);
}

function tagCurrentBatch(
  root: string,
  sequence: number,
  predecessorName: string,
  predecessorObject: string,
  options: { tagName?: string; annotation?: string; lightweight?: boolean } = {}
): Batch {
  const head = git(root, ["rev-parse", "HEAD"]);
  const tagName = options.tagName ?? `registry-approved/research-${String(sequence).padStart(4, "0")}`;
  const annotation = options.annotation ?? [
    `sequence: ${sequence}`,
    `previous-tag: ${predecessorName}`,
    `previous-tag-object: ${predecessorObject}`,
    `batch-head: ${head}`
  ].join("\n");
  if (options.lightweight) git(root, ["tag", tagName]);
  else git(root, ["tag", "-a", tagName, "-m", annotation]);
  return { head, tagObject: git(root, ["rev-parse", tagName]) };
}

function verify(root: string, base: string, approvedObject: string): void {
  const prior = process.env.APPROVED_REGISTRY_TAG_OBJECT;
  process.env.APPROVED_REGISTRY_TAG_OBJECT = approvedObject;
  try {
    assertExtensionAppendOnly({ root, base });
  } finally {
    if (prior === undefined) delete process.env.APPROVED_REGISTRY_TAG_OBJECT;
    else process.env.APPROVED_REGISTRY_TAG_OBJECT = prior;
  }
}

function verifyWithoutApproval(root: string, base: string): void {
  const prior = process.env.APPROVED_REGISTRY_TAG_OBJECT;
  delete process.env.APPROVED_REGISTRY_TAG_OBJECT;
  try {
    assertExtensionAppendOnly({ root, base });
  } finally {
    if (prior !== undefined) process.env.APPROVED_REGISTRY_TAG_OBJECT = prior;
  }
}

function verifyCandidate(root: string, base: string, approvedObject: string): void {
  const prior = process.env.APPROVED_REGISTRY_TAG_OBJECT;
  process.env.APPROVED_REGISTRY_TAG_OBJECT = approvedObject;
  try {
    assertExtensionAppendOnly({ root, base, approvalMode: "pre-approval-candidate" });
  } finally {
    if (prior === undefined) delete process.env.APPROVED_REGISTRY_TAG_OBJECT;
    else process.env.APPROVED_REGISTRY_TAG_OBJECT = prior;
  }
}

function resolveCurrentRegistryAnchor(root: string, approvedObject: string): string {
  return execFileSync(
    "bash",
    [join(projectRoot, "scripts", "research", "require-registry-anchor-input.sh"), "--print-target"],
    {
      cwd: root,
      env: {
        ...process.env,
        REGISTRY_APPROVAL_MODE: "current-tip",
        REGISTRY_APPROVAL_ANCHORED: "anchored",
        APPROVED_REGISTRY_TAG_OBJECT: approvedObject
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  ).trim();
}

function context() {
  return { schemaVersion: 2, asOf: "2026-07-23T00:00:00Z", privateRcAt: null, upstreamObservations: [] };
}

function observationEvidence(id: string, sourceId = "source-a") {
  const unknown = { status: "unknown", evidence: [] };
  return {
    schemaVersion: 3,
    id,
    sourceId,
    observedAt: "2026-07-29T00:00:00Z",
    inspectedCommit: "a".repeat(40),
    blobs: [],
    fields: {
      license: unknown,
      permissions: unknown,
      ownership: unknown,
      dependencies: unknown,
      executableSurface: unknown
    }
  };
}

function largeObservationEvidence() {
  return {
    ...observationEvidence("observation-large"),
    blobs: Array.from({ length: 9_000 }, (_, index) => ({
      path: `skills/${String(index).padStart(5, "0")}/SKILL.md`,
      gitBlobSha: "b".repeat(40),
      byteSize: 1,
      readStatus: "unknown"
    }))
  };
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(value)}\n`);
}

async function writeCandidateRevision(root: string, reviewerId: string): Promise<void> {
  const path = join(root, "manifests", "decision-candidate-evidence.yaml");
  const manifest = YAML.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  manifest.candidateRevisions = [{
    id: "candidate-a-revision-one",
    candidateId: "candidate-a",
    previousRevisionId: null,
    candidate: { id: "candidate-a" },
    approval: { reviewerId }
  }];
  await writeFile(path, YAML.stringify(manifest));
}

function commit(root: string, message: string): string {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function publicCloneWithoutDecisionEvidence(): Promise<{ root: string; base: string }> {
  const source = await repository({ decisionEvidenceAtBase: false });
  git(source.root, ["tag", "-a", "public-history/root-v1", "-m", "Public history root", source.base]);
  git(source.root, ["commit", "--quiet", "--allow-empty", "-m", "public attestation"]);

  const transportRoot = await mkdtemp(join(tmpdir(), "research-append-only-public-"));
  roots.push(transportRoot);
  const bare = join(transportRoot, "source.git");
  const root = join(transportRoot, "repository");
  git(source.root, ["clone", "--quiet", "--bare", "--no-hardlinks", source.root, bare]);
  git(source.root, ["clone", "--quiet", "--no-local", bare, root]);
  return { root, base: source.base };
}

describe("research extension append-only history", () => {
  it("accepts empty-to-add and consecutive approved batches", async () => {
    const initial = await repository();
    const first = await addTriad(initial.root, 1, "registry-approved/r01", initial.rootTagObject);
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).not.toThrow();
    const second = await addTriad(initial.root, 2, "registry-approved/research-0001", first.tagObject);
    expect(() => verify(initial.root, first.head, first.tagObject)).not.toThrow();
    expect(second.head).toHaveLength(40);
  });

  it("uses the same annotated chain across changed-batch and current-anchor phases", async () => {
    const initial = await repository();
    const first = await addTriad(initial.root, 1, "registry-approved/r01", initial.rootTagObject);

    // The changed-batch verifier authenticates the predecessor before r0001 is accepted.
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).not.toThrow();
    // The post-approval clean-copy anchor must instead authenticate the newest accepted tag.
    expect(resolveCurrentRegistryAnchor(initial.root, first.tagObject)).toBe(first.head);
    expect(() => resolveCurrentRegistryAnchor(initial.root, initial.rootTagObject)).toThrow(/stale/i);
  });

  it("validates an r01-descended prospective batch before its nonexistent next approval tag", async () => {
    const initial = await repository();
    await writeJson(
      initial.root,
      "research/observation-evidence/observation-first.json",
      observationEvidence("observation-first")
    );
    commit(initial.root, "first prospective observation batch");
    const candidateHead = git(initial.root, ["rev-parse", "HEAD"]);

    expect(hasResearchBatchChanges({ root: initial.root, base: initial.base })).toBe(true);
    expect(hasProtectedResearchBatchSurfaceChanges(initial.root, initial.base, candidateHead)).toBe(true);
    expect(() => verifyCandidate(initial.root, initial.base, initial.rootTagObject)).not.toThrow();
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("missing annotated next");
  });

  it("validates issued observation evidence larger than the child-process default buffer", async () => {
    const initial = await repository({ largeObservationAtBase: true });
    const path = join(initial.root, "research/observation-evidence/observation-large.json");
    expect((await readFile(path)).byteLength).toBeGreaterThan(1024 * 1024);

    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).not.toThrow();
  });

  it("protects observation-evidence record paths, ids, and issued content", async () => {
    const initial = await repository();
    const issuedPath = "research/observation-evidence/observation-issued.json";
    await writeJson(initial.root, issuedPath, observationEvidence("observation-issued"));
    commit(initial.root, "issue observation evidence");
    const approved = tagCurrentBatch(initial.root, 1, "registry-approved/r01", initial.rootTagObject);
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).not.toThrow();

    await writeJson(initial.root, issuedPath, {
      ...observationEvidence("observation-issued"),
      observedAt: "2026-07-30T00:00:00Z"
    });
    expect(hasResearchBatchChanges({ root: initial.root, base: approved.head })).toBe(true);
    expect(() => verifyCandidate(initial.root, approved.head, approved.tagObject))
      .toThrow("issued observation evidence record was rewritten");

    await writeJson(initial.root, issuedPath, observationEvidence("observation-issued"));
    await writeJson(
      initial.root,
      "research/observation-evidence/observation-new.json",
      observationEvidence("observation-issued")
    );
    git(initial.root, ["add", "research/observation-evidence/observation-new.json"]);
    expect(() => verifyCandidate(initial.root, approved.head, approved.tagObject))
      .toThrow(/observation evidence path does not match its id|reuses an issued observation evidence id/);

    await unlink(join(initial.root, issuedPath));
    expect(hasResearchBatchChanges({ root: initial.root, base: approved.head })).toBe(true);
    expect(() => verifyCandidate(initial.root, approved.head, approved.tagObject))
      .toThrow("issued observation evidence record was deleted or renamed");
  });

  it("rejects a base that predates the mandatory mutable-research baseline", async () => {
    const initial = await repository({ mutableResearchAtBase: false });
    await writeJson(initial.root, "research/review-source-extensions.json", { schemaVersion: 2, triads: [] });
    await writeJson(initial.root, "research/current-evaluation-context.json", context());
    commit(initial.root, "initialize-mutable-research");

    expect(() => verifyWithoutApproval(initial.root, initial.base)).toThrow(/required public baseline/i);
  });

  it("rejects a base that predates the mandatory decision-evidence baseline", async () => {
    const initial = await repository({ decisionEvidenceAtBase: false });
    expect(() => verifyWithoutApproval(initial.root, initial.base)).toThrow(/required public baseline/i);
  });

  it("uses an event base for an ordinary build after an anchor without requiring a new tag", async () => {
    const initial = await repository();
    await mkdir(join(initial.root, "notes"), { recursive: true });
    await writeFile(join(initial.root, "notes", "event-base.txt"), "ordinary build base\n");
    const eventBase = commit(initial.root, "ordinary-event-base");
    await writeFile(join(initial.root, "notes", "head.txt"), "ordinary build head\n");
    commit(initial.root, "ordinary-code-only-head");

    expect(() => verify(initial.root, eventBase, initial.rootTagObject)).not.toThrow();
  });

  it("does not treat tracked JSON artifacts as evidence records", async () => {
    const initial = await repository();
    await writeJson(initial.root, "research/evidence/artifacts/issued-metadata.json", { source: "issued" });
    await writeJson(initial.root, "research/evidence/issued.json", {
      id: "issued",
      artifactPath: "research/evidence/artifacts/issued.txt",
      assetPath: "research/evidence/artifacts/issued-metadata.json"
    });
    const base = commit(initial.root, "add-json-artifact");

    expect(() => verifyWithoutApproval(initial.root, base)).not.toThrow();
  });

  it.each(["symlink", "hardlink"])("rejects a tracked %s evidence artifact", async (kind) => {
    const initial = await repository();
    const artifactPath = "research/evidence/artifacts/linked.txt";
    const artifact = join(initial.root, artifactPath);
    const issued = join(initial.root, "research/evidence/artifacts/issued.txt");
    if (kind === "symlink") await symlink(issued, artifact);
    else await link(issued, artifact);
    await writeJson(initial.root, "research/evidence/linked.json", { id: "linked", artifactPath });
    git(initial.root, ["add", "research/evidence/linked.json", artifactPath]);

    expect(() => verifyWithoutApproval(initial.root, initial.base)).toThrow("research evidence artifact path is unsafe");
  });

  it("rejects a parent directory symlink escape even when its tracked leaf is a regular single-link file", async () => {
    const initial = await repository({ decisionEvidenceAtBase: true });
    const escapedRoot = await mkdtemp(join(tmpdir(), "research-artifact-escape-"));
    roots.push(escapedRoot);
    await mkdir(join(escapedRoot, "source-blobs"), { recursive: true });
    await writeFile(join(escapedRoot, "source-blobs", "readme.md"), "pinned source\n");

    const artifactParent = join(initial.root, "research", "evidence", "artifacts", "shopify");
    await rm(artifactParent, { recursive: true, force: true });
    await symlink(escapedRoot, artifactParent);

    expect(() => verifyWithoutApproval(initial.root, initial.base)).toThrow("research evidence artifact path is unsafe");
  });

  it("rejects rewrites and deletion of prior triad, evidence, and artifact blobs", async () => {
    const initial = await repository();
    const first = await addTriad(initial.root, 1, "registry-approved/r01", initial.rootTagObject);
    await writeFile(join(initial.root, "research/sources/source-a.json"), "{\"sourceId\":\"source-a\",\"rewritten\":true}\n");
    expect(() => verify(initial.root, first.head, first.tagObject)).toThrow("issued source, receipt, or snapshot path was rewritten");
    await writeJson(initial.root, "research/sources/source-a.json", { sourceId: "source-a" });
    await writeFile(join(initial.root, "research/evidence/issued.json"), "{\"id\":\"issued\",\"artifactPath\":\"research/evidence/artifacts/issued.txt\",\"rewritten\":true}\n");
    expect(() => verify(initial.root, first.head, first.tagObject)).toThrow("issued evidence record was rewritten");
    await writeJson(initial.root, "research/evidence/issued.json", { id: "issued", artifactPath: "research/evidence/artifacts/issued.txt" });
    await unlink(join(initial.root, "research/evidence/artifacts/issued.txt"));
    expect(() => verify(initial.root, first.head, first.tagObject)).toThrow("issued evidence artifact was deleted or renamed");
  });

  it("rejects a coherent decision manifest, evidence record, and source-asset rewrite after the approved base", async () => {
    const initial = await repository({ decisionEvidenceAtBase: true });
    await writeFile(join(initial.root, "manifests", "decision-candidate-evidence.yaml"), "schemaVersion: 3\ncandidates: [attacker]\nevidence: []\n");
    await writeJson(initial.root, "research/evidence/shopify-source.json", {
      id: "shopify-source",
      artifactPath: "research/evidence/artifacts/shopify/source-blobs/attacker.md"
    });
    await writeFile(join(initial.root, "research/evidence/artifacts/shopify/source-blobs/readme.md"), "attacker source\n");
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("issued evidence record was rewritten");

    await writeJson(initial.root, "research/evidence/shopify-source.json", {
      id: "shopify-source",
      artifactPath: "research/evidence/artifacts/shopify/source-blobs/readme.md"
    });
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("issued evidence artifact was rewritten");

    await writeFile(join(initial.root, "research/evidence/artifacts/shopify/source-blobs/readme.md"), "pinned source\n");
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("issued decision evidence manifest was rewritten");
  });

  it("rejects a synthetic public A/B root that predates the mandatory decision-evidence baseline", async () => {
    const historical = await publicCloneWithoutDecisionEvidence();

    expect(git(historical.root, ["rev-list", "--count", "HEAD"])).toBe("2");
    expect(git(historical.root, ["rev-parse", "public-history/root-v1^{commit}"])).toBe(historical.base);
    expect(() => verifyWithoutApproval(historical.root, historical.base)).toThrow(/required public baseline|rewritten/i);
  });

  it("allows append-only decision additions but rejects duplicate, reorder, reuse, traversal, and orphan bypasses", async () => {
    const initial = await repository({ decisionEvidenceAtBase: true });
    await writeFile(join(initial.root, "manifests", "decision-candidate-evidence.yaml"), [
      "schemaVersion: 3",
      "candidates:",
      "  - id: candidate-a",
      "    capabilities: [capability-a]",
      "  - id: candidate-b",
      "    capabilities: [capability-c]",
      "evidence:",
      "  - id: evidence-a",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
      "  - id: evidence-b",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/added.txt",
      "",
      "officialTargetCompatibilityEvidence:",
      "  - id: compatibility-a",
      "    assetPath: research/evidence/artifacts/compatibility.txt",
      ""
    ].join("\n"));
    await writeFile(join(initial.root, "research/evidence/artifacts/added.txt"), "added\n");
    await writeFile(join(initial.root, "research/evidence/artifacts/compatibility.txt"), "compatibility\n");
    await writeJson(initial.root, "research/evidence/added.json", {
      id: "added",
      artifactPath: "research/evidence/artifacts/added.txt"
    });
    commit(initial.root, "append-decision-evidence");
    tagCurrentBatch(initial.root, 1, "registry-approved/r01", initial.rootTagObject);
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).not.toThrow();

    await writeFile(join(initial.root, "manifests", "decision-candidate-evidence.yaml"), [
      "schemaVersion: 3",
      "candidates:",
      "  - id: candidate-a",
      "    capabilities: [capability-b, capability-a]",
      "evidence:",
      "  - id: evidence-a",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
      ""
    ].join("\n"));
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("issued decision candidate record was rewritten");

    await writeFile(join(initial.root, "manifests", "decision-candidate-evidence.yaml"), [
      "schemaVersion: 3",
      "candidates:",
      "  - id: candidate-a",
      "    capabilities: [capability-a]",
      "  - id: candidate-b",
      "    capabilities: [capability-c]",
      "evidence:",
      "  - id: evidence-a",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
      "  - id: evidence-z",
      "    candidateId: candidate-a",
      "  - id: evidence-b",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/added.txt",
      "",
      "officialTargetCompatibilityEvidence:",
      "  - id: compatibility-a",
      "    assetPath: research/evidence/artifacts/compatibility.txt",
      ""
    ].join("\n"));
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("new decision evidence records must be code-point sorted");

    await writeFile(join(initial.root, "manifests", "decision-candidate-evidence.yaml"), [
      "schemaVersion: 3",
      "candidates:",
      "  - id: candidate-a",
      "    capabilities: [capability-a]",
      "  - id: candidate-b",
      "    capabilities: [capability-c]",
      "evidence:",
      "  - id: evidence-a",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
      "  - id: evidence-b",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/added.txt",
      "",
      "officialTargetCompatibilityEvidence:",
      "  - id: compatibility-a",
      "    assetPath: research/evidence/artifacts/compatibility.txt",
      ""
    ].join("\n"));

    await writeFile(join(initial.root, "manifests", "decision-candidate-evidence.yaml"), [
      "schemaVersion: 3",
      "candidates:",
      "  - id: candidate-a",
      "    capabilities: [capability-a]",
      "  - id: candidate-b",
      "    capabilities: [capability-c]",
      "evidence:",
      "  - id: evidence-a",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
      "  - id: evidence-b",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
      ""
    ].join("\n"));
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("new decision evidence record reuses an issued decision evidence artifact");

    await writeFile(join(initial.root, "manifests", "decision-candidate-evidence.yaml"), [
      "schemaVersion: 3",
      "candidates:",
      "  - id: candidate-a",
      "    capabilities: [capability-a]",
      "  - id: candidate-b",
      "    capabilities: [capability-c]",
      "evidence:",
      "  - id: evidence-a",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
      "  - id: evidence-b",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/added.txt",
      "",
      "officialTargetCompatibilityEvidence:",
      "  - id: compatibility-a",
      "    assetPath: research/evidence/artifacts/compatibility.txt",
      ""
    ].join("\n"));

    await writeJson(initial.root, "research/evidence/reused.json", {
      id: "shopify-source",
      artifactPath: "research/evidence/artifacts/shopify/source-blobs/readme.md"
    });
    git(initial.root, ["add", "research/evidence/reused.json"]);
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("new evidence record reuses an issued evidence id");
    await unlink(join(initial.root, "research/evidence/reused.json"));
    git(initial.root, ["reset", "--", "research/evidence/reused.json"]);

    await writeJson(initial.root, "research/evidence/traversal.json", {
      id: "traversal",
      artifactPath: "research/evidence/artifacts/../issued.txt"
    });
    git(initial.root, ["add", "research/evidence/traversal.json"]);
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("artifact path is unsafe");
    await unlink(join(initial.root, "research/evidence/traversal.json"));
    git(initial.root, ["reset", "--", "research/evidence/traversal.json"]);

    await writeFile(join(initial.root, "research/evidence/artifacts/orphan.txt"), "orphan\n");
    git(initial.root, ["add", "research/evidence/artifacts/orphan.txt"]);
    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).toThrow("research evidence artifact is unreferenced");
  });

  it("rejects every nested or optional-field mutation of issued candidate and evidence records", async () => {
    const initial = await repository({ decisionEvidenceAtBase: true });
    const manifestPath = join(initial.root, "manifests", "decision-candidate-evidence.yaml");
    const original = YAML.parse(await readFile(manifestPath, "utf8")) as {
      candidates: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
    };
    const mutations: Array<[string, (manifest: typeof original) => void]> = [
      ["candidate capability tail", (manifest) => {
        (manifest.candidates[0]!.capabilities as string[]).push("capability-attacker");
      }],
      ["candidate state reasons", (manifest) => { manifest.candidates[0]!.stateReasons = ["approved"]; }],
      ["candidate permissions", (manifest) => {
        manifest.candidates[0]!.permissions = { status: "observed", value: ["shell"], evidence: [] };
      }],
      ["candidate nested source blobs", (manifest) => {
        manifest.candidates[0]!.officialBaseline = {
          sourceBlobs: [{ path: "README.md", contentSha256: "a".repeat(64) }]
        };
      }],
      ["evidence revision binding", (manifest) => {
        manifest.evidence[0]!.candidateRevisionId = "candidate-a-revision-attacker";
      }],
      ["evidence artifact digest", (manifest) => { manifest.evidence[0]!.artifactSha256 = "b".repeat(64); }],
      ["evidence source blob tail", (manifest) => {
        manifest.evidence[0]!.sourceBlobs = [{ path: "README.md", contentSha256: "c".repeat(64) }];
      }]
    ];

    for (const [_label, mutate] of mutations) {
      const changed = structuredClone(original);
      mutate(changed);
      await writeFile(manifestPath, YAML.stringify(changed));
      expect(() => verifyCandidate(initial.root, initial.base, initial.rootTagObject))
        .toThrow(/issued decision (candidate|evidence) record was rewritten/);
    }
  });

  it("rejects array and nested-key additions to issued compatibility records", async () => {
    const initial = await repository({ decisionEvidenceAtBase: true });
    const manifestPath = join(initial.root, "manifests", "decision-candidate-evidence.yaml");
    const manifest = YAML.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.officialTargetCompatibilityEvidence = [{
      id: "compatibility-a",
      candidateId: "candidate-a",
      disclosures: ["baseline"],
      snapshot: { sourceUrl: "https://example.test" }
    }];
    await writeFile(manifestPath, YAML.stringify(manifest));
    const compatibilityBase = commit(initial.root, "append compatibility baseline");
    const approved = tagCurrentBatch(initial.root, 1, "registry-approved/r01", initial.rootTagObject);

    const disclosures = structuredClone(manifest) as {
      officialTargetCompatibilityEvidence: Array<Record<string, unknown>>;
    };
    (disclosures.officialTargetCompatibilityEvidence[0]!.disclosures as string[]).push("attacker");
    await writeFile(manifestPath, YAML.stringify(disclosures));
    expect(() => verifyCandidate(initial.root, compatibilityBase, approved.tagObject))
      .toThrow("issued decision official target compatibility evidence record was rewritten");

    const nested = structuredClone(manifest) as {
      officialTargetCompatibilityEvidence: Array<Record<string, unknown>>;
    };
    (nested.officialTargetCompatibilityEvidence[0]!.snapshot as Record<string, unknown>).digest = "d".repeat(64);
    await writeFile(manifestPath, YAML.stringify(nested));
    expect(() => verifyCandidate(initial.root, compatibilityBase, approved.tagObject))
      .toThrow("issued decision official target compatibility evidence record was rewritten");
  });

  it("authorizes new candidate revisions only from the unchanged base reviewer registry", async () => {
    const authorized = await repository({ decisionEvidenceAtBase: true });
    await writeCandidateRevision(authorized.root, "maintainer");
    expect(() => verifyCandidate(authorized.root, authorized.base, authorized.rootTagObject)).not.toThrow();

    const unauthorized = await repository({ decisionEvidenceAtBase: true });
    await writeCandidateRevision(unauthorized.root, "author");
    expect(() => verifyCandidate(unauthorized.root, unauthorized.base, unauthorized.rootTagObject))
      .toThrow(/base reviewer|approval authority/i);

    const selfGrant = await repository({ decisionEvidenceAtBase: true });
    await writeJson(selfGrant.root, "governance/reviewers.json", {
      schemaVersion: 3,
      reviewers: [
        { id: "maintainer", roles: ["maintainer"] },
        { id: "author", roles: ["source-reviewer", "security-reviewer"] }
      ]
    });
    await writeCandidateRevision(selfGrant.root, "author");
    expect(() => verifyCandidate(selfGrant.root, selfGrant.base, selfGrant.rootTagObject))
      .toThrow(/reviewer registry.*same.*batch|same.*change/i);

    const priorGrant = await repository({ decisionEvidenceAtBase: true });
    await writeJson(priorGrant.root, "governance/reviewers.json", {
      schemaVersion: 3,
      reviewers: [
        { id: "maintainer", roles: ["maintainer"] },
        { id: "author", roles: ["source-reviewer", "security-reviewer"] }
      ]
    });
    const grantedBase = commit(priorGrant.root, "grant reviewer before revision batch");
    await writeCandidateRevision(priorGrant.root, "author");
    expect(() => verifyCandidate(priorGrant.root, grantedBase, priorGrant.rootTagObject)).not.toThrow();
  });

  it("allows a new candidate revision once and rejects rewriting its issued tail", async () => {
    const initial = await repository({ decisionEvidenceAtBase: true });
    const manifestPath = join(initial.root, "manifests", "decision-candidate-evidence.yaml");
    const revisionManifest = [
      "schemaVersion: 3",
      "candidates:",
      "  - id: candidate-a",
      "    capabilities: [capability-a]",
      "candidateRevisions:",
      "  - id: candidate-a-revision-one",
      "    candidateId: candidate-a",
      "    approval: { reviewerId: maintainer }",
      "    evidenceArtifactPath: research/evidence/artifacts/candidate-a-revision-one.json",
      "    marker: original",
      "evidence:",
      "  - id: evidence-a",
      "    candidateId: candidate-a",
      "    artifactPath: research/evidence/artifacts/shopify/source-blobs/readme.md",
      ""
    ].join("\n");
    await writeFile(manifestPath, revisionManifest);
    await writeFile(join(initial.root, "research/evidence/artifacts/candidate-a-revision-one.json"), "revision one\n");
    const firstHead = commit(initial.root, "append candidate revision");
    const first = tagCurrentBatch(initial.root, 1, "registry-approved/r01", initial.rootTagObject);

    expect(() => verify(initial.root, initial.base, initial.rootTagObject)).not.toThrow();

    await writeFile(manifestPath, revisionManifest.replace("marker: original", "marker: rewritten"));
    commit(initial.root, "rewrite candidate revision");
    tagCurrentBatch(initial.root, 2, "registry-approved/research-0001", first.tagObject);

    expect(() => verify(initial.root, firstHead, first.tagObject))
      .toThrow("issued decision candidate revision record was rewritten");
  });

  it("requires approval for evidence-only and context-only research batches", async () => {
    const evidenceOnly = await repository();
    await writeJson(evidenceOnly.root, "research/evidence/added.json", { id: "added", artifactPath: "research/evidence/artifacts/added.txt" });
    await writeFile(join(evidenceOnly.root, "research/evidence/artifacts/added.txt"), "added\n");
    commit(evidenceOnly.root, "evidence-only");
    expect(() => verify(evidenceOnly.root, evidenceOnly.base, evidenceOnly.rootTagObject)).toThrow("missing annotated next");
    tagCurrentBatch(evidenceOnly.root, 1, "registry-approved/r01", evidenceOnly.rootTagObject);
    expect(() => verify(evidenceOnly.root, evidenceOnly.base, evidenceOnly.rootTagObject)).not.toThrow();

    const contextOnly = await repository();
    await writeJson(contextOnly.root, "research/current-evaluation-context.json", {
      ...context(),
      asOf: "2026-07-24T00:00:00Z",
      upstreamObservations: [{ providerId: "provider-a", snapshotId: "snapshot-a", observedAt: "2026-07-24T00:00:00Z", headCommit: "a".repeat(40) }]
    });
    commit(contextOnly.root, "context-only");
    expect(() => verify(contextOnly.root, contextOnly.base, contextOnly.rootTagObject)).toThrow("missing annotated next");
    tagCurrentBatch(contextOnly.root, 1, "registry-approved/r01", contextOnly.rootTagObject);
    expect(() => verify(contextOnly.root, contextOnly.base, contextOnly.rootTagObject)).not.toThrow();
  });

  it("allows a code-only descendant of the immediate approved predecessor", async () => {
    const initial = await repository();
    await mkdir(join(initial.root, "notes"), { recursive: true });
    await writeFile(join(initial.root, "notes", "untagged.txt"), "untagged predecessor\n");
    const untaggedBase = commit(initial.root, "untagged-predecessor");
    await writeJson(initial.root, "research/evidence/added.json", {
      id: "added",
      artifactPath: "research/evidence/artifacts/added.txt"
    });
    await writeFile(join(initial.root, "research/evidence/artifacts/added.txt"), "added\n");
    commit(initial.root, "approved-batch-from-untagged-base");

    expect(() => verifyWithoutApproval(initial.root, untaggedBase)).toThrow("APPROVED_REGISTRY_TAG_OBJECT");
    tagCurrentBatch(initial.root, 1, "registry-approved/r01", initial.rootTagObject);
    expect(() => verify(initial.root, untaggedBase, initial.rootTagObject)).not.toThrow();
  });

  it("rejects protected research changes in a predecessor descendant event base", async () => {
    const initial = await repository();
    await writeJson(initial.root, "research/review-queue.json", { candidates: [], capabilitySearch: [] });
    const unapprovedBase = commit(initial.root, "unapproved-research-descendant");
    await writeJson(initial.root, "research/evidence/added.json", {
      id: "added",
      artifactPath: "research/evidence/artifacts/added.txt"
    });
    await writeFile(join(initial.root, "research/evidence/artifacts/added.txt"), "added\n");
    commit(initial.root, "approved-batch-after-unapproved-descendant");
    tagCurrentBatch(initial.root, 1, "registry-approved/r01", initial.rootTagObject);

    expect(() => verify(initial.root, unapprovedBase, initial.rootTagObject))
      .toThrow("predecessor descendants cannot change protected research batch surfaces");
  });

  it.each([
    ["review queue", "research/review-queue.json", { candidates: [], capabilitySearch: [] }],
    ["provider registry", "manifests/complete-v1-providers/provider-a.json", { id: "provider-a" }],
    ["source reviews", "manifests/source-reviews/review-a.json", { id: "review-a" }],
    ["conflicts", "manifests/conflicts/conflict-a.json", { id: "conflict-a" }],
    ["provider selections", "manifests/provider-selections/selection-a.json", { id: "selection-a" }],
    ["extension index", "research/review-source-extensions.json", { schemaVersion: 2, triads: [{ sourceId: "source-a", receiptId: "receipt-a", snapshotId: "snapshot-a" }] }],
    ["evidence", "research/evidence/added.json", { id: "added" }],
    ["current context", "research/current-evaluation-context.json", { ...context(), asOf: "2026-07-24T00:00:00Z" }]
  ])("requires protected approval for an untagged %s batch", async (_surface, path, value) => {
    const initial = await repository();
    await writeJson(initial.root, path, value);
    commit(initial.root, `mutate-${String(_surface)}`);

    expect(() => verifyWithoutApproval(initial.root, initial.base)).toThrow("APPROVED_REGISTRY_TAG_OBJECT");
  });

  it("rejects observation mutation or order regressions and moved tags without a triad addition", async () => {
    const observation = await repository();
    await writeJson(observation.root, "research/current-evaluation-context.json", {
      ...context(),
      upstreamObservations: [
        { providerId: "provider-b", snapshotId: "snapshot-b", observedAt: "2026-07-25T00:00:00Z", headCommit: "b".repeat(40) },
        { providerId: "provider-a", snapshotId: "snapshot-a", observedAt: "2026-07-24T00:00:00Z", headCommit: "a".repeat(40) }
      ]
    });
    expect(() => verify(observation.root, observation.base, observation.rootTagObject)).toThrow("strictly ordered");

    const moved = await repository();
    const first = await addTriad(moved.root, 1, "registry-approved/r01", moved.rootTagObject);
    git(moved.root, ["tag", "-fa", "registry-approved/research-0001", "-m", "moved"]);
    await addTriad(moved.root, 2, "registry-approved/research-0001", first.tagObject);
    expect(() => verify(moved.root, first.head, first.tagObject)).toThrow("protected approved registry tag object");
  });

  it("rejects lightweight, skipped, stale, forked, moved, and wrong approval tags", async () => {
    const lightweight = await repository();
    await addTriad(lightweight.root, 1, "registry-approved/r01", lightweight.rootTagObject, { lightweight: true });
    expect(() => verify(lightweight.root, lightweight.base, lightweight.rootTagObject)).toThrow("must be annotated");

    const skipped = await repository();
    await addTriad(skipped.root, 3, "registry-approved/r01", skipped.rootTagObject);
    expect(() => verify(skipped.root, skipped.base, skipped.rootTagObject)).toThrow("sequence");

    const stale = await repository();
    const first = await addTriad(stale.root, 1, "registry-approved/r01", stale.rootTagObject);
    await addTriad(stale.root, 2, "registry-approved/research-0001", first.tagObject);
    expect(() => verify(stale.root, stale.base, stale.rootTagObject)).toThrow("stale");

    const forked = await repository();
    const forkFirst = await addTriad(forked.root, 1, "registry-approved/r01", forked.rootTagObject);
    await addTriad(forked.root, 2, "registry-approved/research-0001", forkFirst.tagObject);
    git(forked.root, ["tag", "-a", "registry-approved/research-fork", "-m", "fork"]);
    expect(() => verify(forked.root, forkFirst.head, forkFirst.tagObject)).toThrow("invalid approved registry tag name");

    const moved = await repository();
    const movedFirst = await addTriad(moved.root, 1, "registry-approved/r01", moved.rootTagObject);
    await addTriad(moved.root, 2, "registry-approved/research-0001", movedFirst.tagObject);
    git(moved.root, ["tag", "-fa", "registry-approved/research-0001", "-m", "moved"]);
    expect(() => verify(moved.root, movedFirst.head, movedFirst.tagObject)).toThrow("protected approved registry tag object");

    const wrong = await repository();
    await addTriad(wrong.root, 1, "registry-approved/r01", wrong.rootTagObject);
    expect(() => verify(wrong.root, wrong.base, "f".repeat(40))).toThrow("protected approved registry tag object");
    expect(() => verify(wrong.root, "0".repeat(40), wrong.rootTagObject)).toThrow("--base must be an ancestor");
  }, 15_000);
});
