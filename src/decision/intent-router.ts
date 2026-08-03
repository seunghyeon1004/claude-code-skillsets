import type { DomainId } from "../model/complete-v1.js";
import type { IntentProfile } from "../model/decision.js";
import { normalizeGoalForRouting, normalizePhrase, normalizedPhraseLength } from "./normalize.js";

export type IntentResolution = "matched" | "ambiguous" | "unclassified";

export interface IntentRoute {
  resolution: IntentResolution;
  profiles: IntentProfile[];
  domainIds: DomainId[];
  matchedPhrases: string[];
}

/** Resolves only the longest normalized phrase matches and never guesses through a tie. */
export function routeIntent(profiles: readonly IntentProfile[], goal: string): IntentRoute {
  const normalizedGoal = normalizeGoalForRouting(goal);
  const goalTokens = tokens(normalizedGoal);
  const matches = profiles.flatMap((profile, profileIndex) => allPhrases(profile).flatMap((phrase) => {
    const normalizedPhrase = normalizePhrase(phrase);
    return normalizedPhrase.length > 0 && containsTokenSequence(goalTokens, tokens(normalizedPhrase))
      ? [{ profile, profileIndex, phrase: normalizedPhrase, length: normalizedPhraseLength(normalizedPhrase) }]
      : [];
  }));
  const longestLength = Math.max(0, ...matches.map(({ length }) => length));
  if (longestLength === 0) {
    return { resolution: "unclassified", profiles: [], domainIds: [], matchedPhrases: [] };
  }

  const longestMatches = matches.filter(({ length }) => length === longestLength);
  const selected = uniqueProfiles(longestMatches);
  const domainIds = uniqueDomains(selected.map(({ profile }) => profile.domainId));
  if (domainIds.length > 1) {
    return {
      resolution: "ambiguous",
      profiles: selected.map(({ profile }) => profile),
      domainIds,
      matchedPhrases: uniqueStrings(selected.map(({ phrase }) => phrase))
    };
  }
  return {
    resolution: "matched",
    profiles: selected.map(({ profile }) => profile),
    domainIds,
    matchedPhrases: uniqueStrings(selected.map(({ phrase }) => phrase))
  };
}

export function goalContainsReviewedPhrase(goal: string, phrase: string): boolean {
  return containsTokenSequence(tokens(normalizeGoalForRouting(goal)), tokens(normalizePhrase(phrase)));
}

function tokens(value: string): string[] {
  return value.split(" ").filter((token) => token.length > 0);
}

function containsTokenSequence(goal: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > goal.length) return false;
  for (let start = 0; start <= goal.length - phrase.length; start += 1) {
    if (phrase.every((token, offset) => goal[start + offset] === token)) return true;
  }
  return false;
}

function allPhrases(profile: IntentProfile): string[] {
  return [...profile.phrases.ko, ...profile.phrases.en];
}

function uniqueProfiles<T extends { profile: IntentProfile; profileIndex: number }>(
  matches: readonly T[]
): T[] {
  const seen = new Set<string>();
  return matches
    .slice()
    .sort((left, right) => left.profileIndex - right.profileIndex)
    .filter((match) => {
      if (seen.has(match.profile.id)) return false;
      seen.add(match.profile.id);
      return true;
    });
}

function uniqueDomains(domainIds: readonly DomainId[]): DomainId[] {
  return domainIds.filter((domainId, index) => domainIds.indexOf(domainId) === index);
}

function uniqueStrings(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
