import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { canonicalize } from "../../src/research/canonical-json.js";

const claimsPath = "manifests/official-listing-capability-claims.yaml";

export function assertOfficialListingClaimsAppendOnly(baseRaw: string, currentRaw: string): void {
  const base = claimKeys(baseRaw, "base official listing claims");
  const current = claimKeys(currentRaw, "current official listing claims");
  assertRetained(base.candidates, current.candidates, "candidate");
  assertRetained(base.assignments, current.assignments, "assignment");
  assertRecordsRetained(base.capabilityClaims, current.capabilityClaims, "capability claim");
}

export function assertOfficialListingClaimsAppendOnlyAtRef(input: { base: string; root?: string }): void {
  if (!/^[0-9a-f]{7,40}$/u.test(input.base)) throw new Error("--base must be an exact commit identifier");
  const root = resolve(input.root ?? process.cwd());
  if (!gitSucceeds(root, ["merge-base", "--is-ancestor", input.base, "HEAD"])) {
    throw new Error("--base must be an ancestor of HEAD");
  }
  const baseRaw = gitOutput(root, ["show", `${input.base}:${claimsPath}`]);
  const currentRaw = readFileSync(resolve(root, claimsPath), "utf8");
  assertOfficialListingClaimsAppendOnly(baseRaw, currentRaw);
}

function claimKeys(raw: string, label: string): {
  candidates: Set<string>;
  assignments: Set<string>;
  capabilityClaims: Map<string, string>;
} {
  const value = parse(raw) as unknown;
  assertRecord(value, label);
  if (!Array.isArray(value.candidates)) throw new Error(`${label} must contain candidates`);
  const candidates = new Set<string>();
  const assignments = new Set<string>();
  const capabilityClaims = new Map<string, string>();
  for (const [candidateIndex, candidate] of value.candidates.entries()) {
    assertRecord(candidate, `${label} candidate ${candidateIndex}`);
    const pluginName = requiredString(candidate.pluginName, `${label} candidate ${candidateIndex} pluginName`);
    addUnique(candidates, pluginName, `${label} candidate`);
    if (!Array.isArray(candidate.assignments)) {
      throw new Error(`${label} candidate ${pluginName} must contain assignments`);
    }
    for (const [assignmentIndex, assignment] of candidate.assignments.entries()) {
      assertRecord(assignment, `${label} assignment ${assignmentIndex}`);
      const domainId = requiredString(
        assignment.domainId,
        `${label} candidate ${pluginName} assignment ${assignmentIndex} domainId`
      );
      const assignmentKey = `${pluginName}\u0000${domainId}`;
      addUnique(assignments, assignmentKey, `${label} assignment`);
      if (!Array.isArray(assignment.capabilityClaims)) {
        throw new Error(`${label} assignment ${pluginName}/${domainId} must contain capabilityClaims`);
      }
      for (const [claimIndex, claim] of assignment.capabilityClaims.entries()) {
        assertRecord(claim, `${label} capability claim ${claimIndex}`);
        const id = requiredString(
          claim.id,
          `${label} assignment ${pluginName}/${domainId} capability claim ${claimIndex} id`
        );
        addUniqueRecord(
          capabilityClaims,
          `${assignmentKey}\u0000${id}`,
          canonicalize(claim),
          `${label} capability claim`
        );
      }
    }
  }
  return { candidates, assignments, capabilityClaims };
}

function assertRecordsRetained(
  base: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
  label: string
): void {
  assertRetained(new Set(base.keys()), new Set(current.keys()), label);
  const mutated = [...base].filter(([key, value]) => current.get(key) !== value).map(([key]) => key).sort();
  if (mutated.length > 0) {
    throw new Error(`Official listing claims are append-only; mutated ${label}: ${mutated.join(", ")}`);
  }
}

function assertRetained(base: ReadonlySet<string>, current: ReadonlySet<string>, label: string): void {
  const removed = [...base].filter((key) => !current.has(key)).sort();
  if (removed.length > 0) {
    throw new Error(`Official listing claims are append-only; removed ${label}: ${removed.join(", ")}`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function addUnique(values: Set<string>, value: string, label: string): void {
  if (values.has(value)) throw new Error(`${label} identities must be unique: ${value}`);
  values.add(value);
}

function addUniqueRecord(values: Map<string, string>, key: string, value: string, label: string): void {
  if (values.has(key)) throw new Error(`${label} identities must be unique: ${key}`);
  values.set(key, value);
}

function gitSucceeds(root: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", [...args], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function gitOutput(root: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed`, { cause: error });
  }
}

function main(args: readonly string[]): void {
  const baseIndex = args.indexOf("--base");
  const rootIndex = args.indexOf("--root");
  assertOfficialListingClaimsAppendOnlyAtRef({
    base: baseIndex === -1 ? "" : args[baseIndex + 1] ?? "",
    root: rootIndex === -1 ? undefined : args[rootIndex + 1]
  });
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
