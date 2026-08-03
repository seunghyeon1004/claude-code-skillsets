/** Normalizes goal and intent phrases before deterministic phrase matching. */
export function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Normalizes user goals before intent routing. Korean postpositions are removed
 * at token boundaries so all consumers use the same bounded matching behavior.
 */
export function normalizeGoalForRouting(value: string): string {
  return normalizePhrase(value)
    .split(" ")
    .map((token) => {
      const stripped = token.replace(/(?:\uC5D0\uC11C|\uC73C\uB85C|\uD558\uACE0|\uD558\uBA70|\uD574\uC11C|\uC740|\uB294|\uC774|\uAC00|\uC744|\uB97C|\uC5D0|\uB85C|\uC640|\uACFC|\uB3C4|\uB9CC|\uC758)$/u, "");
      return stripped.length > 0 ? stripped : token;
    })
    .join(" ");
}

export function normalizedPhraseLength(value: string): number {
  return Array.from(value).length;
}
