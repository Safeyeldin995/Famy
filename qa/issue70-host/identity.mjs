import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SSR_HYDRATION_COVERAGE } from "./constants.mjs";

export const HARNESS_FILES = [
  "playwright.issue70.config.ts",
  "qa/issue70-dev-server.mjs",
  "qa/issue70-host/App.tsx",
  "qa/issue70-host/constants.mjs",
  "qa/issue70-host/identity.mjs",
  "qa/issue70-host/index.html",
  "qa/issue70-host/main.tsx",
  "qa/issue70-host/mock-plugin.mjs",
  "qa/issue70-host/vite.config.ts",
  "qa/tests/issue70/browser-launch.spec.ts",
  "qa/tests/issue70/mock-supabase.mjs",
  "qa/tests/issue70/setup-address.spec.ts",
];

export const PRODUCT_FILES = [
  "src/routes/setup.tsx",
  "src/components/famio/AuthGate.tsx",
  "src/components/famio/LocationPicker.tsx",
  "src/lib/auth/useRequireAuth.ts",
  "src/lib/db/queries.ts",
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function collectIssue70Identity(repoRoot) {
  const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const hashes = {};
  for (const rel of [...HARNESS_FILES, ...PRODUCT_FILES]) {
    hashes[rel] = sha256(readFileSync(path.join(repoRoot, rel)));
  }
  return {
    head,
    ssrHydrationCoverage: SSR_HYDRATION_COVERAGE,
    productPaths: PRODUCT_FILES,
    hashes,
  };
}
