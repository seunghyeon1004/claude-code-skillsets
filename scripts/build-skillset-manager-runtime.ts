import { build } from "esbuild";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = join(root, "plugins", "skillset-manager", "runtime.mjs");
const temporaryRoot = await mkdtemp(join(tmpdir(), "skillset-manager-runtime-build-"));
const temporaryOutput = join(temporaryRoot, "runtime.mjs");

try {
  await build({
    absWorkingDir: root,
    entryPoints: ["src/plugin-runtime/skillset-manager.ts"],
    outfile: temporaryOutput,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    charset: "ascii",
    legalComments: "none",
    sourcemap: false,
    minify: false,
    treeShaking: true,
    // Keep generated module labels stable when this script runs from a linked worktree.
    preserveSymlinks: true,
    plugins: [{
      name: "bundle-decision-contract-schemas",
      setup(buildContext) {
        // Bundle the three runtime schemas; the source repository keeps using createRequire for its Node CLI.
        buildContext.onLoad({ filter: /[/\\]src[/\\]contracts[/\\]decision\.ts$/ }, async ({ path }) => {
          const source = await readFile(path, "utf8");
          const transformed = source
            .replace(
              'import { createRequire } from "node:module";',
              [
                'import decisionIndexSchema from "../../schemas/v3/decision-index.schema.json";',
                'import decisionIntentsSchema from "../../schemas/v3/decision-intents.schema.json";',
                'import decisionCandidateEvidenceSchema from "../../schemas/v3/decision-candidate-evidence.schema.json";'
              ].join("\n")
            )
            .replace('const require = createRequire(import.meta.url);\n', "")
            .replace('const decisionIndexSchema = require("../../schemas/v3/decision-index.schema.json") as object;\n', "")
            .replace('const decisionIntentsSchema = require("../../schemas/v3/decision-intents.schema.json") as object;\n', "")
            .replace('const decisionCandidateEvidenceSchema = require("../../schemas/v3/decision-candidate-evidence.schema.json") as object;\n', "");
          if (transformed === source || transformed.includes("createRequire(import.meta.url)")) {
            throw new Error("Decision contract schema bundling transform is stale");
          }
          return { contents: transformed, loader: "ts", resolveDir: dirname(path) };
        });
        buildContext.onLoad({ filter: /[/\\]src[/\\]decision[/\\]planner\.ts$/ }, async ({ path }) => {
          // Setup execution authenticates through index-loader's private WeakSet, not planner's repository-only Codex view.
          const source = await readFile(path, "utf8");
          const transformed = source.replace(
            'import { isRootDecisionIndex } from "./repository.js";',
            "const isRootDecisionIndex = (_index: unknown): false => false;"
          );
          if (transformed === source || transformed.includes('from "./repository.js"')) {
            throw new Error("Runtime-only planner authentication transform is stale");
          }
          return { contents: transformed, loader: "ts", resolveDir: dirname(path) };
        });
        buildContext.onLoad({ filter: /[/\\]src[/\\]decision[/\\]eligibility\.ts$/ }, async ({ path }) => {
          // The runtime imports only targetVerifiedReason; remove the unused source-materialization identity dependency.
          const source = await readFile(path, "utf8");
          const transformed = source.replace(
            /import \{\n  isVerifiedOfficialMarketplaceIdentity,\n  type VerifiedOfficialMarketplaceIdentity\n\} from "\.\/repository\.js";/,
            [
              "type VerifiedOfficialMarketplaceIdentity = { pluginName: string };",
              "const isVerifiedOfficialMarketplaceIdentity = (): false => false;"
            ].join("\n")
          );
          if (transformed === source || transformed.includes('from "./repository.js"')) {
            throw new Error("Runtime-only eligibility repository transform is stale");
          }
          return { contents: transformed, loader: "ts", resolveDir: dirname(path) };
        });
        buildContext.onLoad({ filter: /[/\\]src[/\\]decision[/\\]index-loader\.ts$/ }, async ({ path }) => {
          // runtime.mjs sits at the installed plugin root, unlike the repository source module.
          const source = await readFile(path, "utf8");
          const transformed = source.replace(
            'new URL("../../plugins/skillset-manager", import.meta.url)',
            'new URL(".", import.meta.url)'
          );
          if (transformed === source || transformed.includes('new URL("../../plugins/skillset-manager"')) {
            throw new Error("Installed plugin root transform is stale");
          }
          return { contents: transformed, loader: "ts", resolveDir: dirname(path) };
        });
        buildContext.onLoad({ filter: /[/\\]src[/\\]evaluate[/\\]setup\.ts$/ }, async ({ path }) => {
          // The bundled entrypoint owns argv; never run the repository evaluation CLI on import.
          const source = await readFile(path, "utf8");
          const transformed = source.replace(
            /\nconst invokedPath = process\.argv\[1\][\s\S]+$/,
            "\n"
          );
          if (transformed === source || transformed.includes("runSetupEvaluationCli(process.argv.slice(2))")) {
            throw new Error("Setup evaluator CLI entrypoint transform is stale");
          }
          return { contents: transformed, loader: "ts", resolveDir: dirname(path) };
        });
      }
    }],
    banner: {
      js: [
        "// Generated by scripts/build-skillset-manager-runtime.ts. Do not edit.",
        'import { createRequire as __skillsetCreateRequire } from "node:module";',
        "const require = __skillsetCreateRequire(import.meta.url);"
      ].join("\n")
    }
  });
  const generated = normalizeGeneratedModuleLabels(await readFile(temporaryOutput));
  if (process.argv.includes("--check")) {
    const tracked = await readFile(output).catch(() => undefined);
    if (tracked === undefined || !tracked.equals(generated)) {
      throw new Error("plugins/skillset-manager/runtime.mjs is missing or stale; run npm run build:manager-runtime");
    }
  } else {
    await writeFile(temporaryOutput, generated);
    await rename(temporaryOutput, output);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function normalizeGeneratedModuleLabels(generated: Buffer): Buffer {
  // esbuild labels bundled dependencies relative to the nearest node_modules.
  // Normalize local-worktree installs to the tracked parent-checkout convention.
  return Buffer.from(generated.toString("utf8")
    .replaceAll("// node_modules/", "// ../../node_modules/")
    .replaceAll('"node_modules/', '"../../node_modules/'));
}
