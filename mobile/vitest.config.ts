import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const mobileRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(mobileRoot, "..");

export default defineConfig({
  root: mobileRoot,
  oxc: {
    tsconfig: path.join(mobileRoot, "tsconfig.vitest.json"),
  },
  resolve: {
    alias: [
      {
        find: "@/assets/images/splash-icon.png",
        replacement: path.join(mobileRoot, "src/ui/__tests__/assetStub.js"),
      },
      {
        find: "@/assets/images/famy-wordmark.png",
        replacement: path.join(mobileRoot, "src/ui/__tests__/assetStub.js"),
      },
      { find: "@", replacement: path.join(mobileRoot, "src") },
      { find: "@shared", replacement: path.join(repoRoot, "src/lib") },
    ],
  },
  test: {
    name: "mobile-unit",
    environment: "node",
    include: [
      "src/lib/auth/__tests__/firebasePhone.test.ts",
      "src/ui/__tests__/keyboardFormLayout.test.ts",
      "src/ui/__tests__/launchGateTiming.test.ts",
    ],
    setupFiles: [path.join(repoRoot, "qa/vitest-unit-qa-env-guard.mjs")],
  },
});
