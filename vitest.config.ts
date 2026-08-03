import { defineConfig } from "vitest/config";

export function resolveTestTimeout(
  ci: string | undefined,
  localTimeout = 10_000,
  ciTimeout = 30_000
): number {
  return ci === "true" ? ciTimeout : localTimeout;
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    fileParallelism: false,
    testTimeout: resolveTestTimeout(process.env.CI)
  }
});
