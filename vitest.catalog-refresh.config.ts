import { defineConfig } from "vitest/config";

import { resolveTestTimeout } from "./vitest.config.js";

// These suites intentionally execute against the checked-in public-current
// decision snapshot. A review-held refresh candidate changes that fixture by
// design; the base commit runs them through the ordinary full check first.
const publicCurrentSnapshotSuites = [
  "tests/integration/decision-generation.test.ts",
  "tests/integration/decision-migration.test.ts",
  "tests/integration/decision-surface-parity.test.ts",
  "tests/integration/maintain-skill.test.ts",
  "tests/integration/official-listing-claims-generation.test.ts",
  "tests/integration/official-setup.test.ts",
  "tests/integration/setup-atomic-publication.test.ts",
  "tests/integration/setup-skill.test.ts",
  "tests/integration/skillset-manager-runtime.test.ts",
  "tests/integration/starter-routes-production.test.ts",
  "tests/unit/codex-preview.test.ts",
  "tests/unit/decision-contracts.test.ts",
  "tests/unit/decision-generated-projection.test.ts",
  "tests/unit/maintain-evaluator.test.ts",
  "tests/unit/maintain-planner.test.ts",
  "tests/unit/official-target-compatibility-evidence.test.ts",
  "tests/unit/setup-evaluator.test.ts",
  "tests/unit/setup-state-v2.test.ts",
  "tests/unit/starter-route-wiring.test.ts"
] as const;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [...publicCurrentSnapshotSuites],
    environment: "node",
    clearMocks: true,
    fileParallelism: false,
    testTimeout: resolveTestTimeout(process.env.CI)
  }
});
