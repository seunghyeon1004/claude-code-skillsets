import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateDecisionIndex } from "../contracts/decision.js";
import { assertDecisionIndexIntegrity, loadPluginDecisionIndexSet } from "./index-loader.js";

export interface DecisionIndexHistoryReleaseResult {
  currentDigest: string;
  preservedPreviousDigest: string | null;
  historyDigests: readonly string[];
}

/** Release gate for immutable decision-index history. */
export async function verifyDecisionIndexHistoryRelease(input: {
  pluginRoot: string;
  previousIndexRaw?: string;
  previousHistoryEntries?: Readonly<Record<string, string>>;
}): Promise<DecisionIndexHistoryReleaseResult> {
  const pluginRoot = resolve(await realpath(input.pluginRoot));
  const set = await loadPluginDecisionIndexSet(pluginRoot);
  for (const [name, previousRaw] of Object.entries(input.previousHistoryEntries ?? {})) {
    if (!/^[a-f0-9]{64}\.json$/u.test(name)) {
      throw new Error(`Previous decision index history has noncanonical filename ${name}`);
    }
    const path = join(pluginRoot, "data", "decision-index-history", name);
    let currentRaw: string;
    try {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("not regular");
      currentRaw = await readFile(path, "utf8");
    } catch {
      throw new Error(`Existing decision index history ${name} was deleted or replaced`);
    }
    if (currentRaw !== previousRaw) {
      throw new Error(`Existing decision index history ${name} is not append-only`);
    }
  }
  if (input.previousIndexRaw === undefined) {
    return {
      currentDigest: set.current.digest,
      preservedPreviousDigest: null,
      historyDigests: set.digests
    };
  }

  let previousValue: unknown;
  try {
    previousValue = JSON.parse(input.previousIndexRaw) as unknown;
  } catch {
    throw new Error("Previous decision index is not valid JSON");
  }
  const previous = validateDecisionIndex(previousValue);
  assertDecisionIndexIntegrity(previous);
  if (previous.digest === set.current.digest) {
    return {
      currentDigest: set.current.digest,
      preservedPreviousDigest: null,
      historyDigests: set.digests
    };
  }

  const historicalPath = join(
    pluginRoot,
    "data",
    "decision-index-history",
    `${previous.digest}.json`
  );
  let metadata;
  try {
    metadata = await lstat(historicalPath);
  } catch {
    throw new Error(`Changed decision index is missing exact prior history ${previous.digest}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Prior decision index history ${previous.digest} is not a regular file`);
  }
  if (await readFile(historicalPath, "utf8") !== input.previousIndexRaw) {
    throw new Error(`Prior decision index history ${previous.digest} does not preserve exact bytes`);
  }
  if (!set.digests.includes(previous.digest)) {
    throw new Error(`Prior decision index history ${previous.digest} was not authenticated`);
  }
  return {
    currentDigest: set.current.digest,
    preservedPreviousDigest: previous.digest,
    historyDigests: set.digests
  };
}
