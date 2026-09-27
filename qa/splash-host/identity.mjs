import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LEGACY_SOURCE_COMMIT } from "./constants.mjs";

const HARNESS_FILES = [
  "playwright.splash.config.ts",
  "qa/splash-dev-server.mjs",
  "qa/splash-host/App.tsx",
  "qa/splash-host/constants.mjs",
  "qa/splash-host/identity.mjs",
  "qa/splash-host/index.html",
  "qa/splash-host/main.tsx",
  "qa/splash-host/mock-plugin.mjs",
  "qa/splash-host/vite.config.ts",
  "qa/tests/splash/edge-launch.spec.ts",
  "qa/tests/splash/fixtures/FamySplashScreen.legacy.tsx",
  "qa/tests/splash/helpers.ts",
  "qa/tests/splash/splash-animation.spec.ts",
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
    `${LEGACY_SOURCE_COMMIT}:src/components/famio/FamySplashScreen.tsx`,
  ).toString("utf8");
  const fixturePath = path.join(repoRoot, "qa/tests/splash/fixtures/FamySplashScreen.legacy.tsx");
  const fixture = readFileSync(fixturePath, "utf8");
  const expected = original.replace(
    /export function FamySplashScreen\b/,
    "export function FamySplashScreenLegacy",
  );
  return {
    faithful: fixture === expected,
    exportRenamed: fixture.includes("export function FamySplashScreenLegacy"),
    unexpectedExport: /export function FamySplashScreen\b/.test(fixture),
  };
}

export function collectSplashIdentity(repoRoot) {
  const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const hashes = {};
  for (const rel of HARNESS_FILES) {
    hashes[rel] = sha256(readFileSync(path.join(repoRoot, rel)));
  }
  hashes["src/components/famio/FamySplashScreen.tsx"] = sha256(
    readFileSync(path.join(repoRoot, "src/components/famio/FamySplashScreen.tsx")),
  );
  const legacy = verifyLegacyFixture(repoRoot);
  return {
    head,
    legacySourceCommit: LEGACY_SOURCE_COMMIT,
    currentComponentPath: "src/components/famio/FamySplashScreen.tsx",
    legacyFixturePath: "qa/tests/splash/fixtures/FamySplashScreen.legacy.tsx",
    hashes,
    legacy,
  };
}
