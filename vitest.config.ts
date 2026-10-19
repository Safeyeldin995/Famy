import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    setupFiles: ["./qa/vitest-unit-qa-env-guard.mjs"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
          include: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "src/**/*.integration.test.ts",
            "qa/__tests__/**/*.test.ts",
            "tools/production-reset/__tests__/**/*.test.ts",
          ],
          exclude: ["src/lib/db/__tests__/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
          include: [
            "src/lib/db/__tests__/**/*.test.ts",
            "src/lib/db/__tests__/**/*.test.tsx",
          ],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
