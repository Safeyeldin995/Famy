import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LEGACY_SOURCE_COMMIT } from "./constants.mjs";

const HARNESS_FILES = [
  "playwright.issue68.config.ts",
  "qa/issue68-dev-server.mjs",
  "qa/issue68-host/App.tsx",
  "qa/issue68-host/constants.mjs",
  "qa/issue68-host/identity.mjs",
  "qa/issue68-host/index.html",
  "qa/issue68-host/main.tsx",
  "qa/issue68-host/mock-plugin.mjs",
  "qa/issue68-host/vite.config.ts",
  "qa/tests/issue68/edge-launch.spec.ts",
  "qa/tests/issue68/fixtures/ProviderOnboardingFlow.pre68.tsx",
  "qa/tests/issue68/mock-supabase.mjs",
  "qa/tests/issue68/onboarding-hydration.spec.ts",
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function gitShow(repoRoot, spec) {
  return execFileSync("git", ["-C", repoRoot, "show", spec], { encoding: "buffer" });
}

export function verifyLegacyFixture(repoRoot) {
  const original = gitShow(
    repoRoot,
    `${LEGACY_SOURCE_COMMIT}:src/components/provider/ProviderOnboardingFlow.tsx`,
  ).toString("utf8");
  const fixturePath = path.join(repoRoot, "qa/tests/issue68/fixtures/ProviderOnboardingFlow.pre68.tsx");
  const fixture = readFileSync(fixturePath, "utf8");
  const expected = original.replace(
    /export function ProviderOnboardingFlow\b/,
    "export function ProviderOnboardingFlowPre68",
  );
  return {
    faithful: fixture === expected && fixture.includes("محترفة"),
    arabicPreserved: fixture.includes("محترفة تنظيف منازل بخبرة"),
    exportRenamed: fixture.includes("export function ProviderOnboardingFlowPre68"),
    unexpectedExport: /export function ProviderOnboardingFlow\b/.test(fixture),
  };
}

export function collectIssue68Identity(repoRoot) {
  const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const hashes = {};
  for (const rel of HARNESS_FILES) {
    hashes[rel] = sha256(readFileSync(path.join(repoRoot, rel)));
  }
  hashes["src/components/provider/ProviderOnboardingFlow.tsx"] = sha256(
    readFileSync(path.join(repoRoot, "src/components/provider/ProviderOnboardingFlow.tsx")),
  );
  const legacy = verifyLegacyFixture(repoRoot);
  return {
    head,
    legacySourceCommit: LEGACY_SOURCE_COMMIT,
    currentComponentPath: "src/components/provider/ProviderOnboardingFlow.tsx",
    legacyFixturePath: "qa/tests/issue68/fixtures/ProviderOnboardingFlow.pre68.tsx",
    hashes,
    legacy,
  };
}
