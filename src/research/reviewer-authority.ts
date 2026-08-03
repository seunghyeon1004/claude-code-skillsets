import type { ReviewerRegistry, ReviewerRole } from "../model/review-ledger.js";

const PRIVILEGED_REVIEWER_ROLES = new Set<ReviewerRole>(["security-reviewer", "maintainer"]);

export function hasPrivilegedReviewerAuthority(registry: ReviewerRegistry, reviewerId: string): boolean {
  const reviewer = registry.reviewers.find(({ id }) => id === reviewerId);
  return reviewer !== undefined && reviewer.roles.some((role) => PRIVILEGED_REVIEWER_ROLES.has(role));
}
