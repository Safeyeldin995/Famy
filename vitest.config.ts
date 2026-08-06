import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts", "qa/__tests__/**/*.test.ts"],
    setupFiles: ["./qa/vitest-unit-qa-env-guard.mjs"],
  },
});
