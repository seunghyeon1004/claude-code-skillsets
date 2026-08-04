import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  githubApiGetArgs,
  receiptFromGitHubProtection,
  repositoryMetadataFromGitHubResponse,
  repositoryTipFromGitHubResponse,
  verifyDisabledRequiredSignaturesProbe,
  verifyGitHubProtectionResponse,
  verifyBranchProtection,
  writeBranchProtectionReceipt
} from "../../scripts/github/verify-branch-protection.js";
import type { BranchProtectionReceipt } from "../../src/model/review-ledger.js";

const compliantReceipt: BranchProtectionReceipt = {
  schemaVersion: 3,
  repository: "seunghyeon1004/claude-code-skillsets",
  repositoryId: 1322344258,
  repositoryOwnerLogin: "seunghyeon1004",
  repositoryOwnerType: "User",
  commitSha: "f".repeat(40),
  branch: "main",
  observedAt: "2026-07-29T00:00:00Z",
  directPushesDisabled: true,
  forcePushesDisabled: true,
  deletionsDisabled: true,
  requiredChecks: [
    { name: "claude-plugin-validation", app: { id: 15368, slug: "github-actions" } },
    { name: "quality", app: { id: 15368, slug: "github-actions" } }
  ],
  minimumApprovals: 0,
  dismissesStaleReviews: true,
  requiresCodeOwnerReview: false,
  governanceMode: "solo-maintainer",
  humanReviewGuarantee: "not-guaranteed"
};
const temporaryRoots: string[] = [];
const personalRepositoryMetadata = {
  repositoryId: 1322344258,
  repositoryFullName: compliantReceipt.repository,
  repositoryOwnerLogin: "seunghyeon1004",
  repositoryOwnerType: "User" as const
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("branch protection", () => {
  it("accepts the honest sole-maintainer policy with PR-only writes and no human-review guarantee", () => {
    expect(verifyBranchProtection(compliantReceipt)).toEqual(compliantReceipt);
  });

  it("requires complete repository and exact candidate identity in every raw v3 receipt", () => {
    for (const key of [
      "repositoryId",
      "repositoryOwnerLogin",
      "repositoryOwnerType",
      "commitSha"
    ] as const) {
      expect(() => verifyBranchProtection(withoutKey({ ...compliantReceipt }, key)), key).toThrow(/required/i);
    }
  });

  it("uses the pinned GitHub API contract and validates exact main ref responses", () => {
    expect(githubApiGetArgs("repos/example/project")).toEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      "X-GitHub-Api-Version: 2026-03-10",
      "repos/example/project"
    ]);
    expect(repositoryTipFromGitHubResponse({
      response: { object: { type: "commit", sha: compliantReceipt.commitSha } },
      expectedTip: compliantReceipt.commitSha
    })).toBe(compliantReceipt.commitSha);
    expect(() => repositoryTipFromGitHubResponse({
      response: { object: { type: "commit", sha: "e".repeat(40) } },
      expectedTip: compliantReceipt.commitSha
    })).toThrow(/main|tip|SHA/i);
    expect(verifyDisabledRequiredSignaturesProbe({
      exitStatus: 1,
      output: "HTTP/2.0 404 Not Found\ncontent-type: application/json\n"
    })).toBeUndefined();
    for (const probe of [
      { exitStatus: 0, output: "HTTP/2.0 200 OK\n" },
      { exitStatus: 1, output: "HTTP/2.0 403 Forbidden\n" },
      { exitStatus: 1, output: "network failure" }
    ]) expect(() => verifyDisabledRequiredSignaturesProbe(probe)).toThrow(/signed commits|signature/i);
  });

  it("rejects a missing write protection, CI binding, or honest sole-maintainer disclosure", () => {
    expect(() => verifyBranchProtection({ ...compliantReceipt, directPushesDisabled: false })).toThrow(/direct push/i);
    expect(() => verifyBranchProtection({ ...compliantReceipt, requiredChecks: compliantReceipt.requiredChecks.slice(1) })).toThrow(/required checks/i);
    expect(() => verifyBranchProtection({ ...compliantReceipt, minimumApprovals: 1 })).toThrow(/approval/i);
    expect(() => verifyBranchProtection({ ...compliantReceipt, dismissesStaleReviews: false })).toThrow(/stale/i);
    expect(() => verifyBranchProtection({ ...compliantReceipt, requiresCodeOwnerReview: true })).toThrow(/CODEOWNERS/i);
    expect(() => verifyBranchProtection({ ...compliantReceipt, humanReviewGuarantee: "guaranteed" as never }))
      .toThrow(/humanReviewGuarantee|human review/i);
  });

  it("rejects non-RFC3339 and locale receipt timestamps", () => {
    expect(() => verifyBranchProtection({ ...compliantReceipt, observedAt: "not-a-date" })).toThrow(/date-time|RFC3339/i);
    expect(() => verifyBranchProtection({ ...compliantReceipt, observedAt: "July 29, 2026 00:00 UTC" })).toThrow(/date-time|RFC3339/i);
  });

  it("fails closed when the GitHub response permits a pull-request bypass", () => {
    const receipt = receiptFromGitHubProtection({
      repository: organizationRepositoryMetadata().repositoryFullName,
      repositoryMetadata: organizationRepositoryMetadata(),
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: {
        enforce_admins: { enabled: true },
        required_status_checks: { checks: githubChecks() },
        required_pull_request_reviews: {
          require_code_owner_reviews: false,
          required_approving_review_count: 0,
          dismiss_stale_reviews: true,
          bypass_pull_request_allowances: { users: ["maintainer"], teams: [], apps: [] }
        }
      }
    });

    expect(receipt.directPushesDisabled).toBe(false);
  });

  it("fails closed when the GitHub response permits force pushes", () => {
    const receipt = receiptFromGitHubProtection({
      repository: organizationRepositoryMetadata().repositoryFullName,
      repositoryMetadata: organizationRepositoryMetadata(),
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: {
        enforce_admins: { enabled: true },
        required_status_checks: { checks: githubChecks() },
        required_pull_request_reviews: {
          require_code_owner_reviews: false,
          required_approving_review_count: 0,
          dismiss_stale_reviews: true,
          bypass_pull_request_allowances: { users: [], teams: [], apps: [] }
        },
        allow_force_pushes: { enabled: true },
        allow_deletions: { enabled: false }
      }
    });

    expect(receipt).toMatchObject({ forcePushesDisabled: false });
    expect(() => verifyBranchProtection(receipt)).toThrow(/force push/i);
  });

  it("fails closed when the GitHub response permits branch deletion", () => {
    const receipt = receiptFromGitHubProtection({
      repository: organizationRepositoryMetadata().repositoryFullName,
      repositoryMetadata: organizationRepositoryMetadata(),
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: {
        enforce_admins: { enabled: true },
        required_status_checks: { checks: githubChecks() },
        required_pull_request_reviews: {
          require_code_owner_reviews: false,
          required_approving_review_count: 0,
          dismiss_stale_reviews: true,
          bypass_pull_request_allowances: { users: [], teams: [], apps: [] }
        },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: true }
      }
    });

    expect(receipt).toMatchObject({ deletionsDisabled: false });
    expect(() => verifyBranchProtection(receipt)).toThrow(/deletion/i);
  });

  it("rejects contexts-only and non-GitHub-Actions required checks", () => {
    const base = {
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {
        require_code_owner_reviews: false,
        required_approving_review_count: 0,
        dismiss_stale_reviews: true,
        bypass_pull_request_allowances: { users: [], teams: [], apps: [] }
      },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false }
    };
    for (const required_status_checks of [
      { contexts: ["claude-plugin-validation", "quality"] },
      { checks: githubChecks().map((check) => ({ ...check, app_id: 42 })) }
    ]) {
      const receipt = receiptFromGitHubProtection({
        repository: organizationRepositoryMetadata().repositoryFullName,
        repositoryMetadata: organizationRepositoryMetadata(),
        expectedTip: compliantReceipt.commitSha,
        branch: compliantReceipt.branch,
        observedAt: compliantReceipt.observedAt,
        protection: { ...base, required_status_checks }
      });
      expect(() => verifyBranchProtection(receipt)).toThrow(/GitHub Actions|producer|required check/i);
    }
  });

  it("accepts absent bypass allowances only for a personal repository", () => {
    const personal = receiptFromGitHubProtection({
      repository: compliantReceipt.repository,
      repositoryMetadata: personalRepositoryMetadata,
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ includeBypassAllowances: false })
    });
    const organization = receiptFromGitHubProtection({
      repository: "example-org/private-broker",
      repositoryMetadata: organizationRepositoryMetadata(),
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ includeBypassAllowances: false })
    });

    expect(personal.directPushesDisabled).toBe(true);
    expect(organization.directPushesDisabled).toBe(false);
  });

  it("validates every live raw protection control before issuing a receipt", () => {
    expect(verifyGitHubProtectionResponse({
      repository: compliantReceipt.repository,
      repositoryMetadata: personalRepositoryMetadata,
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ includeBypassAllowances: false })
    })).toEqual({
      ...compliantReceipt,
      repositoryId: personalRepositoryMetadata.repositoryId,
      repositoryOwnerLogin: personalRepositoryMetadata.repositoryOwnerLogin,
      repositoryOwnerType: personalRepositoryMetadata.repositoryOwnerType
    });

    const exactPolicyDriftVariants: Array<[string, unknown]> = [
      ["strict", githubProtection({ requiredStatusChecks: { strict: false, checks: githubChecks() } })],
      ["required contexts", githubProtection({
        requiredStatusChecks: { strict: true, contexts: ["quality"], checks: githubChecks() }
      })],
      ["last push", githubProtection({ pullRequestOverrides: { require_last_push_approval: true } })],
      ["restrictions", githubProtection({ restrictions: {} })],
      ["linear history", githubProtection({ required_linear_history: { enabled: true } })],
      ["block creations", githubProtection({ block_creations: { enabled: true } })],
      ["conversation", githubProtection({ required_conversation_resolution: { enabled: true } })],
      ["lock branch", githubProtection({ lock_branch: { enabled: true } })],
      ["fork syncing", githubProtection({ allow_fork_syncing: { enabled: true } })]
    ];
    for (const [label, protection] of exactPolicyDriftVariants) {
      expect(() => verifyGitHubProtectionResponse({
        repository: compliantReceipt.repository,
        repositoryMetadata: personalRepositoryMetadata,
        expectedTip: compliantReceipt.commitSha,
        branch: compliantReceipt.branch,
        observedAt: compliantReceipt.observedAt,
        protection
      }), label).toThrow(new RegExp(label, "i"));
    }

    for (const [key, label] of [
      ["restrictions", "restrictions"],
      ["required_linear_history", "linear history"],
      ["block_creations", "block creations"],
      ["required_conversation_resolution", "conversation"],
      ["lock_branch", "lock branch"],
      ["allow_fork_syncing", "fork syncing"]
    ] as const) {
      expect(() => verifyGitHubProtectionResponse({
        repository: compliantReceipt.repository,
        repositoryMetadata: personalRepositoryMetadata,
        expectedTip: compliantReceipt.commitSha,
        branch: compliantReceipt.branch,
        observedAt: compliantReceipt.observedAt,
        protection: withoutKey(githubProtection({ includeBypassAllowances: false }), key)
      }), label).toThrow(new RegExp(label, "i"));
    }
    expect(() => verifyGitHubProtectionResponse({
      repository: compliantReceipt.repository,
      repositoryMetadata: personalRepositoryMetadata,
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ requiredStatusChecks: { checks: githubChecks() } })
    })).toThrow(/strict/i);
    expect(() => verifyGitHubProtectionResponse({
      repository: compliantReceipt.repository,
      repositoryMetadata: personalRepositoryMetadata,
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ pullRequestOverrides: { require_last_push_approval: undefined } })
    })).toThrow(/last push/i);
  });

  it("keeps organization bypass validation fail-closed", () => {
    expect(verifyGitHubProtectionResponse({
      repository: "example-org/private-broker",
      repositoryMetadata: organizationRepositoryMetadata(),
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ includeBypassAllowances: true })
    })).toMatchObject({ directPushesDisabled: true });

    expect(() => verifyGitHubProtectionResponse({
      repository: "example-org/private-broker",
      repositoryMetadata: organizationRepositoryMetadata(),
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ includeBypassAllowances: false })
    })).toThrow(/bypass|direct push/i);
  });

  it("rejects malformed present bypass allowances for either owner type", () => {
    for (const bypass of [
      { users: [], teams: [] },
      { users: [], teams: [], apps: "none" },
      { users: [], teams: [], apps: [], installations: [] }
    ]) {
      for (const repositoryMetadata of [personalRepositoryMetadata, organizationRepositoryMetadata()]) {
        expect(() => verifyGitHubProtectionResponse({
          repository: repositoryMetadata.repositoryFullName,
          repositoryMetadata,
          expectedTip: compliantReceipt.commitSha,
          branch: compliantReceipt.branch,
          observedAt: compliantReceipt.observedAt,
          protection: githubProtection({ bypassPullRequestAllowances: bypass })
        })).toThrow(/bypass/i);
      }
    }
  });

  it("binds the live repository ID, full name, owner login, and supported owner type", () => {
    expect(repositoryMetadataFromGitHubResponse({
      expectedRepository: compliantReceipt.repository,
      expectedRepositoryId: personalRepositoryMetadata.repositoryId,
      response: githubRepository()
    })).toEqual(personalRepositoryMetadata);

    const invalidResponses: Array<[string, unknown]> = [
      ["ID", githubRepository({ id: "1322344258" })],
      ["ID", githubRepository({ id: 1322344259 })],
      ["full name", githubRepository({ full_name: "seunghyeon1004/other" })],
      ["owner login", githubRepository({ owner: { login: "someone-else", type: "User" } })],
      ["owner type", githubRepository({ owner: { login: "seunghyeon1004", type: "Bot" } })]
    ];
    for (const [label, response] of invalidResponses) {
      expect(() => repositoryMetadataFromGitHubResponse({
        expectedRepository: compliantReceipt.repository,
        expectedRepositoryId: personalRepositoryMetadata.repositoryId,
        response
      }), label).toThrow(new RegExp(label, "i"));
    }

    expect(() => verifyGitHubProtectionResponse({
      repository: compliantReceipt.repository,
      repositoryMetadata: { ...personalRepositoryMetadata, repositoryFullName: "seunghyeon1004/other" },
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ includeBypassAllowances: false })
    })).toThrow(/full name|metadata/i);
  });

  it("accepts exact-empty personal bypasses and rejects nonempty bypasses for both owner types", () => {
    expect(verifyGitHubProtectionResponse({
      repository: compliantReceipt.repository,
      repositoryMetadata: personalRepositoryMetadata,
      expectedTip: compliantReceipt.commitSha,
      branch: compliantReceipt.branch,
      observedAt: compliantReceipt.observedAt,
      protection: githubProtection({ includeBypassAllowances: true })
    })).toMatchObject({ directPushesDisabled: true });

    for (const repositoryMetadata of [personalRepositoryMetadata, organizationRepositoryMetadata()]) {
      expect(() => verifyGitHubProtectionResponse({
        repository: repositoryMetadata.repositoryFullName,
        repositoryMetadata,
        expectedTip: compliantReceipt.commitSha,
        branch: compliantReceipt.branch,
        observedAt: compliantReceipt.observedAt,
        protection: githubProtection({
          bypassPullRequestAllowances: { users: [{ login: "maintainer" }], teams: [], apps: [] }
        })
      })).toThrow(/bypass/i);
    }
  });

  it("fails closed on missing or malformed exact-policy fields", () => {
    const base = githubProtection({ includeBypassAllowances: false });
    const statusChecks = base.required_status_checks as Record<string, unknown>;
    const reviews = base.required_pull_request_reviews as Record<string, unknown>;
    const exactPolicyDriftVariants: Array<[string, unknown]> = [
      ["status checks", withoutKey(base, "required_status_checks")],
      ["status checks", { ...base, required_status_checks: null }],
      ["strict", { ...base, required_status_checks: withoutKey(statusChecks, "strict") }],
      ["required checks", { ...base, required_status_checks: { ...statusChecks, checks: null } }],
      ["required contexts", { ...base, required_status_checks: withoutKey(statusChecks, "contexts") }],
      ["required contexts", { ...base, required_status_checks: { ...statusChecks, contexts: ["extra"] } }],
      ["required checks", { ...base, required_status_checks: { ...statusChecks, checks: [...githubChecks(), githubChecks()[0]] } }],
      ["required checks", { ...base, required_status_checks: { ...statusChecks, checks: [...githubChecks(), { context: "extra", app_id: 15368 }] } }],
      ["required checks", { ...base, required_status_checks: { ...statusChecks, checks: githubChecks().map((check) => ({ ...check, app_id: 42 })) } }],
      ["admins", withoutKey(base, "enforce_admins")],
      ["admins", { ...base, enforce_admins: true }],
      ["admins", { ...base, enforce_admins: { enabled: false } }],
      ["pull request reviews", withoutKey(base, "required_pull_request_reviews")],
      ["pull request reviews", { ...base, required_pull_request_reviews: null }],
      ["approval count", { ...base, required_pull_request_reviews: withoutKey(reviews, "required_approving_review_count") }],
      ["approval count", { ...base, required_pull_request_reviews: { ...reviews, required_approving_review_count: "0" } }],
      ["approval count", { ...base, required_pull_request_reviews: { ...reviews, required_approving_review_count: 1 } }],
      ["stale reviews", { ...base, required_pull_request_reviews: withoutKey(reviews, "dismiss_stale_reviews") }],
      ["stale reviews", { ...base, required_pull_request_reviews: { ...reviews, dismiss_stale_reviews: false } }],
      ["CODEOWNERS", { ...base, required_pull_request_reviews: withoutKey(reviews, "require_code_owner_reviews") }],
      ["CODEOWNERS", { ...base, required_pull_request_reviews: { ...reviews, require_code_owner_reviews: true } }],
      ["force pushes", withoutKey(base, "allow_force_pushes")],
      ["force pushes", { ...base, allow_force_pushes: { enabled: "false" } }],
      ["force pushes", { ...base, allow_force_pushes: { enabled: true } }],
      ["deletion", withoutKey(base, "allow_deletions")],
      ["deletion", { ...base, allow_deletions: { enabled: "false" } }],
      ["deletion", { ...base, allow_deletions: { enabled: true } }]
    ];
    for (const [label, protection] of exactPolicyDriftVariants) {
      expect(() => verifyGitHubProtectionResponse({
        repository: compliantReceipt.repository,
        repositoryMetadata: personalRepositoryMetadata,
        expectedTip: compliantReceipt.commitSha,
        branch: compliantReceipt.branch,
        observedAt: compliantReceipt.observedAt,
        protection
      }), label).toThrow(new RegExp(label, "i"));
    }
  });

  it("preserves complete repository identity metadata in validated receipts", () => {
    expect(verifyBranchProtection({
      ...compliantReceipt,
      repositoryId: personalRepositoryMetadata.repositoryId,
      repositoryOwnerLogin: personalRepositoryMetadata.repositoryOwnerLogin,
      repositoryOwnerType: personalRepositoryMetadata.repositoryOwnerType
    })).toMatchObject({
      repositoryId: personalRepositoryMetadata.repositoryId,
      repositoryOwnerLogin: personalRepositoryMetadata.repositoryOwnerLogin,
      repositoryOwnerType: personalRepositoryMetadata.repositoryOwnerType
    });
    expect(() => verifyBranchProtection(withoutKey({ ...compliantReceipt }, "repositoryOwnerLogin")))
      .toThrow(/repositoryOwnerLogin|required/i);
  });

  it("never truncates a preexisting or symlinked branch-protection receipt", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "branch-protection-output-")));
    temporaryRoots.push(root);
    const existing = join(root, "existing.json");
    await writeFile(existing, "keep\n");
    await expect(writeBranchProtectionReceipt(existing, compliantReceipt)).rejects.toThrow(/exist/i);
    await expect(readFile(existing, "utf8")).resolves.toBe("keep\n");

    const victim = join(root, "victim.json");
    const linked = join(root, "linked.json");
    await writeFile(victim, "victim\n");
    await symlink(victim, linked);
    await expect(writeBranchProtectionReceipt(linked, compliantReceipt)).rejects.toThrow(/exist|symbolic link|symlink/i);
    await expect(readFile(victim, "utf8")).resolves.toBe("victim\n");
  });
});

