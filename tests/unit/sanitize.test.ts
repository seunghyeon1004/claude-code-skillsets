import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as sanitizerModule from "../../src/evaluate/sanitize.js";

const {
  sanitizeReceiptTree,
  verifySanitizedReceiptTree
} = sanitizerModule;
const sanitizeReceiptValue = (
  sanitizerModule as unknown as { sanitizeReceiptValue(value: unknown): unknown }
).sanitizeReceiptValue;

const temporaryDirectories: string[] = [];

const sensitiveObjectKeys = [
  "password",
  "passwd",
  "passphrase",
  "apiKey",
  "API key",
  "api_key",
  "api-key",
  "apikey",
  "privateKey",
  "private_key",
  "private-key",
  "cookie",
  "session",
  "authorization",
  "credential",
  "secret",
  "token",
  "oauth",
  "env",
  "header"
] as const;

const sensitiveFreeText = [
  ['"API key" = "api key value 7Q2"', "api key value 7Q2"],
  ["'private-key': 'private key value 8R3'", "private key value 8R3"],
  ["PassPhrase = passphrase-value-9S4", "passphrase-value-9S4"],
  ["passwd:passwd-value-1T5", "passwd-value-1T5"],
  ["Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA=="],
  ["AUTHORIZATION = Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature", "eyJhbGciOiJIUzI1NiJ9.payload.signature"],
  ["authorization: Custom opaque-value-2U6", "Custom opaque-value-2U6"]
] as const;

