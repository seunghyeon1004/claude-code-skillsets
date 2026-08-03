import { execFileSync } from "node:child_process";
import { hasResearchBatchChanges } from "./assert-extension-append-only.js";

const zeroObjectId = "0".repeat(40);
const objectIdPattern = /^[0-9a-f]{40,64}$/u;
const exactSha1ObjectIdPattern = /^[0-9a-f]{40}$/u;
const publicRootTagPattern = /^public-history\/root-v[1-9][0-9]*$/u;
const firstPublicBootstrapVariables = [
  "PUSH_BEFORE",
  "PUBLIC_BOOTSTRAP_REMOTE_EXACT",
  "PUBLIC_ROOT_COMMIT",
  "PUBLIC_TIP_COMMIT",
  "PUBLIC_ROOT_TAG_NAME",
  "PUBLIC_ROOT_TAG_OBJECT"
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed`, { cause: error });
  }
}

function requiredObjectId(name: string): string {
  const value = process.env[name];
  if (value === undefined || !objectIdPattern.test(value)) fail(`${name} must be a full lowercase object ID`);
  return value;
}

interface FirstPublicBootstrapInput {
  root: string;
  tip: string;
  tagName: string;
  tagObject: string;
}

function resolveFirstPublicBootstrap(input: FirstPublicBootstrapInput): { base: string; mode: "first-public-bootstrap" } {
  if (process.env.PUSH_BEFORE !== zeroObjectId) {
    fail("First public bootstrap requires an exact zero remote base");
  }
  if (process.env.GITHUB_REF !== "refs/heads/main") {
    fail("First public bootstrap requires the main ref");
  }
  const { root, tip, tagObject, tagName } = input;
  if (!publicRootTagPattern.test(tagName)) {
    fail("PUBLIC_ROOT_TAG_NAME must be a public-history root governance tag");
  }
  if (git(["symbolic-ref", "--short", "HEAD"]) !== "main") {
    fail("First public bootstrap checkout must be on the main ref");
  }
  if (git(["rev-parse", "HEAD"]) !== tip) {
    fail("First public bootstrap tip does not match current main");
  }
  if (!isCommit(root)) fail("First public bootstrap root is not an available commit");
  if (!isCommit(tip)) fail("First public bootstrap tip is not an available commit");
  const rootParents = commitParents(root);
  if (rootParents.length !== 0) fail("First public bootstrap root must have no parent");
  const tipParents = commitParents(tip);
  if (tipParents.length !== 1 || tipParents[0] !== root) {
    fail("First public bootstrap tip must have exactly the declared root as its parent");
  }
  if (git(["rev-parse", `${root}^{tree}`]) !== git(["rev-parse", `${tip}^{tree}`])) {
    fail("First public bootstrap root and attestation tip must have the same tree");
  }
  const history = git(["rev-list", "--reverse", tip]).split("\n").filter(Boolean);
  if (history.length !== 2 || history[0] !== root || history[1] !== tip) {
    fail("First public bootstrap history must contain exactly the declared root and tip");
  }

  let resolvedTagObject: string;
  try {
    resolvedTagObject = git(["rev-parse", "--verify", `refs/tags/${tagName}^{tag}`]);
  } catch {
    fail("First public bootstrap tag must be an available annotated tag");
  }
  if (resolvedTagObject !== tagObject) fail("First public bootstrap tag object does not match the declared object");
  const payload = git(["cat-file", "-p", tagObject]);
  const headers = tagHeaders(payload);
  if (headers.object !== root || headers.type !== "commit" || headers.tag !== tagName) {
    fail("First public bootstrap tag must directly annotate the declared root commit");
  }
  return { base: root, mode: "first-public-bootstrap" };
}

function resolveManualFirstPublicBootstrap(): { base: string; mode: "first-public-bootstrap" } {
  const tagName = process.env.PUBLIC_ROOT_TAG_NAME;
  if (tagName === undefined) fail("PUBLIC_ROOT_TAG_NAME must be a public-history root governance tag");
  return resolveFirstPublicBootstrap({
    root: requiredObjectId("PUBLIC_ROOT_COMMIT"),
    tip: requiredObjectId("PUBLIC_TIP_COMMIT"),
    tagObject: requiredObjectId("PUBLIC_ROOT_TAG_OBJECT"),
    tagName
  });
}

function resolveAutomaticFirstPublicBootstrap(): { base: string; mode: "first-public-bootstrap" } {
  if (process.env.PUBLIC_BOOTSTRAP_REMOTE_EXACT !== "true") {
    fail("First public bootstrap requires a fresh remote attestation");
  }
  const tagName = process.env.PUBLIC_ROOT_TAG_NAME;
  if (tagName === undefined || !publicRootTagPattern.test(tagName)) {
    fail("PUBLIC_ROOT_TAG_NAME must be a public-history root governance tag");
  }
  const tip = git(["rev-parse", "HEAD"]);
  const history = git(["rev-list", "--reverse", tip]).split("\n").filter(Boolean);
  if (history.length !== 2) fail("First public bootstrap history must contain exactly two commits");
  const root = history[0]!;
  let tagObject: string;
  try {
    tagObject = git(["rev-parse", "--verify", `refs/tags/${tagName}^{tag}`]);
  } catch {
    fail("First public bootstrap tag must be an available annotated tag");
  }
  return resolveFirstPublicBootstrap({ root, tip, tagName, tagObject });
}

function resolveManualCurrentTip(): { base: string; mode: "current-tip" } {
  if (firstPublicBootstrapVariables.some((name) => Boolean(process.env[name]))) {
    fail("Manual current-tip input is ambiguous with first-public bootstrap metadata");
  }
  const expectedTip = process.env.EXPECTED_CURRENT_TIP;
  if (expectedTip === undefined || !exactSha1ObjectIdPattern.test(expectedTip)) {
    fail("EXPECTED_CURRENT_TIP must be an exact 40-character lowercase object ID");
  }
  if (process.env.GITHUB_REF !== "refs/heads/main") {
    fail("Manual current-tip revalidation requires the main ref");
  }
  let branch: string;
  try {
    branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch {
    fail("Manual current-tip checkout must be on the main branch");
  }
  if (branch !== "main") fail("Manual current-tip checkout must be on the main branch");
  if (!isCommit(expectedTip)) fail("Manual current-tip expected object must be an available commit");

  const head = git(["rev-parse", "--verify", "HEAD"]);
  if (head !== expectedTip) fail("Manual current-tip HEAD does not match the expected tip");
  const main = git(["rev-parse", "--verify", "refs/heads/main"]);
  if (main !== expectedTip) fail("Manual current-tip main branch does not match the expected tip");
  return { base: head, mode: "current-tip" };
}

function commitParents(commit: string): string[] {
  const fields = git(["rev-list", "--parents", "-n", "1", commit]).split(" ");
  if (fields[0] !== commit) fail("First public bootstrap commit identity mismatch");
  return fields.slice(1).filter(Boolean);
}

function isCommit(object: string): boolean {
  try {
    return git(["cat-file", "-t", object]) === "commit";
  } catch {
    return false;
  }
}

function tagHeaders(payload: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of payload.split("\n")) {
    if (line.length === 0) break;
    const separator = line.indexOf(" ");
    if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

const eventName = process.env.EVENT_NAME;
const manualCurrentTip = process.env.MANUAL_CURRENT_TIP;
if (manualCurrentTip !== undefined && manualCurrentTip !== "" && manualCurrentTip !== "true" && manualCurrentTip !== "false") {
  fail("MANUAL_CURRENT_TIP must be exactly true or false");
}
if (manualCurrentTip === "true" && eventName !== "workflow_dispatch") {
  fail("Manual current-tip mode requires workflow_dispatch");
}
if (eventName === "workflow_dispatch") {
  if (manualCurrentTip !== "true" && process.env.EXPECTED_CURRENT_TIP) {
    fail("EXPECTED_CURRENT_TIP requires manual current-tip mode");
  }
  const context = manualCurrentTip === "true"
    ? resolveManualCurrentTip()
    : resolveManualFirstPublicBootstrap();
  process.stdout.write(`base=${context.base}\nmode=${context.mode}\n`);
} else {
  if (eventName === "push" && process.env.PUSH_BEFORE === zeroObjectId) {
    const context = resolveAutomaticFirstPublicBootstrap();
    process.stdout.write(`base=${context.base}\nmode=${context.mode}\n`);
    process.exit(0);
  }
  const base = eventName === "pull_request"
    ? process.env.PR_BASE_SHA
    : eventName === "push"
      ? process.env.PUSH_BEFORE
      : fail(`Unsupported event for append-only verification: ${eventName ?? ""}`);

  if (!base || base === zeroObjectId) fail("A non-zero event base commit is required");
  git(["cat-file", "-e", `${base}^{commit}`]);
  git(["merge-base", "--is-ancestor", base, "HEAD"]);

  const mode = hasResearchBatchChanges({ base }) ? "changed-batch" : "current-tip";
  process.stdout.write(`base=${base}\nmode=${mode}\n`);
}
