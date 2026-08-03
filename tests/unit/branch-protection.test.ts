import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  receiptFromGitHubProtection,
  verifyBranchProtection,
  writeBranchProtectionReceipt
} from "../../scripts/github/verify-branch-protection.js";
import type { BranchProtectionReceipt } from "../../src/model/review-ledger.js";

const compliantReceipt: BranchProtectionReceipt = {
  schemaVersion: 3,
  repository: "seunghyeon1004/claude-code-skillsets",
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("branch protection", () => {
  it("accepts the honest sole-maintainer policy with PR-only writes and no human-review guarantee", () => {
    expect(verifyBranchProtection(compliantReceipt)).toEqual(compliantReceipt);
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
      repository: compliantReceipt.repository,
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
      repository: compliantReceipt.repository,
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
      repository: compliantReceipt.repository,
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
        repository: compliantReceipt.repository,
        branch: compliantReceipt.branch,
        observedAt: compliantReceipt.observedAt,
        protection: { ...base, required_status_checks }
      });
      expect(() => verifyBranchProtection(receipt)).toThrow(/GitHub Actions|producer|required check/i);
    }
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
