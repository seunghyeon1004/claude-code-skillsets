/** The only branch-protection checks allowed in a sanitized RC receipt. */
export const REQUIRED_BRANCH_PROTECTION_CHECKS = ["claude-plugin-validation", "quality"] as const;

export const GITHUB_ACTIONS_CHECK_PRODUCER = Object.freeze({
  id: 15368,
  slug: "github-actions"
} as const);

export interface RequiredCheckBinding {
  name: string;
  app: {
    id: number;
    slug: string;
  };
}

export const REQUIRED_BRANCH_PROTECTION_CHECK_BINDINGS = Object.freeze(
  REQUIRED_BRANCH_PROTECTION_CHECKS.map((name) => Object.freeze({
    name,
    app: GITHUB_ACTIONS_CHECK_PRODUCER
  }))
);

export function hasExactRequiredBranchProtectionChecks(
  value: unknown
): value is readonly RequiredCheckBinding[] {
  return Array.isArray(value)
    && value.length === REQUIRED_BRANCH_PROTECTION_CHECK_BINDINGS.length
    && value.every((check, index) => {
      const expected = REQUIRED_BRANCH_PROTECTION_CHECK_BINDINGS[index]!;
      return isRecord(check)
        && check.name === expected.name
        && isRecord(check.app)
        && check.app.id === expected.app.id
        && check.app.slug === expected.app.slug;
    });
}

export function requiredCheckBindings(): RequiredCheckBinding[] {
  return REQUIRED_BRANCH_PROTECTION_CHECK_BINDINGS.map(({ name, app }) => ({ name, app: { ...app } }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