function githubChecks() {
  return compliantReceipt.requiredChecks.map(({ name, app }) => ({ context: name, app_id: app.id }));
}

function githubProtection(options: {
  includeBypassAllowances?: boolean;
  bypassPullRequestAllowances?: unknown;
  requiredStatusChecks?: unknown;
  pullRequestOverrides?: Record<string, unknown>;
  restrictions?: unknown;
  required_linear_history?: unknown;
  block_creations?: unknown;
  required_conversation_resolution?: unknown;
  lock_branch?: unknown;
  allow_fork_syncing?: unknown;
} = {}) {
  const pullRequestReviews: Record<string, unknown> = {
    require_code_owner_reviews: false,
    required_approving_review_count: 0,
    dismiss_stale_reviews: true,
    require_last_push_approval: false,
    ...options.pullRequestOverrides
  };
  if (options.bypassPullRequestAllowances !== undefined) {
    pullRequestReviews.bypass_pull_request_allowances = options.bypassPullRequestAllowances;
  } else if (options.includeBypassAllowances ?? true) {
    pullRequestReviews.bypass_pull_request_allowances = { users: [], teams: [], apps: [] };
  }
  return {
    required_status_checks: options.requiredStatusChecks ?? {
      strict: true,
      contexts: ["claude-plugin-validation", "quality"],
      checks: githubChecks()
    },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: pullRequestReviews,
    restrictions: options.restrictions === undefined ? null : options.restrictions,
    required_linear_history: options.required_linear_history ?? { enabled: false },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    block_creations: options.block_creations ?? { enabled: false },
    required_conversation_resolution: options.required_conversation_resolution ?? { enabled: false },
    lock_branch: options.lock_branch ?? { enabled: false },
    allow_fork_syncing: options.allow_fork_syncing ?? { enabled: false }
  };
}

function githubRepository(overrides: Record<string, unknown> = {}) {
  return {
    id: personalRepositoryMetadata.repositoryId,
    full_name: personalRepositoryMetadata.repositoryFullName,
    owner: {
      login: personalRepositoryMetadata.repositoryOwnerLogin,
      type: personalRepositoryMetadata.repositoryOwnerType
    },
    ...overrides
  };
}

function organizationRepositoryMetadata() {
  return {
    repositoryId: 42,
    repositoryFullName: "example-org/private-broker",
    repositoryOwnerLogin: "example-org",
    repositoryOwnerType: "Organization" as const
  };
}

function withoutKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const result = { ...value };
  delete result[key];
  return result;
}
