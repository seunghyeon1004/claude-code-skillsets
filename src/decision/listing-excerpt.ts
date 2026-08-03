export function assertSemanticListingExcerpt(
  description: string,
  excerpt: string,
  evidenceId: string
): void {
  const length = Array.from(excerpt).length;
  if (excerpt !== excerpt.trim() || length < 2
    || (length === 2 && !/^\p{Lu}{2}$/u.test(excerpt))) {
    throw new Error(`${evidenceId}: listing excerpt is too short or not trimmed`);
  }
  const escaped = excerpt.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const bounded = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
  if (!bounded.test(description)) {
    throw new Error(`${evidenceId}: listing excerpt must match semantic token boundaries`);
  }
}
