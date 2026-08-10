import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./qa/vitest-otp-global-setup.mjs"],
    setupFiles: ["./qa/vitest-integration-registry-setup.mjs"],
    include: [
      "src/lib/otp/__tests__/*.integration.test.ts",
      "src/lib/auth/__tests__/*.integration.test.ts",
      "src/lib/provider/__tests__/*.integration.test.ts",
      "src/lib/booking/__tests__/*.integration.test.ts",
      "src/lib/db/__tests__/*.integration.test.ts",
    ],
    env: {
      OTP_INTEGRATION: "1",
      QA_INTEGRATION_REGISTRY: "1",
    },
  },
});
