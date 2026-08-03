import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { verifyDecisionIndexHistoryRelease } from "../src/decision/history-release.js";

const execFile = promisify(execFileCallback);
const projectRoot = process.cwd();
const previousRef = parsePreviousRef(process.argv.slice(2));
const previousIndexRaw = previousRef === undefined
  ? undefined
  : (await execFile("git", [
      "show",
      `${previousRef}:plugins/skillset-manager/data/decision-index.json`
    ], { cwd: projectRoot, maxBuffer: 16 * 1024 * 1024 })).stdout;
const previousHistoryEntries = previousRef === undefined
  ? undefined
  : await readPreviousHistoryEntries(previousRef);

const result = await verifyDecisionIndexHistoryRelease({
  pluginRoot: join(projectRoot, "plugins", "skillset-manager"),
  previousIndexRaw,
  previousHistoryEntries
});
process.stdout.write(`${JSON.stringify({
  status: "decision-index-history-valid",
  previousRef: previousRef ?? null,
  ...result
}, null, 2)}\n`);

function parsePreviousRef(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== "--previous-ref" || args[1] === undefined
    || !/^[A-Za-z0-9._~^/-]+$/u.test(args[1])) {
    throw new Error("Usage: verify-decision-index-history [--previous-ref <git-ref>]");
  }
  return args[1];
}

async function readPreviousHistoryEntries(ref: string): Promise<Record<string, string>> {
  const historyRoot = "plugins/skillset-manager/data/decision-index-history";
  const { stdout } = await execFile(
    "git",
    ["ls-tree", "-r", "--name-only", ref, "--", historyRoot],
    { cwd: projectRoot, maxBuffer: 16 * 1024 * 1024 }
  );
  const paths = stdout.split("\n").filter(Boolean);
  return Object.fromEntries(await Promise.all(paths.map(async (path) => {
    const { stdout: raw } = await execFile(
      "git",
      ["show", `${ref}:${path}`],
      { cwd: projectRoot, maxBuffer: 16 * 1024 * 1024 }
    );
    return [path.slice(historyRoot.length + 1), raw] as const;
  })));
}
