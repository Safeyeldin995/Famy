import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.integration.test.ts",
      "qa/__tests__/**/*.test.ts",
      "tools/production-reset/__tests__/**/*.test.ts",
    ],
    setupFiles: ["./qa/vitest-unit-qa-env-guard.mjs"],
  },
});
