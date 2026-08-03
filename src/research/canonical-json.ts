import { compareCodePointStrings } from "./snapshot.js";

/** Serializes JSON data with recursively code-point-sorted object keys and no whitespace. */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set<object>());
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON does not permit non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new Error(`Canonical JSON does not permit ${typeof value}`);
  if (ancestors.has(value)) throw new Error("Canonical JSON does not permit cyclic values");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serialize(item, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Canonical JSON permits only plain objects");
    }
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length > 0) throw new Error("Canonical JSON does not permit symbol keys");
    return `{${Object.keys(value).sort(compareCodePointStrings).map((key) =>
      `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key], ancestors)}`
    ).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
