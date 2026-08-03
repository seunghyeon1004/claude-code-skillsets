/**
 * Deep-freezes the acyclic JSON/YAML data graph returned by repository loaders.
 * Functions, accessors, custom prototypes and mutable internal-slot objects are
 * rejected because Object.freeze cannot make their behavior deeply immutable.
 */
export function deepFreezeRepositoryData<T>(value: T): T {
  return freezeDataNode(value, new WeakSet<object>(), new WeakSet<object>());
}

function freezeDataNode<T>(value: T, visiting: WeakSet<object>, complete: WeakSet<object>): T {
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error("repository data graph must contain only JSON/YAML data values");
  }
  if (value === null || typeof value !== "object" || complete.has(value)) return value;
  if (visiting.has(value)) throw new Error("repository data graph must be acyclic");
  if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet
    || value instanceof Date || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new Error("repository data graph must contain only arrays and plain objects");
  }
  const prototype = Object.getPrototypeOf(value);
  const validPrototype = Array.isArray(value)
    ? prototype === Array.prototype
    : prototype === Object.prototype || prototype === null;
  if (!validPrototype) {
    throw new Error("repository data graph must contain only arrays and plain objects");
  }
  visiting.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new Error("repository data graph must not contain symbol keys");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) {
      throw new Error("repository data graph must not contain accessors");
    }
    freezeDataNode(descriptor.value, visiting, complete);
  }
  visiting.delete(value);
  complete.add(value);
  return Object.freeze(value);
}
