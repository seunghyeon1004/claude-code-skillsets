import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { validateBranchProtectionReceipt } from "../../src/contracts/review-ledger.js";
import {
  GITHUB_ACTIONS_CHECK_PRODUCER,
  REQUIRED_BRANCH_PROTECTION_CHECKS,
  hasExactRequiredBranchProtectionChecks
} from "../../src/governance/branch-protection.js";
import type { BranchProtectionReceipt } from "../../src/model/review-ledger.js";
import { canonicalize } from "../../src/research/canonical-json.js";
import { compareCodePointStrings } from "../../src/research/snapshot.js";
import { writeExclusiveOutputFile } from "../../src/safety/safe-output.js";

export { REQUIRED_BRANCH_PROTECTION_CHECKS } from "../../src/governance/branch-protection.js";

export function verifyBranchProtection(receipt: unknown): BranchProtectionReceipt {
  const validated = validateBranchProtectionReceipt(receipt);
  if (!validated.directPushesDisabled) throw new Error("branch protection must disable direct pushes");
  if (!validated.forcePushesDisabled) throw new Error("branch protection must disable force pushes");
  if (!validated.deletionsDisabled) throw new Error("branch protection must disable branch deletion");
  if (!hasExactRequiredBranchProtectionChecks(validated.requiredChecks)) {
    throw new Error("branch protection must bind every required check to the GitHub Actions producer");
  }
  if (validated.minimumApprovals !== 0) throw new Error("sole-maintainer branch protection must require zero approvals");
  if (!validated.dismissesStaleReviews) throw new Error("branch protection must dismiss stale reviews");
  if (validated.requiresCodeOwnerReview) throw new Error("sole-maintainer branch protection must not require CODEOWNERS review");
  if (validated.governanceMode !== "solo-maintainer") throw new Error("branch protection must disclose sole-maintainer governance");
  if (validated.humanReviewGuarantee !== "not-guaranteed") {
    throw new Error("branch protection must disclose that independent human review is not guaranteed");
  }
  return validated;
}

export async function writeBranchProtectionReceipt(
  destination: string,
  receipt: BranchProtectionReceipt
): Promise<void> {
  await writeExclusiveOutputFile(resolve(destination), `${canonicalize(receipt)}\n`);
}

export function receiptFromGitHubProtection(input: {
  repository: string;
  branch: string;
  observedAt: string;
  protection: unknown;
}): BranchProtectionReceipt {
  const protection = asRecord(input.protection, "GitHub branch protection response");
  const pullRequestReviews = nullableRecord(protection.required_pull_request_reviews);
  const enforceAdmins = nullableRecord(protection.enforce_admins);
  const statusChecks = nullableRecord(protection.required_status_checks);
  const forcePushes = nullableRecord(protection.allow_force_pushes);
  const deletions = nullableRecord(protection.allow_deletions);
  const bypassAllowances = nullableRecord(pullRequestReviews?.bypass_pull_request_allowances);
  const checks = Array.isArray(statusChecks?.checks)
    ? statusChecks.checks.flatMap((value) => {
      const check = nullableRecord(value);
      if (typeof check?.context !== "string" || !Number.isSafeInteger(check.app_id)) return [];
      const appId = check.app_id as number;
      return [{
        name: check.context,
        app: {
          id: appId,
          slug: appId === GITHUB_ACTIONS_CHECK_PRODUCER.id
            ? GITHUB_ACTIONS_CHECK_PRODUCER.slug
            : "unverified"
        }
      }];
    })
    : [];
  return {
    schemaVersion: 3,
    repository: input.repository,
    branch: input.branch,
    observedAt: input.observedAt,
    directPushesDisabled: pullRequestReviews !== null && enforceAdmins?.enabled === true && hasNoBypassAllowances(bypassAllowances),
    forcePushesDisabled: forcePushes?.enabled === false,
    deletionsDisabled: deletions?.enabled === false,
    requiredChecks: checks.sort((left, right) => compareCodePointStrings(left.name, right.name)),
    minimumApprovals: pullRequestReviews !== null
      && Number.isSafeInteger(pullRequestReviews.required_approving_review_count)
      ? pullRequestReviews.required_approving_review_count as number
      : 0,
    dismissesStaleReviews: pullRequestReviews?.dismiss_stale_reviews === true,
    requiresCodeOwnerReview: pullRequestReviews?.require_code_owner_reviews === true,
    governanceMode: "solo-maintainer",
    humanReviewGuarantee: "not-guaranteed"
  };
}

async function main(args: readonly string[]): Promise<void> {
  const repo = requiredOption(args, "--repo");
  const branch = requiredOption(args, "--branch");
  const output = requiredOption(args, "--output");
  const response = JSON.parse(execFileSync(
    "gh",
    ["api", "--method", "GET", `repos/${repo}/branches/${branch}/protection`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )) as unknown;
  const receipt = verifyBranchProtection(receiptFromGitHubProtection({
    repository: repo,
    branch,
    observedAt: new Date().toISOString(),
    protection: response
  }));
  const destination = resolve(output);
  await writeBranchProtectionReceipt(destination, receipt);
}

function requiredOption(args: readonly string[], option: string): string {
  const index = args.indexOf(option);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} is required`);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value === null || value === undefined ? null : asRecord(value, "GitHub branch protection field");
}

function hasNoBypassAllowances(value: Record<string, unknown> | null): boolean {
  if (value === null) return false;
  return ["users", "teams", "apps"].every((key) => Array.isArray(value[key]) && value[key].length === 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
