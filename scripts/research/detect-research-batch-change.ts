import { hasProtectedResearchBatchSurfaceChanges, hasResearchBatchChanges } from "./assert-extension-append-only.js";

function usage(): never {
  throw new Error("usage: detect-research-batch-change.ts --base <commit> | --between <from> <to>");
}

const args = process.argv.slice(2);
if (args[0] === "--base" && args.length === 2 && args[1]) {
  process.stdout.write(`${hasResearchBatchChanges({ base: args[1] }) ? "changed-batch" : "current-tip"}\n`);
} else if (args[0] === "--between" && args.length === 3 && args[1] && args[2]) {
  process.stdout.write(`${hasProtectedResearchBatchSurfaceChanges(process.cwd(), args[1], args[2]) ? "changed" : "unchanged"}\n`);
} else {
  usage();
}
