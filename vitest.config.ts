import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    setupFiles: ["./qa/vitest-unit-qa-env-guard.mjs"],
    clearMocks: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/*.test.ts",
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
          name: "unit-jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          exclude: ["src/lib/db/__tests__/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/lib/db/__tests__/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "db-jsdom",
          environment: "jsdom",
          include: ["src/lib/db/__tests__/**/*.test.tsx"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
