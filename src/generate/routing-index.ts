import {
  decisionRoutingIndexDigest,
  validateDecisionIndex,
  validateDecisionRoutingIndex
} from "../contracts/decision.js";
import { assertDecisionIndexIntegrity } from "../decision/index-loader.js";
import type { DecisionRoutingIndex } from "../model/decision.js";

const MAX_ROUTING_INDEX_BYTES = 128 * 1024;
const MAX_ROUTING_INDEX_LINES = 2_000;

/** Projects only model-readable routing data from one integrity-valid complete index. */
export function generateRoutingIndex(value: unknown): string {
  const decisionIndex = validateDecisionIndex(value);
  assertDecisionIndexIntegrity(decisionIndex);
  const withoutDigest: Omit<DecisionRoutingIndex, "digest"> = {
    schemaVersion: 1,
    catalogVersion: decisionIndex.catalogVersion,
    observedThrough: decisionIndex.observedThrough,
    catalogExpiresAt: decisionIndex.catalogExpiresAt,
    profiles: structuredClone(decisionIndex.profiles),
    decisionIndexDigest: decisionIndex.digest
  };
  const routingIndex = validateDecisionRoutingIndex({
    ...withoutDigest,
    digest: decisionRoutingIndexDigest(withoutDigest)
  }, decisionIndex);
  const raw = `${JSON.stringify(routingIndex, null, 2)}\n`;
  const lineCount = raw.split("\n").length - 1;
  if (Buffer.byteLength(raw, "utf8") > MAX_ROUTING_INDEX_BYTES || lineCount > MAX_ROUTING_INDEX_LINES) {
    throw new Error("decision routing index exceeds its public size bound");
  }
  return raw;
}