const requiredBranchProtectionChecks = ["claude-plugin-validation", "quality"] as const;
const requiredCheckBindings = requiredBranchProtectionChecks.map((name) => ({
  name,
  app: { id: 15368, slug: "github-actions" }
}));
const rawBranchProtectionRepositoryEvidence = {
  repository: "seunghyeon1004/claude-code-skillsets",
  repositoryId: 1322344258,
  repositoryOwnerLogin: "seunghyeon1004",
  repositoryOwnerType: "User" as const,
  commitSha: "f".repeat(40)
};
const unsafeBranchProtectionChecks = [
  "Bearer ghp_private_branch_protection_token",
  "actor: private-maintainer",
  "Authorization: Bearer private-header-value",
  "eyJ0b2tlbiI6InByaXZhdGUtYmFzZTY0LXZhbHVlIn0=",
  "{\"token\":\"private-raw-json-value\"}"
] as const;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("semantic receipt sanitization", () => {
  it("replaces every sensitive object-key value as one redacted scalar", () => {
    expect(sanitizeReceiptValue).toBeTypeOf("function");
    const input = Object.fromEntries(sensitiveObjectKeys.map((key, index) => [
      key,
      index % 2 === 0 ? { nested: `value-${index}` } : [`value-${index}`]
    ]));

    expect(sanitizeReceiptValue(input)).toEqual(
      Object.fromEntries(sensitiveObjectKeys.map((key) => [key, "[redacted]"]))
    );
  });

  it.each(sensitiveFreeText)(
    "redacts flexible free-text credential label %#",
    (text, leakedValue) => {
      expect(sanitizeReceiptValue).toBeTypeOf("function");
      const output = sanitizeReceiptValue(`before ${text}; after`);
      expect(output).toContain("[redacted]");
      expect(output).not.toContain(leakedValue);
    }
  );

  it("independently rejects non-redacted sensitive keys in nested objects and arrays", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, "unsafe.json"), JSON.stringify({
      schemaVersion: 1,
      receiptType: "case",
      caseId: "safe-case",
      caseType: "normal",
      passed: true,
      counts: {
        expectedBehaviors: 1,
        expectedBehaviorsPassed: 1,
        forbiddenBehaviors: 0,
        forbiddenBehaviorsPassed: 0,
        errors: 0
      },
      nested: [{ apiKey: "not-redacted" }, [{ session: { id: "nested" } }]]
    }));

    await expect(verifySanitizedReceiptTree(directory)).rejects.toThrow(
      /sensitive receipt key.*apiKey/i
    );
  });

  it.each(["", null, { value: "[redacted]" }, ["[redacted]"], "[REDACTED]", "[redacted] "])(
    "requires a sensitive key value to be exactly [redacted] (%#)",
    async (value) => {
      const directory = await makeTemporaryDirectory();
      await writeFile(join(directory, "unsafe.json"), JSON.stringify({
        schemaVersion: 1,
        receiptType: "case",
        caseId: "safe-case",
        caseType: "normal",
        passed: true,
        counts: {
          expectedBehaviors: 0,
          expectedBehaviorsPassed: 0,
          forbiddenBehaviors: 0,
          forbiddenBehaviorsPassed: 0,
          errors: 0
        },
        metadata: [{ private_key: value }]
      }));

      await expect(verifySanitizedReceiptTree(directory)).rejects.toThrow(
        /sensitive receipt key.*private_key/i
      );
    }
  );

  it.each(sensitiveFreeText)(
    "independently rejects flexible free-text credential label %#",
    async (text) => {
      const directory = await makeTemporaryDirectory();
      await writeFile(join(directory, "unsafe.json"), JSON.stringify({
        schemaVersion: 1,
        receiptType: "case",
        caseId: text,
        caseType: "normal",
        passed: true,
        counts: {
          expectedBehaviors: 0,
          expectedBehaviorsPassed: 0,
          forbiddenBehaviors: 0,
          forbiddenBehaviorsPassed: 0,
          errors: 0
        }
      }));

      await expect(verifySanitizedReceiptTree(directory)).rejects.toThrow(
        /unsafe sanitized receipt content/i
      );
    }
  );

  it("projects a setup or doctor case to the exact upload-safe shape", async () => {
    const { source, destination } = await receiptDirectories();
    await writeFile(join(source, "setup-normal.json"), JSON.stringify({
      schemaVersion: 1,
      caseId: "setup-normal",
      caseType: "normal",
      passed: false,
      response: "raw model response Authorization: Bearer secret-value",
      trustedRead: {
        path: "/Users/alice/private/install-index.json",
        expectedStatus: "success",
        observedStatus: "success"
      },
      expectedBehaviors: [
        { behavior: "first rubric", passed: true, evidence: "raw evidence", reason: "raw reason" },
        { behavior: "second rubric", passed: false, evidence: "more evidence", reason: "more reason" }
      ],
      forbiddenBehaviors: [
        { behavior: "forbidden rubric", passed: true, evidence: "raw forbidden evidence", reason: "raw forbidden reason" }
      ],
      errors: ["raw evaluator error"]
    }));

    await sanitizeReceiptTree(source, destination);

    expect(await readJson(join(destination, "setup-normal.json"))).toEqual({
      schemaVersion: 1,
      receiptType: "case",
      caseId: "setup-normal",
      caseType: "normal",
      passed: false,
      counts: {
        expectedBehaviors: 2,
        expectedBehaviorsPassed: 1,
        forbiddenBehaviors: 1,
        forbiddenBehaviorsPassed: 1,
        errors: 1
      }
    });
    const output = await readFile(join(destination, "setup-normal.json"), "utf8");
    expect(output).not.toMatch(/raw model response|raw evidence|raw reason|raw evaluator error/i);
    await expect(verifySanitizedReceiptTree(destination)).resolves.toBeUndefined();
  });

  it("projects a shared-core case to the exact upload-safe shape", async () => {
    const { source, destination } = await receiptDirectories();
    await writeFile(join(source, "shared-case.json"), JSON.stringify({
      schemaVersion: 1,
      key: "workflow-router--01-normal",
      caseId: "shared-normal",
      skillId: "workflow-router",
      caseType: "normal",
      passed: true,
      response: "raw shared-core response",
      expectedBehaviors: [
        { behavior: "expected", passed: true, evidence: "evidence", reason: "reason" }
      ],
      forbiddenBehaviors: [],
      errors: []
    }));

    await sanitizeReceiptTree(source, destination);

    expect(await readJson(join(destination, "shared-case.json"))).toEqual({
      schemaVersion: 1,
      receiptType: "case",
      key: "workflow-router--01-normal",
      caseId: "shared-normal",
      skillId: "workflow-router",
      caseType: "normal",
      passed: true,
      counts: {
        expectedBehaviors: 1,
        expectedBehaviorsPassed: 1,
        forbiddenBehaviors: 0,
        forbiddenBehaviorsPassed: 0,
        errors: 0
      }
    });
  });

  it("projects evaluator summaries to exact IDs, types, booleans, and counts", async () => {
    const { source, destination } = await receiptDirectories();
    await writeFile(join(source, "summary.json"), JSON.stringify({
      schemaVersion: 1,
      passed: false,
      outputDirectory: "/Users/alice/private/raw/setup",
      cases: [
        {
          caseId: "setup-normal",
          caseType: "normal",
          passed: true,
          receiptPath: "/Users/alice/private/raw/setup/setup-normal.json"
        },
        {
          caseId: "setup-boundary",
          caseType: "boundary",
          passed: false,
          receiptPath: "/Users/alice/private/raw/setup/setup-boundary.json"
        }
      ]
    }));

    await sanitizeReceiptTree(source, destination);

    expect(await readJson(join(destination, "summary.json"))).toEqual({
      schemaVersion: 1,
      receiptType: "summary",
      passed: false,
      cases: [
        { caseId: "setup-normal", caseType: "normal", passed: true },
        { caseId: "setup-boundary", caseType: "boundary", passed: false }
      ],
      counts: { cases: 2, casesPassed: 1 }
    });
    const output = await readFile(join(destination, "summary.json"), "utf8");
    expect(output).not.toContain("/Users/alice");
  });

  it("rejects hand-crafted upload JSON with fields outside the projection", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, "unsafe.json"), JSON.stringify({
      schemaVersion: 1,
      receiptType: "case",
      caseId: "safe-case",
      caseType: "normal",
      passed: true,
      counts: {
        expectedBehaviors: 0,
        expectedBehaviorsPassed: 0,
        forbiddenBehaviors: 0,
        forbiddenBehaviorsPassed: 0,
        errors: 0
      },
      response: "clean-looking but raw model response"
    }));

    await expect(verifySanitizedReceiptTree(directory)).rejects.toThrow(
      /unsupported sanitized receipt shape/i
    );
  });

  it("rejects non-JSON files from the upload tree", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, "debug.log"), "credential=must-not-upload\n");

    await expect(verifySanitizedReceiptTree(directory)).rejects.toThrow(
      /unsupported entry in sanitized receipt tree/i
    );
  });

  it.each(unsafeBranchProtectionChecks)(
    "rejects secret-shaped required check %# during sanitization and independent verification",
    async (unsafeCheck) => {
      const { source, destination } = await receiptDirectories();
      const receipt = {
        schemaVersion: 3,
        ...rawBranchProtectionRepositoryEvidence,
        directPushesDisabled: true,
        forcePushesDisabled: true,
        deletionsDisabled: true,
        requiredSignaturesEnabled: false,
        requiredChecks: [requiredCheckBindings[0], { name: unsafeCheck, app: { id: 15368, slug: "github-actions" } }],
        minimumApprovals: 0,
        dismissesStaleReviews: true,
        requiresCodeOwnerReview: false,
        governanceMode: "solo-maintainer",
        humanReviewGuarantee: "not-guaranteed"
      };
      await writeFile(join(source, "branch-protection.json"), JSON.stringify(receipt));

      await expect(sanitizeReceiptTree(source, destination)).rejects.toThrow();
      await expect(readdir(destination)).resolves.toEqual([]);

      await writeFile(join(destination, "branch-protection.json"), JSON.stringify({
        ...sanitizedBranchProtectionReceipt(receipt)
      }));
      await expect(verifySanitizedReceiptTree(destination)).rejects.toThrow();
    }
  );

  it("rejects missing, extra, unrecognized, malformed, and non-canonical branch protection checks", async () => {
    const invalidChecks: unknown[] = [
      requiredCheckBindings.slice(0, 1),
      [...requiredCheckBindings, { name: "extra-check", app: { id: 15368, slug: "github-actions" } }],
      [{ name: "unknown-check", app: { id: 15368, slug: "github-actions" } }, requiredCheckBindings[1]],
      [...requiredCheckBindings].reverse(),
      [{ name: "claude-plugin-validation", app: { id: 42, slug: "github-actions" } }, requiredCheckBindings[1]],
      [{ name: "claude-plugin-validation", app: { id: 15368, slug: "lookalike-ci" } }, requiredCheckBindings[1]],
      [requiredCheckBindings[0], 42],
      "claude-plugin-validation,quality"
    ];

    for (const requiredChecks of invalidChecks) {
      const { source, destination } = await receiptDirectories();
      const receipt = {
        schemaVersion: 3,
        ...rawBranchProtectionRepositoryEvidence,
        directPushesDisabled: true,
        forcePushesDisabled: true,
        deletionsDisabled: true,
        requiredSignaturesEnabled: false,
        requiredChecks,
        minimumApprovals: 0,
        dismissesStaleReviews: true,
        requiresCodeOwnerReview: false,
        governanceMode: "solo-maintainer",
        humanReviewGuarantee: "not-guaranteed"
      };
      await writeFile(join(source, "branch-protection.json"), JSON.stringify(receipt));

      await expect(sanitizeReceiptTree(source, destination)).rejects.toThrow();
      await writeFile(join(destination, "branch-protection.json"), JSON.stringify({
        ...sanitizedBranchProtectionReceipt(receipt)
      }));
      await expect(verifySanitizedReceiptTree(destination)).rejects.toThrow();
    }
  });

  it("preserves only the fully enforced sole-maintainer branch protection policy", async () => {
    const { source, destination } = await receiptDirectories();
    const receipt = {
      schemaVersion: 3,
      ...rawBranchProtectionRepositoryEvidence,
      directPushesDisabled: true,
      forcePushesDisabled: true,
      deletionsDisabled: true,
      requiredSignaturesEnabled: false,
      requiredChecks: requiredCheckBindings,
      minimumApprovals: 0,
      dismissesStaleReviews: true,
      requiresCodeOwnerReview: false,
      governanceMode: "solo-maintainer",
      humanReviewGuarantee: "not-guaranteed"
    };
    await writeFile(join(source, "branch-protection.json"), JSON.stringify(receipt));
    await sanitizeReceiptTree(source, destination);
    await expect(readJson(join(destination, "branch-protection.json"))).resolves.toEqual(
      sanitizedBranchProtectionReceipt(receipt)
    );

    for (const unsafe of [
      { directPushesDisabled: false },
      { forcePushesDisabled: false },
      { deletionsDisabled: false },
      { requiredSignaturesEnabled: true },
      { minimumApprovals: 1 },
      { dismissesStaleReviews: false },
      { requiresCodeOwnerReview: true },
      { governanceMode: "collaborative-review" },
      { humanReviewGuarantee: "guaranteed" }
    ]) {
      await writeFile(join(source, "branch-protection.json"), JSON.stringify({ ...receipt, ...unsafe }));
      await expect(sanitizeReceiptTree(source, destination)).rejects.toThrow();
    }
  });

  it("preserves and independently validates the local read-only semantic RC target", async () => {
    const { source, destination } = await receiptDirectories();
    const receipt = {
      schemaVersion: 6,
      receiptType: "local-semantic-rc-target",
      commitSha: "a".repeat(40),
      routingIndexPath: "plugins/skillset-manager/data/routing-index.json",
      routingIndexByteLength: 10_081,
      routingIndexBytesSha256: "b".repeat(64),
      routingIndexDigest: "c".repeat(64),
      routingDecisionIndexDigest: "d".repeat(64),
      catalogVersion: "f".repeat(64),
      catalogObservedThrough: "2026-08-03T02:30:05Z",
      catalogExpiresAt: "2026-08-12T02:30:05Z",
      decisionIndexDigest: "d".repeat(64),
      decisionIndexByteLength: 489_808,
      decisionIndexBytesSha256: "e".repeat(64),
      subscriptionAuthMode: "claude.ai",
      semanticHarnessStatus: "passed",
      executableAvailability: "none",
      executionMode: "subscription-claude-cli-fixture-read-only",
      humanReviewGuarantee: "not-guaranteed"
    };
    await writeFile(join(source, "local-semantic-rc-target.json"), JSON.stringify(receipt));
    await sanitizeReceiptTree(source, destination);
    await expect(readJson(join(destination, "local-semantic-rc-target.json"))).resolves.toEqual(receipt);

    await writeFile(join(destination, "local-semantic-rc-target.json"), JSON.stringify({
      ...receipt,
      humanReviewGuarantee: "guaranteed"
    }));
    await expect(verifySanitizedReceiptTree(destination)).rejects.toThrow();

    for (const invalid of [
      { routingIndexPath: "generated/routing-index.json" },
      { routingIndexByteLength: 0 },
      { routingIndexByteLength: 128 * 1024 + 1 },
      { routingIndexBytesSha256: "not-a-digest" },
      { routingIndexDigest: "not-a-digest" },
      { routingDecisionIndexDigest: "f".repeat(64) },
      { catalogVersion: "not-a-digest" },
      { catalogObservedThrough: "not-a-timestamp" },
      { catalogExpiresAt: "2026-08-03T02:30:05Z" },
      { decisionIndexDigest: "f".repeat(64) },
      { decisionIndexByteLength: 0 },
      { decisionIndexBytesSha256: "not-a-digest" },
      { subscriptionAuthMode: "api-key" },
      { semanticHarnessStatus: "not-run" },
      { executableAvailability: "unknown" },
      { extra: "not allowed" }
    ]) {
      const { source: invalidSource, destination: invalidDestination } = await receiptDirectories();
      await writeFile(join(invalidSource, "local-semantic-rc-target.json"), JSON.stringify({
        ...receipt,
        ...invalid
      }));
      await expect(sanitizeReceiptTree(invalidSource, invalidDestination)).rejects.toThrow();
    }
  });

  it("rejects a preexisting destination tree without deleting or truncating it", async () => {
    const { source, destination } = await receiptDirectories();
    await writeFile(join(source, "summary.json"), JSON.stringify({
      schemaVersion: 1,
      passed: true,
      outputDirectory: "/private/tmp/raw",
      cases: []
    }));
    await mkdir(destination);
    await writeFile(join(destination, "stale.log"), "credential=left-over-secret\n");

    await expect(sanitizeReceiptTree(source, destination)).rejects.toThrow(/output directory.*exist|destination.*exist|must not exist/i);
    await expect(readdir(destination)).resolves.toEqual(["stale.log"]);
    await expect(readFile(join(destination, "stale.log"), "utf8"))
      .resolves.toBe("credential=left-over-secret\n");
  });

  it("rejects a symlink destination ancestor without writing through it", async () => {
    const root = await makeTemporaryDirectory();
    const source = join(root, "raw");
    const outside = join(root, "outside");
    const linked = join(root, "linked");
    await Promise.all([mkdir(source), mkdir(outside)]);
    await writeFile(join(source, "summary.json"), JSON.stringify({
      schemaVersion: 1,
      passed: true,
      outputDirectory: "/private/tmp/raw",
      cases: []
    }));
    await writeFile(join(outside, "keep.txt"), "keep\n");
    await symlink(outside, linked);

    await expect(sanitizeReceiptTree(source, join(linked, "sanitized")))
      .rejects.toThrow(/symbolic link|symlink/i);
    await expect(readFile(join(outside, "keep.txt"), "utf8")).resolves.toBe("keep\n");
  });

  it("rejects a destination inside the source tree before creating it", async () => {
    const root = await makeTemporaryDirectory();
    const source = join(root, "raw");
    const destination = join(source, "sanitized");
    await mkdir(source);
    await writeFile(join(source, "summary.json"), JSON.stringify({
      schemaVersion: 1,
      passed: true,
      outputDirectory: "/private/tmp/raw",
      cases: []
    }));

    await expect(sanitizeReceiptTree(source, destination)).rejects.toThrow(/inside|descendant|source tree/i);
    await expect(readdir(source)).resolves.toEqual(["summary.json"]);
  });
});

async function receiptDirectories(): Promise<{ source: string; destination: string }> {
  const root = await makeTemporaryDirectory();
  const source = join(root, "raw");
  const destination = join(root, "sanitized");
  await mkdir(source);
  return { source, destination };
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "receipt-sanitizer-")));
  temporaryDirectories.push(directory);
  return directory;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function sanitizedBranchProtectionReceipt(receipt: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 3,
    receiptType: "branch-protection",
    repositoryId: receipt.repositoryId,
    repositoryOwnerType: receipt.repositoryOwnerType,
    commitSha: receipt.commitSha,
    directPushesDisabled: receipt.directPushesDisabled,
    forcePushesDisabled: receipt.forcePushesDisabled,
    deletionsDisabled: receipt.deletionsDisabled,
    requiredSignaturesEnabled: receipt.requiredSignaturesEnabled,
    requiredChecks: receipt.requiredChecks,
    minimumApprovals: receipt.minimumApprovals,
    dismissesStaleReviews: receipt.dismissesStaleReviews,
    requiresCodeOwnerReview: receipt.requiresCodeOwnerReview,
    governanceMode: receipt.governanceMode,
    humanReviewGuarantee: receipt.humanReviewGuarantee
  };
}
