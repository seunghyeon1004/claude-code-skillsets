import { execFileSync, spawnSync } from "node:child_process";
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

export type RepositoryOwnerType = "User" | "Organization";

const GITHUB_ACCEPT_HEADER = "Accept: application/vnd.github+json";
const GITHUB_API_VERSION_HEADER = "X-GitHub-Api-Version: 2026-03-10";

export interface GitHubRepositoryMetadata {
  repositoryId: number;
  repositoryFullName: string;
  repositoryOwnerLogin: string;
  repositoryOwnerType: RepositoryOwnerType;
}

export function githubApiGetArgs(endpoint: string): string[] {
  return [
    "api",
    "--hostname",
    "github.com",
    "--method",
    "GET",
    "-H",
    GITHUB_ACCEPT_HEADER,
    "-H",
    GITHUB_API_VERSION_HEADER,
    endpoint
  ];
}

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
  repositoryMetadata: GitHubRepositoryMetadata;
  expectedTip: string;
  branch: string;
  observedAt: string;
  protection: unknown;
}): BranchProtectionReceipt {
  assertRepositoryMetadata(input.repository, input.repositoryMetadata);
  assertCommitSha(input.expectedTip, "expected tip");
  const protection = asRecord(input.protection, "GitHub branch protection response");
  const pullRequestReviews = nullableRecord(protection.required_pull_request_reviews);
  const enforceAdmins = nullableRecord(protection.enforce_admins);
  const statusChecks = nullableRecord(protection.required_status_checks);
  const forcePushes = nullableRecord(protection.allow_force_pushes);
  const deletions = nullableRecord(protection.allow_deletions);
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
    repositoryId: input.repositoryMetadata.repositoryId,
    repositoryOwnerLogin: input.repositoryMetadata.repositoryOwnerLogin,
    repositoryOwnerType: input.repositoryMetadata.repositoryOwnerType,
    commitSha: input.expectedTip,
    branch: input.branch,
    observedAt: input.observedAt,
    directPushesDisabled: pullRequestReviews !== null
      && enforceAdmins?.enabled === true
      && hasNoBypassAllowances(pullRequestReviews, input.repositoryMetadata.repositoryOwnerType),
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

export function repositoryMetadataFromGitHubResponse(input: {
  expectedRepository: string;
  expectedRepositoryId: number;
  response: unknown;
}): GitHubRepositoryMetadata {
  const [expectedOwner] = repositoryParts(input.expectedRepository);
  if (!Number.isSafeInteger(input.expectedRepositoryId) || input.expectedRepositoryId < 1) {
    throw new Error("Expected GitHub repository ID must be a positive safe integer");
  }
  const repository = asRecord(input.response, "GitHub repository response");
  const owner = asRecord(repository.owner, "GitHub repository owner");
  if (!Number.isSafeInteger(repository.id) || repository.id !== input.expectedRepositoryId) {
    throw new Error("GitHub repository ID does not match the approved repository ID");
  }
  if (repository.full_name !== input.expectedRepository) {
    throw new Error("GitHub repository full name does not match --repo");
  }
  if (owner.login !== expectedOwner) {
    throw new Error("GitHub repository owner login does not match --repo");
  }
  if (owner.type !== "User" && owner.type !== "Organization") {
    throw new Error("GitHub repository owner type must be User or Organization");
  }
  return {
    repositoryId: repository.id as number,
    repositoryFullName: repository.full_name,
    repositoryOwnerLogin: owner.login,
    repositoryOwnerType: owner.type
  };
}

export function verifyGitHubProtectionResponse(input: {
  repository: string;
  repositoryMetadata: GitHubRepositoryMetadata;
  expectedTip: string;
  branch: string;
  observedAt: string;
  protection: unknown;
}): BranchProtectionReceipt {
  assertRepositoryMetadata(input.repository, input.repositoryMetadata);
  assertCommitSha(input.expectedTip, "expected tip");
  const protection = asRecord(input.protection, "GitHub branch protection response");
  const statusChecks = asRecord(protection.required_status_checks, "required status checks");
  const pullRequestReviews = asRecord(protection.required_pull_request_reviews, "required pull request reviews");
  const enforceAdmins = asRecord(protection.enforce_admins, "enforce admins");
  if (statusChecks.strict !== true) throw new Error("branch protection must enable strict status checks");
  if (!hasExactGitHubRequiredContexts(statusChecks.contexts)) {
    throw new Error("branch protection must have the exact required contexts");
  }
  if (!hasExactGitHubRequiredChecks(statusChecks.checks)) {
    throw new Error("branch protection must have the exact required checks and GitHub Actions app IDs");
  }
  if (enforceAdmins.enabled !== true) throw new Error("branch protection must enforce admins");
  if (pullRequestReviews.required_approving_review_count !== 0) {
    throw new Error("branch protection approval count must be exactly zero");
  }
  if (pullRequestReviews.dismiss_stale_reviews !== true) {
    throw new Error("branch protection must dismiss stale reviews");
  }
  if (pullRequestReviews.require_code_owner_reviews !== false) {
    throw new Error("branch protection must disable CODEOWNERS review");
  }
  if (pullRequestReviews.require_last_push_approval !== false) {
    throw new Error("branch protection must disable last push approval");
  }
  if (!hasNoBypassAllowances(pullRequestReviews, input.repositoryMetadata.repositoryOwnerType)) {
    throw new Error("branch protection bypass allowances are invalid for the repository owner type");
  }
  if (protection.restrictions !== null) throw new Error("branch protection restrictions must be null");
  assertDisabledControl(protection, "required_linear_history", "linear history");
  assertDisabledControl(protection, "allow_force_pushes", "force pushes");
  assertDisabledControl(protection, "allow_deletions", "deletion");
  assertDisabledControl(protection, "block_creations", "block creations");
  assertDisabledControl(protection, "required_conversation_resolution", "conversation resolution");
  assertDisabledControl(protection, "lock_branch", "lock branch");
  assertDisabledControl(protection, "allow_fork_syncing", "fork syncing");

  const receipt = receiptFromGitHubProtection({
    repository: input.repository,
    repositoryMetadata: input.repositoryMetadata,
    expectedTip: input.expectedTip,
    branch: input.branch,
    observedAt: input.observedAt,
    protection
  });
  return verifyBranchProtection(receipt);
}

export function repositoryTipFromGitHubResponse(input: {
  response: unknown;
  expectedTip: string;
}): string {
  assertCommitSha(input.expectedTip, "expected tip");
  const response = asRecord(input.response, "GitHub branch ref response");
  const object = asRecord(response.object, "GitHub branch ref object");
  if (object.type !== "commit" || object.sha !== input.expectedTip) {
    throw new Error("GitHub main tip does not match the expected candidate SHA");
  }
  return object.sha;
}

export function verifyDisabledRequiredSignaturesProbe(input: {
  exitStatus: number | null;
  output: string;
}): void {
  if (input.exitStatus !== 1 || !/^HTTP\/\S+ 404(?:\s|$)/mu.test(input.output)) {
    throw new Error("branch protection must disable signed commits with an exact required-signatures 404 response");
  }
}

async function main(args: readonly string[]): Promise<void> {
  const repo = requiredOption(args, "--repo");
  const expectedRepositoryId = requiredPositiveIntegerOption(args, "--repository-id");
  const expectedTip = requiredOption(args, "--expected-tip");
  assertCommitSha(expectedTip, "--expected-tip");
  const branch = requiredOption(args, "--branch");
  const output = requiredOption(args, "--output");
  repositoryParts(repo);
  if (!/^[A-Za-z0-9._/-]+$/u.test(branch)) throw new Error("--branch is invalid");
  const repositoryResponse = JSON.parse(execFileSync(
    "gh",
    githubApiGetArgs(`repos/${repo}`),
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )) as unknown;
  const repositoryMetadata = repositoryMetadataFromGitHubResponse({
    expectedRepository: repo,
    expectedRepositoryId,
    response: repositoryResponse
  });
  const branchRefEndpoint = `repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const beforeProtectionTip = JSON.parse(execFileSync(
    "gh",
    githubApiGetArgs(branchRefEndpoint),
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )) as unknown;
  repositoryTipFromGitHubResponse({ response: beforeProtectionTip, expectedTip });
  const protectionResponse = JSON.parse(execFileSync(
    "gh",
    githubApiGetArgs(`repos/${repo}/branches/${encodeURIComponent(branch)}/protection`),
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )) as unknown;
  const signaturesProbe = spawnSync(
    "gh",
    [
      ...githubApiGetArgs(`repos/${repo}/branches/${encodeURIComponent(branch)}/protection/required_signatures`).slice(0, -1),
      "--include",
      "--silent",
      `repos/${repo}/branches/${encodeURIComponent(branch)}/protection/required_signatures`
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (signaturesProbe.error !== undefined) throw signaturesProbe.error;
  verifyDisabledRequiredSignaturesProbe({
    exitStatus: signaturesProbe.status,
    output: `${signaturesProbe.stdout}${signaturesProbe.stderr}`
  });
  const afterProtectionTip = JSON.parse(execFileSync(
    "gh",
    githubApiGetArgs(branchRefEndpoint),
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  )) as unknown;
  repositoryTipFromGitHubResponse({ response: afterProtectionTip, expectedTip });
  const receipt = verifyGitHubProtectionResponse({
    repository: repo,
    repositoryMetadata,
    expectedTip,
    branch,
    observedAt: new Date().toISOString(),
    protection: protectionResponse
  });
  const destination = resolve(output);
  await writeBranchProtectionReceipt(destination, receipt);
}

function requiredOption(args: readonly string[], option: string): string {
  const index = args.indexOf(option);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} is required`);
  return value;
}

