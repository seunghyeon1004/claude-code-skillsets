import { createHash } from "node:crypto";
import {
  compareRfc3339Timestamps,
  parseStrictRfc3339Timestamp,
  validateReviewLedgerEvent,
  validateReviewerRegistry
} from "../contracts/review-ledger.js";
import type { LedgerState, ReviewLedgerEvent, ReviewerRegistry } from "../model/review-ledger.js";
import { canonicalize } from "./canonical-json.js";
import { hasPrivilegedReviewerAuthority } from "./reviewer-authority.js";

export interface VerifyReviewLedgerInput {
  head: readonly ReviewLedgerEvent[];
  base: readonly ReviewLedgerEvent[];
  baseReviewers: ReviewerRegistry;
  changedPaths: readonly string[];
}

/** Computes the SHA-256 of the canonical event object excluding only eventHash. */
export function hashReviewEvent(event: ReviewLedgerEvent): string {
  const { eventHash: _eventHash, ...hashable } = event;
  return createHash("sha256").update(canonicalize(hashable), "utf8").digest("hex");
}

/** Parses canonical JSONL where every nonempty event occupies exactly one LF-terminated line. */
export function parseReviewLedgerJsonl(content: string): ReviewLedgerEvent[] {
  if (content === "") return [];
  if (!content.endsWith("\n") || content.includes("\r")) {
    throw new Error("review ledger JSONL must terminate every event with exactly one LF");
  }
  const lines = content.slice(0, -1).split("\n");
  if (lines.some((line) => line.length === 0)) throw new Error("review ledger JSONL must not contain blank event lines");
  return lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`review ledger JSONL line ${index + 1} is not JSON`, { cause: error });
    }
    if (canonicalize(value) !== line) {
      throw new Error(`review ledger JSONL line ${index + 1} is not canonical`);
    }
    return validateReviewLedgerEvent(value);
  });
}

export function serializeReviewLedgerJsonl(events: readonly ReviewLedgerEvent[]): string {
  return events.length === 0 ? "" : `${events.map(canonicalize).join("\n")}\n`;
}

/** Verifies hash-chain integrity, base-prefix append-only semantics, and base-SHA reviewer authority. */
export function verifyReviewLedger(input: VerifyReviewLedgerInput): LedgerState {
  const baseReviewers = validateReviewerRegistry(input.baseReviewers);
  const reviewerChanged = input.changedPaths.includes("governance/reviewers.json");
  const ledgerChanged = input.changedPaths.includes("research/review-ledger.jsonl") || !sameEvents(input.base, input.head);
  if (reviewerChanged && ledgerChanged) {
    throw new Error("reviewer registry and review ledger cannot change in the same change");
  }

  const baseState = verifyLedgerEvents(input.base);
  if (input.head.length < input.base.length) throw new Error("review ledger past lines were deleted");
  for (const [index, event] of input.base.entries()) {
    if (canonicalize(event) !== canonicalize(input.head[index])) {
      throw new Error(`review ledger past line ${index + 1} was changed`);
    }
  }

  const state = verifyLedgerEvents(input.head);
  const eventsById = new Map(state.events.map((event) => [event.id, event]));
  for (const event of state.events.slice(baseState.events.length)) {
    authorizeEvent(event, baseReviewers, eventsById);
  }
  return state;
}

function verifyLedgerEvents(events: readonly ReviewLedgerEvent[]): LedgerState {
  const byId = new Map<string, ReviewLedgerEvent>();
  const leavesByTarget = new Map<string, ReviewLedgerEvent>();
  let previousEventHash: string | null = null;
  let previousReviewedAt: ReturnType<typeof parseStrictRfc3339Timestamp> | undefined;

  for (const [index, rawEvent] of events.entries()) {
    const event = validateReviewLedgerEvent(rawEvent);
    if (event.sequence !== index + 1) throw new Error(`review ledger sequence gap at line ${index + 1}`);
    if (event.previousEventHash !== previousEventHash) throw new Error(`review ledger previousEventHash is broken at line ${index + 1}`);
    if (event.eventHash !== hashReviewEvent(event)) throw new Error(`review ledger eventHash is broken at line ${index + 1}`);
    if (byId.has(event.id)) throw new Error(`review ledger decision ID is duplicated: ${event.id}`);
    assertTargetDisposition(event);
    const reviewedAt = parseStrictRfc3339Timestamp(event.reviewedAt);
    const expiresAt = parseStrictRfc3339Timestamp(event.expiresAt);
    if (compareRfc3339Timestamps(expiresAt, reviewedAt) <= 0) {
      throw new Error(`review ledger review times are invalid: ${event.id}`);
    }
    if (previousReviewedAt !== undefined && compareRfc3339Timestamps(reviewedAt, previousReviewedAt) <= 0) {
      throw new Error(`review ledger reviewedAt must be strictly ordered at line ${index + 1}`);
    }

    const targetKey = targetIdentity(event);
    const currentLeaf = leavesByTarget.get(targetKey);
    if (currentLeaf === undefined) {
      if (event.supersedes !== null) throw new Error(`review ledger supersedes a missing leaf: ${event.id}`);
    } else if (event.supersedes !== currentLeaf.id) {
      throw new Error(`review ledger target has multiple leaves or an invalid fork: ${event.id}`);
    }
    byId.set(event.id, event);
    leavesByTarget.set(targetKey, event);
    previousEventHash = event.eventHash;
    previousReviewedAt = reviewedAt;
  }
  return { events: [...events], leaves: [...leavesByTarget.values()] };
}

function authorizeEvent(
  event: ReviewLedgerEvent,
  reviewers: ReviewerRegistry,
  eventsById: ReadonlyMap<string, ReviewLedgerEvent>
): void {
  const roles = reviewers.reviewers.find(({ id }) => id === event.reviewerId)?.roles;
  if (roles === undefined) throw new Error(`review ledger reviewer is not a base reviewer: ${event.reviewerId}`);
  const superseded = event.supersedes === null ? undefined : eventsById.get(event.supersedes);
  if (event.disposition !== "held" || superseded?.disposition === "blocked") {
    if (!hasPrivilegedReviewerAuthority(reviewers, event.reviewerId)) {
      throw new Error(`review ledger disposition requires a base reviewer with security-reviewer or maintainer: ${event.id}`);
    }
  }
}

function assertTargetDisposition(event: ReviewLedgerEvent): void {
  if (event.target.skillPath === null && event.disposition === "approved") {
    throw new Error(`review ledger approved disposition requires an exact path: ${event.id}`);
  }
}

function targetIdentity(event: ReviewLedgerEvent): string {
  return `${event.target.sourceId}\u0000${event.target.skillPath ?? ""}`;
}

function sameEvents(left: readonly ReviewLedgerEvent[], right: readonly ReviewLedgerEvent[]): boolean {
  return left.length === right.length && left.every((event, index) => canonicalize(event) === canonicalize(right[index]));
}
