import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateReviewerRegistry } from "../../src/contracts/review-ledger.js";
import { parseReviewLedgerJsonl, verifyReviewLedger } from "../../src/research/review-ledger.js";

export function assertReviewLedgerAppendOnly(options: { base: string; root?: string }): void {
  if (!options.base) throw new Error("--base is required");
  const root = resolve(options.root ?? process.cwd());
  if (!gitSucceeds(root, ["merge-base", "--is-ancestor", options.base, "HEAD"])) {
    throw new Error("--base must be an ancestor of HEAD");
  }
  const baseLedger = readAtOptional(root, options.base, "research/review-ledger.jsonl");
  const baseReviewersJson = readAtOptional(root, options.base, "governance/reviewers.json");
  const headLedger = readFileSync(resolve(root, "research/review-ledger.jsonl"), "utf8");
  if (baseLedger === undefined || baseReviewersJson === undefined) {
    throw new Error("required public baseline must contain the review ledger and reviewer registry");
  }
  const base = parseReviewLedgerJsonl(baseLedger);
  const head = parseReviewLedgerJsonl(headLedger);
  const baseReviewers = validateReviewerRegistry(JSON.parse(baseReviewersJson));
  const changedPaths = gitOutput(root, ["diff", "--name-only", options.base, "--"])
    .trim().split("\n").filter(Boolean);
  verifyReviewLedger({ base, head, baseReviewers, changedPaths });
}

function readAtOptional(root: string, ref: string, path: string): string | undefined {
  try {
    return gitOutput(root, ["show", `${ref}:${path}`]);
  } catch {
    if (!gitSucceeds(root, ["cat-file", "-e", `${ref}:${path}`])) return undefined;
    throw new Error(`cannot read required base path ${path} at ${ref}`);
  }
}

function gitSucceeds(root: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function gitOutput(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed`, { cause: error });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseIndex = process.argv.indexOf("--base");
  const rootIndex = process.argv.indexOf("--root");
  assertReviewLedgerAppendOnly({
    base: baseIndex === -1 ? "" : process.argv[baseIndex + 1] ?? "",
    root: rootIndex === -1 ? undefined : process.argv[rootIndex + 1]
  });
}