function requiredPositiveIntegerOption(args: readonly string[], option: string): number {
  const value = requiredOption(args, option);
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${option} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${option} must be a positive safe integer`);
  return parsed;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value === null || value === undefined ? null : asRecord(value, "GitHub branch protection field");
}

function hasNoBypassAllowances(
  pullRequestReviews: Record<string, unknown>,
  repositoryOwnerType: RepositoryOwnerType
): boolean {
  if (!Object.hasOwn(pullRequestReviews, "bypass_pull_request_allowances")) {
    return repositoryOwnerType === "User";
  }
  const value = pullRequestReviews.bypass_pull_request_allowances;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort(compareCodePointStrings);
  return JSON.stringify(keys) === JSON.stringify(["apps", "teams", "users"])
    && keys.every((key) => Array.isArray(value[key]) && value[key].length === 0);
}

function assertRepositoryMetadata(repository: string, metadata: GitHubRepositoryMetadata): void {
  const [expectedOwner] = repositoryParts(repository);
  if (!Number.isSafeInteger(metadata.repositoryId) || metadata.repositoryId < 1) {
    throw new Error("GitHub repository metadata has an invalid repository ID");
  }
  if (metadata.repositoryFullName !== repository) {
    throw new Error("GitHub repository metadata full name does not match repository");
  }
  if (metadata.repositoryOwnerLogin !== expectedOwner) {
    throw new Error("GitHub repository metadata owner login does not match repository");
  }
  if (metadata.repositoryOwnerType !== "User" && metadata.repositoryOwnerType !== "Organization") {
    throw new Error("GitHub repository metadata owner type is unsupported");
  }
}

function assertDisabledControl(protection: Record<string, unknown>, key: string, label: string): void {
  const control = nullableRecord(protection[key]);
  if (control?.enabled !== false) throw new Error(`branch protection must disable ${label}`);
}

function hasExactGitHubRequiredContexts(value: unknown): boolean {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return false;
  const observed = [...value].sort(compareCodePointStrings);
  return observed.length === REQUIRED_BRANCH_PROTECTION_CHECKS.length
    && observed.every((name, index) => name === REQUIRED_BRANCH_PROTECTION_CHECKS[index]);
}

function hasExactGitHubRequiredChecks(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== REQUIRED_BRANCH_PROTECTION_CHECKS.length) return false;
  const observed = value.flatMap((item) => {
    if (!isRecord(item) || typeof item.context !== "string" || item.app_id !== GITHUB_ACTIONS_CHECK_PRODUCER.id) {
      return [];
    }
    return [item.context];
  }).sort(compareCodePointStrings);
  return observed.length === REQUIRED_BRANCH_PROTECTION_CHECKS.length
    && observed.every((name, index) => name === REQUIRED_BRANCH_PROTECTION_CHECKS[index]);
}

function repositoryParts(repository: string): [string, string] {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/u.test(part))) {
    throw new Error("repository must be an owner/name pair");
  }
  return parts as [string, string];
}

function assertCommitSha(value: string, label: string): void {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character commit SHA`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
